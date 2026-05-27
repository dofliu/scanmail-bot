"""SMTP 密碼加解密（AES-256）"""
import base64
import hashlib
from cryptography.fernet import Fernet

from app.config import DEFAULT_ENCRYPTION_KEY, get_settings


def is_default_key() -> bool:
    """是否仍在使用公開的預設加密金鑰（不安全）"""
    return get_settings().ENCRYPTION_KEY == DEFAULT_ENCRYPTION_KEY


def _get_key() -> bytes:
    """從設定取得加密金鑰（單一來源：Settings.ENCRYPTION_KEY）"""
    secret = get_settings().ENCRYPTION_KEY
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
