import os
import pytest
from fastapi.testclient import TestClient
from app.config import get_settings
from app.database import init_db
from main import app
from app.models.user import UserModel, hash_password, verify_password

_TEST_DB = "test_auth_temp.db"


@pytest.fixture(autouse=True)
def setup_db():
    """每個測試前初始化資料庫"""
    os.environ["DATABASE_PATH"] = _TEST_DB
    get_settings.cache_clear()
    init_db()
    yield
    if os.path.exists(_TEST_DB):
        try:
            os.remove(_TEST_DB)
        except OSError:
            pass


def test_password_hashing():
    """測試密碼雜湊與驗證邏輯"""
    password = "secret_password"
    hashed = hash_password(password)
    
    assert hashed != password
    assert ":" in hashed
    
    assert verify_password(password, hashed) is True
    assert verify_password("wrong_password", hashed) is False
    assert verify_password(password, "invalid_hash_format") is False


def test_user_creation_and_lookup():
    """測試使用者資料庫新增與查尋"""
    username = "test_auth_user"
    password = "password123"
    
    # 清理可能殘留的測試帳號
    conn = pytest.importorskip("app.database").get_connection()
    try:
        conn.execute("DELETE FROM users WHERE username=?", (username,))
        conn.commit()
    finally:
        conn.close()
        
    # 新增使用者
    user_id = UserModel.create(username, password)
    assert user_id is not None
    
    # 重複註冊應失敗
    with pytest.raises(ValueError) as exc:
        UserModel.create(username, password)
    assert "已被註冊" in str(exc.value)
    
    # 依使用者名稱查詢
    user_by_name = UserModel.get_by_username(username)
    assert user_by_name is not None
    assert user_by_name["id"] == user_id
    assert verify_password(password, user_by_name["password_hash"])
    
    # 依 ID 查詢
    user_by_id = UserModel.get_by_id(user_id)
    assert user_by_id is not None
    assert user_by_id["username"] == username


def test_auth_api_endpoints(monkeypatch):
    """測試登冊、登入與狀態 API 整合"""
    client = TestClient(app)
    
    # 1. 確保測試帳號未被使用
    username = "api_test_user"
    password = "api_password"
    
    # 2. 測試註冊
    reg_response = client.post(
        "/api/auth/register",
        json={"username": username, "password": password}
    )
    # 若已存在則忽略 400，但若是 200 則驗證內容
    if reg_response.status_code == 200:
        data = reg_response.json()
        assert data["success"] is True
        assert "user_id" in data
        
    # 3. 測試登入
    login_response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password}
    )
    assert login_response.status_code == 200
    login_data = login_response.json()
    assert login_data["success"] is True
    assert "token" in login_data
    token = login_data["token"]
    
    # 4. 測試錯誤登入
    bad_login = client.post(
        "/api/auth/login",
        json={"username": username, "password": "wrong_password"}
    )
    assert bad_login.status_code == 401
    
    # 5. 測試登出
    logout_response = client.post("/api/auth/logout")
    assert logout_response.status_code == 200
    assert logout_response.json()["success"] is True


def test_auth_protection_flow(monkeypatch):
    """測試啟用與停用 ENABLE_AUTH 時的保護路由存取權"""
    settings = get_settings()
    client = TestClient(app)
    
    # 先測試停用認證狀態 (ENABLE_AUTH=False)
    monkeypatch.setattr(settings, "ENABLE_AUTH", False)
    
    # 未帶 Token 時，保護路由應可存取 (此處以 get contacts 為例，它需要保護)
    response = client.get("/api/contacts")
    # 應回傳 200 OK (可能為空清單，但不是 401)
    assert response.status_code == 200
    
    # 啟用認證狀態 (ENABLE_AUTH=True)
    monkeypatch.setattr(settings, "ENABLE_AUTH", True)
    
    # 未帶 Token 應回傳 401
    response = client.get("/api/contacts")
    assert response.status_code == 401
    assert "未提供認證 Token" in response.json()["detail"]
    
    # 帶入無效 Token 應回傳 401
    response = client.get(
        "/api/contacts",
        headers={"Authorization": "Bearer invalid_token_value"}
    )
    assert response.status_code == 401
    
    # 帶入有效 Token 應成功通過
    # 建立一個測試帳號並登入取得 token
    username = "flow_test_user"
    password = "flow_password"
    
    client.post(
        "/api/auth/register",
        json={"username": username, "password": password}
    )
    login_resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password}
    )
    token = login_resp.json()["token"]
    
    # 使用 Bearer Token 存取
    response = client.get(
        "/api/contacts",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
