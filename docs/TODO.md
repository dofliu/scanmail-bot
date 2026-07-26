# ScanMail+ 開發規劃與 TODO

> 最後更新：2026/07/26

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
- [x] 35 個瀏覽器功能測試（`mobile/test/image-local.test.mjs`）＋ 7 個 pytest 防呆測試
- [x] CI 另外建置並上傳 `scanmail-offline-apk`

---

## 待開發功能 🚧

### Auto Form Fill — next iteration

- [x] **M4 真實 API 測試**：對掃描影像跑 Gemini，量 bbox 平均誤差（已於 2026/06/13 完成，平均 IoU 0.74，中心點誤差 ~5pt，召回率 100%，參見 [test_gemini_vision_accuracy.py](file:///D:/Project_CodingSimulation/PersonalHelper/scanmail_bot/tests/test_gemini_vision_accuracy.py)）
- [x] **M5 Mapping UI**：前端 PDF 渲染 + bbox 標示 + 拖曳調整
- [x] **M7 整合**：填好的 PDF 接 `/api/send` 直接寄、表單模板儲存（記住欄位對應）
- [x] **M6 PaddleOCR**：本地離線 OCR backend（支援 PP-Structure V2 文字與表格邊界偵測及座標 points 轉換，已於 2026/06/13 完成，含 lifespan 熱機與 mock 測試驗證，見 [PADDLEOCR_INTEGRATION.md](file:///D:/Project_CodingSimulation/PersonalHelper/scanmail_bot/docs/PADDLEOCR_INTEGRATION.md)）
- [x] **掃描→表單填寫流程整合**：scan AI 辨識 doc_type=form 時提供「→ 自動填寫」按鈕

### 掃描體驗

- [x] 裁切即時預覽 — 拖曳角點時即時顯示校正後效果
- [x] 邊界偵測持續優化 — 更多真實場景測試（2026/06/07 已完成六大失真場景自動化評估測試；2026/07/08 v5 完成 22 案例合成 ground-truth 基準測試，見 Phase 10）
- [x] 邊界偵測優化：改善角點被手指/物體遮擋的辨識度 (Scene 5)
  - [x] 導入凸包 (Convex Hull) 運算修復被遮擋的邊界缺口
  - [x] 對近似後的五/六邊形進行直角邊外推，計算交點以重建被「圓角化」的直角頂點
- [x] 次像素角點精修 + 真實寬高比恢復（v5，見 Phase 10）
- [ ] 前端：低信心偵測時提供「重新拍攝建議」而非僅文字提示（例如反光/過暗場景引導）


### 使用者體驗

- [x] PWA 支援 — manifest.json + Service Worker → 手機可安裝
- [x] 深色模式

### 部署與維運

- [x] Docker 容器化部署測試
- [x] 使用者認證（多使用者支援）
- [x] API Rate Limiting
- [x] 擴充 pytest 測試覆蓋率 (Sprint 1)

---

## 平台統計

| 項目 | 數量 |
|------|------|
| API 路由 | 85 |
| 工具頁面 | 7 |
| JS 模組 | 11（新增 config.js / native.js / image-local.js） |
| 後端服務模組 | 10 |
| 資料庫表 | 7 |
| 資料模型 | 5 (contact, group, template, history, sender) |
| 邊界偵測策略 | 7 (UNet_Mask, Canny×3, WhiteRegion, Otsu, Laplacian, HED, GrabCut — v5 逐邊證據評分 + 次像素精修) |
| 掃描濾鏡 | 7 (auto, scan, color_doc, document, enhance, bw, original) |
| 郵件模板 | 8 種文件類型預設 + 自訂 |
| 測試 | 235 pytest（232 passed + 3 skipped）＋ 35 個瀏覽器測試（本地圖片引擎） |

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
