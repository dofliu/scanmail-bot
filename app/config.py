"""環境變數與設定管理"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings


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
    DATABASE_PATH: str = "scanmail.db"
    SESSION_TIMEOUT_MINUTES: int = 30
    MAX_IMAGE_SIZE_MB: int = 10
    LOG_LEVEL: str = "INFO"

    # 加密金鑰
    ENCRYPTION_KEY: str = "scanmail-bot-default-secret-key"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """取得快取的設定實例"""
    return Settings()
