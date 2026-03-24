"""Flex Message 建構測試"""
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.flex_builder import (
    build_preview_flex,
    build_contact_quick_reply,
    build_edit_quick_reply,
    DOC_TYPE_COLORS,
)


class TestFlexBuilder:

    def test_preview_flex_structure(self):
        result = {
            "doc_type": "exam",
            "subject": "材料力學期中考卷",
            "body": "附件為考卷，請查收。",
            "filename": "材力_期中考卷_20260324.pdf",
            "confidence": 0.95,
        }
        flex = build_preview_flex(result, "王大明", "wang@ncut.edu.tw")
        assert flex["type"] == "flex"
        assert "bubble" in str(flex["contents"]["type"])

    def test_all_doc_types_have_colors(self):
        for doc_type in ["exam", "official", "receipt", "contract",
                         "report", "letter", "form", "other"]:
            assert doc_type in DOC_TYPE_COLORS

    def test_contact_quick_reply(self):
        contacts = [
            {"id": 1, "name": "王大明", "title": "教授", "email": "wang@ncut.edu.tw"},
            {"id": 2, "name": "陳美玲", "title": "主任", "email": "chen@ncut.edu.tw"},
        ]
        qr = build_contact_quick_reply(contacts)
        # contacts + 新增按鈕
        assert len(qr["items"]) == 3

    def test_edit_quick_reply(self):
        qr = build_edit_quick_reply()
        assert len(qr["items"]) == 4  # subject, body, filename, back
