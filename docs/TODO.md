# ScanMail+ 開發規劃與 TODO

> 最後更新：2026/03/28

---

## 已完成功能 ✅

### Phase 1：核心掃描郵寄（已完成）

- [x] FastAPI 後端 REST API 架構
- [x] 前端 SPA 單頁應用（4 步驟 wizard：拍照→選收件人→預覽→寄送）
- [x] 手機/桌機攝影機即時預覽
- [x] Google Gemini Vision API 整合（8 種文件類型辨識）
- [x] AI 自動產生郵件主旨、正文、附件檔名
- [x] 圖片轉 PDF（A4 適配）+ 多頁 PDF
- [x] SMTP 郵件寄送（多策略自動嘗試）
- [x] 聯絡人 CRUD、寄送歷史、寄件人設定

### Phase 2：掃描後處理（已完成）

- [x] OpenCV 文件邊界偵測（4 種策略）
- [x] 透視校正 + 失真補償（LANCZOS4 插值）
- [x] 專業掃描濾鏡（形態學背景估計、保色白化、歪斜校正）
- [x] Canvas 角點拖曳編輯器 + 邊界視覺化
- [x] 圖片旋轉（90°/180°/270°）
- [x] 多頁掃描（拖曳排序、刪除、縮圖預覽）

### Phase 3：平台架構重構（已完成）

- [x] main.py 精簡為 App Factory，路由模組化（routers/）
- [x] 共用基礎設施（core/sessions, core/file_manager, core/tasks）
- [x] CSS/JS 分離（static/css/, static/js/）
- [x] 工具導航系統（7 個工具 tab）
- [x] 背景任務管理器（ThreadPoolExecutor + SSE 即時進度）

### Phase 4：圖片工具（已完成 — 整合自 myPicasa）

- [x] 批次縮放（fit/cover/stretch 三種模式）
- [x] 格式轉換（JPG/PNG/WebP/BMP/GIF 互轉）
- [x] 批次壓縮（品質控制 + 最大邊長）
- [x] 浮水印（文字/圖片，平鋪/指定位置，透明度/顏色）
- [x] 拖放上傳 + 單檔直回/批次背景任務 + ZIP 下載

### Phase 5：PDF 工具 + 文件轉檔（已完成 — 整合自 myPicasa）

- [x] PDF 合併（多檔 + 自動書籤目錄）
- [x] PDF 文字浮水印（平鋪/透明度/旋轉角度）
- [x] PDF 圖片浮水印
- [x] PDF 密碼保護
- [x] Word → PDF（python-docx + ReportLab，支援中文）
- [x] PDF → Word（pymupdf 文字提取）
- [x] Markdown → PDF / Word
- [x] Word → Markdown

### Phase 6：GIF + 影片工具（已完成 — 整合自 myPicasa）

- [x] 圖片序列 → 動畫 GIF（自訂幀率/尺寸/縮放模式）
- [x] 影片合併（moviepy + libx264）
- [x] 影片轉 GIF（FPS/寬度/起止時間截取）
- [x] 影片壓縮（解析度降低 + CRF 品質控制）

### Phase 7：批次改名（已完成 — 整合自 myPicasa）

- [x] 前綴/後綴添加
- [x] 搜尋取代
- [x] 流水編號（位數/起始值/位置）
- [x] 即時預覽改名結果
- [x] 套用後打包 ZIP 下載

---

## 待開發功能 🚧

### 掃描體驗精進

- [ ] 裁切後即時預覽 — 拖曳角點時即時顯示校正後效果
- [ ] 邊界偵測優化 — 複雜背景辨識率提升

### 使用者體驗優化

- [ ] PWA 支援 — manifest.json + Service Worker
- [ ] 深色模式
- [ ] 批次寄送 — 同一份文件寄給多位收件人
- [ ] 郵件模板 — 針對不同文件類型
- [ ] 收件人群組

### 部署與維運

- [ ] Docker 容器化部署測試
- [ ] 使用者認證（多使用者支援）
- [ ] API Rate Limiting
- [ ] 擴充 pytest 測試覆蓋率

---

## 平台統計

| 項目 | 數量 |
|------|------|
| API 路由 | 62 |
| 工具頁面 | 7 |
| JS 模組 | 8 |
| 後端服務 | 10 |
| 背景任務 | SSE 即時進度 |
| 測試 | 18 |

---

## 變更日誌

### 2026/03/28 (v3.0.0 — ScanMail+)
- 整合 myPicasa (MediaToolkit) 為統一 Web 平台
- 新增 6 個工具：圖片工具、PDF 工具、文件轉檔、GIF 製作、影片工具、批次改名
- 架構重構：路由模組化、CSS/JS 分離、工具導航系統
- 新增背景任務管理器 + SSE 即時進度推送

### 2026/03/24 (v2.0.0)
- 重構為 Web App（REST API + SPA）
- 文件掃描後處理（OpenCV 邊界偵測/透視校正/濾鏡）
- 圖片旋轉 + 多頁掃描
