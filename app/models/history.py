"""寄件歷史 CRUD 操作"""
from typing import Optional
from app.database import get_connection


class HistoryModel:
    """寄件歷史資料模型"""

    @staticmethod
    def create(user_id: str, recipient_email: str, recipient_name: str,
               subject: str, body: str = "", doc_type: str = "",
               filename: str = "", ai_confidence: float = 0,
               file_size: int = 0) -> int:
        """新增寄件記錄"""
        conn = get_connection()
        try:
            cursor = conn.execute(
                """INSERT INTO send_history
                   (user_id, recipient_email, recipient_name, subject,
                    body, doc_type, filename, ai_confidence, file_size)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, recipient_email, recipient_name, subject,
                 body, doc_type, filename, ai_confidence, file_size),
            )
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    @staticmethod
    def list_by_user(user_id: str, limit: int = 20) -> list[dict]:
        """列出使用者的寄件歷史"""
        conn = get_connection()
        try:
            rows = conn.execute(
                """SELECT * FROM send_history WHERE user_id=?
                   ORDER BY sent_at DESC LIMIT ?""",
                (user_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def get_stats(user_id: str) -> dict:
        """取得寄件統計"""
        conn = get_connection()
        try:
            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM send_history WHERE user_id=?",
                (user_id,),
            ).fetchone()["cnt"]

            monthly = conn.execute(
                """SELECT COUNT(*) as cnt FROM send_history
                   WHERE user_id=? AND sent_at >= date('now', '-30 days')""",
                (user_id,),
            ).fetchone()["cnt"]

            by_type = conn.execute(
                """SELECT doc_type, COUNT(*) as cnt FROM send_history
                   WHERE user_id=? GROUP BY doc_type ORDER BY cnt DESC""",
                (user_id,),
            ).fetchall()

            return {
                "total": total,
                "monthly": monthly,
                "by_type": [dict(r) for r in by_type],
            }
        finally:
            conn.close()
