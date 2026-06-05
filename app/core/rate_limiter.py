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


async def rate_limit(request: Request):
    """全域 API 限流相依項"""
    # 優先使用 X-User-Id，次之為 IP
    user_id = request.headers.get("x-user-id") or request.client.host or "unknown"
    if not global_limiter.is_allowed(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="系統收到太多您的請求，請稍後再試。"
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
