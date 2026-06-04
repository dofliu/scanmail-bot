"""
tests/test_email_sender.py
單元測試 — email_sender 模組（mock aiosmtplib 避免真實 SMTP 連線）
"""
import asyncio
import pytest
from unittest.mock import patch, MagicMock, AsyncMock


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _fake_pdf() -> bytes:
    """產生最小 PDF bytes"""
    return b"%PDF-1.4 fake pdf content for testing"


def _fake_settings(**overrides):
    """建立假的 Settings 物件"""
    defaults = {
        "GEMINI_API_KEY": "",
        "AI_MODEL": "gemini-2.0-flash",
        "AI_MAX_TOKENS": 4096,
        "AI_TEMPERATURE": 0.3,
        "SMTP_HOST": "mail.example.com",
        "SMTP_PORT": 587,
        "SMTP_USER": "testuser@example.com",
        "SMTP_PASSWORD": "testpass",
        "SENDER_NAME": "Test User",
        "SENDER_TITLE": "Engineer",
        "SENDER_DEPT": "Dev",
        "SENDER_ORG": "TestOrg",
        "DATABASE_PATH": "test.db",
        "SESSION_TIMEOUT_MINUTES": 30,
        "MAX_IMAGE_SIZE_MB": 10,
        "LOG_LEVEL": "INFO",
        "ALLOWED_ORIGINS": "*",
        "ENCRYPTION_KEY": "test-key",
    }
    defaults.update(overrides)
    return type("FakeSettings", (), defaults)()


# ===========================================================================
class TestSendEmail:
    """email_sender.send_email — 使用 aiosmtplib.send()"""

    @pytest.fixture(autouse=True)
    def _patch_settings(self):
        with patch("app.services.email_sender.get_settings",
                    return_value=_fake_settings()):
            yield

    def test_successful_send(self):
        with patch("app.services.email_sender.aiosmtplib.send",
                    new_callable=AsyncMock) as mock_send:
            from app.services.email_sender import send_email
            result = asyncio.get_event_loop().run_until_complete(
                send_email(
                    sender_email="sender@example.com",
                    sender_name="Sender",
                    recipient_email="recipient@example.com",
                    recipient_name="Recipient",
                    subject="Test Subject",
                    body="Test body content",
                    pdf_bytes=_fake_pdf(),
                    filename="test.pdf",
                )
            )

        assert result["success"] is True
        assert "成功" in result["message"]
        mock_send.assert_called()

    def test_all_strategies_fail(self):
        with patch("app.services.email_sender.aiosmtplib.send",
                    new_callable=AsyncMock,
                    side_effect=Exception("Connection refused")):
            from app.services.email_sender import send_email
            result = asyncio.get_event_loop().run_until_complete(
                send_email(
                    sender_email="sender@example.com",
                    sender_name="Sender",
                    recipient_email="recipient@example.com",
                    recipient_name="Recipient",
                    subject="Fail Test",
                    body="Should fail",
                    pdf_bytes=_fake_pdf(),
                    filename="fail.pdf",
                )
            )

        assert result["success"] is False
        assert "失敗" in result["message"]

    def test_empty_sender_auto_derives(self):
        """sender_email 空白時應自動從 SMTP_USER 推導"""
        with patch("app.services.email_sender.aiosmtplib.send",
                    new_callable=AsyncMock):
            from app.services.email_sender import send_email
            result = asyncio.get_event_loop().run_until_complete(
                send_email(
                    sender_email="",  # 空白 — 應自動推導
                    sender_name="Auto Sender",
                    recipient_email="recipient@example.com",
                    recipient_name="Recipient",
                    subject="Auto Derive Test",
                    body="Testing auto derive",
                    pdf_bytes=_fake_pdf(),
                    filename="auto.pdf",
                )
            )

        assert result["success"] is True

    def test_auth_error_continues_to_noauth(self):
        """SMTP 認證失敗後應繼續嘗試無認證策略"""
        import aiosmtplib

        call_count = 0

        async def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if kwargs.get("username"):
                raise aiosmtplib.SMTPAuthenticationError(535, b"Auth failed")
            # 無認證策略成功
            return

        with patch("app.services.email_sender.aiosmtplib.send",
                    new_callable=AsyncMock, side_effect=side_effect):
            from app.services.email_sender import send_email
            result = asyncio.get_event_loop().run_until_complete(
                send_email(
                    sender_email="sender@example.com",
                    sender_name="Sender",
                    recipient_email="recipient@example.com",
                    recipient_name="Recipient",
                    subject="Auth Fallback Test",
                    body="Testing auth fallback",
                    pdf_bytes=_fake_pdf(),
                    filename="auth.pdf",
                )
            )

        # 應嘗試多個策略
        assert call_count > 1
        assert result["success"] is True
