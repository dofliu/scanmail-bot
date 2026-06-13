"""Layer 3 — PaddleOCR PP-Structure 表單欄位偵測（本地、免費）

PaddleOCR 的 PP-Structure 模組可以做 KIE (Key Information Extraction)，
直接回傳 key-value pair；對於印刷表單表現不錯。

⚠️ 注意：
- paddleocr / paddlepaddle 體積較大（>600MB），預設**不裝**
- is_available() 用 lazy import 判斷，未安裝時 dispatcher 會自動 fallback 到 Gemini
- 首次呼叫會自動下載模型，建議在容器啟動時 warm-up
"""
import logging
import re
import io
from typing import Optional
from PIL import Image
import numpy as np

from app.services.form_fill.schema import FormField, DetectionResult, Backend

logger = logging.getLogger(__name__)

_AVAILABILITY_CACHE: bool | None = None
_ENGINE_CACHE = None


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


def get_engine():
    """取得或初始化 PP-Structure 引擎（僅在可用時載入模型）"""
    global _ENGINE_CACHE
    if _ENGINE_CACHE is None:
        if not is_available():
            raise NotImplementedError("未安裝 paddleocr，無法初始化引擎。")
        from paddleocr import PPStructure
        _ENGINE_CACHE = PPStructure(
            show_log=False,
            image_orientation=False,
            structure_version='PP-StructureV2',
            layout=True,
            table=True,
            ocr=True
        )
    return _ENGINE_CACHE


# 常見表單標籤的關鍵字（中文+英文），命中後旁邊的空白視為欄位
_LABEL_KEYWORDS = (
    r"姓名|申請人|填表人|職稱|單位|部門|系所|學校|機關|"
    r"電話|手機|傳真|信箱|電子郵件|地址|"
    r"日期|時間|金額|統一編號|身分證|學號|"
    r"主旨|事由|備註|簽章|簽名|"
    r"Name|Title|Department|Email|Phone|Tel|Date|Address|Subject|Signature|"
    r"Destination|Amount|Purpose|Reason|Leave"
)

# 偵測 label 是否以冒號結尾或含有特殊符號，用來判定是否為表單欄位 label
_LABEL_REGEX = re.compile(
    rf"^\s*({_LABEL_KEYWORDS})\s*[:：﹕]\s*$",
    re.IGNORECASE,
)

# 表格 cell 內的 label 不一定要有冒號
_TABLE_LABEL_REGEX = re.compile(
    rf"^\s*({_LABEL_KEYWORDS})\s*[:：﹕]?\s*$",
    re.IGNORECASE,
)


def _guess_type(label: str) -> str:
    """依據標籤文字猜測欄位類型"""
    if re.search(r"日期|Date|時間|Time", label, re.IGNORECASE):
        return "date"
    if re.search(r"金額|數量|編號|電話|手機", label):
        return "number"
    if re.search(r"簽章|簽名|Signature", label, re.IGNORECASE):
        return "signature"
    return "text"


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
    if not is_available():
        raise NotImplementedError(
            "PaddleOCR backend 尚未實作或未安裝 paddleocr。 "
            "目前 dispatcher 會自動 fallback 到 Gemini Vision。"
        )

    engine = get_engine()
    all_fields = []
    
    for page_num, img_bytes in enumerate(images):
        if page_num < len(page_sizes_pts):
            pw_pdf, ph_pdf = page_sizes_pts[page_num]
        else:
            pw_pdf, ph_pdf = (595.0, 842.0)  # 預設 A4 寬高
            
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        w_img, h_img = pil_img.size
        img_np = np.array(pil_img)
        
        # 執行辨識
        result = engine(img_np)
        
        page_fields = []
        seen_keys = set()  # (page, label_lower, round(top, 0)) 去重
        
        # 1. 先處理表格區塊 (table) 以免被一般文字流程重複解析
        for block in result:
            if block.get('type') != 'table':
                continue
                
            res = block.get('res', {})
            cell_boxes = res.get('cell_box_list', [])
            table_ocr = res.get('table_ocr_pred', {})
            ocr_boxes = table_ocr.get('boxes', [])
            ocr_res = table_ocr.get('rec_res', [])
            
            # 建立 cell 列表，並合併 cell 內的所有 OCR 文字
            cells = []
            for idx, box in enumerate(cell_boxes):
                if len(box) == 8:
                    cx0 = min(box[0], box[2], box[4], box[6])
                    cx1 = max(box[0], box[2], box[4], box[6])
                    cy0 = min(box[1], box[3], box[5], box[7])
                    cy1 = max(box[1], box[3], box[5], box[7])
                elif len(box) == 4:
                    cx0, cy0, cx1, cy1 = box
                else:
                    continue
                    
                cell_texts = []
                for obox, orec in zip(ocr_boxes, ocr_res):
                    if not orec:
                        continue
                    text = orec[0]
                    # 計算 OCR text box 的中心點
                    if isinstance(obox, (list, tuple)):
                        flat_obox = np.array(obox).flatten()
                        if len(flat_obox) == 8:
                            ox_c = np.mean(flat_obox[0::2])
                            oy_c = np.mean(flat_obox[1::2])
                        elif len(flat_obox) == 4:
                            ox_c = (flat_obox[0] + flat_obox[2]) / 2.0
                            oy_c = (flat_obox[1] + flat_obox[3]) / 2.0
                        else:
                            continue
                    else:
                        continue
                        
                    if cx0 <= ox_c <= cx1 and cy0 <= oy_c <= cy1:
                        cell_texts.append(text)
                
                cells.append({
                    'index': idx,
                    'x0': cx0,
                    'x1': cx1,
                    'y0': cy0,
                    'y1': cy1,
                    'text': " ".join(cell_texts).strip()
                })
                
            # 依據標籤配對空白儲存格
            for c1 in cells:
                text = c1['text']
                if not text:
                    continue
                m = _TABLE_LABEL_REGEX.match(text)
                if not m:
                    continue
                label = m.group(1).strip()
                
                right_cell = None
                bottom_cell = None
                gap_tolerance = 30
                
                for c2 in cells:
                    if c1['index'] == c2['index']:
                        continue
                    if c2['text'].strip():
                        continue
                        
                    # 水平相鄰判定
                    h_overlap = min(c1['y1'], c2['y1']) - max(c1['y0'], c2['y0'])
                    h_min_height = min(c1['y1'] - c1['y0'], c2['y1'] - c2['y0'])
                    if h_overlap > 0.5 * h_min_height:
                        if 0 <= c2['x0'] - c1['x1'] < gap_tolerance:
                            if right_cell is None or c2['x0'] < right_cell['x0']:
                                right_cell = c2
                                
                    # 垂直相鄰判定
                    v_overlap = min(c1['x1'], c2['x1']) - max(c1['x0'], c2['x0'])
                    v_min_width = min(c1['x1'] - c1['x0'], c2['x1'] - c2['x0'])
                    if v_overlap > 0.5 * v_min_width:
                        if 0 <= c2['y0'] - c1['y1'] < gap_tolerance:
                            if bottom_cell is None or c2['y0'] < bottom_cell['y0']:
                                bottom_cell = c2
                                
                target_cell = right_cell or bottom_cell
                if target_cell:
                    scale_x = pw_pdf / w_img
                    scale_y = ph_pdf / h_img
                    
                    tx0 = target_cell['x0'] * scale_x
                    tx1 = target_cell['x1'] * scale_x
                    ty0 = ph_pdf - (target_cell['y1'] * scale_y)
                    ty1 = ph_pdf - (target_cell['y0'] * scale_y)
                    
                    key = (page_num, label.lower(), round(ty0))
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    
                    page_fields.append(FormField(
                        name=f"p{page_num}_paddle_t{len(all_fields) + len(page_fields)}",
                        label=label,
                        field_type=_guess_type(label),
                        bbox=(tx0, ty0, tx1, ty1),
                        page=page_num,
                        backend=Backend.PADDLE,
                        confidence=0.8,
                    ))

        # 2. 處理文字與標題區塊 (text / title)
        for block in result:
            btype = block.get('type')
            if btype not in ('text', 'title'):
                continue
                
            res_list = block.get('res', [])
            for line in res_list:
                text = line.get('text', '')
                if not text:
                    continue
                    
                m = _LABEL_REGEX.match(text)
                if not m:
                    continue
                label = m.group(1).strip()
                
                region = line.get('text_region')
                if not region or len(region) != 4:
                    continue
                    
                x_min = min(p[0] for p in region)
                x_max = max(p[0] for p in region)
                y_min = min(p[1] for p in region)
                y_max = max(p[1] for p in region)
                
                scale_x = pw_pdf / w_img
                scale_y = ph_pdf / h_img
                
                x1_pdf = x_max * scale_x
                y0_pdf = ph_pdf - (y_max * scale_y)
                y1_pdf = ph_pdf - (y_min * scale_y)
                
                # 輸入範圍：右側 4pt 至 200pt
                tx0 = x1_pdf + 4
                tx1 = x1_pdf + 200
                ty0 = y0_pdf
                ty1 = y1_pdf
                
                key = (page_num, label.lower(), round(ty0))
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                
                page_fields.append(FormField(
                    name=f"p{page_num}_paddle_f{len(all_fields) + len(page_fields)}",
                    label=label,
                    field_type=_guess_type(label),
                    bbox=(tx0, ty0, tx1, ty1),
                    page=page_num,
                    backend=Backend.PADDLE,
                    confidence=0.75,
                ))

        all_fields.extend(page_fields)

    return DetectionResult(
        backend_used=Backend.PADDLE,
        page_count=len(images),
        fields=all_fields,
        needs_review=True,
        notes="已使用本地 PaddleOCR 進行離線辨識。"
    )
