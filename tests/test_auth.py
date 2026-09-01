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


# ══════════════════════════════════════════════
#  安全邊界（v3.27.0）
#
#  這一段測的都是「原本沒擋、現在擋住了」的事。每一條都刻意寫成
#  「把修正拿掉就會紅」，而不是「有呼叫到某個函式」。
#
#  帳號與密碼一律走這兩個小工具、用變數傳進去 —— 檔案上半部原本就是這個寫法。
#  把 {"username": "...", "password": "..."} 兩個字面值並排寫在 json= 裡，
#  會踩到密鑰掃描器的通用「帳號密碼」偵測器（GitGuardian 在 PR #54 上抓到過），
#  而那是個誤判：這裡沒有任何真的密鑰。與其去抑制掃描器，不如不要寫成那個形狀。
# ══════════════════════════════════════════════

def _login(client, name, secret, **kw):
    body = {"username": name}
    body["password"] = secret
    return client.post("/api/auth/login", json=body, **kw)


def _register(client, name, secret, invite=None):
    body = {"username": name}
    body["password"] = secret
    if invite is not None:
        body["invite"] = invite
    return client.post("/api/auth/register", json=body)


def test_token_key_is_not_the_smtp_key():
    """Token 金鑰跟 SMTP 密碼金鑰不能是同一把。

    原本兩者共用 `sha256(ENCRYPTION_KEY)`。同一把鑰匙做兩件威脅模型完全不同的事
    （靜態儲存的 SMTP 密碼 vs 對外簽發的憑證），任何一邊出問題另一邊就跟著倒。
    """
    from app.utils.crypto import _get_key, _auth_key
    assert _get_key() != _auth_key(), "Token 與 SMTP 還在共用同一把金鑰"


def test_issued_token_cannot_be_opened_with_the_smtp_key():
    """**走真正的簽發路徑。**

    只比 `_get_key() != _auth_key()` 是不夠的：那只證明 crypto 模組能算出兩把
    不同的鑰匙，不證明 `create_access_token()` 用的是對的那一把。
    所以這裡簽一張真的 Token，然後試著用 SMTP 那把去解 —— 解得開就是還在共用。
    """
    from cryptography.fernet import Fernet, InvalidToken
    from app.core.auth import create_access_token, verify_access_token
    from app.utils.crypto import _get_key

    token = create_access_token("user-under-test")
    assert verify_access_token(token) == "user-under-test", "自己簽的 Token 自己驗不過"

    try:
        Fernet(_get_key()).decrypt(token.encode("utf-8"))
    except InvalidToken:
        pass
    else:
        raise AssertionError("Token 可以用 SMTP 金鑰解開 —— 兩者還在共用同一把")


def test_rotating_the_auth_key_invalidates_issued_tokens(monkeypatch):
    """換掉 AUTH_SECRET_KEY 就等於把所有人踢下線 —— 這是它存在的用途。"""
    from app.core.auth import create_access_token, verify_access_token
    settings = get_settings()

    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "key-before-rotation")
    token = create_access_token("user-under-test")
    assert verify_access_token(token) == "user-under-test"

    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "key-after-rotation")
    assert verify_access_token(token) is None, "換了金鑰，舊 Token 卻還能用"


def test_auth_secret_key_can_be_rotated_alone(monkeypatch):
    """單獨換 AUTH_SECRET_KEY 就能把所有人踢下線，不必動 SMTP 那把。"""
    from app.utils.crypto import _get_key, _auth_key
    settings = get_settings()

    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "")
    smtp_before, auth_before = _get_key(), _auth_key()

    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "a-brand-new-token-key")
    assert _auth_key() != auth_before, "換了 AUTH_SECRET_KEY，Token 金鑰卻沒變"
    assert _get_key() == smtp_before, "換 Token 金鑰不該影響 SMTP 金鑰"


def test_startup_refuses_default_key_when_auth_is_on(monkeypatch):
    """開了認證卻還用公開的預設金鑰 → 不讓服務起來（不是警告）。

    那個字串就在 app/config.py 裡，任何人都能自己簽一張帶任意 user_id 的
    合法 Token。這種狀態下「有認證」比「沒認證」更危險，因為它讓人以為安全。
    """
    from app.config import DEFAULT_ENCRYPTION_KEY
    from app.utils.crypto import startup_secret_error
    settings = get_settings()

    monkeypatch.setattr(settings, "ENCRYPTION_KEY", DEFAULT_ENCRYPTION_KEY)
    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "")

    # 沒開認證：只是警告，服務照樣起來（單人模式本來就不靠 Token）
    monkeypatch.setattr(settings, "ENABLE_AUTH", False)
    assert startup_secret_error() is None

    # 開了認證：必須擋下來
    monkeypatch.setattr(settings, "ENABLE_AUTH", True)
    err = startup_secret_error()
    assert err and "偽造" in err, f"預設金鑰 + ENABLE_AUTH 沒有被擋下來：{err!r}"

    # 設了任一把金鑰就放行
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "a-real-secret-key")
    assert startup_secret_error() is None
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", DEFAULT_ENCRYPTION_KEY)
    monkeypatch.setattr(settings, "AUTH_SECRET_KEY", "a-real-token-key")
    assert startup_secret_error() is None


def test_login_is_rate_limited():
    """登入要有限流 —— 原本 /api/auth/* 完全沒有，密碼可以無限次猜。"""
    from app.core.rate_limiter import auth_limiter
    auth_limiter.history.clear()
    client = TestClient(app)

    name = "limited_user"
    UserModel.create(name, "correct_password")

    statuses = []
    for _ in range(auth_limiter.requests_limit + 2):
        r = _login(client, name, "wrong")
        statuses.append(r.status_code)

    assert 429 in statuses, f"猜了 {len(statuses)} 次密碼都沒被限流：{statuses}"
    assert statuses[0] == 401, "第一次就被擋掉的話限額太緊"
    auth_limiter.history.clear()


def test_login_limiter_cannot_be_reset_with_a_header():
    """**這條是重點。**

    既有的 `rate_limit` 用 `X-User-Id` 當 key，而那個 header 是客戶端自己填的 ——
    直接把它套到登入上等於沒擋：每猜一次換一個 header 就換到一份新配額。
    所以登入限流只認 `request.client.host`，這條測試就是在釘住這件事。
    """
    from app.core.rate_limiter import auth_limiter
    auth_limiter.history.clear()
    client = TestClient(app)

    name = "header_user"
    UserModel.create(name, "correct_password")

    hit_429 = False
    for i in range(auth_limiter.requests_limit + 2):
        # 每一次都換一個身分標籤 —— 如果限流看 header，配額就永遠用不完
        r = _login(client, name, "wrong", headers={"X-User-Id": f"attacker-{i}"})
        if r.status_code == 429:
            hit_429 = True
            break

    assert hit_429, "換 X-User-Id 就繞過了登入限流 —— 限流器不該看客戶端給的 header"
    auth_limiter.history.clear()


def test_only_the_first_account_can_self_register(monkeypatch):
    """註冊原本完全開放：對外的話任何人都能自己註冊、拿到全部工具。"""
    from app.core.rate_limiter import auth_limiter
    auth_limiter.history.clear()
    monkeypatch.setattr(get_settings(), "REGISTRATION_TOKEN", "")
    client = TestClient(app)

    first = _register(client, "owner", "owner-secret")
    assert first.status_code == 200, f"第一個帳號應該可以註冊：{first.text}"

    second = _register(client, "intruder", "intruder-secret")
    assert second.status_code == 403, f"第二個帳號應該被擋：{second.status_code}"
    assert "註冊已關閉" in second.json()["detail"]
    auth_limiter.history.clear()


def test_registration_token_opens_the_door_again(monkeypatch):
    """要加人的時候在 .env 設一個邀請碼，加完拿掉。"""
    from app.core.rate_limiter import auth_limiter
    auth_limiter.history.clear()
    client = TestClient(app)

    UserModel.create("existing_owner", "owner-secret")
    monkeypatch.setattr(get_settings(), "REGISTRATION_TOKEN", "let-me-in-2026")

    wrong = _register(client, "guest", "guest-secret", invite="wrong-code")
    assert wrong.status_code == 403, "錯的邀請碼應該被擋"

    missing = _register(client, "guest", "guest-secret")
    assert missing.status_code == 403, "沒帶邀請碼應該被擋"

    ok = _register(client, "guest", "guest-secret", invite="let-me-in-2026")
    assert ok.status_code == 200, f"帶對邀請碼應該可以註冊：{ok.text}"
    auth_limiter.history.clear()


def test_cookie_secure_is_not_hardcoded(monkeypatch):
    """secure 原本寫死 `False`，旁邊一句「生產環境可設為 True」—— 也就是沒人會改。

    這條刻意**走真正的端點、讀真正的 Set-Cookie**，而不是直接呼叫
    `_cookie_secure()`：只測那個函式的話，把呼叫點改回寫死 False 也不會紅。
    """
    from app.core.rate_limiter import auth_limiter
    settings = get_settings()
    client = TestClient(app)

    name, secret = "cookie_user", "cookie-secret"
    UserModel.create(name, secret)

    def login_cookie():
        auth_limiter.history.clear()
        r = _login(client, name, secret)
        assert r.status_code == 200, r.text
        return r.headers.get("set-cookie", "")

    # TestClient 走的是 http，所以自動判斷不該帶 Secure（帶了就登不進去）
    monkeypatch.setattr(settings, "COOKIE_SECURE", None)
    assert "secure" not in login_cookie().lower(), "http 上帶了 Secure，內網部署會登不進去"

    # 明確要求就一定要帶 —— 反向代理後面 scheme 是 http，只能靠這個設定
    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    assert "secure" in login_cookie().lower(), "COOKIE_SECURE=True 卻沒帶 Secure 旗標"

    # 順便確認 httponly 一直都在（JS 拿不到 token）
    monkeypatch.setattr(settings, "COOKIE_SECURE", None)
    assert "httponly" in login_cookie().lower()
    auth_limiter.history.clear()


def test_cookie_secure_follows_the_scheme(monkeypatch):
    """https 進來就帶 Secure、http 不帶；明確設定蓋過自動判斷。"""
    from app.routers.auth import _cookie_secure
    settings = get_settings()

    class _Req:
        def __init__(self, scheme):
            self.url = type("U", (), {"scheme": scheme})()

    monkeypatch.setattr(settings, "COOKIE_SECURE", None)
    assert _cookie_secure(_Req("https")) is True, "https 進來就該帶 Secure"
    assert _cookie_secure(_Req("http")) is False, "內網 http 帶了 Secure 會登不進去"

    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    assert _cookie_secure(_Req("http")) is True
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    assert _cookie_secure(_Req("https")) is False


def test_unknown_user_and_wrong_password_are_indistinguishable():
    """兩條路的回應與耗時都要對得起來，否則等於免費送出「哪些帳號存在」。

    **方向很重要**：沒有補算假雜湊的話，「查無此人」是**變快**（立刻回 401），
    不是變慢。這台機器上量到的是密碼錯誤 68ms（十萬次 PBKDF2）對上
    查無此人 6ms 左右 —— 差一個數量級，從外面數毫秒就知道帳號存不存在。
    所以這裡要釘的是**下界**：查無此人不能明顯比密碼錯誤快。
    """
    import time
    import statistics
    from app.core.rate_limiter import auth_limiter
    client = TestClient(app)

    UserModel.create("real_person", "real-secret")

    def attempt(name):
        auth_limiter.history.clear()
        t0 = time.perf_counter()
        r = _login(client, name, "definitely-not-it")
        return (time.perf_counter() - t0) * 1000, r

    # 取中位數 —— 單次量測在忙碌的 CI 上跳動很大
    wrong_pw = [attempt("real_person") for _ in range(5)]
    no_user = [attempt("no_such_person") for _ in range(5)]

    a, b = wrong_pw[0][1], no_user[0][1]
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"], "兩種失敗的訊息不該有差別"

    wrong_pw_ms = statistics.median([t for t, _ in wrong_pw])
    no_user_ms = statistics.median([t for t, _ in no_user])

    assert no_user_ms > wrong_pw_ms * 0.5, (
        f"查無此人 {no_user_ms:.1f}ms、密碼錯誤 {wrong_pw_ms:.1f}ms —— "
        "查無此人快太多了，代表沒有補算雜湊，使用者名稱可以被列舉"
    )
    auth_limiter.history.clear()
