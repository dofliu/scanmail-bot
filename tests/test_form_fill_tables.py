"""Auto Form Fill — M4.5 表格偵測 + M4.6 0 欄位自動 fallback 測試

需要 fixtures 已產生（`python tests/generate_test_forms.py`）。

執行：
    python -m pytest tests/test_form_fill_tables.py -v
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.services.form_fill import detect_fields, normalize_to_pdf
from app.services.form_fill.schema import Backend, DetectionResult, FormField
from app.services.form_fill import dispatcher
from app.services.form_fill.backends import pdfplumber_extract, paddle_structure, gemini_vision

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "forms"

# 表格 fixture 內的英文 label（皆命中 _LABEL_KEYWORDS）
EXPECTED_TABLE_LABELS = {
    "Name", "Title", "Department", "Email", "Phone", "Date", "Address", "Purpose",
}


def _load(name: str) -> bytes:
    path = FIXTURE_DIR / name
    if not path.exists():
        pytest.skip(f"fixture not found: {path}（請先 `python tests/generate_test_forms.py`）")
    return path.read_bytes()


# ─── M4.5 — 表格 cell 偵測 ────────────────────────────────────

def test_table_form_detects_cell_fields():
    data = _load("table_visit_form.pdf")
    result = detect_fields(normalize_to_pdf(data, "application/pdf"))

    assert result.backend_used == Backend.PDFPLUMBER
    assert len(result.fields) >= 6, "表格式表單應偵測到多個欄位（M4.5）"

    labels = {f.label for f in result.fields}
    assert labels & EXPECTED_TABLE_LABELS, f"未命中預期 label，實得：{labels}"

    # 每個欄位都應有合法的 PDF points bbox（origin bottom-left，x0<x1, y0<y1）
    for f in result.fields:
        assert f.bbox is not None and len(f.bbox) == 4
        x0, y0, x1, y1 = f.bbox
        assert x0 < x1 and y0 < y1
        assert all(v >= 0 for v in f.bbox)

    # Date label 應被推斷為 date type
    date_fields = [f for f in result.fields if f.label == "Date"]
    if date_fields:
        assert date_fields[0].field_type == "date"


# ─── M4.6 — Layer 2 偵測 0 欄位時自動 fallback 到影像 backend ──

def test_zero_field_falls_back_to_image_backend(monkeypatch):
    data = _load("table_visit_form.pdf")  # 任何文字 PDF 皆可（會被 stub 取代偵測結果）

    # Layer 2 假裝抓不到任何欄位
    def _empty_detect(_data):
        return DetectionResult(
            backend_used=Backend.PDFPLUMBER, page_count=1, fields=[], needs_review=True,
        )
    monkeypatch.setattr(pdfplumber_extract, "detect", _empty_detect)

    # 確保不會走 PaddleOCR，讓路徑落到 Gemini stub
    monkeypatch.setattr(paddle_structure, "is_available", lambda: False)

    calls = {"n": 0}

    def _stub_gemini(images, page_sizes_pts, hint=None):
        calls["n"] += 1
        assert len(images) == len(page_sizes_pts)
        return DetectionResult(
            backend_used=Backend.GEMINI, page_count=len(images),
            fields=[FormField(name="g0", label="fallback", backend=Backend.GEMINI)],
            needs_review=True, notes="stub",
        )
    monkeypatch.setattr(gemini_vision, "detect", _stub_gemini)

    result = detect_fields(data)

    assert calls["n"] == 1, "Layer 2 回 0 欄位時應 fallback 到影像 backend（M4.6）"
    assert result.backend_used == Backend.GEMINI
    assert len(result.fields) == 1 and result.fields[0].label == "fallback"


def test_nonempty_layer2_does_not_fallback(monkeypatch):
    """Layer 2 有抓到欄位時，不應觸發影像 fallback"""
    data = _load("table_visit_form.pdf")

    def _boom(*a, **k):
        raise AssertionError("不該呼叫影像 fallback")
    monkeypatch.setattr(gemini_vision, "detect", _boom)
    monkeypatch.setattr(dispatcher, "_render_pdf_to_images", _boom)

    result = detect_fields(data)
    assert result.backend_used == Backend.PDFPLUMBER
    assert len(result.fields) > 0
