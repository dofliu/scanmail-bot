# 每日自動開發紀錄

每天 03:00 的 Routine（見 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)）每次執行完在這裡加一筆。

**下一天的 session 是乾淨環境、沒有記憶，會先讀這份決定要不要接手上次的東西。**
所以「下一步」那欄要寫得能直接動手，不要寫「繼續優化」這種話。

格式：最新的放最上面。

---

## 2026/08/04 — 伺服器位址存進原生儲存

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[0]`：App 的後端位址還存在 `localStorage`，系統清一次快取就得重打一次 IP |
| 分支 | `claude/nightly-server-address-preferences` |
| PR | [#47](https://github.com/dofliu/scanmail-bot/pull/47)（草稿，base `main`）|
| 結果 | 完成，v3.19.0。`static/js/config.js` 拆成**兩段**：開機仍同步讀 `localStorage`（App 內它是原生儲存的鏡像，所以 `apiBase` 一載入就有值、下游零影響），新增的 `ready()` 再非同步跟 `SMNative.store` 對答案 —— 鏡像被清掉就把位址救回來並補寫鏡像，原生儲存沒有這個 key 就把舊位址搬過去（沿用簽名庫「沒有 key＝該搬家」那套契約）。`native.js` 的 `init()` 先 `await SM_CONFIG.ready()` **才**判斷要不要跳伺服器設定畫面。`save()` / `clear()` 改成非同步，設定畫面等寫入落地再 reload；原生寫入失敗退回 `localStorage`。`api.js` 新增 `onApiBaseChange` 訂閱 + `rebase()`。`atoms.jsx` 的 `ServerSetting` 訂閱位址變化。測試 +25（新的 `npm run test:config`）+2 pytest。全綠 —— pytest 274 passed + 3 skipped、瀏覽器 **333** 項（image 69 / studio 81 / sign 52 / doc 51 / scan 34 / config 25 / pages 21）|
| 關鍵設計 | **選了「同步 `localStorage` 當開機快取 + 非同步校正」而不是把 `config.js` 移到 `native.js` 之後改全非同步**（上一筆建議的 (a) 案）。理由：位址被 `api.js` 在載入時就組成字串用著，改全非同步等於要所有 API 呼叫端等一個 ready promise，動到的面積遠大於這個增量該有的風險。兩段式只多一個訂閱點，而且網頁版 / 離線版一行行為都沒變 |
| 順序才是重點 | 少了 `native.js` 那個 `await`，位址其實**還是**救得回來 —— 但設定畫面已經蓋上去了，使用者看到的沒有任何改善。所以 `tests/test_mobile_build.py` 加了一條防呆，釘住原始碼裡 `SM_CONFIG.ready()` 必須排在 `openServerSetup()` 之前 |
| 容易漏掉的地方 | `api.js` 有**七個工具前綴**（`imgBase` / `pdfBase` / `cvtBase` / `gifBase` / `vidBase` / `renBase` / `formBase`）是在載入時就先組好的字串，不像各 function 裡的 `${BASE}` 是呼叫時求值。漏掉哪一個，那一類工具就會在清過快取的裝置上打到 `https://localhost`。第二條 pytest 防呆用正規式比對「宣告的每個 `xxxBase` 都要出現在 `rebase()` 裡」 |
| 測試作法 | `mobile/test/config.test.mjs` **每個情境都真的 `page.goto()` 一次**，harness 裡有一段 prelude 在 `config.js` 之前依查詢字串佈置旗標 / `localStorage` / 假的 `window.SMCap`，讓載入順序跟 App 裡一模一樣 —— 這件事最容易錯的就是順序，用 `_internals.boot()` 在同一頁重跑會測不到。**做過 mutation 檢查**：拿掉 `native.js` 的 `await` 與 `api.js` 的訂閱，25 項裡有 4 項會紅 |
| 環境注意事項 | 沿用前幾筆：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome \| head -1) npm run test:xxx` ②`pip install -r requirements.txt` 之後補 `pip install cffi pytest`，`pip install` 加 `--timeout 120` ③改完版本號要跑一次 `python scripts/build_mobile.py`，否則 `mobile/android/version.properties` 對不上 `main.py` 會有一條 pytest 紅 ④`tests/generate_test_forms.py` 產出的 fixture 有進版控，重跑後 bytes 會變，提交前 `git checkout -- tests/fixtures/forms/` ⑤跑 `npm run test:studio` 前要先 `python scripts/build_mobile.py --offline` |
| 下一步 | 做 `roadmap[0]`：**即時取景 M1**。目標是相機預覽疊邊框（**這一步先不做自動快門**，那是 M2）。偵測本身在 v3.14.0 就好了（`static/js/scan-lite.js` 的 `detect()`，單張約 100–300ms，而且 v3.18.0 起會回傳 `hints` / `quality` 可以直接拿來即時提示「太暗」「靠近一點」）；缺的是相機那一層：`getUserMedia({video:{facingMode:'environment'}})` 取流 → `<video>` → 每隔幾幀（不要每幀，偵測要 100ms+，抓約 300–500ms 一次或用 `requestAnimationFrame` 節流）把畫面畫到離屏 canvas 跑一次 `detect()` → 把回傳的四個角畫在疊層 canvas 上。**放哪裡**：`static/js/studio.jsx` 的 `StudioDeskew` 已經是全螢幕四角編輯畫面，即時取景比較適合另開一個元件、拍完把結果交給既有的拉正流程，不要塞進 `StudioDeskew`。**注意** ①`getUserMedia` 需要安全來源 —— App 的 WebView 是 `https://localhost` 沒問題，網頁版走 `http://區網IP:8000` 會被擋，要在沒有相機權限時優雅退回「選檔案」②離線版也要能用（不能依賴後端）③Android 需要 `CAMERA` 權限，看 `mobile/android/app/src/main/AndroidManifest.xml` 有沒有，沒有要補。測試補在新的 `npm run test:camera` 或延伸 `test:scan`，用假的 `navigator.mediaDevices.getUserMedia` 回一個 canvas captureStream（Playwright 也可以用 `--use-fake-device-for-media-stream`，但假的 `getUserMedia` 比較好控內容）。做完把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md`「即時取景」的 M1 打勾 |

## 2026/08/03 — 低信心時說得出「為什麼」（重拍建議）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[1]`：偵測沒把握時只講一句「⚠ 沒把握抓對」，使用者不知道該改什麼 |
| 分支 | `claude/nightly-retake-hints` |
| PR | [#46](https://github.com/dofliu/scanmail-bot/pull/46)（base `main`）|
| 結果 | 完成，v3.18.0。`static/js/scan-lite.js` 新增 `assess()`：逐像素掃一次四邊形內部，取得積分圖給不了的過曝比例與梯度分布，換算成五種說得出口的原因 —— `cropped` / `dark` / `glare` / `far` / `flat`，量不出原因就退回一句通用的 `unknown`（不沉默）。依嚴重程度排序、最多 3 條。`detect()` 一律回傳 `hints` 與 `quality`，抓得準時 `hints` 是空陣列。`studio.jsx` 的拉正畫面在警告下方列出建議，信心足夠時不顯示。**門檻是量出來的**：先寫了一支校正腳本跑合成的「拍壞」樣本，確認正常照片離每個門檻都還有一大段（昏暗但清楚的照片量到 100，離 `dark` 的 85 有餘裕）。測試 +13（偵測 22 → 34、介面 80 → 81）。全綠 —— pytest 272 passed + 3 skipped、瀏覽器 **308** 項（image 69 / studio 81 / doc 51 / sign 52 / scan 34 / pages 21；`sign 52` 是併入 PR #45 之後的數字）|
| CI | 7 項全綠。**上一筆記錄的「Android `build` job 卡住」這次沒有重現** —— 完整跑完只花 4 分 20 秒（6 支瀏覽器測試 → assembleDebug → 離線建置 → studio 測試 → 離線 assembleDebug），`Test offline studio UI` 50 秒、跟本機一致。看來是當時 runner 的偶發問題，不是這個 workflow 本身有病，下一次不必預期它會卡 |
| 刻意沒做 | **「照片糊掉」的建議**。原本在清單裡，量完發現用現有的梯度圖分不出來：一張清楚的空白紙 p95 梯度 68，一張糊到看不清字的也是 68（`features()` 又先做過半徑 2 的模糊）。誤報一次使用者就不再相信這些提示，所以寧可不給。理由與兩條可行的作法（在 `features()` 留一份未模糊的高頻能量、或改量邊緣寬度）已寫進 `docs/TODO.md` 後續工作 |
| 版本號 | **用 3.18.0 而不是 3.17.0** —— 開工時 PR #45 已經佔用 3.17.0 但還沒合併，兩邊都從 `main`（3.16.0）長出來，同時用 3.17.0 會是實際的錯誤。#45 後來在這一晚稍後合併了，所以 3.18.0 正好接在它後面 |
| 合併衝突 | 開工時 PR #45 還開著，所以這條分支是從 #45 之前的 `main` 長出來的。#45 合併之後如預期在 7 個檔案起了衝突，已經在分支上 merge `origin/main` 解掉：`main.py` / `version.properties` 取 3.18.0；`STATUS.yaml` 的 `roadmap` 把**兩項都**移除（#45 的簽名庫、這次的重拍建議），`recent_changes` 串成 v3.18.0 → v3.17.0；`docs/TODO.md` 依合併順序把這次的 Phase 18 改編號成 **Phase 19**，兩張後續工作的新列都留著；`ARCHITECTURE.md` 的 `scan-lite.js` 與 `sign-lite.js` 兩列各取一邊；`ANDROID.md` 的已知限制留下兩邊各自新增的那條 |
| 環境注意事項 | 沿用上一筆：①**不要跑 `playwright install`**，改用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx` ②`pip install -r requirements.txt` 之後要再補 `pip install cffi pytest`，否則 `tests/generate_test_forms.py` 會在 `cryptography` 掛掉；`pip install` 加 `--timeout 120` ③`tests/generate_test_forms.py` 產出的 fixture 是有進版控的，重跑之後 bytes 會變 —— 提交前記得 `git checkout -- tests/fixtures/forms/` ④跑 `npm run test:studio` 前要先 `python scripts/build_mobile.py --offline`（改過 `static/` 就要重跑一次） |
| 下一步 | 做 `roadmap[0]`：**伺服器位址也改用 `SMNative.store`**（這一項是 PR #45 排進 roadmap 的，優先於即時取景）。`static/js/config.js` 的後端位址還存在 `localStorage`，跟簽名庫原本的問題一樣 —— 系統清一次快取就得重設。`SMNative.store`（`static/js/native.js`）已經在了，只差接上。**難處在載入順序**：`config.js` 在 `index.html` 裡排在 `native.js` **之前**，而且是同步讀取位址，所以不能直接改成 `await store.get()`。兩條路可選 —— (a) 把 `config.js` 移到 `native.js` 之後、位址改成非同步取得，呼叫端等一個 ready promise（跟 `sign-lite.js` 的 `ready()` 同一套作法，可以照抄）；(b) 保持同步讀 `localStorage` 當開機快取，開場再從 Preferences 校正一次並寫回鏡像。建議 (a)，跟簽名庫一致比較好維護。記得**離線版沒有伺服器位址這個概念**，改動不能讓離線版壞掉。測試補在 `mobile/test/studio.test.mjs` 或新開一支，用假的 `window.SMCap`（`mobile/test/signature.test.mjs` 有現成的模擬方式可以照抄），驗「App 內存進 Preferences」「清掉 `localStorage` 之後位址還在」「瀏覽器走 `localStorage`」。做完把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md` 對應那列刪掉。再下一項才是即時取景 M1 |

## 2026/08/02 — 簽名庫存進原生儲存（Capacitor Preferences）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[0]`：簽名庫存在 `localStorage`，App 內清一次快取就沒了 |
| 分支 | `claude/nightly-signature-preferences` |
| PR | [#45](https://github.com/dofliu/scanmail-bot/pull/45)（草稿） |
| 結果 | 完成，v3.17.0。`static/js/native.js` 新增 `SMNative.store`（`isDurable` / `get` / `set` / `remove`）—— App 走 Capacitor Preferences（原生 SharedPreferences），瀏覽器退回 `localStorage`；`@capacitor/preferences` 本來就在相依裡，只是一直沒接上。**關鍵設計**：App 內 `get()` 只問 Preferences、**不**因為它沒有就去翻 `localStorage`，因為「原生儲存沒有這個 key」正是「要不要把舊資料搬過去」的判斷依據，退回去讀就永遠搬不成；只有外掛丟例外才退回。`sign-lite.js` 新增 `ready()` / `flush()`：Preferences 是非同步的而 `list()` 被同步的畫圖路徑用著，所以 App 內多留一份記憶體副本（`cache`），網頁版 `cache` 恆為 `null`、逐次讀 `localStorage`，多分頁行為零變化。升級後第一次執行自動搬家。`studio.jsx` 的 `useSignatures` 改成先 `await ready()`。測試 +7（簽名 45 → 52），用假的 `window.SMCap` 驗搬家 / 清掉 localStorage 後還在 / 存刪寫進 Preferences / 外掛壞掉的退路 / 桌面瀏覽器不碰原生儲存。全綠 —— pytest 272 passed + 3 skipped、瀏覽器 295 項（image 69 / studio 80 / sign 52 / doc 51 / scan 22 / pages 21）|
| CI | **全綠，一次過**。`test (3.10)` / `test (3.11)` 各約 65 秒；`Android App / build` 3 分 42 秒跑完，六支瀏覽器測試 + 兩個 APK 都成功 —— 前一天（PR #44）那個 `Assemble debug APK` 卡住不回報進度的狀況**沒有重演**，看來是當時 runner 的偶發問題，不是設定有錯，不用特別處理 |
| 順手修掉的 | `docs/ANDROID.md`「離線精簡版的取捨」還列著「取景不會跟著旋轉走」，那是 v3.16.0 已經做掉的，一併移除 |
| 環境注意事項 | 跟前一天一樣，照做省時間：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx` ②`pip install -r requirements.txt` 之後要再補 `pip install cffi pytest`，否則 `tests/generate_test_forms.py` 會在 `cryptography` 掛掉；`pip install` 加 `--timeout 120` 免得 read timeout ③跑 `npm run test:studio` 前要先 `python3 scripts/build_mobile.py --offline` 重新打包，不然測到的是舊的 `mobile/www/` |
| 下一步 | 做 `roadmap[0]`：**低信心時的重拍建議**。`static/js/scan-lite.js` 的 `detect()` 信心 < 0.45 時回 `method: 'fallback'`，介面（`studio.jsx` 的 `StudioDeskew`，找「低信心變色提醒」那段）目前只說「沒把握」，沒告訴使用者該怎麼補救。作法：偵測時**已經算過**的統計量（四邊形內部亮度、邊緣強度、面積佔比 —— 看 `scan-lite.js` 評分那一段拿得到哪些）挑幾個訂門檻，對應成「太暗了，找亮一點的地方」「離太遠，靠近一點」「有反光，換個角度」這種可執行的文案，回傳結構多帶一個 `hint` 欄位，UI 顯示出來。補 `npm run test:scan` 的測試 —— 合成一張刻意過暗 / 刻意太小的影像，驗 `hint` 是對應那一則（既有測試就是用合成影像量角點誤差，照抄那套產圖方式）。做完把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md`「手邊就能做的小東西」對應那列刪掉 |

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
