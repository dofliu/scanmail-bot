"""Filler — 將值寫回 PDF

兩種模式：
1. AcroForm：交給 backends.acroform.fill()
2. Overlay 疊字：用 ReportLab 在 bbox 位置 drawString，再 merge_page 疊到原 PDF

座標契約：FormField.bbox 一律是 PDF points（origin bottom-left）。
各 backend 在 detect 階段就完成座標換算，filler 不做任何 backend 分支。
"""
import io
import logging

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas as rl_canvas

from app.services.form_fill.schema import FormField, Backend
from app.services.form_fill.backends import acroform

logger = logging.getLogger(__name__)


def _overlay_font() -> str:
    """取得 overlay 用的字型名稱（CJK 優先，否則 Helvetica）"""
    try:
        from app.services.doc_converter import ensure_cjk_font
        return ensure_cjk_font()
    except Exception:
        return "Helvetica"


def fill_form(
    data: bytes,
    fields: list[FormField],
    values: dict,
) -> bytes:
    """把 values 寫入 PDF

    Args:
        data: PDF bytes（已透過 dispatcher.normalize_to_pdf 統一格式）
        fields: 偵測到的欄位
        values: {field_name: value}

    Returns:
        填寫後的 PDF bytes
    """
    if not fields:
        logger.warning("fields 為空，直接回傳原檔")
        return data

    # 全部 AcroForm 欄位 → 走原生欄位寫入
    if all(f.backend == Backend.ACROFORM for f in fields):
        return acroform.fill(data, values)

    return _fill_by_overlay(data, fields, values)


def _fill_by_overlay(
    data: bytes,
    fields: list[FormField],
    values: dict,
) -> bytes:
    """疊字模式：在每個欄位 bbox 左下角 drawString"""
    reader = PdfReader(io.BytesIO(data))
    # clone_from 讓 page.merge_page() 的 replace_contents 行為有 writer attached
    # （pypdf 6+ 對未 attach 的 page 呼叫 merge_page 會發 DeprecationWarning）
    writer = PdfWriter(clone_from=reader)

    by_page: dict[int, list[FormField]] = {}
    for f in fields:
        by_page.setdefault(f.page, []).append(f)

    for page_num, page in enumerate(writer.pages):
        page_fields = by_page.get(page_num, [])
        if not page_fields:
            continue
        box = page.mediabox
        pw, ph = float(box.width), float(box.height)
        overlay = _make_overlay(page_fields, values, pw, ph)
        if overlay:
            overlay_reader = PdfReader(io.BytesIO(overlay))
            page.merge_page(overlay_reader.pages[0])

    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _make_overlay(
    fields: list[FormField],
    values: dict,
    page_width: float,
    page_height: float,
) -> bytes | None:
    """產生一頁 overlay PDF（透明背景 + 欄位文字）"""
    drew_anything = False
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFont(_overlay_font(), 11)

    for f in fields:
        value = values.get(f.name)
        if not value:
            continue
        if not f.bbox:
            continue

        x0, y0, _x1, _y1 = f.bbox
        # bbox 已是 PDF points（origin bottom-left）— 直接在左下角 +2pt 內邊距寫字
        c.drawString(x0 + 2, y0 + 2, str(value))
        drew_anything = True

    c.save()
    return buf.getvalue() if drew_anything else None
