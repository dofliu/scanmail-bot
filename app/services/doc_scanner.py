"""文件掃描後處理 — 邊界偵測、透視校正、影像增強

針對手持拍攝文件照片優化：
1. 多策略自動偵測文件邊界（顏色分析 + 邊緣偵測 + 輪廓分析）
2. 透視校正（把歪斜的文件拉正成矩形）
3. 影像增強濾鏡（清晰化、去背景、增強對比度）
"""
import io
import logging
import math
from typing import Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════
# 1. 邊界偵測（多策略）
# ══════════════════════════════════════════════════════════════

def _order_points(pts: np.ndarray) -> np.ndarray:
    """將四個角點排序為：左上、右上、右下、左下"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # 左上
    rect[2] = pts[np.argmax(s)]   # 右下
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]   # 右上
    rect[3] = pts[np.argmax(d)]   # 左下
    return rect


def _is_valid_quad(corners: np.ndarray, img_w: int, img_h: int,
                   min_area_ratio: float = 0.15,
                   max_area_ratio: float = 0.98) -> bool:
    """驗證四邊形是否為合理的文件邊界"""
    area = cv2.contourArea(corners)
    img_area = img_w * img_h
    ratio = area / img_area

    if ratio < min_area_ratio or ratio > max_area_ratio:
        return False

    # 檢查是否為凸四邊形
    ordered = _order_points(corners.astype("float32"))
    (tl, tr, br, bl) = ordered

    # 計算邊長
    w_top = np.linalg.norm(tr - tl)
    w_bot = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right = np.linalg.norm(br - tr)

    # 寬高比不能太極端（排除細長條）
    max_side = max(w_top, w_bot, h_left, h_right)
    min_side = min(w_top, w_bot, h_left, h_right)
    if min_side < max_side * 0.15:
        return False

    # 對邊比例不能差太多（排除梯形太誇張的情況）
    if min(w_top, w_bot) < max(w_top, w_bot) * 0.3:
        return False
    if min(h_left, h_right) < max(h_left, h_right) * 0.3:
        return False

    return True


def _find_contour_quad(mask: np.ndarray, img_w: int, img_h: int) -> Optional[np.ndarray]:
    """從二值遮罩中找出最大的四邊形輪廓"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]

    for c in contours:
        peri = cv2.arcLength(c, True)
        # 嘗試不同的逼近精度
        for eps in [0.02, 0.03, 0.04, 0.05]:
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4:
                pts = approx.reshape(4, 2)
                if _is_valid_quad(pts, img_w, img_h):
                    return pts

        # 如果逼近不到 4 個點，用最小面積矩形
        if cv2.contourArea(c) > img_w * img_h * 0.15:
            rect = cv2.minAreaRect(c)
            box = cv2.boxPoints(rect)
            box = box.astype(int)
            if _is_valid_quad(box, img_w, img_h):
                return box

    return None


def detect_document_edges(image_data: bytes) -> Optional[list[list[int]]]:
    """偵測圖片中的文件邊界（多策略）

    Returns:
        四個角點 [[x,y], ...] 或 None
    """
    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    orig_h, orig_w = img.shape[:2]

    # 縮放到合理大小
    scale = 1.0
    max_dim = 800
    if max(orig_h, orig_w) > max_dim:
        scale = max_dim / max(orig_h, orig_w)
        img_s = cv2.resize(img, None, fx=scale, fy=scale)
    else:
        img_s = img.copy()

    h, w = img_s.shape[:2]
    corners = None

    # ── 策略 1：顏色分析（紙張通常是淺色/白色）──
    corners = _detect_by_color(img_s, w, h)
    if corners is not None:
        logger.info("邊界偵測成功 (策略: 顏色分析)")

    # ── 策略 2：Canny 邊緣 + 多閾值 ──
    if corners is None:
        corners = _detect_by_canny(img_s, w, h)
        if corners is not None:
            logger.info("邊界偵測成功 (策略: Canny 邊緣)")

    # ── 策略 3：自適應閾值 ──
    if corners is None:
        corners = _detect_by_adaptive(img_s, w, h)
        if corners is not None:
            logger.info("邊界偵測成功 (策略: 自適應閾值)")

    # ── 策略 4：GrabCut 前景分離 ──
    if corners is None:
        corners = _detect_by_grabcut(img_s, w, h)
        if corners is not None:
            logger.info("邊界偵測成功 (策略: GrabCut)")

    if corners is None:
        logger.info("所有策略都無法偵測到文件邊界")
        return None

    # 轉回原始尺寸座標
    corners = (corners / scale).astype(int)
    ordered = _order_points(corners.astype("float32"))

    logger.info("偵測到文件邊界 (原始座標): %s", ordered.astype(int).tolist())
    return ordered.astype(int).tolist()


def _detect_by_color(img: np.ndarray, w: int, h: int) -> Optional[np.ndarray]:
    """利用顏色分析找出淺色紙張區域"""
    # 轉到 HSV/LAB 色彩空間
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)

    # 白色/淺色紙張：低飽和度 + 高亮度
    # HSV: S < 60, V > 150
    mask_hsv = cv2.inRange(hsv, (0, 0, 140), (180, 70, 255))

    # LAB: L > 170 (亮)
    l_channel = lab[:, :, 0]
    mask_lab = (l_channel > 160).astype(np.uint8) * 255

    # 合併遮罩
    mask = cv2.bitwise_and(mask_hsv, mask_lab)

    # 形態學操作：去噪 + 填補
    kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    kernel_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_small, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_large, iterations=3)

    # 填補內部孔洞
    mask_filled = mask.copy()
    flood_mask = np.zeros((h + 2, w + 2), np.uint8)
    # 從四個角落flood fill（假設角落是背景）
    for pt in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]:
        if mask_filled[pt[1], pt[0]] == 0:
            cv2.floodFill(mask_filled, flood_mask, pt, 255)
    # 反轉flood結果得到前景
    mask_inv = cv2.bitwise_not(mask_filled)
    mask = cv2.bitwise_or(mask, mask_inv)

    return _find_contour_quad(mask, w, h)


def _detect_by_canny(img: np.ndarray, w: int, h: int) -> Optional[np.ndarray]:
    """Canny 邊緣偵測 + 輪廓分析"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    for low, high in [(30, 100), (50, 150), (20, 60), (75, 200)]:
        edged = cv2.Canny(blurred, low, high)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edged = cv2.dilate(edged, kernel, iterations=3)
        edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)),
                                  iterations=2)

        result = _find_contour_quad(edged, w, h)
        if result is not None:
            return result

    return None


def _detect_by_adaptive(img: np.ndarray, w: int, h: int) -> Optional[np.ndarray]:
    """自適應閾值 + 形態學"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # 高亮度區域（紙張）
    _, bright = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    bright = cv2.morphologyEx(bright, cv2.MORPH_CLOSE, kernel, iterations=4)
    bright = cv2.morphologyEx(bright, cv2.MORPH_OPEN, kernel, iterations=2)

    return _find_contour_quad(bright, w, h)


def _detect_by_grabcut(img: np.ndarray, w: int, h: int) -> Optional[np.ndarray]:
    """GrabCut 前景分離（假設文件在圖片中央）"""
    try:
        mask = np.zeros((h, w), np.uint8)
        bg_model = np.zeros((1, 65), np.float64)
        fg_model = np.zeros((1, 65), np.float64)

        # 初始矩形：圖片中央 70% 區域（假設文件大致在中間）
        margin_x = int(w * 0.10)
        margin_y = int(h * 0.08)
        rect = (margin_x, margin_y, w - 2 * margin_x, h - 2 * margin_y)

        cv2.grabCut(img, mask, rect, bg_model, fg_model, 3, cv2.GC_INIT_WITH_RECT)

        # 前景 + 可能前景
        fg_mask = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, kernel, iterations=3)
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel, iterations=2)

        return _find_contour_quad(fg_mask, w, h)

    except Exception as e:
        logger.debug("GrabCut 失敗: %s", e)
        return None


# ══════════════════════════════════════════════════════════════
# 2. 透視校正
# ══════════════════════════════════════════════════════════════

def perspective_transform(image_data: bytes,
                          corners: list[list[int]]) -> bytes:
    """透視校正 — 將歪斜文件拉正成矩形"""
    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    pts = np.array(corners, dtype="float32")
    rect = _order_points(pts)
    (tl, tr, br, bl) = rect

    width_top = np.linalg.norm(tr - tl)
    width_bot = np.linalg.norm(br - bl)
    max_width = int(max(width_top, width_bot))

    height_left = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)
    max_height = int(max(height_left, height_right))

    max_width = max(max_width, 100)
    max_height = max(max_height, 100)

    # 限制解析度
    max_dim = 3000
    if max(max_width, max_height) > max_dim:
        ratio = max_dim / max(max_width, max_height)
        max_width = int(max_width * ratio)
        max_height = int(max_height * ratio)

    dst = np.array([
        [0, 0], [max_width - 1, 0],
        [max_width - 1, max_height - 1], [0, max_height - 1],
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(img, M, (max_width, max_height),
                                  flags=cv2.INTER_CUBIC,
                                  borderMode=cv2.BORDER_REPLICATE)

    _, buf = cv2.imencode(".jpg", warped, [cv2.IMWRITE_JPEG_QUALITY, 95])
    result = buf.tobytes()
    logger.info("透視校正完成: %dx%d, %d bytes", max_width, max_height, len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 3. 影像增強濾鏡
# ══════════════════════════════════════════════════════════════

def apply_filter(image_data: bytes, filter_name: str = "auto") -> bytes:
    """套用影像增強濾鏡"""
    if filter_name == "original":
        return image_data

    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    filters = {
        "document": _filter_document,
        "bw": _filter_bw,
        "enhance": _filter_enhance,
        "auto": _filter_auto,
    }
    func = filters.get(filter_name, _filter_auto)
    result = func(img)

    _, buf = cv2.imencode(".jpg", result, [cv2.IMWRITE_JPEG_QUALITY, 95])
    processed = buf.tobytes()
    logger.info("濾鏡 [%s] 套用完成: %d bytes", filter_name, len(processed))
    return processed


def _filter_auto(img: np.ndarray) -> np.ndarray:
    """智慧增強 — 背景去除 + 自動增強"""
    # 先做背景白化，再增強
    result = _remove_background_shadow(img)
    return _sharpen_light(result)


def _remove_background_shadow(img: np.ndarray) -> np.ndarray:
    """去除光照不均和背景陰影（核心演算法）"""
    # 轉灰階
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)

    # 估計背景光照（大核高斯模糊）
    ksize = max(img.shape[0], img.shape[1]) // 5
    ksize = ksize if ksize % 2 == 1 else ksize + 1
    ksize = max(ksize, 51)
    bg = cv2.GaussianBlur(gray, (ksize, ksize), 0)

    # 光照歸一化：去除不均勻光照
    normalized = (gray / (bg + 1e-5)) * 200.0
    normalized = np.clip(normalized, 0, 255).astype(np.uint8)

    # 提升對比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)

    # 轉回 BGR
    result = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    return result


def _sharpen_light(img: np.ndarray) -> np.ndarray:
    """輕度銳化"""
    kernel = np.array([
        [0, -0.5, 0],
        [-0.5, 3, -0.5],
        [0, -0.5, 0]
    ])
    return cv2.filter2D(img, -1, kernel)


def _filter_document(img: np.ndarray) -> np.ndarray:
    """文件模式 — 高對比清晰文字，白色背景"""
    # 先去除背景陰影
    cleaned = _remove_background_shadow(img)
    gray = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)

    # 去噪
    denoised = cv2.fastNlMeansDenoising(gray, h=8)

    # 自適應閾值 — 讓文字清晰、背景變白
    block_size = max(15, (min(gray.shape) // 15) | 1)
    thresh = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block_size, 10
    )

    # 去小雜點
    kernel = np.ones((2, 2), np.uint8)
    cleaned_thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    cleaned_thresh = cv2.morphologyEx(cleaned_thresh, cv2.MORPH_OPEN, kernel)

    return cleaned_thresh


def _filter_bw(img: np.ndarray) -> np.ndarray:
    """黑白掃描模式 — 乾淨的二值化"""
    # 先去陰影
    cleaned = _remove_background_shadow(img)
    gray = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=10)

    # Otsu
    _, binary = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    kernel = np.ones((2, 2), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    return binary


def _filter_enhance(img: np.ndarray) -> np.ndarray:
    """增強模式 — 保持彩色，去除陰影，提升清晰度"""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l)

    # 去陰影
    ksize = max(l.shape[0], l.shape[1]) // 5
    ksize = ksize if ksize % 2 == 1 else ksize + 1
    ksize = max(ksize, 51)
    bg = cv2.GaussianBlur(l_enhanced, (ksize, ksize), 0)
    l_no_shadow = cv2.divide(l_enhanced, bg, scale=200)
    l_no_shadow = np.clip(l_no_shadow, 0, 255).astype(np.uint8)

    lab_out = cv2.merge([l_no_shadow, a, b])
    result = cv2.cvtColor(lab_out, cv2.COLOR_LAB2BGR)

    # 雙邊濾波（去噪保邊）
    result = cv2.bilateralFilter(result, 5, 40, 40)

    # 銳化
    result = _sharpen_light(result)

    # 微調亮度對比
    result = cv2.convertScaleAbs(result, alpha=1.1, beta=15)

    return result


# ══════════════════════════════════════════════════════════════
# 4. 完整掃描流水線
# ══════════════════════════════════════════════════════════════

def scan_document(image_data: bytes,
                  corners: Optional[list[list[int]]] = None,
                  filter_name: str = "auto",
                  auto_detect: bool = True) -> dict:
    """完整文件掃描處理流水線"""
    nparr = np.frombuffer(image_data, np.uint8)
    orig = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    orig_h, orig_w = orig.shape[:2]

    processed = image_data
    detected_corners = corners
    auto_detected = False

    # Step 1: 邊界偵測 + 透視校正
    if corners:
        processed = perspective_transform(processed, corners)
    elif auto_detect:
        detected_corners = detect_document_edges(image_data)
        if detected_corners:
            auto_detected = True
            processed = perspective_transform(processed, detected_corners)
            logger.info("自動邊界偵測 + 透視校正完成")
        else:
            logger.info("未偵測到邊界，跳過透視校正")

    # Step 2: 套用濾鏡
    processed = apply_filter(processed, filter_name)

    proc_arr = np.frombuffer(processed, np.uint8)
    proc_img = cv2.imdecode(proc_arr, cv2.IMREAD_COLOR)
    proc_h, proc_w = proc_img.shape[:2]

    return {
        "image": processed,
        "corners": detected_corners,
        "auto_detected": auto_detected,
        "filter_applied": filter_name,
        "original_size": (orig_w, orig_h),
        "processed_size": (proc_w, proc_h),
    }
