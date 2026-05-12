"""Auto Form Fill — pytest-friendly 測試（純 assert，無 print）

需要 fixtures 已產生（`python tests/generate_test_forms.py`）。

執行：
    python -m pytest tests/test_form_fill.py -v
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.services.form_fill import (
    detect_fields, normalize_to_pdf, fill_form, suggest_values,
)
from app.services.form_fill.schema import Backend
from app.services.form_fill.backends import acroform, pdfplumber_extract

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "forms"

SAMPLE_SENDER = {
    "name": "王小明",
    "title": "副教授",
    "department": "電機工程系",
    "organization": "國立勤益科技大學",
    "email": "wang@ncut.edu.tw",
}


def _load(name: str) -> bytes:
    path = FIXTURE_DIR / name
    if not path.exists():
        pytest.skip(f"fixture not found: {path}（請先 `python tests/generate_test_forms.py`）")
    return path.read_bytes()


# ─── Layer 1 — AcroForm ───────────────────────────────────────

def test_acroform_detect():
    data = _load("acroform_application.pdf")
    assert acroform.has_acroform(data)
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    assert result.backend_used == Backend.ACROFORM
    assert len(result.fields) >= 5
    assert all(f.confidence == 1.0 for f in result.fields)


def test_acroform_fill_roundtrip():
    data = _load("acroform_application.pdf")
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    values = suggest_values(result.fields, SAMPLE_SENDER)
    filled = fill_form(data, result.fields, values)
    assert filled.startswith(b"%PDF")
    # 驗證寫入的 AcroForm 值
    from pypdf import PdfReader
    import io
    r = PdfReader(io.BytesIO(filled))
    written = {k: str(v.get("/V", "")) for k, v in (r.get_fields() or {}).items()}
    assert "王小明" in " ".join(written.values())


# ─── Layer 2 — pdfplumber ─────────────────────────────────────

def test_pdfplumber_detect_travel_expense():
    data = _load("flat_travel_expense.pdf")
    assert not acroform.has_acroform(data)
    assert pdfplumber_extract.has_text_layer(data)
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    assert result.backend_used == Backend.PDFPLUMBER
    labels = {f.label for f in result.fields}
    # 至少要抓到核心欄位
    assert {"Name", "Email", "Date"}.issubset(labels)


def test_pdfplumber_dedup_handles_header():
    """檢查 'Sheet / Subject' header 不會被誤判為欄位"""
    data = _load("flat_meeting_signin.pdf")
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    subject_count = sum(1 for f in result.fields if f.label.lower() == "subject")
    assert subject_count == 1, f"Subject 應該只出現一次，實際 {subject_count}"


def test_pdfplumber_fill_with_cjk():
    """CJK 字型必須正常寫入，不會變成 'nnn'"""
    import io
    import pdfplumber

    data = _load("flat_travel_expense.pdf")
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    values = suggest_values(result.fields, SAMPLE_SENDER)
    filled = fill_form(data, result.fields, values)
    with pdfplumber.open(io.BytesIO(filled)) as pdf:
        text = pdf.pages[0].extract_text() or ""
    assert "王小明" in text, f"CJK 字應出現在 PDF 中。實際：{text!r}"
    assert "nnn" not in text, "CJK 不應被替換成 'n'"


# ─── Layer 4 — Gemini（graceful degradation） ────────────────

def test_gemini_graceful_fail_without_key(monkeypatch):
    """無 GEMINI_API_KEY 時應 graceful fail 而非 crash"""
    import os
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    # config 是 cached，需要清掉
    from app.config import get_settings
    get_settings.cache_clear()

    data = _load("scanned_leave_form.png")
    pdf_data = normalize_to_pdf(data, "image/png")
    # 影像被包成單頁 PDF（沒有 text layer 也沒有 AcroForm）→ 落到 Gemini
    result = detect_fields(pdf_data)
    assert result.backend_used in (Backend.GEMINI, Backend.PADDLE)
    # 無 key 時 fields 為空且 needs_review 為 True
    if result.backend_used == Backend.GEMINI:
        assert result.fields == []
        assert result.needs_review
        assert "GEMINI_API_KEY" in (result.notes or "") or "未設定" in (result.notes or "")


# ─── normalize_to_pdf 邊界 ────────────────────────────────────

def test_normalize_pdf_passthrough():
    data = _load("acroform_application.pdf")
    assert normalize_to_pdf(data, "application/pdf") is data


def test_normalize_image_to_pdf():
    data = _load("scanned_leave_form.png")
    pdf = normalize_to_pdf(data, "image/png")
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 0


def test_normalize_unsupported_raises():
    from app.services.form_fill.schema import UnsupportedFormat
    with pytest.raises(UnsupportedFormat):
        normalize_to_pdf(b"abc", "application/octet-stream")


# ─── semantic_mapper ──────────────────────────────────────────

def test_semantic_mapper_basic():
    from app.services.form_fill import FormField
    fields = [
        FormField(name="f1", label="姓名"),
        FormField(name="f2", label="Email"),
        FormField(name="f3", label="日期"),
        FormField(name="f4", label="奇怪欄位"),
    ]
    values = suggest_values(fields, SAMPLE_SENDER)
    assert values["f1"] == "王小明"
    assert values["f2"] == "wang@ncut.edu.tw"
    assert "f3" in values  # today
    assert "f4" not in values  # no match
    # in-place mutation
    assert fields[0].semantic_key == "sender.name"
    assert fields[3].semantic_key is None
