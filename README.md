# ScanMail+ — 智慧文件處理平台

**掃描郵寄 + 多媒體工具箱**，將 ScanMail Bot 與 MediaToolkit (myPicasa) 整合為統一的 Web 平台。

由國立勤益科技大學 DofLab 實驗室開發。

---

## 功能總覽

### 📨 掃描郵寄（核心功能）

| 功能 | 說明 |
|------|------|
| 拍照 / 上傳 | 手機相機、桌機 Webcam、或直接上傳圖檔 |
| 文件掃描處理 | OpenCV 自動邊界偵測（5 種策略）+ 透視校正 + 7 種濾鏡 |
| 角點手動調整 | Canvas 可視化拖曳四個角點，精確裁切文件 |
| 圖片旋轉 | 90°/180°/270° 順時針/逆時針旋轉 |
| 多頁掃描 | 連續拍攝多張，合併為一份多頁 PDF |
| AI 文件辨識 | Google Gemini Vision API 辨識 8 種文件類型 |
| 自動產生郵件 | AI 根據文件內容自動產生主旨、正文、附件檔名 |
| 郵件模板 | 8 種文件類型預設模板 + 自訂模板，支援 `{summary}` 變數 |
| 批次寄送 | 同一份文件可勾選多位收件人一次寄出 |
| 收件人群組 | 建立常用群組（如：系務會議成員），一鍵全選 |
| 聯絡人管理 | CRUD + 使用頻率排序 |
| 寄件歷史 | 查看過去寄送紀錄與統計 |

**文件類型辨識**：考卷、公文、收據、合約、報告、信函、表單、其他

**掃描濾鏡**：自動、專業掃描、彩色公文、文件、增強、黑白、原圖

### 🖼️ 圖片工具

| 功能 | 說明 |
|------|------|
| 批次縮放 | 等比填充（白底）/ 等比裁切 / 強制拉伸，自訂寬高 |
| 格式轉換 | JPG、PNG、WebP、BMP、GIF 互轉 |
| 批次壓縮 | 品質控制（1-100）+ 最大邊長限制 |
| 文字浮水印 | 自訂文字、字體大小、透明度、顏色、位置（含平鋪模式） |
| 圖片資訊 | 查看寬高、格式、色彩模式、檔案大小 |

支援拖放上傳，單檔直接回傳結果，批次處理走背景任務 + ZIP 下載。

### 📕 PDF 工具

| 功能 | 說明 |
|------|------|
| PDF 合併 | 多檔合併，可自動產生書籤目錄 |
| 文字浮水印 | 平鋪文字、可調字體大小 / 透明度 / 旋轉角度 / 顏色 |
| 圖片浮水印 | PNG 圖片浮水印，可調縮放比例 / 透明度 / 位置 |
| 密碼保護 | 為 PDF 設定開啟密碼 |
| PDF 資訊 | 查看頁數、標題、作者、是否加密 |

### 🔄 文件轉檔

| 轉換方向 | 說明 |
|------|------|
| Word → PDF | python-docx + ReportLab 渲染，支援中文字型 |
| PDF → Word | pymupdf 文字提取 → python-docx 輸出 |
| Markdown → PDF | markdown → HTML → ReportLab PDF |
| Markdown → Word | markdown → python-docx |
| Word → Markdown | python-docx 樣式解析 → Markdown 語法 |

### 🎞️ GIF 製作

| 功能 | 說明 |
|------|------|
| 圖片序列 → GIF | 拖放多張圖片，自訂每幀時間、統一尺寸、縮放模式 |

### 🎬 影片工具（需要 ffmpeg）

| 功能 | 說明 |
|------|------|
| 影片合併 | 多個影片合併為一個 MP4（H.264 + AAC） |
| 影片轉 GIF | 自訂 FPS、寬度、起止時間截取 |
| 影片壓縮 | 解析度降低（720p/480p/360p）+ CRF 品質控制 |

支援 MP4、AVI、MOV、MKV、WebM、FLV 格式，單檔上限 200MB。

### ✏️ 批次改名

| 功能 | 說明 |
|------|------|
| 前綴 / 後綴 | 批次加入前綴或後綴文字 |
| 搜尋取代 | 批次替換檔名中的文字 |
| 流水編號 | 自訂起始號、位數、位置（前綴/後綴） |
| 即時預覽 | 規則變更時自動顯示改名前後對照 |

套用後打包為 ZIP 下載。

---

## 快速啟動

### 前置需求

- **Python 3.10+**
- **ffmpeg**（僅影片工具需要，其他功能不需要）

### 1. 安裝

```bash
cd scanmail-bot

# 建立虛擬環境（建議）
python -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate         # Windows

# 安裝所有依賴
pip install -r requirements.txt
```

### 2. 設定環境變數

```bash
cp .env.template .env
```

編輯 `.env`：

```env
# ── 必填：AI 辨識（掃描郵寄功能需要）──
GEMINI_API_KEY=your-gemini-api-key-here

# ── 必填：郵件寄送（掃描郵寄功能需要）──
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# ── 選填：寄件人資料 ──
SENDER_NAME=您的姓名
SENDER_TITLE=職稱
SENDER_DEPT=部門
SENDER_ORG=組織名稱
```

> **注意**：圖片工具、PDF 工具、文件轉檔、GIF、影片、批次改名等功能**不需要**任何 API Key 或 SMTP 設定，安裝完依賴即可使用。

### 3. 啟動

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. 開啟瀏覽器

```
http://localhost:8000
```

手機使用（需同一 Wi-Fi）：`http://你的電腦IP:8000`

---

## Docker 啟動

```bash
docker build -f deploy/Dockerfile -t scanmail-plus .

docker run -d --name scanmail-plus -p 8000:8000 \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/scanmail.db:/app/scanmail.db \
  scanmail-plus
```

或 Docker Compose：

```bash
cd deploy && docker-compose up -d
```

---

## ffmpeg 安裝（僅影片工具需要）

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt-get install ffmpeg

# Windows
choco install ffmpeg
```

---

## 技術架構

```
┌──────────────────────────────────────────────────────┐
│              前端 SPA (HTML/CSS/JS)                    │
│   工具導航列 · 7 個工具頁面 · 8 個 JS 模組             │
├──────────────────────────────────────────────────────┤
│              FastAPI 後端 (Python)                     │
│   7 個路由模組 · 10 個服務模組 · SSE 即時進度           │
├───────────┬──────────┬──────────┬────────────────────┤
│ Gemini    │ OpenCV   │ Pillow   │ moviepy / pypdf    │
│ Vision AI │ 掃描處理  │ 圖片處理  │ 影片 / PDF 處理     │
├───────────┴──────────┴──────────┴────────────────────┤
│              SQLite 資料庫 (7 張表)                     │
│  contacts · groups · group_members · email_templates  │
│  send_history · user_sessions · sender_profiles       │
└──────────────────────────────────────────────────────┘
```

## 專案結構

```
scanmail-bot/
├── main.py                         # App Factory
├── requirements.txt                # Python 依賴
├── .env.template                   # 環境變數範本
│
├── app/
│   ├── core/                       # 共用基礎設施
│   │   ├── sessions.py             #   工作階段管理
│   │   ├── tasks.py                #   背景任務 + SSE 進度
│   │   └── file_manager.py         #   暫存檔管理
│   │
│   ├── routers/                    # API 路由
│   │   ├── scanmail.py             #   掃描郵寄 + 批次寄送 + 群組 + 模板
│   │   ├── image_tools.py          #   圖片批次處理
│   │   ├── pdf_tools.py            #   PDF 合併/浮水印/加密
│   │   ├── doc_convert.py          #   文件格式轉換
│   │   ├── gif_tools.py            #   GIF 動畫製作
│   │   ├── video_tools.py          #   影片合併/壓縮/轉GIF
│   │   └── batch_rename.py         #   批次改名
│   │
│   ├── services/                   # 業務邏輯
│   │   ├── doc_scanner.py          #   邊界偵測/透視校正/濾鏡
│   │   ├── image_processor.py      #   圖片驗證/PDF 轉換
│   │   ├── ai_analyzer.py          #   Gemini AI 辨識
│   │   ├── email_sender.py         #   SMTP 寄送
│   │   ├── image_batch.py          #   圖片批次處理引擎
│   │   ├── pdf_processor.py        #   PDF 處理引擎
│   │   ├── doc_converter.py        #   文件轉檔引擎
│   │   ├── gif_creator.py          #   GIF 製作引擎
│   │   ├── video_processor.py      #   影片處理引擎
│   │   └── batch_renamer.py        #   改名引擎
│   │
│   ├── models/                     # 資料庫模型
│   │   ├── contact.py              #   聯絡人 CRUD
│   │   ├── group.py                #   收件人群組
│   │   ├── template.py             #   郵件模板
│   │   ├── history.py              #   寄件歷史
│   │   └── sender.py               #   寄件人設定
│   │
│   └── config.py                   # 環境變數設定
│
├── static/
│   ├── index.html                  # HTML Shell + 7 個工具頁面
│   ├── css/common.css              # 共用樣式
│   └── js/                         # 8 個 JS 模組
│
├── deploy/                         # Dockerfile / docker-compose / render.yaml
├── tests/                          # pytest 測試
└── docs/                           # 開發文件
```

---

## API 文件

啟動後瀏覽自動產生的互動式文件：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### API 端點總覽（73 個）

| 群組 | 主要端點 | 數量 |
|------|------|------|
| 掃描郵寄 | `/api/upload`, `/api/scan/*`, `/api/pages/*`, `/api/analyze`, `/api/send` | 20 |
| 批次寄送 | `/api/send/batch` | 1 |
| 收件人群組 | `/api/groups`, `/api/groups/{id}`, `/api/groups/{id}/members` | 5 |
| 郵件模板 | `/api/templates`, `/api/templates/{doc_type}` | 5 |
| 聯絡人/歷史/設定 | `/api/contacts`, `/api/history`, `/api/stats`, `/api/settings` | 7 |
| 圖片工具 | `/api/tools/image/resize`, `convert`, `compress`, `watermark`, `batch/*` | 11 |
| PDF 工具 | `/api/tools/pdf/merge`, `watermark/*`, `protect`, `info` | 7 |
| 文件轉檔 | `/api/tools/convert/word-to-pdf`, `pdf-to-word`, `md-to-*`, `word-to-md` | 5 |
| GIF 製作 | `/api/tools/gif/create` | 3 |
| 影片工具 | `/api/tools/video/merge`, `to-gif`, `compress` | 5 |
| 批次改名 | `/api/tools/rename/preview`, `apply` | 4 |

---

## 開發

```bash
# 執行測試
python -m pytest tests/ -v

# 開發模式啟動
uvicorn main:app --reload

# 健康檢查
curl http://localhost:8000/health
```

---

## 授權

MIT License — DofLab Laboratory, 國立勤益科技大學
