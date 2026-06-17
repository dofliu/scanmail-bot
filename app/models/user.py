"""使用者管理與密碼安全驗證"""
import sqlite3
import uuid
import logging
import hashlib
import secrets
from typing import Optional
from app.database import get_connection

logger = logging.getLogger(__name__)


def hash_password(password: str) -> str:
    """使用 PBKDF2 進行安全的密碼雜湊"""
    salt = secrets.token_bytes(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return f"{salt.hex()}:{pw_hash.hex()}"


def verify_password(password: str, hashed_value: str) -> bool:
    """驗證密碼是否符合雜湊值"""
    try:
        salt_hex, hash_hex = hashed_value.split(":")
        salt = bytes.fromhex(salt_hex)
        expected_hash = bytes.fromhex(hash_hex)
        pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return secrets.compare_digest(pw_hash, expected_hash)
    except Exception as e:
        logger.error("密碼驗證異常: %s", e)
        return False


class UserModel:
    """使用者帳號資料模型"""

    @staticmethod
    def create(username: str, password_raw: str) -> str:
        """建立新使用者，回傳 user_id (UUID)"""
        user_id = str(uuid.uuid4())
        hashed = hash_password(password_raw)
        conn = get_connection()
        try:
            conn.execute(
                "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
                (user_id, username, hashed)
            )
            conn.commit()
            logger.info("已建立新使用者: %s (%s)", username, user_id)
            return user_id
        except sqlite3.IntegrityError:
            raise ValueError(f"使用者名稱 '{username}' 已被註冊")
        finally:
            conn.close()

    @staticmethod
    def get_by_username(username: str) -> Optional[dict]:
        """以使用者名稱取得使用者"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE username=?", (username,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def get_by_id(user_id: str) -> Optional[dict]:
        """以 user_id 取得使用者"""
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE id=?", (user_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
