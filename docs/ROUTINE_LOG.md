# 每日自動開發紀錄

每天 03:00 的 Routine（見 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)）每次執行完在這裡加一筆。

**下一天的 session 是乾淨環境、沒有記憶，會先讀這份決定要不要接手上次的東西。**
所以「下一步」那欄要寫得能直接動手，不要寫「繼續優化」這種話。

格式：最新的放最上面。

---

## 2026/08/03 — 低信心時說得出「為什麼」（重拍建議）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[1]`：偵測沒把握時只講一句「⚠ 沒把握抓對」，使用者不知道該改什麼 |
| 分支 | `claude/nightly-retake-hints` |
| PR | #46（草稿，base `main`）|
| 結果 | 完成，v3.18.0。`static/js/scan-lite.js` 新增 `assess()`：逐像素掃一次四邊形內部，取得積分圖給不了的過曝比例與梯度分布，換算成五種說得出口的原因 —— `cropped` / `dark` / `glare` / `far` / `flat`，量不出原因就退回一句通用的 `unknown`（不沉默）。依嚴重程度排序、最多 3 條。`detect()` 一律回傳 `hints` 與 `quality`，抓得準時 `hints` 是空陣列。`studio.jsx` 的拉正畫面在警告下方列出建議，信心足夠時不顯示。**門檻是量出來的**：先寫了一支校正腳本跑合成的「拍壞」樣本，確認正常照片離每個門檻都還有一大段（昏暗但清楚的照片量到 100，離 `dark` 的 85 有餘裕）。測試 +13（偵測 22 → 34、介面 80 → 81）。全綠 —— pytest 272 passed + 3 skipped、瀏覽器 301 項（image 69 / studio 81 / doc 51 / sign 45 / scan 34 / pages 21）|
| 刻意沒做 | **「照片糊掉」的建議**。原本在清單裡，量完發現用現有的梯度圖分不出來：一張清楚的空白紙 p95 梯度 68，一張糊到看不清字的也是 68（`features()` 又先做過半徑 2 的模糊）。誤報一次使用者就不再相信這些提示，所以寧可不給。理由與兩條可行的作法（在 `features()` 留一份未模糊的高頻能量、或改量邊緣寬度）已寫進 `docs/TODO.md` 後續工作 |
| 版本號 | **用 3.18.0 而不是 3.17.0** —— PR #45 已經佔用了 3.17.0，但還沒合併。兩邊都從 `main`（3.16.0）長出來，同時用 3.17.0 會是實際的錯誤；跳號只是少一個數字。`main.py`、`docs/TODO.md`、`STATUS.yaml`、PR 描述都照 3.18.0 寫 |
| 未收尾 | **PR #45（v3.17.0，簽名庫改用 Capacitor Preferences）做完了、CI 全綠，但還沒合併。** 這次沒有動它 —— 它沒有紅燈也沒有 review 意見，只是等使用者按合併。兩個 PR 都改了 `STATUS.yaml` / `docs/TODO.md` / `docs/ROUTINE_LOG.md`，先合併哪一個，另一個都會在這三份文件上有小衝突，取兩邊的內容即可 |
| 環境注意事項 | 沿用上一筆：①**不要跑 `playwright install`**，改用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx` ②`pip install -r requirements.txt` 之後要再補 `pip install cffi pytest`，否則 `tests/generate_test_forms.py` 會在 `cryptography` 掛掉；`pip install` 加 `--timeout 120` ③`tests/generate_test_forms.py` 產出的 fixture 是有進版控的，重跑之後 bytes 會變 —— 提交前記得 `git checkout -- tests/fixtures/forms/` ④跑 `npm run test:studio` 前要先 `python scripts/build_mobile.py --offline`（改過 `static/` 就要重跑一次） |
| 下一步 | 先確認 PR #45 合併了沒。**合併了**：把「簽名庫改用 Capacitor Preferences」從 `STATUS.yaml` 的 `roadmap` 移除，然後做新的 `roadmap[0]`：**即時取景 M1**。作法 —— 在 `static/js/` 加一支相機層（離線版不能引 CDN），`getUserMedia({ video: { facingMode: 'environment' } })` 取流畫進 `<video>`，用 `requestAnimationFrame` 每隔 4–6 幀把當下畫面畫到離屏 canvas 再餵給 `SMScanLite.detect()`（單張 100–300ms，所以要用旗標擋住重入，不能每幀都跑），偵測結果的四個角疊在預覽上畫 SVG polygon —— 樣式直接抄 `studio.jsx` 的 `StudioDeskew`（低信心黃框 / 高信心綠框），順便把這次做的 `hints` 一起顯示在預覽下方，即時取景正是它最有價值的地方。**先不做自動快門**（那是 M2）。測試用假的 `getUserMedia`（`navigator.mediaDevices` 可以在測試裡覆寫，回傳一個從 canvas `captureStream()` 來的軌道），驗「有跑偵測」「框有更新」「離開畫面時軌道有停掉」。**沒合併**：不要動它，照樣做即時取景 M1，並在 PR 描述註明版本號往下一號走 |

## 2026/08/01（第三筆）— 取景跟著旋轉走（rotateFit）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[0]`：拼貼的格子內取景在旋轉 / 翻面 / 拉正之後會飄掉 |
| 分支 | `claude/nightly-rotate-fit` |
| PR | 見分支上的草稿 PR |
| 結果 | 完成，v3.16.0。`static/js/image-local.js` 新增 `rotateFit` / `flipFit`，`studio.jsx` 的旋轉 / 翻面接上（原本只帶 `cropRect`）；`deskewItem` / `undoDeskew` 把 `fit` 跟 `cropRect` 一起設回 `null`（透視校正整張重新映射，舊對焦點沒有意義）。座標映射刻意跟 `rotateRect` 同一套，並用「拿一個沒有大小的裁切框跟 `rotateFit` 對答案」的測試把這個約束釘住。測試 +15（圖片引擎 54 → 69），含一組三色直帶的像素驗證：旋轉前後格子中央取樣要同色，另外刻意保留一個「沒跟著轉會看到綠色」的對照案例。全綠 —— pytest 272 passed + 3 skipped、瀏覽器 288 項（image 69 / studio 80 / doc 51 / sign 45 / scan 22 / pages 21）|
| CI | `test (3.10)` / `test (3.11)` / GitGuardian ✅。`Android App / build` **沒跑完** —— 兩次嘗試都在 `Assemble debug APK`（Gradle）停住不動，不是失敗、是不回報進度；這個 workflow 歷史上 4–5 分鐘就跑完（run #30–#35）。**跟這個 PR 無關**：真正會被這個 diff 影響的 6 支瀏覽器測試在 attempt 2 全部綠燈通過（`Test local image engine` 24 秒 ✅），停住的是它後面的打包步驟。已在 PR #44 留言記錄。接手的人先看 PR #44 的 Checks，如果還卡著就按 Re-run jobs |
| 環境注意事項 | 這個容器有兩個坑，下次直接照做省時間：①`npm ci` 裝的 Playwright 版本跟容器內建的 Chromium 對不上，**不要跑 `playwright install`**，改用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx`（測試本來就支援這個環境變數）②`pip install` 完要再補一個 `pip install cffi pytest`，否則 `tests/generate_test_forms.py` 會在 `cryptography` 掛掉（`ModuleNotFoundError: _cffi_backend`）。`pip install` 對 files.pythonhosted.org 會 read timeout，加 `--timeout 120` |
| 下一步 | 做 `roadmap[0]`：**簽名庫改用 Capacitor Preferences**。簽名 / 印章目前存在 `localStorage`（找 `static/js/` 裡讀寫簽名庫的地方，`sign-lite.js` 與 `studio.jsx` 的簽名庫面板），換手機或清瀏覽器資料就沒了。`@capacitor/preferences` 已經在 `mobile/package.json` 的相依裡、只是沒接上；`static/js/native.js` 是既有的原生能力橋接層，加一層「有原生就用 Preferences、沒有就退回 localStorage」的儲存介面比較乾淨，網頁版與離線版都要能跑。補 `npm run test:sign` / `test:studio` 的測試（studio 測試裡已經有存簽名 → 在 PDF 分頁看得到的案例可以延伸）。做完把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md`「手邊就能做的小東西」對應那列刪掉 |

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
