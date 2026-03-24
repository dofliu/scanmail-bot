"""聯絡人 CRUD 操作"""
import sqlite3
from datetime import datetime
from typing import Optional
from app.database import get_connection


class ContactModel:
    """聯絡人資料模型"""

    @staticmethod
    def create(user_id: str, name: str, email: str,
               department: str = "", title: str = "") -> int:
        """新增聯絡人，回傳 id"""
        conn = get_connection()
        try:
            cursor = conn.execute(
                """INSERT INTO contacts (user_id, name, email, department, title)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, name, email, department, title),
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            # 已存在則更新
            conn.execute(
                """UPDATE contacts SET name=?, department=?, title=?
                   WHERE user_id=? AND email=?""",
                (name, department, title, user_id, email),
            )
            conn.commit()
            row = conn.execute(
                "SELECT id FROM contacts WHERE user_id=? AND email=?",
                (user_id, email),
            ).fetchone()
            return row["id"]
        finally:
            conn.close()

    @staticmethod
    def get_by_id(contact_id: int) -> Optional[dict]:
        """以 id 取得聯絡人"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM contacts WHERE id=?", (contact_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def list_by_user(user_id: str, limit: int = 10) -> list[dict]:
        """列出使用者的聯絡人（依使用頻率排序）"""
        conn = get_connection()
        try:
            rows = conn.execute(
                """SELECT * FROM contacts WHERE user_id=?
                   ORDER BY frequency DESC, last_used_at DESC
                   LIMIT ?""",
                (user_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def search(user_id: str, keyword: str) -> list[dict]:
        """搜尋聯絡人（姓名/email/單位）"""
        conn = get_connection()
        try:
            pattern = f"%{keyword}%"
            rows = conn.execute(
                """SELECT * FROM contacts WHERE user_id=?
                   AND (name LIKE ? OR email LIKE ? OR department LIKE ?)
                   ORDER BY frequency DESC LIMIT 10""",
                (user_id, pattern, pattern, pattern),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    @staticmethod
    def increment_frequency(contact_id: int):
        """增加使用次數"""
        conn = get_connection()
        try:
            conn.execute(
                """UPDATE contacts SET frequency = frequency + 1,
                   last_used_at = ? WHERE id = ?""",
                (datetime.now().isoformat(), contact_id),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def delete(contact_id: int):
        """刪除聯絡人"""
        conn = get_connection()
        try:
            conn.execute("DELETE FROM contacts WHERE id=?", (contact_id,))
            conn.commit()
        finally:
            conn.close()
