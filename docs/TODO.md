# ScanMail+ 開發規劃與 TODO

> 最後更新：2026/07/30
>
> 這份檔案的「後續工作」是**每日自動開發的選題來源** ——
> 每天 03:00 排程會從那裡挑一項來做，規則見 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)、
> 每次執行的紀錄在 [ROUTINE_LOG.md](ROUTINE_LOG.md)。
> 所以那一段要維持「排好序、寫明為什麼還沒做」的狀態，它會被當成待辦佇列讀。

---

## 已完成功能 ✅

### Phase 1：核心掃描郵寄

- [x] FastAPI 後端 REST API 架構
- [x] 前端 SPA 單頁應用（4 步驟 wizard：拍照→選收件人→預覽→寄送）
- [x] 手機/桌機攝影機即時預覽（getUserMedia API）
- [x] Google Gemini Vision API 整合（8 種文件類型辨識）
- [x] AI 自動產生郵件主旨、正文、附件檔名
- [x] 圖片轉 PDF（A4 適配）+ 多頁 PDF
- [x] SMTP 郵件寄送（多策略自動嘗試：587/25/465，STARTTLS/SSL/Plain）
- [x] 聯絡人 CRUD（使用頻率排序）
- [x] 寄送歷史紀錄與統計
- [x] 寄件人設定（姓名/職稱/單位/組織）
- [x] SQLite 資料庫

### Phase 2：掃描後處理

- [x] OpenCV 文件邊界偵測 v3（5 種策略並行 + 評分選最佳）
  - Canny 多閾值、白色區域（排除膚色）、Otsu 自適應、Laplacian 銳利邊緣、GrabCut
  - 反貼邊規則：拒絕 3 條邊以上貼圖片邊緣的輪廓
  - 評分公式：面積適中度 35% + 矩形度 25% + 離邊距離 25% + 紙張寬高比 15%
- [x] 透視校正（四點變換 + LANCZOS4 插值 + 失真補償）
- [x] 7 種掃描濾鏡（自動/專業掃描/彩色公文/文件/增強/黑白/原圖）
  - 形態學背景估計、光照正規化、灰色世界白平衡、保色白化
- [x] Canvas 角點拖曳編輯器（可視化邊界框 + 半透明遮罩 + 拖曳角點）
- [x] 圖片旋轉（90°/180°/270°）
- [x] 多頁掃描（連續拍攝、拖曳排序、刪除個別頁面、頁面縮圖預覽）

### Phase 3：平台架構重構

- [x] main.py 精簡為 App Factory（~80 行）
- [x] 路由模組化（app/routers/ — 7 個路由模組）
- [x] 共用基礎設施（core/sessions、core/file_manager、core/tasks）
- [x] CSS/JS 從 index.html 分離到獨立檔案
- [x] 工具導航系統（頂部 7 個工具 tab）
- [x] 背景任務管理器（ThreadPoolExecutor + SSE 即時進度推送）

### Phase 4：圖片工具（整合自 myPicasa）

- [x] 批次縮放（fit 等比白底 / cover 裁切填滿 / stretch 強制拉伸）
- [x] 格式轉換（JPG/PNG/WebP/BMP/GIF 互轉）
- [x] 批次壓縮（品質控制 1-100 + 最大邊長限制）
- [x] 文字浮水印（中央/平鋪/四角位置、透明度、字體大小、顏色）
- [x] 圖片資訊查看
- [x] 拖放上傳 + 單檔直接回傳 / 批次背景任務 + ZIP 下載

### Phase 5：PDF 工具 + 文件轉檔（整合自 myPicasa）

- [x] PDF 合併（多檔合併 + 自動書籤目錄）
- [x] PDF 文字浮水印（平鋪、透明度、旋轉角度、顏色）
- [x] PDF 圖片浮水印（縮放比例、透明度、位置）
- [x] PDF 密碼保護
- [x] PDF 資訊查看（頁數/標題/作者/加密狀態）
- [x] Word → PDF（python-docx + ReportLab，支援中文字型）
- [x] PDF → Word（pymupdf 文字提取）
- [x] Markdown → PDF / Word（markdown + BeautifulSoup + ReportLab）
- [x] Word → Markdown（python-docx 樣式解析）
- [x] PDF → Markdown（pymupdf 文字提取）

### Phase 6：GIF + 影片工具（整合自 myPicasa）

- [x] 圖片序列 → 動畫 GIF（自訂幀率/尺寸/縮放模式）
- [x] 影片合併（moviepy + libx264 + AAC，支援 MP4/AVI/MOV/MKV/WebM/FLV）
- [x] 影片轉 GIF（FPS/寬度/起止時間截取）
- [x] 影片壓縮（解析度降低 720p/480p/360p + CRF 品質控制）

### Phase 7：批次改名（整合自 myPicasa）

- [x] 前綴/後綴添加
- [x] 搜尋取代
- [x] 流水編號（位數/起始值/位置）
- [x] 即時預覽改名結果（debounced 300ms）
- [x] 套用後打包 ZIP 下載

### Phase 8：進階郵寄功能

- [x] 批次寄送 — 勾選多位收件人，同一份文件一次寄出
- [x] 收件人群組 — 建立常用群組（如：系務會議成員），一鍵全選
- [x] 郵件模板 — 8 種文件類型各有預設模板，支援 `{summary}` `{doc_type}` 變數
- [x] 自訂模板 CRUD — 覆蓋預設模板

### Phase 9：Auto Form Fill 表單自動填寫（M1 Skeleton）

> 詳細設計：[docs/AUTO_FORM_FILL.md](AUTO_FORM_FILL.md) · 測試結果：[docs/AUTO_FORM_FILL_TEST_RESULTS.md](AUTO_FORM_FILL_TEST_RESULTS.md)

- [x] **分層架構**：dispatcher + 4 backend（acroform / pdfplumber / paddle / gemini）
- [x] **Layer 1 — AcroForm**：pypdf 偵測 + 寫回，支援 CJK（auto_regenerate）
- [x] **Layer 2 — pdfplumber**：「Label:____」啟發式 + 多字 chunk 拼接 + dedup + CJK 寫入
- [x] **Layer 4 — Gemini Vision**：normalized 0~1000 → PDF points 換算（單測通過，真實 API 未測）
- [x] **邊界**：`normalize_to_pdf()` 統一影像 → PDF；FormField.bbox 一律 PDF points
- [x] **Semantic Mapping**：rule-based 對應 sender_profile / contact / today
- [x] **API 路由**：`/api/tools/form/{detect,suggest,fill,task/...}`
- [x] **前端**：desktop + mobile 工具箱「📝 表單填寫 (Beta)」
- [x] **共用工具**：`app/services/common/json_parsing.py`（順便重構 ai_analyzer）
- [x] **安全**：`get_temp_path` 路徑穿越防禦（_SAFE_FILENAME regex + relative_to）
- [x] **測試**：14 pytest cases + manual demo + 4 fixture forms
- [x] **M4.5 — Layer 2 表格擴充**：`page.find_tables()` 偵測 cell-based 表單（label cell + 相鄰空白 cell）
- [x] **M4.6 — Layer 2→4 Auto Fallback**：Layer 2 偵測 0 欄位時自動轉影像走 Gemini

### Phase 10：文件邊界偵測 v5（產品級掃描品質）

> PR: [#21](https://github.com/dofliu/scanmail-bot/pull/21) · 22 案例 ground-truth 基準測試：良好偵測 15/22 → 22/22，平均 IoU 0.908 → 0.997，角點誤差中位數 18.2px → 0.6px，單張延遲 11.5s → 0.9s

- [x] **評分系統重寫**：矩形度 → 凸性（不再懲罰透視梯形）；逐邊梯度支持度 + 最弱邊乘法門控（淘汰貼邊/漸層假邊）
- [x] **效能優化**：灰階/Sobel 特徵每張圖只算一次；HED/GrabCut 等昂貴策略延遲到便宜策略信心不足時才啟動
- [x] **次像素角點精修**：原始解析度下沿邊緣法線方向拋物線內插 + Huber 穩健直線擬合
- [x] **真實寬高比恢復**：Zhang–He whiteboard 法從透視幾何反推文件物理寬高比，校正輸出不再拉伸變形
- [x] **偵測信心值 API 化**：`detect_document()` 回傳 `{corners, confidence, method}`；信心 < 0.45 不自動裁切，前端顯示提示改為手動調整
- [x] **EXIF 方向正規化**：上傳時轉正手機直拍照片，避免前後端座標系不一致
- [x] **模型下載失敗快取**：HED/U-Net 模型無法下載時進入 1 小時冷卻，不再每次掃描請求都重試
- [x] 新增 `tests/test_doc_scanner_v5.py`：20 個回歸測試（精度、誤報抑制、寬高比恢復、EXIF、API 契約）

### Phase 11：Android App（同一份前端，兩個平台）

- [x] Capacitor 外殼（`mobile/`），Android 原生專案進版控
- [x] `scripts/build_mobile.py`：`static/` → `mobile/www/`（唯一的前端來源不變）
  - CDN 資源（React / pdf.js / 字型）改為打包進 App，離線也開得起來
  - esbuild 預先編譯 JSX，App 內不再載入 3MB Babel standalone
  - 注入 `window.SM_NATIVE`，並檢查改寫後沒有殘留外部連結
- [x] 執行環境設定層 `static/js/config.js`：網頁版同源、App 版用絕對位址
- [x] App 內伺服器設定畫面（首次啟動 / 連線失敗 / 設定頁皆可進入，含連線測試）
- [x] 原生檔案儲存 `static/js/native.js`（WebView 不支援 blob: 下載）
- [x] SSE 支援 `?token=`（EventSource 無法自訂 header，跨來源也拿不到 cookie）
- [x] `scripts/gen_android_icons.py`：從 `static/icon-512.png` 產生啟動圖示與啟動畫面
- [x] CI 自動建置 APK（`.github/workflows/android.yml`，支援簽章）
- [x] 18 個防呆測試（`tests/test_mobile_build.py`）

### Phase 12：離線精簡版（不需要後端的圖片工具）

- [x] `static/js/image-local.js`：純 Canvas 圖片引擎
  - 縮放（fit / cover / stretch）、格式轉換、壓縮、拼接（直向 / 橫向 / 九宮格）、旋轉、翻轉
  - 版面與縮放語意對齊後端 `image_batch.py`（含 fit 不放大、normalize 主軸對齊、grid 格子計算）
  - 逐次對半縮放再繪製，畫質接近後端的 LANCZOS
  - 明確拒絕 Canvas 編不出的 BMP / GIF（`toBlob` 會安靜地吐 PNG）
- [x] `build_mobile.py --offline`：注入 `SM_OFFLINE`，App 收斂成只有圖片工具
- [x] 離線版不呼叫任何後端 API（`store.init()` 直接返回、不顯示伺服器設定）
- [x] 批次結果改為逐檔列出 + 一次全存（App 內走系統分享，不打包 ZIP）
- [x] 35 個瀏覽器功能測試（`mobile/test/image-local.test.mjs`）＋ pytest 防呆測試
- [x] CI 另外建置並上傳 `scanmail-offline-apk`

---

### Phase 13：離線版介面重做（即時編輯）

- [x] `static/js/studio.jsx`：離線版自己的介面，只有「編輯 / 轉換」兩頁
  - 拿掉掃描寄信、導覽列、登入 —— 離線版就是一個裝置端媒體工具
- [x] 即時反應：旋轉 / 翻轉 / 縮放按一下就更新預覽，不再是「送出 → 等候 → 下載」
  - 預覽走縮圖（長邊 1400px）所以不卡，匯出才用原圖重算
- [x] 旋轉 / 翻轉併入拼接：單張就是單張編輯，多張自動變拼接
  - 可點畫布或縮圖選中任一張，只調整那一張
- [x] 縮放 + 壓縮 + 轉檔合成單一流程（本來就是同一次重新編碼）
- [x] `layoutBoxes()` 抽成唯一的版面來源，預覽與匯出共用，不會「看到的跟存出來的不一樣」
- [x] 新標誌 `scripts/gen_logo.py`：三張疊起來的媒體卡片，程式繪製、48px 仍可辨識
  - Android 圖示與啟動畫面改由標誌直接產生，不再從 PNG 裁中央
- [x] 19 個介面測試（`mobile/test/studio.test.mjs`）＋ CI 步驟

### Phase 14：畫布優先的介面（情境工具列）

- [x] 畫布吃滿剩餘空間，所有選項收進底部工具列
- [x] 工具列依情境自動切換：沒選圖 = 拼貼操作，選了圖 = 圖片操作，按「完成」切回
  - 主要動作（完成 / 製作）釘在右側不隨捲動，工具再多也不會被擠出畫面
- [x] 細調項目改為從下方推出面板（版面 / 圖框 / 間距 / 裁切 / 大小 / 輸出），關掉即恢復滿版
- [x] 版面預設：直式 / 橫式 / 自動 / 2×2 / 2×3 / 3×2 / 3×3 / 4×4，附縮圖示意，點了立即生效
  - 格狀預設改用 `fill:'cover'`：格子大小統一、圖片裁切填滿
- [x] 圖框：無 / 圓角 / 細邊 / 白框 / 陰影 / 拍立得，可調顏色、粗細、圓角
- [x] 間距面板同時提供間距與底色
- [x] 新增裁切（原始 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16），在變形階段生效並影響版面計算
- [x] 22 個介面測試 + 5 個結構防呆測試

### Phase 15：簽名 / 印章

- [x] `static/js/sign-lite.js`：簽名模型 + 繪製 + 匯入 + PDF 運算子
  - 手繪存筆畫的點（正規化到 0–1 + RDP 簡化），不是像素
  - 曲線邏輯只有一份（`walk()`），canvas 走 `quadraticCurveTo`，PDF 換算成三次貝茲
  - 匯入圖片：用亮度當透明度去白底，`keep`（留住紅色關防）/ `ink`（整個換成墨色）兩種模式
  - 自動裁掉四周空白，擺放時框的才是簽名本身
- [x] `pdf-lite.js` 蓋章：`displayMatrix()` 四個方向的座標變換 + `applyStamps()`
  - 原本的內容包進 `q…Q`，`/Resources` 複製一份再改（常被多頁共用）
  - 點陣印章走影像 XObject + SMask 軟遮罩；`CompressionStream` 不在時退回未壓縮
- [x] `image-local.js`：`drawSignatures()`，疊在文字圖層之上
- [x] `doc-local.js`：`pdfPageImage()` 單獨把一頁畫大一點，供擺放畫面用
- [x] 介面：簽名板（手寫）、簽名庫（存 / 刪 / 匯入）、擺放畫面（拖曳 + 大小 / 濃度 / 傾斜）
  - 編輯分頁與頁面分頁共用同一個簽名庫（v3.17.0 起 App 內存在 Capacitor Preferences）
- [x] 52 個簽名測試 + 10 個介面測試 + 4 個打包防呆測試

### Phase 16：裝置端邊界偵測 + 透視校正

- [x] `static/js/scan-lite.js`：偵測 + 校正引擎
  - 梯度導向 Hough 直線偵測（每點只投自己的角度 ±2°）
  - 直線分兩族 → 兩兩組四邊形 → 照搬 v5 的評分挑最好的
  - 積分圖讓「四邊形內部的亮度統計」變成 O(高度) 而不是 O(面積)
  - WebGL fragment shader 逐像素反推來源座標；沒有 WebGL 就退回細格仿射近似
  - Zhang–He 法反推真實寬高比，拉正後不會被拉扁
  - 信心 < 0.45 不自動裁切，回報 `method: 'fallback'`
- [x] `image-local.js`：`deskewItem()` / `undoDeskew()`，破壞性但可還原
- [x] 介面：`StudioDeskew` 全螢幕四角編輯，框外壓暗、低信心變色提醒
- [x] 22 個偵測測試 + 8 個介面測試 + 4 個打包防呆測試

### Phase 17：拼貼的觸控取景與交換

- [x] `image-local.js`：`fitBox()` / `clampFit()` / `isDefaultFit()`
  - 取景 = 縮放倍率 + 0–1 對焦點；預設值走原本的繪製路徑，確保零回歸
  - 位置與對焦點都夾住，圖片不會被拖出格子露白邊
  - `previewInto()` 多回傳每張圖「實際被畫成多大」，UI 才換算得出拖曳幅度
- [x] 介面：畫布上的指標手勢（點選 / 單指拖曳 / 兩指捏合），4px 門檻分辨點與拖
- [x] 介面：交換模式 + `pickIndex()`，畫布與縮圖列共用
- [x] 11 個引擎測試 + 8 個介面測試 + 3 個打包防呆測試

### Phase 18：簽名庫存進原生儲存

- [x] `native.js`：`SMNative.store`（`isDurable` / `get` / `set` / `remove`）
  - App 內走 Capacitor Preferences（原生 SharedPreferences），瀏覽器退回 `localStorage`
  - 讀取在 App 內**只問 Preferences**，「沒有這個 key」是搬家判斷的依據
- [x] `sign-lite.js`：`ready()` 接上原生儲存、`flush()` 等寫入落地
  - App 內多一份記憶體副本，讓同步的 `list()` 仍能服務畫圖路徑
  - 升級後第一次執行把 `localStorage` 的舊簽名搬進 Preferences
  - 網頁版 `cache` 恆為 `null`，逐次讀 `localStorage`，行為零變化
- [x] 7 個原生儲存測試（搬家 / 清快取後還在 / 讀寫 / 外掛壞掉 / 網頁路徑）

### Phase 19：低信心時的重拍建議

- [x] `static/js/scan-lite.js`：`assess()` —— 把偵測時算過的量測值換成可行動的建議
  - 一次逐像素掃過四邊形內部，取得積分圖給不了的東西（過曝比例、梯度分布）
  - 五種說得出口的原因：`cropped` / `dark` / `glare` / `far` / `flat`，
    量不出原因時退回一句通用的 `unknown`，但**不沉默**
  - 依嚴重程度排序、最多給 3 條 —— 全部倒出來等於沒講重點
  - `detect()` 一律回傳 `hints` 與 `quality`，抓得準時 `hints` 是空陣列
- [x] 介面：`StudioDeskew` 在「沒把握」下方列出建議（信心足夠時不顯示，免得說教）
- [x] 12 個診斷測試（偵測 22 → 34）+ 1 個介面測試

## 後續工作 🚧

依「投報率 ÷ 風險」排的。每一項都寫了**為什麼還沒做**，這比列一串願望清單有用。

### 手邊就能做的小東西

| 項目 | 為什麼 | 規模 |
|------|------|------|
| **伺服器位址也改用原生儲存** | `config.js` 的後端位址還存在 `localStorage`，跟簽名庫原本的問題一樣 —— 系統清快取就得重設一次。`SMNative.store` 已經在了，只差接上；要留意 `config.js` 在 `index.html` 裡**排在 `native.js` 之前**、而且是同步讀取，得先處理載入順序或改成非同步取得位址 | 換一層儲存 |
| **「照片糊掉」的判斷** | v3.18.0 的重拍建議刻意沒收這一條 —— 量過了，用現有的梯度圖分不出來：一張清楚的空白紙 p95 梯度是 68，一張糊到看不清字的也是 68（`features()` 又先做過半徑 2 的模糊）。要做得先在 `features()` 留一份未模糊的高頻能量，或改量邊緣寬度 | 換一個量測方式 |

### 值得做一版的功能

**即時取景** —— 相機預覽疊邊框、框穩定就自動快門。這是市面掃描 App 的標配體驗 ——
不必先拍再拉正，對準了才拍。偵測本身在 v3.14.0 已經有了（`scan-lite.js` 單張約
100–300ms），缺的是相機那一層。拆成兩個晚上：

- [ ] **M1**：`getUserMedia` 取流、每隔幾幀跑一次 `SMScanLite.detect()`、疊框顯示
      （先不做自動快門，能看到即時框線就是可用的第一步）
- [ ] **M2**：框的穩定度判斷（連續 N 幀角點變動 < 門檻）、倒數、自動快門
      （接續 M1，需要 M1 先穩定跑起來才看得出穩定度門檻該抓多少）

**標註工具** —— 箭頭 / 方框 / 螢光筆 / 手寫。對文件場景特別有用
（「這裡要改」「這欄請填」）。拆成兩個晚上：

- [ ] **M1**：箭頭 / 方框，跟打碼共用同一套拖框互動（UI 成本低）；順便把
      `drawTexts` 的單一文字物件改成陣列 —— 這是「一次只有一個文字圖層」的
      根因，也是螢光筆 / 手寫要疊加顯示的前置工作
- [ ] **M2**：螢光筆 / 手寫（接續 M1 的多圖層陣列）

### 大的、要想清楚才動的

**裝置端 OCR** —— 掃描型 PDF 變成可搜尋、圖片轉文字，也能餵給表單填寫。
`doc-local.js` 現在會直接丟「這份 PDF 抽不到文字 —— 需要 OCR」，是程式碼裡自己承認的洞。
但成本要誠實看：tesseract.js 的中文語言包比英文大一個量級，辨識率也不如後端的 PaddleOCR。

- [ ] **M1**：先做數字與英文（模型小很多，發票金額、單號、日期這些高頻需求就吃下了）
- [ ] **M2**：中文選配（語言包大、辨識率有落差，做成使用者自己選要不要下載）

**次像素角點精修** —— 裝置端目前角點誤差約 2–6px（後端 v5 是 0.6px）。

偵測跑在 480px 工作解析度上，抓完直接放大回原圖。對「拉正」這個用途夠用，
真的要做就是在原始解析度上沿邊緣法線方向做拋物線內插 + 穩健直線擬合。
**等有真實照片的回饋再決定**，現在補是憑空優化。

### 評估過、決定不做的

| 項目 | 原因 |
|------|------|
| **去背** | ONNX 模型 + 執行環境 +15MB，手機上一張要跑好幾秒 |
| **裝置端影片處理** | ffmpeg.wasm 本體就 25–30MB，壓一支影片好幾分鐘且容易 OOM |
| **iOS** | Capacitor 支援，但需要 Mac + Xcode，且要另外 `npx cap add ios` |
| **等寬字型** | 再帶一份等寬中文字型太大；程式碼區塊改用底色標示 |

### 後端側（完整版）

- [ ] 低信心偵測時的重新拍攝引導（與裝置端共用同一套判斷）
- [x] 其餘 Auto Form Fill / 邊界偵測 v5 / 部署維運項目均已完成，見「已完成功能」

---

## 平台統計

| 項目 | 數量 |
|------|------|
| API 路由 | 91 |
| 工具頁面 | 7 |
| 前端 JS 模組 | 25（其中 6 支是裝置端引擎：image-local / scan-lite / sign-lite / pdf-lite / pdf-write / doc-local） |
| 後端服務模組 | 12（另有 form_fill/ dispatcher+4 backend、common/ 共用工具兩個子套件） |
| 資料庫表 | 9 (contacts, contact_groups, group_members, email_templates, form_templates, send_history, user_sessions, sender_profiles, users) |
| 資料模型 | 8 (contact, group, template, history, sender, form_template, session, user) |
| 邊界偵測策略 | 7 (UNet_Mask, Canny×3, WhiteRegion, Otsu, Laplacian, HED, GrabCut — v5 逐邊證據評分 + 次像素精修) |
| 掃描濾鏡 | 7 (auto, scan, color_doc, document, enhance, bw, original) |
| 郵件模板 | 8 種文件類型預設 + 自訂 |
| 測試 | 275 pytest（272 passed + 3 skipped）＋ 288 個瀏覽器測試（圖片 69 + 文件 51 + 頁面 21 + 簽名 45 + 掃描 22 + 介面 80） |

---

## 依賴套件

| 分類 | 套件 | 用途 |
|------|------|------|
| Web 框架 | FastAPI, uvicorn, pydantic-settings | API + 伺服器 |
| AI | google-genai | Gemini Vision 文件辨識 |
| Email | aiosmtplib | 非同步 SMTP 寄送 |
| 圖片 | Pillow, opencv-python-headless, numpy, img2pdf | 圖片處理 + PDF |
| PDF | pypdf, reportlab | PDF 合併/浮水印/加密 |
| 文件 | python-docx, markdown, beautifulsoup4, pymupdf | Word/MD/PDF 轉檔 |
| 影片 | moviepy | 影片合併/壓縮/轉 GIF |
| 安全 | cryptography | 加密工具 |

---

## 變更日誌

### 2026/08/03 (v3.18.0 — 低信心時說得出「為什麼」)

- 偵測不確定時，介面原本只講一句「⚠ 沒把握抓對」。那句話不可行動 ——
  使用者不知道該改什麼，只能原地再拍一張一模一樣的照片
- **`assess()`**（`static/js/scan-lite.js`）：照片會壞的方式就那幾種，
  而且判斷依據在偵測時全部算過了（亮度積分圖、梯度圖、四邊形面積）。
  這一層把那些數字換算成「下一步該做什麼」：
  - `cropped` 兩個以上的角壓在畫面邊上 → 退後一點
  - `dark` 紙面平均亮度 < 85 → 開燈或換個地方
  - `glare` 紙面過曝像素 > 3% → 讓光源不要正對紙面
  - `far` 四邊形面積 < 畫面的 28% → 靠近一點
  - `flat` 紙與桌面亮度差 < 22 → 換張深色桌面
  - 量不出原因就退回一句通用的 `unknown` —— 沉默等於把使用者丟回原地
- 建議依嚴重程度排序，一次最多 3 條。`detect()` 一律回傳 `hints` 與 `quality`，
  抓得準的時候 `hints` 是空陣列而不是 `undefined`，呼叫端不必特判
- **門檻是量出來的，不是猜的**：每一條都拿合成的「拍壞」樣本對照過正常照片，
  確認中間留著一大段距離（例如昏暗但清楚的照片量到 100，離 `dark` 的 85 還有餘裕）
- **刻意沒做「照片糊掉」**：量完發現現有的梯度圖分不出來 ——
  清楚的空白紙與糊掉的照片 p95 梯度都是 68。誤報的代價比漏報高得多，
  所以寧可不給這一條，理由與後續作法寫進「後續工作」
- `studio.jsx` 的拉正畫面在「沒把握」下方列出建議；信心足夠時不顯示
- 測試 +13（偵測 22 → 34、介面 80 → 81）：每個情境只改一個變因，
  出來的建議要剛好對上那個變因；另外釘住「拍得好的照片不會被亂給建議」

### 2026/08/02 (v3.17.0 — 簽名庫存進原生儲存)

- 簽名庫原本存在 `localStorage`。在 App 裡這不是「一個儲存位置」而是**會被清掉的快取** ——
  Android 的「清除快取」、系統回收儲存空間、部分 ROM 的省電清理都會把 WebView 的資料
  一起帶走，使用者手寫好的簽名就這樣不見了，而且沒有任何提示
- **`SMNative.store`**（`static/js/native.js`）：一層統一的「要留著的小資料存哪裡」介面。
  App 內走 Capacitor Preferences（寫的是原生 SharedPreferences，只有解除安裝才會消失），
  瀏覽器退回 `localStorage`。`@capacitor/preferences` 早就在相依裡了，只是一直沒接上
  - 讀取在 App 內**只問 Preferences**，不會因為它沒有就偷偷去翻 `localStorage`。
    這個分別是整件事的關鍵：「原生儲存沒有這個 key」正是「要不要把舊資料搬過去」的判斷依據，
    退回去讀的話就永遠搬不成，資料也永遠留在會被清掉的地方
  - 只有外掛整個丟例外才退回 `localStorage`，免得功能直接不能用
- **`ready()` / `flush()`**（`static/js/sign-lite.js`）：Preferences 是非同步的，
  而 `list()` 被同步的畫圖路徑用著，所以 App 內多一份記憶體副本 ——
  開場 `ready()` 把 Preferences 讀進來，之後 `list()` 讀它、寫入排隊送出，`flush()` 等落地
  - 升級後第一次執行，`localStorage` 裡的舊簽名會自動搬進 Preferences（只發生一次）
  - App 內不再因為 `localStorage` 存不下就砍掉最舊的簽名 —— Preferences 容量大得多，
    `localStorage` 在 App 內只是順手留的鏡像，寫不進去也不影響
  - 網頁版的 `cache` 恆為 `null`，`list()` 每次直接讀 `localStorage`，
    兩個分頁各自存的簽名一樣互看得到，行為與這版之前一模一樣
- `studio.jsx` 的 `useSignatures` 改成先 `await ready()`，不然 App 內面板會先閃一下
  「還沒有簽名」再跳出內容
- 測試 +7（簽名 45 → 52）：用假的 `window.SMCap` 模擬原生環境，驗搬家、
  「清掉 `localStorage` 之後簽名還在」、存 / 刪寫進 Preferences、外掛讀失敗的退路，
  以及桌面瀏覽器開同一份打包時完全不碰原生儲存

### 2026/08/01 (v3.16.0 — 取景跟著旋轉走)

- 承 v3.15.0 的格子內取景：構圖調好之後只要按一下旋轉，畫面就會跳掉。
  原因是對焦點存的是**原圖上的相對座標**，圖轉了它就指到別的內容 ——
  裁切框當初有處理（`rotateRect` / `flipRect`），取景漏了
- **`rotateFit` / `flipFit`**（`static/js/image-local.js`）：把對焦點跟著轉 / 跟著鏡射。
  座標映射刻意跟 `rotateRect` 用同一套（順時針 90° 時 `(x, y) → (1 - y, x)`），
  兩者不一致的話裁切框跟取景會在旋轉後各自跑到不同地方；測試直接拿一個沒有大小的
  裁切框跟 `rotateFit` 對答案，把這個約束釘住
  - `zoom` 是「相對於剛好填滿格子」的倍率，跟方向無關，原封不動帶過去
  - 沒動過取景的圖（`fit` 是 `null`）不會被硬塞一個 fit，維持原本一個像素都不變的路徑
- **拉正後取景歸零**：`deskewItem` / `undoDeskew` 把 `fit` 跟 `cropRect` 一起設回 `null`。
  透視校正會把整張圖重新映射，舊的對焦點指到的已經不是同一塊內容，
  留著只會讓拉正後的第一眼構圖是亂的
- `studio.jsx` 的旋轉 / 翻面接上這兩個函式（原本只帶了 `cropRect`）
- 測試 +15（圖片引擎 54 → 69）：純函式的映射一致性、轉四次回到原點、逆時針、
  縮放不受影響、`null` 與缺欄位的處理；加上一組真的畫出來的像素驗證 ——
  三色直帶的圖旋轉前後格子中央取樣要是同一個顏色，並且刻意保留一個
  「取景沒跟著轉會看到什麼」的對照案例，之後有人改壞了會直接紅
- 版本升至 3.16.0（PWA cache `scanmail-v17`、versionCode 31600）

### 2026/08/01 (文件整理，無程式異動)

- 盤點目前專案狀況：核對 `app/routers/`、`app/services/`、`app/models/`、SQLite 資料表
  與程式碼實際數量，抓到幾處文件沒跟上程式碼的地方並修正：
  - **README.md**「技術架構」ASCII 圖：路由模組 7 → **9**（漏了 `auth.py`、
    `form_tools.py`）、服務模組 10 → **12**、SQLite 資料表 7 → **9**（漏了
    `form_templates`、`users`，`groups` 更名為實際的 `contact_groups`）
  - **README.md**「專案結構」樹狀圖：`core/` 補上 `auth.py` / `rate_limiter.py`；
    `routers/` 補上 `auth.py` / `form_tools.py`；`services/` 補上 `ai_renamer.py`、
    `flex_builder.py`、`form_fill/`（表單填寫 dispatcher + 4 backend）、
    `common/`；`models/` 補上 `form_template.py` / `session.py` / `user.py`
  - **docs/ARCHITECTURE.md**：架構圖 SQLite 表數同步更新（routers/services 數量
    本來就是對的），「最後更新」日期回填為實際檢查日期
  - **docs/TODO.md**「平台統計」：資料庫表 7 → 9、資料模型 5 → 8，都補上完整清單
  - 其餘統計（API 91 個、工具頁面 7、前端 JS 模組 25、測試 275 pytest + 273
    瀏覽器測試）逐項對過程式碼與測試檔案，數字正確，未變動

### 2026/07/31 (CI/CD，不影響 App 版本號)

- **GitHub Release 步驟**：打 `android-v*` 標籤時，`.github/workflows/android.yml`
  現在會建立一個 GitHub Release，附上兩個免登入、點下去就能裝的 `.apk`：
  - `scanmail-<tag>-full.apk` —— 完整版（需要後端）
  - `scanmail-<tag>-offline.apk` —— 離線精簡版（裝置端媒體工具）
  - 用 runner 內建的 `gh` CLI 建立 / 更新 Release（`gh release create` 或已存在時
    `gh release upload --clobber`），沒有另外引入 marketplace action
  - job 加上 `permissions: contents: write`，否則預設唯讀 token 建不了 Release
- **順手修掉一個既有的標記錯誤**：release 建置流程原本會先跑「完整版建置」再跑
  「離線版建置」（給 `test:studio` 用），但 tag 觸發的 `assembleRelease` 排在兩者
  之後，等於**簽出來的 `scanmail-release-apk` 其實是離線版內容、卻掛著完整版的
  artifact 名稱**。現在 release 階段會分別重跑一次 `build_mobile.py --sync` /
  `--offline --sync` 再各自 `assembleRelease`，兩份 APK 名符其實
- 這是 workflow 設定變更，不影響 App 執行邏輯或 `static/`，因此不需要跑
  `mobile/` 下的瀏覽器測試；`main.py` 版本號維持 `3.15.0` 不變

### 2026/07/30 (每日自動開發 Routine，無程式異動)

- 建立每天 **03:00（台灣時間）** 的排程：喚醒一個乾淨環境的 Claude Code session，
  從本檔「後續工作」挑一個**小而完整**的增量做完、補測試、開草稿 PR
  - Trigger `trig_01FmvRiLcNdxu1YjraTZ3Vex`，cron `0 19 * * *`（UTC，＝台灣 03:00）
  - 每次開新 session，**不接續前一天的對話** —— 這是設計，不是限制：
    每天從文件重新定位，就不會累積一堆只存在對話裡的假設
- 新增 **[DAILY_ROUTINE.md](DAILY_ROUTINE.md)**：那個 session 的作業規則
  - 流程：先收前一天沒收尾的 PR → 定位 → 選題（投報率 ÷ 風險）→ 開發 → 品質關卡 → 交付 → 收尾
  - 寫明既有約定：`static/` 是唯一前端來源、不要直接改 `mobile/www/`、
    離線版不能依賴後端或外部 CDN、Chromium 已在 `/opt/pw-browsers/chromium`
  - 規則放進版控（而不是只寫在排程訊息裡），要改規則就是改這份檔案
- 新增 **[ROUTINE_LOG.md](ROUTINE_LOG.md)**：每次執行留一筆（日期／主題／分支／PR／結果／下一步）
  - 「下一步」要寫得能直接動手 —— 下一天的 session 沒有記憶，只有這些檔案
- **收尾契約**：每次執行都必須更新 `STATUS.yaml`、本檔「變更日誌」、`ROUTINE_LOG.md`，
  動到架構 / App 就順手更新 ARCHITECTURE.md / ANDROID.md。沒做完這步，等於這天沒做

### 2026/07/28 (文件整理，無程式異動)

- 實機測試回報：交換、觸控取景、拉正三項都可用。本次把文件對回現況
- **[ANDROID.md](ANDROID.md)** 補上 v3.13–3.15 漏掉的部分：拉正、簽名 / 印章、
  拼貼取景與交換、PDF 蓋章的座標處理；工具列表格重寫
  - 新增「**從原始碼到手機上：完整流程**」—— 一張圖走完 `static/` → APK，
    以及**拿到 APK 的三種方式**（自己建 / CI Artifacts / nightly.link）
    與各自的限制（要登入、下載的是 zip、Release 還沒做）
  - 修正版本號範例（寫著 3.12.0 / 30800，兩個對不起來）
  - CI 測試步驟補齊 `test:sign` / `test:scan`
- **[ARCHITECTURE.md](ARCHITECTURE.md)** 內容還停在 v2 時代（說前端是「單一 HTML
  約 2100 行」、main.py「約 440 行」），整段重寫：
  - 系統總覽改成「同一份前端、三個執行環境」，並畫出裝置端引擎那一側
  - 補上 8 支裝置端引擎的分工與行數（約 5,800 行）
  - 資料流新增「裝置端流程」，對照原本的後端寄送流程
- **[TODO.md](TODO.md)**：
  - Phase 段落照編號排好（原本 1–11 遞增、後面 17→12 遞減，讀起來很亂）
  - 「待開發功能」幾乎全打勾了，重寫成**後續工作**：依投報率排序，
    每項寫明「為什麼還沒做」，另外列出評估過決定不做的（去背 / 裝置端影片 / iOS）
  - 平台統計對回現況（API 路由 85 → 91、服務模組 10 → 12、前端模組 12 → 25）
- **README.md** 加上文件索引；拉正與簽名的實作細節改為摘要 + 連到 ANDROID.md，
  減少兩邊重複；測試指令補上 `test:sign` / `test:scan`
- 修掉 3 個壞掉的連結：`PADDLEOCR_INTEGRATION.md` 裡殘留的
  `file:///D:/...` 絕對路徑，換成 repo 相對路徑

### 2026/07/28 (v3.15.0 — 拼貼的觸控取景與交換)

- 試用回饋：拼貼時圖片在格子裡的位置動不了，順序也只能靠重新加圖來排
- **格子內取景**：選了圖之後單指拖曳移動、兩指捏合縮放
  - 格狀版面（cover）會把圖裁切填滿，拖曳就是決定要露出哪一塊
  - 存的是相對值（縮放倍率 + 0–1 對焦點），縮圖上調完、原圖匯出構圖一致
  - 對焦點夾在「實際可動」的範圍內 —— 不夾的話手指會累積一段拖了卻不動的空行程，
    回拖時要先把那段還回來，感覺像卡住
  - **沒動過取景的圖走原本那條繪製路徑**，一個像素都不會變（既有輸出不受影響）
- **交換位置**：點「⇄ 交換」再點另一張，兩張對調
  - 沒有明確模式的話沒人猜得到「點 A 再點 B」會交換 —— 那本來就是「改選 B」
  - 畫布與縮圖列共用同一條 `pickIndex()`，兩邊行為一致；縮圖比在拼貼上點準得多
- 點選與拖曳共用同一塊畫布，靠 4px 位移門檻分辨；而且只有拖「已經選中的那張」
  才算移動，不然點旁邊的圖會把它撞位
- `touchAction: 'none'` 是必要的 —— 不擋掉的話瀏覽器會把拖曳與捏合當成捲動 / 縮放整頁
- `setPointerCapture` 加上 try/catch：合成事件沒有真的指標會丟 NotFoundError，
  而捕捉只是為了拖出畫布邊界時還收得到事件，抓不到不影響手勢
- 新增 11 個引擎測試 + 8 個介面測試 + 3 個打包防呆測試
- 版本升至 3.15.0（PWA cache `scanmail-v16`、versionCode 31500）

### 2026/07/28 (v3.14.0 — 裝置端邊界偵測 + 透視校正)

- 離線版本來只有自由裁切，真正「掃描」的那一半（自動抓紙張、拉平）一直長在後端。
  補上之後，「拍紙本 → 自動抓邊 → 拉正 → 存 PDF」整條線第一次能完全不連網跑完
- **偵測只留一條路：梯度導向的 Hough 直線偵測**。後端 v5 跑七種策略再評分，
  瀏覽器沒有那個預算；選直線是因為文件的邊本來就是直線，而且直線由整條邊投票決定，
  **角被手指擋住不影響**（後端當初得補凸包才解決）
  - 一般 Hough 每點要投 180 個角度；利用「梯度方向垂直於邊」，每點只投自己的角度
    ±2°，快兩個數量級而且峰值乾淨得多
  - 梯度門檻取分位數不是寫死，昏暗照片才不會整個失效
- **評分整套照搬 v5**：凸性（不懲罰透視梯形）、逐邊梯度支持度（比較「邊上」與
  「往內側偏移」的梯度，木紋桌面之類的假邊會被淘汰）、最弱邊乘法門控。
  那些權重是 22 個案例的基準測試磨出來的，憑感覺重寫只會退步
- **透視校正走 WebGL** —— canvas 2D 只做得到仿射。一支 fragment shader 逐像素反推
  來源座標，雙線性取樣是 GPU 順便給的。拿不到 WebGL 就退回「切細格、每格仿射近似」
- **輸出尺寸用 Zhang–He 法反推真實寬高比**，不然斜拍的 A4 拉正後會系統性被拉扁
- 信心 < 0.45 不自動裁切，改提醒「沒把握」請使用者確認 —— 對齊後端的門檻。
  亂裁一通比不裁更糟，使用者不會發現
- 拉正是破壞性的（換掉原圖），所以留了「還原原圖」，並清掉已經沒有意義的裁切框
- 測試方式：**合成有標準答案的「拍紙本」影像**，量角點誤差。正對 / 斜拍 / 旋轉 14° /
  角被手指擋住 / 昏暗低對比都要 < 10px；另外放了該失敗的場景，確認它老實回報低信心
- 過程中抓到兩個只有靠特定驗法才看得見的 bug：
  - **WebGL 輸出上下顛倒** —— 一開始的「線有沒有變垂直」驗不出來，因為垂直線翻過來
    還是垂直線。改用四個顏色不同的象限做恆等變換才現形
  - **warp 直接回傳 WebGL 畫布** —— 一張 canvas 只能有一種 context，呼叫端的
    `getContext('2d')` 會拿到 null，後面所有合成整條斷掉。改成搬回 2D 畫布再回傳
- 新增 22 個偵測測試 + 8 個介面測試 + 4 個打包防呆測試
- 版本升至 3.14.0（PWA cache `scanmail-v15`、versionCode 31400）

### 2026/07/28 (v3.13.0 — 簽名 / 印章)

- 這個平台的用途是寄公文、合約、收據，而這些文件常常就差一個簽名。
  原本的流程是「印出來 → 簽 → 再掃一次」，現在手指簽一次存起來，之後拖到定位就好
- **手寫簽名存的是筆畫的點而不是像素**：
  - 蓋進 PDF 輸出的是向量路徑 —— 放大不糊、列印跟原生文件一樣銳利，一枚只佔幾 KB
  - 曲線用「相鄰兩點的中點連成二次貝茲」；PDF 沒有二次貝茲運算子，換算成三次，
    兩邊算的是同一條線，所以畫面上看到的就是蓋出來的
  - 存進 localStorage 前跑 Ramer–Douglas–Peucker 簡化，手指畫出來的上百個點砍到剩幾十個
- **匯入圖片當印章**：拍一張紙上的簽名或關防，用亮度當透明度去掉白底。
  「保留原色」留住紅色關防，「轉成墨色」把太淡的原子筆整個換色。自動裁掉四周空白
  - 蓋進 PDF 走影像 XObject + SMask 軟遮罩，中間是真的透明，不會把底下的字蓋掉
- **蓋章的座標**是這次最容易寫錯的地方：`/Rotate` 是交給檢視器轉的，內容串流的座標
  不會跟著轉 —— 使用者在轉過向的頁面上點右下角，直接寫進去會蓋到左上角。
  四個方向各一組變換矩陣，另外處理 MediaBox 原點不在 (0,0) 的檔案
  - 原本的內容包進 `q…Q` 再接簽名（它可能留下改過的座標系或顏色）
  - `/Resources` 常被好幾頁共用，一律複製一份再改，蓋一頁不會動到別頁
- 圖片端：簽名畫在文字圖層之上 —— 簽名是最後蓋的那一道
- PDF 頁面擺放時單獨把那一頁畫大一點（`pdfPageImage`），縮圖列的 200px 對不準簽名欄的橫線
- 測試方式：**把蓋完的頁面畫出來數墨點**。放在哪一個象限就只有那一個象限的深色像素變多，
  矩陣寫錯的話墨會出現在別的象限，逃不掉
  - 傾斜方向也用同一招驗：拿一枚墨集中在上半部的簽名，轉 90° 後重心該跑到右邊。
    第一版寫成負角（以為外層的上下翻轉會反轉旋轉方向），畫面上往右傾、蓋出來卻往左傾，
    就是被這條抓出來的
- 新增 45 個簽名測試 + 10 個介面測試 + 4 個打包防呆測試
- 版本升至 3.13.0（PWA cache `scanmail-v14`、versionCode 31300）

### 2026/07/28 (v3.12.0 — 打碼 / 濾鏡 / 文字浮水印)
- 圖片編輯補完市面上該有而我們沒有的東西，圖片這一塊到這裡算完整了
- **打碼**（馬賽克 / 模糊 / 塗黑）：拖框遮蔽，畫面直接顯示遮完的樣子而不是外框預覽 ——
  遮得夠不夠一眼就知道。已遮的框點一下可移除，另有復原 / 全清
  - 三種都直接改像素，不是蓋一層可以移除的東西
  - 模糊要連周邊一起取樣再裁回中心，只取選區的話邊緣會透出半透明
- **調整**：八組濾鏡預設（含「紙本」—— 泛黃的紙拉成乾淨黑白，拍紙本文件用）
  + 亮度 / 對比 / 飽和細調。用 `ctx.filter` 走 GPU，拉滑桿即時反應
  - 「大小」併進「調整」，工具列才不會擠爆
- **文字 / 浮水印**：同一個面板，差在「平鋪」開關。位置用九宮格挑（手機上比拖曳準），
  字級與位置存相對值，縮圖預覽與原圖匯出長得一樣。外框預設開著 ——
  白字壓白底就是看不見
- 修掉一個畫面上看得到的 bug：`renderItem` 畫圖時設的 `translate` 沒有還原，
  沒裁切時打碼會跟著整個位移出去（有裁切因為會產生新畫布所以剛好躲掉）。
  `applyRedactions` / `drawTexts` 另外自己把座標系歸零，換個呼叫端也不會畫錯位置
- 濾鏡預設「文件」改名「紙本」—— 跟文件分頁撞名
- 新增 7 個引擎測試 + 8 個介面測試 + 3 個打包防呆測試
- 版本升至 3.12.0（PWA cache `scanmail-v13`、versionCode 31200）

### 2026/07/27 (v3.11.0 — PDF 頁面操作)
- 新增「📚 頁面」分頁：PDF 的合併 / 刪頁 / 抽頁 / 重排 / 轉向，全部在裝置上做完
- 縮圖總表 + 情境工具列：沒選頁是加檔 / 清空 / 輸出，點某一頁換成左轉 / 右轉 /
  前移 / 後移 / 刪除。重排刻意用按鈕而不是拖曳 —— 手機上拖曳排序很難拖準
- 核心是新的 `static/js/pdf-lite.js`：一層自己寫的 PDF 物件解析器
  - 讀 xref：傳統表與 PDF 1.5 之後的 xref 串流都認（含 Flate + PNG 預測子還原）
  - 展開物件串流（ObjStm），不然現代 PDF 什麼都讀不到
  - 走頁面樹並繼承父節點的 Resources / MediaBox / CropBox / Rotate
  - 挑頁時從頁面字典往下遞迴複製相依物件並重新編號；**內容串流原封不動**，
    所以文字還是文字、圖還是原本那張圖，不是重畫成點陣圖
- 真實世界的檔案常常有點壞，留了幾條退路：
  - xref 讀不動 → 退回整份掃描 `N G obj`
  - 增量更新（註解過、簽過名的檔案）→ 沿著 `/Prev` 往回走，後面的覆蓋前面的
  - 加密的檔案 → 明確拒絕，不給出壞掉的輸出
- 複製時擋掉兩件事：`/Parent`（頁面樹自己重建）、指向沒被選到的頁面的參照
  （註解的跳頁目的地會把整份文件帶過來）
- 文件分頁的「📐 頁面」改名為「📐 紙張」—— 跟新的頁面分頁撞名了
- 新增 21 個引擎測試 + 9 個介面測試 + 4 個打包防呆測試。測試素材用 pikepdf 產出
  兩種結構明顯不同的 PDF（傳統 xref / xref 串流 + 屬性繼承）、一份加密檔、
  一份手工組的增量更新檔；輸出除了用 pdf.js 讀回來比對，還會讓 qpdf 驗一次結構
- 版本升至 3.11.0（PWA cache `scanmail-v12`、versionCode 31100）

### 2026/07/27 (v3.10.0 — 手機掃描器三件套)
- 對照市面上的圖片 / 掃描 App 補缺口。這批是「拍紙本文件 → 裁掉桌面 → 存成一份 PDF」
  的完整流程，三件各自也獨立有用
- **自由裁切**：原本只有固定比例的置中裁切，現在點「裁切」會進到獨立畫面，
  四角拖框、框內拖移、三分線輔助，可鎖 1:1 / 4:3 / 3:4 / 16:9 / 9:16
  - 裁切排在旋轉之後（`renderItem` 先轉再裁）—— 使用者拉的框就是他看到的畫面
  - 轉圖 / 翻圖時裁切框跟著轉（`rotateRect` / `flipRect`），不會飄掉
- **圖片 → PDF**：圖片分頁可選「合併成 PDF」把多張變一份多頁 PDF；
  編輯分頁的輸出格式也加了 PDF（拼貼結果直接輸出）
  - `/DCTDecode` 吃的就是 JPEG 原始位元組，所以照片是原樣嵌入 —— 不解碼、
    不重新編碼、畫質完全不掉。只有漸進式 JPEG / CMYK / PNG / 需要縮小時才重壓
  - PDF 檢視器不看 Exif，方向改用變換矩陣（八個方向的 `ORIENT` 表）處理，
    照片本身仍然原封不動
  - `pdf-write.js` 加上影像 XObject 與每頁獨立的 MediaBox（「貼合圖片」需要）
- **PDF → 圖片**：文件分頁在 PDF 進來時多一個「圖片」輸出，每頁一張，
  可挑 100 / 150 / 300 dpi。走 pdf.js 完整繪製，掃描件與圖表都原樣保留
- 修掉兩個測試抓到的 bug：
  - 離開裁切模式後 canvas 是新的 DOM 元素，重繪的 effect 沒把它列入相依，
    會留下瀏覽器預設的 300×150 空白畫布
  - pdf.js 會接管傳進去的緩衝區，同一份 PDF 想先抽文字再轉圖片會炸 —— 改成先複製
- 新增 14 個引擎測試 + 8 個介面測試 + 6 個打包防呆測試
- 版本升至 3.10.0（PWA cache `scanmail-v11`、versionCode 31000）

### 2026/07/27 (v3.9.0 — 裝置端的文件轉檔)
- 離線版新增「文件」分頁：PDF / Word / Markdown / 純文字 / HTML 互轉，完全不連後端
- 中間隔一層共用的文件模型，所以是任意組合而不是寫死的每一對轉換；
  標題階層、清單、表格、引用、程式碼區塊、粗體斜體、超連結都會保留
- 選好檔案先顯示解析後的排版預覽 —— 轉檔前就看得出來有沒有讀歪
- 新增 `static/js/zip-lite.js`：用瀏覽器內建的 CompressionStream 讀寫 zip（DOCX 就是 zip 裝 XML），
  不引入 JSZip
- 新增 `static/js/ttf-lite.js`：TrueType 解析與子集化。內建字型 4.6 MB，
  但輸出時只把這份文件用到的字寫進 PDF，所以產出的 PDF 通常只有 30–80 KB
- 新增 `static/js/pdf-write.js`：PDF 產生器（Type0 / Identity-H / CIDFontType2 內嵌字型），
  附 ToUnicode 對照表所以中文可以複製、可以搜尋；Markdown 的連結變成可點的連結註解
- 新增 `scripts/make_pdf_font.py`：把 Noto Sans TC 裁成 Big5 全字集 + 常用符號（OFL 授權一併附上）
- PDF 讀取靠字級、行距、行首符號還原段落與標題；掃描型 PDF 會明確提示需要 OCR，不給空白檔
- DOCX 解析支援「清單設定寫在樣式上」的情況（Word 與 python-docx 都這樣做），
  並沿 basedOn 往上追
- 中文斷行做了避頭尾，超長網址逐字拆
- 新增 37 個文件引擎測試 + 7 個介面測試 + 10 個打包防呆測試，全部納入 CI；
  測試方式是「產完再讀回來」：產出的 PDF 交給 pdf.js 抽文字比對，產出的 DOCX 用自己的
  zip 解開再解析，另外用 python-docx 產一份 fixture 驗證解析器不是只認得自己的寫法
- 版本升至 3.9.0（PWA cache `scanmail-v10`、versionCode 30900）

### 2026/07/27 (v3.8.0 — 畫布優先的介面)
- 試用回饋：選項太多把圖片擠掉了。這版把所有選項收進底部工具列，畫布吃滿剩餘空間
- 工具列依情境切換 —— 沒選圖是「版面 / 圖框 / 間距 / 加圖 / 清空 / 製作」，
  點了某張圖換成「左轉 / 右轉 / 水平 / 垂直 / 裁切 / 大小 / 刪除 / 完成」
- 主要動作釘在工具列右側不隨捲動（第一版做出來時「完成」會被擠出畫面）
- 細調改為下方推出的面板，關掉立刻恢復滿版
- 版面改為可直接點選的預設（2×2 / 2×3 / 3×2 / 3×3 / 4×4 + 直式 / 橫式 / 自動），附縮圖示意
  - 格狀預設用 cover：每格大小一致、圖片裁切填滿，符合一般人對「拼貼」的預期
- 新增圖框樣式（圓角 / 細邊 / 白框 / 陰影 / 拍立得）與顏色、粗細、圓角細調
- 新增裁切比例（1:1 / 4:3 / 3:4 / 16:9 / 9:16），在變形階段生效
- 版本升至 3.8.0（PWA cache `scanmail-v9`、versionCode 30800）

### 2026/07/27 (v3.7.0 — 離線版改成即時編輯)
- 離線版介面整個重做（`static/js/studio.jsx`）：只有「編輯 / 轉換」兩頁，
  不再借用完整版的導覽殼
- 旋轉 / 翻轉 / 縮放改為即時反應 —— 原本是「送出 → 排隊 → 下載」，一個旋轉要等好幾秒
- 拼接同時就是多圖編輯器：可點畫布或縮圖選中任一張單獨旋轉 / 翻轉 / 縮放
- 縮放、壓縮、轉檔合併成一個流程，只重新編碼一次（原本要跑三趟、掉三次畫質）
- 引擎抽出 `layoutBoxes()` 作為唯一版面來源，即時預覽與匯出共用同一套計算
- 預覽用縮圖（長邊 1400px）確保按下去就有反應，匯出時才用原圖重算
- 新標誌：從「相機快門 + 信封」改為三張疊起來的媒體卡片，由 `scripts/gen_logo.py`
  程式繪製；Android 圖示與啟動畫面改為直接從標誌產生
- 新增 19 個介面測試並納入 CI；版本升至 3.7.0（PWA cache `scanmail-v8`、versionCode 30700）

### 2026/07/26 (v3.6.0 — 離線精簡版)
- 新增純 Canvas 圖片引擎 `static/js/image-local.js`，縮放 / 轉檔 / 壓縮 / 拼接 / 旋轉 / 翻轉
  全部在裝置上完成，不需要後端、照片不離開手機
- 版面規則刻意對齊後端 `image_batch.py`：fit 只縮不放、normalize 主軸對齊、grid 格子取最大寬高
- 畫質：逐次對半縮放再繪製，避免瀏覽器單次雙線性取樣造成的鋸齒
- 兩點刻意的差異：只支援 PNG / JPG / WebP 輸出（Canvas 限制）；透明轉 JPG 填白底而非黑底
- `build_mobile.py --offline`：整個 App 收斂成圖片工具，無導覽、無登入、無伺服器設定
- 批次結果不打包 ZIP，改為逐檔列出 + 「全部儲存」一次送進系統分享
- CI 增加瀏覽器測試與第二份 APK 產物（`scanmail-offline-apk`）
- 版本升至 3.6.0（PWA cache `scanmail-v7`、Android versionCode 30600）

### 2026/07/26 (v3.5.0 — Android App)
- 同一份 `static/` 前端同時服務網頁版與 Android App，開發流程不變（改 static/ → 重整瀏覽器）
- `mobile/`：Capacitor 8 外殼 + Android 原生專案（appId `tw.edu.ncut.doflab.scanmail`）
- `scripts/build_mobile.py`：把 CDN 依賴改為內建、預編譯 JSX、打包 Capacitor 橋接、注入執行環境旗標
  - 每個 index.html 改寫規則都檢查命中次數，結構一改就直接失敗而不是產出壞掉的 App
  - 改寫後檢查沒有殘留 `https://` 資源，確保 App 冷啟動不依賴外網
- API 位址改由 `static/js/config.js` 在載入時決定：網頁版同源、App 版用使用者設定或打包時預填
- 新增 App 內伺服器設定畫面（含 `/health` 連線測試），網路錯誤時自動跳出
- 下載改走 `API.triggerDownload()` → App 內用 Capacitor 寫檔 + 系統分享（WebView 不支援 blob: 下載）
- `get_current_user` / `get_user_id` 支援 `?token=`，讓 App 在啟用認證時仍能收到 SSE 任務進度
- 修正：`index.html` 的 inline JSX 抽成 `js/boot.jsx`，並改用 `bUseState` / `bUseEffect`
  避免與 `atoms.jsx` 的頂層 `const` 撞名（預編譯成一般 script 後會直接 SyntaxError）
- 新增 `.github/workflows/android.yml`（push 產 debug APK、`android-v*` 標籤產 release APK）
- 版本號統一升級至 3.5.0（`main.py` / PWA cache `scanmail-v6` / 前端資源版號 / Android versionCode 30500）

### 2026/07/08 (v3.4.0 — 文件邊界偵測 v5)
- 評分系統重寫：矩形度 → 凸性（v4 懲罰透視梯形，導致大角度拍攝時包圍盒贏過真正邊界）
- 逐邊梯度支持度 + 最弱邊乘法門控：淘汰貼圖框假邊、明暗漸層誤判
- 效能：共用特徵預計算 + 昂貴策略（HED/GrabCut）延遲啟動，單張延遲 11.5s → 0.9s
- 新增：原始解析度次像素角點精修、Zhang–He 法真實寬高比恢復（透視校正不再拉伸變形）
- 新增：偵測信心值貫穿 `detect_document()` 與 `/scan/detect`、`/scan/process` API，信心 < 0.45 不自動裁切
- 新增：上傳時 EXIF 方向正規化；模型下載失敗 1 小時冷卻快取（不再每次掃描重試）
- 22 案例 ground-truth 基準：良好偵測 15/22 → 22/22，平均 IoU 0.908 → 0.997，角點誤差中位數 18.2px → 0.6px
- 新增 20 個回歸測試（`tests/test_doc_scanner_v5.py`）；全測試套件 205 個（202 passed + 3 skipped）
- 版本號統一升級至 3.4.0（`main.py` / PWA cache `scanmail-v4` / 前端資源版號）

### 2026/06/16 (v3.3.1)
- 修正 `static/js/desktop.jsx` 於 AI 辨識區塊之 React JSX 語法錯誤。
- 升級 PWA Service Worker 快取名稱至 `scanmail-v3`，更新 `index.html` 載入版號為 `sw.js?v=3.3.1`。
- 更新 FastAPI 後端 `main.py` 與 `/health` 端點之版本號至 `3.3.1`。

### 2026/05/27 (專案改進)
- Form Fill M4.5：Layer 2 新增表格 cell 偵測（`page.find_tables()`），解決表格式表單失效問題
- Form Fill M4.6：Layer 2 偵測 0 欄位時自動 fallback 到影像 backend（Gemini）
- 安全：加密金鑰改走 `Settings` 單一來源 + 啟動警告；CORS 改為可設定 `ALLOWED_ORIGINS` 並修正 credentials 組合
- Repo 衛生：移除誤入版控的 `scanBot.zip` / db journal / 真實發票 PDF，補強 `.gitignore`
- 新增 CI：`pyproject.toml` pytest 設定 + GitHub Actions（Python 3.10/3.11）
- 統一版本號為 3.3.0；新增表格表單 fixture 與 M4.5/M4.6 測試

### 2026/05/12 (v3.3.0 — Auto Form Fill M1)
- 新增表單自動填寫工具（工具箱第 7 個工具，desktop + mobile）
- 4 層 backend 分層偵測：AcroForm（pypdf）/ pdfplumber 啟發式 / PaddleOCR 預留 / Gemini Vision
- API 路由：`/api/tools/form/{detect,suggest,fill,task/...}`
- 設計契約：FormField.bbox 一律 PDF points（origin bottom-left）；`normalize_to_pdf()` 在邊界統一影像 → PDF
- Semantic Mapping：rule-based 對應 sender_profile / contact / today
- 安全強化：`get_temp_path` 加路徑穿越防禦（`_SAFE_FILENAME` regex + `relative_to(TEMP_DIR)`）
- 共用工具：抽出 `app/services/common/json_parsing.py`，重構 `ai_analyzer` 共用
- SSE watcher 加自動重連（指數退避，3 次）
- 14 個 pytest case + 4 個 fixture 表單 + manual demo 腳本
- 已知限制：Layer 2 對表格式 PDF 失效（real-world finding，待 M4.5 解決）

### 2026/04/02 (v3.2.0)
- 新增批次寄送（多選收件人 + checkbox UI）
- 新增收件人群組（CRUD + 一鍵全選群組成員）
- 新增郵件模板（8 種預設 + 自訂模板 + 變數替換）
- 全面重寫文件邊界偵測引擎 v3（5 策略並行 + 評分 + 反貼邊規則）
- 修正裁切 500 錯誤（numpy.float32 JSON 序列化 + float 座標驗證）
- DB 新增 3 張表（contact_groups, group_members, email_templates）

### 2026/03/28 (v3.0.0 — ScanMail+)
- 整合 myPicasa (MediaToolkit) 為統一 Web 平台
- 新增 6 個工具：圖片工具、PDF 工具、文件轉檔、GIF 製作、影片工具、批次改名
- 架構重構：main.py App Factory、路由模組化、CSS/JS 分離、工具導航系統
- 新增背景任務管理器 + SSE 即時進度推送

### 2026/03/24 (v2.0.0)
- 重構為 Web App（REST API + SPA）
- 文件掃描後處理（OpenCV 邊界偵測/透視校正/濾鏡）
- 圖片旋轉 + 多頁掃描

### 2026/03/20 (v1.0.0)
- 初始版本：LINE Bot 架構
