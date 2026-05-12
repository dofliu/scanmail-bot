"""Filler — 將值寫回 PDF

兩種模式：
1. AcroForm：交給 backends.acroform.fill()
2. Overlay 疊字：用 ReportLab 在 bbox 位置 drawString，再 merge_page 疊到原 PDF
"""
import io
import logging
from typing import Optional

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas

from app.services.form_fill.schema import FormField
from app.services.form_fill.backends import acroform

logger = logging.getLogger(__name__)


def fill_form(
    data: bytes,
    fields: list[FormField],
    values: dict,
    image_dims: Optional[list[tuple[int, int]]] = None,
) -> bytes:
    """把 values 寫入 PDF

    Args:
        data: 原始 PDF bytes
        fields: 偵測到的欄位（決定使用哪個模式）
        values: {field_name: value}
        image_dims: Gemini backend 用 — 每頁渲染時的影像尺寸 (w, h)，
                    用於把 normalized 0~1000 座標換算回 PDF points

    Returns:
        填寫後的 PDF bytes
    """
    if not fields:
        logger.warning("fields 為空，直接回傳原檔")
        return data

    # 判斷模式：第一個欄位的 backend 通常就代表全檔的模式
    if all(f.backend == "acroform" for f in fields):
        return acroform.fill(data, values)

    return _fill_by_overlay(data, fields, values, image_dims)


def _fill_by_overlay(
    data: bytes,
    fields: list[FormField],
    values: dict,
    image_dims: Optional[list[tuple[int, int]]] = None,
) -> bytes:
    """疊字模式：在每個欄位 bbox 左下角 drawString"""
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    # 按頁分組
    by_page: dict[int, list[FormField]] = {}
    for f in fields:
        by_page.setdefault(f.page, []).append(f)

    for page_num, page in enumerate(reader.pages):
        page_fields = by_page.get(page_num, [])
        if page_fields:
            box = page.mediabox
            pw, ph = float(box.width), float(box.height)
            overlay = _make_overlay(page_fields, values, pw, ph, image_dims, page_num)
            if overlay:
                overlay_reader = PdfReader(io.BytesIO(overlay))
                page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _make_overlay(
    fields: list[FormField],
    values: dict,
    page_width: float,
    page_height: float,
    image_dims: Optional[list[tuple[int, int]]],
    page_num: int,
) -> Optional[bytes]:
    """產生一頁 overlay PDF（透明背景 + 欄位文字）"""
    drew_anything = False
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFont("Helvetica", 11)

    for f in fields:
        value = values.get(f.name)
        if not value:
            continue
        if not f.bbox:
            continue

        x0, y0, x1, y1 = f.bbox

        # Gemini backend 給的是 normalized 0~1000 影像座標（原點左上）
        # 換算為 PDF points（原點左下）
        if f.backend == "gemini":
            x0 = (x0 / 1000.0) * page_width
            x1 = (x1 / 1000.0) * page_width
            # y 翻轉：影像 y_down → PDF y_up
            y0_pdf = page_height - (y1 / 1000.0) * page_height
            y0 = y0_pdf

        # 在 bbox 左下角附近寫字（留 2pt 內邊距）
        c.drawString(x0 + 2, y0 + 2, str(value))
        drew_anything = True

    c.save()
    return buf.getvalue() if drew_anything else None
