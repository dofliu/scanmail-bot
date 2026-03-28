"""PDF 處理 — 合併、浮水印、密碼保護

從 myPicasa (MediaToolkit) 移植並改為 Web 服務化的純函式介面。
"""
import io
import logging
from pathlib import Path
from typing import Optional

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import Color

from app.core.tasks import update_task_progress

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# 1. PDF 合併
# ══════════════════════════════════════════════════════════════

def merge_pdfs(task_id: str, pdfs: list[tuple[str, bytes]],
               order: Optional[list[int]] = None,
               add_toc: bool = False) -> bytes:
    """合併多個 PDF 為一份

    Args:
        pdfs: [(filename, bytes), ...]
        order: 自訂順序索引（None = 按原順序）
        add_toc: 是否加入書籤目錄

    Returns:
        合併後的 PDF bytes
    """
    if not pdfs:
        raise ValueError("至少需要一個 PDF 檔案")

    # 套用順序
    if order:
        pdfs = [pdfs[i] for i in order if 0 <= i < len(pdfs)]

    writer = PdfWriter()
    total = len(pdfs)
    page_offset = 0

    for i, (name, data) in enumerate(pdfs):
        update_task_progress(task_id, int((i / total) * 90), f"合併中 ({i+1}/{total}): {name}")
        try:
            reader = PdfReader(io.BytesIO(data))
            # 加入書籤
            if add_toc:
                stem = Path(name).stem
                writer.add_outline_item(stem, page_offset)

            for page in reader.pages:
                writer.add_page(page)
            page_offset += len(reader.pages)
        except Exception as e:
            logger.warning("合併 %s 失敗: %s", name, e)

    update_task_progress(task_id, 95, "正在產生 PDF...")
    buf = io.BytesIO()
    writer.write(buf)
    result = buf.getvalue()
    logger.info("PDF 合併完成: %d 個檔案, %d 頁, %d bytes", total, page_offset, len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 2. PDF 浮水印
# ══════════════════════════════════════════════════════════════

def _create_text_watermark_page(text: str, page_width: float, page_height: float,
                                 font_size: int = 48, opacity: float = 0.15,
                                 rotation: int = 45, color: tuple = (0, 0, 0)) -> bytes:
    """用 ReportLab 產生一頁文字浮水印 PDF"""
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_width, page_height))

    c.saveState()
    r, g, b = [v / 255.0 for v in color] if max(color) > 1 else color
    c.setFillColor(Color(r, g, b, alpha=opacity))
    c.setFont("Helvetica", font_size)

    # 平鋪浮水印
    import math
    text_width = c.stringWidth(text, "Helvetica", font_size)
    step_x = text_width + 100
    step_y = font_size + 80

    for y in range(-int(page_height), int(page_height * 2), int(step_y)):
        for x in range(-int(page_width), int(page_width * 2), int(step_x)):
            c.saveState()
            c.translate(x, y)
            c.rotate(rotation)
            c.drawString(0, 0, text)
            c.restoreState()

    c.restoreState()
    c.save()
    return buf.getvalue()


def add_text_watermark_to_pdf(data: bytes, text: str,
                               font_size: int = 48, opacity: float = 0.15,
                               rotation: int = 45,
                               color: tuple = (0, 0, 0)) -> bytes:
    """對 PDF 每一頁加上文字浮水印"""
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    for page in reader.pages:
        box = page.mediabox
        pw = float(box.width)
        ph = float(box.height)

        wm_bytes = _create_text_watermark_page(text, pw, ph, font_size, opacity, rotation, color)
        wm_reader = PdfReader(io.BytesIO(wm_bytes))
        wm_page = wm_reader.pages[0]

        page.merge_page(wm_page)
        writer.add_page(page)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def add_image_watermark_to_pdf(data: bytes, image_data: bytes,
                                opacity: float = 0.3,
                                scale: float = 0.4,
                                position: str = "center") -> bytes:
    """對 PDF 每一頁加上圖片浮水印"""
    from PIL import Image
    img = Image.open(io.BytesIO(image_data))
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    for page in reader.pages:
        box = page.mediabox
        pw = float(box.width)
        ph = float(box.height)

        # 計算浮水印尺寸
        wm_w = int(pw * scale)
        wm_h = int(img.height * (wm_w / img.width))

        # 調整透明度
        img_resized = img.resize((wm_w, wm_h), Image.LANCZOS)
        alpha = img_resized.getchannel("A")
        alpha = alpha.point(lambda a: int(a * opacity))
        img_resized.putalpha(alpha)

        # 轉為 PDF 頁面
        img_buf = io.BytesIO()
        img_rgb = Image.new("RGBA", (int(pw), int(ph)), (255, 255, 255, 0))
        # 計算位置
        if position == "center":
            x, y = (int(pw) - wm_w) // 2, (int(ph) - wm_h) // 2
        elif position == "top-left":
            x, y = 20, 20
        elif position == "bottom-right":
            x, y = int(pw) - wm_w - 20, int(ph) - wm_h - 20
        else:
            x, y = (int(pw) - wm_w) // 2, (int(ph) - wm_h) // 2

        img_rgb.paste(img_resized, (x, y), img_resized)
        img_rgb_converted = img_rgb.convert("RGB")
        img_rgb_converted.save(img_buf, format="PDF")
        img_buf.seek(0)

        wm_reader = PdfReader(img_buf)
        page.merge_page(wm_reader.pages[0])
        writer.add_page(page)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


# ══════════════════════════════════════════════════════════════
# 3. PDF 密碼保護
# ══════════════════════════════════════════════════════════════

def protect_pdf(data: bytes, password: str) -> bytes:
    """為 PDF 加上密碼保護"""
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    for page in reader.pages:
        writer.add_page(page)

    writer.encrypt(password)

    buf = io.BytesIO()
    writer.write(buf)
    result = buf.getvalue()
    logger.info("PDF 加密完成: %d bytes", len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 4. PDF 資訊
# ══════════════════════════════════════════════════════════════

def get_pdf_info(data: bytes) -> dict:
    """取得 PDF 基本資訊"""
    try:
        reader = PdfReader(io.BytesIO(data))
        meta = reader.metadata
        return {
            "pages": len(reader.pages),
            "encrypted": reader.is_encrypted,
            "title": str(meta.title) if meta and meta.title else None,
            "author": str(meta.author) if meta and meta.author else None,
            "size_bytes": len(data),
        }
    except Exception as e:
        return {"error": str(e)}
