# ScanMail 系統架構文件

> 最後更新：2026/03/24

---

## 系統總覽

ScanMail 是一個 Web-based 的文件掃描郵寄系統，採用前後端分離架構，前端為單頁應用（SPA），後端為 FastAPI REST API，以 SQLite 作為資料儲存。

```
使用者（手機/桌機瀏覽器）
        │
        │  HTTP / REST API
        ▼
┌─────────────────────────────────────────┐
│            FastAPI 應用程式               │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ 靜態檔案  │  │ API 路由  │  │Session │ │
│  │ (SPA)    │  │ Endpoints │  │ 管理   │ │
│  └──────────┘  └────┬─────┘  └────────┘ │
│                     │                    │
│         ┌───────────┼───────────┐        │
│         ▼           ▼           ▼        │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ AI 辨識  │ │ 掃描處理  │ │郵件寄送 │  │
│  │ (Gemini) │ │ (OpenCV) │ │ (SMTP)  │  │
│  └──────────┘ └──────────┘ └─────────┘  │
│         │                                │
│         ▼                                │
│  ┌──────────────────────────────────┐    │
│  │    SQLite 資料庫                  │    │
│  │  contacts│history│sender│session  │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
        │                    │
        ▼                    ▼
   Google Gemini        SMTP Server
   Vision API           (Gmail/校內)
```

---

## 模組架構

### 1. 前端 (`static/index.html`)

單一 HTML 檔案的 SPA，約 2,100 行，包含 HTML/CSS/JS。

**核心元件：**
- **4 步驟 Wizard UI** — 拍照 → 選收件人 → 預覽確認 → 寄送結果
- **Camera API** — 使用 `navigator.mediaDevices.getUserMedia()` 存取攝影機
- **掃描處理面板** — 拍照後自動顯示，提供 5 種濾鏡切換和原始/處理後對比預覽
- **聯絡人管理** — 新增、選取、刪除聯絡人
- **側邊面板** — 歷史紀錄、聯絡人列表、寄件人設定

**狀態管理：**
```javascript
state = {
    currentStep,         // 目前步驟 (1-4)
    uploadedFile,        // 檔名
    uploadedFileData,    // Blob 資料
    imageUploaded,       // 是否已上傳到伺服器
    scanProcessedUrl,    // 掃描處理後的 base64 圖片
    selectedContact,     // 選中的收件人
    analyzeResult,       // AI 辨識結果
    contacts,            // 聯絡人列表
    history,             // 寄送歷史
    settings             // 寄件人設定
}
```

### 2. 後端主程式 (`main.py`)

FastAPI 應用，約 440 行。

**Session 管理：**
- 使用 in-memory dict `_sessions` 儲存每個使用者的操作狀態
- `SessionData` 包含：`image_data`（目前圖片）、`image_original`（原始圖片）、`ai_result`（AI 結果）、`detected_corners`（邊界角點）
- 使用者 ID 從 `X-User-Id` header 取得，預設為 `"default_user"`

**API 路由群組：**
1. **圖片** — `POST /api/upload`
2. **掃描** — `POST /api/scan/detect`、`/api/scan/process`、`/api/scan/filter`
3. **AI** — `POST /api/analyze`
4. **寄送** — `POST /api/send`
5. **聯絡人** — `GET/POST/DELETE /api/contacts`
6. **其他** — `/api/history`、`/api/stats`、`/api/settings`

### 3. AI 文件辨識 (`app/services/ai_analyzer.py`)

**核心流程：**
1. 收到圖片 bytes + 寄件人/收件人資訊
2. 組合 System Prompt（文件辨識規則 + JSON 輸出格式）+ User Prompt
3. 呼叫 Gemini Vision API（先試帶 `response_mime_type="application/json"`，失敗再試不帶）
4. 多重策略解析 JSON（直接解析 → 去 markdown → regex 提取 → 修復截斷）
5. 驗證必要欄位，回傳結構化結果

**辨識輸出格式：**
```json
{
    "doc_type": "official",
    "doc_type_label": "公文",
    "confidence": 0.98,
    "subject": "[公文] 離岸風電審查會議改期通知 — 115年3月",
    "body": "劉老師您好，檢附經濟部產業發展署之來函...",
    "filename": "公文_離岸風電審查會議改期_20260324_2104.pdf",
    "extracted_text_summary": "經濟部產業發展署函...",
    "detected_language": "zh-TW",
    "suggested_recipients": ["相關委員"]
}
```

### 4. 文件掃描處理 (`app/services/doc_scanner.py`)

**邊界偵測（4 種策略依序嘗試）：**
1. **顏色分析** — HSV+LAB 色彩空間分離淺色紙張區域
2. **Canny 邊緣偵測** — 多組閾值 + 膨脹/形態學閉合
3. **自適應閾值** — Otsu 二值化 + 形態學
4. **GrabCut** — 前景分離（假設文件在中央）

**透視校正：**
- 四點 Perspective Transform
- 自動計算目標矩形尺寸
- 雙三次插值（INTER_CUBIC）

**影像增強濾鏡：**
| 濾鏡 | 說明 | 核心演算法 |
|------|------|-----------|
| auto | 智慧增強 | 背景去除 + 輕度銳化 |
| document | 文件模式 | 去陰影 + 自適應閾值（類似掃描器效果） |
| enhance | 增強模式 | CLAHE + 去陰影 + 雙邊濾波 + 銳化（彩色） |
| bw | 黑白模式 | 去陰影 + Otsu 二值化 |
| original | 原圖 | 不處理 |

**核心演算法 — 背景陰影去除：**
```
1. 轉灰階
2. 大核高斯模糊估計背景光照 bg
3. 光照歸一化: normalized = (gray / bg) * 200
4. CLAHE 局部對比增強
```

### 5. 郵件寄送 (`app/services/email_sender.py`)

**多策略 SMTP 連線：**
依序嘗試不同的伺服器/port/認證組合，第一個成功的就使用。

**郵件格式：**
- MIME multipart/mixed
- 正文：HTML + 純文字雙版本
- HTML 包含：正文段落、分隔線、寄件人簽名檔
- 附件：PDF 檔案

### 6. 資料模型 (`app/models/`)

**資料庫表結構：**

```sql
-- 聯絡人
contacts (id, user_id, name, email, department, title, created_at)

-- 寄送歷史
send_history (id, user_id, recipient_email, recipient_name, subject,
              body, doc_type, filename, ai_confidence, file_size, created_at)

-- 寄件人設定
sender_profiles (id, user_id, name, email, title, department,
                 organization, smtp_user, smtp_password_encrypted, updated_at)

-- Session（資料庫版，目前使用 in-memory）
user_sessions (id, user_id, state, data_json, updated_at)
```

---

## 資料流

### 完整寄送流程

```
[使用者拍照]
     │
     ▼
POST /api/upload          → Session.image_data = raw bytes
     │                      Session.image_original = raw bytes
     ▼
POST /api/scan/process    → detect_document_edges()
     │                      perspective_transform()
     │                      apply_filter()
     │                      Session.image_data = processed bytes
     ▼
POST /api/scan/filter     → apply_filter(original or corrected)
     │ (可選,切換濾鏡)       Session.image_data = re-filtered bytes
     ▼
POST /api/analyze         → Gemini Vision API
     │                      Session.ai_result = {subject, body, filename, ...}
     ▼
POST /api/send            → image_to_pdf(Session.image_data)
     │                      send_email(pdf_bytes, subject, body, ...)
     │                      HistoryModel.create(...)
     ▼
[郵件送達收件者信箱]
```

---

## 設定管理

所有設定透過 `.env` 檔案載入，使用 pydantic-settings 管理。

| 設定 | 說明 | 預設值 |
|------|------|--------|
| GEMINI_API_KEY | Gemini API 金鑰 | （必填） |
| AI_MODEL | 模型名稱 | gemini-2.0-flash |
| AI_MAX_TOKENS | 最大輸出 tokens | 4096 |
| AI_TEMPERATURE | 生成溫度 | 0.3 |
| SMTP_HOST | SMTP 伺服器 | mail.ncut.edu.tw |
| SMTP_PORT | SMTP 連接埠 | 587 |
| SMTP_USER | SMTP 帳號 | （必填） |
| SMTP_PASSWORD | SMTP 密碼 | （必填） |
| SENDER_NAME | 預設寄件人姓名 | 劉瑞弘 |
| SENDER_TITLE | 預設職稱 | 副教授 |
| SENDER_DEPT | 預設單位 | 智慧自動化工程系 |
| DATABASE_PATH | SQLite 檔案路徑 | scanmail.db |

---

## 安全性考量

1. **SMTP 密碼** — 存於 `.env`，不進版控（`.gitignore`）
2. **API Key** — 同上
3. **圖片資料** — 僅存於 in-memory session，不持久化到磁碟
4. **敏感資訊** — AI prompt 指示不在摘要中包含身分證字號、銀行帳號等
5. **CORS** — 目前允許所有來源（開發模式），部署時應限制

---

## 部署選項

| 平台 | 設定檔 | 說明 |
|------|--------|------|
| Docker | `deploy/Dockerfile` | 容器化部署 |
| Docker Compose | `deploy/docker-compose.yml` | 含環境變數設定 |
| Render | `deploy/render.yaml` | Render.com 一鍵部署 |
| Railway | `deploy/railway.toml` | Railway 部署 |
| 本地 | uvicorn | 開發用 |
