"""Layer 2 — 可選取文字 PDF 欄位偵測（pdfplumber）

策略：
1. pdfplumber 抽出每頁文字（含座標）與表格框線
2. 啟發式配對：標籤右側 / 下方的「空白矩形」視為欄位
3. 信心度低於門檻時 needs_review=True，提示使用者手動微調

注意：pdfplumber 不在 requirements.txt 中時，is_available() 會回傳 False。
"""
import io
import logging
import re
from typing import Optional

from app.services.form_fill.schema import FormField, DetectionResult

logger = logging.getLogger(__name__)


def is_available() -> bool:
    try:
        import pdfplumber  # noqa: F401
        return True
    except ImportError:
        return False


def has_text_layer(data: bytes) -> bool:
    """快速判斷 PDF 是否含可選取文字"""
    if not is_available():
        # 退而求其次：用 pymupdf 判斷
        try:
            import fitz
            doc = fitz.open(stream=data, filetype="pdf")
            for page in doc:
                if page.get_text("text").strip():
                    doc.close()
                    return True
            doc.close()
            return False
        except Exception:
            return False

    import pdfplumber
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                if (page.extract_text() or "").strip():
                    return True
        return False
    except Exception as e:
        logger.debug("has_text_layer check failed: %s", e)
        return False


# 常見表單標籤的關鍵字（中文+英文），命中後旁邊的空白視為欄位
_LABEL_HINTS = re.compile(
    r"(姓名|申請人|職稱|單位|部門|系所|學校|機關|"
    r"電話|手機|傳真|信箱|電子郵件|地址|"
    r"日期|時間|金額|統一編號|身分證|學號|"
    r"主旨|事由|備註|簽章|簽名|"
    r"Name|Title|Department|Email|Phone|Date|Address|Subject)\s*[:：﹕]?",
    re.IGNORECASE,
)


def detect(data: bytes) -> DetectionResult:
    """從可選取文字的 PDF 偵測欄位"""
    if not is_available():
        return DetectionResult(
            backend_used="pdfplumber",
            page_count=0,
            fields=[],
            needs_review=True,
            notes="pdfplumber 未安裝，請改用 AcroForm 或 OCR backend",
        )

    import pdfplumber

    fields: list[FormField] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        page_count = len(pdf.pages)
        for page_num, page in enumerate(pdf.pages):
            words = page.extract_words(use_text_flow=True) or []
            for w in words:
                text = (w.get("text") or "").strip()
                if not text or not _LABEL_HINTS.search(text):
                    continue
                # 欄位推測：標籤右側一個 word 寬度為起始的水平條
                x0, y0, x1, y1 = float(w["x0"]), float(w["top"]), float(w["x1"]), float(w["bottom"])
                # pdfplumber 座標原點為左上；轉成 PDF points（左下原點）
                ph = float(page.height)
                bbox_pdf = (x1 + 2, ph - y1, x1 + 200, ph - y0)
                fields.append(FormField(
                    name=f"p{page_num}_f{len(fields)}",
                    label=text.rstrip(":：﹕ "),
                    field_type=_guess_type(text),
                    bbox=bbox_pdf,
                    page=page_num,
                    backend="pdfplumber",
                    confidence=0.65,
                ))

    logger.info("pdfplumber detected: %d candidate fields", len(fields))
    return DetectionResult(
        backend_used="pdfplumber",
        page_count=page_count,
        fields=fields,
        needs_review=True,
        notes="啟發式偵測，建議使用者確認欄位範圍",
    )


def _guess_type(label: str) -> str:
    if re.search(r"日期|Date|時間|Time", label, re.IGNORECASE):
        return "date"
    if re.search(r"金額|數量|編號|電話|手機", label):
        return "number"
    if re.search(r"簽章|簽名|Signature", label, re.IGNORECASE):
        return "signature"
    return "text"
