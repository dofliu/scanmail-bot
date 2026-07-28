# PaddleOCR 離線辨識整合設計文件 (M6 Milestone)

此文件說明如何整合 PaddleOCR PP-Structure 作為本地離線的表單欄位偵測模組（Layer 3），提供免費且高隱私的表單偵測選項，在偵測無文字層的掃描型 PDF / 影像時，作為優先於 Gemini Vision（Layer 4）的後端。

---

## 1. 依賴套件與環境要求

要在本地運行 PaddleOCR，需要安裝以下依賴。由於套件體積大（約 600MB+），採 **Lazy Import** 機制，僅在使用者環境確實安裝時才啟用。

### 安裝指令
```bash
# 安裝 PaddlePaddle (CPU 版本即可，若有 GPU 可改裝 paddlepaddle-gpu)
pip install paddlepaddle==2.6.1 -i https://pypi.tuna.tsinghua.edu.cn/simple

# 安裝 PaddleOCR (包含 PP-Structure)
pip install paddleocr>=2.7.0
```

### 系統依賴 (OS Level)
*   **Windows**: 需要安裝 [Visual C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 以便編譯部分 C++ 依賴（如 `shapely`、`pyclipper` 等）。
*   **Linux/Docker**: 需安裝 `libgl1` 以供 OpenCV 使用：
    ```bash
    apt-get update && apt-get install -y libgl1-mesa-glx
    ```

---

## 2. 欄位偵測演算法設計

PaddleOCR 的 PP-Structure 支援版面分析 (Layout Analysis) 與表格辨識。對於表單來說，我們主要關心以下兩大元素：
1.  **輸入線條與空白框 (Fields/Cells)**: 通常位於「欄位標籤」的右側或下方。
2.  **欄位標籤 (Labels)**: 如 "姓名"、"日期" 等引導文字。

### 偵測策略：Layout Analysis + Table Extraction 啟發式匹配
1.  **版面元素偵測**:
    使用 `PPStructure(structure_version='PP-StructureV2', layout=True, table=False, ocr=True)`。
2.  **文字與輸入位置配對**:
    *   偵測出所有文字區塊 (Text Blocks) 與其 bounding box (bbox)。
    *   針對含有 `：`、`:`、`____` 或常見表單標籤關鍵字（如 "姓名"、"Email"、"電話"）的文字區塊作為 Label。
    *   尋找該 Label 鄰近的空白矩形（可結合 `table=True` 偵測到的空白儲存格，或透過影像形態學偵測水平橫線與框線）。
    *   若 PP-Structure 的 KIE (Key Information Extraction) 啟用，可直接提取其 `question-answer` (Key-Value) 配對關係。

---

## 3. 座標換算合約 (Coordinates Translation)

PaddleOCR 回傳的 bbox 是基於 **DPI 150 渲染影像** 的像素座標 `[x_min, y_min, x_max, y_max]`，原點在 **左上角**。
ScanMail+ 的設計合約要求 `FormField.bbox` 一律為 **PDF points** (1pt = 1/72 inch)，且原點在 **左下角**。

### 換算公式

令：
*   原 PDF 頁面寬高為 `(w_pdf, h_pdf)` points。
*   渲染後的影像寬高為 `(w_img, h_img)` pixels。
*   則縮放比例為：
    $$\text{scale\_x} = \frac{w\_pdf}{w\_img}$$
    $$\text{scale\_y} = \frac{h\_pdf}{h\_img}$$

對於 PaddleOCR 得到的影像像素座標 `[x_min, y_min, x_max, y_max]`：
*   **PDF $x_0$** = $x\_min \times \text{scale\_x}$
*   **PDF $x_1$** = $x\_max \times \text{scale\_x}$
*   **PDF $y_0$** (左下角原點) = $h\_pdf - (y\_max \times \text{scale\_y})$
*   **PDF $y_1$** (左下角原點) = $h\_pdf - (y\_min \times \text{scale\_y})$

換算後的 bbox 格式為 `(pdf_x0, pdf_y0, pdf_x1, pdf_y1)`。

---

## 4. 實作藍圖

將修改 [paddle_structure.py](../app/services/form_fill/backends/paddle_structure.py) 中的 `detect` 函數：

```python
import io
import numpy as np
from PIL import Image
from app.services.form_fill.schema import FormField, DetectionResult, Backend

def detect(
    images: list[bytes],
    page_sizes_pts: list[tuple[float, float]],
) -> DetectionResult:
    """以 PaddleOCR PP-Structure 偵測表單欄位"""
    # 1. 確保已安裝依賴
    try:
        from paddleocr import PPStructure
    except ImportError as e:
        raise NotImplementedError("未安裝 paddleocr，無法使用此離線後端。") from e

    # 2. 初始化引擎（僅在首次呼叫或模組載入時）
    # structure_version 可以設定為 'PP-StructureV2'
    engine = PPStructure(
        show_log=False,
        image_orientation=False,
        structure_version='PP-StructureV2',
        layout=True,
        table=True,
        ocr=True
    )

    all_fields = []
    
    for page_num, img_bytes in enumerate(images):
        pw_pdf, ph_pdf = page_sizes_pts[page_num]
        
        # 將 bytes 轉為 numpy array (PaddleOCR 需要的輸入格式)
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        w_img, h_img = pil_img.size
        img_np = np.array(pil_img)
        
        # 執行辨識
        result = engine(img_np)
        
        # 3. 解析結構化結果並篩選欄位
        # result 格式為 list of dicts, 包含 'type', 'bbox', 'res' 等
        # 我們需要尋找文字與相鄰的輸入格
        page_fields = []
        
        # TODO: 遍歷結果並實作 KIE 或 鄰近配對邏輯
        # 範例虛擬碼：
        # for block in result:
        #     if block['type'] == 'table':
        #         # 從表格中尋找空白儲存格與相鄰標籤
        #         pass
        #     elif block['type'] == 'text':
        #         # 偵測 label 並換算座標
        #         pass
        
        # 4. 座標映射範例
        # scale_x = pw_pdf / w_img
        # scale_y = ph_pdf / h_img
        # x0 = x_min * scale_x
        # y0 = ph_pdf - (y_max * scale_y)
        # x1 = x_max * scale_x
        # y1 = ph_pdf - (y_min * scale_y)
        
        all_fields.extend(page_fields)

    return DetectionResult(
        backend_used=Backend.PADDLE,
        page_count=len(images),
        fields=all_fields,
        needs_review=True,
        notes="已使用本地 PaddleOCR 進行離線辨識。"
    )
```

---

## 5. 系統熱機設計 (Warm-up)

PaddleOCR 的模型檔在首次 instantiation 時會自動從網路上下載（約數十 MB）。為了避免使用者首次發送請求時發生 HTTP 逾時，應在 `main.py` 的 [lifespan](../main.py) 中加入熱機機制：

```python
# main.py 的 lifespan
async def lifespan(app: FastAPI):
    logger.info("ScanMail+ 啟動中...")
    init_db()
    
    # 離線 OCR 後端熱機
    from app.services.form_fill.backends import paddle_structure
    if paddle_structure.is_available():
        logger.info("檢測到本地 PaddleOCR，進行模型初始化熱機...")
        try:
            # 建立一個極小的虛擬 numpy 影像進行一次 dummy 推理
            # 這會觸發模型自動下載並加載至記憶體中
            pass
        except Exception as e:
            logger.warning("PaddleOCR 熱機失敗: %s", e)
```

---

## 6. 驗證與測試計畫

### 單元測試
建立 [test_paddle_ocr.py](../tests/test_paddle_ocr.py) 測試：
1.  **Mock 測試**: 當 `paddleocr` 未安裝時，驗證 `paddle_structure.is_available()` 正確回傳 `False`。
2.  **整合測試**: 在安裝了 `paddleocr` 的測試環境中，傳入一張帶有 "姓名：____" 的測試圖片，驗證是否能偵測出欄位，且其 bbox 座標確實落在 PDF points 的合理範圍內。
