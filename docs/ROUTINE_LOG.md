# 每日自動開發紀錄

每天 03:00 的 Routine（見 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)）每次執行完在這裡加一筆。

**下一天的 session 是乾淨環境、沒有記憶，會先讀這份決定要不要接手上次的東西。**
所以「下一步」那欄要寫得能直接動手，不要寫「繼續優化」這種話。

格式：最新的放最上面。

---

## 2026/08/01（第二筆）— 排出後續 10 個增量的 roadmap（無程式異動）

| 項目 | 內容 |
|------|------|
| 主題 | 使用者要求規劃後續方向並寫進設定檔，讓之後的 routine 不用每次重新排序 |
| 分支 | `claude/friendly-mendel-gae5rh` |
| PR | 見分支上的草稿 PR |
| 結果 | 完成。`STATUS.yaml` 新增 `roadmap` 陣列（10 項，依投報率 ÷ 風險排好，每項一行摘要）；`next_milestone` 改指向 `roadmap[0]`。`docs/TODO.md`「後續工作」把「即時取景」「標註工具」「裝置端 OCR」三個大功能拆成 M1/M2 checkbox，跟 roadmap 對齊。`docs/DAILY_ROUTINE.md` 更新選題流程：預設直接挑 `roadmap[0]`，不必重新從 TODO.md 排序；收尾契約加一條「做完的項目要從 roadmap 移除」。這樣以後的 session 開場只看 `STATUS.yaml` 就知道下一步，TODO.md 仍保留完整的「為什麼還沒做」 |
| 下一步 | 直接做 `roadmap[0]`：**取景跟著旋轉走（rotateFit）**。調好構圖後按旋轉 / 拉正，對焦點目前還是原本的相對位置，畫面會跳一下；裁切框已經有 `rotateRect` 可以照抄邏輯，在 `image-local.js` 比照做一個 `rotateFit`，補裝置端引擎測試（`npm run test:image`）。做完記得把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md` 對應的表格列刪掉 |

## 2026/07/31 — GitHub Release 步驟（一鍵安裝 APK）

| 項目 | 內容 |
|------|------|
| 主題 | 打 `android-v*` 標籤時自動建立 GitHub Release，附上免登入就能點下去裝的 `.apk` |
| 分支 | `claude/nightly-android-release` |
| PR | 見分支上的草稿 PR |
| 結果 | 完成。`.github/workflows/android.yml` 在 tag 觸發的段落新增：分別重跑一次 `build_mobile.py --sync` / `--offline --sync` 各自 `assembleRelease`（順便修掉一個既有 bug —— 原本兩個 release 建置共用同一次「離線」sync，導致 `scanmail-release-apk` 這個 artifact 掛完整版名字、內容卻是離線版），再用 runner 內建的 `gh` CLI 建立 / 更新 Release，附上 `scanmail-<tag>-full.apk` 與 `scanmail-<tag>-offline.apk`。job 加了 `permissions: contents: write`。這是 workflow 設定變更，不動 `static/`，`pytest tests/ -q`（275 項）全綠，不需要跑瀏覽器測試。**注意**：這次改動未經實際打 tag 驗證（沒有推 `android-v*` 標籤觸發過），下一次如果手邊有空，建議打一個測試 tag 驗證 gh release 建立與 APK 內容是否如預期 |
| 下一步 | 從 [TODO.md](TODO.md)「後續工作」挑下一項，目前排最前面的是「取景跟著旋轉走」（比照 `rotateRect` 做一個 `rotateFit`）或「即時取景」（相機預覽疊邊框 + 自動快門，`scan-lite.js` 偵測已就緒，缺 `getUserMedia` 取流那一層）|

## 2026/07/30 — Routine 建立（無程式異動）

| 項目 | 內容 |
|------|------|
| 主題 | 建立每日 03:00 的持續開發 Routine 與收尾契約 |
| 分支 | `claude/daily-routines-setup-xjrtfd` |
| PR | 見分支上的草稿 PR |
| 結果 | 完成。Trigger `trig_01FmvRiLcNdxu1YjraTZ3Vex`（cron `0 19 * * *` UTC = 03:00 台灣時間），每次開新 session。新增 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)（作業規則）與這份紀錄；README 文件表、STATUS.yaml、TODO.md 變更日誌同步 |
| 下一步 | 第一次自動執行從 [TODO.md](TODO.md)「後續工作 → 手邊就能做的小東西」挑一項。建議 **GitHub Release 步驟**（`android-v*` 標籤目前只上傳 artifact，repo 裡沒有免登入就能裝的 `.apk`；只需在 `.github/workflows/android.yml` 加一步），它同時也是 `STATUS.yaml` 目前的 `next_milestone` |
