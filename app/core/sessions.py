"""工作階段管理（記憶體版，生產環境可改 Redis）"""
from typing import Optional

from fastapi import Request


class SessionData:
    def __init__(self):
        self.image_data: Optional[bytes] = None
        self.image_original: Optional[bytes] = None  # 保留原始圖片（切換濾鏡用）
        self.image_media_type: str = "image/jpeg"
        self.ai_result: Optional[dict] = None
        self.selected_contact_id: Optional[int] = None
        self.detected_corners: Optional[list] = None  # 偵測到的邊界角點
        # 多頁掃描
        self.pages: list[bytes] = []  # 已確認的頁面列表（處理後的 JPEG bytes）


_sessions: dict[str, SessionData] = {}


def get_user_id(request: Request) -> str:
    # 優先使用已驗證的使用者 ID
    if hasattr(request.state, "user_id"):
        return request.state.user_id
        
    # 若尚未執行 dependencies 驗證 (例如未配置 get_current_user 依賴項)
    from app.config import get_settings
    if get_settings().ENABLE_AUTH:
        from app.core.auth import verify_access_token
        token = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        if not token:
            token = request.cookies.get("session_token")
        if not token:
            # SSE / 跨來源請求只能靠 query string 帶 token（見 app/core/auth.py）
            token = request.query_params.get("token")
        if token:
            uid = verify_access_token(token)
            if uid:
                request.state.user_id = uid
                return uid
                
    return request.headers.get("X-User-Id", "default_user") or "default_user"


def get_session(user_id: str) -> SessionData:
    if user_id not in _sessions:
        _sessions[user_id] = SessionData()
    return _sessions[user_id]
