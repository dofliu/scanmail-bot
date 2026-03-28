"""GIF 製作 — 圖片序列轉動畫 GIF

從 myPicasa GifCreationWorker 移植。
"""
import io
import logging
from typing import Optional

from PIL import Image, ImageOps

from app.core.tasks import update_task_progress

logger = logging.getLogger(__name__)


def create_gif_from_images(task_id: str, images: list[tuple[str, bytes]],
                           duration_ms: int = 500,
                           loop: int = 0,
                           resize_width: int = 0,
                           resize_height: int = 0,
                           resize_mode: str = "fit") -> bytes:
    """從圖片序列建立動畫 GIF

    Args:
        images: [(filename, bytes), ...] 按順序
        duration_ms: 每幀顯示毫秒數
        loop: 迴圈次數（0 = 無限）
        resize_width/height: 統一尺寸（0 = 使用第一張圖的尺寸）
        resize_mode: "fit" (等比白底), "cover" (裁切), "stretch"

    Returns:
        GIF bytes
    """
    if not images:
        raise ValueError("至少需要一張圖片")

    total = len(images)
    frames = []

    # 決定輸出尺寸
    first_img = Image.open(io.BytesIO(images[0][1]))
    first_img = ImageOps.exif_transpose(first_img)
    target_w = resize_width or first_img.width
    target_h = resize_height or first_img.height

    for i, (name, data) in enumerate(images):
        update_task_progress(task_id, int((i / total) * 90),
                             f"處理幀 ({i+1}/{total}): {name}")
        try:
            img = Image.open(io.BytesIO(data))
            img = ImageOps.exif_transpose(img)

            # 統一尺寸
            img = _resize_frame(img, target_w, target_h, resize_mode)

            # 轉為 RGBA（GIF 需要）
            if img.mode != "RGBA":
                img = img.convert("RGBA")

            frames.append(img)
        except Exception as e:
            logger.warning("處理幀 %s 失敗: %s", name, e)

    if not frames:
        raise ValueError("沒有有效的圖片幀")

    update_task_progress(task_id, 95, "正在產生 GIF...")

    # 第一幀為基底，其餘 append
    buf = io.BytesIO()
    frames[0].save(
        buf, format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=loop,
        optimize=True,
        disposal=2,  # 每幀清除前一幀
    )

    result = buf.getvalue()
    logger.info("GIF 建立完成: %d 幀, %dx%d, %d bytes",
                len(frames), target_w, target_h, len(result))
    return result


def _resize_frame(img: Image.Image, width: int, height: int,
                  mode: str = "fit") -> Image.Image:
    """將圖片調整為指定尺寸"""
    if img.width == width and img.height == height:
        return img

    if mode == "fit":
        img.thumbnail((width, height), Image.LANCZOS)
        canvas = Image.new("RGBA", (width, height), (255, 255, 255, 255))
        x = (width - img.width) // 2
        y = (height - img.height) // 2
        canvas.paste(img, (x, y), img if img.mode == "RGBA" else None)
        return canvas
    elif mode == "cover":
        ratio = max(width / img.width, height / img.height)
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        left = (new_w - width) // 2
        top = (new_h - height) // 2
        return img.crop((left, top, left + width, top + height))
    else:  # stretch
        return img.resize((width, height), Image.LANCZOS)
