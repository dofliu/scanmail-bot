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
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.utils.model_downloader import download_file

logger = logging.getLogger(__name__)

# HED Model Configuration
HED_PROTO_URL = "https://raw.githubusercontent.com/ashukid/hed-edge-detector/master/deploy.prototxt"
HED_MODEL_URL = "https://vcl.ucsd.edu/hed/hed_pretrained_bsds.caffemodel"

HED_DIR = Path("data/models/hed")
PROTO_PATH = HED_DIR / "deploy.prototxt"
MODEL_PATH = HED_DIR / "hed_pretrained_bsds.caffemodel"

# U-Net Model Configuration
UNET_PTH_URL = "https://huggingface.co/Lingram/DocuSegment-Pytorch/resolve/main/unet_16.pth"
UNET_DIR = Path("data/models/unet")
UNET_PTH_PATH = UNET_DIR / "unet_16.pth"
UNET_ONNX_PATH = UNET_DIR / "unet_16.onnx"


class CropLayer(object):
    """自訂 Crop Layer 用於 OpenCV DNN 載入 HED Caffe 模型"""
    def __init__(self, params, blobs):
        self.startX = 0
        self.startY = 0
        self.endX = 0
        self.endY = 0

    def getMemoryShapes(self, inputs):
        inputShape = inputs[0]
        targetShape = inputs[1]
        batchSize = inputShape[0]
        numChannels = inputShape[1]
        H = targetShape[2]
        W = targetShape[3]

        self.startX = int((inputShape[3] - targetShape[3]) / 2)
        self.startY = int((inputShape[2] - targetShape[2]) / 2)
        self.endX = self.startX + W
        self.endY = self.startY + H

        return [[batchSize, numChannels, H, W]]

    def forward(self, inputs):
        return [inputs[0][:, :, self.startY:self.endY, self.startX:self.endX]]


# 註冊 Crop layer 到 OpenCV DNN
try:
    cv2.dnn_registerLayer("Crop", CropLayer)
    logger.info("成功註冊 HED CropLayer")
except Exception as e:
    logger.warning("無法註冊 CropLayer 或已被註冊: %s", e)


# ══════════════════════════════════════════════════════════════
# 1. 邊界偵測（v4 — 內容感知評分）
#
# v3 問題：純幾何評分（面積/矩形度/離邊距離）無法區分
#   「真正的文件」vs「碰巧形狀對的背景區域」
#
# v4 改進：加入內容感知信號
#   D. 內部比外部亮 → 真文件（紙張是白的）
#   E. 邊緣有強烈梯度 → 文件與背景有明顯分界
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

    # 面積限制：5% ~ 97%
    # 上限原本是 80%，會誤拒近距離拍攝（文件填滿畫面）這種常見且建議的
    # 拍攝方式 —— 使用者為了最大解析度把文件拍到快滿版是標準做法，
    # 不該被當成異常。真正的「整張照片＝文件」誤判由下方的貼邊規則把關，
    # 不需要靠面積上限重複防禦。
    if ratio < 0.05 or ratio > 0.97:
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


class _ScoreContext:
    """每張影像只計算一次的共用特徵（灰階、梯度圖）

    v4 的評分對每個候選四邊形都重算整張 Sobel 梯度圖，
    數十個候選 × 多個策略會造成秒級的重複運算。
    v5 把昂貴特徵預先算好，所有候選共用。
    """

    def __init__(self, img_s: np.ndarray):
        self.img = img_s
        self.h, self.w = img_s.shape[:2]
        self.gray = cv2.cvtColor(img_s, cv2.COLOR_BGR2GRAY)
        gx = cv2.Sobel(self.gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(self.gray, cv2.CV_32F, 0, 1, ksize=3)
        grad = cv2.magnitude(gx, gy)
        # 3x3 最大值濾波：邊緣取樣時容忍 1px 的量化誤差
        self.grad_max3 = cv2.dilate(grad, cv2.getStructuringElement(
            cv2.MORPH_RECT, (3, 3)))


def _edge_support_scores(ctx: _ScoreContext, corners: np.ndarray) -> list[float]:
    """逐邊評估「這條邊下方真的存在文件邊緣嗎」

    對每條邊取樣 20 點，每點比較：
    - 邊緣上的梯度 g_edge
    - 往四邊形內側偏移 8px 處的梯度 g_in（紙張留白應該平滑）

    真文件邊緣：g_edge 強且顯著大於 g_in（紙張到背景的跳變）。
    紋理背景上的假邊（如木紋）：g_edge ≈ g_in → 不算支持。

    Returns:
        四條邊各自的分數 [0~1] × 4
    """
    pts = _order_points(corners.astype(np.float32))  # 順時針 TL,TR,BR,BL
    inner_off = max(5.0, 0.01 * max(ctx.w, ctx.h))
    scores = []
    for i in range(4):
        p1, p2 = pts[i], pts[(i + 1) % 4]
        d = p2 - p1
        length = float(np.hypot(d[0], d[1]))
        if length < 4:
            scores.append(0.0)
            continue
        # 順時針排序下，(-dy, dx) 指向四邊形內側
        nvec = np.array([-d[1], d[0]], np.float32) / length

        ts = np.linspace(0.08, 0.92, 20)
        ex = p1[0] + ts * d[0]
        ey = p1[1] + ts * d[1]
        xs = np.clip(ex.astype(np.int32), 0, ctx.w - 1)
        ys = np.clip(ey.astype(np.int32), 0, ctx.h - 1)
        xi = np.clip((ex + nvec[0] * inner_off).astype(np.int32), 0, ctx.w - 1)
        yi = np.clip((ey + nvec[1] * inner_off).astype(np.int32), 0, ctx.h - 1)

        g_edge = ctx.grad_max3[ys, xs]
        g_in = ctx.grad_max3[yi, xi]

        supported = g_edge > np.maximum(1.6 * g_in, 25.0)
        support = float(np.mean(supported))
        strength = float(np.mean(np.minimum(g_edge / 60.0, 1.0)))
        scores.append(support * (0.5 + 0.5 * strength))
    return scores


def _score_doc_quad(corners: np.ndarray, img_w: int, img_h: int,
                    ctx: Optional[_ScoreContext] = None) -> float:
    """評分四邊形的「文件可信度」(v5 — 逐邊證據 + 透視友善幾何)

    v4 問題：
    1. 「矩形度」（面積/最小外接矩形）懲罰透視變形的梯形，
       導致大角度拍攝時 minAreaRect 包圍盒反而贏過真正的文件邊界。
    2. 邊緣梯度只取「四邊平均」，一條完全沒有影像證據的邊
       （例如貼著圖片邊框的假邊）不會被淘汰。

    v5 改進：
    - 矩形度 → 凸性（凸四邊形不懲罰透視梯形）
    - 逐邊梯度支持度：最弱的一條邊主導懲罰（乘法門控）
    """
    area = cv2.contourArea(corners)
    img_area = img_w * img_h
    ratio = area / img_area

    # ── 幾何分數 ──

    # 面積分：10%~90% 都給滿分（近距離拍攝文件填滿畫面是常見且建議的拍法），
    # 90%~97% 緩降，> 97% 才視為可疑（見 _is_valid_doc_quad 的硬性上限）
    if ratio < 0.05:
        area_s = 0
    elif ratio < 0.15:
        area_s = (ratio - 0.05) / 0.10
    elif ratio < 0.90:
        area_s = 1.0
    elif ratio < 0.97:
        area_s = 1.0 - (ratio - 0.90) / 0.07
    else:
        area_s = 0

    # 凸性（取代 v4 的矩形度 — 透視下的文件是梯形，不該被懲罰）
    hull = cv2.convexHull(corners.reshape(-1, 1, 2).astype(np.int32))
    hull_area = cv2.contourArea(hull)
    convexity = min(area / hull_area, 1.0) if hull_area > 0 else 0.0

    # 離邊距離
    ordered = _order_points(corners.astype("float32"))
    min_border_dist = min(
        ordered[0][0], ordered[0][1],
        img_w - ordered[1][0], ordered[1][1],
        img_w - ordered[2][0], img_h - ordered[2][1],
        ordered[3][0], img_h - ordered[3][1],
    )
    border_s = min(min_border_dist / (max(img_w, img_h) * 0.05), 1.0)

    # 紙張寬高比
    (tl, tr, br, bl) = ordered
    w_avg = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    h_avg = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if max(w_avg, h_avg) > 0:
        aspect = min(w_avg, h_avg) / max(w_avg, h_avg)
    else:
        aspect = 0

    # 偏好常見文件/卡片寬高比 (0.4 到 1.0 之間都不扣分)
    if 0.4 <= aspect <= 1.0:
        aspect_s = 1.0
    else:
        aspect_s = max(0, 1.0 - min(abs(aspect - 0.4), abs(aspect - 1.0)) * 2.5)

    geo_score = area_s * 0.35 + convexity * 0.25 + border_s * 0.20 + aspect_s * 0.20

    # ── 內容分數（需要預計算特徵）──
    if ctx is None:
        return geo_score

    content_score, edge_min = _score_content(corners, ctx)

    # 最終分數：幾何 40% + 內容 60%，再以「最弱邊證據」門控
    # （任何一條邊完全沒有影像證據 → 不管其他分數多高都重罰，
    #   例如貼著圖框的假邊、明暗漸層被 Otsu 切一半的假區域）
    score = geo_score * 0.40 + content_score * 0.60
    return score * (0.55 + 0.45 * edge_min)


def _score_content(corners: np.ndarray, ctx: _ScoreContext) -> tuple[float, float]:
    """評估候選四邊形內部的「文件特徵」（v5 — 共用預計算特徵）

    1. 內外亮度差：文件內部應比外部亮（紙張 vs 背景）
    2. 內部亮度均勻度：紙張亮度應該比較均勻
    3. 逐邊梯度支持度：四條邊都必須有影像證據，最弱邊主導懲罰

    Returns:
        (content_score, edge_min)：內容分數與最弱邊支持度（供上層門控）
    """
    gray = ctx.gray
    img_h, img_w = ctx.h, ctx.w

    # 建立內部遮罩
    mask_in = np.zeros((img_h, img_w), dtype=np.uint8)
    pts = _order_points(corners.astype("float32")).astype(np.int32)
    cv2.fillConvexPoly(mask_in, pts, 255)

    # 建立外部遮罩（排除圖片邊緣 5%）
    margin = int(max(img_w, img_h) * 0.05)
    mask_out = np.zeros((img_h, img_w), dtype=np.uint8)
    mask_out[margin:img_h-margin, margin:img_w-margin] = 255
    mask_out = cv2.bitwise_and(mask_out, cv2.bitwise_not(mask_in))

    # 如果遮罩面積太小就跳過
    in_count = cv2.countNonZero(mask_in)
    out_count = cv2.countNonZero(mask_out)
    if in_count < 100 or out_count < 100:
        return 0.5, 0.5

    # 1. 內外亮度差（0~1）— mean/std 一次算完
    mean_in_arr, std_in_arr = cv2.meanStdDev(gray, mask=mask_in)
    mean_in = float(mean_in_arr[0][0])
    std_in = float(std_in_arr[0][0])
    mean_out = cv2.mean(gray, mask=mask_out)[0]
    # 文件內部應該比外部亮 20~100
    brightness_diff = mean_in - mean_out
    if brightness_diff > 60:
        bright_s = 1.0
    elif brightness_diff > 20:
        bright_s = (brightness_diff - 20) / 40.0
    elif brightness_diff > 0:
        bright_s = brightness_diff / 20.0 * 0.3
    else:
        bright_s = 0  # 內部比外部暗 → 不像文件

    # 2. 內部亮度均勻度（低標準差 = 均勻 = 紙張）
    # 紙張 std 通常 20~50，複雜場景 std > 60
    if std_in < 30:
        uniform_s = 1.0
    elif std_in < 50:
        uniform_s = 1.0 - (std_in - 30) / 20.0 * 0.5
    elif std_in < 70:
        uniform_s = 0.5 - (std_in - 50) / 20.0 * 0.3
    else:
        uniform_s = 0.2

    # 3. 逐邊梯度支持度：平均 × 最弱邊門控
    # 一條邊完全沒有梯度證據（如貼著圖框的假邊）→ 重罰
    edge_scores = _edge_support_scores(ctx, pts)
    edge_mean = float(np.mean(edge_scores))
    edge_min = float(np.min(edge_scores))
    edge_s = edge_mean * (0.35 + 0.65 * edge_min)

    content = bright_s * 0.35 + uniform_s * 0.20 + edge_s * 0.45
    return content, edge_min


def _intersect_lines(l1: dict, l2: dict) -> Optional[tuple[float, float]]:
    """Find intersection of two lines Ax + By + C = 0"""
    D = l1["A"] * l2["B"] - l2["A"] * l1["B"]
    if abs(D) < 1e-5:
        return None
    x = (l1["B"] * l2["C"] - l2["B"] * l1["C"]) / D
    y = (l2["A"] * l1["C"] - l1["A"] * l2["C"]) / D
    return (x, y)


def _reconstruct_quad_from_poly(poly: np.ndarray, img_w: int, img_h: int) -> Optional[np.ndarray]:
    """
    Given a polygon with 5 or 6 vertices, find the best 4 lines (edges) and
    compute their intersections to reconstruct a 4-cornered quad.
    """
    import itertools
    pts = poly.reshape(-1, 2)
    n = len(pts)
    if n not in (5, 6):
        return None

    # Compute edges and classify as horizontal or vertical
    edges = []
    horizontals = []
    verticals = []

    for i in range(n):
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = math.hypot(dx, dy)
        if length < 1e-3:
            continue
        
        # Represent line as Ax + By + C = 0
        A = dy
        B = -dx
        C = dx * p1[1] - dy * p1[0]
        
        edge_info = {
            "p1": p1,
            "p2": p2,
            "A": A,
            "B": B,
            "C": C,
            "length": length,
            "is_horizontal": abs(dx) > abs(dy)
        }
        edges.append(edge_info)
        if edge_info["is_horizontal"]:
            horizontals.append(edge_info)
        else:
            verticals.append(edge_info)

    # We need to choose exactly 2 horizontal lines and 2 vertical lines
    if len(horizontals) < 2 or len(verticals) < 2:
        return None

    best_reconstructed = None
    best_reconstructed_score = -1.0

    # Try all combinations of 2 horizontals and 2 verticals
    for h1, h2 in itertools.combinations(horizontals, 2):
        for v1, v2 in itertools.combinations(verticals, 2):
            pt1 = _intersect_lines(h1, v1)
            pt2 = _intersect_lines(h1, v2)
            pt3 = _intersect_lines(h2, v1)
            pt4 = _intersect_lines(h2, v2)

            if pt1 is None or pt2 is None or pt3 is None or pt4 is None:
                continue

            quad = np.array([pt1, pt2, pt4, pt3], dtype=np.float32)
            ordered = _order_points(quad)

            # Check if all points are within a reasonable boundary (allow 15% margin outside image)
            margin_w = img_w * 0.15
            margin_h = img_h * 0.15
            valid_bounds = True
            for pt in ordered:
                if not (-margin_w <= pt[0] <= img_w + margin_w and -margin_h <= pt[1] <= img_h + margin_h):
                    valid_bounds = False
                    break
            
            if not valid_bounds:
                continue

            # Prioritize the combination of edges that have the maximum total length in the original polygon,
            # which ensures we reconstruct from the main boundaries instead of cut-off/noise segments.
            score = h1["length"] + h2["length"] + v1["length"] + v2["length"]
            if score > best_reconstructed_score:
                best_reconstructed_score = score
                best_reconstructed = ordered

    if best_reconstructed is not None:
        return best_reconstructed.astype(np.int32)
    return None


def _find_best_quad(mask: np.ndarray, img_w: int, img_h: int,
                    ctx: Optional[_ScoreContext] = None) -> Optional[tuple]:
    """從二值遮罩中找出最佳的文件四邊形

    Returns:
        (corners, score) 或 None
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:20]

    best_score = -1
    best_pts = None

    for c in contours:
        peri = cv2.arcLength(c, True)
        if peri < 100:
            continue

        # 1. Standard approximation on raw contour
        for eps in [0.015, 0.02, 0.03, 0.04, 0.05, 0.06]:
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4:
                pts = approx.reshape(4, 2)
                if _is_valid_doc_quad(pts, img_w, img_h):
                    score = _score_doc_quad(pts, img_w, img_h, ctx)
                    if score > best_score:
                        best_score = score
                        best_pts = pts
                break
            elif len(approx) in (5, 6):
                # Try 5/6-side reconstruction on raw contour
                reconstructed = _reconstruct_quad_from_poly(approx, img_w, img_h)
                if reconstructed is not None and _is_valid_doc_quad(reconstructed, img_w, img_h):
                    score = _score_doc_quad(reconstructed, img_w, img_h, ctx)
                    if score > best_score:
                        best_score = score
                        best_pts = reconstructed
                    break

        # 2. Convex Hull approximation (to bridge finger/occlusion dents)
        hull = cv2.convexHull(c)
        hull_peri = cv2.arcLength(hull, True)
        for eps in [0.015, 0.02, 0.03, 0.04, 0.05, 0.06]:
            approx_hull = cv2.approxPolyDP(hull, eps * hull_peri, True)
            if len(approx_hull) == 4:
                pts = approx_hull.reshape(4, 2)
                if _is_valid_doc_quad(pts, img_w, img_h):
                    score = _score_doc_quad(pts, img_w, img_h, ctx)
                    if score > best_score:
                        best_score = score
                        best_pts = pts
                break
            elif len(approx_hull) in (5, 6):
                # Try 5/6-side reconstruction on convex hull
                reconstructed = _reconstruct_quad_from_poly(approx_hull, img_w, img_h)
                if reconstructed is not None and _is_valid_doc_quad(reconstructed, img_w, img_h):
                    score = _score_doc_quad(reconstructed, img_w, img_h, ctx)
                    if score > best_score:
                        best_score = score
                        best_pts = reconstructed
                    break

        # 3. 最小外接矩形 fallback
        c_area = cv2.contourArea(c)
        if c_area > img_w * img_h * 0.05:
            rect = cv2.minAreaRect(c)
            box = cv2.boxPoints(rect).astype(int)
            if _is_valid_doc_quad(box, img_w, img_h):
                score = _score_doc_quad(box, img_w, img_h, ctx)
                if score > best_score:
                    best_score = score
                    best_pts = box

    if best_pts is not None:
        return (best_pts, best_score)
    return None


_hed_net = None
# 模型載入失敗後的冷卻時間（秒）— 避免每次掃描請求都重新嘗試下載模型
# （下載失敗時每次重試 3 次 + 等待，會讓單次掃描多花數十秒）
_MODEL_RETRY_COOLDOWN = 3600.0
_hed_failed_at: Optional[float] = None
_unet_failed_at: Optional[float] = None


def ensure_hed_model() -> bool:
    """確保 HED 模型檔案已下載"""
    success_proto = download_file(HED_PROTO_URL, PROTO_PATH)
    success_model = download_file(HED_MODEL_URL, MODEL_PATH)
    return success_proto and success_model


def _get_hed_net():
    """取得或初始化 HED 網路模型（失敗後進入冷卻期，不阻塞掃描請求）"""
    global _hed_net, _hed_failed_at
    if _hed_net is not None:
        return _hed_net

    if _hed_failed_at is not None and time.monotonic() - _hed_failed_at < _MODEL_RETRY_COOLDOWN:
        return None

    if not ensure_hed_model():
        logger.error("HED 模型檔案不完整，無法載入網路（%d 秒後才會重試）",
                     int(_MODEL_RETRY_COOLDOWN))
        _hed_failed_at = time.monotonic()
        return None

    try:
        _hed_net = cv2.dnn.readNetFromCaffe(str(PROTO_PATH), str(MODEL_PATH))
        logger.info("成功載入 HED Caffe 模型")
        return _hed_net
    except Exception as e:
        logger.error("載入 HED 網路失敗: %s", e)
        _hed_failed_at = time.monotonic()
        return None


def _detect_edges_hed(img_s: np.ndarray) -> Optional[np.ndarray]:
    """使用 HED 模型提取文件顯著邊緣，輸出二值化邊緣遮罩"""
    net = _get_hed_net()
    if net is None:
        return None

    h, w = img_s.shape[:2]

    # HED 模型最佳的輸入大小約為 500x500
    blob = cv2.dnn.blobFromImage(
        img_s,
        scalefactor=1.0,
        size=(500, 500),
        mean=(104.006, 116.669, 122.679),
        swapRB=False,
        crop=False
    )

    try:
        net.setInput(blob)
        hed_output = net.forward()
        # 取得單通道邊緣機率圖 (shape: 1 x 1 x 500 x 500)
        hed_edge = hed_output[0, 0]
        # 還原回縮放影像的大小
        hed_edge = cv2.resize(hed_edge, (w, h))
        hed_edge = (hed_edge * 255).astype(np.uint8)

        # 進行二值化，過濾低機率的邊緣點
        _, thresh = cv2.threshold(hed_edge, 50, 255, cv2.THRESH_BINARY)

        # 形態學閉合與膨脹，確保細小斷線縫合
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        thresh = cv2.dilate(thresh, k, iterations=1)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
                                  iterations=1)
        return thresh
    except Exception as e:
        logger.error("HED 邊緣推理失敗: %s", e)
        return None


# ── U-Net Model Definition (for ONNX Export) ──
# This is a lightweight UNet model with start_channels=16, trained on documents.
# We define it here so that we can load the weights from the .pth file and export it to ONNX.

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class UNetConvBlock(nn.Module):
        def __init__(self, in_channels, out_channels, mid_channels=None):
            super().__init__()
            if not mid_channels:
                mid_channels = out_channels
            self.conv = nn.Sequential(
                nn.Conv2d(in_channels, mid_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(mid_channels),
                nn.ReLU(inplace=True),
                nn.Conv2d(mid_channels, out_channels, kernel_size=3, padding=1, bias=False),
                nn.BatchNorm2d(out_channels),
                nn.ReLU(inplace=True)
            )
        def forward(self, x):
            return self.conv(x)

    class UNetDown(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.pool = nn.Sequential(
                nn.MaxPool2d(kernel_size=2),
                UNetConvBlock(in_channels, out_channels)
            )
        def forward(self, x):
            return self.pool(x)

    class UNetUp(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.up = nn.ConvTranspose2d(in_channels, in_channels // 2, kernel_size=2, stride=2)
            self.conv = UNetConvBlock(in_channels, out_channels)
        def forward(self, x, skip):
            upsampled = self.up(x)
            diffY = skip.size()[2] - upsampled.size()[2]
            diffX = skip.size()[3] - upsampled.size()[3]
            upsampled = F.pad(upsampled, [diffY // 2, diffY - diffX // 2, diffY // 2, diffY - diffX // 2])
            out = torch.cat([skip, upsampled], dim=1)
            return self.conv(out)

    class UNetOut(nn.Module):
        def __init__(self, in_channels, out_channels):
            super().__init__()
            self.conv = nn.Conv2d(in_channels, out_channels, kernel_size=1)
        def forward(self, x):
            return self.conv(x)

    class UNet(nn.Module):
        def __init__(self, n_channels, n_classes, n_blocks=4, start=32):
            super(UNet, self).__init__()
            self.n_blocks = n_blocks
            self.n_classes = n_classes
            self.start = start
            self.layers = nn.Sequential(
                UNetConvBlock(n_channels, start),
                *self.get_blocks(start),
                UNetOut(start, n_classes)
            )
        def forward(self, x):
            num_layers = len(self.layers)
            outs = [x]
            for i in range(0, self.n_blocks + 1):
                outs.append(self.layers[i].forward(outs[-1]))
            out = outs.pop()
            for i in range(self.n_blocks + 1, num_layers - 1):
                out = self.layers[i].forward(out, outs.pop())
            logits = self.layers[-1].forward(out)
            return logits
        def get_blocks(self, start):
            blocks = []
            for i in range(self.n_blocks):
                start_mult = start * 2 ** i
                blocks.append(UNetDown(start_mult, start_mult * 2))
            for i in range(self.n_blocks - 1, -1, -1):
                start_mult = start * 2 ** i
                blocks.append(UNetUp(start_mult * 2, start_mult))
            return blocks
except ImportError:
    # PyTorch is not required for inference, only for ONNX conversion on development machine
    pass


_unet_net = None

def ensure_unet_model() -> bool:
    """確保 U-Net ONNX 模型存在。若不存在但本地有 PyTorch，則下載 .pth 並動態轉換。"""
    if UNET_ONNX_PATH.exists():
        return True

    logger.info("未檢測到 U-Net ONNX 模型，嘗試下載與轉換...")
    success_pth = download_file(UNET_PTH_URL, UNET_PTH_PATH)
    if not success_pth:
        logger.error("下載 U-Net .pth 模型失敗")
        return False

    try:
        import torch
        logger.info("檢測到本地 PyTorch，正在進行 .pth -> .onnx 轉換...")
        
        # 載入權重並讀取超參數
        ckpt = torch.load(UNET_PTH_PATH, map_location="cpu")
        n_blocks = ckpt.get("n_blocks", 4)
        n_classes = ckpt.get("n_classes", 2)
        start_channels = ckpt.get("start_channels", 16)
        
        # 建構模型
        model = UNet(n_channels=3, n_classes=n_classes, n_blocks=n_blocks, start=start_channels)
        model.load_state_dict(ckpt["state_dict"])
        model.eval()
        
        # 導出為 ONNX
        dummy_input = torch.randn(1, 3, 256, 256)
        UNET_ONNX_PATH.parent.mkdir(parents=True, exist_ok=True)
        torch.onnx.export(
            model,
            dummy_input,
            str(UNET_ONNX_PATH),
            input_names=["input"],
            output_names=["output"],
            opset_version=11,
            do_constant_folding=True
        )
        logger.info("成功導出 U-Net ONNX 模型: %s", UNET_ONNX_PATH.name)
        # 轉換成功後可刪除臨時的 .pth 檔案以釋放空間
        try:
            UNET_PTH_PATH.unlink(missing_ok=True)
        except Exception:
            pass
        return True
    except ImportError:
        logger.warning("環境中未安裝 PyTorch，無法將 .pth 轉換為 .onnx。請確保手動放置 %s 於本地", UNET_ONNX_PATH.name)
        return False
    except Exception as e:
        logger.error("U-Net ONNX 模型轉換失敗: %s", e)
        return False


def _get_unet_net():
    """取得或初始化 U-Net 網路模型（失敗後進入冷卻期，不阻塞掃描請求）"""
    global _unet_net, _unet_failed_at
    if _unet_net is not None:
        return _unet_net

    if _unet_failed_at is not None and time.monotonic() - _unet_failed_at < _MODEL_RETRY_COOLDOWN:
        return None

    if not ensure_unet_model() or not UNET_ONNX_PATH.exists():
        logger.warning("U-Net 模型檔案未就緒（將優雅降級，%d 秒後才會重試）",
                       int(_MODEL_RETRY_COOLDOWN))
        _unet_failed_at = time.monotonic()
        return None

    try:
        _unet_net = cv2.dnn.readNetFromONNX(str(UNET_ONNX_PATH))
        logger.info("成功載入 U-Net ONNX 模型")
        return _unet_net
    except Exception as e:
        logger.error("載入 U-Net ONNX 網路失敗: %s", e)
        _unet_failed_at = time.monotonic()
        return None


def _detect_mask_unet(img_s: np.ndarray) -> Optional[np.ndarray]:
    """使用 U-Net 模型對文件進行語意分割，輸出二值化遮罩 (255 表示文件，0 表示背景)"""
    net = _get_unet_net()
    if net is None:
        return None

    h, w = img_s.shape[:2]

    try:
        # U-Net 模型的輸入尺寸為 256x256
        # 1. 轉為 RGB 格式 (OpenCV 預設是 BGR)
        img_rgb = cv2.cvtColor(img_s, cv2.COLOR_BGR2RGB)
        # 2. 縮放到 256x256
        img_resized = cv2.resize(img_rgb, (256, 256), interpolation=cv2.INTER_LINEAR)
        # 3. 轉為 float32 並除以 255.0
        img_float = img_resized.astype(np.float32) / 255.0
        # 4. 進行 Z-score 正規化
        mean = np.array([0.4611, 0.4359, 0.3905], dtype=np.float32)
        std = np.array([0.2193, 0.2150, 0.2109], dtype=np.float32)
        normalized = (img_float - mean) / std
        # 5. 轉換成 (1, 3, 256, 256) 的 blob
        blob = np.transpose(normalized, (2, 0, 1))
        blob = np.expand_dims(blob, axis=0)

        # 6. 推理
        net.setInput(blob)
        out = net.forward() # shape: (1, 2, 256, 256)

        # 7. 後處理：比較 Channel 1 (文件) 與 Channel 0 (背景)
        ch0 = out[0, 0, :, :]
        ch1 = out[0, 1, :, :]
        mask_256 = (ch1 > ch0).astype(np.uint8) * 255

        # 8. 縮放回原始大小 (w, h)
        mask = cv2.resize(mask_256, (w, h), interpolation=cv2.INTER_NEAREST)
        
        # 9. 形態學開合與閉合去噪，縫合孔洞並移除噪點
        k_s = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        k_l = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_s, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_l, iterations=1)
        
        return mask
    except Exception as e:
        logger.error("U-Net 語意分割推理失敗: %s", e)
        return None


def _refine_corners_fullres(img: np.ndarray,
                            corners: np.ndarray) -> np.ndarray:
    """在原始解析度上做次像素邊緣吸附，精修粗偵測的角點

    粗偵測在 ~800px 縮圖上進行，縮放回原圖後會有數像素的量化誤差，
    且遮罩形態學運算可能讓邊界偏移。本函式：

    1. 對每條邊取樣 28 點，沿法線方向搜尋亮度變化最大的位置
       （次像素：對梯度峰值做拋物線內插）
    2. 用 Huber 穩健直線擬合吸附點（自動忽略手指遮擋等離群點）
    3. 相鄰邊直線求交點 = 精修後的角點

    任一步驟證據不足（吸附點太少、交點偏移過大）就保留原值，
    確保精修只會變好不會變壞。
    """
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ordered = _order_points(corners.astype(np.float32))

    # 搜尋半徑：約影像長邊的 1.2%（涵蓋粗偵測的縮放誤差）
    search = max(6.0, 0.012 * max(w, h))
    offs = np.arange(-search, search + 1.0, 1.0, dtype=np.float32)

    lines = []
    for i in range(4):
        p1, p2 = ordered[i], ordered[(i + 1) % 4]
        edge_vec = p2 - p1
        length = float(np.linalg.norm(edge_vec))
        if length < 10:
            return corners  # 退化四邊形，不精修

        # 原始邊直線（fallback 用）
        A0, B0 = edge_vec[1], -edge_vec[0]
        C0 = edge_vec[0] * p1[1] - edge_vec[1] * p1[0]
        fallback = {"A": float(A0), "B": float(B0), "C": float(C0)}

        nvec = np.array([-edge_vec[1], edge_vec[0]], np.float32) / length
        ts = np.linspace(0.06, 0.94, 28, dtype=np.float32)
        base = p1[None, :] + ts[:, None] * edge_vec[None, :]

        # 沿法線取樣亮度剖面 (28, len(offs))
        map_x = base[:, 0:1] + offs[None, :] * nvec[0]
        map_y = base[:, 1:2] + offs[None, :] * nvec[1]
        prof = cv2.remap(gray, map_x, map_y, cv2.INTER_LINEAR,
                         borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
        # 沿法線方向平滑後取中央差分（近似一階導數）
        prof = cv2.GaussianBlur(prof, (5, 1), 0)
        dprof = np.abs(prof[:, 2:] - prof[:, :-2])

        idx = np.argmax(dprof, axis=1)
        strength = dprof[np.arange(len(ts)), idx]

        # 拋物線次像素內插
        idx_c = np.clip(idx, 1, dprof.shape[1] - 2)
        y0 = dprof[np.arange(len(ts)), idx_c - 1]
        y1 = dprof[np.arange(len(ts)), idx_c]
        y2 = dprof[np.arange(len(ts)), idx_c + 1]
        denom = y0 - 2 * y1 + y2
        safe_denom = np.where(np.abs(denom) > 1e-6, denom, 1.0)
        delta = np.where(np.abs(denom) > 1e-6, 0.5 * (y0 - y2) / safe_denom, 0.0)
        delta = np.clip(delta, -1.0, 1.0)
        # dprof 索引 j 對應 offs[j+1]
        off_star = offs[np.clip(idx + 1, 0, len(offs) - 1)] + delta

        # 只保留梯度證據夠強的取樣點
        thr = max(8.0, float(np.median(strength)) * 0.35)
        good = strength > thr
        if int(np.sum(good)) < 8:
            lines.append(fallback)
            continue

        snapped = base[good] + off_star[good, None] * nvec[None, :]
        vx, vy, x0, ly0 = cv2.fitLine(snapped.astype(np.float32),
                                      cv2.DIST_HUBER, 0, 0.01, 0.01).flatten()
        lines.append({"A": float(vy), "B": float(-vx),
                      "C": float(vx * ly0 - vy * x0)})

    refined = []
    max_shift = 2.5 * search
    for i in range(4):
        pt = _intersect_lines(lines[i - 1], lines[i])
        orig = ordered[i]
        if pt is None or math.hypot(pt[0] - orig[0], pt[1] - orig[1]) > max_shift:
            pt = (float(orig[0]), float(orig[1]))
        refined.append([min(max(pt[0], 0.0), w - 1.0),
                        min(max(pt[1], 0.0), h - 1.0)])
    return np.array(refined, np.float32)


def detect_document(image_data: bytes) -> dict:
    """偵測圖片中的文件邊界（v5 — 逐邊證據評分 + 次像素精修）

    流程：
    1. 縮圖上以多策略（U-Net / Canny / 白色區域 / Otsu / Laplacian /
       HED / GrabCut）產生候選四邊形
    2. 內容感知評分選最佳（逐邊梯度支持度 + 內外亮度差 + 幾何）
    3. 便宜策略先跑，昂貴策略（HED / GrabCut）只在信心不足時啟動
    4. 原始解析度次像素角點精修

    Returns:
        {
            "corners": [[x,y]×4] 或 None,
            "confidence": float 0~1,
            "method": 勝出的策略名稱或 None,
        }
    """
    no_result = {"corners": None, "confidence": 0.0, "method": None}

    nparr = np.frombuffer(image_data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return no_result

    orig_h, orig_w = img.shape[:2]

    scale = 1.0
    max_dim = 800
    if max(orig_h, orig_w) > max_dim:
        scale = max_dim / max(orig_h, orig_w)
        img_s = cv2.resize(img, None, fx=scale, fy=scale)
    else:
        img_s = img.copy()

    h, w = img_s.shape[:2]
    ctx = _ScoreContext(img_s)
    candidates = []

    def _try_mask(mask, name):
        if mask is None:
            return
        result = _find_best_quad(mask, w, h, ctx)
        if result is not None:
            pts, s = result
            candidates.append((s, pts, name))

    def _best_score():
        return max((c[0] for c in candidates), default=0.0)

    # ── 便宜策略先跑 ──

    # 策略 00：U-Net 文件語意分割（模型已載入時很快；未就緒立即跳過）
    _try_mask(_detect_mask_unet(img_s), "UNet_Mask")

    # 策略 1：強邊緣 Canny（多閾值）
    gray = ctx.gray
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    for lo, hi in [(30, 80), (50, 150), (20, 60)]:
        edged = cv2.Canny(blurred, lo, hi)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edged = cv2.dilate(edged, k, iterations=2)
        edged = cv2.morphologyEx(edged, cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
                                  iterations=2)
        _try_mask(edged, f"Canny({lo},{hi})")

    # 策略 2：白色區域（排除膚色+排除貼邊）
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
    _try_mask(white, "WhiteRegion")

    # 策略 3：自適應閾值（Otsu）
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    k_m = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, k_m, iterations=3)
    otsu = cv2.morphologyEx(otsu, cv2.MORPH_OPEN, k_m, iterations=2)
    _try_mask(otsu, "Otsu")

    # 策略 4：Laplacian 銳利邊緣（文件邊緣比背景更銳利）
    lap = cv2.Laplacian(blurred, cv2.CV_64F)
    lap = np.uint8(np.absolute(lap))
    _, sharp = cv2.threshold(lap, 15, 255, cv2.THRESH_BINARY)
    sharp = cv2.dilate(sharp, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=2)
    sharp = cv2.morphologyEx(sharp, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)),
                              iterations=3)
    _try_mask(sharp, "Laplacian")

    # ── 昂貴策略：便宜策略信心不足時才啟動 ──

    # 策略 0：HED 顯著邊緣檢測（DNN 前向傳播較耗時）
    if _best_score() < 0.85:
        _try_mask(_detect_edges_hed(img_s), "HED_Edge")

    # 策略 5：GrabCut 前景分離（迭代式分割，最耗時）
    if _best_score() < 0.80:
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
            _try_mask(fg, "GrabCut")
        except Exception as e:
            logger.debug("GrabCut 失敗: %s", e)

    # ── 選出最佳候選 ──
    if not candidates:
        logger.info("所有策略無法偵測到文件邊界")
        return no_result

    candidates.sort(key=lambda x: x[0], reverse=True)
    for s, c, name in candidates[:5]:
        logger.info("  候選 %s: score=%.3f", name, s)

    best_score, best_corners, best_name = candidates[0]
    logger.info("最佳: %s (score=%.3f)", best_name, best_score)

    # 分數太低就不要（寧可讓使用者手動選）
    if best_score < 0.15:
        logger.info("最佳分數 %.3f 太低，放棄自動偵測", best_score)
        return no_result

    # 縮放回原圖座標（保留浮點精度），再做全解析度次像素精修
    corners_full = best_corners.astype(np.float32) / scale
    try:
        corners_full = _refine_corners_fullres(img, corners_full)
    except Exception as e:
        logger.warning("角點精修失敗（使用粗偵測結果）: %s", e)

    ordered = _order_points(corners_full.astype("float32"))
    return {
        "corners": np.rint(ordered).astype(int).tolist(),
        "confidence": round(float(min(max(best_score, 0.0), 1.0)), 3),
        "method": best_name,
    }


def detect_document_edges(image_data: bytes) -> Optional[list[list[int]]]:
    """偵測文件邊界（相容介面 — 只回傳角點）"""
    return detect_document(image_data)["corners"]


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


def _recover_true_aspect(rect: np.ndarray, img_w: int, img_h: int) -> Optional[float]:
    """從透視四邊形推算文件的真實（物理）寬高比

    Zhang & He「Whiteboard Scanning and Image Enhancement」方法：
    假設針孔相機、主點在影像中心，從矩形的透視投影
    反推焦距與矩形的真實寬高比。

    這解決了「用影像上的邊長決定輸出尺寸」的系統性拉伸問題 —
    斜拍的 A4 紙在影像上的寬高比與實際的 1:√2 相差甚遠。

    Returns:
        width/height 比值，或 None（退化情況，呼叫端應 fallback）
    """
    (tl, tr, br, bl) = rect
    u0, v0 = img_w / 2.0, img_h / 2.0
    diag = math.hypot(img_w, img_h)

    # 以主點為原點的正規化座標（float64，改善數值條件）
    m1 = np.array([tl[0] - u0, tl[1] - v0, 1.0], dtype=np.float64)
    m2 = np.array([tr[0] - u0, tr[1] - v0, 1.0], dtype=np.float64)
    m3 = np.array([bl[0] - u0, bl[1] - v0, 1.0], dtype=np.float64)
    m4 = np.array([br[0] - u0, br[1] - v0, 1.0], dtype=np.float64)

    try:
        d2 = float(np.dot(np.cross(m2, m4), m3))
        d3 = float(np.dot(np.cross(m3, m4), m2))
        if abs(d2) < 1e-8 or abs(d3) < 1e-8:
            return None
        k2 = float(np.dot(np.cross(m1, m4), m3)) / d2
        k3 = float(np.dot(np.cross(m1, m4), m2)) / d3

        n2 = k2 * m2 - m1  # 寬方向的消失方向
        n3 = k3 * m3 - m1  # 高方向的消失方向

        # 焦距估計的條件數取決於 |n2[2]|、|n3[2]|（= k-1，透視收斂程度）。
        # 一點透視（某方向對邊近乎平行）時焦距在數學上不可觀測，
        # 此時改用「典型手機相機」的假設焦距（約 0.75 × 對角線 ≈ 26mm 等效）。
        f = None
        if min(abs(n2[2]), abs(n3[2])) > 0.015:
            f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2])
            if f2 > 0:
                f_est = math.sqrt(f2)
                if 0.3 * diag <= f_est <= 3.0 * diag:
                    f = f_est
        if f is None:
            f = 0.75 * diag

        # ratio² = (n2ᵀ A⁻ᵀ A⁻¹ n2) / (n3ᵀ A⁻ᵀ A⁻¹ n3)
        # 座標已移到主點，A⁻¹ 只剩 1/f 縮放前兩列
        v2 = np.array([n2[0] / f, n2[1] / f, n2[2]])
        v3 = np.array([n3[0] / f, n3[1] / f, n3[2]])
        denom = float(np.dot(v3, v3))
        if denom < 1e-12:
            return None
        ratio = math.sqrt(float(np.dot(v2, v2)) / denom)
        return ratio if math.isfinite(ratio) else None
    except Exception:
        return None


def perspective_transform(image_data: bytes,
                          corners: list[list[int]]) -> bytes:
    """透視校正 — 將歪斜文件拉正成矩形（高品質版）

    品質改進：
    1. INTER_LANCZOS4 插值（8x8 像素鄰域，最佳重採樣品質）
    2. 解析度上限提高到 4500px（大角度時有更多像素可用）
    3. 從透視幾何反推文件真實寬高比（Zhang-He 法），輸出不再拉伸變形
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

    # 從透視幾何反推文件的真實寬高比（僅在合理範圍內採用；
    # 精修過的角點通常很準，但退化/極端情況 fallback 到影像邊長比例）
    img_h_full, img_w_full = img.shape[:2]
    true_ratio = _recover_true_aspect(rect, img_w_full, img_h_full)
    naive_ratio = max_width / max_height
    if (true_ratio is not None and 0.2 <= true_ratio <= 5.0
            and 0.5 <= true_ratio / naive_ratio <= 2.0):
        # 兩個方向都不縮小（不丟解析度），只放大較短的一邊來符合真實比例
        out_w = max(float(max_width), max_height * true_ratio)
        max_width = int(round(out_w))
        max_height = int(round(out_w / true_ratio))
        logger.info("真實寬高比恢復: naive=%.3f → true=%.3f", naive_ratio, true_ratio)

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


# ── v2 新增：Multi-Scale Retinex 光照正規化 ──

def _multi_scale_retinex(img: np.ndarray,
                         sigmas: list = None,
                         weights: list = None) -> np.ndarray:
    """Multi-Scale Retinex (MSR) — 分離光照與反射率

    在多個高斯尺度上計算 log(image) - log(blur(image))，
    取加權平均作為反射率估計。能同時處理：
    - 大尺度漸層陰影（sigma=250 捕捉）
    - 中尺度光照不均（sigma=80 捕捉）
    - 小尺度局部陰影如手指、書脊（sigma=15 捕捉）

    相比形態學背景估計，MSR 對複雜光照場景效果顯著更好。

    Args:
        img: BGR 影像
        sigmas: 高斯核的 sigma 列表
        weights: 各尺度的權重列表（需與 sigmas 等長）

    Returns:
        光照正規化後的 BGR 影像（紙張→白色，內容→保留）
    """
    if sigmas is None:
        sigmas = [15, 80, 250]
    if weights is None:
        weights = [1.0 / len(sigmas)] * len(sigmas)

    # 轉為 float64，加小量避免 log(0)
    img_f = img.astype(np.float64) + 1.0
    log_img = np.log(img_f)

    retinex = np.zeros_like(img_f)
    for sigma, w in zip(sigmas, weights):
        # 確保 kernel size 是奇數且足夠大
        ksize = int(sigma * 6) | 1
        blurred = cv2.GaussianBlur(img_f, (ksize, ksize), sigma)
        blurred = np.maximum(blurred, 1.0)
        retinex += w * (log_img - np.log(blurred))

    # 正規化到 [0, 255]
    # 使用 percentile stretch 避免極端值影響
    for i in range(retinex.shape[2]):
        ch = retinex[:, :, i]
        p_lo = np.percentile(ch, 1)
        p_hi = np.percentile(ch, 99)
        if p_hi - p_lo > 1e-5:
            ch = (ch - p_lo) / (p_hi - p_lo) * 255.0
        else:
            ch = ch * 0 + 128
        retinex[:, :, i] = ch

    return np.clip(retinex, 0, 255).astype(np.uint8)


def _multi_scale_retinex_luminance(img: np.ndarray,
                                    sigmas: list = None,
                                    target: float = 240.0) -> np.ndarray:
    """只對亮度通道做 MSR，完整保留色彩資訊

    流程：
    1. BGR → LAB
    2. 對 L 通道做 MSR
    3. 將 MSR 結果映射到目標亮度範圍
    4. LAB → BGR

    比全通道 MSR 更適合彩色文件（避免色偏）。
    """
    if sigmas is None:
        sigmas = [15, 80, 250]

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_ch = lab[:, :, 0].astype(np.float64) + 1.0
    log_l = np.log(l_ch)

    retinex_l = np.zeros_like(l_ch)
    for sigma in sigmas:
        ksize = int(sigma * 6) | 1
        blurred = cv2.GaussianBlur(l_ch, (ksize, ksize), sigma)
        blurred = np.maximum(blurred, 1.0)
        retinex_l += (log_l - np.log(blurred))
    retinex_l /= len(sigmas)

    # 將 retinex 反射率映射到目標亮度
    # retinex 值高 = 高反射率（紙張）→ 高亮度
    # retinex 值低 = 低反射率（文字/印章）→ 低亮度
    p_lo = np.percentile(retinex_l, 2)
    p_hi = np.percentile(retinex_l, 98)
    if p_hi - p_lo > 1e-5:
        # 映射：最亮的反射率 → target (240)，最暗的 → 保持暗
        normalized = (retinex_l - p_lo) / (p_hi - p_lo)
        # 使用 gamma 校正讓紙張區域更白，同時保持文字深度
        normalized = np.power(np.clip(normalized, 0, 1), 0.7)
        l_new = normalized * target
    else:
        l_new = retinex_l * 0 + target * 0.5

    lab[:, :, 0] = np.clip(l_new, 0, 255).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


# ── v2 新增：紙張白點白平衡 ──

def _white_balance_paper(img: np.ndarray) -> np.ndarray:
    """紙張白點白平衡 — 專為文件場景設計

    找出圖片中最亮且低飽和度的像素（= 紙張區域），
    用它們的 RGB 平均值作為白點基準校正全圖。

    比灰色世界假設更適合「以白色紙張為主」的文件場景。
    灰色世界假設紙張佔大面積時會系統性偏暖/偏冷。

    如果找不到足夠的紙張像素（如黑色背景），會 fallback 到灰色世界。
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # 找出「亮且低飽和度」的像素 = 紙張候選
    # 亮度 > 中位數 + 30，飽和度 < 40
    v_median = np.median(v)
    bright_thresh = max(v_median + 30, 160)
    paper_mask = (v > bright_thresh) & (s < 40)

    paper_ratio = np.sum(paper_mask) / paper_mask.size

    # 至少 3% 的像素是紙張才有意義
    if paper_ratio < 0.03:
        logger.debug("紙張白點白平衡：紙張像素不足 (%.1f%%)，fallback 到灰色世界",
                     paper_ratio * 100)
        return _white_balance_grayworld(img)

    # 取紙張區域的 RGB 平均值作為白點
    result = img.astype(np.float64)
    paper_pixels = result[paper_mask]
    wp_b = np.mean(paper_pixels[:, 0])
    wp_g = np.mean(paper_pixels[:, 1])
    wp_r = np.mean(paper_pixels[:, 2])

    # 白點的最大通道值作為目標亮度
    wp_max = max(wp_b, wp_g, wp_r, 1.0)

    # 校正各通道，使白點 → 純白
    if wp_b > 10:
        result[:, :, 0] *= wp_max / wp_b
    if wp_g > 10:
        result[:, :, 1] *= wp_max / wp_g
    if wp_r > 10:
        result[:, :, 2] *= wp_max / wp_r

    logger.debug("紙張白點白平衡：紙張佔比 %.1f%%, 白點 BGR=(%.0f,%.0f,%.0f)",
                 paper_ratio * 100, wp_b, wp_g, wp_r)

    return np.clip(result, 0, 255).astype(np.uint8)


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


# ── v2 新增：兩階段去噪 ──

def _estimate_noise_level(img: np.ndarray) -> float:
    """估計影像噪聲水平（使用 Laplacian 方差法）

    Returns:
        估計的噪聲標準差 sigma（越高 = 噪聲越嚴重）
        - < 5: 低噪聲（乾淨的平台掃描）
        - 5~15: 中等噪聲（手機一般拍攝）
        - > 15: 高噪聲（低光環境拍攝）
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    # 用 3x3 Laplacian 估計高頻能量
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    # 噪聲 sigma ≈ sqrt(pi/2) * MAD(Laplacian) / 6
    # MAD = median absolute deviation
    sigma = np.median(np.abs(lap)) * 1.4826 / 6.0
    return float(sigma)


def _denoise_two_stage(img: np.ndarray, strength: str = "auto") -> np.ndarray:
    """兩階段去噪管線 — 比單次雙邊濾波效果顯著更好

    Stage 1: Non-Local Means (NLM) — 全局去噪，去除高頻隨機雜訊
      NLM 會在整張圖中搜尋相似的 patch 進行加權平均，
      是傳統方法中效果最好的去噪算法。

    Stage 2: Bilateral Filter — 保邊平滑，去除殘留低頻雜訊
      雙邊濾波同時考慮空間距離和亮度距離，
      在平滑背景的同時保留文字邊緣不被模糊。

    強度根據估計的噪聲水平自適應調整。

    Args:
        img: BGR 影像
        strength: "low", "medium", "high", 或 "auto"（自動估計）
    """
    if strength == "auto":
        noise_sigma = _estimate_noise_level(img)
        if noise_sigma < 5:
            strength = "low"
        elif noise_sigma < 12:
            strength = "medium"
        else:
            strength = "high"
        logger.debug("自動去噪強度：noise_sigma=%.1f → %s", noise_sigma, strength)

    # 根據強度設定參數
    params = {
        "low": {"nlm_h": 5, "bilateral_d": 5, "bilateral_sc": 30, "bilateral_ss": 30},
        "medium": {"nlm_h": 8, "bilateral_d": 7, "bilateral_sc": 50, "bilateral_ss": 50},
        "high": {"nlm_h": 12, "bilateral_d": 9, "bilateral_sc": 60, "bilateral_ss": 60},
    }
    p = params.get(strength, params["medium"])

    # Stage 1: Non-Local Means 去噪
    denoised = cv2.fastNlMeansDenoisingColored(
        img, None, p["nlm_h"], p["nlm_h"],
        templateWindowSize=7, searchWindowSize=21
    )

    # Stage 2: 雙邊濾波保邊平滑
    result = cv2.bilateralFilter(
        denoised, p["bilateral_d"],
        p["bilateral_sc"], p["bilateral_ss"]
    )

    return result


# ── v2 改進：邊緣感知自適應銳化 ──

def _adaptive_sharpening(img: np.ndarray, strength: float = -1.0) -> np.ndarray:
    """邊緣感知自適應銳化 v2

    改進點（相比 v1 的全局固定 unsharp masking）：
    1. 用 Laplacian 計算邊緣遮罩，只在邊緣區域銳化
    2. 銳化強度依模糊程度自動調整
    3. 雙尺度 unsharp masking：大尺度恢復結構 + 小尺度恢復細節

    Args:
        img: BGR 影像
        strength: 銳化強度 (0~1)，-1 表示自動
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    # 自動估計銳化強度：Laplacian 方差低 = 模糊 = 需要更強銳化
    if strength < 0:
        lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        if lap_var > 1000:
            strength = 0.25  # 已經很銳利，輕度銳化
        elif lap_var > 300:
            strength = 0.40  # 中等模糊
        elif lap_var > 100:
            strength = 0.55  # 明顯模糊
        else:
            strength = 0.70  # 嚴重模糊
        logger.debug("自動銳化強度：lap_var=%.0f → strength=%.2f", lap_var, strength)

    # 計算邊緣遮罩（只在邊緣區域銳化）
    edge_map = cv2.Laplacian(gray, cv2.CV_64F)
    edge_mask = np.abs(edge_map)
    # 正規化到 [0, 1]，使用 percentile 避免極端值
    p95 = np.percentile(edge_mask, 95)
    if p95 > 1e-3:
        edge_mask = np.clip(edge_mask / p95, 0, 1)
    else:
        edge_mask = np.zeros_like(edge_mask)
    # 平滑遮罩邊緣
    edge_mask = cv2.GaussianBlur(edge_mask.astype(np.float32), (5, 5), 0)
    edge_mask_3ch = np.stack([edge_mask] * 3, axis=-1) if len(img.shape) == 3 else edge_mask

    # 大尺度 unsharp masking（恢復結構）
    blur_large = cv2.GaussianBlur(img, (0, 0), 3.0)
    sharp_large = cv2.addWeighted(
        img, 1.0 + strength * 0.6, blur_large, -strength * 0.6, 0
    )

    # 小尺度 unsharp masking（恢復細節）
    blur_small = cv2.GaussianBlur(sharp_large, (0, 0), 1.0)
    sharp_detail = cv2.addWeighted(
        sharp_large, 1.0 + strength * 0.4, blur_small, -strength * 0.4, 0
    )

    # 只在邊緣區域套用銳化結果，平滑區域保持原狀
    img_f = img.astype(np.float64)
    sharp_f = sharp_detail.astype(np.float64)
    result = img_f * (1.0 - edge_mask_3ch) + sharp_f * edge_mask_3ch

    return np.clip(result, 0, 255).astype(np.uint8)


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


# ── v2 改進：智慧白色推送（Otsu 自適應 + sigmoid 過渡）──

def _push_whites(img: np.ndarray, threshold: int = -1) -> np.ndarray:
    """智慧白色推送 v2 — 把紙張區域推向乾淨的白色

    改進點（相比 v1）：
    1. 使用 Otsu 自動計算前景/背景分離閾值（不再固定 220）
    2. 使用 sigmoid 過渡函數（比線性遮罩更自然，沒有 halo 效果）
    3. 色彩感知：高飽和度區域（印章、彩色標記）不推白

    Args:
        threshold: 手動設定閾值，-1 表示使用 Otsu 自動計算
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 自動計算閾值
    if threshold < 0:
        otsu_thresh, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # 紙張閾值 = Otsu 閾值 + 偏移（確保只推真正的淺色背景）
        threshold = int(max(otsu_thresh + 20, 200))
        logger.debug("白色推送：Otsu=%.0f → threshold=%d", otsu_thresh, threshold)

    # 用 sigmoid 函數建立平滑過渡遮罩
    # sigmoid 讓閾值附近的過渡非常自然，不會有明顯邊界
    gray_f = gray.astype(np.float32)
    steepness = 0.15  # 控制過渡帶寬度（越大越銳利）
    white_mask = 1.0 / (1.0 + np.exp(-steepness * (gray_f - threshold)))

    # 色彩感知：高飽和度區域不推白（保護印章、彩色標記）
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1].astype(np.float32)
    # 飽和度 > 35 的區域逐漸降低推白力度
    color_protection = np.clip(1.0 - (saturation - 35) / 40.0, 0, 1)
    white_mask = white_mask * color_protection

    # 把白色區域推向 [252, 252, 252]（比 v1 的 250 稍白，更接近掃描器）
    result = img.astype(np.float32)
    white_target = np.full_like(result, 252.0)
    result = result * (1.0 - white_mask[:, :, np.newaxis]) + \
             white_target * white_mask[:, :, np.newaxis]

    return np.clip(result, 0, 255).astype(np.uint8)


# ── v2 新：專業掃描模式（核心重寫）──

def _filter_scan(img: np.ndarray) -> np.ndarray:
    """專業掃描模式 v2 — 追近 Google/Adobe Scan 的效果

    v2 改進流水線：
    1. 紙張白點白平衡（取代灰色世界）
    2. 歪斜校正
    3. Multi-Scale Retinex 光照正規化（取代形態學閉運算）
    4. CLAHE 對比度增強（新增）
    5. 兩階段去噪 NLM + 雙邊（取代單次雙邊濾波）
    6. 邊緣感知自適應銳化（取代固定強度 unsharp masking）
    7. 智慧白色推送（Otsu 自適應 + sigmoid 過渡 + 色彩保護）

    目標：讓手持拍攝的文件照片看起來像平台掃描器掃出來的結果。
    """
    # Step 1: 紙張白點白平衡（比灰色世界更適合文件場景）
    img = _white_balance_paper(img)

    # Step 2: 歪斜校正
    img = _deskew(img)

    # Step 3: Multi-Scale Retinex 光照正規化
    # 對亮度通道做 MSR，保留完整色彩
    result = _multi_scale_retinex_luminance(img, sigmas=[15, 80, 250], target=240.0)

    # Step 4: CLAHE 對比度增強（只對 L 通道，避免色偏）
    lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_ch)
    lab = cv2.merge([l_enhanced, a_ch, b_ch])
    result = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

    # Step 5: 兩階段去噪（NLM + 雙邊，強度自適應）
    result = _denoise_two_stage(result, strength="auto")

    # Step 6: 邊緣感知自適應銳化（自動估計強度）
    result = _adaptive_sharpening(result)  # strength 自動

    # Step 7: 智慧白色推送（Otsu 自適應閾值 + sigmoid 過渡）
    result = _push_whites(result)  # threshold 自動

    return result


def _filter_color_doc(img: np.ndarray) -> np.ndarray:
    """彩色文件模式 v2 — 專為有印章、彩色表格、簽名的公文設計

    v2 改進：
    - 使用 MSR 取代形態學背景估計（更好的光照處理）
    - 紙張白點白平衡
    - 兩階段去噪
    - 加強彩色元素保護（印章、簽名）

    特點：
    - 背景白化但完整保留所有彩色元素
    - 紅色印章（蓋章）加強保色
    - 藍色簽名墨水保色
    - 表格線條保持清晰
    - 適合公文、合約、表單等正式文件
    """
    # Step 1: 紙張白點白平衡
    img = _white_balance_paper(img)

    # Step 2: 歪斜校正
    img = _deskew(img)

    # Step 3: MSR 光照正規化（只處理亮度，完整保留色彩）
    result = _multi_scale_retinex_luminance(img, sigmas=[15, 80, 250], target=240.0)

    # Step 4: CLAHE 對比度增強 + 色彩飽和度加強
    lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_ch)

    # 偵測高飽和度區域（印章、彩色標記）並加強色彩
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    color_mask = (saturation > 50).astype(np.float32)
    color_mask = cv2.GaussianBlur(color_mask, (5, 5), 0)

    # 加強彩色區域的飽和度（讓印章顏色更鮮明）
    a_boosted = np.clip(
        a_ch.astype(np.float32) + (a_ch.astype(np.float32) - 128) * color_mask * 0.35,
        0, 255
    ).astype(np.uint8)
    b_boosted = np.clip(
        b_ch.astype(np.float32) + (b_ch.astype(np.float32) - 128) * color_mask * 0.35,
        0, 255
    ).astype(np.uint8)

    lab_result = cv2.merge([l_enhanced, a_boosted, b_boosted])
    result = cv2.cvtColor(lab_result, cv2.COLOR_LAB2BGR)

    # Step 5: 兩階段去噪（稍輕，保留更多細節）
    result = _denoise_two_stage(result, strength="low")

    # Step 6: 邊緣感知自適應銳化
    result = _adaptive_sharpening(result)

    # Step 7: 智慧白色推送（帶色彩保護）
    result = _push_whites(result)

    return result


# ── v2 改良：智慧自動模式（多維度分析）──

def _filter_auto(img: np.ndarray) -> np.ndarray:
    """智慧自動模式 v2 — 多維度分析決定最佳處理策略

    分析維度：
    1. 色彩飽和度比例（偵測彩色內容）
    2. 亮度直方圖分析（判斷光照條件）
    3. 邊緣密度分析（判斷文字密度）
    4. 暗區比例（偵測嚴重陰影）

    根據分析結果選擇最佳濾鏡和參數組合。
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # 1. 色彩飽和度分析
    color_ratio = float(np.mean(s > 80))  # 高飽和度像素佔比

    # 2. 亮度分佈分析
    v_mean = float(np.mean(v))
    v_std = float(np.std(v))
    dark_ratio = float(np.mean(v < 80))  # 暗區佔比

    # 3. 邊緣密度分析（文字越多邊緣越密集）
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.mean(edges > 0))

    logger.info(
        "自動模式分析：color=%.1f%% v_mean=%.0f v_std=%.0f dark=%.1f%% edge=%.1f%%",
        color_ratio * 100, v_mean, v_std, dark_ratio * 100, edge_density * 100
    )

    # 決策邏輯
    if color_ratio > 0.04:
        # 4% 以上像素有明顯色彩 → 彩色文件模式
        logger.info("自動模式 → 彩色文件模式（偵測到彩色內容 %.1f%%）", color_ratio * 100)
        return _filter_color_doc(img)
    elif dark_ratio > 0.25:
        # 暗區超過 25% → 嚴重陰影，需要強力光照校正
        logger.info("自動模式 → 專業掃描模式（偵測到大面積陰影 %.1f%%）", dark_ratio * 100)
        return _filter_scan(img)
    elif v_std > 60:
        # 亮度標準差大 → 光照不均勻
        logger.info("自動模式 → 專業掃描模式（偵測到光照不均 std=%.0f）", v_std)
        return _filter_scan(img)
    else:
        # 一般情況
        logger.info("自動模式 → 專業掃描模式（一般文件）")
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

# 自動套用透視校正的最低信心門檻：
# 低於此值時仍回傳偵測到的角點（前端可顯示供手動調整），
# 但不自動裁切 — 誤裁一張沒有文件的照片比不裁更糟。
MIN_AUTO_APPLY_CONFIDENCE = 0.45


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
    confidence = None

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
        detection = detect_document(image_data)
        detected_corners = detection["corners"]
        confidence = detection["confidence"]
        if detected_corners and confidence >= MIN_AUTO_APPLY_CONFIDENCE:
            try:
                auto_detected = True
                distortion_info = _estimate_distortion_level(
                    np.array(detected_corners, dtype="float32"))
                processed = perspective_transform(processed, detected_corners)
                logger.info("自動邊界偵測 + 透視校正完成 (信心 %.2f, %s)",
                            confidence, detection["method"])
            except Exception as e:
                logger.error("透視校正失敗（自動偵測）: %s", e, exc_info=True)
                processed = image_data  # fallback 到原圖
        elif detected_corners:
            logger.info("偵測信心不足 (%.2f < %.2f)，不自動裁切（回傳角點供手動調整）",
                        confidence, MIN_AUTO_APPLY_CONFIDENCE)
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
        "confidence": confidence,
        "filter_applied": filter_name,
        "original_size": (orig_w, orig_h),
        "processed_size": (proc_w, proc_h),
        "distortion": distortion_info,
    }
