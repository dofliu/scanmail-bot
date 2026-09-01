"""使用者身分驗證路由"""
import logging
import secrets
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.models.user import UserModel, verify_password, hash_password
from app.core.auth import create_access_token, get_current_user
from app.core.rate_limiter import auth_rate_limit

logger = logging.getLogger(__name__)
router = APIRouter()


def _cookie_secure(request: Request) -> bool:
    """Cookie 要不要帶 Secure 旗標。

    原本寫死 `False`，旁邊一句註解說「生產環境可設為 True」—— 也就是沒人會去改。
    預設改成**跟著請求的 scheme 走**：https 進來就帶、http 就不帶。
    寫死 True 會讓內網的 http 部署直接登不進去（瀏覽器不送這個 cookie），
    寫死 False 會讓 https 部署的 cookie 可以被降級成 http 的請求帶出去，
    兩個都不是好預設。要強制就設 `COOKIE_SECURE`。

    反向代理後面 scheme 會是 http，除非 uvicorn 開了 `--proxy-headers`
    去認 `X-Forwarded-Proto`；那種部署請直接設 `COOKIE_SECURE=true`。
    """
    override = get_settings().COOKIE_SECURE
    if override is not None:
        return override
    return request.url.scheme == "https"


class AuthRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, description="使用者名稱")
    password: str = Field(..., min_length=4, max_length=100, description="密碼")


class RegisterRequest(AuthRequest):
    invite: Optional[str] = Field(None, description="邀請碼（REGISTRATION_TOKEN 有設定時必填）")


# 使用者不存在時拿來比對的假雜湊。
#
# 沒有它的話，「查無此人」會**立刻**回 401，而「密碼錯誤」要先跑十萬次
# PBKDF2 才回 401 —— 兩者的回應時間差好幾個數量級，等於免費告訴外面
# 哪些使用者名稱是存在的。所以查無此人也照樣算一次雜湊再拒絕。
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


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


def _registration_denied_reason(invite: Optional[str]) -> Optional[str]:
    """可以註冊嗎？不行的話回傳原因。

    兩種情況放行：

      1. **還沒有任何帳號** —— 第一個註冊的人就是這台服務的主人。
         這讓單人部署零設定：裝好、開網頁、註冊、結束。
      2. **帶對 `REGISTRATION_TOKEN`** —— 要加人的時候在 .env 設一個碼、
         把碼給對方，加完再拿掉。

    其餘一律擋掉。原本這個端點是**完全開放**的：`ENABLE_AUTH` 開著又對外，
    任何人都可以自己註冊一個帳號，然後拿到全部工具 —— 認證擋住了未登入的人，
    卻沒擋住「自己註冊一個」這條路。

    第 1 條有一個要知道的前提：服務對外之後如果遲遲沒人註冊，
    第一個搶到的人就是主人。所以啟動時會把「現在還開著」明確講出來
    （見 main.py），而要更嚴的話就設 REGISTRATION_TOKEN 從頭關掉這個窗口。
    """
    settings = get_settings()
    required = settings.REGISTRATION_TOKEN

    if required:
        if not invite or not secrets.compare_digest(invite, required):
            return "邀請碼不正確 —— 請向管理者索取"
        return None

    if UserModel.count() == 0:
        return None
    return "這台服務已經有帳號了，註冊已關閉 —— 要新增帳號請在 .env 設定 REGISTRATION_TOKEN"


@router.post("/register", response_model=RegisterResponse,
             dependencies=[Depends(auth_rate_limit)])
async def api_register(body: RegisterRequest):
    """註冊新帳號（第一個帳號免邀請碼，之後需要 REGISTRATION_TOKEN）"""
    denied = _registration_denied_reason(body.invite)
    if denied:
        logger.warning("拒絕註冊 %r：%s", body.username, denied)
        raise HTTPException(status_code=403, detail=denied)
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


@router.post("/login", response_model=LoginResponse,
             dependencies=[Depends(auth_rate_limit)])
async def api_login(request: Request, response: Response, body: AuthRequest):
    """使用者登入，回傳 Token 並設定為 Cookie"""
    user = UserModel.get_by_username(body.username)

    # 查無此人也照樣算一次雜湊，兩條路的耗時才對得起來（見 _DUMMY_HASH）
    expected = user["password_hash"] if user else _DUMMY_HASH
    ok = verify_password(body.password, expected)
    if not user or not ok:
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
        secure=_cookie_secure(request),
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
