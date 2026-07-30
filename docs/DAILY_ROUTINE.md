# 每日自動開發 Routine

> 最後更新：2026/07/30

每天**台灣時間凌晨 03:00**，排程會在一個乾淨的 remote 環境裡喚醒一個新的 Claude Code
session，把 ScanMail+ 往前推**一個小而完整的增量**，然後把進度寫回專案文件。

這份檔案就是那個 session 的作業規則。排程訊息裡有一份摘要，但**衝突時以這份為準** ——
規則進版控才改得動，改排程訊息還要另外操作。

---

## 排程設定

| 項目 | 值 |
|------|------|
| Routine 名稱 | ScanMail+ 持續開發（每天 03:00） |
| Trigger ID | `trig_01FmvRiLcNdxu1YjraTZ3Vex` |
| Cron（UTC） | `0 19 * * *` |
| 實際時間 | 每天 03:00（台灣時間 UTC+8） |
| 每次執行 | 開**新的** session（乾淨環境，不接續前一天的對話） |
| 通知 | 完成後推播到手機 |

要調整時間、暫停或改規則：

- **改時間 / 暫停** —— 對 Claude 說「把 ScanMail+ 的 routine 改成 X 點」或「先停掉」，
  也可以在 claude.ai 的 Routines 介面操作。UTC+8 換算成 cron 要減 8 小時
  （03:00 台灣 → `0 19 * * *` UTC）。
- **改作業規則** —— 直接改這份檔案，下一次執行就會讀到。
- **改任務描述本身**（例如換一個主軸方向）—— 要改排程訊息，不是改這份檔案。

---

## 每次執行的流程

### 0. 先看有沒有沒收尾的東西

**不要一開始就開新題。** 順序是：

1. `git fetch origin main && git log --oneline -15`
2. 讀 [ROUTINE_LOG.md](ROUTINE_LOG.md) 最後幾筆 —— 上次做了什麼、有沒有留下待續事項。
3. 有 GitHub MCP 工具的話，看 open PR。
   **前一次的 PR 還開著（CI 紅燈、或有 review 意見）就先把它追到綠燈 / 回覆完**，
   不要讓未完成的 PR 一天一天疊上去。
4. 都清乾淨了，才進入新題。

### 1. 定位

| 讀什麼 | 為什麼 |
|------|------|
| `STATUS.yaml` | 進度、`next_milestone`、目前的 key metrics |
| [TODO.md](TODO.md) 「已完成功能」 | Phase 1–17 做過的事，別重造輪子 |
| [TODO.md](TODO.md) 「**後續工作**」 | **選題來源**，每項都寫了為什麼還沒做 |
| [TODO.md](TODO.md) 「評估過、決定不做的」 | **不要碰**：去背、裝置端影片處理、iOS、等寬字型 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 模組分工、裝置端引擎那一側 |
| [ANDROID.md](ANDROID.md) | App 建置流程、離線版功能、簽章 |

### 2. 選一個「今天的增量」

從「後續工作」依**投報率 ÷ 風險**挑下一個合理的小步。判準：

- 範圍要能在**這一次 session 內做完＋測試＋開 PR**。做不完的不是好選擇。
- 大功能就拆，只做其中一個子步，其餘寫回 TODO.md ——
  例如「即時取景」可以先只做 `getUserMedia` 取流與每隔幾幀跑偵測，
  穩定度判斷與自動快門留給下一次。
- 同樣投報率的，優先選**風險低、可回歸測試**的那個。
- 手邊小東西（取景跟著旋轉走、低信心重拍建議、簽名庫換 Preferences 等）
  隨時可以拿一個來做；它們就是為了這種場合列的。

### 3. 開發

從最新 main 開一條新分支，**每天換主題名，不要重用舊分支或已合併的分支**：

```bash
git fetch origin main
git checkout -B claude/nightly-<簡短英文主題> origin/main
```

守住既有約定：

- **`static/` 是唯一的前端來源。** App 版由 `scripts/build_mobile.py` 打包到
  `mobile/www/`，**不要直接改 `mobile/www/`**（會被下次打包蓋掉）。
- 後端路由進 `app/routers/`、邏輯進 `app/services/`、共用基礎設施在 `app/core/`。
- 裝置端引擎在 `static/js/`：`image-local.js`（圖片）、`scan-lite.js`（邊界偵測）、
  `sign-lite.js`（簽名 / 印章）、`pdf-lite.js` / `pdf-write.js`（PDF 讀寫）、
  `doc-local.js`（文件轉檔）。離線版不能依賴後端，也不能引外部 CDN。
- 前端不要新增外部連結 —— `build_mobile.py` 會檢查，離線版一定要打包進去。

### 4. 品質關卡（沒綠燈不准推）

```bash
pip install -r requirements.txt
python tests/generate_test_forms.py     # 表單 fixture
python -m pytest tests/ -q
```

中文渲染測試需要 CJK 字型（沒有的話 ReportLab 會把中文畫成 `\x00`），
安裝方式見 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。

動到前端或裝置端引擎，就跑對應的瀏覽器測試：

```bash
cd mobile && npm ci
npm run test:image   # 圖片引擎
npm run test:doc     # 文件轉檔
npm run test:pages   # PDF 頁面操作
npm run test:sign    # 簽名蓋章
npm run test:scan    # 邊界偵測
npm run test:studio  # 離線版介面（要先跑過 build_mobile.py --offline）
```

容器內 Chromium 已經在 `/opt/pw-browsers/chromium`，
**不要執行 `playwright install` 重新下載**。

**新功能一律補測試。** 裝置端的東西尤其要 —— Canvas / zip / PDF 只有真的瀏覽器驗得出來。

### 5. 交付

```bash
git push -u origin claude/nightly-<主題>
```

- 有 GitHub MCP 工具：開一個**草稿 PR**（base：`main`），訂閱 PR 活動，把 CI 追到綠燈。
- 沒有 MCP 工具：分支照樣 push，並在結束訊息輸出分支名與
  `https://github.com/dofliu/scanmail-bot/pull/new/<branch>`，請使用者手動開 PR。
  **不要因為開不了 PR 就丟掉整晚的成果。**

### 6. 收尾契約 —— 這一步沒做，等於這天沒做

下一天的 session 是**乾淨環境、沒有記憶**，只能靠這些檔案接手。
所以在同一個 PR 裡一定要更新：

| 檔案 | 更新什麼 |
|------|------|
| `STATUS.yaml` | `last_updated`、`recent_changes`；必要時 `next_milestone`、`key_metrics` |
| [TODO.md](TODO.md) | 勾掉完成項、把拆出來的後續補進「後續工作」、「變更日誌」加一則（含版本號） |
| [ROUTINE_LOG.md](ROUTINE_LOG.md) | **加一筆**：日期／主題／分支／PR／結果／下一步 |
| [ARCHITECTURE.md](ARCHITECTURE.md) / [ANDROID.md](ANDROID.md) | 動到架構或 App 就順手更新 |
| [README.md](../README.md) | 新增功能、API 端點數、測試數有變就更新 |

版本號沿用既有慣例：功能增量往 minor 走（v3.15.0 → v3.16.0），修正往 patch 走。
**唯一來源是 `main.py` 的 `version="x.y.z"`** —— 改那裡就好，
App 的 versionName / versionCode 由 `scripts/build_mobile.py` 同步（見 ANDROID.md）。

### 7. 收尾原則

- **寧小而完整。** 不要在分支上留下半套、沒測試的改動。
- 卡關就把進度與剩餘待辦寫進 PR 描述與 TODO.md，
  並在 ROUTINE_LOG.md 記成「未完成 ／ 原因」—— 下一次才知道要不要接手。
- 一次一個增量，循序漸進。
- 跟使用者溝通用繁體中文。
