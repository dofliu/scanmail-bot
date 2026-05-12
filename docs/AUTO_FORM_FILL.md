# Auto Form Fill — 設計文件

> 狀態：**Skeleton / Draft**（v0.1, 2026-05）
> 對應分支：`claude/add-auto-form-fill-AhlqH`

---

## 1. 目標

讓 ScanMail+ 能對「**輸入的表單文件**」自動偵測欄位、對應使用者既有資料（寄件人資料、聯絡人）、回填後輸出可下載／可直接寄出的 PDF。

支援輸入：

| 輸入型態 | 範例 |
|---------|------|
| 帶 AcroForm 欄位的 PDF | 政府電子表單、銀行申請書 |
| 可選取文字的 flat PDF | Word 輸出的表單、報名表 |
| 掃描影像 / 純圖檔 | 手機拍的紙本表單 |

---

## 2. 設計原則：**分層處理 (Layered Strategy)**

> 「能用結構化資料解析就不要用視覺；視覺辨識只當保底。」

```
┌─────────────────────────────────────────────────────┐
│  Layer 1 — Structured PDF (AcroForm / XFA)          │
│  ↳ pypdf 讀取欄位元資料 → 直接寫入                  │
│  成本：免費 · 精度：完美 · 涵蓋率：低               │
├─────────────────────────────────────────────────────┤
│  Layer 2 — Text-Extractable PDF                     │
│  ↳ pdfplumber 抽文字+座標+表格框線                  │
│  ↳ 啟發式：標籤右側／下方的空白矩形 = 欄位          │
│  成本：免費 · 精度：高 · 涵蓋率：中                 │
├─────────────────────────────────────────────────────┤
│  Layer 3 — OCR + Layout Analysis (本地)             │
│  ↳ PaddleOCR PP-Structure（推薦）                   │
│  ↳ Tesseract + OpenCV 線條偵測                      │
│  成本：免費（CPU 慢） · 精度：中高                  │
├─────────────────────────────────────────────────────┤
│  Layer 4 — Multimodal LLM Vision (保底)             │
│  ↳ Gemini Vision（專案已整合）                      │
│  ↳ 對手寫、奇怪版型最強                             │
│  成本：API 費用 · 精度：依模型                      │
└─────────────────────────────────────────────────────┘
                    ↓
        ┌─────────────────────────┐
        │  Semantic Mapping (LLM) │
        │  ↳ 將 raw 欄位 → 對應    │
        │     sender_profile / 聯絡人 │
        └─────────────────────────┘
                    ↓
        ┌─────────────────────────┐
        │  Filler (寫回 PDF)       │
        │  ↳ AcroForm：pypdf       │
        │  ↳ 影像 / flat：ReportLab│
        │     疊字到 bbox          │
        └─────────────────────────┘
```

---

## 3. 模組結構

```
app/services/form_fill/
├── __init__.py                  # 對外公開 detect_fields() / fill_form()
├── schema.py                    # FormField / DetectionResult dataclass
├── dispatcher.py                # 依輸入型態自動選擇 backend
├── backends/
│   ├── __init__.py
│   ├── acroform.py              # Layer 1：pypdf AcroForm
│   ├── pdfplumber_extract.py    # Layer 2：可選取文字 PDF
│   ├── paddle_structure.py      # Layer 3：PaddleOCR PP-Structure（lazy import）
│   └── gemini_vision.py         # Layer 4：Gemini Vision
├── semantic_mapper.py           # 把 raw label → sender_profile/contact 欄位
└── filler.py                    # 將值寫回 PDF（AcroForm or 疊字模式）
```

對應路由與前端：

```
app/routers/form_tools.py        # /api/tools/form/*
static/js/form-tools.js          # 前端頁面（標籤輔助時可選）
```

---

## 4. 核心資料結構

```python
# app/services/form_fill/schema.py

@dataclass
class FormField:
    name: str                 # 內部 ID（hash 或 AcroForm 欄位名）
    label: str                # 人類可讀的欄位名稱（"姓名"、"日期"）
    field_type: str           # text | date | checkbox | signature | number
    bbox: tuple[float, float, float, float] | None  # (x0, y0, x1, y1) in PDF points
    page: int                 # 第幾頁（從 0）
    backend: str              # "acroform" | "pdfplumber" | "paddle" | "gemini"
    confidence: float         # 0.0 ~ 1.0
    suggested_value: str | None = None   # semantic_mapper 填上的建議值
    semantic_key: str | None = None      # "sender.name" | "contact.email" | ...

@dataclass
class DetectionResult:
    backend_used: str
    page_count: int
    fields: list[FormField]
    needs_review: bool        # 信心度過低時提示使用者人工確認
```

---

## 5. Dispatcher 流程

> 設計契約：對外**兩個入口**，邊界 `normalize_to_pdf` 把任何輸入轉成 PDF；
> 核心 `detect_fields` 只認 PDF。`FormField.bbox` 一律是 PDF points
> (origin bottom-left)，各 backend 在 detect 階段就完成座標換算。

```python
def normalize_to_pdf(data: bytes, mime: str) -> bytes:
    """邊界：影像 → 單頁 PDF（page size = pixel 數）；PDF 直接 pass-through"""
    if mime == "application/pdf":
        return data
    if mime.startswith("image/"):
        return _image_to_pdf(data)
    raise UnsupportedFormat(mime)


def detect_fields(data: bytes, hint: str | None = None) -> DetectionResult:
    # data 必須是 PDF（請先呼叫 normalize_to_pdf）
    if acroform.has_acroform(data):
        return acroform.detect(data)                          # Layer 1
    if pdfplumber_extract.has_text_layer(data):
        return pdfplumber_extract.detect(data)                # Layer 2
    # 純圖片型 PDF / 來源就是影像 → 渲染後走 Layer 3/4
    page_sizes_pts = _get_pdf_page_sizes(data)
    images = _render_pdf_to_images(data)
    return _detect_from_images(images, page_sizes_pts, hint)


def _detect_from_images(images, page_sizes_pts, hint):
    # Layer 3 優先（本地 / 免費），失敗或不可用時退到 Layer 4
    if paddle_structure.is_available():
        try:
            return paddle_structure.detect(images, page_sizes_pts=page_sizes_pts)
        except Exception as e:
            logger.warning("PaddleOCR failed, fallback to Gemini: %s", e)
    return gemini_vision.detect(images, page_sizes_pts=page_sizes_pts, hint=hint)
```

---

## 6. API 端點規劃

| Method | Path | 用途 |
|--------|------|------|
| `POST` | `/api/tools/form/detect` | 上傳表單 → 回傳 `DetectionResult` |
| `POST` | `/api/tools/form/suggest` | 對偵測結果套用 semantic mapping，回傳建議值 |
| `POST` | `/api/tools/form/fill` | 接收欄位值清單 → 產生填好的 PDF（背景任務） |
| `GET`  | `/api/tools/form/task/{id}/progress` | SSE 進度 |
| `GET`  | `/api/tools/form/task/{id}/download` | 下載填好的 PDF |
| `POST` | `/api/tools/form/fill-and-send` | 填寫後直接接入既有 `/api/send` 寄出 |

請求／回應範例：

```jsonc
// POST /api/tools/form/detect (multipart/form-data, file=<pdf>)
{
  "backend_used": "acroform",
  "page_count": 2,
  "needs_review": false,
  "fields": [
    {
      "name": "field_0",
      "label": "申請人姓名",
      "field_type": "text",
      "bbox": [120.5, 720.0, 320.5, 740.0],
      "page": 0,
      "backend": "acroform",
      "confidence": 1.0,
      "suggested_value": null,
      "semantic_key": null
    }
    // ...
  ]
}

// POST /api/tools/form/fill (JSON)
{
  "session_token": "abc...",        // 對應上一次 detect 的暫存檔
  "values": {
    "field_0": "王小明",
    "field_1": "2026-05-12"
  }
}
// → { "task_id": "..." }
```

---

## 7. Semantic Mapping（資料來源對應）

把偵測到的欄位 label 對應到使用者既有資料：

| Label 關鍵字 | 對應欄位 (semantic_key) | 來源 |
|------------|------------------------|------|
| 姓名 / 申請人 / Name | `sender.name` | `sender_profiles` |
| 職稱 / Title | `sender.title` | `sender_profiles` |
| 單位 / 部門 / Dept | `sender.department` | `sender_profiles` |
| 學校 / Organization | `sender.organization` | `sender_profiles` |
| Email / 電子郵件 | `sender.email` / `contact.email` | profile / contacts |
| 電話 / Phone | `contact.phone`（待擴充 schema） | contacts |
| 日期 / Date | `today` | 系統時間 |

實作上分兩階段：
1. **Rule-based fast path**：關鍵字 / regex 命中即返回（涵蓋 80% 常見表單）
2. **LLM-assisted fallback**：丟給 Gemini 一份 label list + 候選 semantic_key 清單，回傳對應表（給奇怪命名用）

---

## 8. Filler 寫回邏輯

```python
def fill_form(data: bytes, fields: list[FormField], values: dict[str, str]) -> bytes:
    if fields[0].backend == "acroform":
        return _fill_acroform(data, values)
    return _fill_by_overlay(data, fields, values)  # ReportLab 疊字
```

- **AcroForm 模式**：`pypdf.PdfWriter.update_page_form_field_values()`
- **疊字模式**：每頁建立 ReportLab canvas，在 `bbox` 左下角 `drawString()`，再 `merge_page()` 疊到原頁面（沿用 `pdf_processor.add_text_watermark_to_pdf` 已有的 pattern）

中文字型透過既有 `doc_converter.py` 已註冊的字型載入。

---

## 9. 前端 UX

進入點：工具箱新增「📝 表單填寫」磚塊。

步驟：

1. **上傳**：拖放或點選表單檔
2. **偵測中**：顯示「使用 backend = AcroForm / PaddleOCR / Gemini …」
3. **欄位表 + 預覽**：左側 PDF 預覽（標示 bbox），右側欄位列表 + 建議值（可一鍵套用 sender_profile / contact）
4. **填寫** → 下載 PDF，或選收件人直接寄出（接 `/api/send`）

低信心度欄位用黃色標示，提醒使用者確認。

---

## 10. 依賴（requirements.txt 新增）

```text
# ── Form Fill (核心，必裝) ──
pdfplumber>=0.11.0

# ── Form Fill (Optional：影像 OCR backend，部署時可選) ──
# paddleocr>=2.7.0          # 約 600MB，含模型權重；雲端部署再開
# paddlepaddle>=2.5.0       # 同上
```

`paddleocr` 因體積較大，預設**不裝**；偵測流程中 `paddle_structure.is_available()` 會回傳 `False`，dispatcher 自動 fallback 到 Gemini。

---

## 11. 與既有功能的整合

- **掃描郵寄流程整合**：scan 完表單後，可選擇「→ 自動填寫」分支，最後合併進附件清單寄出
- **批次寄送**：同一份表單可針對不同收件人 / sender_profile 分別填出多份 PDF
- **模板系統**：表單可註冊為「常用表單模板」，下次同類型表單偵測到後自動套用上次的對應規則

---

## 12. 開發里程碑

| 階段 | 範圍 | 預計 |
|-----|------|------|
| **M1 Skeleton** | 模組結構、API 路由、dispatcher 介面、最小前端 | ✅ 本 PR |
| M2 Layer 1 | AcroForm 完整偵測與填寫 | next |
| M3 Layer 2 | pdfplumber 文字表單偵測 + 啟發式配對 | next |
| M4 Layer 4 | Gemini Vision backend（最少限度可用） | next |
| M5 Mapping UI | 前端欄位映射、預覽、可拖曳調整 bbox | next |
| M6 Layer 3 | PaddleOCR PP-Structure 接入（Optional） | later |
| M7 整合寄送 | 接 `/api/send`、模板儲存 | later |

---

## 13. 安全 / 隱私

- 表單可能含個資（身分證、銀行帳號），偵測結果**只暫存於記憶體 / temp file**，沿用 `app/core/file_manager.py` 的 TTL 機制
- 送 Gemini 前應依使用者設定提供 opt-out 開關（敏感表單建議走本地 backend）
- 寫回的 PDF 不保留原始檔的 metadata（防 PII 殘留）

