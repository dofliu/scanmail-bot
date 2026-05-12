"""Tests for doc_converter.pdf_to_markdown

執行：
    python -m pytest tests/test_pdf_to_markdown.py -v
"""
import io
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.services.doc_converter import pdf_to_markdown


def _build_sample_pdf() -> bytes:
    """產生一份有 H1 / H2 / 內文 + 中文的測試 PDF"""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas
    from app.services.doc_converter import _register_cjk_font, _get_available_font

    _register_cjk_font()
    font = _get_available_font()

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4

    # H1（最大字級）
    c.setFont(font, 22)
    c.drawString(50, h - 60, "Project Report")
    # H2
    c.setFont(font, 16)
    c.drawString(50, h - 110, "Section 1: Overview")
    # body
    c.setFont(font, 11)
    c.drawString(50, h - 140, "This is the first paragraph.")
    c.drawString(50, h - 160, "Continues here with more details.")
    # H2 again
    c.setFont(font, 16)
    c.drawString(50, h - 200, "中文段落示例")
    # body 中文
    c.setFont(font, 11)
    c.drawString(50, h - 230, "這是中文內文，用來驗證字型抽取與 markdown 輸出。")

    c.save()
    return buf.getvalue()


def test_pdf_to_markdown_returns_string():
    pdf = _build_sample_pdf()
    md = pdf_to_markdown(pdf)
    assert isinstance(md, str)
    assert len(md) > 0


def test_pdf_to_markdown_detects_h1():
    pdf = _build_sample_pdf()
    md = pdf_to_markdown(pdf)
    # 22pt 應被視為最高層級，產生 # 標題
    assert "# Project Report" in md, f"預期 H1 出現，實際輸出：\n{md}"


def test_pdf_to_markdown_detects_h2():
    pdf = _build_sample_pdf()
    md = pdf_to_markdown(pdf)
    # 16pt 應為 H2
    assert "## Section 1: Overview" in md, f"預期 H2 出現，實際輸出：\n{md}"


def test_pdf_to_markdown_preserves_body_text():
    pdf = _build_sample_pdf()
    md = pdf_to_markdown(pdf)
    assert "This is the first paragraph." in md
    assert "Continues here with more details." in md


def test_pdf_to_markdown_preserves_cjk():
    pdf = _build_sample_pdf()
    md = pdf_to_markdown(pdf)
    assert "中文段落示例" in md or "中文" in md, f"中文內容遺失，輸出：\n{md}"
    assert "這是中文內文" in md


def test_pdf_to_markdown_empty_pdf_does_not_crash():
    """完全空白的 PDF 應該回空字串或極短輸出，不該 raise"""
    from reportlab.pdfgen import canvas as rl_canvas
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf)
    c.showPage()
    c.save()
    md = pdf_to_markdown(buf.getvalue())
    assert isinstance(md, str)


def test_pdf_to_markdown_multipage():
    """多頁 PDF 內文都應該出現"""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 11)
    c.drawString(50, 700, "Page one content")
    c.showPage()
    c.drawString(50, 700, "Page two content")
    c.save()
    md = pdf_to_markdown(buf.getvalue())
    assert "Page one content" in md
    assert "Page two content" in md
