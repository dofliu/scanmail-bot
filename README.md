# ScanMail Bot 📧

**智慧掃描郵寄 LINE Bot** — 拍照、辨識、一鍵寄出專業郵件

## 功能特色

- 📷 手機拍照掃描文件（利用 LINE 內建相機）
- 🤖 AI 自動辨識文件內容、類型（Claude Vision API）
- 📝 自動產生有意義的郵件標題、正文摘要、檔案名稱
- 📧 透過 Flex Message 預覽確認後，以 SMTP 寄出專業郵件

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | LINE Messaging API (Flex Message, Quick Reply) |
| 後端 | Python FastAPI |
| AI 引擎 | Claude Vision API |
| 資料庫 | SQLite |
| 郵件 | aiosmtplib |

## 快速開始

### 1. 安裝相依套件

\`\`\`bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
\`\`\`

### 2. 設定環境變數

\`\`\`bash
cp .env.template .env
# 編輯 .env 填入 API keys
\`\`\`

### 3. 啟動伺服器

\`\`\`bash
uvicorn main:app --reload --port 8000
\`\`\`

### 4. 設定 LINE Webhook

使用 ngrok 進行本地測試：

\`\`\`bash
ngrok http 8000
\`\`\`

將 ngrok URL 設定為 LINE Bot 的 Webhook URL：\`https://xxxx.ngrok.io/webhook\`

## 專案結構

\`\`\`
scanmail_bot/
├── main.py                 # FastAPI 主程式入口
├── requirements.txt
├── .env.template
├── app/
│   ├── config.py           # 環境變數管理
│   ├── database.py         # SQLite 連線
│   ├── models/             # 資料模型 (CRUD)
│   ├── services/           # 核心服務
│   ├── handlers/           # LINE 事件處理
│   └── utils/              # 工具函式
├── tests/                  # 測試
├── scripts/                # 管理腳本
└── deploy/                 # 部署設定
\`\`\`

## 開發者

劉瑞弘 — 國立勤益科技大學 智慧自動化工程系

## 授權

MIT License
