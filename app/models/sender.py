"""寄件人設定 CRUD"""
from typing import Optional
from app.database import get_connection
from app.config import get_settings


class SenderModel:
    """寄件人設定資料模型"""

    @staticmethod
    def get(user_id: str) -> Optional[dict]:
        """取得寄件人設定"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM sender_profiles WHERE user_id=?", (user_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def get_or_default(user_id: str) -> dict:
        """取得寄件人設定，若無則回傳預設值"""
        profile = SenderModel.get(user_id)
        if profile:
            return profile
        settings = get_settings()
        return {
            "user_id": user_id,
            "name": settings.SENDER_NAME,
            "email": settings.SMTP_USER,
            "title": settings.SENDER_TITLE,
            "department": settings.SENDER_DEPT,
            "organization": settings.SENDER_ORG,
            "smtp_host": settings.SMTP_HOST,
            "smtp_port": settings.SMTP_PORT,
            "smtp_user": settings.SMTP_USER,
        }

    @staticmethod
    def upsert(user_id: str, name: str, email: str,
               title: str = "", department: str = "",
               organization: str = "國立勤益科技大學"):
        """新增或更新寄件人設定"""
        conn = get_connection()
        try:
            conn.execute(
                """INSERT INTO sender_profiles (user_id, name, email, title, department, organization)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id) DO UPDATE SET
                   name=excluded.name, email=excluded.email,
                   title=excluded.title, department=excluded.department,
                   organization=excluded.organization""",
                (user_id, name, email, title, department, organization),
            )
            conn.commit()
        finally:
            conn.close()
