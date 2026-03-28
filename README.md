# ScanMail+ — 智慧文件處理平台

**掃描郵寄 + 多媒體工具箱**，將 ScanMail Bot 與 MediaToolkit (myPicasa) 整合為統一的 Web 平台。

---

## 功能總覽

| 工具 | 說明 |
|------|------|
| 📨 **掃描郵寄** | 拍照 → AI 辨識 → 自動產生郵件 → 一鍵寄出 PDF |
| 🖼️ **圖片工具** | 批次縮放、格式轉換、壓縮、文字/圖片浮水印 |
| 📕 **PDF 工具** | PDF 合併（含書籤目錄）、浮水印、密碼保護 |
| 🔄 **文件轉檔** | Word⟷PDF、Markdown⟷PDF/Word 雙向轉換 |
| 🎞️ **GIF 製作** | 圖片序列 → 動畫 GIF（自訂幀率/尺寸） |
| 🎬 **影片工具** | 影片合併、影片轉 GIF、影片壓縮 |
| ✏️ **批次改名** | 前綴/後綴/搜尋取代/流水編號，即時預覽 |

---

## 快速啟動

### 前置需求

- **Python 3.10+**
- **ffmpeg**（影片工具需要，圖片/PDF/文件轉檔不需要）

### 1. 安裝

```bash
# 進入專案目錄
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
# 複製範本
cp .env.template .env
```

用文字編輯器打開 `.env`，填入以下設定：

```env
# ── 必填：AI 辨識（掃描郵寄功能需要）──
GEMINI_API_KEY=your-gemini-api-key-here

# ── 必填：郵件寄送（掃描郵寄功能需要）──
SMTP_HOST=smtp.gmail.com        # 或您的 SMTP 伺服器
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# ── 選填：寄件人資料 ──
SENDER_NAME=您的姓名
SENDER_TITLE=職稱
SENDER_DEPT=部門
SENDER_ORG=組織名稱
```

> **注意**：如果您只使用圖片工具、PDF 工具、文件轉檔等功能，**不需要**設定 Gemini API Key 和 SMTP。這些設定只有掃描郵寄功能才需要。

### 3. 啟動伺服器

```bash
# 開發模式（自動重新載入）
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 或使用 Python 直接執行
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 4. 開啟瀏覽器

```
http://localhost:8000
```

手機使用：確保手機與電腦在同一個 Wi-Fi 網路，在手機瀏覽器輸入電腦的 IP：

```
http://192.168.x.x:8000
```

---

## Docker 啟動

```bash
# 建置映像檔
docker build -f deploy/Dockerfile -t scanmail-plus .

# 執行（掛載 .env 和資料庫）
docker run -d \
  --name scanmail-plus \
  -p 8000:8000 \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/scanmail.db:/app/scanmail.db \
  scanmail-plus
```

或使用 Docker Compose：

```bash
cd deploy
docker-compose up -d
```

> **影片工具注意**：Docker 映像檔需要 ffmpeg。如果使用預設的 `python:3.11-slim`，moviepy 會自動下載 ffmpeg binary。若需要手動安裝，在 Dockerfile 加入：
> ```dockerfile
> RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
> ```

---

## ffmpeg 安裝（影片工具）

影片工具（合併、轉 GIF、壓縮）需要 ffmpeg。**其他工具不需要**。

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt-get install ffmpeg

# Windows (使用 chocolatey)
choco install ffmpeg

# 或手動下載：https://ffmpeg.org/download.html
```

驗證安裝：
```bash
ffmpeg -version
```

---

## 專案結構

```
scanmail-bot/
├── main.py                         # App Factory（~80行）
├── requirements.txt                # Python 依賴
├── .env.template                   # 環境變數範本
│
├── app/
│   ├── core/                       # 共用基礎設施
│   │   ├── sessions.py             #   工作階段管理
│   │   ├── tasks.py                #   背景任務 + SSE 進度
│   │   └── file_manager.py         #   暫存檔管理 + 清理
│   │
│   ├── routers/                    # API 路由（7 個模組）
│   │   ├── scanmail.py             #   /api/* — 掃描郵寄
│   │   ├── image_tools.py          #   /api/tools/image/*
│   │   ├── pdf_tools.py            #   /api/tools/pdf/*
│   │   ├── doc_convert.py          #   /api/tools/convert/*
│   │   ├── gif_tools.py            #   /api/tools/gif/*
│   │   ├── video_tools.py          #   /api/tools/video/*
│   │   └── batch_rename.py         #   /api/tools/rename/*
│   │
│   ├── services/                   # 業務邏輯（10 個模組）
│   │   ├── doc_scanner.py          #   OpenCV 邊界偵測/透視校正
│   │   ├── image_processor.py      #   圖片驗證/最佳化/PDF 轉換
│   │   ├── ai_analyzer.py          #   Gemini AI 文件辨識
│   │   ├── email_sender.py         #   SMTP 多策略寄送
│   │   ├── image_batch.py          #   圖片批次處理
│   │   ├── pdf_processor.py        #   PDF 合併/浮水印/加密
│   │   ├── doc_converter.py        #   Word/PDF/Markdown 互轉
│   │   ├── gif_creator.py          #   GIF 動畫製作
│   │   ├── video_processor.py      #   影片合併/壓縮/轉GIF
│   │   └── batch_renamer.py        #   批次改名邏輯
│   │
│   ├── models/                     # 資料庫模型
│   └── config.py                   # 環境變數設定
│
├── static/
│   ├── index.html                  # HTML Shell（導航 + 7 個工具頁面）
│   ├── css/common.css              # 共用樣式
│   └── js/                         # 8 個 JS 模組
│       ├── app.js                  #   導航管理
│       ├── scanmail.js             #   掃描郵寄
│       ├── image-tools.js          #   圖片工具
│       ├── pdf-tools.js            #   PDF 工具
│       ├── doc-convert.js          #   文件轉檔
│       ├── gif-tools.js            #   GIF 製作
│       ├── video-tools.js          #   影片工具
│       └── batch-rename.js         #   批次改名
│
├── deploy/                         # 部署設定
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── render.yaml
│
├── tests/                          # 測試
└── docs/                           # 文件
    ├── TODO.md
    └── ARCHITECTURE.md
```

---

## API 文件

啟動伺服器後，瀏覽自動產生的 API 文件：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### API 端點摘要（62 個）

| 群組 | 端點 | 數量 |
|------|------|------|
| 掃描郵寄 | `/api/upload`, `/api/scan/*`, `/api/pages/*`, `/api/analyze`, `/api/send`, `/api/contacts`, `/api/history`, `/api/stats`, `/api/settings` | 20 |
| 圖片工具 | `/api/tools/image/resize`, `convert`, `compress`, `watermark`, `info`, `batch/*` | 11 |
| PDF 工具 | `/api/tools/pdf/merge`, `watermark/text`, `watermark/image`, `protect`, `info` | 7 |
| 文件轉檔 | `/api/tools/convert/word-to-pdf`, `pdf-to-word`, `md-to-pdf`, `md-to-word`, `word-to-md` | 5 |
| GIF 製作 | `/api/tools/gif/create` | 3 |
| 影片工具 | `/api/tools/video/merge`, `to-gif`, `compress` | 5 |
| 批次改名 | `/api/tools/rename/preview`, `apply` | 4 |

---

## 開發

```bash
# 執行測試
python -m pytest tests/ -v

# 開發模式啟動（自動重載）
uvicorn main:app --reload

# 健康檢查
curl http://localhost:8000/health
```

---

## 授權

MIT License — DofLab Laboratory
