"""圖片批次處理 — 縮放、格式轉換、壓縮、浮水印

從 myPicasa (MediaToolkit) 移植並改為 Web 服務化的純函式介面。
所有函式接受 bytes 輸入，回傳 bytes 輸出。
"""
import io
import logging
import zipfile
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.core.tasks import update_task_progress

logger = logging.getLogger(__name__)

# 支援的格式
SUPPORTED_FORMATS = {"jpg", "jpeg", "png", "webp", "bmp", "gif"}
FORMAT_MAP = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "bmp": "BMP", "gif": "GIF"}


def _open_image(data: bytes) -> Image.Image:
    """開啟圖片並自動旋轉"""
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img


def _save_image(img: Image.Image, fmt: str = "JPEG", quality: int = 85) -> bytes:
    """儲存圖片為 bytes"""
    if fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")
    elif fmt == "PNG" and img.mode == "CMYK":
        img = img.convert("RGB")
    buf = io.BytesIO()
    save_kwargs = {"format": fmt, "optimize": True}
    if fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
    img.save(buf, **save_kwargs)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════
# 1. 縮放
# ══════════════════════════════════════════════════════════════

def resize_image(data: bytes, width: int, height: int,
                 mode: str = "fit", bg_color: str = "#ffffff",
                 output_format: str = "JPEG", quality: int = 85) -> bytes:
    """縮放單張圖片

    Args:
        mode: "fit" (等比縮放填入白底), "cover" (等比裁切填滿), "stretch" (拉伸)
    """
    img = _open_image(data)

    if mode == "fit":
        img.thumbnail((width, height), Image.LANCZOS)
        canvas = Image.new("RGB", (width, height), bg_color)
        x = (width - img.size[0]) // 2
        y = (height - img.size[1]) // 2
        if img.mode == "RGBA":
            canvas.paste(img, (x, y), img)
        else:
            canvas.paste(img, (x, y))
        img = canvas
    elif mode == "cover":
        ratio_w = width / img.width
        ratio_h = height / img.height
        ratio = max(ratio_w, ratio_h)
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - width) // 2
        top = (new_h - height) // 2
        img = img.crop((left, top, left + width, top + height))
    elif mode == "stretch":
        img = img.resize((width, height), Image.LANCZOS)

    return _save_image(img, output_format, quality)


def batch_resize(task_id: str, images: list[tuple[str, bytes]],
                 width: int, height: int, mode: str = "fit",
                 bg_color: str = "#ffffff", output_format: str = "JPEG",
                 quality: int = 85) -> bytes:
    """批次縮放，回傳 ZIP bytes"""
    return _batch_process(
        task_id, images, "縮放",
        lambda name, data: resize_image(data, width, height, mode, bg_color, output_format, quality),
        _get_ext(output_format),
    )


# ══════════════════════════════════════════════════════════════
# 2. 格式轉換
# ══════════════════════════════════════════════════════════════

def convert_format(data: bytes, target_format: str = "JPEG",
                   quality: int = 85) -> bytes:
    """轉換單張圖片格式"""
    img = _open_image(data)
    return _save_image(img, target_format, quality)


def batch_convert(task_id: str, images: list[tuple[str, bytes]],
                  target_format: str = "JPEG", quality: int = 85) -> bytes:
    """批次轉換格式，回傳 ZIP bytes"""
    return _batch_process(
        task_id, images, "轉檔",
        lambda name, data: convert_format(data, target_format, quality),
        _get_ext(target_format),
    )


# ══════════════════════════════════════════════════════════════
# 3. 壓縮
# ══════════════════════════════════════════════════════════════

def compress_image(data: bytes, quality: int = 70,
                   max_dimension: int = 0) -> bytes:
    """壓縮單張圖片

    Args:
        quality: JPEG 品質 (1-100)
        max_dimension: 最大邊長（0 = 不限）
    """
    img = _open_image(data)
    if max_dimension > 0:
        img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
    return _save_image(img, "JPEG", quality)


def batch_compress(task_id: str, images: list[tuple[str, bytes]],
                   quality: int = 70, max_dimension: int = 0) -> bytes:
    """批次壓縮，回傳 ZIP bytes"""
    return _batch_process(
        task_id, images, "壓縮",
        lambda name, data: compress_image(data, quality, max_dimension),
        ".jpg",
    )


# ══════════════════════════════════════════════════════════════
# 4. 浮水印
# ══════════════════════════════════════════════════════════════

def add_text_watermark(data: bytes, text: str,
                       font_size: int = 36, opacity: int = 80,
                       position: str = "center",
                       color: str = "#000000") -> bytes:
    """加文字浮水印

    Args:
        position: "center", "top-left", "top-right", "bottom-left", "bottom-right", "tile"
    """
    img = _open_image(data)
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # 建立透明浮水印圖層
    watermark = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(watermark)

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
    except (OSError, IOError):
        font = ImageFont.load_default()

    # 計算文字尺寸
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    # 解析顏色 + 透明度
    r, g, b = _hex_to_rgb(color)
    alpha = int(opacity * 255 / 100)
    fill = (r, g, b, alpha)

    if position == "tile":
        # 平鋪浮水印
        for y in range(0, img.height, th + 80):
            for x in range(0, img.width, tw + 80):
                draw.text((x, y), text, font=font, fill=fill)
    else:
        # 單一位置
        x, y = _calc_position(position, img.width, img.height, tw, th)
        draw.text((x, y), text, font=font, fill=fill)

    result = Image.alpha_composite(img, watermark)
    return _save_image(result.convert("RGB"), "JPEG", 90)


def add_image_watermark(data: bytes, watermark_data: bytes,
                        opacity: int = 50, position: str = "center",
                        scale: float = 0.3) -> bytes:
    """加圖片浮水印"""
    img = _open_image(data)
    wm = _open_image(watermark_data)

    # 縮放浮水印
    max_wm_w = int(img.width * scale)
    max_wm_h = int(img.height * scale)
    wm.thumbnail((max_wm_w, max_wm_h), Image.LANCZOS)

    if wm.mode != "RGBA":
        wm = wm.convert("RGBA")

    # 調整透明度
    alpha = wm.getchannel("A")
    alpha = alpha.point(lambda a: int(a * opacity / 100))
    wm.putalpha(alpha)

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    x, y = _calc_position(position, img.width, img.height, wm.width, wm.height)
    img.paste(wm, (x, y), wm)

    return _save_image(img.convert("RGB"), "JPEG", 90)


def batch_watermark(task_id: str, images: list[tuple[str, bytes]],
                    text: str = "", font_size: int = 36,
                    opacity: int = 80, position: str = "center",
                    color: str = "#000000") -> bytes:
    """批次加文字浮水印，回傳 ZIP bytes"""
    return _batch_process(
        task_id, images, "浮水印",
        lambda name, data: add_text_watermark(data, text, font_size, opacity, position, color),
        ".jpg",
    )


# ══════════════════════════════════════════════════════════════
# 共用工具
# ══════════════════════════════════════════════════════════════

def _batch_process(task_id: str, images: list[tuple[str, bytes]],
                   action_name: str,
                   process_fn, output_ext: str) -> bytes:
    """批次處理共用邏輯，回傳 ZIP bytes

    Args:
        images: [(filename, bytes), ...]
        process_fn: fn(filename, bytes) -> bytes
        output_ext: 輸出副檔名 (e.g. ".jpg")
    """
    total = len(images)
    zip_buf = io.BytesIO()

    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, (name, data) in enumerate(images):
            update_task_progress(
                task_id,
                int((i / total) * 95),
                f"{action_name}中 ({i+1}/{total}): {name}",
            )
            try:
                result = process_fn(name, data)
                stem = Path(name).stem
                zf.writestr(f"{stem}{output_ext}", result)
            except Exception as e:
                logger.warning("處理 %s 失敗: %s", name, e)
                # 跳過失敗的檔案

    update_task_progress(task_id, 98, "正在打包 ZIP...")
    return zip_buf.getvalue()


def get_image_info_detail(data: bytes) -> dict:
    """取得圖片詳細資訊"""
    try:
        img = Image.open(io.BytesIO(data))
        return {
            "width": img.width,
            "height": img.height,
            "format": img.format or "unknown",
            "mode": img.mode,
            "size_bytes": len(data),
        }
    except Exception as e:
        return {"error": str(e)}


def _get_ext(fmt: str) -> str:
    """格式名 → 副檔名"""
    ext_map = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "BMP": ".bmp", "GIF": ".gif"}
    return ext_map.get(fmt, ".jpg")


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """#ffffff → (255, 255, 255)"""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _calc_position(position: str, canvas_w: int, canvas_h: int,
                   item_w: int, item_h: int) -> tuple[int, int]:
    """計算浮水印位置"""
    margin = 20
    positions = {
        "center": ((canvas_w - item_w) // 2, (canvas_h - item_h) // 2),
        "top-left": (margin, margin),
        "top-right": (canvas_w - item_w - margin, margin),
        "bottom-left": (margin, canvas_h - item_h - margin),
        "bottom-right": (canvas_w - item_w - margin, canvas_h - item_h - margin),
    }
    return positions.get(position, positions["center"])
