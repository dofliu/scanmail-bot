"""Layer 4 — Gemini Vision 表單欄位偵測（保底）

讓 Gemini 直接看圖回傳 JSON：每個欄位的 label / bbox / type。
精度不如 AcroForm/PaddleOCR，但對手寫、奇怪版型最強。

座標格式：要求 Gemini 用「0~1000 的相對座標」回傳，本地再依影像實際尺寸換算為 PDF points。
"""
import io
import json
import logging
import re
from typing import Optional

from app.config import get_settings
from app.services.form_fill.schema import FormField, DetectionResult

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


def detect(images: list[bytes], hint: Optional[str] = None, page_count: int = 1) -> DetectionResult:
    """以 Gemini Vision 偵測表單欄位"""
    settings = get_settings()
    if not settings.GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY 未設定，無法使用 Gemini Vision backend")
        return DetectionResult(
            backend_used="gemini",
            page_count=page_count,
            fields=[],
            needs_review=True,
            notes="GEMINI_API_KEY 未設定",
        )

    all_fields: list[FormField] = []
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        for page_num, img_bytes in enumerate(images):
            user_prompt = _build_user_prompt(hint, page_num, len(images))
            image_part = types.Part.from_bytes(data=img_bytes, mime_type="image/png")

            response = client.models.generate_content(
                model=settings.AI_MODEL,
                contents=[image_part, user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.2,
                    max_output_tokens=settings.AI_MAX_TOKENS,
                    response_mime_type="application/json",
                ),
            )
            text = (response.text or "").strip()
            parsed = _parse_json(text)
            page_fields = _to_form_fields(parsed.get("fields", []), page_num, img_bytes)
            all_fields.extend(page_fields)

    except Exception as e:
        logger.error("Gemini Vision backend 失敗: %s", e, exc_info=True)
        return DetectionResult(
            backend_used="gemini",
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


def _parse_json(text: str) -> dict:
    """穩健地從 Gemini 回應中抽出 JSON"""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    logger.warning("Gemini 回應無法解析為 JSON: %s", text[:200])
    return {"fields": []}


def _to_form_fields(raw: list[dict], page_num: int, img_bytes: bytes) -> list[FormField]:
    """將 Gemini 回傳的 normalized bbox → FormField

    注意：Gemini 回的是「影像座標 0~1000」，但 FormField.bbox 標準是「PDF points」。
    這裡先保留 normalized 座標，留 TODO 給 filler 階段做精確換算（需要 DPI / 頁面尺寸）。
    """
    fields: list[FormField] = []
    for i, item in enumerate(raw):
        bbox_norm = item.get("bbox_norm") or item.get("bbox") or [0, 0, 0, 0]
        if len(bbox_norm) != 4:
            continue
        fields.append(FormField(
            name=f"p{page_num}_g{i}",
            label=str(item.get("label", "")).strip() or f"欄位 {i+1}",
            field_type=str(item.get("field_type", "text")),
            bbox=tuple(float(v) for v in bbox_norm),  # 注意：normalized 0~1000
            page=page_num,
            backend="gemini",
            confidence=float(item.get("confidence", 0.7)),
        ))
    return fields
