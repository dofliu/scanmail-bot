"""圖片處理與 PDF 轉換"""
import io
import logging
from PIL import Image, ImageOps
import img2pdf

logger = logging.getLogger(__name__)

# A4 尺寸 (300 DPI)
A4_WIDTH_PX = int(210 / 25.4 * 300)   # 2480
A4_HEIGHT_PX = int(297 / 25.4 * 300)  # 3508

# 最大圖片尺寸
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def validate_image(image_data: bytes) -> tuple[bool, str]:
    """驗證圖片（大小、格式）

    Returns:
        (is_valid, error_message)
    """
    if len(image_data) > MAX_SIZE_BYTES:
        size_mb = len(image_data) / (1024 * 1024)
        return False, f"圖片檔案過大（{size_mb:.1f}MB），上限為 10MB"

    try:
        img = Image.open(io.BytesIO(image_data))
        img.verify()
    except Exception:
        return False, "無法辨識的圖片格式，請重新拍照或上傳"

    return True, ""


def optimize_image(image_data: bytes, max_dimension: int = 2480,
                   quality: int = 85) -> bytes:
    """最佳化圖片（旋轉、壓縮、調整尺寸）"""
    img = Image.open(io.BytesIO(image_data))

    # 自動旋轉（依 EXIF 資訊）
    img = ImageOps.exif_transpose(img)

    # 轉為 RGB（去除 alpha channel）
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    # 調整大小
    img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

    # 壓縮輸出
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    buf.seek(0)
    return buf.getvalue()


def image_to_pdf(image_data: bytes) -> bytes:
    """將圖片轉為 A4 PDF"""
    return images_to_pdf([image_data])


def images_to_pdf(images: list[bytes]) -> bytes:
    """將多張圖片轉為多頁 A4 PDF

    Args:
        images: 圖片 bytes 列表，每張一頁

    Returns:
        PDF bytes
    """
    if not images:
        raise ValueError("至少需要一張圖片")

    jpeg_pages = []
    for i, image_data in enumerate(images):
        img = Image.open(io.BytesIO(image_data))

        # 自動旋轉
        img = ImageOps.exif_transpose(img)

        # 轉 RGB
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # A4 適配
        img.thumbnail((A4_WIDTH_PX, A4_HEIGHT_PX), Image.LANCZOS)

        # 輸出 JPEG
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85, optimize=True)
        jpeg_pages.append(buf.getvalue())

    # 轉 PDF（img2pdf 原生支援多頁）
    pdf_bytes = img2pdf.convert(jpeg_pages)
    logger.info("圖片轉 PDF 完成: %d 頁, %d bytes", len(jpeg_pages), len(pdf_bytes))
    return pdf_bytes


def get_image_info(image_data: bytes) -> dict:
    """取得圖片基本資訊"""
    try:
        img = Image.open(io.BytesIO(image_data))
        return {
            "format": img.format,
            "mode": img.mode,
            "size": img.size,
            "width": img.size[0],
            "height": img.size[1],
            "bytes": len(image_data),
        }
    except Exception as e:
        logger.error("無法讀取圖片資訊: %s", e)
        return {"error": str(e)}
