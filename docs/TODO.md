# ScanMail 開發規劃與 TODO

> 最後更新：2026/03/28

---

## 已完成功能 ✅

### Phase 1：核心功能（已完成）

- [x] FastAPI 後端建立，REST API 架構
- [x] 前端 SPA 單頁應用（4 步驟 wizard：拍照→選收件人→預覽→寄送）
- [x] 手機/桌機攝影機即時預覽（getUserMedia API）
- [x] 圖片上傳與驗證
- [x] Google Gemini Vision API 整合（文件辨識）
- [x] 8 種文件類型辨識（考卷/公文/收據/合約/報告/信函/表單/其他）
- [x] AI 自動產生郵件主旨、正文、附件檔名
- [x] 智慧檔名：[文件類型]_[關鍵摘要]_[年月日_時分].pdf
- [x] 圖片轉 PDF（A4 適配）
- [x] SMTP 郵件寄送（含 HTML 簽名檔 + PDF 附件）
- [x] SMTP 多策略自動嘗試（587/25/465，STARTTLS/SSL/Plain）
- [x] 聯絡人 CRUD 管理
- [x] 寄送歷史紀錄與統計
- [x] 寄件人設定（姓名/職稱/單位/組織）
- [x] SQLite 資料庫（4 張表）
- [x] 寄送失敗正確顯示錯誤（前端判斷 success 欄位）

### Phase 2：掃描後處理（已完成）

- [x] OpenCV 文件邊界偵測（4 種策略：顏色分析/Canny/自適應閾值/GrabCut）
- [x] 透視校正（四點變換拉正文件）
- [x] 影像增強濾鏡（自動/文件/增強/黑白/原圖 共 5 種）
- [x] 背景陰影去除（光照歸一化演算法）
- [x] 前端掃描面板 UI（原始/處理後對比預覽、濾鏡切換按鈕）
- [x] API endpoints（scan/detect、scan/process、scan/filter）
- [x] **手動調整角點** — Canvas 角點拖曳編輯器（自動偵測 + 手動微調）
- [ ] **邊界偵測優化** — 手持拍攝場景辨識率待提升

### Phase 3：掃描品質提升（已完成）

- [x] 前端 Canvas 角點拖曳編輯器 — 可視化邊界框、拖曳角點手動裁切
- [x] 邊界偵測結果視覺化 — 綠色虛線邊框 + 半透明遮罩
- [x] 大角度透視校正品質改進 — 失真補償、LANCZOS4 插值
- [x] 圖片旋轉 — 90°/180°/270° 順時針/逆時針旋轉
- [x] 多頁掃描 — 連續拍攝多張，合併為一份多頁 PDF
- [x] 多頁管理 — 拖曳排序、刪除個別頁面、頁面縮圖預覽

---

## 待開發功能 🚧

### Phase 3.5：掃描體驗精進（高優先）

- [ ] 裁切後即時預覽 — 拖曳角點時即時顯示校正後效果
- [ ] 邊界偵測優化 — 複雜背景（書架、雜亂桌面）的辨識率提升

### Phase 4：使用者體驗優化（中優先）

- [ ] PWA 支援 — 加入 manifest.json 和 Service Worker，可安裝到手機主畫面
- [ ] 離線模式 — 無網路時先存到本地，恢復後自動寄出
- [ ] 深色模式
- [ ] 拖放上傳（Drag & Drop）
- [ ] 批次寄送 — 同一份文件寄給多位收件人
- [ ] 郵件模板 — 針對不同文件類型預設不同的郵件模板
- [ ] 收件人群組 — 常用群組（如：系務會議成員、教評會委員）

### Phase 5：進階功能（低優先）

- [ ] OCR 全文辨識 — 除了 AI 摘要外，另存完整 OCR 文字
- [ ] 文件搜尋 — 從歷史紀錄中全文搜尋過去寄出的文件
- [ ] Google Drive 整合 — 掃描後自動備份到 Google Drive
- [ ] 行事曆整合 — 辨識到日期時自動建議加入行事曆
- [ ] QR Code 掃描 — 辨識文件上的 QR Code 並提供連結
- [ ] 簽名欄位偵測 — 自動辨識需要簽名的位置
- [ ] 多語言介面（繁中/英文切換）

### Phase 6：部署與維運

- [ ] Docker 容器化部署（Dockerfile 已建立，待測試）
- [ ] Render / Railway 一鍵部署測試
- [ ] HTTPS 設定（Let's Encrypt）
- [ ] 使用者認證（多使用者支援）
- [ ] API Rate Limiting
- [ ] 錯誤追蹤（Sentry 整合）
- [ ] 自動化測試（擴充 pytest 覆蓋率）

---

## 已知問題 🐛

1. **掃描邊界偵測** — 手持拍攝複雜背景（書架、桌面雜物）時，邊界偵測成功率較低。正在研究改進策略。
2. **Gemini JSON 截斷** — 若 AI_MAX_TOKENS 設太低，Gemini 回應的 JSON 會被截斷。目前設為 8192 並有截斷修復機制。
3. **legacy code** — `app/handlers/` 和 `app/services/flex_builder.py` 是舊版 LINE Bot 的程式碼，目前 Web App 版本未使用，未來可清理。

---

## 開發環境

| 項目 | 版本/設定 |
|------|----------|
| Python | 3.10+ |
| FastAPI | 0.104+ |
| AI Model | gemini-3-flash-preview |
| OpenCV | 4.8+ |
| 資料庫 | SQLite 3 |
| 開發伺服器 | uvicorn --reload |
| 測試框架 | pytest |

---

## 變更日誌

### 2026/03/24
- 初始版本：LINE Bot 架構
- 重構為 Web App（移除 LINE Bot 依賴，改用 REST API + SPA）
- AI 引擎從 Anthropic Claude 切換為 Google Gemini
- 修復 Gemini JSON 解析（MAX_TOKENS/response_mime_type/截斷修復）
- 修復 SMTP 連線（多策略自動嘗試）
- 修復前端寄送結果判斷（success 欄位檢查）
- 新增文件掃描後處理（OpenCV 邊界偵測/透視校正/濾鏡）
- 新增智慧檔名（AI 辨識內容+日期時間）
- 優化相機預覽畫面大小
