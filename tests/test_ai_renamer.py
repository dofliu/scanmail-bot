"""
tests/test_ai_renamer.py
單元測試 — ai_renamer + ai_rename_gemini 模組（mock Gemini API）
"""
import os
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


# ===========================================================================
class TestLooksLowInfo:
    """ai_rename_gemini.looks_low_info — 判斷檔名是否為低資訊量"""

    def test_img_pattern(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("IMG_20260101_123456") is True

    def test_dsc_pattern(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("DSC_0001") is True

    def test_screenshot_pattern(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("Screenshot_2026-01-01_120000") is True

    def test_uuid_pattern(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("550e8400-e29b-41d4-a716-446655440000") is True

    def test_meaningful_name_is_not_low_info(self):
        from tools.ai_rename_gemini import looks_low_info
        # 有語義的中文名稱不應被判為低資訊
        assert looks_low_info("2026年度預算表") is False
        # 多個有意義的英文詞組合
        assert looks_low_info("quarterly_sales_analysis") is False

    def test_short_name_is_low_info(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("ab") is True
        assert looks_low_info("x1") is True

    def test_pure_numbers_is_low_info(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("20260101_143022") is True

    def test_generic_single_word_is_low_info(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("untitled") is True
        assert looks_low_info("document") is True
        assert looks_low_info("scan") is True

    def test_whatsapp_pattern(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("IMG-20260101-WA0012") is True

    def test_invoice_random_code(self):
        from tools.ai_rename_gemini import looks_low_info
        assert looks_low_info("invoice-QTGTVJK9-0003") is True


class TestSanitizeFilename:
    """ai_rename_gemini.sanitize_filename"""

    def test_removes_illegal_chars(self):
        from tools.ai_rename_gemini import sanitize_filename
        result = sanitize_filename('file<name>with:bad*chars?.txt')
        assert "<" not in result
        assert ">" not in result
        assert "*" not in result
        assert "?" not in result

    def test_handles_windows_reserved_names(self):
        from tools.ai_rename_gemini import sanitize_filename
        result = sanitize_filename("CON")
        assert result != "CON"  # Should be prefixed with _

    def test_truncates_long_names(self):
        from tools.ai_rename_gemini import sanitize_filename
        long_name = "a" * 200
        result = sanitize_filename(long_name)
        assert len(result) <= 120

    def test_preserves_normal_name(self):
        from tools.ai_rename_gemini import sanitize_filename
        result = sanitize_filename("normal_report_2026.pdf")
        assert result == "normal_report_2026.pdf"

    def test_unicode_normalization(self):
        from tools.ai_rename_gemini import sanitize_filename
        result = sanitize_filename("測試報告.pdf")
        assert "測試報告" in result

    def test_empty_string_returns_unnamed(self):
        from tools.ai_rename_gemini import sanitize_filename
        result = sanitize_filename("")
        assert result == "unnamed"


class TestDedupePath:
    """ai_rename_gemini.dedupe_path — 注意: 使用 'stem (2)' 格式（有空格）"""

    def test_no_conflict(self, tmp_path):
        from tools.ai_rename_gemini import dedupe_path
        target = tmp_path / "unique_file.txt"
        result = dedupe_path(target)
        assert result == target

    def test_first_conflict_adds_2(self, tmp_path):
        from tools.ai_rename_gemini import dedupe_path
        target = tmp_path / "report.txt"
        target.write_text("existing")
        result = dedupe_path(target)
        # 注意格式: "report (2).txt"（有空格）
        assert result.name == "report (2).txt"

    def test_multiple_conflicts(self, tmp_path):
        from tools.ai_rename_gemini import dedupe_path
        target = tmp_path / "data.csv"
        target.write_text("v1")
        (tmp_path / "data (2).csv").write_text("v2")
        (tmp_path / "data (3).csv").write_text("v3")
        result = dedupe_path(target)
        assert result.name == "data (4).csv"


class TestAiRenamerApplyRenames:
    """ai_renamer.apply_renames — 本地重新命名"""

    def test_successful_rename(self, tmp_path):
        src = tmp_path / "old_name.txt"
        src.write_text("content")

        from app.services.ai_renamer import apply_renames
        items = [{"src_path": str(src), "dst_name": "new_name.txt"}]
        results = apply_renames(items)

        assert len(results) == 1
        assert results[0]["result"] == "renamed"
        assert (tmp_path / "new_name.txt").exists()
        assert not src.exists()

    def test_same_name_skipped(self, tmp_path):
        src = tmp_path / "same.txt"
        src.write_text("content")

        from app.services.ai_renamer import apply_renames
        items = [{"src_path": str(src), "dst_name": "same.txt"}]
        results = apply_renames(items)

        assert results[0]["result"] == "skipped"

    def test_source_not_found(self):
        from app.services.ai_renamer import apply_renames
        items = [{"src_path": "/nonexistent/file.txt", "dst_name": "new.txt"}]
        results = apply_renames(items)

        assert results[0]["result"] == "error"

    def test_missing_fields_error(self):
        from app.services.ai_renamer import apply_renames
        items = [{"src_path": "/some/path"}]  # missing dst_name
        results = apply_renames(items)

        assert results[0]["result"] == "error"

    def test_multiple_renames(self, tmp_path):
        f1 = tmp_path / "a.txt"
        f2 = tmp_path / "b.txt"
        f1.write_text("aaa")
        f2.write_text("bbb")

        from app.services.ai_renamer import apply_renames
        items = [
            {"src_path": str(f1), "dst_name": "alpha.txt"},
            {"src_path": str(f2), "dst_name": "beta.txt"},
        ]
        results = apply_renames(items)

        assert all(r["result"] == "renamed" for r in results)
        assert (tmp_path / "alpha.txt").exists()
        assert (tmp_path / "beta.txt").exists()


class TestAiRenamerScanDirectory:
    """ai_renamer.scan_directory — mock Gemini 避免真實 API 呼叫"""

    def test_scan_with_mocked_gemini(self, tmp_path):
        # 建立低資訊量檔案
        (tmp_path / "IMG_20260101_001.jpg").write_bytes(b"\xff\xd8\xff")

        mock_suggestion = MagicMock()
        mock_suggestion.src_path = str(tmp_path / "IMG_20260101_001.jpg")
        mock_suggestion.src_name = "IMG_20260101_001.jpg"
        mock_suggestion.dst_name = "新年照片.jpg"
        mock_suggestion.reason = "AI renamed"
        mock_suggestion.can_rename = True
        mock_suggestion.message = None

        with patch("app.services.ai_renamer.preview_ai_renames",
                    return_value=[mock_suggestion]), \
             patch("app.services.ai_renamer._resolve_gemini_creds",
                    return_value=("fake-key", "gemini-2.0-flash")):
            from app.services.ai_renamer import scan_directory
            results = scan_directory(str(tmp_path))

        assert isinstance(results, list)
        assert len(results) >= 1
        assert results[0]["can_rename"] is True


class TestExtractTextSnippet:
    """ai_rename_gemini.extract_text_snippet"""

    def test_plain_text_file(self, tmp_path):
        from tools.ai_rename_gemini import extract_text_snippet
        f = tmp_path / "test.txt"
        f.write_text("Hello World\nThis is a test file.", encoding="utf-8")
        result = extract_text_snippet(f)
        assert result is not None
        assert "Hello World" in result

    def test_unsupported_extension(self, tmp_path):
        from tools.ai_rename_gemini import extract_text_snippet
        f = tmp_path / "binary.exe"
        f.write_bytes(b"\x00\x01\x02\x03")
        result = extract_text_snippet(f)
        assert result is None

    def test_max_chars_limit(self, tmp_path):
        from tools.ai_rename_gemini import extract_text_snippet
        f = tmp_path / "long.txt"
        f.write_text("x" * 5000, encoding="utf-8")
        result = extract_text_snippet(f, max_chars=100)
        assert result is not None
        assert len(result) <= 100


class TestRocDate:
    """ai_rename_gemini.roc_yyyMMdd_from_mtime"""

    def test_roc_date_format(self, tmp_path):
        from tools.ai_rename_gemini import roc_yyyMMdd_from_mtime
        f = tmp_path / "test.txt"
        f.write_text("test")
        result = roc_yyyMMdd_from_mtime(f)
        # 民國年格式: YYYMMdd (e.g., "1150604")
        assert len(result) == 7
        assert result.isdigit()
