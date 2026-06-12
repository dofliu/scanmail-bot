"""掃描與表單填寫工作階段橋接整合測試

執行：
    python -m pytest tests/test_scan_to_form_integration.py -v
"""
import os
import sys
import io
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from PIL import Image

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

_TEST_DB = "test_scanmail_temp.db"
os.environ["DATABASE_PATH"] = _TEST_DB

from app.config import get_settings
get_settings.cache_clear()

from app.database import init_db
from main import app
from app.core.sessions import get_session
from app.models.form_template import FormTemplateModel


def _create_test_image(width=800, height=600, color="white") -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def setup_db():
    os.environ["DATABASE_PATH"] = _TEST_DB
    get_settings.cache_clear()
    init_db()
    yield
    if os.path.exists(_TEST_DB):
        try:
            os.remove(_TEST_DB)
        except OSError:
            pass


def test_detect_from_scan_no_data():
    client = TestClient(app)
    headers = {"X-User-Id": "test_user_scan"}
    
    # 呼叫 /detect_from_scan，應回傳 400，因為 session 裡沒有任何影像
    response = client.post("/api/tools/form/detect_from_scan", headers=headers)
    assert response.status_code == 400
    assert "沒有任何文件" in response.json()["detail"]


def test_detect_from_scan_with_single_page(monkeypatch):
    client = TestClient(app)
    headers = {"X-User-Id": "test_user_scan"}
    
    # Setup scan session data
    session = get_session("test_user_scan")
    session.image_data = _create_test_image()
    session.ai_result = {"filename": "test_invoice"}
    
    # Mock detect_fields to return a dummy result to avoid actual OCR/pdfplumber
    from app.services.form_fill import DetectionResult, FormField
    from app.services.form_fill.schema import Backend
    
    dummy_fields = [
        FormField(name="f1", label="Name", field_type="text", page=0, bbox=(10, 20, 100, 30), confidence=1.0),
        FormField(name="f2", label="Date", field_type="text", page=0, bbox=(10, 50, 100, 60), confidence=1.0)
    ]
    
    def mock_detect_fields(pdf_data, hint=None):
        return DetectionResult(
            fields=dummy_fields,
            backend_used=Backend.ACROFORM,
            page_count=1
        )
        
    import app.routers.form_tools as form_tools_module
    monkeypatch.setattr(form_tools_module, "detect_fields", mock_detect_fields)
    
    response = client.post("/api/tools/form/detect_from_scan", headers=headers)
    assert response.status_code == 200
    
    data = response.json()
    assert "session_token" in data
    assert data["filename"] == "test_invoice.pdf"
    assert len(data["result"]["fields"]) == 2
    assert data["result"]["fields"][0]["label"] == "Name"
    assert data["matched_template"] is None


def test_detect_from_scan_with_template_matching(monkeypatch):
    client = TestClient(app)
    headers = {"X-User-Id": "test_user_scan"}
    
    # Pre-create a template matching the fingerprint of our dummy fields
    fields_raw = [
        {"name": "f1", "label": "Name", "field_type": "text", "page": 0, "bbox": [10, 20, 100, 30]},
        {"name": "f2", "label": "Date", "field_type": "text", "page": 0, "bbox": [10, 50, 100, 60]}
    ]
    values = {"f1": "測試名稱", "f2": "2026/06/12"}
    
    FormTemplateModel.upsert(
        user_id="test_user_scan",
        name="收據模板",
        fields=fields_raw,
        values=values
    )
    
    # Setup scan session data
    session = get_session("test_user_scan")
    session.pages = [_create_test_image()] # Using pages list
    session.ai_result = {"filename": "receipt"}
    
    # Mock detect_fields to return the matching fields
    from app.services.form_fill import DetectionResult, FormField
    from app.services.form_fill.schema import Backend
    
    dummy_fields = [
        FormField(name="f1", label="Name", field_type="text", page=0, bbox=(10, 20, 100, 30), confidence=1.0),
        FormField(name="f2", label="Date", field_type="text", page=0, bbox=(10, 50, 100, 60), confidence=1.0)
    ]
    
    def mock_detect_fields(pdf_data, hint=None):
        return DetectionResult(
            fields=dummy_fields,
            backend_used=Backend.ACROFORM,
            page_count=1
        )
        
    import app.routers.form_tools as form_tools_module
    monkeypatch.setattr(form_tools_module, "detect_fields", mock_detect_fields)
    
    response = client.post("/api/tools/form/detect_from_scan", headers=headers)
    assert response.status_code == 200
    
    data = response.json()
    assert data["matched_template"] is not None
    assert data["matched_template"]["name"] == "收據模板"
    assert data["filename"] == "receipt.pdf"
