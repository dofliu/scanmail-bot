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
               add_toc: bool = False,
               add_page_numbers: bool = False) -> bytes:
    """合併多個 PDF 為一份

    Args:
        pdfs: [(filename, bytes), ...]
        order: 自訂順序索引（None = 按原順序）
        add_toc: 是否加入書籤目錄
        add_page_numbers: 是否在每頁底部加上頁碼

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

    # 加頁碼（疊在每頁底部中央）
    if add_page_numbers and page_offset > 0:
        update_task_progress(task_id, 92, "加上頁碼...")
        _stamp_page_numbers(writer, page_offset)

    update_task_progress(task_id, 95, "正在產生 PDF...")
    buf = io.BytesIO()
    writer.write(buf)
    result = buf.getvalue()
    logger.info("PDF 合併完成: %d 個檔案, %d 頁, %d bytes（toc=%s, page_num=%s）",
                total, page_offset, len(result), add_toc, add_page_numbers)
    return result


def _stamp_page_numbers(writer: PdfWriter, total_pages: int) -> None:
    """在 writer 已加入的每一頁底部中央疊頁碼 (1/N, 2/N, ...)"""
    for idx, page in enumerate(writer.pages, start=1):
        box = page.mediabox
        pw, ph = float(box.width), float(box.height)
        overlay = _make_page_number_overlay(idx, total_pages, pw, ph)
        overlay_reader = PdfReader(io.BytesIO(overlay))
        page.merge_page(overlay_reader.pages[0])


def _make_page_number_overlay(idx: int, total: int,
                               page_width: float, page_height: float) -> bytes:
    """產生一頁帶頁碼文字的 overlay PDF（透明背景）"""
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFont("Helvetica", 10)
    text = f"{idx} / {total}"
    text_w = c.stringWidth(text, "Helvetica", 10)
    c.drawString((page_width - text_w) / 2, 20, text)
    c.save()
    return buf.getvalue()


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


# ══════════════════════════════════════════════════════════════
# 5. PDF 分割
# ══════════════════════════════════════════════════════════════

def _parse_page_ranges(ranges: str, total_pages: int) -> list[list[int]]:
    """解析使用者輸入的頁面範圍字串，回傳每段的 0-based page index 清單

    例如：
        "1-3,5,7-9" → [[0,1,2], [4], [6,7,8]]
        " "         → 整份視為一段

    超出範圍的頁會被自動忽略。
    """
    ranges = (ranges or "").strip()
    if not ranges:
        return [list(range(total_pages))]

    groups: list[list[int]] = []
    for part in ranges.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                start = max(1, int(a.strip()))
                end = min(total_pages, int(b.strip()))
            except ValueError:
                continue
            if end >= start:
                groups.append([p - 1 for p in range(start, end + 1)])
        else:
            try:
                idx = int(part)
            except ValueError:
                continue
            if 1 <= idx <= total_pages:
                groups.append([idx - 1])
    return groups or [list(range(total_pages))]


def split_pdf(task_id: str, data: bytes, ranges: str = "",
              individual: bool = False) -> bytes:
    """分割 PDF — 依範圍切成多份，打包為 ZIP

    Args:
        data: 原始 PDF bytes
        ranges: 頁面範圍字串，例如 "1-3,5,7-9"（空字串時看 individual）
        individual: True = 每頁拆成獨立 PDF；忽略 ranges

    Returns:
        ZIP bytes（內含多份 PDF）
    """
    import zipfile

    reader = PdfReader(io.BytesIO(data))
    total = len(reader.pages)

    if individual:
        groups = [[i] for i in range(total)]
    else:
        groups = _parse_page_ranges(ranges, total)

    update_task_progress(task_id, 5, f"切分為 {len(groups)} 段...")

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for gi, group in enumerate(groups):
            update_task_progress(
                task_id, 10 + int((gi / max(1, len(groups))) * 80),
                f"輸出第 {gi+1}/{len(groups)} 份"
            )
            writer = PdfWriter()
            for page_idx in group:
                writer.add_page(reader.pages[page_idx])
            sub_buf = io.BytesIO()
            writer.write(sub_buf)

            if individual:
                fname = f"page_{group[0]+1:03d}.pdf"
            else:
                first, last = group[0] + 1, group[-1] + 1
                fname = f"part_{first:03d}-{last:03d}.pdf" if first != last else f"page_{first:03d}.pdf"
            zf.writestr(fname, sub_buf.getvalue())

    update_task_progress(task_id, 95, "打包 ZIP...")
    result = zip_buf.getvalue()
    logger.info("PDF 分割完成: %d 頁 → %d 份, %d bytes",
                total, len(groups), len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 6. PDF 壓縮
# ══════════════════════════════════════════════════════════════

def compress_pdf(task_id: str, data: bytes, level: str = "basic",
                 image_quality: int = 60) -> bytes:
    """壓縮 PDF（3 個強度）

    Args:
        level:
          - "basic"  → pypdf compress_content_streams（無損，僅壓縮 content stream）
          - "images" → pymupdf 重存 + 壓縮影像（image_quality 控制 JPEG 品質）
          - "deep"   → images + 最高 garbage collection
        image_quality: 1–95，level=images/deep 時生效

    Returns:
        壓縮後的 PDF bytes
    """
    update_task_progress(task_id, 10, f"壓縮模式: {level}")
    if level == "basic":
        return _compress_basic(task_id, data)
    return _compress_with_mupdf(task_id, data, image_quality, deep=(level == "deep"))


def _compress_basic(task_id: str, data: bytes) -> bytes:
    """無損壓縮：對每頁呼叫 compress_content_streams"""
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter(clone_from=reader)
    total = len(writer.pages)
    for i, page in enumerate(writer.pages):
        update_task_progress(task_id, 10 + int((i / max(1, total)) * 80), f"壓縮第 {i+1}/{total} 頁")
        try:
            page.compress_content_streams()
        except Exception as e:
            logger.warning("page %d compress_content_streams failed: %s", i, e)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _compress_with_mupdf(task_id: str, data: bytes, image_quality: int, deep: bool) -> bytes:
    """有損壓縮：用 pymupdf 重新嵌入影像 + 加 deflate"""
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        total = len(doc)
        # 處理影像：把每張嵌入影像 downsample
        for pi, page in enumerate(doc):
            update_task_progress(task_id, 10 + int((pi / max(1, total)) * 70),
                                 f"壓縮影像 {pi+1}/{total}")
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                try:
                    base = doc.extract_image(xref)
                    pil_img = _shrink_image(base.get("image", b""), image_quality, deep=deep)
                    if pil_img:
                        doc.update_stream(xref, pil_img, new=True)
                except Exception as e:
                    logger.debug("image xref=%s skip: %s", xref, e)

        update_task_progress(task_id, 85, "重新打包 PDF...")
        buf = io.BytesIO()
        # deflate + garbage collection
        save_kwargs = {"deflate": True, "garbage": 4 if deep else 3}
        if deep:
            save_kwargs["clean"] = True
        doc.save(buf, **save_kwargs)
        return buf.getvalue()
    finally:
        doc.close()


def _shrink_image(image_bytes: bytes, quality: int, deep: bool) -> Optional[bytes]:
    """把單張影像 bytes 重新編碼為較小的 JPEG"""
    if not image_bytes:
        return None
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        # deep 模式：限制最大邊長 1600px
        if deep:
            max_dim = 1600
            if max(img.size) > max_dim:
                ratio = max_dim / max(img.size)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=max(1, min(95, quality)), optimize=True)
        return out.getvalue()
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════
# 7. PDF → 影像
# ══════════════════════════════════════════════════════════════

def pdf_to_images(task_id: str, data: bytes, fmt: str = "png", dpi: int = 150) -> bytes:
    """把 PDF 每頁渲染為影像，打包成 ZIP

    Args:
        data: PDF bytes
        fmt: "png" | "jpg" / "jpeg"
        dpi: 渲染解析度

    Returns:
        ZIP bytes
    """
    import zipfile
    import fitz

    fmt = fmt.lower()
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in ("png", "jpg"):
        raise ValueError(f"不支援的格式：{fmt}")

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        total = len(doc)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for i, page in enumerate(doc):
                update_task_progress(task_id, int((i / max(1, total)) * 90),
                                     f"渲染第 {i+1}/{total} 頁")
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                if fmt == "png":
                    img_bytes = pix.tobytes("png")
                else:
                    img_bytes = pix.tobytes("jpeg", jpg_quality=90)
                zf.writestr(f"page_{i+1:03d}.{fmt}", img_bytes)

        update_task_progress(task_id, 95, "打包 ZIP...")
        result = zip_buf.getvalue()
        logger.info("PDF → 影像完成: %d 頁 (%s @ %ddpi), %d bytes",
                    total, fmt, dpi, len(result))
        return result
    finally:
        doc.close()
