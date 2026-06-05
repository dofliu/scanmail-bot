"""API Rate Limiting 測試"""
import pytest
from fastapi.testclient import TestClient
from main import app
from app.core.rate_limiter import RateLimiter, global_limiter, sensitive_limiter

def test_rate_limiter_logic():
    """測試 RateLimiter 的核心限流邏輯"""
    limiter = RateLimiter(requests_limit=3, window_seconds=2, name="test")
    
    # 前 3 次請求應通過
    assert limiter.is_allowed("user_a") is True
    assert limiter.is_allowed("user_a") is True
    assert limiter.is_allowed("user_a") is True
    
    # 第 4 次請求應被限流
    assert limiter.is_allowed("user_a") is False
    
    # 另一個使用者應不受影響
    assert limiter.is_allowed("user_b") is True


def test_rate_limiter_api_integration(monkeypatch):
    """測試 API 端點套用 RateLimiter 後的行為"""
    # 備份與重設全域限流次數
    old_limit = global_limiter.requests_limit
    monkeypatch.setattr(global_limiter, "requests_limit", 2)
    
    # 清空歷史紀錄以防測試互相干擾
    global_limiter.history.clear()
    
    client = TestClient(app)
    headers = {"X-User-Id": "test_limiter_user"}
    
    # 第 1 次請求
    response = client.get("/api/test-prompt", headers=headers)
    assert response.status_code == 200
    
    # 第 2 次請求
    response = client.get("/api/test-prompt", headers=headers)
    assert response.status_code == 200
    
    # 第 3 次請求應觸發 429
    response = client.get("/api/test-prompt", headers=headers)
    assert response.status_code == 429
    assert "收到太多" in response.json()["detail"]


def test_sensitive_rate_limiter_api_integration(monkeypatch):
    """測試敏感端點（如 /api/upload）的雙重限流"""
    # 限制敏感操作限流次數為 1
    monkeypatch.setattr(sensitive_limiter, "requests_limit", 1)
    
    # 清空歷史紀錄
    global_limiter.history.clear()
    sensitive_limiter.history.clear()
    
    client = TestClient(app)
    headers = {"X-User-Id": "test_sensitive_user"}
    
    # 準備一個空的或極小的上傳檔案
    file_data = b"fake image bytes"
    
    # 第 1 次上傳
    response = client.post(
        "/api/upload",
        files={"file": ("test.jpg", file_data, "image/jpeg")},
        headers=headers
    )
    # 這裡可能回傳 200 或其他（因為是假資料，但重點是 429 之前）
    # 如果 validate_image 失敗會是 400，但它必定已經通過了 limiter 的檢查
    assert response.status_code in (200, 400)
    
    # 第 2 次上傳應被敏感限流攔截，直接回傳 429
    response = client.post(
        "/api/upload",
        files={"file": ("test.jpg", file_data, "image/jpeg")},
        headers=headers
    )
    assert response.status_code == 429
    assert "頻繁" in response.json()["detail"]
