# ScanMail 系統架構文件

> 最後更新：2026/08/01

---

## 系統總覽

ScanMail+ 是一個文件掃描郵寄平台，另外整合了一整套媒體 / 文件工具。
從 v3.5.0 起，**同一份前端**（`static/`）同時服務三個執行環境：

| 執行環境 | 後端 | 說明 |
|------|------|------|
| 網頁版 | 需要 | FastAPI 直接送出 `static/`，同源呼叫 API |
| Android App（完整版） | 需要 | Capacitor 外殼，前端打包進 APK，用絕對位址呼叫後端 |
| Android App（離線精簡版） | **不需要** | 只保留在裝置上就做得完的工具，檔案不離開手機 |

差別只在打包時的旗標（`SM_NATIVE` / `SM_OFFLINE`），不是三份程式碼。

```
                          static/  ← 唯一的前端來源
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   瀏覽器（同源）       APK（完整版）        APK（離線精簡版）
        │                    │                    │
        └─────────┬──────────┘                    │
                  ▼                               ▼
    ┌─────────────────────────────┐   ┌──────────────────────────┐
    │        FastAPI 後端          │   │   裝置端引擎（純 JS）      │
    │                             │   │                          │
    │  routers/  9 個路由模組      │   │  image-local  圖片 / 拼貼 │
    │  services/ 12 個服務模組     │   │  scan-lite    邊界偵測    │
    │                              │   │  scan-live    即時取景    │
    │  core/     session / 檔案 /  │   │  sign-lite    簽名 / 印章 │
    │            背景任務 / 認證 / │   │  pdf-lite     PDF 物件層  │
    │            速率限制          │   │  pdf-write    PDF 產生    │
    │                             │   │  doc-local    文件轉檔    │
    │  ┌───────┐┌───────┐┌──────┐ │   │  ttf-lite     字型子集化  │
    │  │Gemini ││OpenCV ││ SMTP │ │   │  zip-lite     ZIP 讀寫    │
    │  │Vision ││ 掃描  ││ 寄信 │ │   └──────────────────────────┘
    │  └───────┘└───────┘└──────┘ │      約 5,800 行，不連任何後端
    │            │                │
    │            ▼                │
    │      SQLite（9 張表）        │
    └─────────────────────────────┘
```

### 為什麼會有兩套引擎

後端的重活是 Python：OpenCV 邊界偵測、Gemini Vision、影片處理、SMTP。
這些跑不進手機。但「圖片編輯、文件轉檔、PDF 頁面操作」其實瀏覽器就做得完 ——
於是這一部分另外寫了一套純 JS 的裝置端引擎。

兩套刻意保持**語意對齊**而不是共用程式碼（語言不同，共用不了）：
`image-local.js` 的版面與縮放規則對齊後端 `image_batch.py`，
`scan-lite.js` 的評分公式照搬後端 `doc_scanner.py` v5。
已知的差異都寫在各自檔案的註解裡。

---

## 模組架構

### 1. 前端 (`static/`)

`index.html` 只剩約 100 行的外殼（載入模組、決定執行環境），介面在 React 模組裡。

| 檔案 | 角色 |
|------|------|
| `boot.jsx` | 依執行環境與裝置決定要渲染哪一套殼 |
| `desktop.jsx` / `mobile.jsx` | 完整版的桌面 / 手機介面 |
| `studio.jsx` | **離線精簡版自己的介面**（編輯 / 圖片 / 文件 / 頁面四頁） |
| `atoms.jsx` | 共用元件（相機、裁切編輯器、上傳區、進度條…） |
| `store.js` | 狀態管理 |
| `api.js` | 後端呼叫與下載（App 內走原生寫檔 + 系統分享） |
| `config.js` | 執行環境設定層：網頁版同源、App 版用絕對位址 |
| `native.js` | Capacitor 橋接（存檔、分享、持久化小資料） |

裝置端引擎（不依賴後端，也不依賴 React）：

| 檔案 | 行數 | 做什麼 |
|------|------|------|
| `image-local.js` | ~1280 | 縮放 / 轉檔 / 壓縮 / 拼接 / 旋轉 / 裁切 / 打碼 / 濾鏡 / 文字 / 格子取景（裁切框與取景都會跟著旋轉走：`rotateRect` / `rotateFit`）|
| `scan-lite.js` | ~1040 | 文件邊界偵測（梯度導向 Hough）+ 透視校正（WebGL）+ 拍攝品質診斷（`assess()`：低信心時說得出反光 / 過暗 / 太遠）|
| `scan-live.js` | ~390 | 即時取景：`getUserMedia` 取流 + 節流跑 `scan-lite` 偵測 + 平滑角點 + 全解析度快門 + 框穩了自動按快門 |
| `sign-lite.js` | ~590 | 簽名模型（向量筆畫）、去白底匯入、PDF 路徑輸出、簽名庫的持久化 |
| `pdf-lite.js` | ~990 | PDF 物件解析器：讀 xref / 展開物件串流 / 挑頁重組 / 蓋章 |
| `pdf-write.js` | ~520 | PDF 產生器（Type0 內嵌字型、影像 XObject） |
| `doc-local.js` | ~1120 | PDF / Word / Markdown 互轉，中間隔一層共用文件模型 |
| `ttf-lite.js` | ~370 | TrueType 解析與子集化（只把用到的字寫進 PDF） |
| `zip-lite.js` | ~210 | 用瀏覽器內建 CompressionStream 讀寫 zip（DOCX 就是 zip） |

#### 「要留著的東西」存在哪裡（`SMNative.store`）

`localStorage` 在瀏覽器是儲存，在 App 的 WebView 裡卻只是**快取** ——
Android 的「清除快取」、系統回收儲存空間、部分 ROM 的省電清理都會把它清掉。
所以 `native.js` 提供一層統一的介面，讓呼叫端不必自己判斷跑在哪裡：

| 方法 | App 內 | 瀏覽器 |
|------|------|------|
| `isDurable()` | `true` | `false` |
| `get(key)` | **只問** Capacitor Preferences；外掛丟例外才退回 `localStorage` | `localStorage` |
| `set(key, value)` | Preferences（失敗往外丟）＋ `localStorage` 鏡像（失敗不影響） | `localStorage` |
| `remove(key)` | 兩邊都刪 | `localStorage` |

`get()` 在 App 內不退回 `localStorage` 是刻意的：**「原生儲存沒有這個 key」是判斷
「要不要把舊資料搬過去」的唯一依據**，偷偷退回去讀的話就永遠搬不成，
資料也永遠留在會被清掉的地方。

Preferences 是非同步的，而 `sign-lite.js` 的 `list()` 被同步的畫圖路徑用著，
所以簽名庫在 App 內多留一份記憶體副本：開場 `ready()` 把 Preferences 讀進來，
之後 `list()` 讀它、寫入排隊送出（`flush()` 可以等落地）。
網頁版那份副本恆為 `null`，`list()` 每次直接讀 `localStorage` ——
多分頁互看得到，行為與加這層之前完全相同。

目前用這層的有兩個：**簽名庫**（`sign-lite.js`）與 **App 的伺服器位址**（`config.js`）。

#### 伺服器位址的兩段式讀取（`config.js`）

位址也不能只留在 `localStorage`，但它比簽名庫麻煩：`config.js` 在 `index.html` 裡
**排在 `native.js` 之前**，而且是同步讀取 —— 載入的當下問不到非同步的 Preferences。
解法是拆成兩段，而不是動整條載入鏈：

| 階段 | 做什麼 | 誰觸發 |
|------|------|------|
| 開機（同步） | 照舊讀 `localStorage`。App 內它是原生儲存的鏡像，兩邊幾乎總是一樣，所以 `apiBase` 一載入就有值 | `config.js` 載入時 |
| `ready()`（非同步） | 跟 Preferences 對答案：鏡像被清掉了就把位址救回來、原生儲存還沒有就把舊位址搬過去 | `native.js` 的 `init()` |

**順序是重點**：`native.js` 先 `await SM_CONFIG.ready()`、之後才判斷要不要跳伺服器
設定畫面。少了那個 `await`，位址雖然救得回來，畫面卻已經蓋上去要人重打一次 IP。

代價是位址有可能在**載入之後**才定案，所以載入時抄走 `apiBase` 的模組要訂閱
`SM_CONFIG.onApiBaseChange()`。`api.js` 的 `rebase()` 就是為此：各 function 裡的
`${BASE}` 本來就是呼叫時求值，但七個工具前綴（`imgBase` 這種）是載入時先組好的字串，
得跟著換 —— 漏掉哪一個，那一類工具就會在清過快取的裝置上打到 `https://localhost`。
（`tests/test_mobile_build.py` 兩個防呆測試分別釘住這個順序與這份對應關係。）

網頁版與離線版沒有「要連到哪一台」的問題，`ready()` 直接 resolve，完全不碰原生儲存。

### 2. 後端主程式 (`main.py`)

約 140 行的 App Factory —— 建立 FastAPI 實例、掛上各路由模組、設定 CORS 與靜態檔案、
`lifespan` 內做熱機。版本號的唯一來源也在這裡（`version="x.y.z"`）。

### 3. 路由 (`app/routers/`)

| 模組 | 負責 |
|------|------|
| `scanmail.py` | 掃描、AI 辨識、寄信、聯絡人、群組、模板、歷史 |
| `image_tools.py` | 圖片批次處理 |
| `pdf_tools.py` | PDF 合併 / 浮水印 / 加密 |
| `doc_convert.py` | Word / Markdown / PDF 轉檔 |
| `gif_tools.py` · `video_tools.py` | GIF 製作、影片處理 |
| `batch_rename.py` | 批次改名 |
| `form_tools.py` | 表單自動填寫 |
| `auth.py` | 登入 / 使用者 |

### 4. 共用基礎設施 (`app/core/`)

`sessions.py`（工作階段）、`file_manager.py`（暫存檔與路徑穿越防禦）、
`tasks.py`（背景任務 + SSE 進度推送）、`auth.py`、`rate_limiter.py`。

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

### 裝置端流程（離線精簡版，完全不連後端）

一樣是「拍紙本 → 拉正 → 存成 PDF」，但每一步都在瀏覽器裡：

```
[選圖 / 拍照]
     │
     ▼
loadItem()                 解碼成 ImageBitmap，另外做一份縮圖預覽
     │                     （長邊 1400px —— 所有即時操作都用它，按一下就有反應）
     ▼
SMScanLite.detect()        梯度導向 Hough → 候選四邊形 → v5 評分挑最好的
     │                     信心 < 0.45 就不自動裁，請使用者自己拉
     ▼
SMScanLite.warp()          WebGL 逐像素反推來源座標
     │                     輸出尺寸用 Zhang–He 法反推真實寬高比
     ▼
renderItem()               旋轉 / 翻轉 / 濾鏡 / 裁切 / 打碼（每次狀態變動都重跑）
     │
     ▼
composeToCanvas()          layoutBoxes() 算版面 → drawCell() 逐格繪製（含取景）
     │                     → drawTexts() → drawSignatures()
     ▼
imagesToPdf()              JPEG 原始位元組直接嵌進 /DCTDecode，畫質完全不掉
     │
     ▼
API.triggerDownload()      App 內走 Capacitor 寫檔 + 系統分享面板
```

**預覽與匯出共用同一套計算**（`layoutBoxes()` 是唯一的版面來源），差別只在
`usePreview` 旗標決定拿縮圖還是原圖 —— 所以不會發生「看到的跟存出來的不一樣」。

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
| Android APK | `scripts/build_mobile.py` + Gradle | 完整版需要後端；離線精簡版不需要 |

Android 的建置流程、取得 APK 的方式、簽章與疑難排解見 **[ANDROID.md](ANDROID.md)**。
