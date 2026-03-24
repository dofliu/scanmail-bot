"""使用者 Session 狀態機"""
import json
import logging
from datetime import datetime, timedelta
from typing import Optional
from app.database import get_connection
from app.config import get_settings

logger = logging.getLogger(__name__)

# 有效狀態
VALID_STATES = {"idle", "awaiting_contact", "processing",
                "awaiting_confirm", "editing", "sending"}

# 狀態轉換規則
STATE_TRANSITIONS = {
    "idle": {"awaiting_contact"},
    "awaiting_contact": {"processing", "idle"},
    "processing": {"awaiting_confirm", "idle"},
    "awaiting_confirm": {"sending", "editing", "idle"},
    "editing": {"awaiting_confirm", "idle"},
    "sending": {"idle"},
}


class SessionModel:
    """使用者 Session 狀態機管理"""

    @staticmethod
    def get(user_id: str) -> Optional[dict]:
        """取得 session（自動檢查逾時）"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM user_sessions WHERE user_id=?", (user_id,)
            ).fetchone()
            if not row:
                return None

            session = dict(row)

            # 檢查逾時
            settings = get_settings()
            timeout = timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)
            updated = datetime.fromisoformat(session["updated_at"])
            if datetime.now() - updated > timeout and session["state"] != "idle":
                logger.info("Session 逾時，自動重置: %s", user_id)
                SessionModel.reset(user_id)
                session["state"] = "idle"

            # 解析 ai_result JSON
            if session.get("ai_result"):
                try:
                    session["ai_result"] = json.loads(session["ai_result"])
                except json.JSONDecodeError:
                    session["ai_result"] = None

            return session
        finally:
            conn.close()

    @staticmethod
    def get_or_create(user_id: str) -> dict:
        """取得或建立 session"""
        session = SessionModel.get(user_id)
        if session:
            return session
        conn = get_connection()
        try:
            conn.execute(
                """INSERT OR IGNORE INTO user_sessions (user_id, state, updated_at)
                   VALUES (?, 'idle', ?)""",
                (user_id, datetime.now().isoformat()),
            )
            conn.commit()
        finally:
            conn.close()
        return SessionModel.get(user_id)

    @staticmethod
    def transition(user_id: str, new_state: str) -> bool:
        """狀態轉換（含驗證）"""
        if new_state not in VALID_STATES:
            logger.warning("無效狀態: %s", new_state)
            return False

        session = SessionModel.get_or_create(user_id)
        current = session["state"]

        if new_state not in STATE_TRANSITIONS.get(current, set()):
            logger.warning("不允許的狀態轉換: %s -> %s", current, new_state)
            return False

        conn = get_connection()
        try:
            conn.execute(
                "UPDATE user_sessions SET state=?, updated_at=? WHERE user_id=?",
                (new_state, datetime.now().isoformat(), user_id),
            )
            conn.commit()
            logger.info("狀態轉換: %s -> %s (user: %s)", current, new_state, user_id)
            return True
        finally:
            conn.close()

    @staticmethod
    def set_image(user_id: str, image_data: bytes, media_type: str = "image/jpeg"):
        """儲存圖片到 session"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET image_data=?, image_media_type=?, updated_at=?
                   WHERE user_id=?""",
                (image_data, media_type, datetime.now().isoformat(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def set_contact(user_id: str, contact_id: int):
        """設定選擇的聯絡人"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET selected_contact_id=?, updated_at=?
                   WHERE user_id=?""",
                (contact_id, datetime.now().isoformat(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def set_ai_result(user_id: str, result: dict):
        """儲存 AI 辨識結果"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET ai_result=?, updated_at=?
                   WHERE user_id=?""",
                (json.dumps(result, ensure_ascii=False),
                 datetime.now().isoformat(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def set_edit_field(user_id: str, field: str):
        """設定正在編輯的欄位"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET edit_field=?, updated_at=?
                   WHERE user_id=?""",
                (field, datetime.now().isoformat(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def reset(user_id: str):
        """重置 session 到 idle"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET state='idle', image_data=NULL, image_media_type='image/jpeg',
                       selected_contact_id=NULL, ai_result=NULL, edit_field=NULL,
                       updated_at=?
                   WHERE user_id=?""",
                (datetime.now().isoformat(), user_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def cleanup_expired():
        """清理所有逾時的 session"""
        settings = get_settings()
        cutoff = (datetime.now() - timedelta(minutes=settings.SESSION_TIMEOUT_MINUTES)).isoformat()
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE user_sessions
                   SET state='idle', image_data=NULL, ai_result=NULL,
                       selected_contact_id=NULL, edit_field=NULL, updated_at=?
                   WHERE state != 'idle' AND updated_at < ?""",
                (datetime.now().isoformat(), cutoff),
            )
            conn.commit()
        finally:
            conn.close()
