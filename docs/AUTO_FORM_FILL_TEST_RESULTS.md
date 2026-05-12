# Auto Form Fill — 端對端測試結果

> 執行時間：2026-05-12（M1 Skeleton 階段）
> 執行命令：`python tests/test_form_fill_e2e.py`

---

## 測試環境

- Python 3.11
- pypdf 6.11, reportlab 4.5, pdfplumber 0.11.9, pymupdf 1.27, Pillow 12
- **GEMINI_API_KEY 未設定** — Layer 4 走 graceful fail path

---

## Fixture（4 種代表性表單）

`tests/generate_test_forms.py` 自動產生，存於 `tests/fixtures/forms/`：

| 檔案 | 型態 | 預期 backend |
|------|------|------|
| `acroform_application.pdf` | 帶 AcroForm 欄位的英文申請表 | Layer 1 (acroform) |
| `flat_travel_expense.pdf` | 文字 PDF — 差旅費報銷單 | Layer 2 (pdfplumber) |
| `flat_meeting_signin.pdf` | 文字 PDF — 會議簽到表（含 header 干擾） | Layer 2 (pdfplumber) |
| `scanned_leave_form.png` | 模擬掃描影像（含格線雜訊）— 請假單 | Layer 4 (gemini) |

---

## 結果摘要

| Test | Backend | 偵測欄位 | 語意對應 | 寫回 PDF | 狀態 |
|------|---------|---------|---------|---------|------|
| 1. AcroForm | acroform | **7 / 7** (100%) | 6/7 | ✓ | ✅ PASS |
| 2. Flat travel | pdfplumber | **10 / 10**（含 Signature） | 6/10 | ✓ 中文正常 | ✅ PASS |
| 3. Flat meeting | pdfplumber | 8 / 8（去重後） | 6/8 | ✓ 中文正常 | ✅ PASS |
| 4. Scanned image | gemini | 0（無 API key） | — | skip | ✅ graceful fail |

填好的 PDF 輸出於 `tests/fixtures/filled/`（不入版控）。

---

## 分項觀察

### Test 1 — AcroForm（Layer 1）

- 7 個欄位全數命中、bbox + label 完美。
- semantic mapping 對應 6 個（Conference 不在預設規則中是合理的）。
- ⚠️ pypdf 對 ASCII-only 字型（Helvetica）寫入 CJK 會警告，已加 `auto_regenerate=True` 讓 viewer 重新渲染外觀。

### Test 2 — Flat travel expense（Layer 2）

```
Name: 王小明
Title: 副教授
Department: 電機工程系
Email: wang@ncut.edu.tw
Phone: 04-2392-4505
Date: 2026-05-12
Destination: (empty - 無對應規則)
Amount:      (empty)
Purpose:     (empty)
Signature:   (empty)
```

- 加大 `_LABEL_KEYWORDS` 後從 6 → 10 欄位；CJK 字型透過 `_register_cjk_font()` 寫入正常。
- semantic_mapper 還沒有 Destination/Amount/Purpose 規則（這些屬於「填表內容」而非「使用者資料」，本來就需要使用者輸入）。

### Test 3 — Flat meeting signin（Layer 2）

之前 header `Meeting Sign-in Sheet / Subject` 與 `Subject:` 欄位都被抓進來造成重複。修正方式：

1. `_LABEL_REGEX` 改成「**必須以冒號結尾**」才算 label，header 自然被排除
2. 加 dedup key `(page, label_lower, top)` 避免同一行多次命中

### Test 4 — Scanned image（Layer 4）

- 無 GEMINI_API_KEY 時，dispatcher 進到 `gemini_vision.detect()`，發現缺 key 後回傳 `notes="GEMINI_API_KEY 未設定"` 的空結果，**沒有 crash**
- 待測：給定 API key 後的真實 bbox 精度（M4 階段重點）

---

## 修正紀錄（同 PR 內）

| 檔案 | 修正 |
|------|------|
| `app/services/form_fill/filler.py` | 新增 `_overlay_font()`，從 `doc_converter._register_cjk_font()` 取得可用 CJK 字型 |
| `app/services/form_fill/backends/acroform.py` | `update_page_form_field_values(..., auto_regenerate=True)` |
| `app/services/form_fill/backends/pdfplumber_extract.py` | `_LABEL_REGEX` 改為「冒號結尾才算」+ 多字 chunk 拼接 + dedup |

---

## 下一步測試重點

1. **真實 Gemini API 測試**（需 key）：對 `scanned_leave_form.png` 跑完整流程，量 bbox 平均誤差
2. **政府電子表單實測**：找一份真實的 e-Tax / 報名表 AcroForm 跑，看欄位 label tooltip 命名是否友善
3. **中文 flat PDF**：找一份用 Word 輸出的中文表單測 Layer 2（目前 fixture 是英文 label）
4. **複合輸入**：AcroForm + 中文混合表單，看寫回後 viewer 顯示
