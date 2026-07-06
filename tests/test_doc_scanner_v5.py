"""文件邊界偵測 v5 回歸測試

涵蓋：
- 合成場景的偵測精度（IoU / 角點誤差）與信心值
- 無文件影像的誤報抑制（信心低於自動裁切門檻）
- 次像素角點精修
- 透視幾何真實寬高比恢復（Zhang-He 法）
- EXIF 方向正規化
- API 契約（detect_document / detect_document_edges / scan_document）
"""
import io
import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ══════════════════════════════════════════════════════════════
# 合成場景工廠
# ══════════════════════════════════════════════════════════════

def _make_doc(w=420, h=600):
    """合成文件：白紙 + 文字行"""
    import cv2
    paper = np.full((h, w, 3), 245, np.uint8)
    y = int(h * 0.12)
    while y < h * 0.9:
        cv2.rectangle(paper, (int(w * 0.08), y),
                      (int(w * 0.85), y + int(h * 0.012)), (60, 60, 60), -1)
        y += int(h * 0.035)
    return paper


def _textured_bg(w=800, h=600, seed=7):
    """木紋風格背景（有紋理梯度 — 誤報測試的難點）"""
    rng = np.random.RandomState(seed)
    bg = np.zeros((h, w, 3), np.uint8)
    base = np.array([60, 100, 150])
    for yy in range(h):
        wobble = 20 * math.sin(yy / 23.0) + rng.randn() * 3
        bg[yy, :] = np.clip(base + wobble, 0, 255)
    noise = rng.randn(h, w, 1) * 8
    return np.clip(bg.astype(np.float32) + noise, 0, 255).astype(np.uint8)


def _scene(quad, w=800, h=600):
    """把合成文件用透視變換貼到紋理背景上，回傳 (jpg_bytes, gt_corners)"""
    import cv2
    doc = _make_doc()
    dh, dw = doc.shape[:2]
    src = np.array([[0, 0], [dw - 1, 0], [dw - 1, dh - 1], [0, dh - 1]], np.float32)
    dst = np.array(quad, np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    bg = _textured_bg(w, h)
    warped = cv2.warpPerspective(doc, M, (w, h))
    mask = cv2.warpPerspective(np.full((dh, dw), 255, np.uint8), M, (w, h))
    m = (mask > 0)[:, :, None].astype(np.float32)
    out = bg.astype(np.float32) * (1 - m) + warped.astype(np.float32) * m
    out = np.clip(out + np.random.RandomState(3).randn(h, w, 3) * 5, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return buf.tobytes(), quad


def _quad_iou(a, b, w, h):
    import cv2
    ma = np.zeros((h, w), np.uint8)
    mb = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(ma, np.array(a, np.int32), 1)
    cv2.fillConvexPoly(mb, np.array(b, np.int32), 1)
    union = np.logical_or(ma, mb).sum()
    return np.logical_and(ma, mb).sum() / union if union else 0.0


# ══════════════════════════════════════════════════════════════
# 偵測精度與信心
# ══════════════════════════════════════════════════════════════

class TestDetectionAccuracy:

    def test_mild_perspective_high_accuracy(self):
        from app.services.doc_scanner import detect_document
        quad = [[220, 60], [590, 75], [575, 545], [205, 530]]
        data, gt = _scene(quad)
        r = detect_document(data)
        assert r["corners"] is not None
        assert _quad_iou(r["corners"], gt, 800, 600) > 0.95
        assert r["confidence"] >= 0.45

    def test_strong_perspective_trapezoid_not_bounding_box(self):
        """大角度透視：必須貼合梯形，不能退化成外接矩形（v4 迴歸）"""
        from app.services.doc_scanner import detect_document, _order_points
        quad = [[290, 80], [510, 75], [610, 520], [190, 525]]
        data, gt = _scene(quad)
        r = detect_document(data)
        assert r["corners"] is not None
        assert _quad_iou(r["corners"], gt, 800, 600) > 0.93
        # 角點誤差（次像素精修後應在數 px 內）
        pred = _order_points(np.array(r["corners"], np.float32))
        gt_o = _order_points(np.array(gt, np.float32))
        err = float(np.mean(np.linalg.norm(pred - gt_o, axis=1)))
        assert err < 8.0

    def test_detect_document_contract(self):
        from app.services.doc_scanner import detect_document
        data, _ = _scene([[220, 60], [590, 75], [575, 545], [205, 530]])
        r = detect_document(data)
        assert set(r.keys()) == {"corners", "confidence", "method"}
        assert isinstance(r["confidence"], float)
        assert 0.0 <= r["confidence"] <= 1.0
        assert r["method"] is not None

    def test_detect_document_edges_backward_compat(self):
        from app.services.doc_scanner import detect_document_edges
        data, gt = _scene([[220, 60], [590, 75], [575, 545], [205, 530]])
        corners = detect_document_edges(data)
        assert corners is not None
        assert len(corners) == 4

    def test_invalid_image_returns_no_result(self):
        from app.services.doc_scanner import detect_document
        r = detect_document(b"not-an-image")
        assert r["corners"] is None
        assert r["confidence"] == 0.0


class TestFalsePositiveSuppression:

    def test_textured_background_low_confidence(self):
        """沒有文件的木紋背景：信心必須低於自動裁切門檻"""
        import cv2
        from app.services.doc_scanner import detect_document, MIN_AUTO_APPLY_CONFIDENCE
        img = _textured_bg(800, 600)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        r = detect_document(buf.tobytes())
        assert r["confidence"] < MIN_AUTO_APPLY_CONFIDENCE

    def test_scan_document_does_not_autocrop_without_document(self):
        """scan_document 對無文件影像不應自動裁切"""
        import cv2
        from app.services.doc_scanner import scan_document
        img = _textured_bg(800, 600)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        result = scan_document(buf.tobytes(), filter_name="original", auto_detect=True)
        assert result["auto_detected"] is False

    def test_scan_document_autocrops_real_document(self):
        from app.services.doc_scanner import scan_document
        data, gt = _scene([[220, 60], [590, 75], [575, 545], [205, 530]])
        result = scan_document(data, filter_name="original", auto_detect=True)
        assert result["auto_detected"] is True
        assert result["confidence"] >= 0.45
        # 裁切後尺寸應遠小於原圖（透視校正生效）
        pw, ph = result["processed_size"]
        assert pw < 800 and ph <= 600 * 1.2


# ══════════════════════════════════════════════════════════════
# 真實寬高比恢復
# ══════════════════════════════════════════════════════════════

def _project_rect(rect_w, rect_h, rx_deg, ry_deg, dist=0.6,
                  img_w=1600, img_h=1200, f=1400.0):
    """3D 矩形經針孔相機投影，回傳影像座標四角點"""
    rx, ry = math.radians(rx_deg), math.radians(ry_deg)
    pts3 = np.array([[-rect_w / 2, -rect_h / 2, 0], [rect_w / 2, -rect_h / 2, 0],
                     [rect_w / 2, rect_h / 2, 0], [-rect_w / 2, rect_h / 2, 0]], float)
    Rx = np.array([[1, 0, 0],
                   [0, math.cos(rx), -math.sin(rx)],
                   [0, math.sin(rx), math.cos(rx)]])
    Ry = np.array([[math.cos(ry), 0, math.sin(ry)],
                   [0, 1, 0],
                   [-math.sin(ry), 0, math.cos(ry)]])
    p = (Ry @ Rx @ pts3.T).T + np.array([0, 0, dist])
    return np.stack([f * p[:, 0] / p[:, 2] + img_w / 2,
                     f * p[:, 1] / p[:, 2] + img_h / 2], axis=1)


class TestAspectRecovery:

    @pytest.mark.parametrize("rx,ry", [(20, 5), (55, 10), (30, 25), (5, 3), (15, 15)])
    def test_two_point_perspective_exact(self, rx, ry):
        """兩點透視：焦距可觀測，恢復應非常精確"""
        from app.services.doc_scanner import _recover_true_aspect, _order_points
        uv = _project_rect(0.21, 0.297, rx, ry)  # A4 直式，w/h = 0.707
        rect = _order_points(uv.astype(np.float32))
        r = _recover_true_aspect(rect, 1600, 1200)
        assert r is not None
        assert abs(r - 0.707) < 0.02

    def test_one_point_perspective_reasonable(self):
        """一點透視：焦距不可觀測，用假設焦距 — 允許數 % 誤差"""
        from app.services.doc_scanner import _recover_true_aspect, _order_points
        uv = _project_rect(0.21, 0.297, 40, 0)
        rect = _order_points(uv.astype(np.float32))
        r = _recover_true_aspect(rect, 1600, 1200)
        assert r is not None
        assert abs(r - 0.707) < 0.06

    def test_frontal_view_identity(self):
        from app.services.doc_scanner import _recover_true_aspect, _order_points
        uv = _project_rect(0.21, 0.297, 0, 0)
        rect = _order_points(uv.astype(np.float32))
        r = _recover_true_aspect(rect, 1600, 1200)
        assert r is not None
        assert abs(r - 0.707) < 0.01

    def test_perspective_transform_output_aspect(self):
        """透視校正輸出的寬高比應接近文件真實比例"""
        import cv2
        from app.services.doc_scanner import perspective_transform
        # 用針孔投影產生幾何一致的場景
        uv = _project_rect(0.21, 0.297, 30, 15, img_w=800, img_h=600, f=700.0)
        quad = [[float(x), float(y)] for x, y in uv]
        data, _ = _scene(quad, 800, 600)
        out = perspective_transform(data, [[int(x), int(y)] for x, y in quad])
        img = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
        ratio = img.shape[1] / img.shape[0]
        assert abs(ratio - 0.707) < 0.07


# ══════════════════════════════════════════════════════════════
# EXIF 方向正規化
# ══════════════════════════════════════════════════════════════

class TestExifOrientation:

    def _jpeg_with_orientation(self, orientation):
        from PIL import Image
        img = Image.new("RGB", (120, 80), (200, 210, 220))
        exif = Image.Exif()
        exif[0x0112] = orientation
        buf = io.BytesIO()
        img.save(buf, format="JPEG", exif=exif)
        return buf.getvalue()

    def test_orientation_6_rotated(self):
        from PIL import Image
        from app.services.image_processor import normalize_orientation
        data = self._jpeg_with_orientation(6)  # 90° CW 需求
        out, changed = normalize_orientation(data)
        assert changed is True
        img = Image.open(io.BytesIO(out))
        assert (img.width, img.height) == (80, 120)  # 旋轉後寬高互換
        assert img.getexif().get(0x0112, 1) == 1  # 標籤已清除/重設

    def test_orientation_1_untouched(self):
        from app.services.image_processor import normalize_orientation
        data = self._jpeg_with_orientation(1)
        out, changed = normalize_orientation(data)
        assert changed is False
        assert out == data

    def test_no_exif_untouched(self):
        import cv2
        from app.services.image_processor import normalize_orientation
        img = np.full((80, 120, 3), 180, np.uint8)
        ok, buf = cv2.imencode(".jpg", img)
        out, changed = normalize_orientation(buf.tobytes())
        assert changed is False

    def test_garbage_input_safe(self):
        from app.services.image_processor import normalize_orientation
        out, changed = normalize_orientation(b"garbage-bytes")
        assert changed is False
        assert out == b"garbage-bytes"
