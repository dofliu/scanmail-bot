"""使用者身份驗證與 Token 管理"""
import json
import time
import logging
from typing import Optional
from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader

from app.config import get_settings
from app.utils.crypto import _get_key
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

# 定義 Token 傳遞方式
# API 優先從 Authorization Header 取得 Bearer Token，其次可支援 Cookie
API_KEY_HEADER = APIKeyHeader(name="Authorization", auto_error=False)


def create_access_token(user_id: str, expires_in_seconds: int = 86400) -> str:
    """建立安全的加密身份 Token"""
    f = Fernet(_get_key())
    payload = {
        "user_id": user_id,
        "expires_at": time.time() + expires_in_seconds
    }
    payload_bytes = json.dumps(payload).encode("utf-8")
    token = f.encrypt(payload_bytes).decode("utf-8")
    return token


def verify_access_token(token: str) -> Optional[str]:
    """驗證 Token 是否合法且未過期，回傳 user_id"""
    try:
        f = Fernet(_get_key())
        decrypted_bytes = f.decrypt(token.encode("utf-8"))
        payload = json.loads(decrypted_bytes.decode("utf-8"))
        
        # 檢查過期時間
        if time.time() > payload.get("expires_at", 0):
            logger.warning("Token 已過期")
            return None
            
        return payload.get("user_id")
    except Exception as e:
        logger.warning("Token 驗證失敗: %s", e)
        return None


def get_current_user(request: Request) -> str:
    """FastAPI 依賴項：驗證目前使用者身分，回傳 user_id。
    
    支援 ENABLE_AUTH=False 的單人模式與 ENABLE_AUTH=True 的多使用者身份認證模式。
    """
    settings = get_settings()
    
    # 模式 1：未啟用使用者認證 (單人模式/開發模式)
    if not settings.ENABLE_AUTH:
        # 直接使用 X-User-Id 標頭 (預設 default_user)
        user_id = request.headers.get("X-User-Id", "default_user") or "default_user"
        request.state.user_id = user_id
        return user_id
        
    # 模式 2：已啟用使用者認證
    token = None
    
    # 1. 嘗試從 Authorization 標頭取得 (格式: Bearer <token>)
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        
    # 2. 嘗試從 Cookie 取得
    if not token:
        token = request.cookies.get("session_token")

    # 3. 嘗試從 query string 取得
    #    SSE（EventSource）無法自訂 header，跨來源時也拿不到 cookie，
    #    Android App 的背景任務進度只能靠 ?token= 帶入。
    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(
            status_code=401,
            detail="未提供認證 Token，請先登入"
        )
        
    user_id = verify_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="認證 Token 無效或已過期，請重新登入"
        )
        
    request.state.user_id = user_id
    return user_id
