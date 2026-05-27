"""Form Fill Dispatcher — 依輸入型態自動選擇 backend

設計契約：
- 對外公開兩個函式：
    normalize_to_pdf(data, mime) — 邊界用，把任意輸入轉成 PDF（影像→單頁 PDF）
    detect_fields(pdf_data) — 內部一律操作 PDF
- FormField.bbox 永遠以 PDF points 表示（origin bottom-left），
  各 backend 自行完成從原生座標系到 PDF points 的換算
"""
import io
import logging
from typing import Optional

from pypdf import PdfReader

from app.services.form_fill.schema import DetectionResult, UnsupportedFormat
from app.services.form_fill.backends import (
    acroform,
    pdfplumber_extract,
    paddle_structure,
    gemini_vision,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────
# 邊界：input normalization
# ─────────────────────────────────────────────────────────────

def normalize_to_pdf(data: bytes, mime: str) -> bytes:
    """把任意輸入轉成 PDF bytes。

    這是 form_fill 模組對外的「邊界」— 之後的 detect / fill 都假設
    輸入是 PDF。對於影像輸入，把它包成一頁 PDF，page size 等於影像
    像素數（1pt 對應 1px），讓後續的 bbox 換算保持線性簡單。

    Args:
        data: 原始 bytes
        mime: "application/pdf" 或 "image/*"

    Returns:
        PDF bytes
    """
    mime = (mime or "").lower()
    if mime == "application/pdf":
        return data
    if mime.startswith("image/"):
        return _image_to_pdf(data)
    raise UnsupportedFormat(f"不支援的檔案格式: {mime}")


def _image_to_pdf(data: bytes) -> bytes:
    """把單張影像包成一頁 PDF（page size = image pixel count）"""
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    # resolution=72 ⇒ PDF 頁面尺寸（points）數值等於影像像素數，
    # 之後 Gemini normalized→PDF points 的換算就是純線性比例
    img.save(buf, format="PDF", resolution=72.0)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────
# 主流程：detect
# ─────────────────────────────────────────────────────────────

def detect_fields(data: bytes, hint: Optional[str] = None) -> DetectionResult:
    """偵測表單欄位 — 輸入必須是 PDF（請先呼叫 normalize_to_pdf）

    Args:
        data: PDF bytes
        hint: 使用者提供的提示（例如表單名稱），LLM backend 會用到

    Returns:
        DetectionResult
    """
    # Layer 1: AcroForm
    if acroform.has_acroform(data):
        logger.info("Form detect: using AcroForm backend")
        return acroform.detect(data)

    # Layer 2: text-extractable PDF
    if pdfplumber_extract.has_text_layer(data):
        logger.info("Form detect: using pdfplumber backend")
        result = pdfplumber_extract.detect(data)
        if result.fields:
            return result
        # M4.6：Layer 2 抓不到任何欄位（常見於純表格/特殊版型）→ 自動轉影像走 Layer 3/4
        logger.info("Form detect: pdfplumber found 0 fields, falling back to image backends")

    # 沒有文字層（或 Layer 2 偵測 0 欄位）→ 渲染成影像走 Layer 3/4
    logger.info("Form detect: rendering pages to images")
    page_sizes_pts = _get_pdf_page_sizes(data)
    images = _render_pdf_to_images(data)
    return _detect_from_images(images, page_sizes_pts, hint)


def _detect_from_images(
    images: list[bytes],
    page_sizes_pts: list[tuple[float, float]],
    hint: Optional[str],
) -> DetectionResult:
    """從影像偵測欄位 — Layer 3 (PaddleOCR) 優先，否則 Layer 4 (Gemini)

    Args:
        images: 每頁 PNG bytes
        page_sizes_pts: 對應每頁的 PDF 頁面尺寸（用於 backend 換算座標）
        hint: 表單名稱提示
    """
    page_count = len(images)
    if paddle_structure.is_available():
        try:
            logger.info("Form detect: using PaddleOCR PP-Structure backend")
            return paddle_structure.detect(images, page_sizes_pts=page_sizes_pts)
        except Exception as e:
            logger.warning("PaddleOCR backend failed, falling back to Gemini: %s", e)

    logger.info("Form detect: using Gemini Vision backend")
    return gemini_vision.detect(images, page_sizes_pts=page_sizes_pts, hint=hint)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _get_pdf_page_sizes(data: bytes) -> list[tuple[float, float]]:
    """讀取 PDF 每一頁的 (width, height) in PDF points"""
    reader = PdfReader(io.BytesIO(data))
    sizes: list[tuple[float, float]] = []
    for page in reader.pages:
        box = page.mediabox
        sizes.append((float(box.width), float(box.height)))
    return sizes


def _render_pdf_to_images(data: bytes, dpi: int = 150) -> list[bytes]:
    """把 PDF 每一頁渲染成 PNG bytes（給 OCR / Vision backend 用）"""
    try:
        import fitz  # pymupdf，已是 requirements 的一部分
    except ImportError as e:
        raise UnsupportedFormat("缺少 pymupdf，無法渲染掃描型 PDF") from e

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        images: list[bytes] = []
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            images.append(pix.tobytes("png"))
        return images
    finally:
        doc.close()
