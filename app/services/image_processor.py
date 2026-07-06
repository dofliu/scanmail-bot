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


def normalize_orientation(image_data: bytes) -> tuple[bytes, bool]:
    """依 EXIF Orientation 把像素轉正（手機直拍照片必要）

    瀏覽器顯示 <img> 時會套用 EXIF 方向，但 OpenCV 解碼時不會 —
    若不先轉正，前端看到的圖與後端處理的圖方向不同，
    使用者手動框選的角點座標會對不上。

    只在方向標籤 ≠ 1 時才重新編碼（避免無謂的品質損失）。

    Returns:
        (image_bytes, was_reencoded)：轉正後為 JPEG；未轉動時原樣返回
    """
    try:
        img = Image.open(io.BytesIO(image_data))
        orientation = img.getexif().get(0x0112, 1)
        if orientation == 1:
            return image_data, False
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=95)
        logger.info("EXIF 方向 %s → 已轉正並重新編碼", orientation)
        return buf.getvalue(), True
    except Exception as e:
        logger.warning("EXIF 方向正規化失敗（使用原圖）: %s", e)
        return image_data, False


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


# ══════════════════════════════════════════════════════════════
# 旋轉 / 翻轉
# ══════════════════════════════════════════════════════════════

def _resolve_output_format(img: Image.Image, requested: str) -> tuple[str, str]:
    """依輸入圖與使用者選擇決定輸出 (Pillow format, mime suffix)

    requested = "auto" 時沿用輸入格式（PNG 走 PNG，其他走 JPEG）。
    """
    if requested.lower() == "auto":
        fmt = (img.format or "JPEG").upper()
        if fmt == "JPG":
            fmt = "JPEG"
        if fmt not in ("JPEG", "PNG", "WEBP", "BMP", "GIF"):
            fmt = "JPEG"
    else:
        fmt = requested.upper()
        if fmt == "JPG":
            fmt = "JPEG"
    suffix = "jpg" if fmt == "JPEG" else fmt.lower()
    return fmt, suffix


def rotate_image(image_data: bytes, angle: int = 90,
                 output_format: str = "auto", quality: int = 90) -> bytes:
    """旋轉圖片

    - 90 / 180 / 270 / -90 / -180 / -270 走 PIL transpose（無損、不裁切）
    - 其他角度走 Image.rotate(expand=True, resample=BICUBIC)，邊角補白

    Args:
        angle: 旋轉角度，正值=順時針
        output_format: "auto" | "JPEG" | "PNG" | "WEBP" | "BMP" | "GIF"
        quality: JPEG / WEBP 品質 1-100

    Returns:
        旋轉後的圖片 bytes
    """
    img = Image.open(io.BytesIO(image_data))
    original_format = img.format  # exif_transpose 會清掉 format，先存起來
    img = ImageOps.exif_transpose(img)  # 消化 EXIF 方向
    img.format = original_format

    normalized = angle % 360

    # 90° 整數倍走 transpose（無損）
    if normalized == 0:
        rotated = img.copy()
    elif normalized == 90:
        rotated = img.transpose(Image.ROTATE_270)  # PIL ROTATE_270 = 順時針 90
    elif normalized == 180:
        rotated = img.transpose(Image.ROTATE_180)
    elif normalized == 270:
        rotated = img.transpose(Image.ROTATE_90)   # PIL ROTATE_90 = 順時針 270
    else:
        # 任意角度：PIL Image.rotate 是逆時針，所以 angle 取反
        # expand=True 自動撐開避免裁切，fillcolor 白
        rotated = img.rotate(-normalized, resample=Image.BICUBIC,
                              expand=True, fillcolor="white")

    fmt, _ = _resolve_output_format(img, output_format)
    if fmt == "JPEG" and rotated.mode in ("RGBA", "P", "LA"):
        rotated = rotated.convert("RGB")

    buf = io.BytesIO()
    save_kwargs = {}
    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = max(1, min(100, quality))
        save_kwargs["optimize"] = True
    rotated.save(buf, format=fmt, **save_kwargs)
    result = buf.getvalue()
    logger.info("圖片旋轉完成: %d° → %s (%d bytes)", normalized, fmt, len(result))
    return result


def flip_image(image_data: bytes, axis: str = "horizontal",
               output_format: str = "auto", quality: int = 90) -> bytes:
    """翻轉圖片

    Args:
        axis: "horizontal"（左右翻轉，鏡像）| "vertical"（上下翻轉）
        output_format: 同 rotate_image
        quality: JPEG / WEBP 品質

    Returns:
        翻轉後的圖片 bytes
    """
    axis = (axis or "horizontal").lower()
    if axis not in ("horizontal", "vertical", "h", "v"):
        raise ValueError(f"axis 必須是 horizontal 或 vertical，收到：{axis!r}")

    img = Image.open(io.BytesIO(image_data))
    original_format = img.format
    img = ImageOps.exif_transpose(img)
    img.format = original_format

    if axis in ("horizontal", "h"):
        flipped = ImageOps.mirror(img)   # 左右翻轉
    else:
        flipped = ImageOps.flip(img)     # 上下翻轉

    fmt, _ = _resolve_output_format(img, output_format)
    if fmt == "JPEG" and flipped.mode in ("RGBA", "P", "LA"):
        flipped = flipped.convert("RGB")

    buf = io.BytesIO()
    save_kwargs = {}
    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = max(1, min(100, quality))
        save_kwargs["optimize"] = True
    flipped.save(buf, format=fmt, **save_kwargs)
    result = buf.getvalue()
    logger.info("圖片翻轉完成: axis=%s → %s (%d bytes)", axis, fmt, len(result))
    return result
