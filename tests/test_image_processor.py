"""圖片處理測試"""
import io
import os
import sys
import pytest
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.image_processor import (
    validate_image,
    optimize_image,
    image_to_pdf,
    get_image_info,
)


def _create_test_image(width=800, height=600, color="red") -> bytes:
    """建立測試用圖片"""
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class TestImageProcessor:

    def test_validate_valid_image(self):
        data = _create_test_image()
        is_valid, msg = validate_image(data)
        assert is_valid

    def test_validate_oversized_image(self):
        # 產生超過 10MB 的資料
        data = b"x" * (11 * 1024 * 1024)
        is_valid, msg = validate_image(data)
        assert not is_valid
        assert "過大" in msg

    def test_validate_invalid_format(self):
        is_valid, msg = validate_image(b"not an image")
        assert not is_valid

    def test_optimize_image(self):
        data = _create_test_image(3000, 4000)
        optimized = optimize_image(data, max_dimension=1000)
        img = Image.open(io.BytesIO(optimized))
        assert max(img.size) <= 1000

    def test_image_to_pdf(self):
        data = _create_test_image()
        pdf = image_to_pdf(data)
        assert pdf[:4] == b"%PDF"

    def test_get_image_info(self):
        data = _create_test_image(800, 600)
        info = get_image_info(data)
        assert info["width"] == 800
        assert info["height"] == 600
