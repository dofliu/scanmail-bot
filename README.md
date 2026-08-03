# ScanMail+ — 智慧文件處理平台

**掃描郵寄 + 多媒體工具箱**，將 ScanMail Bot 與 MediaToolkit (myPicasa) 整合為統一的 Web 平台。

由國立勤益科技大學 DofLab 實驗室開發。

### 文件

| 文件 | 內容 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系統架構、模組分工、資料流（含裝置端引擎） |
| [docs/ANDROID.md](docs/ANDROID.md) | **App 製作流程**：建置、取得 APK、離線版功能詳解、簽章、疑難排解 |
| [docs/TODO.md](docs/TODO.md) | 開發歷程（Phase 1–17）、**後續工作**、變更日誌 |
| [docs/DAILY_ROUTINE.md](docs/DAILY_ROUTINE.md) | **每日自動開發**：每天 03:00 的排程怎麼選題、測試、收尾 |
| [docs/ROUTINE_LOG.md](docs/ROUTINE_LOG.md) | 每次自動執行的紀錄（做了什麼、下一步） |
| [docs/AUTO_FORM_FILL.md](docs/AUTO_FORM_FILL.md) | 表單自動填寫的分層設計 |
| [docs/PADDLEOCR_INTEGRATION.md](docs/PADDLEOCR_INTEGRATION.md) | 離線 OCR backend 整合 |

---

## 功能總覽

### 📨 掃描郵寄（核心功能）

| 功能 | 說明 |
|------|------|
| 拍照 / 上傳 | 手機相機、桌機 Webcam、或直接上傳圖檔（自動 EXIF 方向轉正） |
| 文件掃描處理 | OpenCV 自動邊界偵測（v5：逐邊證據評分 + 次像素角點精修）+ 透視校正（真實寬高比恢復）+ 7 種濾鏡 |
| 偵測信心值 | 低信心自動判斷不裁切，改為提示使用者手動調整角點 |
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
| PDF → Markdown | pymupdf 文字提取 → Markdown |

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
  -v $(pwd)/data:/app/data \
  scanmail-plus
```

或 Docker Compose：

```bash
cd deploy && docker-compose up -d
```

---

## 📱 Android App

同一份前端（`static/`），可以同時在電腦瀏覽器跑，也可以打包成手機 App。
後端仍然在電腦或伺服器上執行 —— OpenCV、Gemini、SMTP 這些跑不進手機裡，
App 是後端的前端。

```bash
# 第一次：安裝 Node 相依套件
cd mobile && npm install && cd ..

# 打包成 APK（後端位址直接內建）
python scripts/build_mobile.py --api-base http://192.168.1.50:8000 --sync
cd mobile/android && ./gradlew assembleDebug
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

不指定 `--api-base` 的話，App 第一次開啟會請使用者輸入伺服器位址，
之後可在「設定 → 伺服器連線」隨時更換。

**開發時電腦與手機同步**：讓 App 直接載入電腦上的 dev server，改完存檔兩邊都是新的：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
python scripts/build_mobile.py --dev-server http://192.168.1.50:8000 --sync
cd mobile/android && ./gradlew installDebug
```

**離線精簡版**：不需要後端、完全在手機上跑的媒體工具：

```bash
python scripts/build_mobile.py --offline --sync
cd mobile/android && ./gradlew assembleDebug
```

介面分四頁：**編輯**、**圖片**、**文件**、**頁面**，全部在裝置上處理，檔案不會離開手機。

> 以下是重點摘要。每個功能的完整說明、實作取捨與已知限制見 **[docs/ANDROID.md](docs/ANDROID.md)**。

編輯頁的畫面上永遠只有畫布和一條工具列 —— 所有選項收在底部並依情境自動切換：
沒選圖時是版面（2×2 / 2×3 / 3×3…）、圖框（圓角 / 白框 / 陰影 / 拍立得）、間距；
點畫布上任一張圖就換成旋轉 / 翻轉 / 裁切 / 大小，按「完成」再切回來。
細調項目才從下方推出面板，關掉立刻恢復滿版。

**拼貼是直接用手調的**：點一張圖選起來之後，

* **單指拖曳** 移動它在格子裡的位置 —— 格狀版面會把圖裁切填滿，拖曳決定要露出哪一塊
* **兩指捏合** 縮放
* **⇄ 交換** 之後點另一張，兩張的位置對調，用來排順序

點選與拖曳共用同一塊畫布，所以靠位移門檻分辨：手指按下去多少會晃一下，沒有門檻的話
每次點選都會順便把圖推歪。而且只有拖「已經選中的那張」才算移動 —— 不然點旁邊的圖
會把它撞位。

取景存的是**相對值**（縮放倍率 + 0–1 的對焦點），所以在縮圖上調完，原圖匯出是一樣的構圖。
對焦點會夾在「實際可動」的範圍內，拖到底就停住，不會累積一段拖了卻不動的空行程。

沒動過取景的圖走的還是原本那條繪製路徑，一個像素都不會變。

對焦點記的是「原圖上的哪一點」，所以旋轉 / 翻面時它要跟著轉（`rotateFit` / `flipFit`），
否則構圖會在按下旋轉的瞬間跳到別的地方 —— 用的是跟裁切框（`rotateRect`）同一套座標映射，
兩者不一致的話轉完會各自落在不同位置。拉正是整張重新映射，舊的對焦點沒有意義，
跟裁切框一起歸零。

**拉正**（邊界偵測 + 透視校正）：拍桌上的紙，點「拉正」就自動抓出四個角、
把斜拍的梯形拉回矩形。抓得不對可以自己拖，抓不到就明講「沒把握」請你確認 ——
**亂裁一通比不裁更糟**，使用者不會發現。

這一塊本來只長在後端的 OpenCV 裡。搬進裝置時只留一條路 —— **梯度導向的 Hough
直線偵測**：文件的邊本來就是直線，而且直線由整條邊投票決定，所以**角被手指擋住也
不影響**。評分整套照搬後端 v5（那是 22 個案例的基準測試磨出來的）。

校正走 WebGL（canvas 2D 做不到投影變換），輸出尺寸用 Zhang–He 法反推真實寬高比，
不然斜拍的 A4 會被拉扁。拉正是破壞性的，所以留了「還原原圖」。

**裁切是自由拖拉的**：點「裁切」進到獨立畫面，四角拖框、框內拖移、三分線輔助，
也可以鎖 1:1 / 4:3 / 16:9 等比例。裁切在旋轉「之後」才套用，所以拉的框就是看到的畫面；
轉圖時框會跟著轉，不會飄掉。

**打碼**（馬賽克 / 模糊 / 塗黑）：在要遮的地方拖框，畫面上直接顯示遮完的樣子 ——
遮得夠不夠一眼就知道，不用存檔出來才發現還看得到。三種都是直接改像素，
不是蓋一層可以移除的東西。分享文件截圖前遮個資，本來就不該把圖傳上網才做得到。

**調整**：八組濾鏡預設（含「紙本」—— 把泛黃的紙拉成乾淨黑白，拍紙本文件很好用），
加上亮度 / 對比 / 飽和的細調。走的是瀏覽器的 GPU 濾鏡，拉滑桿即時反應。

**文字 / 浮水印**：疊字上去，位置用九宮格挑；打開「平鋪」就變成蓋滿整張的浮水印，
角度與濃度可調。字型用系統的，中文不用額外成本（不像 PDF 得把字型嵌進檔案）。

**簽名 / 印章**：用手指簽一次存起來，之後在圖片或 PDF 上拖到定位就好 ——
不必「印出來 → 簽名 → 再掃一次」。也可以拍一張紙上的簽名或關防匯入，白底會自動去掉
（紅色關防選「保留原色」，太淡的原子筆選「轉成墨色」）。

手寫的簽名存的是**筆畫的點而不是像素**，所以蓋進 PDF 輸出的是向量路徑 ——
放大不糊、列印跟原生文件一樣銳利，一枚只佔幾 KB。匯入的圖片印章走 SMask 軟遮罩，
中間是真的透明，蓋在文字上不會把字糊掉。

> 這是「蓋一張圖上去」，**不是 PKI 意義上的數位簽章**，不具法律效力。

圖片頁把縮放、壓縮、轉檔併成一次處理，只重新編碼一遍，也可以**把多張直接合併成一份 PDF**。

文件頁做 PDF / Word / Markdown 的互轉，同樣不連後端：

| 讀得進來 | 產得出去 |
| --- | --- |
| PDF、Word（.docx）、Markdown、純文字 | PDF、Word、Markdown、純文字、HTML |
| PDF | 圖片（每頁一張，可挑 100 / 150 / 300 dpi） |

> 圖片編輯與打碼都在裝置上完成，而且 Canvas 重新編碼本來就會丟掉 EXIF ——
> 輸出的圖片不含 GPS 座標與拍攝時間。

中間隔一層共用的文件模型，所以是「任意組合」而不是寫死的每一對轉換；
標題階層、項目符號、編號清單、表格、引用、程式碼區塊都會保留。
選好檔案就先看到解析後的排版預覽，確認沒讀歪再按轉換。

三件實作上比較麻煩、值得知道的事：

* **PDF 輸出的中文**：PDF 一定要把字型嵌進檔案，收檔案的人才看得到字。
  App 內建一份裁過的 Noto Sans TC（Big5 全字集，4.6 MB，OFL 授權），
  輸出時再依這份文件實際用到的字裁第二次 —— 所以產出的 PDF 通常只有幾十 KB，
  而且附了 ToUnicode 對照表，文字可以複製、可以搜尋。
* **PDF 讀取**：PDF 裡沒有「段落」這種東西，只有一堆帶座標的文字片段。
  靠字級（比內文大就是標題）、行距（跳太多就是新段落）、行首符號還原結構。
  掃描出來的圖片型 PDF 抽不到文字，會明確告訴你需要 OCR，而不是給一份空白檔。
* **DOCX**：是一包 zip 裝 XML，用瀏覽器內建的 `CompressionStream` 自己拆包打包，
  不必引入額外的函式庫。
* **照片轉 PDF 不掉畫質**：PDF 的 `/DCTDecode` 濾鏡吃的就是 JPEG 原始位元組，
  所以手機拍的照片是「原樣」放進 PDF —— 不解碼、不重新編碼。只有格式不合
  （漸進式 JPEG、CMYK、PNG）或要縮小時才重壓一次。PDF 檢視器不看 Exif，
  方向改用變換矩陣處理，照片本身還是原封不動。

頁面頁做 PDF 的**合併、刪頁、抽頁、重排、轉向**，同樣不連後端：

丟幾份 PDF 進去，所有頁面併成一張縮圖總表；點某一頁就換成該頁的操作
（左轉 / 右轉 / 簽名 / 前移 / 後移 / 刪除），排好按輸出。蓋過章的頁面在總表上標了 ✍，
三十頁的文件也找得到簽在哪。

**簽名蓋在哪裡就是哪裡**，這件事比看起來麻煩：PDF 的 `/Rotate` 是交給檢視器轉的，
內容串流裡的座標不會跟著轉。使用者在轉過向的頁面上點右下角，直接寫進去很可能蓋到左上角。
所以蓋章的內容前面會先套一層「畫面座標 → PDF 座標」的變換矩陣，四個方向各一組，
另外處理 MediaBox 原點不在 (0,0) 的檔案。測試的驗法是把蓋完的頁面畫出來數墨點 ——
矩陣寫錯的話墨會出現在別的象限，逃不掉。

原本的內容會先包進 `q…Q` 再接簽名，因為它可能留下改過的座標系或顏色；
頁面的 `/Resources` 常被好幾頁共用，所以一律複製一份再改，不會蓋了一頁卻改到別頁。

除了簽名以外，這些操作都是**無損**的 —— 頁面連同它參照到的字型、圖片整包搬過去，內容串流原封不動，
所以文字還是文字、圖還是原本那張圖，不是重畫成點陣圖再貼回去。做法是自己寫了一層
PDF 物件解析器（`static/js/pdf-lite.js`）：讀 xref（傳統表與 PDF 1.5 之後的串流都認）、
展開物件串流、走頁面樹、把選中的頁面連同相依物件重新編號寫出。

真實世界的 PDF 常常有點壞，所以還留了幾條退路：xref 讀不動就退回全檔掃描、
增量更新沿著 `/Prev` 往回走、屬性寫在父節點上會沿著頁面樹繼承下來、
加密的檔案直接明講不能編輯而不是給出壞掉的輸出。

推上 GitHub 後，`.github/workflows/android.yml` 會自動建置兩份 debug APK
（完整版與離線精簡版）放到 workflow 的 Artifacts；
打 `android-v*` 標籤則會產出（可簽章的）release APK。

> 完整說明、簽章上架、CORS 與疑難排解請見 **[docs/ANDROID.md](docs/ANDROID.md)**。

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
│      前端 SPA (HTML/CSS/JS) — 網頁版 & Android App     │
│   工具導航列 · 7 個工具頁面 · 手機/桌面雙介面           │
├──────────────────────────────────────────────────────┤
│              FastAPI 後端 (Python)                     │
│   9 個路由模組 · 12 個服務模組 · SSE 即時進度           │
├───────────┬──────────┬──────────┬────────────────────┤
│ Gemini    │ OpenCV   │ Pillow   │ moviepy / pypdf    │
│ Vision AI │ 掃描處理  │ 圖片處理  │ 影片 / PDF 處理     │
├───────────┴──────────┴──────────┴────────────────────┤
│              SQLite 資料庫 (9 張表)                     │
│  contacts · contact_groups · group_members             │
│  email_templates · form_templates · send_history       │
│  user_sessions · sender_profiles · users               │
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
│   │   ├── file_manager.py         #   暫存檔管理 + 路徑穿越防禦
│   │   ├── auth.py                 #   登入 / JWT
│   │   └── rate_limiter.py         #   API 速率限制
│   │
│   ├── routers/                    # API 路由（9 個模組）
│   │   ├── scanmail.py             #   掃描郵寄 + 批次寄送 + 群組 + 模板
│   │   ├── image_tools.py          #   圖片批次處理
│   │   ├── pdf_tools.py            #   PDF 合併/浮水印/加密
│   │   ├── doc_convert.py          #   文件格式轉換
│   │   ├── gif_tools.py            #   GIF 動畫製作
│   │   ├── video_tools.py          #   影片合併/壓縮/轉GIF
│   │   ├── batch_rename.py         #   批次改名
│   │   ├── form_tools.py           #   表單自動填寫（Beta）
│   │   └── auth.py                 #   登入 / 使用者
│   │
│   ├── services/                   # 業務邏輯（12 個模組）
│   │   ├── doc_scanner.py          #   邊界偵測 v5（逐邊評分/次像素精修/寬高比恢復）/透視校正/濾鏡
│   │   ├── image_processor.py      #   圖片驗證/PDF 轉換
│   │   ├── ai_analyzer.py          #   Gemini AI 辨識
│   │   ├── ai_renamer.py           #   AI 輔助批次改名
│   │   ├── email_sender.py         #   SMTP 寄送
│   │   ├── image_batch.py          #   圖片批次處理引擎
│   │   ├── pdf_processor.py        #   PDF 處理引擎
│   │   ├── doc_converter.py        #   文件轉檔引擎
│   │   ├── gif_creator.py          #   GIF 製作引擎
│   │   ├── video_processor.py      #   影片處理引擎
│   │   ├── batch_renamer.py        #   改名引擎
│   │   ├── flex_builder.py         #   表單填寫的版面 flex 排版
│   │   ├── form_fill/              #   表單自動填寫：dispatcher + 4 backend
│   │   │   │                       #   （acroform / pdfplumber / paddle / gemini）
│   │   │   ├── dispatcher.py
│   │   │   ├── filler.py · matcher.py · schema.py · semantic_mapper.py
│   │   │   └── backends/
│   │   └── common/                 #   共用工具（json_parsing.py 等）
│   │
│   ├── models/                     # 資料庫模型（8 個）
│   │   ├── contact.py              #   聯絡人 CRUD
│   │   ├── group.py                #   收件人群組
│   │   ├── template.py             #   郵件模板
│   │   ├── history.py              #   寄件歷史
│   │   ├── sender.py               #   寄件人設定
│   │   ├── form_template.py        #   表單填寫模板
│   │   ├── session.py              #   工作階段
│   │   └── user.py                 #   使用者帳號
│   │
│   └── config.py                   # 環境變數設定
│
├── static/                         # 前端唯一來源（網頁版與 App 共用）
│   ├── index.html                  #   HTML Shell
│   ├── css/                        #   共用樣式
│   ├── vendor/fonts/               #   PDF 內嵌用的中文字型子集（OFL）
│   └── js/
│       ├── config.js               #   執行環境設定（決定 API 位址 / 離線模式）
│       ├── native.js               #   App 專用：存檔/分享、原生儲存、伺服器設定畫面
│       ├── image-local.js          #   本地圖片引擎（Canvas，離線版靠它）
│       ├── doc-local.js            #   本地文件轉檔（PDF/Word/Markdown 互轉）
│       ├── zip-lite.js             #   ZIP 讀寫（DOCX 拆包/打包）
│       ├── ttf-lite.js             #   TrueType 解析與子集化（PDF 內嵌字型）
│       ├── pdf-write.js            #   PDF 產生器（含中文 CID 字型）
│       ├── pdf-lite.js             #   PDF 物件解析器（合併/刪頁/重排，無損）
│       ├── studio.jsx              #   離線版介面（編輯 / 圖片 / 文件 / 頁面）
│       ├── api.js                  #   API 層
│       ├── store.js                #   狀態管理
│       └── *.jsx                   #   atoms / mobile / desktop / boot
│
├── mobile/                         # Android App（Capacitor 外殼）
│   ├── capacitor.config.js         #   App 設定（含 dev server 模式）
│   ├── src/bridge.js               #   Capacitor 外掛橋接
│   ├── android/                    #   Android 原生專案
│   └── www/                        #   建置產物（不進版控）
│
├── scripts/
│   ├── build_mobile.py             # static/ → App 前端
│   ├── make_pdf_font.py            # 產生 PDF 內嵌用的中文字型子集
│   ├── gen_logo.py                 # App 標誌（唯一來源）
│   └── gen_android_icons.py        # 標誌 → Android 圖示與啟動畫面
│
├── deploy/                         # Dockerfile / docker-compose / render.yaml
├── tests/                          # pytest 測試
└── docs/                           # 開發文件（含 ANDROID.md）
```

---

## API 文件

啟動後瀏覽自動產生的互動式文件：

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### API 端點總覽（91 個）

| 群組 | 主要端點 | 數量 |
|------|------|------|
| 掃描流程 | `/api/upload`, `/api/scan/*`（v5：回傳 `confidence`/`method`）, `/api/pages/*`, `/api/analyze` | 12 |
| 寄送 | `/api/send`, `/api/send/batch` | 2 |
| 收件人群組 | `/api/groups`, `/api/groups/{id}`, `/api/groups/{id}/members` | 5 |
| 郵件模板 | `/api/templates`, `/api/templates/{doc_type}`, `/api/templates/{id}` | 5 |
| 聯絡人/歷史/設定 | `/api/contacts`, `/api/history`, `/api/stats`, `/api/settings` | 7 |
| 使用者認證 | `/api/auth/register`, `login`, `logout`, `status` | 4 |
| 圖片工具 | `/api/tools/image/resize`, `convert`, `compress`, `rotate`, `flip`, `watermark`, `info`, `merge`, `batch/*`, `task/*` | 15 |
| PDF 工具 | `/api/tools/pdf/merge`, `split`, `compress`, `to-images`, `watermark/*`, `protect`, `info`, `task/*` | 10 |
| 文件轉檔 | `/api/tools/convert/word-to-pdf`, `pdf-to-word`, `md-to-pdf`, `md-to-word`, `word-to-md`, `pdf-to-md` | 6 |
| GIF 製作 | `/api/tools/gif/create`, `task/*` | 3 |
| 影片工具 | `/api/tools/video/merge`, `to-gif`, `compress`, `task/*` | 5 |
| 批次改名 | `/api/tools/rename/preview`, `apply`, `ai/*`, `task/*` | 6 |
| 表單填寫 | `/api/tools/form/detect`, `suggest`, `fill`, `templates/*`, `task/*` | 11 |

---

## 開發

```bash
# 後端與打包流程的測試
python -m pytest tests/ -v

# 裝置端引擎的測試（Canvas / zip / PDF 只有真的瀏覽器驗得出來）
cd mobile && npm ci && npx playwright install chromium
npm run test:image     # 圖片引擎
npm run test:doc       # 文件轉檔：產出真的 PDF / DOCX 再讀回來比對
npm run test:pages     # PDF 頁面操作（pip install pikepdf 可多一層 qpdf 結構檢查）
npm run test:sign      # 簽名蓋章：把頁面畫出來數墨點，確認落在該落的位置
npm run test:scan      # 邊界偵測：合成有標準答案的影像，量角點誤差
npm run test:studio    # 離線版介面（需要先跑過 build_mobile.py --offline）

# 開發模式啟動
uvicorn main:app --reload

# 健康檢查
curl http://localhost:8000/health
```

---

## 安全性說明

> 部署前請務必閱讀。

- **身分驗證**：目前以 `X-User-Id` header 識別使用者，**未經驗證、可被偽造**。
  本平台僅適合**內網或單人使用**，請勿在未加驗證層（反向代理 / VPN / 登入）的情況下對公網開放。
- **加密金鑰**：SMTP 密碼以 `ENCRYPTION_KEY` 加密儲存。預設值是公開的，**正式部署務必在 `.env` 設定獨立金鑰**，
  否則等同未加密（啟動時會出現警告）。
- **CORS**：預設 `ALLOWED_ORIGINS=*`（全開）。對外部署時請在 `.env` 收斂為實際網域（逗號分隔）。

## 授權

MIT License — DofLab Laboratory, 國立勤益科技大學
