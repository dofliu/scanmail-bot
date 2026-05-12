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


def is_available() -> bool:
    """快速檢查 paddleocr 是否可用（不真正載入模型）"""
    try:
        import importlib.util
        return importlib.util.find_spec("paddleocr") is not None
    except Exception:
        return False


def detect(images: list[bytes], page_count: int = 1) -> DetectionResult:
    """以 PaddleOCR PP-Structure 偵測表單欄位

    Args:
        images: 每頁的 PNG/JPG bytes 清單
        page_count: 總頁數（通常 = len(images)）

    Returns:
        DetectionResult
    """
    # TODO(M6): 接入 paddleocr.PPStructure(layout=True, table=True, ocr=True, kie=True)
    #   1. 對每張影像跑 KIE，回傳 [{label, bbox, value?}, ...]
    #   2. bbox 從影像座標 → PDF points（需要 DPI 反推）
    #   3. 組成 FormField 列表
    raise NotImplementedError(
        "PaddleOCR backend 尚未實作（M6 里程碑）。"
        "目前 dispatcher 會自動 fallback 到 Gemini Vision。"
    )
