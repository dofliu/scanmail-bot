"""環境變數與設定管理"""
from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings

# 公開的預設加密金鑰 — 僅供開發；正式部署務必以環境變數覆蓋。
# 這個字串就在版控裡，所以「還在用預設值」等於「沒有金鑰」。
DEFAULT_ENCRYPTION_KEY = "scanmail-bot-default-secret-key"


class Settings(BaseSettings):
    """應用程式設定 — 從 .env 載入"""
    
    # Gemini Vision API
    GEMINI_API_KEY: str = ""
    AI_MODEL: str = "gemini-2.0-flash"
    AI_MAX_TOKENS: int = 4096
    AI_TEMPERATURE: float = 0.3
    
    # SMTP
    SMTP_HOST: str = "mail.ncut.edu.tw"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    
    # 預設寄件人
    SENDER_NAME: str = "劉瑞弘"
    SENDER_TITLE: str = "副教授"
    SENDER_DEPT: str = "智慧自動化工程系"
    SENDER_ORG: str = "國立勤益科技大學"
    
    # 應用設定
    DATABASE_PATH: str = "data/scanmail.db"
    SESSION_TIMEOUT_MINUTES: int = 30
    MAX_IMAGE_SIZE_MB: int = 10
    LOG_LEVEL: str = "INFO"
    ENABLE_AUTH: bool = False

    # CORS — 允許的來源（逗號分隔，預設全開；正式部署請收斂）
    ALLOWED_ORIGINS: str = "*"

    # 加密金鑰（SMTP 密碼用）
    ENCRYPTION_KEY: str = DEFAULT_ENCRYPTION_KEY

    # 簽發身分 Token 用的金鑰。留空的話從 ENCRYPTION_KEY 推導（見
    # app/utils/crypto.py 的 _auth_key），**但推導出來的位元組跟 SMTP 那把不同**。
    # 單獨設定它的用途是「換一把就把所有人踢下線」，不必動 SMTP 那把。
    AUTH_SECRET_KEY: str = ""

    # 註冊邀請碼。留空時註冊只開放給**第一個**帳號（見 app/routers/auth.py）；
    # 設定之後，之後每一次註冊都要帶對這個碼。
    REGISTRATION_TOKEN: str = ""

    # 登入 Cookie 要不要帶 Secure 旗標。None（預設）＝ 跟著請求的 scheme 走 ——
    # 寫死 True 會讓內網的 http 部署登不進去，寫死 False 會讓 https 部署的
    # cookie 裸奔，兩個都不是好預設。
    COOKIE_SECURE: Optional[bool] = None

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """取得快取的設定實例"""
    return Settings()
