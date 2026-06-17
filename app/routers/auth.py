"""使用者身分驗證路由"""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.models.user import UserModel, verify_password
from app.core.auth import create_access_token, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class AuthRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="使用者名稱")
    password: str = Field(..., min_length=4, max_length=100, description="密碼")


class RegisterResponse(BaseModel):
    success: bool
    user_id: str
    message: str


class LoginResponse(BaseModel):
    success: bool
    token: str
    user_id: str
    username: str


class StatusResponse(BaseModel):
    enabled: bool
    authenticated: bool
    username: Optional[str] = None
    user_id: Optional[str] = None


@router.post("/register", response_model=RegisterResponse)
async def api_register(body: AuthRequest):
    """註冊新帳號"""
    try:
        user_id = UserModel.create(body.username, body.password)
        return {
            "success": True,
            "user_id": user_id,
            "message": "註冊成功，請使用該帳號登入"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("註冊失敗: %s", e)
        raise HTTPException(status_code=500, detail="系統錯誤，無法建立帳號")


@router.post("/login", response_model=LoginResponse)
async def api_login(response: Response, body: AuthRequest):
    """使用者登入，回傳 Token 並設定為 Cookie"""
    user = UserModel.get_by_username(body.username)
    if not user:
        raise HTTPException(status_code=401, detail="使用者名稱或密碼錯誤")
        
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="使用者名稱或密碼錯誤")
        
    # 建立 Token (有效時間 1 天 = 86400 秒)
    token = create_access_token(user["id"], expires_in_seconds=86400)
    
    # 將 token 寫入 Cookie (可作為備用，方便網頁存取)
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        max_age=86400,
        samesite="lax",
        secure=False  # 若部署在 HTTPS 環境，生產環境可設為 True
    )
    
    return {
        "success": True,
        "token": token,
        "user_id": user["id"],
        "username": user["username"]
    }


@router.post("/logout")
async def api_logout(response: Response):
    """使用者登出，清除 Cookie"""
    response.delete_cookie(key="session_token")
    return {"success": True, "message": "已成功登出"}


@router.get("/status", response_model=StatusResponse)
async def api_status(request: Request):
    """檢查認證狀態與是否啟用"""
    settings = get_settings()
    enabled = settings.ENABLE_AUTH
    
    if not enabled:
        return {
            "enabled": False,
            "authenticated": True,  # 沒啟用認證時視為一律已驗證 (guest)
            "username": "default_user",
            "user_id": "default_user"
        }
        
    # 若啟用認證，嘗試即時取得目前使用者
    try:
        user_id = get_current_user(request)
        # 查出 username
        user = UserModel.get_by_id(user_id)
        username = user["username"] if user else "Unknown"
        return {
            "enabled": True,
            "authenticated": True,
            "username": username,
            "user_id": user_id
        }
    except Exception:
        return {
            "enabled": True,
            "authenticated": False,
            "username": None,
            "user_id": None
        }
