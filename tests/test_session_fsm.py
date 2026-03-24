"""Session 狀態機測試"""
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 使用 /tmp 測試用資料庫
_TEST_DB = "/tmp/test_scanmail.db"
os.environ["DATABASE_PATH"] = _TEST_DB

from app.config import get_settings
get_settings.cache_clear()

from app.database import init_db
from app.models.session import SessionModel, STATE_TRANSITIONS


@pytest.fixture(autouse=True)
def setup_db():
    """每個測試前初始化資料庫"""
    os.environ["DATABASE_PATH"] = _TEST_DB
    get_settings.cache_clear()
    init_db()
    yield
    if os.path.exists(_TEST_DB):
        os.remove(_TEST_DB)


class TestSessionFSM:
    """Session 狀態機測試"""

    def test_create_session(self):
        session = SessionModel.get_or_create("test_user")
        assert session["state"] == "idle"
        assert session["user_id"] == "test_user"

    def test_valid_transition(self):
        SessionModel.get_or_create("test_user")
        result = SessionModel.transition("test_user", "awaiting_contact")
        assert result is True
        session = SessionModel.get("test_user")
        assert session["state"] == "awaiting_contact"

    def test_invalid_transition(self):
        SessionModel.get_or_create("test_user")
        # idle -> sending 不允許
        result = SessionModel.transition("test_user", "sending")
        assert result is False

    def test_full_flow(self):
        SessionModel.get_or_create("test_user")
        assert SessionModel.transition("test_user", "awaiting_contact")
        assert SessionModel.transition("test_user", "processing")
        assert SessionModel.transition("test_user", "awaiting_confirm")
        assert SessionModel.transition("test_user", "sending")
        assert SessionModel.transition("test_user", "idle")

    def test_edit_flow(self):
        SessionModel.get_or_create("test_user")
        SessionModel.transition("test_user", "awaiting_contact")
        SessionModel.transition("test_user", "processing")
        SessionModel.transition("test_user", "awaiting_confirm")
        assert SessionModel.transition("test_user", "editing")
        assert SessionModel.transition("test_user", "awaiting_confirm")

    def test_cancel_from_any_state(self):
        SessionModel.get_or_create("test_user")
        SessionModel.transition("test_user", "awaiting_contact")
        # 重置（模擬取消）
        SessionModel.reset("test_user")
        session = SessionModel.get("test_user")
        assert session["state"] == "idle"

    def test_set_image(self):
        SessionModel.get_or_create("test_user")
        SessionModel.set_image("test_user", b"fake_image_data", "image/png")
        session = SessionModel.get("test_user")
        assert session["image_data"] == b"fake_image_data"
        assert session["image_media_type"] == "image/png"

    def test_set_ai_result(self):
        SessionModel.get_or_create("test_user")
        result = {"doc_type": "exam", "subject": "測試", "confidence": 0.95}
        SessionModel.set_ai_result("test_user", result)
        session = SessionModel.get("test_user")
        assert session["ai_result"]["doc_type"] == "exam"
        assert session["ai_result"]["confidence"] == 0.95
