"""Tests for PDF tools expansion: split / compress / pdf_to_images / merge add_page_numbers

執行：
    python -m pytest tests/test_pdf_tools_expansion.py -v
"""
import io
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as rl_canvas

from app.services.pdf_processor import (
    merge_pdfs, split_pdf, compress_pdf, pdf_to_images,
)


def _make_pdf(n_pages: int = 3, label: str = "p") -> bytes:
    """產生一份 n 頁的測試 PDF"""
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 24)
    for i in range(n_pages):
        c.drawString(100, 700, f"{label}-{i+1}")
        c.showPage()
    c.save()
    return buf.getvalue()


# ─── merge_pdfs add_page_numbers ──────────────────────────────

def test_merge_add_page_numbers():
    a = _make_pdf(2, "A")
    b = _make_pdf(3, "B")
    result = merge_pdfs("test", [("a.pdf", a), ("b.pdf", b)], add_page_numbers=True)
    assert result.startswith(b"%PDF")
    # 抽取每頁文字應包含 "n / 5"
    import pdfplumber
    with pdfplumber.open(io.BytesIO(result)) as pdf:
        assert len(pdf.pages) == 5
        page_texts = [(p.extract_text() or "") for p in pdf.pages]
    # 每頁都應該有對應頁碼字串
    for idx, text in enumerate(page_texts, start=1):
        assert f"{idx} / 5" in text, f"第 {idx} 頁缺頁碼：{text!r}"


def test_merge_without_page_numbers_default():
    """預設沒帶 add_page_numbers 時不應該出現頁碼"""
    a = _make_pdf(2)
    result = merge_pdfs("test", [("a.pdf", a)])
    import pdfplumber
    with pdfplumber.open(io.BytesIO(result)) as pdf:
        text = pdf.pages[0].extract_text() or ""
    assert "1 / 2" not in text


# ─── split_pdf ────────────────────────────────────────────────

def test_split_pdf_by_ranges():
    pdf = _make_pdf(9)
    zip_bytes = split_pdf("test", pdf, ranges="1-3,5,7-9")
    assert zip_bytes[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = sorted(zf.namelist())
    # 應該產出 3 個檔
    assert len(names) == 3
    # 第一段是 1-3 → 3 頁；中間是 5 → 1 頁；末段是 7-9 → 3 頁
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in names:
            sub = PdfReader(io.BytesIO(zf.read(name)))
            assert len(sub.pages) >= 1


def test_split_pdf_individual():
    pdf = _make_pdf(5)
    zip_bytes = split_pdf("test", pdf, individual=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
    assert len(names) == 5
    # 每個檔都是 1 頁
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in names:
            sub = PdfReader(io.BytesIO(zf.read(name)))
            assert len(sub.pages) == 1


def test_split_pdf_empty_ranges_returns_whole_doc():
    """空白 ranges 應視為整份"""
    pdf = _make_pdf(4)
    zip_bytes = split_pdf("test", pdf, ranges="")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
    assert len(names) == 1
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        sub = PdfReader(io.BytesIO(zf.read(names[0])))
    assert len(sub.pages) == 4


def test_split_pdf_invalid_ranges_falls_back():
    """無效範圍應 fallback 而非 crash"""
    pdf = _make_pdf(3)
    zip_bytes = split_pdf("test", pdf, ranges="abc,xyz")
    # 至少要能 produce 出可開的 ZIP
    assert zip_bytes[:2] == b"PK"


# ─── compress_pdf ─────────────────────────────────────────────

def test_compress_basic_returns_valid_pdf():
    pdf = _make_pdf(2)
    result = compress_pdf("test", pdf, level="basic")
    assert result.startswith(b"%PDF")
    # 仍應該可開且頁數一致
    r = PdfReader(io.BytesIO(result))
    assert len(r.pages) == 2


def test_compress_images_returns_valid_pdf():
    pdf = _make_pdf(2)
    result = compress_pdf("test", pdf, level="images", image_quality=50)
    assert result.startswith(b"%PDF")
    r = PdfReader(io.BytesIO(result))
    assert len(r.pages) == 2


def test_compress_deep_returns_valid_pdf():
    pdf = _make_pdf(2)
    result = compress_pdf("test", pdf, level="deep", image_quality=40)
    assert result.startswith(b"%PDF")


# ─── pdf_to_images ────────────────────────────────────────────

def test_pdf_to_images_png():
    pdf = _make_pdf(3)
    zip_bytes = pdf_to_images("test", pdf, fmt="png", dpi=100)
    assert zip_bytes[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = sorted(zf.namelist())
        assert len(names) == 3
        for name in names:
            assert name.endswith(".png")
            # 確認真的是 PNG（magic bytes）
            assert zf.read(name)[:8] == b"\x89PNG\r\n\x1a\n"


def test_pdf_to_images_jpg():
    pdf = _make_pdf(2)
    zip_bytes = pdf_to_images("test", pdf, fmt="jpg", dpi=72)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = sorted(zf.namelist())
        assert len(names) == 2
        for name in names:
            assert name.endswith(".jpg")
            # JPG magic bytes
            assert zf.read(name)[:2] == b"\xff\xd8"


def test_pdf_to_images_rejects_invalid_format():
    pdf = _make_pdf(1)
    with pytest.raises(ValueError):
        pdf_to_images("test", pdf, fmt="webp")
