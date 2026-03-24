# ScanMail — 智慧掃描郵寄系統

**拍照 → AI辨識 → 自動寄信**，專為大學教職員設計的文件掃描郵寄工具。

用手機或電腦的攝影機拍攝文件（公文、考卷、收據等），AI 自動辨識文件類型、產生專業郵件標題與內容，一鍵附檔寄出。

---

## 功能特色

- **📷 拍照/上傳** — 支援手機相機、桌機 Webcam、或直接上傳圖檔
- **✨ 智慧掃描** — 自動偵測文件邊界、透視校正、去除陰影，產生清晰的掃描效果
- **🤖 AI 文件辨識** — 使用 Google Gemini Vision API 辨識 8 種文件類型（公文/考卷/收據/合約/報告/信函/表單/其他）
- **✉️ 自動郵件產生** — AI 根據文件內容自動產生專業的郵件標題、正文、附件檔名
- **📤 一鍵寄出** — SMTP 直接寄出，附件自動轉為 PDF 格式
- **👥 聯絡人管理** — 常用收件人快速選取
- **📊 歷史紀錄** — 查看過去的寄送記錄與統計

## 技術架構

```
┌──────────────────────────────────────────────────┐
│                  前端 (SPA)                        │
│   HTML/CSS/JS · getUserMedia · Responsive UI      │
├──────────────────────────────────────────────────┤
│                FastAPI 後端                        │
│   REST API · Session 管理 · 靜態檔案伺服          │
├──────────────┬───────────┬───────────────────────┤
│  Gemini      │  OpenCV   │     aiosmtplib        │
│  Vision API  │  掃描處理  │     SMTP 寄送          │
├──────────────┴───────────┴───────────────────────┤
│              SQLite 資料庫                         │
│   contacts · send_history · sender_profiles       │
└──────────────────────────────────────────────────┘
```

## 快速開始

### 1. 安裝相依套件

```bash
cd scanmail_bot
pip install -r requirements.txt
```

### 2. 設定環境變數

複製 `.env.template` 為 `.env`，填入必要設定：

```bash
cp .env.template .env
```

必須設定的項目：
- `GEMINI_API_KEY` — Google Gemini API 金鑰（[取得金鑰](https://aistudio.google.com/app/apikey)）
- `SMTP_HOST` / `SMTP_PORT` — 郵件伺服器設定
- `SMTP_USER` / `SMTP_PASSWORD` — SMTP 認證資訊

### 3. 啟動服務

```bash
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

開啟瀏覽器前往 `http://localhost:8001`

## 使用流程

1. **拍照/上傳** — 用攝影機拍攝文件，或上傳現有圖片
2. **掃描處理** — 系統自動偵測文件邊界、校正透視、套用增強濾鏡（可切換 5 種濾鏡）
3. **選擇收件人** — 從聯絡人清單中選取，或新增收件人
4. **AI 辨識** — AI 自動辨識文件類型、產生郵件主旨/正文/檔名
5. **預覽確認** — 確認或編輯 AI 產生的內容
6. **寄出** — 一鍵寄出含 PDF 附件的郵件

## 專案結構

```
scanmail_bot/
├── main.py                      # FastAPI 主程式（API endpoints）
├── static/
│   └── index.html               # 前端 SPA（單頁應用）
├── app/
│   ├── config.py                # 環境變數與設定管理
│   ├── database.py              # SQLite 資料庫初始化
│   ├── models/
│   │   ├── contact.py           # 聯絡人 CRUD
│   │   ├── history.py           # 寄送歷史記錄
│   │   ├── sender.py            # 寄件人設定檔
│   │   └── session.py           # Session 狀態機
│   ├── services/
│   │   ├── ai_analyzer.py       # Gemini Vision AI 文件辨識
│   │   ├── doc_scanner.py       # OpenCV 文件掃描後處理
│   │   ├── email_sender.py      # SMTP 郵件寄送（多策略）
│   │   └── image_processor.py   # 圖片處理與 PDF 轉換
│   └── utils/
│       ├── crypto.py            # 加密工具
│       └── validators.py        # 輸入驗證
├── deploy/                      # 部署設定（Docker/Render/Railway）
├── scripts/                     # 工具腳本
├── tests/                       # 單元測試
├── .env.template                # 環境變數範本
└── requirements.txt             # Python 相依套件
```

## API Endpoints

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/upload` | 上傳圖片 |
| POST | `/api/scan/detect` | 偵測文件邊界 |
| POST | `/api/scan/process` | 完整掃描處理（邊界校正+濾鏡） |
| POST | `/api/scan/filter` | 切換濾鏡 |
| POST | `/api/analyze` | AI 文件辨識 |
| POST | `/api/send` | 寄送郵件 |
| GET/POST | `/api/contacts` | 聯絡人管理 |
| GET | `/api/history` | 寄送歷史 |
| GET | `/api/stats` | 統計資料 |
| GET/POST | `/api/settings` | 寄件人設定 |

## 環境需求

- Python 3.10+
- 現代瀏覽器（支援 getUserMedia API）
- Google Gemini API 金鑰
- SMTP 郵件伺服器

## 相依套件

| 套件 | 用途 |
|------|------|
| FastAPI | Web 框架 |
| uvicorn | ASGI 伺服器 |
| google-genai | Gemini Vision API |
| opencv-python-headless | 文件掃描後處理（邊界偵測/透視校正） |
| numpy | 影像處理運算 |
| Pillow | 圖片處理 |
| img2pdf | 圖片轉 PDF |
| aiosmtplib | 非同步 SMTP 寄送 |
| pydantic-settings | 環境變數管理 |

## 開發者

劉瑞弘 — 國立勤益科技大學 智慧自動化工程系

## 授權

本專案由國立勤益科技大學智慧自動化工程系開發，僅供教學與內部使用。
