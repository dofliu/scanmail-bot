"""Unit tests for PaddleOCR backend implementation.

Run with:
    pytest tests/test_paddle_ocr.py
"""
import pytest
import numpy as np
from PIL import Image
import io

from app.services.form_fill.schema import Backend
from app.services.form_fill.backends import paddle_structure


def test_paddle_ocr_is_available_when_not_installed(monkeypatch):
    """Verify is_available returns False when paddleocr/paddle package is not installed or mocked out."""
    # Temporarily hide paddleocr from importlib.util.find_spec
    import importlib.util
    original_find_spec = importlib.util.find_spec

    def mock_find_spec(name):
        if name in ("paddleocr", "paddle"):
            return None
        return original_find_spec(name)

    monkeypatch.setattr(importlib.util, "find_spec", mock_find_spec)
    
    # Clear cache to force a re-evaluation
    paddle_structure._AVAILABILITY_CACHE = None
    
    assert paddle_structure.is_available() is False


def test_paddle_ocr_detect_not_implemented_if_unavailable(monkeypatch):
    """Verify detect raises NotImplementedError if paddleocr is not available."""
    monkeypatch.setattr(paddle_structure, "is_available", lambda: False)
    
    with pytest.raises(NotImplementedError) as excinfo:
        paddle_structure.detect([b"dummy_image"], [(100, 100)])
    assert "PaddleOCR backend 尚未實作或未安裝" in str(excinfo.value)


def test_paddle_ocr_detect_success(monkeypatch):
    """Verify detection, coordinate mapping, and table cell matching logic using mocked PPStructure."""
    monkeypatch.setattr(paddle_structure, "is_available", lambda: True)
    
    # Mock result returned by engine(img)
    mock_result = [
        # 1. Text block with label "姓名："
        {
            'type': 'text',
            'bbox': [100, 100, 200, 130],
            'res': [
                {
                    'text': '姓名：',
                    'confidence': 0.99,
                    'text_region': [[100, 100], [200, 100], [200, 130], [100, 130]]
                }
            ]
        },
        # 2. Table block
        {
            'type': 'table',
            'bbox': [100, 200, 500, 400],
            'res': {
                'cell_box_list': [
                    [100, 200, 200, 200, 200, 250, 100, 250],  # Cell 0: Label (姓名)
                    [200, 200, 400, 200, 400, 250, 200, 250],  # Cell 1: Right blank cell
                    [100, 250, 200, 250, 200, 300, 100, 300],  # Cell 2: Label (日期)
                    [100, 300, 200, 300, 200, 350, 100, 350],  # Cell 3: Bottom blank cell
                ],
                'table_ocr_pred': {
                    'boxes': [
                        [[105, 205], [195, 205], [195, 245], [105, 245]],  # In Cell 0
                        [[105, 255], [195, 255], [195, 295], [105, 295]],  # In Cell 2
                    ],
                    'rec_res': [
                        ('姓名', 0.99),
                        ('日期', 0.99),
                    ]
                }
            }
        }
    ]

    class MockEngine:
        def __call__(self, img_np):
            return mock_result

    # Mock get_engine to return our MockEngine
    monkeypatch.setattr(paddle_structure, "get_engine", lambda: MockEngine())

    # Create a dummy image
    img = Image.new("RGB", (1000, 1000), "white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    # Call detect
    page_sizes_pts = [(595.0, 842.0)]
    result = paddle_structure.detect([img_bytes], page_sizes_pts)

    assert result.backend_used == Backend.PADDLE
    assert result.page_count == 1
    
    # Check fields
    # Expected fields:
    # 1. Text field "姓名" (from table right-adjacent cell)
    # 2. Text field "日期" (from table bottom-adjacent cell)
    # 3. Text field "姓名" (from text block)
    assert len(result.fields) == 3
    
    # First field: 姓名 (Table)
    field1 = result.fields[0]
    assert field1.label == "姓名"
    assert field1.field_type == "text"
    assert field1.page == 0
    assert field1.backend == Backend.PADDLE
    # Cell 1: [200, 200, 400, 250]
    # scale_x = 595 / 1000 = 0.595, scale_y = 842 / 1000 = 0.842
    # tx0 = 200 * 0.595 = 119.0
    # tx1 = 400 * 0.595 = 238.0
    # ty0 = 842.0 - 250 * 0.842 = 631.5
    # ty1 = 842.0 - 200 * 0.842 = 673.6
    assert pytest.approx(field1.bbox[0]) == 119.0
    assert pytest.approx(field1.bbox[1]) == 631.5
    assert pytest.approx(field1.bbox[2]) == 238.0
    assert pytest.approx(field1.bbox[3]) == 673.6

    # Second field: 日期 (Table)
    field2 = result.fields[1]
    assert field2.label == "日期"
    assert field2.field_type == "date"
    assert field2.page == 0
    assert field2.backend == Backend.PADDLE
    # Cell 3: [100, 300, 200, 350]
    # tx0 = 100 * 0.595 = 59.5
    # tx1 = 200 * 0.595 = 119.0
    # ty0 = 842.0 - 350 * 0.842 = 547.3
    # ty1 = 842.0 - 300 * 0.842 = 589.4
    assert pytest.approx(field2.bbox[0]) == 59.5
    assert pytest.approx(field2.bbox[1]) == 547.3
    assert pytest.approx(field2.bbox[2]) == 119.0
    assert pytest.approx(field2.bbox[3]) == 589.4

    # Third field: 姓名 (Text Block)
    field3 = result.fields[2]
    assert field3.label == "姓名"
    assert field3.field_type == "text"
    assert field3.page == 0
    assert field3.backend == Backend.PADDLE
    # Text block: [100, 100, 200, 130]
    # tx0 = 200 * 0.595 + 4 = 123.0
    # tx1 = 200 * 0.595 + 200 = 319.0
    # ty0 = 842.0 - 130 * 0.842 = 732.54
    # ty1 = 842.0 - 100 * 0.842 = 757.8
    assert pytest.approx(field3.bbox[0]) == 123.0
    assert pytest.approx(field3.bbox[1]) == 732.54
    assert pytest.approx(field3.bbox[2]) == 319.0
    assert pytest.approx(field3.bbox[3]) == 757.8
