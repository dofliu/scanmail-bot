"""Regression tests for code review findings C1 / C2 / C3 / M1

執行：
    python tests/test_form_fill_review_fixes.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.core.file_manager import get_temp_path, save_temp_file, TEMP_DIR
from app.services.form_fill import (
    detect_fields, normalize_to_pdf, fill_form,
    suggest_values, FormField,
)
from app.services.form_fill.backends import gemini_vision


FIXTURE_DIR = ROOT / "tests" / "fixtures" / "forms"


# ─────────────────────────────────────────────────────────────
# C2 — get_temp_path 拒絕路徑穿越
# ─────────────────────────────────────────────────────────────

def test_c2_path_traversal_blocked():
    print("=== C2: get_temp_path path traversal ===")

    # 1. 各種惡意 input 一律被拒
    bad_inputs = [
        "../main.py",
        "../../etc/passwd",
        "/etc/passwd",
        "abc",                          # 太短
        "../" + ("a" * 32) + ".pdf",    # 含 ../
        "g" * 32 + ".pdf",              # 非 hex
        "",
        None,
    ]
    for bad in bad_inputs:
        try:
            r = get_temp_path(bad)
        except Exception as e:
            print(f"  reject {bad!r:<40} → exception {type(e).__name__} ({e})")
            assert False, f"應該回傳 None 而非 raise: {bad!r}"
        assert r is None, f"應拒絕惡意 input {bad!r}, 卻回傳 {r}"
        print(f"  ✓ reject {str(bad)[:40]:<40} → None")

    # 2. 正常的 token 仍可運作（write 再 read）
    path = save_temp_file(b"hello world test data", suffix=".pdf")
    legit = get_temp_path(path.name)
    assert legit is not None
    assert legit.read_bytes() == b"hello world test data"
    print(f"  ✓ accept legit token {path.name} → OK")
    path.unlink(missing_ok=True)

    print("  PASS\n")


# ─────────────────────────────────────────────────────────────
# C1 — fill_form 對影像輸入不再 crash（前提：先 normalize）
# ─────────────────────────────────────────────────────────────

def test_c1_image_input_fill_works():
    print("=== C1: image input fill works after normalize ===")

    png_path = FIXTURE_DIR / "scanned_leave_form.png"
    raw = png_path.read_bytes()

    # 邊界轉換
    pdf_data = normalize_to_pdf(raw, "image/png")
    assert pdf_data.startswith(b"%PDF"), "normalize 結果不是合法 PDF"
    print(f"  ✓ normalize_to_pdf: {len(raw)} bytes image → {len(pdf_data)} bytes PDF")

    # 模擬一個（人工指定的）欄位，bbox 直接用 PDF points
    fields = [
        FormField(
            name="manual_f1",
            label="Name",
            bbox=(80, 1500, 1100, 1550),   # 影像 1240x1754 → PDF 頁面也是這個 size
            page=0,
            backend="manual",
            confidence=1.0,
        )
    ]
    values = {"manual_f1": "王小明"}

    out = fill_form(pdf_data, fields, values)
    assert out.startswith(b"%PDF"), "輸出不是合法 PDF"
    out_path = ROOT / "tests" / "fixtures" / "filled" / "c1_image_input_filled.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(out)
    print(f"  ✓ fill_form returns valid PDF ({len(out)} bytes) → {out_path.relative_to(ROOT)}")

    # 驗證寫入的文字確實出現
    import pdfplumber
    import io as _io
    with pdfplumber.open(_io.BytesIO(out)) as pdf:
        text = pdf.pages[0].extract_text() or ""
    assert "王小明" in text, f"寫入的文字未出現在 PDF 中。實際文字：{text!r}"
    print(f"  ✓ filled text confirmed in output PDF")

    print("  PASS\n")


# ─────────────────────────────────────────────────────────────
# C3 — Gemini bbox 換算正確（用 mock，不需 API key）
# ─────────────────────────────────────────────────────────────

def test_c3_gemini_bbox_conversion():
    print("=== C3: Gemini normalized bbox → PDF points ===")

    page_w, page_h = 600.0, 800.0

    # Gemini 回傳的 normalized 座標（0~1000，原點左上）
    raw = [
        {
            "label": "Name",
            "field_type": "text",
            "bbox_norm": [100, 50, 500, 100],   # 影像左上區塊
            "confidence": 0.9,
        },
        {
            "label": "Date",
            "field_type": "date",
            "bbox_norm": [100, 950, 500, 990],  # 影像右下接近底部
            "confidence": 0.85,
        },
    ]

    fields = gemini_vision._to_form_fields(raw, page_num=0,
                                            page_w_pts=page_w, page_h_pts=page_h)
    assert len(fields) == 2

    f1 = fields[0]
    # nx0=0.1, nx1=0.5, ny0=0.05, ny1=0.10
    # x0=0.1*600=60, x1=0.5*600=300
    # y0=800 - 0.10*800 = 720 (低值), y1=800 - 0.05*800 = 760 (高值)
    print(f"  Name bbox = {f1.bbox}")
    assert abs(f1.bbox[0] - 60.0) < 0.01, f"x0 應是 60, 實際 {f1.bbox[0]}"
    assert abs(f1.bbox[1] - 720.0) < 0.01, f"y0(low) 應是 720, 實際 {f1.bbox[1]}"
    assert abs(f1.bbox[2] - 300.0) < 0.01, f"x1 應是 300, 實際 {f1.bbox[2]}"
    assert abs(f1.bbox[3] - 760.0) < 0.01, f"y1(high) 應是 760, 實際 {f1.bbox[3]}"
    print("  ✓ first field bbox correctly converted (origin bottom-left)")

    f2 = fields[1]
    # ny0=0.95, ny1=0.99 → y0 = 800-0.99*800 = 8, y1 = 800-0.95*800 = 40
    print(f"  Date bbox = {f2.bbox}")
    assert f2.bbox[1] < f2.bbox[3], "y0 必須 < y1"
    assert f2.bbox[1] < 50, "Date 在影像底部 → PDF y 應該接近 0"
    print("  ✓ second field bbox (near image bottom) maps to low PDF y")

    # 邊界值
    raw_edge = [{"label": "x", "bbox_norm": [0, 0, 1000, 1000]}]
    fe = gemini_vision._to_form_fields(raw_edge, 0, page_w, page_h)
    assert fe[0].bbox == (0.0, 0.0, page_w, page_h), f"全頁 bbox 錯誤：{fe[0].bbox}"
    print("  ✓ edge case: 0..1000 maps to full page")

    # 倒裝座標也能處理
    raw_rev = [{"label": "y", "bbox_norm": [500, 800, 100, 200]}]  # x0>x1, y0>y1
    frv = gemini_vision._to_form_fields(raw_rev, 0, page_w, page_h)
    assert frv[0].bbox[0] < frv[0].bbox[2], "x 應已排序"
    assert frv[0].bbox[1] < frv[0].bbox[3], "y 應已排序"
    print("  ✓ reversed coords are auto-sorted")

    # 超界值會被夾住
    raw_oob = [{"label": "z", "bbox_norm": [-100, -50, 1500, 1100]}]
    foo = gemini_vision._to_form_fields(raw_oob, 0, page_w, page_h)
    assert 0 <= foo[0].bbox[0] <= page_w
    assert 0 <= foo[0].bbox[2] <= page_w
    print("  ✓ out-of-range coords are clamped")

    # 異常 input 不會 crash
    raw_bad = [
        {"label": "missing"},                  # 沒有 bbox
        {"label": "wrong-len", "bbox_norm": [1, 2, 3]},
        {"label": "non-num", "bbox_norm": ["a", "b", "c", "d"]},
    ]
    fb = gemini_vision._to_form_fields(raw_bad, 0, page_w, page_h)
    assert len(fb) == 0, f"異常 input 應全部被 reject，卻產生 {len(fb)} 個欄位"
    print(f"  ✓ bad inputs all rejected silently")

    print("  PASS\n")


# ─────────────────────────────────────────────────────────────
# M1 — suggest_values 會 mutate fields 的 semantic_key / suggested_value
# （此處測 service 層；router 層在另一個檔測）
# ─────────────────────────────────────────────────────────────

def test_m1_suggest_mutates_fields():
    print("=== M1: suggest_values populates semantic_key on fields ===")

    fields = [
        FormField(name="f1", label="姓名", backend="pdfplumber"),
        FormField(name="f2", label="Email", backend="pdfplumber"),
        FormField(name="f3", label="日期", backend="pdfplumber"),
        FormField(name="f4", label="unknown_xyz", backend="pdfplumber"),
    ]
    sender = {"name": "王小明", "email": "wang@ncut.edu.tw"}

    values = suggest_values(fields, sender)

    assert fields[0].semantic_key == "sender.name", fields[0].semantic_key
    assert fields[0].suggested_value == "王小明"
    assert fields[1].semantic_key == "sender.email"
    assert fields[2].semantic_key == "today"
    assert fields[3].semantic_key is None, "未匹配的欄位 semantic_key 應為 None"

    # to_dict 應該包含這些註解
    d = fields[0].to_dict()
    assert d["semantic_key"] == "sender.name"
    assert d["suggested_value"] == "王小明"

    print(f"  ✓ fields[0].semantic_key = {fields[0].semantic_key}")
    print(f"  ✓ fields[1].semantic_key = {fields[1].semantic_key}")
    print(f"  ✓ fields[2].semantic_key = {fields[2].semantic_key}")
    print(f"  ✓ fields[3].semantic_key = {fields[3].semantic_key} (no match)")
    print(f"  ✓ values returned = {values}")
    print("  PASS\n")


# ─────────────────────────────────────────────────────────────
# Standalone runner
# ─────────────────────────────────────────────────────────────

def main():
    tests = [
        test_c2_path_traversal_blocked,
        test_c1_image_input_fill_works,
        test_c3_gemini_bbox_conversion,
        test_m1_suggest_mutates_fields,
    ]
    failures = []
    for fn in tests:
        try:
            fn()
        except AssertionError as e:
            failures.append((fn.__name__, f"AssertionError: {e}"))
        except Exception as e:
            failures.append((fn.__name__, f"{type(e).__name__}: {e}"))

    print("=" * 60)
    if not failures:
        print("All review-fix regression tests passed ✓")
        return 0
    print(f"{len(failures)} test(s) FAILED:")
    for name, err in failures:
        print(f"  ✗ {name}: {err}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
