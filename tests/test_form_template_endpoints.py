"""表單模板端點與填寫後寄送流程測試

執行：
    python -m pytest tests/test_form_template_endpoints.py -v
"""
import os
import sys
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# 使用測試用資料庫
_TEST_DB = "test_scanmail_temp.db"
os.environ["DATABASE_PATH"] = _TEST_DB

from app.config import get_settings
get_settings.cache_clear()

from app.database import init_db
from main import app
from app.models.form_template import FormTemplateModel, compute_form_fingerprint
from app.models.contact import ContactModel
from app.core.tasks import submit_task, get_task

@pytest.fixture(autouse=True)
def setup_db():
    """每個測試前初始化資料庫"""
    os.environ["DATABASE_PATH"] = _TEST_DB
    get_settings.cache_clear()
    init_db()
    # Create a dummy contact
    ContactModel.create("test_user_123", "測試聯絡人", "test_contact@example.com", "電機系", "老師")
    yield
    if os.path.exists(_TEST_DB):
        try:
            os.remove(_TEST_DB)
        except OSError:
            pass

def test_template_crud_and_endpoints():
    client = TestClient(app)
    headers = {"X-User-Id": "test_user_123"}
    
    # 1. 初始狀態，模板清單應為空
    response = client.get("/api/tools/form/templates", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data["templates"]) == 0
    
    # 2. 儲存一個新模板
    fields = [
        {"name": "field_1", "label": "姓名", "field_type": "text", "page": 0, "bbox": [10, 20, 100, 40]},
        {"name": "field_2", "label": "Email", "field_type": "text", "page": 0, "bbox": [10, 50, 100, 70]},
    ]
    values = {"field_1": "預設姓名", "field_2": "test@example.com"}
    
    payload = {
        "name": "請假單模板",
        "fields": fields,
        "values": values
    }
    response = client.post("/api/tools/form/templates", json=payload, headers=headers)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["success"] is True
    assert "template_id" in res_data
    template_id = res_data["template_id"]
    
    # 3. 再次取得模板清單，應該有一筆
    response = client.get("/api/tools/form/templates", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data["templates"]) == 1
    assert data["templates"][0]["name"] == "請假單模板"
    assert data["templates"][0]["id"] == template_id
    
    # 4. 手動套用模板到新偵測的欄位 (以 bbox 微調或 label 匹配為例)
    new_fields = [
        {"name": "new_f1", "label": "姓名", "field_type": "text", "page": 0, "bbox": [12, 22, 98, 38]},
        {"name": "new_f2", "label": "Email", "field_type": "text", "page": 0, "bbox": [12, 52, 98, 68]},
    ]
    apply_payload = {
        "fields": new_fields
    }
    response = client.post(f"/api/tools/form/templates/{template_id}/apply", json=apply_payload, headers=headers)
    assert response.status_code == 200
    apply_data = response.json()
    assert apply_data["template_name"] == "請假單模板"
    assert "new_f1" in apply_data["values"]
    assert apply_data["values"]["new_f1"] == "預設姓名"
    assert apply_data["values"]["new_f2"] == "test@example.com"
    
    # 5. 自動套用特徵匹配: 透過 /suggest 端點
    suggest_payload = {
        "fields": new_fields
    }
    response = client.post("/api/tools/form/suggest", json=suggest_payload, headers=headers)
    assert response.status_code == 200
    suggest_data = response.json()
    assert suggest_data["matched_template"] is not None
    assert suggest_data["matched_template"]["id"] == template_id
    assert suggest_data["values"]["new_f1"] == "預設姓名"
    
    # 6. 刪除模板
    response = client.delete(f"/api/tools/form/templates/{template_id}", headers=headers)
    assert response.status_code == 200
    
    # 驗證已空
    response = client.get("/api/tools/form/templates", headers=headers)
    assert len(response.json()["templates"]) == 0

def test_send_email_from_task(monkeypatch):
    client = TestClient(app)
    headers = {"X-User-Id": "test_user_123"}
    
    fake_pdf = b"%PDF-1.4 test file"
    def mock_run_fill(task_id, data, fields, values):
        return fake_pdf
        
    task_id = submit_task(mock_run_fill, b"dummy", [], {})
    task = get_task(task_id)
    task.status = task.status.COMPLETED
    task.result = fake_pdf
    
    sent_emails = []
    async def mock_send_email(**kwargs):
        sent_emails.append(kwargs)
        return {"success": True, "message": "發送成功"}
        
    import app.routers.form_tools as form_tools_module
    monkeypatch.setattr(form_tools_module, "send_email", mock_send_email)
    
    contacts = ContactModel.list_by_user("test_user_123")
    assert len(contacts) > 0
    cid = contacts[0]["id"]
    
    send_payload = {
        "contact_ids": [cid],
        "subject": "自訂信件標題",
        "body": "這是測試信件正文",
        "filename": "my_filled_form.pdf"
    }
    
    response = client.post(f"/api/tools/form/task/{task_id}/send", json=send_payload, headers=headers)
    assert response.status_code == 200
    res = response.json()
    assert res["success"] is True
    assert res["success_count"] == 1
    
    assert len(sent_emails) == 1
    assert sent_emails[0]["recipient_email"] == "test_contact@example.com"
    assert sent_emails[0]["subject"] == "自訂信件標題"
    assert sent_emails[0]["pdf_bytes"] == fake_pdf
    assert sent_emails[0]["filename"] == "my_filled_form.pdf"
