"""API Rate Limiting 基礎實作"""
import time
import logging
from collections import defaultdict
from threading import Lock
from fastapi import Request, HTTPException, status

logger = logging.getLogger(__name__)

class RateLimiter:
    def __init__(self, requests_limit: int, window_seconds: int, name: str = "default"):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds
        self.name = name
        self.history = defaultdict(list)
        self.lock = Lock()

    def is_allowed(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            # 濾除視窗外的舊請求記錄
            window_start = now - self.window_seconds
            self.history[key] = [t for t in self.history[key] if t > window_start]
            
            if len(self.history[key]) >= self.requests_limit:
                logger.warning(
                    "Rate limit exceeded for client %r on limiter %r. Limit: %d/%ds",
                    key, self.name, self.requests_limit, self.window_seconds
                )
                return False
            
            self.history[key].append(now)
            return True

# 預設限流實例：
# 1. 全域限流：每分鐘最多 120 次請求
global_limiter = RateLimiter(requests_limit=120, window_seconds=60, name="global")

# 2. 敏感操作限流（如上傳、AI分析、Email寄送）：每分鐘最多 10 次
sensitive_limiter = RateLimiter(requests_limit=10, window_seconds=60, name="sensitive")

# 3. 登入 / 註冊限流：每個來源 IP 五分鐘最多 10 次。
#    數字取「打錯幾次密碼是正常的」跟「猜密碼要划不來」之間 ——
#    十次夠一個記不清大小寫的人試完，而每五分鐘十次要猜穿一組密碼是不可能的。
auth_limiter = RateLimiter(requests_limit=10, window_seconds=300, name="auth")


async def rate_limit(request: Request):
    """全域 API 限流相依項"""
    # 優先使用 X-User-Id，次之為 IP
    user_id = request.headers.get("x-user-id") or request.client.host or "unknown"
    if not global_limiter.is_allowed(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="系統收到太多您的請求，請稍後再試。"
        )


def _client_ip(request: Request) -> str:
    """只認連線來源，**不看任何 header**。

    這是這支限流器跟上面兩支的關鍵差別：`rate_limit` / `sensitive_rate_limit`
    用 `X-User-Id` 當 key，而那個 header 是**客戶端自己填的** ——
    對已登入的使用者當配額標籤沒問題（他沒有動機去偽造自己的配額），
    但拿來擋猜密碼就等於沒擋：每猜一次換一個 X-User-Id 就換到一份新配額。
    所以登入這條路只能用 request.client.host。

    這麼做擋不住手上有一整片 IP 的攻擊者 —— 那需要另外做「同一個帳號被猜」
    的計數，而那又會變成一種把帳號鎖死的騷擾手段。以這個專案的定位
    （內網 / 單人 / 小團隊）來說，按來源 IP 擋住的是實際會發生的那一種。
    """
    client = request.client
    return (client.host if client else None) or "unknown"


async def auth_rate_limit(request: Request):
    """登入 / 註冊限流 —— 這兩個端點在 ENABLE_AUTH=True 時是唯一的入口，
    沒有限流的話密碼可以無限次猜。"""
    if not auth_limiter.is_allowed(_client_ip(request)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="嘗試次數過多，請等幾分鐘後再試。"
        )


async def sensitive_rate_limit(request: Request):
    """敏感端點（如 AI、寄信、上傳）限流相依項"""
    user_id = request.headers.get("x-user-id") or request.client.host or "unknown"
    
    # 檢查全域限流
    if not global_limiter.is_allowed(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="系統收到太多您的請求，請稍後再試。"
        )
        
    # 檢查敏感操作限流
    if not sensitive_limiter.is_allowed(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="此端點操作過於頻繁，請等待一分鐘後再試。"
        )
