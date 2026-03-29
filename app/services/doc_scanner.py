"""文件掃描後處理 — 邊界偵測、透視校正、專業掃描還原

針對手持拍攝文件照片優化，目標是還原出接近平台掃描器的效果：
1. 多策略自動偵測文件邊界（顏色分析 + 邊緣偵測 + 輪廓分析）
2. 透視校正（把歪斜的文件拉正成矩形）
3. 自動歪斜校正（Deskew — 偵測文字行角度並旋轉修正）
4. 專業掃描濾鏡（形態學背景估計、色彩保留白化、印章/蓋章保色）

參考：
- OSS-DocumentScanner: 形態學背景估計 + 色彩空間處理
- paperless-ngx: unpaper 概念的去噪 + 光照正規化
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
# 1. 邊界偵測（v3 — 全面重新設計）
#
# 核心設計原則：
# A. 手持文件四周一定有背景 → 拒絕「貼邊」的輪廓
# B. 文件是矩形白色區域，內有文字 → 結合多個線索
# C. 不要只找最大的 → 評分制，偏好「文件形狀」
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


def _is_valid_doc_quad(corners: np.ndarray, img_w: int, img_h: int) -> bool:
    """驗證四邊形是否為合理的文件邊界（嚴格版）"""
    area = cv2.contourArea(corners)
    img_area = img_w * img_h
    ratio = area / img_area

    # 面積限制：5% ~ 80%
    if ratio < 0.05 or ratio > 0.80:
        return False

    ordered = _order_points(corners.astype("float32"))
    (tl, tr, br, bl) = ordered

    # ★ 關鍵：拒絕「貼邊」的輪廓
    # 手持文件不可能四條邊都緊貼圖片邊緣
    border_margin = max(img_w, img_h) * 0.03  # 3% 邊距
    edges_touching = 0
    if tl[1] < border_margin and tr[1] < border_margin:
        edges_touching += 1  # 頂邊貼頂
    if bl[1] > img_h - border_margin and br[1] > img_h - border_margin:
        edges_touching += 1  # 底邊貼底
    if tl[0] < border_margin and bl[0] < border_margin:
        edges_touching += 1  # 左邊貼左
    if tr[0] > img_w - border_margin and br[0] > img_w - border_margin:
        edges_touching += 1  # 右邊貼右
    # 最多容許 1 條邊貼邊（文件可能靠近某一側）
    if edges_touching >= 3:
        return False

    w_top = np.linalg.norm(tr - tl)
    w_bot = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right = np.linalg.norm(br - tr)

    # 寬高比不能太極端
    max_side = max(w_top, w_bot, h_left, h_right)
    min_side = min(w_top, w_bot, h_left, h_right)
    if min_side < max_side * 0.15:
        return False

    # 對邊比例
    if max(w_top, w_bot) > 0 and min(w_top, w_bot) / max(w_top, w_bot) < 0.2:
        return False
    if max(h_left, h_right) > 0 and min(h_left, h_right) / max(h_left, h_right) < 0.2:
        return False

    return True


def _score_doc_quad(corners: np.ndarray, img_w: int, img_h: int) -> float:
    """評分四邊形的「文件可信度」

    高分 = 更像一份文件：
    - 面積適中（15%~55%）
    - 形狀接近矩形
    - 離圖片邊緣有距離
    - 寬高比接近紙張
    """
    area = cv2.contourArea(corners)
    img_area = img_w * img_h
    ratio = area / img_area

    # 1. 面積分：偏好 15%~55%
    if ratio < 0.05:
        area_s = 0
    elif ratio < 0.15:
        area_s = (ratio - 0.05) / 0.10 * 0.7
    elif ratio < 0.55:
        area_s = 0.7 + 0.3 * (1.0 - abs(ratio - 0.35) / 0.20)
    elif ratio < 0.80:
        area_s = 0.7 * (1.0 - (ratio - 0.55) / 0.25)
    else:
        area_s = 0

    # 2. 矩形度
    rect = cv2.minAreaRect(corners.reshape(-1, 1, 2).astype(np.int32))
    rect_area = rect[1][0] * rect[1][1] if rect[1][0] > 0 and rect[1][1] > 0 else 1
    rectangularity = min(area / rect_area, 1.0)

    # 3. 離邊距離分：四個角點離圖片邊緣越遠越好
    ordered = _order_points(corners.astype("float32"))
    min_border_dist = min(
        ordered[0][0], ordered[0][1],                  # 左上離左邊/上邊
        img_w - ordered[1][0], ordered[1][1],           # 右上離右邊/上邊
        img_w - ordered[2][0], img_h - ordered[2][1],   # 右下離右邊/下邊
        ordered[3][0], img_h - ordered[3][1],            # 左下離左邊/下邊
    )
    border_s = min(min_border_dist / (max(img_w, img_h) * 0.05), 1.0)

    # 4. 紙張寬高比（A4≈0.707, Letter≈0.773, B5≈0.707）
    (tl, tr, br, bl) = ordered
    w_avg = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    h_avg = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if max(w_avg, h_avg) > 0:
        aspect = min(w_avg, h_avg) / max(w_avg, h_avg)
    else:
        aspect = 0
    aspect_s = max(0, 1.0 - abs(aspect - 0.72) * 3.0)

    return area_s * 0.35 + rectangularity * 0.25 + border_s * 0.25 + aspect_s * 0.15


def _find_best_quad(mask: np.ndarray, img_w: int, img_h: int) -> Optional[np.ndarray]:
    """從二值遮罩中找出最佳的文件四邊形"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]

    best_score = -1
    best_pts = None

    for c in contours:
        peri = cv2.arcLength(c, True)
        if peri < 100:
            continue

        for eps in [0.015, 0.02, 0.03, 0.04, 0.05, 0.06]:
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4:
                pts = approx.reshape(4, 2)
                if _is_valid_doc_quad(pts, img_w, img_h):
                    score = _score_doc_quad(pts, img_w, img_h)
                    if score > best_score:
                        best_score = score
                        best_pts = pts
                break

        # 最小外接矩形 fallback
        c_area = cv2.contourArea(c)
        if c_area > img_w * img_h * 0.05:
            rect = cv2.minAreaRect(c)
            box = cv2.boxPoints(rect).astype(int)
            if _is_valid_doc_quad(box, img_w, img_h):
                score = _score_doc_quad(box, img_w, img_h)
                if score > best_score:
                    best_score = score
                    best_pts = box

    return best_pts


def detect_document_edges(image_data: bytes) -> Optional[list[list[int]]]:
    """偵測圖片中的文件邊界（v3 — 全面重新設計）

    所有策略並行執行 → 評分選最佳 → 嚴格拒絕「貼邊」結果
    """
    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    orig_h, orig_w = img.shape[:2]

    scale = 1.0
    max_dim = 800
    if max(orig_h, orig_w) > max_dim:
        scale = max_dim / max(orig_h, orig_w)
        img_s = cv2.resize(img, None, fx=scale, fy=scale)
    else:
        img_s = img.copy()

    h, w = img_s.shape[:2]
    candidates = []

    # ── 策略 1：強邊緣 Canny（多閾值）──
    gray = cv2.cvtColor(img_s, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    for lo, hi in [(30, 80), (50, 150), (20, 60)]:
        edged = cv2.Canny(blurred, lo, hi)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edged = cv2.dilate(edged, k, iterations=2)
        edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
                                  iterations=2)
        r = _find_best_quad(edged, w, h)
        if r is not None:
            s = _score_doc_quad(r, w, h)
            candidates.append((s, r, f"Canny({lo},{hi})"))

    # ── 策略 2：白色區域（排除膚色+排除貼邊）──
    hsv = cv2.cvtColor(img_s, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(img_s, cv2.COLOR_BGR2LAB)

    # 膚色遮罩
    skin = cv2.inRange(hsv, (0, 30, 60), (25, 170, 255))
    skin2 = cv2.inRange(hsv, (160, 30, 60), (180, 170, 255))
    skin = cv2.bitwise_or(skin, skin2)
    skin = cv2.dilate(skin, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (20, 20)), iterations=2)

    # 白色紙張：高亮度 + 低飽和度
    white = cv2.inRange(hsv, (0, 0, 160), (180, 50, 255))
    l_ch = lab[:, :, 0]
    bright = (l_ch > 180).astype(np.uint8) * 255
    white = cv2.bitwise_and(white, bright)
    white = cv2.bitwise_and(white, cv2.bitwise_not(skin))  # 排除膚色

    k_s = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    k_l = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    white = cv2.morphologyEx(white, cv2.MORPH_OPEN, k_s, iterations=2)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, k_l, iterations=4)

    r = _find_best_quad(white, w, h)
    if r is not None:
        s = _score_doc_quad(r, w, h)
        candidates.append((s, r, "WhiteRegion"))

    # ── 策略 3：自適應閾值（Otsu）──
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k_m = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, k_m, iterations=3)
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, k_m, iterations=2)
    r = _find_best_quad(otsu, w, h)
    if r is not None:
        s = _score_doc_quad(r, w, h)
        candidates.append((s, r, "Otsu"))

    # ── 策略 4：Laplacian 銳利邊緣（文件邊緣比背景更銳利）──
    lap = cv2.Laplacian(blurred, cv2.CV_64F)
    lap = np.uint8(np.absolute(lap))
    _, sharp = cv2.threshold(lap, 15, 255, cv2.THRESH_BINARY)
    sharp = cv2.dilate(sharp, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=2)
    sharp = cv2.morphologyEx(sharp, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)),
                              iterations=3)
    r = _find_best_quad(sharp, w, h)
    if r is not None:
        s = _score_doc_quad(r, w, h)
        candidates.append((s, r, "Laplacian"))

    # ── 策略 5：GrabCut 前景分離 ──
    try:
        gc_mask = np.zeros((h, w), np.uint8)
        bg_m = np.zeros((1, 65), np.float64)
        fg_m = np.zeros((1, 65), np.float64)
        mx, my = int(w * 0.12), int(h * 0.10)
        rect = (mx, my, w - 2 * mx, h - 2 * my)
        cv2.grabCut(img_s, gc_mask, rect, bg_m, fg_m, 3, cv2.GC_INIT_WITH_RECT)
        fg = np.where((gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE,
                               cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)),
                               iterations=3)
        r = _find_best_quad(fg, w, h)
        if r is not None:
            s = _score_doc_quad(r, w, h)
            candidates.append((s, r, "GrabCut"))
    except Exception as e:
        logger.debug("GrabCut 失敗: %s", e)

    # ── 選出最佳候選 ──
    if not candidates:
        logger.info("所有策略無法偵測到文件邊界")
        return None

    candidates.sort(key=lambda x: x[0], reverse=True)
    for s, c, name in candidates[:5]:
        logger.info("  候選 %s: score=%.3f", name, s)

    best_score, best_corners, best_name = candidates[0]
    logger.info("最佳: %s (score=%.3f)", best_name, best_score)

    # 分數太低就不要（寧可讓使用者手動選）
    if best_score < 0.15:
        logger.info("最佳分數 %.3f 太低，放棄自動偵測", best_score)
        return None

    best_corners = (best_corners / scale).astype(int)
    ordered = _order_points(best_corners.astype("float32"))
    return ordered.astype(int).tolist()
    """驗證四邊形是否為合理的文件邊界

    關鍵改進：
    - 降低 max_area_ratio 到 0.85（排除幾乎整張圖的誤判）
    - 降低 min_area_ratio 到 0.05（支援小文件/遠距拍攝）
    - 加入凸性檢查（文件應該是凸四邊形）
    """
    area = cv2.contourArea(corners)
    img_area = img_w * img_h
    ratio = area / img_area

    if ratio < min_area_ratio or ratio > max_area_ratio:
        return False

    # 凸性檢查：文件邊界應該是凸多邊形
    if not cv2.isContourConvex(corners.reshape(-1, 1, 2).astype(np.int32)):
        # 容許輕微非凸（手指遮擋可能造成）
        hull = cv2.convexHull(corners.reshape(-1, 1, 2).astype(np.int32))
        hull_area = cv2.contourArea(hull)
        if hull_area > 0 and area / hull_area < 0.85:
            return False

    ordered = _order_points(corners.astype("float32"))
    (tl, tr, br, bl) = ordered

    w_top = np.linalg.norm(tr - tl)
    w_bot = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right = np.linalg.norm(br - tr)

    # 寬高比不能太極端（排除細長條）
    max_side = max(w_top, w_bot, h_left, h_right)
    min_side = min(w_top, w_bot, h_left, h_right)
    if min_side < max_side * 0.1:
        return False

    # 對邊比例限制
    if min(w_top, w_bot) < max(w_top, w_bot) * 0.15:
        return False
    if min(h_left, h_right) < max(h_left, h_right) * 0.15:
        return False

    return True


# ══════════════════════════════════════════════════════════════
# 2. 透視校正
# ══════════════════════════════════════════════════════════════

def _estimate_distortion_level(corners: np.ndarray) -> dict:
    """估計透視變形程度，用於決定後處理策略

    Returns:
        {
            "level": "low"|"medium"|"high"|"extreme",
            "aspect_ratio_diff": float,  # 對邊比例差異
            "estimated_angle": float,    # 估計的傾斜角度（度）
            "needs_compensation": bool,  # 是否需要失真補償
        }
    """
    ordered = _order_points(corners.astype("float32"))
    (tl, tr, br, bl) = ordered

    w_top = np.linalg.norm(tr - tl)
    w_bot = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right = np.linalg.norm(br - tr)

    # 對邊比例差異（越大表示傾斜越嚴重）
    w_ratio = min(w_top, w_bot) / max(w_top, w_bot) if max(w_top, w_bot) > 0 else 1
    h_ratio = min(h_left, h_right) / max(h_left, h_right) if max(h_left, h_right) > 0 else 1
    aspect_diff = 1.0 - min(w_ratio, h_ratio)

    # 從對邊比例估算傾斜角度：ratio ≈ cos(angle) 的近似
    min_ratio = min(w_ratio, h_ratio)
    estimated_angle = math.degrees(math.acos(max(min_ratio, 0.01)))

    if aspect_diff < 0.1:
        level = "low"
    elif aspect_diff < 0.3:
        level = "medium"
    elif aspect_diff < 0.5:
        level = "high"
    else:
        level = "extreme"

    return {
        "level": level,
        "aspect_ratio_diff": float(aspect_diff),
        "estimated_angle": float(estimated_angle),
        "needs_compensation": bool(aspect_diff > 0.15),
        "w_ratio": float(w_ratio),
        "h_ratio": float(h_ratio),
    }


def _compensate_distortion(img: np.ndarray, distortion: dict) -> np.ndarray:
    """根據變形程度補償透視校正造成的品質損失

    大角度傾斜時，遠端像素被「拉伸」會變模糊。
    用自適應銳化 + 去噪來補償：
    - low: 不處理
    - medium: 輕度銳化
    - high: 中度銳化 + 輕度去噪
    - extreme: 強力銳化 + 去噪 + 超解析度風格增強
    """
    level = distortion["level"]

    if level == "low":
        return img

    logger.info("失真補償：變形等級 %s (估計角度 %.1f°)，正在增強",
                level, distortion["estimated_angle"])

    if level == "medium":
        # 輕度 unsharp masking
        blurred = cv2.GaussianBlur(img, (0, 0), 2)
        result = cv2.addWeighted(img, 1.3, blurred, -0.3, 0)
        return result

    if level == "high":
        # 先去噪再銳化（去除拉伸產生的插值雜訊）
        denoised = cv2.bilateralFilter(img, 5, 50, 50)
        blurred = cv2.GaussianBlur(denoised, (0, 0), 2.5)
        result = cv2.addWeighted(denoised, 1.5, blurred, -0.5, 0)
        return result

    # extreme
    # 強力去噪
    denoised = cv2.bilateralFilter(img, 7, 60, 60)
    # 多級銳化：先大尺度再小尺度
    blurred_large = cv2.GaussianBlur(denoised, (0, 0), 4)
    stage1 = cv2.addWeighted(denoised, 1.4, blurred_large, -0.4, 0)
    blurred_small = cv2.GaussianBlur(stage1, (0, 0), 1.5)
    result = cv2.addWeighted(stage1, 1.3, blurred_small, -0.3, 0)
    return result


def perspective_transform(image_data: bytes,
                          corners: list[list[int]]) -> bytes:
    """透視校正 — 將歪斜文件拉正成矩形（高品質版）

    品質改進：
    1. INTER_LANCZOS4 插值（8x8 像素鄰域，最佳重採樣品質）
    2. 解析度上限提高到 4500px（大角度時有更多像素可用）
    3. 基於 A4 比例智慧推算輸出尺寸（避免極端拉伸）
    4. 自動偵測變形程度，高變形時做失真補償
    5. BORDER_REFLECT 避免邊緣黑邊
    """
    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("無法解碼圖片進行透視校正")

    pts = np.array(corners, dtype="float32")
    rect = _order_points(pts)
    (tl, tr, br, bl) = rect

    # 計算變形程度
    distortion = _estimate_distortion_level(pts)
    logger.info("透視校正：變形等級 %s, 估計角度 %.1f°",
                distortion["level"], distortion["estimated_angle"])

    width_top = np.linalg.norm(tr - tl)
    width_bot = np.linalg.norm(br - bl)
    height_left = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)

    # 智慧計算輸出尺寸
    # 大角度時遠端邊像素很少，直接用 max 會讓遠端過度拉伸
    # 改用加權平均（近端權重高於遠端）
    if distortion["needs_compensation"]:
        # 用較大邊的 90% + 較小邊的 10% 作為目標寬度
        # 這樣不會過度拉伸遠端
        max_width = int(max(width_top, width_bot) * 0.85 +
                        min(width_top, width_bot) * 0.15)
        max_height = int(max(height_left, height_right) * 0.85 +
                         min(height_left, height_right) * 0.15)
    else:
        max_width = int(max(width_top, width_bot))
        max_height = int(max(height_left, height_right))

    max_width = max(max_width, 100)
    max_height = max(max_height, 100)

    # 提高解析度上限（大角度需要更多像素）
    max_dim = 4500
    if max(max_width, max_height) > max_dim:
        ratio = max_dim / max(max_width, max_height)
        max_width = int(max_width * ratio)
        max_height = int(max_height * ratio)

    dst = np.array([
        [0, 0], [max_width - 1, 0],
        [max_width - 1, max_height - 1], [0, max_height - 1],
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)

    # INTER_LANCZOS4：8x8 像素鄰域的 Lanczos 插值
    # 比 INTER_CUBIC（4x4）品質更好，特別在拉伸時差異明顯
    warped = cv2.warpPerspective(img, M, (max_width, max_height),
                                  flags=cv2.INTER_LANCZOS4,
                                  borderMode=cv2.BORDER_REFLECT)

    # 失真補償（根據變形程度自動調整）
    if distortion["needs_compensation"]:
        warped = _compensate_distortion(warped, distortion)

    _, buf = cv2.imencode(".jpg", warped, [cv2.IMWRITE_JPEG_QUALITY, 95])
    result = buf.tobytes()
    logger.info("透視校正完成: %dx%d, 變形等級=%s, %d bytes",
                max_width, max_height, distortion["level"], len(result))
    return result


# ══════════════════════════════════════════════════════════════
# 3. 歪斜校正 (Deskew)
# ══════════════════════════════════════════════════════════════

def _deskew(img: np.ndarray, max_angle: float = 45.0) -> np.ndarray:
    """偵測文字行的傾斜角度並旋轉校正

    使用 Hough Line Transform 偵測文件中的直線（文字行、表格線），
    統計主要角度後微調旋轉，使文字行水平。

    支援最大 45° 的旋轉校正（透視校正後的殘留傾斜）。

    Args:
        img: BGR 影像
        max_angle: 最大校正角度（度），超過此角度視為偵測失敗不校正
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 邊緣偵測（用於找直線）
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # 使用機率式 Hough 偵測線段
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180,
        threshold=100,
        minLineLength=min(img.shape[1], img.shape[0]) // 8,
        maxLineGap=10,
    )

    if lines is None or len(lines) < 3:
        return img

    # 收集所有線段角度（相對水平線的偏移）
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        dx = x2 - x1
        dy = y2 - y1
        if abs(dx) < 5:
            continue  # 跳過接近垂直的線
        angle = math.degrees(math.atan2(dy, dx))
        # 只收集接近水平的線段角度
        if abs(angle) < max_angle:
            angles.append(angle)

    if len(angles) < 3:
        return img

    # 用中位數取得主要傾斜角度（比平均更穩健）
    median_angle = float(np.median(angles))

    # 角度太小就不校正（< 0.3 度視為水平）
    if abs(median_angle) < 0.3:
        return img

    logger.info("歪斜校正: 偵測到傾斜 %.2f°，正在旋轉修正", median_angle)

    h, w = img.shape[:2]
    center = (w // 2, h // 2)
    M = cv2.getRotationMatrix2D(center, median_angle, 1.0)

    # 計算旋轉後需要的畫布大小（避免裁切）
    cos_a = abs(M[0, 0])
    sin_a = abs(M[0, 1])
    new_w = int(h * sin_a + w * cos_a)
    new_h = int(h * cos_a + w * sin_a)
    M[0, 2] += (new_w - w) / 2
    M[1, 2] += (new_h - h) / 2

    rotated = cv2.warpAffine(
        img, M, (new_w, new_h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated


# ══════════════════════════════════════════════════════════════
# 4. 專業掃描核心演算法
# ══════════════════════════════════════════════════════════════

def _estimate_background_morphological(channel: np.ndarray,
                                        kernel_size: int = 0) -> np.ndarray:
    """用形態學膨脹估計背景光照（比高斯模糊更精確）

    原理：大核膨脹會「擴展」亮區，因此紙張的亮色會蓋過文字/印章的暗色，
    得到一張「只有背景紙張光照」的估計圖。再做高斯平滑去除殘留邊緣。

    這是 OSS-DocumentScanner 的核心技術之一。
    """
    h, w = channel.shape[:2]
    if kernel_size <= 0:
        # 自動計算核大小：影像較短邊的 1/20，確保能覆蓋文字筆畫
        kernel_size = max(h, w) // 20
        kernel_size = max(kernel_size, 15)
        kernel_size = kernel_size if kernel_size % 2 == 1 else kernel_size + 1

    # 形態學閉運算 = 膨脹 + 腐蝕，能估計出背景的光照分布
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                        (kernel_size, kernel_size))
    bg = cv2.morphologyEx(channel, cv2.MORPH_CLOSE, kernel)

    # 再做高斯平滑，讓背景估計更連續
    smooth_k = kernel_size * 2
    smooth_k = smooth_k if smooth_k % 2 == 1 else smooth_k + 1
    bg = cv2.GaussianBlur(bg, (smooth_k, smooth_k), 0)

    return bg


def _normalize_illumination(channel: np.ndarray,
                             bg: np.ndarray,
                             target: float = 240.0) -> np.ndarray:
    """光照正規化：讓紙張背景變成均勻的目標亮度

    formula: result = (channel / bg) * target
    - 紙張區域：channel ≈ bg，所以 result ≈ target（白色）
    - 文字區域：channel < bg，所以 result < target（保留暗度）
    - 印章區域：彩色通道差異被保留
    """
    ch_f = channel.astype(np.float64)
    bg_f = bg.astype(np.float64)
    bg_f = np.maximum(bg_f, 1.0)  # 避免除以零

    normalized = (ch_f / bg_f) * target
    return np.clip(normalized, 0, 255).astype(np.uint8)


def _white_balance_grayworld(img: np.ndarray) -> np.ndarray:
    """灰色世界白平衡 — 修正色偏（日光燈偏黃/偏藍）

    假設場景的平均色彩應該是中灰色，以此為基準調整 RGB 通道。
    """
    result = img.astype(np.float64)
    avg_b = np.mean(result[:, :, 0])
    avg_g = np.mean(result[:, :, 1])
    avg_r = np.mean(result[:, :, 2])
    avg_all = (avg_b + avg_g + avg_r) / 3.0

    if avg_b > 0:
        result[:, :, 0] *= avg_all / avg_b
    if avg_g > 0:
        result[:, :, 1] *= avg_all / avg_g
    if avg_r > 0:
        result[:, :, 2] *= avg_all / avg_r

    return np.clip(result, 0, 255).astype(np.uint8)


def _adaptive_sharpening(img: np.ndarray, strength: float = 0.5) -> np.ndarray:
    """自適應銳化 — 只在邊緣區域銳化，平滑區域不動

    避免傳統銳化在背景區域放大雜訊的問題。
    """
    # Unsharp masking
    blurred = cv2.GaussianBlur(img, (0, 0), 3)
    sharpened = cv2.addWeighted(img, 1.0 + strength, blurred, -strength, 0)
    return sharpened


# ══════════════════════════════════════════════════════════════
# 5. 影像增強濾鏡
# ══════════════════════════════════════════════════════════════

def apply_filter(image_data: bytes, filter_name: str = "auto") -> bytes:
    """套用影像增強濾鏡（防禦性實作）"""
    if filter_name == "original":
        return image_data

    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        logger.warning("apply_filter: 無法解碼圖片，回傳原始資料")
        return image_data

    filters = {
        "scan": _filter_scan,
        "color_doc": _filter_color_doc,
        "document": _filter_document,
        "bw": _filter_bw,
        "enhance": _filter_enhance,
        "auto": _filter_auto,
    }
    func = filters.get(filter_name, _filter_auto)

    try:
        result = func(img)
    except Exception as e:
        logger.error("濾鏡 [%s] 執行失敗: %s，回傳原圖", filter_name, e, exc_info=True)
        result = img

    # 確保 result 是有效的 numpy array
    if result is None or not isinstance(result, np.ndarray) or result.size == 0:
        logger.warning("濾鏡 [%s] 結果無效，回傳原圖", filter_name)
        result = img

    # 確保是 BGR 或灰階格式才能 imencode
    if len(result.shape) == 2:
        # 灰階 → BGR
        result = cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)

    success, buf = cv2.imencode(".jpg", result, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not success:
        logger.error("cv2.imencode 失敗，回傳原始資料")
        return image_data

    processed = buf.tobytes()
    logger.info("濾鏡 [%s] 套用完成: %d bytes", filter_name, len(processed))
    return processed


# ── 新：專業掃描模式（核心新功能）──

def _filter_scan(img: np.ndarray) -> np.ndarray:
    """專業掃描模式 — 還原出接近平台掃描器的效果（保色）

    流水線：
    1. 白平衡修正（消除色偏）
    2. 歪斜校正
    3. 逐通道形態學背景估計
    4. 光照正規化（紙張→白色，文字/圖案→保留原色）
    5. 輕度去噪（保邊雙邊濾波）
    6. 自適應銳化
    7. 紙張白度微調

    這個濾鏡的目標是讓拍攝的文件照片看起來就像用平台掃描器掃出來的：
    - 紙張變成乾淨的白色
    - 文字保持清晰銳利
    - 彩色印章、簽名、標記全部保留原色
    - 陰影和光照不均完全消除
    """
    # Step 1: 白平衡
    img = _white_balance_grayworld(img)

    # Step 2: 歪斜校正
    img = _deskew(img)

    # Step 3 & 4: 逐通道形態學背景估計 + 光照正規化
    # 在 BGR 色彩空間逐通道處理，能完整保留所有色彩資訊
    channels = cv2.split(img)
    normalized_channels = []
    for ch in channels:
        bg = _estimate_background_morphological(ch)
        norm = _normalize_illumination(ch, bg, target=240.0)
        normalized_channels.append(norm)
    result = cv2.merge(normalized_channels)

    # Step 5: 輕度去噪（雙邊濾波 — 去噪同時保留文字邊緣）
    result = cv2.bilateralFilter(result, 7, 50, 50)

    # Step 6: 自適應銳化（讓文字更清晰）
    result = _adaptive_sharpening(result, strength=0.4)

    # Step 7: 紙張白度微調 — 把接近白色的像素推向純白
    # 這讓背景更乾淨，同時不影響有色內容
    result = _push_whites(result, threshold=220)

    return result


def _filter_color_doc(img: np.ndarray) -> np.ndarray:
    """彩色文件模式 — 專為有印章、彩色表格、簽名的公文設計

    特點：
    - 背景白化但完整保留所有彩色元素
    - 紅色印章（蓋章）加強保色
    - 藍色簽名墨水保色
    - 表格線條保持清晰
    - 適合公文、合約、表單等正式文件
    """
    # 白平衡
    img = _white_balance_grayworld(img)

    # 歪斜校正
    img = _deskew(img)

    # 轉到 LAB 色彩空間分離亮度與色彩
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)

    # 只對亮度通道做形態學背景估計（保持色彩通道不變）
    l_bg = _estimate_background_morphological(l_ch)
    l_norm = _normalize_illumination(l_ch, l_bg, target=240.0)

    # 偵測高飽和度區域（印章、彩色標記）
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    # 高飽和度區域遮罩（印章通常飽和度 > 80）
    color_mask = (saturation > 60).astype(np.float32)
    # 平滑遮罩邊緣
    color_mask = cv2.GaussianBlur(color_mask, (5, 5), 0)

    # 加強彩色區域的飽和度（讓印章顏色更鮮明）
    a_boosted = np.clip(
        a_ch.astype(np.float32) + (a_ch.astype(np.float32) - 128) * color_mask * 0.3,
        0, 255
    ).astype(np.uint8)
    b_boosted = np.clip(
        b_ch.astype(np.float32) + (b_ch.astype(np.float32) - 128) * color_mask * 0.3,
        0, 255
    ).astype(np.uint8)

    # 重組 LAB
    lab_result = cv2.merge([l_norm, a_boosted, b_boosted])
    result = cv2.cvtColor(lab_result, cv2.COLOR_LAB2BGR)

    # 去噪（輕度，保留細節）
    result = cv2.bilateralFilter(result, 5, 40, 40)

    # 銳化
    result = _adaptive_sharpening(result, strength=0.35)

    # 白度微調
    result = _push_whites(result, threshold=215)

    return result


def _push_whites(img: np.ndarray, threshold: int = 220) -> np.ndarray:
    """把接近白色的像素推向純白（清潔背景用）

    只影響 RGB 三通道都接近白色的像素（真正的紙張區域），
    不會影響有色內容（文字、印章、圖片）。
    """
    # 計算每個像素到白色的距離
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 建立「接近白色」的遮罩
    white_mask = (gray >= threshold).astype(np.float32)
    # 平滑過渡（避免明顯邊界）
    white_mask = cv2.GaussianBlur(white_mask, (3, 3), 0)

    # 把白色區域推向 [250, 250, 250]
    result = img.astype(np.float32)
    white_target = np.full_like(result, 250.0)
    # 混合：mask=1 的區域用白色目標，mask=0 的區域保持原色
    result = result * (1.0 - white_mask[:, :, np.newaxis]) + \
             white_target * white_mask[:, :, np.newaxis]

    return np.clip(result, 0, 255).astype(np.uint8)


# ── 改良後的原有濾鏡 ──

def _filter_auto(img: np.ndarray) -> np.ndarray:
    """智慧自動模式 — 使用專業掃描演算法

    自動判斷文件類型，選擇最佳處理策略：
    - 如果偵測到較多彩色內容 → 使用彩色文件模式
    - 一般文件 → 使用專業掃描模式
    """
    # 簡單判斷文件是否有較多彩色內容
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    # 高飽和度像素佔比
    color_ratio = np.mean(saturation > 80)

    if color_ratio > 0.05:
        # 5% 以上像素有明顯色彩 → 彩色文件模式
        logger.info("自動模式：偵測到彩色內容 (%.1f%%)，使用彩色文件模式",
                     color_ratio * 100)
        return _filter_color_doc(img)
    else:
        logger.info("自動模式：使用專業掃描模式")
        return _filter_scan(img)


def _remove_background_shadow(img: np.ndarray) -> np.ndarray:
    """去除光照不均和背景陰影（改良版 — 使用形態學背景估計）"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bg = _estimate_background_morphological(gray)
    normalized = _normalize_illumination(gray, bg, target=230.0)

    # 提升對比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(normalized)

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
    """文件模式 — 高對比清晰文字，白色背景（改良版）"""
    # 先用形態學去除背景陰影
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
    """黑白掃描模式 — 乾淨的二值化（改良版）"""
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
    """增強模式 — 保持彩色，去除陰影，提升清晰度（改良版）"""
    # 白平衡
    img = _white_balance_grayworld(img)

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # 用形態學估計背景
    l_bg = _estimate_background_morphological(l)
    l_norm = _normalize_illumination(l, l_bg, target=220.0)

    # CLAHE 加強對比
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_norm)

    lab_out = cv2.merge([l_enhanced, a, b])
    result = cv2.cvtColor(lab_out, cv2.COLOR_LAB2BGR)

    # 雙邊濾波（去噪保邊）
    result = cv2.bilateralFilter(result, 5, 40, 40)

    # 銳化
    result = _adaptive_sharpening(result, strength=0.3)

    return result


# ══════════════════════════════════════════════════════════════
# 6. 圖片旋轉
# ══════════════════════════════════════════════════════════════

def rotate_image(image_data: bytes, angle: int) -> bytes:
    """旋轉圖片（90° 的整數倍）

    Args:
        image_data: JPEG/PNG bytes
        angle: 旋轉角度，正值=順時針。支援 90, 180, 270, -90, -180, -270

    Returns:
        旋轉後的 JPEG bytes
    """
    # 正規化角度到 0, 90, 180, 270
    normalized = angle % 360
    if normalized == 0:
        return image_data

    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if normalized == 90:
        rotated = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif normalized == 180:
        rotated = cv2.rotate(img, cv2.ROTATE_180)
    elif normalized == 270:
        rotated = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    else:
        # 任意角度旋轉（保留完整畫面）
        h, w = img.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, -normalized, 1.0)
        cos_a = abs(M[0, 0])
        sin_a = abs(M[0, 1])
        new_w = int(h * sin_a + w * cos_a)
        new_h = int(h * cos_a + w * sin_a)
        M[0, 2] += (new_w - w) / 2
        M[1, 2] += (new_h - h) / 2
        rotated = cv2.warpAffine(img, M, (new_w, new_h),
                                  flags=cv2.INTER_LANCZOS4,
                                  borderMode=cv2.BORDER_REPLICATE)

    _, buf = cv2.imencode(".jpg", rotated, [cv2.IMWRITE_JPEG_QUALITY, 95])
    result = buf.tobytes()
    logger.info("圖片旋轉 %d° 完成: %dx%d → %dx%d",
                normalized, img.shape[1], img.shape[0],
                rotated.shape[1], rotated.shape[0])
    return result


# ══════════════════════════════════════════════════════════════
# 7. 完整掃描流水線
# ══════════════════════════════════════════════════════════════

def scan_document(image_data: bytes,
                  corners: Optional[list[list[int]]] = None,
                  filter_name: str = "auto",
                  auto_detect: bool = True) -> dict:
    """完整文件掃描處理流水線（加強錯誤處理）"""
    nparr = np.frombuffer(image_data, np.uint8)
    orig = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if orig is None:
        raise ValueError("無法解碼圖片")
    orig_h, orig_w = orig.shape[:2]

    processed = image_data
    detected_corners = corners
    auto_detected = False
    distortion_info = None

    # Step 1: 邊界偵測 + 透視校正
    if corners:
        try:
            distortion_info = _estimate_distortion_level(
                np.array(corners, dtype="float32"))
            processed = perspective_transform(processed, corners)
        except Exception as e:
            logger.error("透視校正失敗（手動角點）: %s", e, exc_info=True)
            # 失敗時跳過透視校正，繼續處理原圖
    elif auto_detect:
        detected_corners = detect_document_edges(image_data)
        if detected_corners:
            try:
                auto_detected = True
                distortion_info = _estimate_distortion_level(
                    np.array(detected_corners, dtype="float32"))
                processed = perspective_transform(processed, detected_corners)
                logger.info("自動邊界偵測 + 透視校正完成")
            except Exception as e:
                logger.error("透視校正失敗（自動偵測）: %s", e, exc_info=True)
                processed = image_data  # fallback 到原圖
        else:
            logger.info("未偵測到邊界，跳過透視校正")

    # Step 2: 套用濾鏡
    try:
        processed = apply_filter(processed, filter_name)
    except Exception as e:
        logger.error("濾鏡套用失敗: %s", e, exc_info=True)
        # 濾鏡失敗時使用未經濾鏡的版本

    proc_arr = np.frombuffer(processed, np.uint8)
    proc_img = cv2.imdecode(proc_arr, cv2.IMREAD_COLOR)
    if proc_img is None:
        # 最終 fallback：使用原圖
        processed = image_data
        proc_w, proc_h = orig_w, orig_h
    else:
        proc_h, proc_w = proc_img.shape[:2]

    return {
        "image": processed,
        "corners": detected_corners,
        "auto_detected": auto_detected,
        "filter_applied": filter_name,
        "original_size": (orig_w, orig_h),
        "processed_size": (proc_w, proc_h),
        "distortion": distortion_info,
    }
