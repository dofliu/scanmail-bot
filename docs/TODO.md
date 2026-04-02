# ScanMail+ 開發規劃與 TODO

> 最後更新：2026/04/02

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

---

## 待開發功能 🚧

### 掃描體驗

- [ ] 裁切即時預覽 — 拖曳角點時即時顯示校正後效果
- [ ] 邊界偵測持續優化 — 更多真實場景測試

### 使用者體驗

- [ ] PWA 支援 — manifest.json + Service Worker → 手機可安裝
- [ ] 深色模式

### 部署與維運

- [ ] Docker 容器化部署測試
- [ ] 使用者認證（多使用者支援）
- [ ] API Rate Limiting
- [ ] 擴充 pytest 測試覆蓋率

---

## 平台統計

| 項目 | 數量 |
|------|------|
| API 路由 | 73 |
| 工具頁面 | 7 |
| JS 模組 | 8 |
| 後端服務模組 | 10 |
| 資料庫表 | 7 |
| 資料模型 | 5 (contact, group, template, history, sender) |
| 邊界偵測策略 | 5 (Canny, WhiteRegion, Otsu, Laplacian, GrabCut) |
| 掃描濾鏡 | 7 (auto, scan, color_doc, document, enhance, bw, original) |
| 郵件模板 | 8 種文件類型預設 + 自訂 |
| 測試 | 18 |

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
