"""SMTP 密碼加解密（AES-256）"""
import os
import base64
import hashlib
from cryptography.fernet import Fernet


def _get_key() -> bytes:
    """從環境變數或產生加密金鑰"""
    secret = os.getenv("ENCRYPTION_KEY", "scanmail-bot-default-secret-key")
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def encrypt_password(plain_text: str) -> str:
    """加密密碼"""
    f = Fernet(_get_key())
    return f.encrypt(plain_text.encode()).decode()


def decrypt_password(encrypted_text: str) -> str:
    """解密密碼"""
    f = Fernet(_get_key())
    return f.decrypt(encrypted_text.encode()).decode()
