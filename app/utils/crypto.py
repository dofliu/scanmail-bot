"""SMTP 密碼加解密（AES-256）與身分 Token 的金鑰推導"""
import base64
import hashlib
from cryptography.fernet import Fernet

from app.config import DEFAULT_ENCRYPTION_KEY, get_settings

# 推導 Token 金鑰時混進去的標籤（domain separation）。
#
# 為什麼要有這個：Token 跟 SMTP 密碼原本共用同一把 `sha256(ENCRYPTION_KEY)`。
# 同一把鑰匙做兩件不相干的事，任何一邊出問題另一邊就跟著倒 —— 而這兩件事的
# 威脅模型完全不同（SMTP 密碼是靜態儲存，Token 是對外簽發的憑證）。
# 加了標籤之後，同一個 ENCRYPTION_KEY 推出來的兩把鑰匙位元組不同，
# 拿到其中一把也回推不出另一把。
#
# 版本號留在標籤裡：哪天要換推導方式，改成 -v2 就會讓所有舊 Token 失效，
# 那正是我們要的行為。
AUTH_KEY_LABEL = b"scanmail-auth-token-v1|"


def is_default_key() -> bool:
    """是否仍在使用公開的預設加密金鑰（不安全）"""
    return get_settings().ENCRYPTION_KEY == DEFAULT_ENCRYPTION_KEY


def _get_key() -> bytes:
    """SMTP 密碼用的金鑰"""
    secret = get_settings().ENCRYPTION_KEY
    key = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def _auth_key() -> bytes:
    """身分 Token 用的金鑰 —— 跟 `_get_key()` 一定不同（見 AUTH_KEY_LABEL）"""
    settings = get_settings()
    secret = settings.AUTH_SECRET_KEY or settings.ENCRYPTION_KEY
    key = hashlib.sha256(AUTH_KEY_LABEL + secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def startup_secret_error() -> str | None:
    """啟動前的金鑰檢查 —— 回傳錯誤訊息，沒問題則回 None。

    **開了認證卻還用公開的預設金鑰是致命的**，不是「不太理想」：
    那個字串就在 app/config.py 裡，任何讀過這個 repo 的人都能自己
    簽一張帶任意 user_id 的合法 Token，認證等於不存在。
    這種情況不警告、直接不讓服務起來 —— 警告會被日誌淹掉，
    而「以為自己有保護」比「知道自己沒保護」危險得多。
    """
    settings = get_settings()
    if settings.ENABLE_AUTH and not settings.AUTH_SECRET_KEY and is_default_key():
        return (
            "ENABLE_AUTH=True 但 ENCRYPTION_KEY 還是公開的預設值 —— "
            "任何人都能偽造身分 Token，認證形同不存在。\n"
            "請在 .env 設定 ENCRYPTION_KEY（或單獨設定 AUTH_SECRET_KEY）再啟動，例如：\n"
            "  python -c \"import secrets; print('ENCRYPTION_KEY=' + secrets.token_urlsafe(32))\" >> .env"
        )
    return None


def encrypt_password(plain_text: str) -> str:
    """加密密碼"""
    f = Fernet(_get_key())
    return f.encrypt(plain_text.encode()).decode()


def decrypt_password(encrypted_text: str) -> str:
    """解密密碼"""
    f = Fernet(_get_key())
    return f.decrypt(encrypted_text.encode()).decode()
