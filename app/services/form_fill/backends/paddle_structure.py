"""Layer 3 — PaddleOCR PP-Structure 表單欄位偵測（本地、免費）

PaddleOCR 的 PP-Structure 模組可以做 KIE (Key Information Extraction)，
直接回傳 key-value pair；對於印刷表單表現不錯。

⚠️ 注意：
- paddleocr / paddlepaddle 體積較大（>600MB），預設**不裝**
- is_available() 用 lazy import 判斷，未安裝時 dispatcher 會自動 fallback 到 Gemini
- 首次呼叫會自動下載模型，建議在容器啟動時 warm-up
"""
import logging
from typing import Optional

from app.services.form_fill.schema import DetectionResult

logger = logging.getLogger(__name__)


_AVAILABILITY_CACHE: bool | None = None


def is_available() -> bool:
    """檢查 paddleocr 是否可用（不真正載入模型）

    需要同時驗證 paddleocr **和** paddlepaddle 都裝好；只裝其中一個會 import 時炸。
    結果會 cache，避免每次 detect 都做一次模組查找。
    """
    global _AVAILABILITY_CACHE
    if _AVAILABILITY_CACHE is not None:
        return _AVAILABILITY_CACHE
    try:
        import importlib.util
        ok = (
            importlib.util.find_spec("paddleocr") is not None
            and importlib.util.find_spec("paddle") is not None
        )
    except Exception:
        ok = False
    _AVAILABILITY_CACHE = ok
    return ok


def detect(
    images: list[bytes],
    page_sizes_pts: list[tuple[float, float]],
) -> DetectionResult:
    """以 PaddleOCR PP-Structure 偵測表單欄位

    Args:
        images: 每頁的 PNG/JPG bytes 清單
        page_sizes_pts: 對應每頁的 PDF 頁面尺寸 (w, h) in points，用於座標換算

    Returns:
        DetectionResult — bbox 必須是 PDF points（origin bottom-left）
    """
    # TODO(M6): 接入 paddleocr.PPStructure(layout=True, table=True, ocr=True, kie=True)
    #   1. 對每張影像跑 KIE，回傳 [{label, bbox_img, value?}, ...]
    #   2. bbox 從影像 pixel 座標 → PDF points
    #      （PP-Structure 回傳的影像座標可用 page_sizes_pts 和 image 實際尺寸推算）
    #   3. 組成 FormField 列表，bbox 統一存 PDF points
    raise NotImplementedError(
        "PaddleOCR backend 尚未實作（M6 里程碑）。"
        "目前 dispatcher 會自動 fallback 到 Gemini Vision。"
    )
