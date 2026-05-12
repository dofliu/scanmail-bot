"""Form Fill Dispatcher — 依輸入型態自動選擇 backend"""
import io
import logging
from typing import Optional

from app.services.form_fill.schema import DetectionResult, UnsupportedFormat
from app.services.form_fill.backends import (
    acroform,
    pdfplumber_extract,
    paddle_structure,
    gemini_vision,
)

logger = logging.getLogger(__name__)


def detect_fields(data: bytes, mime: str, hint: Optional[str] = None) -> DetectionResult:
    """偵測表單欄位 — 依檔案型態走分層策略

    Args:
        data: 檔案二進位資料
        mime: MIME type，例如 "application/pdf" 或 "image/jpeg"
        hint: 使用者提供的提示（例如表單名稱），LLM backend 會用到

    Returns:
        DetectionResult
    """
    mime = (mime or "").lower()

    if mime == "application/pdf":
        # Layer 1: AcroForm
        if acroform.has_acroform(data):
            logger.info("Form detect: using AcroForm backend")
            return acroform.detect(data)

        # Layer 2: text-extractable PDF
        if pdfplumber_extract.has_text_layer(data):
            logger.info("Form detect: using pdfplumber backend")
            return pdfplumber_extract.detect(data)

        # 純圖片型 PDF → 渲染成影像走 Layer 3/4
        logger.info("Form detect: PDF has no text layer, rendering pages to images")
        images = _render_pdf_to_images(data)
        return _detect_from_images(images, hint, page_count=len(images))

    if mime.startswith("image/"):
        return _detect_from_images([data], hint, page_count=1)

    raise UnsupportedFormat(f"不支援的檔案格式: {mime}")


def _detect_from_images(images: list[bytes], hint: Optional[str], page_count: int) -> DetectionResult:
    """從影像偵測欄位 — Layer 3 (PaddleOCR) 優先，否則 Layer 4 (Gemini)"""
    if paddle_structure.is_available():
        try:
            logger.info("Form detect: using PaddleOCR PP-Structure backend")
            return paddle_structure.detect(images, page_count=page_count)
        except Exception as e:
            logger.warning("PaddleOCR backend failed, falling back to Gemini: %s", e)

    logger.info("Form detect: using Gemini Vision backend")
    return gemini_vision.detect(images, hint=hint, page_count=page_count)


def _render_pdf_to_images(data: bytes, dpi: int = 150) -> list[bytes]:
    """把 PDF 每一頁渲染成 PNG bytes（給 OCR / Vision backend 用）"""
    try:
        import fitz  # pymupdf，已是 requirements 的一部分
    except ImportError as e:
        raise UnsupportedFormat("缺少 pymupdf，無法渲染掃描型 PDF") from e

    doc = fitz.open(stream=data, filetype="pdf")
    images: list[bytes] = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    for page in doc:
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        images.append(pix.tobytes("png"))
    doc.close()
    return images
