"""Layer 4 — Gemini Vision 表單欄位偵測（保底）

讓 Gemini 直接看圖回傳 JSON：每個欄位的 label / bbox / type。
精度不如 AcroForm/PaddleOCR，但對手寫、奇怪版型最強。

座標契約：
- Gemini 用 0~1000 的影像 normalized 座標（原點左上）回傳
- 本 backend 在組 FormField 時，依 caller 傳入的 page_sizes_pts
  把座標換算成 PDF points（原點左下），讓 filler 不必再做 backend 分支
"""
import logging
from typing import Optional

from app.config import get_settings
from app.services.common.json_parsing import safe_parse_llm_json
from app.services.form_fill.schema import FormField, DetectionResult, Backend

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """你是一個表單欄位偵測助手。

任務：分析使用者提供的表單影像，找出**所有需要使用者填寫的欄位**，
並回傳每個欄位的位置與標籤。

## 嚴格輸出格式（JSON）
{
  "fields": [
    {
      "label": "申請人姓名",
      "field_type": "text|date|number|checkbox|signature",
      "bbox_norm": [x0, y0, x1, y1],
      "confidence": 0.9
    }
  ]
}

## 規則
1. bbox_norm 用 **0~1000 的相對座標**，原點左上，x 向右、y 向下
2. 只列「需要填寫」的空白欄位；標題、說明文字不算
3. label 取最靠近欄位的提示文字（例如「姓名：____」的 label = "姓名"）
4. 同一份表單裡 label 必須唯一；重複時加註編號（"地址1"、"地址2"）
5. 只輸出 JSON，不要有其他文字
"""


def detect(
    images: list[bytes],
    page_sizes_pts: list[tuple[float, float]],
    hint: Optional[str] = None,
) -> DetectionResult:
    """以 Gemini Vision 偵測表單欄位

    Args:
        images: 每頁影像 PNG bytes
        page_sizes_pts: 對應每頁的 PDF 頁面尺寸 (w, h) in points，用於座標換算
        hint: 表單提示（例如「差旅費報銷單」）
    """
    page_count = len(images)
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY 未設定，無法使用 Gemini Vision backend")
        return DetectionResult(
            backend_used=Backend.GEMINI,
            page_count=page_count,
            fields=[],
            needs_review=True,
            notes="GEMINI_API_KEY 未設定",
        )

    if len(page_sizes_pts) != page_count:
        logger.warning(
            "page_sizes_pts 數量 (%d) ≠ images 數量 (%d)，缺的頁面用 A4 預設",
            len(page_sizes_pts), page_count,
        )
        page_sizes_pts = list(page_sizes_pts) + [(595.0, 842.0)] * (page_count - len(page_sizes_pts))

    all_fields: list[FormField] = []
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        for page_num, img_bytes in enumerate(images):
            user_prompt = _build_user_prompt(hint, page_num, page_count)
            image_part = types.Part.from_bytes(data=img_bytes, mime_type="image/png")

            response = client.models.generate_content(
                model=settings.AI_MODEL,
                contents=[image_part, user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.0,
                    max_output_tokens=settings.AI_MAX_TOKENS,
                    response_mime_type="application/json",
                ),
            )
            text = (response.text or "").strip()
            parsed = safe_parse_llm_json(text, default={"fields": []})
            pw, ph = page_sizes_pts[page_num]
            page_fields = _to_form_fields(parsed.get("fields", []), page_num, pw, ph)
            all_fields.extend(page_fields)

    except Exception as e:
        logger.error("Gemini Vision backend 失敗: %s", e, exc_info=True)
        return DetectionResult(
            backend_used=Backend.GEMINI,
            page_count=page_count,
            fields=[],
            needs_review=True,
            notes=f"Gemini 偵測失敗: {e}",
        )

    return DetectionResult(
        backend_used="gemini",
        page_count=page_count,
        fields=all_fields,
        needs_review=True,
        notes="Vision 偵測座標可能有 5-15px 誤差，建議在預覽中確認",
    )


def _build_user_prompt(hint: Optional[str], page_num: int, total: int) -> str:
    parts = [f"請偵測這份表單（第 {page_num + 1} / {total} 頁）的所有填寫欄位。"]
    if hint:
        parts.append(f"使用者提示：{hint}")
    return "\n".join(parts)


def _to_form_fields(
    raw: list[dict],
    page_num: int,
    page_w_pts: float,
    page_h_pts: float,
) -> list[FormField]:
    """把 Gemini normalized 座標換算為 PDF points (origin bottom-left)

    Gemini bbox_norm = [x0, y0, x1, y1] 是影像座標 0~1000、原點左上。
    PDF points 原點在左下，所以 y 軸要翻轉。
    """
    fields: list[FormField] = []
    for i, item in enumerate(raw):
        bbox_norm = item.get("bbox_norm") or item.get("bbox")
        if not bbox_norm or len(bbox_norm) != 4:
            continue
        try:
            nx0, ny0, nx1, ny1 = (float(v) for v in bbox_norm)
        except (TypeError, ValueError):
            continue

        # normalize to 0..1，並夾在合法範圍內
        nx0, nx1 = sorted((max(0.0, min(1000.0, nx0)) / 1000.0,
                           max(0.0, min(1000.0, nx1)) / 1000.0))
        ny0, ny1 = sorted((max(0.0, min(1000.0, ny0)) / 1000.0,
                           max(0.0, min(1000.0, ny1)) / 1000.0))

        # 映射到 PDF points + y 軸翻轉
        x0_pts = nx0 * page_w_pts
        x1_pts = nx1 * page_w_pts
        y0_pts = page_h_pts - ny1 * page_h_pts  # 圖像下緣 → PDF 上緣 → 取低值
        y1_pts = page_h_pts - ny0 * page_h_pts

        fields.append(FormField(
            name=f"p{page_num}_g{i}",
            label=str(item.get("label", "")).strip() or f"欄位 {i+1}",
            field_type=str(item.get("field_type", "text")),
            bbox=(x0_pts, y0_pts, x1_pts, y1_pts),
            page=page_num,
            backend=Backend.GEMINI,
            confidence=float(item.get("confidence", 0.7)),
        ))
    return fields
