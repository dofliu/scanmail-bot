"""Layer 1 — AcroForm PDF 欄位偵測

利用 pypdf 直接讀取 PDF 內嵌的 AcroForm 欄位 metadata。
這是最精準、零 AI 成本的路徑，但只對「真正帶有欄位的 PDF」有效。
"""
import io
import logging
from typing import Optional

from pypdf import PdfReader

from app.services.form_fill.schema import FormField, DetectionResult

logger = logging.getLogger(__name__)


# AcroForm 欄位類型 → 內部 field_type
_FT_MAP = {
    "/Tx": "text",       # text field
    "/Btn": "checkbox",  # button / checkbox / radio
    "/Ch": "text",       # choice (dropdown / list) - 簡化為 text
    "/Sig": "signature",
}


def has_acroform(data: bytes) -> bool:
    """判斷 PDF 是否包含 AcroForm 欄位"""
    try:
        reader = PdfReader(io.BytesIO(data))
        root = reader.trailer.get("/Root") if reader.trailer else None
        if not root:
            return False
        acro = root.get("/AcroForm") if hasattr(root, "get") else None
        if not acro:
            return False
        # 必須有 Fields 陣列且至少一個欄位
        fields = reader.get_fields()
        return bool(fields)
    except Exception as e:
        logger.debug("has_acroform check failed: %s", e)
        return False


def detect(data: bytes) -> DetectionResult:
    """從 AcroForm PDF 抽出所有欄位"""
    reader = PdfReader(io.BytesIO(data))
    raw_fields = reader.get_fields() or {}
    page_count = len(reader.pages)

    # 建立 page index map：{indirect_ref: page_num}
    page_index: dict = {}
    for i, page in enumerate(reader.pages):
        page_index[page.indirect_reference.idnum if page.indirect_reference else id(page)] = i

    fields: list[FormField] = []
    for name, info in raw_fields.items():
        ft = info.get("/FT", "/Tx")
        field_type = _FT_MAP.get(str(ft), "text")
        label = str(info.get("/TU") or info.get("/T") or name)  # /TU = tooltip, /T = name

        bbox = None
        page_num = 0
        rect = info.get("/Rect")
        if rect and len(rect) == 4:
            bbox = (float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))

        # 嘗試找出欄位所在頁
        page_ref = info.get("/P")
        if page_ref is not None and hasattr(page_ref, "idnum"):
            page_num = page_index.get(page_ref.idnum, 0)

        fields.append(FormField(
            name=str(name),
            label=label,
            field_type=field_type,
            bbox=bbox,
            page=page_num,
            backend="acroform",
            confidence=1.0,
        ))

    logger.info("AcroForm detected: %d fields across %d pages", len(fields), page_count)
    return DetectionResult(
        backend_used="acroform",
        page_count=page_count,
        fields=fields,
        needs_review=False,
        notes="AcroForm 結構化欄位，精度 100%",
    )


def fill(data: bytes, values: dict) -> bytes:
    """將值寫回 AcroForm 欄位

    Args:
        data: 原始 PDF bytes
        values: {field_name: value}

    Returns:
        填寫後的 PDF bytes
    """
    from pypdf import PdfWriter

    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter(clone_from=reader)

    # 將值套用到每一頁的欄位（pypdf 需要逐頁呼叫）
    # auto_regenerate=True 讓 viewer 重新渲染外觀（中文等非 ASCII 才會顯示）
    for page in writer.pages:
        try:
            writer.update_page_form_field_values(page, values, auto_regenerate=True)
        except TypeError:
            # 舊版 pypdf 不支援 auto_regenerate kwarg
            writer.update_page_form_field_values(page, values)
        except Exception as e:
            logger.warning("update_page_form_field_values failed: %s", e)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()
