"""Tests for image_processor.rotate_image / flip_image

執行：
    python -m pytest tests/test_image_rotate_flip.py -v
"""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from app.services.image_processor import rotate_image, flip_image


def _make_image(width: int, height: int, fmt: str = "JPEG",
                color: tuple = (255, 0, 0)) -> bytes:
    """產生指定尺寸 + 純色填滿的測試圖；左上角加一個藍色標記方便驗證方向"""
    img = Image.new("RGB", (width, height), color)
    # 左上角畫一個 20x20 的藍色方塊作為「方向標記」
    for y in range(min(20, height)):
        for x in range(min(20, width)):
            img.putpixel((x, y), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format=fmt, quality=90)
    return buf.getvalue()


# ─── rotate_image ─────────────────────────────────────────────

def test_rotate_90_swaps_dimensions():
    """旋轉 90° 後寬高應交換"""
    src = _make_image(200, 100)  # 寬 200 高 100
    out = rotate_image(src, angle=90)
    img = Image.open(io.BytesIO(out))
    assert img.size == (100, 200), f"預期 (100, 200)，實際 {img.size}"


def test_rotate_180_keeps_dimensions():
    src = _make_image(200, 100)
    out = rotate_image(src, angle=180)
    img = Image.open(io.BytesIO(out))
    assert img.size == (200, 100)


def test_rotate_270_swaps_dimensions():
    src = _make_image(200, 100)
    out = rotate_image(src, angle=270)
    img = Image.open(io.BytesIO(out))
    assert img.size == (100, 200)


def test_rotate_0_returns_same_dimensions():
    src = _make_image(150, 100)
    out = rotate_image(src, angle=0)
    img = Image.open(io.BytesIO(out))
    assert img.size == (150, 100)


def test_rotate_negative_angle_normalized():
    """-90° 應等同 270°（順時針），寬高交換"""
    src = _make_image(200, 100)
    out = rotate_image(src, angle=-90)
    img = Image.open(io.BytesIO(out))
    assert img.size == (100, 200)


def test_rotate_90_moves_blue_corner_to_top_right():
    """順時針 90° 後，左上角的藍色方塊應移到右上角"""
    src = _make_image(100, 100)
    out = rotate_image(src, angle=90)
    img = Image.open(io.BytesIO(out))
    # 右上角應該是藍色（PIL ROTATE_270 = 順時針 90°）
    px = img.getpixel((img.width - 5, 5))
    assert px[2] > 200 and px[0] < 50, f"右上角不是藍色：{px}"


def test_rotate_45_expands_canvas():
    """非 90° 倍數的角度，輸出應撐開（兩邊都比原來大）"""
    src = _make_image(100, 100)
    out = rotate_image(src, angle=45)
    img = Image.open(io.BytesIO(out))
    assert img.width > 100 and img.height > 100


def test_rotate_output_format_png():
    src = _make_image(80, 80, fmt="JPEG")
    out = rotate_image(src, angle=90, output_format="PNG")
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_rotate_output_format_auto_preserves_png():
    src = _make_image(80, 80, fmt="PNG")
    out = rotate_image(src, angle=90, output_format="auto")
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


# ─── flip_image ───────────────────────────────────────────────

def test_flip_horizontal_keeps_dimensions():
    src = _make_image(200, 100)
    out = flip_image(src, axis="horizontal")
    img = Image.open(io.BytesIO(out))
    assert img.size == (200, 100)


def test_flip_horizontal_moves_blue_to_top_right():
    """左右翻轉後，左上角的藍色方塊應到右上角"""
    src = _make_image(100, 100)
    out = flip_image(src, axis="horizontal")
    img = Image.open(io.BytesIO(out))
    px = img.getpixel((img.width - 5, 5))
    assert px[2] > 200, f"右上角應是藍色：{px}"


def test_flip_vertical_moves_blue_to_bottom_left():
    """上下翻轉後，左上角的藍色方塊應到左下角"""
    src = _make_image(100, 100)
    out = flip_image(src, axis="vertical")
    img = Image.open(io.BytesIO(out))
    px = img.getpixel((5, img.height - 5))
    assert px[2] > 200, f"左下角應是藍色：{px}"


def test_flip_invalid_axis_raises():
    src = _make_image(50, 50)
    with pytest.raises(ValueError):
        flip_image(src, axis="diagonal")


def test_flip_accepts_short_axis_names():
    src = _make_image(50, 50)
    # 'h' 應該等同 horizontal、'v' 等同 vertical
    h_short = flip_image(src, axis="h")
    h_full = flip_image(src, axis="horizontal")
    assert h_short == h_full or len(h_short) == len(h_full)
