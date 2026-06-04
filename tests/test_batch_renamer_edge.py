"""
tests/test_batch_renamer_edge.py
邊界案例測試 — batch_renamer 模組
"""
import zipfile
import io
import pytest


# ===========================================================================
class TestPreviewRenameEdgeCases:
    """batch_renamer.preview_rename 邊界案例"""

    def test_empty_filenames_list(self):
        from app.services.batch_renamer import preview_rename
        result = preview_rename(filenames=[])
        assert result == []

    def test_no_operations_returns_unchanged(self):
        """所有參數預設 → 檔名不變"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(filenames=["report.pdf", "photo.jpg"])
        assert len(result) == 2
        for item in result:
            assert item["changed"] is False
            assert item["original"] == item["renamed"]

    def test_special_characters_in_filename(self):
        """檔名含特殊字元仍可正確處理"""
        from app.services.batch_renamer import preview_rename
        filenames = ["報告(2026).pdf", "file [copy].txt", "日報-05_03.xlsx"]
        result = preview_rename(filenames=filenames, prefix="new_")
        assert len(result) == 3
        for item in result:
            assert item["renamed"].startswith("new_")
            assert item["changed"] is True

    def test_suffix_added_before_extension(self):
        """後綴應加在副檔名之前"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(filenames=["report.pdf"], suffix="_final")
        assert result[0]["renamed"] == "report_final.pdf"

    def test_find_replace_with_regex_chars(self):
        """搜尋字串含正則特殊字元（如括號）應被字面匹配"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(
            filenames=["file(1).txt", "file(2).txt"],
            find="(1)", replace="(A)"
        )
        assert result[0]["renamed"] == "file(A).txt"
        assert result[1]["changed"] is False  # (2) 不匹配

    def test_numbering_prefix_position(self):
        from app.services.batch_renamer import preview_rename
        result = preview_rename(
            filenames=["a.txt", "b.txt", "c.txt"],
            numbering=True, numbering_start=1,
            numbering_digits=2, numbering_position="prefix"
        )
        assert result[0]["renamed"] == "01_a.txt"
        assert result[1]["renamed"] == "02_b.txt"
        assert result[2]["renamed"] == "03_c.txt"

    def test_numbering_suffix_position(self):
        from app.services.batch_renamer import preview_rename
        result = preview_rename(
            filenames=["doc.pdf"],
            numbering=True, numbering_start=5,
            numbering_digits=3, numbering_position="suffix"
        )
        assert result[0]["renamed"] == "doc_005.pdf"

    def test_combined_all_operations(self):
        """find/replace + prefix + suffix + numbering 同時套用"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(
            filenames=["old_report.txt"],
            find="old", replace="new",
            prefix="2026_", suffix="_v2",
            numbering=True, numbering_start=1,
            numbering_digits=2, numbering_position="prefix"
        )
        renamed = result[0]["renamed"]
        assert "new" in renamed
        assert result[0]["changed"] is True

    def test_single_file_no_extension(self):
        """無副檔名的檔案"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(filenames=["Makefile"], prefix="build_")
        assert result[0]["renamed"] == "build_Makefile"

    def test_numbering_custom_start(self):
        """流水編號自訂起始值"""
        from app.services.batch_renamer import preview_rename
        result = preview_rename(
            filenames=["x.txt", "y.txt"],
            numbering=True, numbering_start=100, numbering_digits=4
        )
        assert "0100" in result[0]["renamed"]
        assert "0101" in result[1]["renamed"]


class TestApplyRenameEdgeCases:
    """batch_renamer.apply_rename 邊界案例"""

    def test_apply_produces_valid_zip(self):
        from app.services.batch_renamer import apply_rename
        from unittest.mock import patch

        files = [("old.txt", b"hello"), ("old2.txt", b"world")]
        rename_map = [
            {"original": "old.txt", "renamed": "new.txt"},
            {"original": "old2.txt", "renamed": "new2.txt"},
        ]

        with patch("app.core.tasks.update_task_progress"):
            result = apply_rename("task-zip", files, rename_map)

        assert isinstance(result, bytes)
        zf = zipfile.ZipFile(io.BytesIO(result))
        names = zf.namelist()
        assert "new.txt" in names
        assert "new2.txt" in names
        assert zf.read("new.txt") == b"hello"

    def test_apply_single_file(self):
        from app.services.batch_renamer import apply_rename
        from unittest.mock import patch

        files = [("single.doc", b"content")]
        rename_map = [{"original": "single.doc", "renamed": "renamed.doc"}]

        with patch("app.core.tasks.update_task_progress"):
            result = apply_rename("task-single", files, rename_map)

        zf = zipfile.ZipFile(io.BytesIO(result))
        assert "renamed.doc" in zf.namelist()
