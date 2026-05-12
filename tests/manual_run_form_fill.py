"""Auto Form Fill 端對端 demo 腳本（人類看的版本）

對 4 個測試 fixture 跑 detect → suggest → fill 流程，
報告每一層 backend 的偵測精度與填寫結果。

執行：
    python tests/manual_run_form_fill.py

CI / pytest 用：請改跑 tests/test_form_fill.py（純 assert，無 print）
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.services.form_fill import (
    detect_fields, normalize_to_pdf, fill_form, suggest_values,
)
from app.services.form_fill.backends import acroform, pdfplumber_extract

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "forms"
OUT_DIR = Path(__file__).parent / "fixtures" / "filled"
OUT_DIR.mkdir(parents=True, exist_ok=True)


SAMPLE_SENDER = {
    "name": "王小明",
    "title": "副教授",
    "department": "電機工程系",
    "organization": "國立勤益科技大學",
    "email": "wang@ncut.edu.tw",
}

SAMPLE_CONTACT = {
    "phone": "04-2392-4505",
    "address": "台中市太平區坪林里中山路二段 57 號",
}


def _hr(s: str) -> str:
    return f"\n{'═' * 70}\n  {s}\n{'═' * 70}"


def _line(s: str = "") -> str:
    return f"\n  {s}"


def _show_detection(result, sender, contact):
    """印出偵測結果摘要"""
    print(_line(f"backend_used     : {result.backend_used}"))
    print(_line(f"page_count       : {result.page_count}"))
    print(_line(f"fields detected  : {len(result.fields)}"))
    print(_line(f"needs_review     : {result.needs_review}"))
    if result.notes:
        print(_line(f"notes            : {result.notes}"))

    if not result.fields:
        return {}

    # semantic mapping
    suggestions = suggest_values(result.fields, sender, contact)
    matched = sum(1 for f in result.fields if f.semantic_key)
    print(_line(f"semantic match   : {matched} / {len(result.fields)}"))

    # 印出每個欄位
    print(_line(""))
    print(_line(f"  {'#':>2}  {'label':<22} {'type':<10} {'conf':>5}  {'semantic_key':<22} suggested"))
    print(_line(f"  {'-'*2}  {'-'*22} {'-'*10} {'-'*5}  {'-'*22} {'-'*30}"))
    for i, f in enumerate(result.fields):
        sk = f.semantic_key or "—"
        sv = f.suggested_value or ""
        if len(sv) > 28:
            sv = sv[:25] + "..."
        label = (f.label or "")[:22]
        print(_line(f"  {i+1:>2}  {label:<22} {f.field_type:<10} {f.confidence:>4.0%}  {sk:<22} {sv}"))
    return suggestions


def _try_fill(data: bytes, result, suggestions, out_name: str):
    """嘗試把建議值寫回 PDF（影像測試會 skip）"""
    if out_name.endswith(".pdf") and result.fields:
        try:
            filled = fill_form(data, result.fields, suggestions)
            out_path = OUT_DIR / out_name
            out_path.write_bytes(filled)
            print(_line(f"✓ filled output  : {out_path.relative_to(ROOT)} ({len(filled):,} bytes)"))
            return True
        except Exception as e:
            print(_line(f"✗ fill failed    : {e}"))
            return False
    return None


# ─────────────────────────────────────────────────────────────
# Test 1 — AcroForm（Layer 1）
# ─────────────────────────────────────────────────────────────

def test_acroform():
    print(_hr("Test 1 — AcroForm PDF (Layer 1: pypdf)"))
    path = FIXTURE_DIR / "acroform_application.pdf"
    data = path.read_bytes()
    print(_line(f"input            : {path.relative_to(ROOT)} ({len(data):,} bytes)"))

    # 確認 backend 偵測正確
    print(_line(f"has_acroform()   : {acroform.has_acroform(data)}"))

    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    suggestions = _show_detection(result, SAMPLE_SENDER, SAMPLE_CONTACT)

    assert result.backend_used == "acroform", "AcroForm 表單應該走 Layer 1"
    assert len(result.fields) >= 5, "至少應偵測到 5 個欄位"

    _try_fill(data, result, suggestions, "acroform_application_filled.pdf")


# ─────────────────────────────────────────────────────────────
# Test 2 — Flat 文字 PDF：差旅費（Layer 2）
# ─────────────────────────────────────────────────────────────

def test_flat_travel_expense():
    print(_hr("Test 2 — Flat Text PDF: travel expense (Layer 2: pdfplumber)"))
    path = FIXTURE_DIR / "flat_travel_expense.pdf"
    data = path.read_bytes()
    print(_line(f"input            : {path.relative_to(ROOT)} ({len(data):,} bytes)"))
    print(_line(f"has_acroform()   : {acroform.has_acroform(data)} (expect False)"))
    print(_line(f"has_text_layer() : {pdfplumber_extract.has_text_layer(data)} (expect True)"))

    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    suggestions = _show_detection(result, SAMPLE_SENDER, SAMPLE_CONTACT)

    assert result.backend_used == "pdfplumber", "文字 PDF 應該走 Layer 2"
    _try_fill(data, result, suggestions, "flat_travel_expense_filled.pdf")


# ─────────────────────────────────────────────────────────────
# Test 3 — Flat 文字 PDF：會議簽到（Layer 2）
# ─────────────────────────────────────────────────────────────

def test_flat_meeting_signin():
    print(_hr("Test 3 — Flat Text PDF: meeting sign-in (Layer 2)"))
    path = FIXTURE_DIR / "flat_meeting_signin.pdf"
    data = path.read_bytes()
    print(_line(f"input            : {path.relative_to(ROOT)} ({len(data):,} bytes)"))

    result = detect_fields(normalize_to_pdf(data, "application/pdf"))
    suggestions = _show_detection(result, SAMPLE_SENDER, SAMPLE_CONTACT)

    assert result.backend_used == "pdfplumber"
    _try_fill(data, result, suggestions, "flat_meeting_signin_filled.pdf")


# ─────────────────────────────────────────────────────────────
# Test 4 — 掃描影像（Layer 4：Gemini，沒 API key 時 graceful fail）
# ─────────────────────────────────────────────────────────────

def test_scanned_image():
    print(_hr("Test 4 — Scanned image: leave form (Layer 4: Gemini Vision)"))
    path = FIXTURE_DIR / "scanned_leave_form.png"
    data = path.read_bytes()
    print(_line(f"input            : {path.relative_to(ROOT)} ({len(data):,} bytes)"))

    has_key = bool(os.environ.get("GEMINI_API_KEY"))
    print(_line(f"GEMINI_API_KEY   : {'set' if has_key else 'NOT SET (will graceful-fail)'}"))

    # 邊界：影像 → PDF（單頁，page size = 影像 pixel 數）
    pdf_data = normalize_to_pdf(data, "image/png")
    print(_line(f"normalized       : {len(data)} bytes png → {len(pdf_data)} bytes pdf"))

    result = detect_fields(pdf_data)
    suggestions = _show_detection(result, SAMPLE_SENDER, SAMPLE_CONTACT)

    assert result.backend_used in ("gemini", "paddle"), "影像應走 Layer 3/4"

    if has_key and result.fields:
        try:
            filled_pdf = fill_form(pdf_data, result.fields, suggestions)
            out_path = OUT_DIR / "scanned_leave_form_filled.pdf"
            out_path.write_bytes(filled_pdf)
            print(_line(f"✓ filled output  : {out_path.relative_to(ROOT)}"))
        except Exception as e:
            print(_line(f"(fill failed): {e}"))
    else:
        print(_line("(skip fill — no API key or no fields)"))


# ─────────────────────────────────────────────────────────────
# Standalone runner
# ─────────────────────────────────────────────────────────────

def main():
    tests = [
        ("AcroForm",            test_acroform),
        ("Flat travel",         test_flat_travel_expense),
        ("Flat meeting",        test_flat_meeting_signin),
        ("Scanned image",       test_scanned_image),
    ]
    results = []
    for name, fn in tests:
        try:
            fn()
            results.append((name, "PASS", None))
        except AssertionError as e:
            results.append((name, "FAIL", str(e)))
            print(_line(f"✗ ASSERTION FAILED: {e}"))
        except Exception as e:
            results.append((name, "ERROR", f"{type(e).__name__}: {e}"))
            print(_line(f"✗ UNEXPECTED ERROR: {type(e).__name__}: {e}"))

    print(_hr("Summary"))
    for name, status, err in results:
        line = f"  {status:<6}  {name}"
        if err:
            line += f"   — {err}"
        print(line)


if __name__ == "__main__":
    main()
