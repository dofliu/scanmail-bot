# 每日自動開發紀錄

每天 03:00 的 Routine（見 [DAILY_ROUTINE.md](DAILY_ROUTINE.md)）每次執行完在這裡加一筆。

**下一天的 session 是乾淨環境、沒有記憶，會先讀這份決定要不要接手上次的東西。**
所以「下一步」那欄要寫得能直接動手，不要寫「繼續優化」這種話。

格式：最新的放最上面。

---

## 2026/08/07 — 標註工具 M1（箭頭 / 方框）

| 項目 | 內容 |
|------|------|
| 主題 | 標註工具 M1。**不是 `main` 的 `roadmap[0]`** —— 第一項（即時取景 M2）昨晚已經做在 PR #49，還開著沒合併，所以往下拿一項，跟 8/05、8/03 兩次的處置一致 |
| 分支 | `claude/nightly-annotate-shapes`（從 `origin/main` 長出來） |
| PR | 見分支上的草稿 PR |
| 開場先做的事 | **PR #49 的 CI 追完才開新題。** 昨晚那個 session 在 PR #49 留言說「Actions 一個 run 都沒建立」，我先驗了一次：整個 repo 最後一個 workflow run 停在 08/06 09:20Z，#49 推上來（08/06 19:35Z）之後 34 小時都沒有新的 run。用 `actions_run_trigger(run_workflow, android.yml, main)` 手動觸發 → **立刻就跑起來了**，代表 Actions 已經恢復、當時是暫時性的。照昨晚留的建議推一個空 commit 到 `claude/nightly-auto-shutter`，`CI` / `Android App` 兩個 workflow 都正常觸發，**#49 六個檢查全綠**（Android build 4 分 28 秒），只差合併 |
| 結果 | 完成，v3.23.0。`static/js/image-local.js` 新增 `drawAnnotations()`（箭頭 + 方框），`renderItem()` 的順序變成 裁切 → 打碼 → **標註**。介面新增 `StudioAnnotator` 與工具列的「✎ 標註」。**順手把拖框手勢抽成共用的 `useDragBoxes`**，打碼與標註真的走同一份程式 |
| 三個決定 | ①**存起點 → 終點，不是矩形**。方框從哪個角拖都一樣，但箭頭有方向，壓成 `x/y/w/h` 就把「指哪邊」丟掉了；方框自己從兩點推回矩形，成本比反過來低得多。②**深色暈邊**，理由跟文字的外框一樣（紅箭頭壓在紅色印章上就是看不見），但不給使用者調 —— 標註的重點是看得到。③**標註排在打碼之後**，指著「這裡要改」的箭頭被馬賽克吃掉就白畫了；有一則 pytest 直接比對兩個呼叫在原始碼裡的先後 |
| 共用手勢的分寸 | 抽出來的是**手勢**（`useDragBoxes` 只回報「從哪裡拖到哪裡」），不是外觀 —— 形狀怎麼存、怎麼畫留給呼叫端。這是刻意的：兩邊要畫的東西差很多，硬要共用外觀會把兩邊都綁死；但手勢一模一樣，各抄一份的話改了一邊忘了另一邊，使用者會發現「打碼點得掉、標註點不掉」。pytest 用 `studio.count("= useDragBoxes({") == 2` 把這件事釘住 |
| 測試 | +29。引擎 15（圖片 71 → 86）、介面 13（90 → 103）、pytest 接線守門 1（277 → 278 passed）。全綠 —— pytest 278 passed + 3 skipped、瀏覽器 **404** 項（圖片 86 / 介面 103 / 簽名 52 / 文件 51 / 掃描 34 / 取景 32 / 位址 25 / 頁面 21）|
| Mutation 檢查 | 拿掉箭頭的頭 → 2 條紅；拿掉暈邊 → 1 條紅；把標註畫到打碼之前 → 1 條紅；拿掉共用手勢的「點一下移除」→ 1 條紅（順帶發現：**打碼自己的「點一下移除」原本沒有測試**，現在至少共用的那條路徑被蓋到了）|
| 兩個寫測試踩到的坑 | ①**箭頭的頭不能用「點數」量**。測試畫布短邊只有 200px，預設線寬 0.006 算出來是 1.5px 的線、7px 的箭頭，頭跟尾在取樣格裡差不到兩倍。改成量**垂直高度**（靠近箭尖那一段比箭身高），這也才是「箭頭有沒有頭」真正在問的事。②**同色疊同色不會「完全沒有差異」** —— alpha 合成有捨入誤差，關掉暈邊之後仍有 262 個位元組不同。改成數「有沒有變暗」（暈邊的作用就是那圈深色），關掉暈邊時是乾淨的 0 |
| 刻意沒做 | ①**`drawTexts` 改陣列（拆成 M1b）** —— 原本 TODO 把它跟 M1 綁在一起，但引擎那一側**早就吃陣列了**，卡住的純粹是 `studio.jsx`：`text` 是一個 state 物件、`textLayer` 固定包成 `[text]`。要做的是圖層清單 + 新增 / 刪除 + 把面板上十幾個滑桿改成操作「選中那一層」，跟箭頭 / 方框沒有相依，混在一起一個晚上做不完。②標註的線寬滑桿（資料結構已經吃 `width`，現在加是憑空猜）。③旋轉時讓標註跟著走 —— **打碼從 v3.12.0 就有同一個問題**，兩個一起處理才合理，已寫進「後續工作」|
| CI | **全綠。** `test (3.10)` / `test (3.11)` / `Android App / build`（4 分 39 秒，含新增的標註測試）/ GitGuardian ✅。**踩到一個坑**：分支有 PR 時 `push` 與 `pull_request` 會各觸發一次同樣的 CI，這次 `push` 那一份的 `test (3.10)` 卡在 `Install CJK fonts`（apt）超過 10 分鐘不動 —— 同一個 commit 在 `pull_request` 那一份早就綠了，所以是 runner 的 apt 鏡像卡住，不是程式。處置：`cancel_workflow_run` 之後 `rerun_workflow_run`，重跑 67 秒就過。下次遇到「只有一份卡住、另一份綠」直接這樣做，不用查程式 |
| 版本號 | **用 3.23.0** —— 開工時 PR #49 已經佔用 3.22.0 但還沒合併，兩邊都從 `main`（3.21.0）長出來 |
| 合併衝突預告 | 這條分支跟 #49 都從 `ce63ac6` 長出來，會衝突的檔案：`main.py`（取 3.23.0）、`STATUS.yaml`（`roadmap` 兩項都要移除 —— #49 移即時取景 M2、這條移標註工具 M1，`recent_changes` 依實際合併順序串起來、`key_metrics` 取兩邊測試數的**聯集**）、`docs/TODO.md`（這次的 Phase 22 依合併順序改編號成 **23**，兩張表的新列都留著）、`docs/ROUTINE_LOG.md`、`README.md`、`docs/ARCHITECTURE.md`、`docs/ANDROID.md`。處理方式跟 8/05 那次一樣 |
| 環境注意事項 | 沿用前幾筆，都還有效：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx`（版本號會變，先 `ls /opt/pw-browsers/` 確認）②`pip install -r requirements.txt` 之後補 `pip install cffi pytest`，加 `--timeout 120` ③`python tests/generate_test_forms.py` 會改到有進版控的 fixture，提交前 `git checkout -- tests/fixtures/forms/` ④跑 `test:studio` 前要先 `python3 scripts/build_mobile.py --offline`。**新增一條**：`mcp__github__actions_list` 的輸出很大（180 筆 run ≈ 390KB）會超過工具回傳上限，加 `resource_id` 指定 workflow 也一樣 —— 直接讀它落地的那個檔案用 `python3 -c "import json..."` 挑欄位比較快 |
| 合併結果 | **#49 在這條分支開好 PR 之後就被合併了**（`bbaa597`），所以當晚就把 `origin/main` merge 回這條分支、照上面那列預告的方式解掉衝突：`main.py` / `version.properties` 取 3.23.0、`STATUS.yaml` 的 `roadmap` 兩項都移除並換上 M1b、`docs/TODO.md` 的 Phase 22 改編號成 **23**（#49 先進 main 就是 22）、兩張表與兩則變更日誌都留著、測試數取聯集。合併後整套測試重跑一次確認沒有互相打架 |
| 下一步 | 做 `roadmap[0]`：**標註工具 M1b：`drawTexts` 改陣列**。具體怎麼動：`static/js/studio.jsx` 的 `const [text, setText] = stUseState(STUDIO_TEXT_DEFAULT)` 改成 `texts` 陣列 + 一個 `activeText` 索引；`textLayer`（現在是 `text.text.trim() ? [{...text, ...SPOTS[text.spot]}] : null`）改成 map 整個陣列；`sheet === 'text'` 那個面板最上面加一排圖層 chip（「文字 1 / 文字 2 / ＋」）與刪除鈕，底下十幾個 `setText({ ...text, xxx })` 統一改成寫回 `texts[activeText]`。引擎完全不用動（`drawTexts` 從一開始就吃陣列）。測試補在 `npm run test:studio`：兩段文字同時出現在成品上、切換圖層改到的是對的那一層、刪掉中間那層剩下的不會跑位。做完把 `STATUS.yaml` 的 `roadmap` 那一項移除、`docs/TODO.md`「標註工具」的 M1b 打勾 |

## 2026/08/06 — 即時取景 M2（框穩了自己拍）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[0]`：自動快門。**開工時 #47 / #48 都已合併、沒有 open PR**，所以這次是乾淨地接 `roadmap[0]`，沒有版本號要閃 |
| 分支 | `claude/nightly-auto-shutter` |
| PR | 見分支上的草稿 PR |
| 結果 | 完成，v3.22.0。`scan-live.js` 新增 `cornerMotion()` 與 session 內的穩定度計數：連續 3 次角點平均位移 < 畫面 1.2% 就自己 `capture()`。**四個關鍵決定**：①量的是**平滑前**的 `rawCorners` —— 平滑後的角點本來就會趨近不動，拿它算等於在量自己的濾波器；②第一次偵測回 `motion: null` 而不是 0（「還不知道」≠「沒動」，回 0 會白送一次穩定）；③**低信心一律歸零** —— 不確定的框本來就會飄，它「連續三次都在同一個地方」多半是連續三次都抓錯同一個東西；④拍完就解除（一次取景只自動拍一張），`stop()` 也解除，而且**拍到一半被收掉時那張照片不會事後才冒出來**。自動快門失敗報一次錯就退回手動。介面 `StudioCamera`：倒數（「穩住 2」）＋穩定度長條＋「⏱ 自動」開關（預設開，偏好放模組層變數，不然每拍一張元件卸載就跳回預設）；手動按快門先解除自動。全綠 —— pytest 277 passed + 3 skipped、瀏覽器 **407** 項（介面 97 / 圖片 71 / 取景 56 / 簽名 52 / 文件 51 / 掃描 34 / 位址 25 / 頁面 21）|
| 門檻是估的，這件事寫在程式裡 | `STEADY_MOVE = 0.012` / `STEADY_HITS = 3` **不是量出來的** —— 合成串流的位移恆為 0，在它上面調不出有意義的數字。所以取景畫面把**當下的位移百分比**顯示出來（`data-testid=cam-motion`）：對使用者是「手還在動」，對下一個接手的人是唯一能在真機上把門檻定下來的東西。理由與量法寫在 `scan-live.js` 的常數註解、`docs/TODO.md`「後續工作」、`docs/ANDROID.md`「已知限制」三處 |
| 測試踩到的坑 | ①**移動中的測資不能掛在 `setInterval` 上**：偵測是同步的、會把 UI 執行緒整段吃掉，計時器在那段時間根本不跑，等速時間驅動的紙在兩次偵測之間其實只移動了幾個像素 —— 第一版就是這樣，位移只有一半超過門檻，最後還是自動拍了（測試紅了才發現，不是猜的）。改成**在 `onResult` 裡把紙挪到另一個定點**（32px ≈ 4%），每次偵測都確實走了門檻的三倍以上；②自動快門那幾段的等待全部改成**輪詢事件**而不是睡固定秒數 —— 八支測試連跑時機器很忙，一次偵測可能久上好幾倍，睡固定秒數紅的是負載不是功能（在整批連跑時真的偶發紅過一次）|
| Mutation 檢查 | 拿掉低信心那道防線 → 「抓不準的時候不自動拍」＋對照組兩條紅；拿掉 `stop()` 之後的攔截 → 「拍到一半被收掉」紅。兩個 guard 都是真的在擋事情 |
| 介面測試的順序問題 | 自動快門預設開著，而 `studio.test.mjs` 原本開了相機就放著等 1.8 秒 —— 假相機完全靜止，一秒多就自己拍完、畫面已經跳回編輯器，原本那幾條會整組紅。作法是**開相機後立刻按掉「自動」**（偏好留在模組層，後面幾段手動流程都維持關著），最後再打開來單獨走一次自動那條路 |
| 環境注意事項 | 沿用前幾筆：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome \| head -1) npm run test:xxx` ②`pip install -r requirements.txt` 之後補 `pip install cffi pytest`，加 `--timeout 120` ③改完版本號要跑一次 `python scripts/build_mobile.py`（`version.properties` 要對得上 `main.py`）④`tests/generate_test_forms.py` 產出的 fixture 有進版控，跑完 `git checkout -- tests/fixtures/forms/` ⑤跑 `npm run test:studio` 前要先 `python scripts/build_mobile.py --offline` |
| 下一步 | 做 `roadmap[0]`：**標註工具 M1（箭頭 / 方框）**。`static/js/image-local.js` 已經有打碼的拖框互動（找 `StudioRedactor` 與它在引擎那側的對應）—— 箭頭與方框可以共用同一套「拖出一個框」的手勢，差別只在畫出來的東西。**前置工作是 `drawTexts` 從單一物件改成陣列**：現在一張圖只能有一個文字圖層（`docs/ANDROID.md`「已知限制」列著），標註本質上是多圖層，這一步先把資料結構打開，M2 的螢光筆 / 手寫才接得上去。補 `npm run test:image`（引擎：畫出來數像素）與 `npm run test:studio`（介面：拖出一個箭頭、還原）。做完把這項從 `STATUS.yaml` 的 `roadmap` 移除、`docs/TODO.md` 的 M1 打勾。**另外有一項只能在真機上做**：自動快門與節流的門檻（見「後續工作」兩列），容器裡量不了，等使用者手邊有 App 時看一眼取景畫面上的位移百分比就能定 |

## 2026/08/05 — 即時取景 M1（對準了才拍）

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap` 的即時取景 M1：相機預覽疊即時邊框。**不是** `roadmap[0]` —— 第一項（伺服器位址）昨晚已經做在 PR #47，還開著沒合併，所以往下拿一項，跟 v3.18.0 當時的處置一致 |
| 分支 | `claude/nightly-live-viewfinder` |
| PR | [#48](https://github.com/dofliu/scanmail-bot/pull/48)（草稿） |
| 結果 | 完成，v3.20.0。新增裝置端引擎 `static/js/scan-live.js`（~290 行）：`getUserMedia` 取流 → 節流跑 `SMScanLite.detect()` → 平滑角點 → 疊框 → 全解析度快門。**三個關鍵取捨**：①**節流是核心不是優化** —— 偵測是同步的、會擋住 UI 執行緒，所以一次跑完才排下一次、兩次之間至少 350ms、取樣先縮到 640px；②**平滑但不能黏住** —— EMA 收手抖，但角點平均位移 > 畫面 10% 就直接跟上（鏡頭真的移開時，延遲比抖動更難看）；③**快門對留下來的那一張重新偵測** —— 取景時的結果是「上一張」的，多花 100–300ms 換到「拉正畫面看到的框就是照片本身的框」。介面 `StudioCamera`：抓到框變綠、抓不穩變黃並列出 v3.18.0 的重拍建議；兩個入口（空畫面的「📷 用相機拍一張」＋工具列的「📷 拍照」）。照片帶 `liveCorners` 進編輯器，`StudioDeskew` 直接沿用不重測，`deskewItem` 清掉、`undoDeskew` 還原。全綠 —— pytest 275 passed + 3 skipped、瀏覽器 351 項（圖片 71 / 介面 90 / 簽名 52 / 文件 51 / 掃描 34 / 取景 32 / 頁面 21）|
| CI | **全綠，一次過**。`test (3.10)` / `test (3.11)` / GitGuardian ✅；`Android App / build` 4 分 31 秒跑完，六支瀏覽器測試（含新增的 `Test live viewfinder`，7 秒）＋ `Test offline studio UI` ＋ 兩個 APK 都成功。**注意一個追 CI 的坑**：`pull_request_read(get_check_runs)` 回的狀態會延遲很久（job 早就 completed 了還一直顯示 in_progress，害我誤判成卡住並在 PR 留了一則錯的留言）。要看真實進度請改用 `actions_get(get_workflow_job, <job id>)`，它回的是逐步驟的即時狀態 |
| 順手做掉的 | ①空畫面本來**沒有工具列**，寫測試時才發現「開 App 想直接拍」根本按不到 —— 空狀態補上「📷 用相機拍一張」，`if (camera)` 的判斷也要排在「還沒選圖」的 return **之前**；②`static/sw.js` 的快取清單補上新檔（有 pytest 在把關）；③CI（`.github/workflows/android.yml`）加一步 `npm run test:live` |
| 測試手法 | 無頭瀏覽器沒有鏡頭，用 **`canvas.captureStream()` 當假相機**：畫面是「桌上的一張紙」、四個角已知，取流 → 偵測 → 疊框 → 快門整條路走得完，CI 上不需要任何相機。**兩個踩過的坑**：①場景要先畫在離屏畫布再一次 `drawImage` 貼過去 —— captureStream 是在畫布被畫到的當下取樣的，一筆一筆畫會送出「只有背景、紙還沒畫上」的半成品幀，測起來像偵測壞了；②合成內文的線**要細**（紙高 /200），畫成 5px 粗黑條時偵測器會把最上面那條當成紙的邊，整組失敗。介面那條「拉正沿用取景的框」是**反證**的：先把 `window.SMScanLite.detect` 換成回傳明顯錯誤的框，框還是落在紙上才算數 |
| 刻意沒做 | **自動快門（M2）**。`session.latest()` 每次都帶著平滑前的 `rawCorners`，穩定度直接從連續幾次的位移算就有了 —— 缺的不是程式，是**門檻**：合成串流完全不會抖，在它上面調出來的數字沒有意義，要拿真實裝置的手持資料抓 |
| 版本號 | **用 3.20.0 而不是 3.19.0** —— 開工時 PR #47 已經佔用 3.19.0 但還沒合併，兩邊都從 `main`（3.18.0）長出來 |
| 合併衝突預告 | 這條分支從 #47 之前的 `main` 長出來。#47 合併之後，`main.py` / `version.properties`（取 3.20.0）、`STATUS.yaml`（`roadmap` 兩項都要移除、`recent_changes` 串成 v3.20.0 → v3.19.0）、`docs/TODO.md`（這次的 Phase 20 依合併順序改編號成 **21**，兩張表的新列都留著）、`docs/ROUTINE_LOG.md`、`README.md`、`docs/ANDROID.md`、`docs/ARCHITECTURE.md` 會衝突，處理方式跟 8/03 那次一樣 |
| 環境注意事項 | 沿用前幾筆：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:xxx`（版本號會變，先 `ls /opt/pw-browsers/` 確認） ②`pip install -r requirements.txt` 之後補 `pip install cffi pytest`，`pip install` 加 `--timeout 120` ③`python tests/generate_test_forms.py` 會改到有進版控的 fixture，提交前 `git checkout -- tests/fixtures/forms/` ④跑 `test:studio` 前要先 `python3 scripts/build_mobile.py --offline` |
| 下一步 | **先看 PR #47 跟 #48 合併了沒**（兩張都是草稿），沒合併就先追那個，不要再往上疊第三個未合併的版本號。之後做 `roadmap`：#47 沒合併的話仍是伺服器位址那項（做法寫在 8/04 那筆）；都合併了就換**即時取景 M2（自動快門）**：`scan-live.js` 的 `onResult` 已經回傳平滑前的 `rawCorners`，在 session 裡多記幾筆算「連續 N 次角點位移 < 門檻」即可，UI 在 `StudioCamera` 加倒數與自動觸發 `capture()`。**門檻不要在合成串流上調**（它不會抖）—— 可行的作法是先把穩定度數值顯示在取景畫面上，拿真機手持看幾秒的實際範圍再定；測試改成「餵一段每幀都微幅位移的串流」驗不該觸發、「完全靜止」驗會觸發。另外 `docs/TODO.md` 新增了一項「取景節流門檻要看真機」（現在固定 350ms / 640px），也適合跟 M2 一起量 |

## 2026/08/04 — 伺服器位址存進原生儲存

| 項目 | 內容 |
|------|------|
| 主題 | `STATUS.yaml` `roadmap[0]`：App 的後端位址還存在 `localStorage`，系統清一次快取就得重打一次 IP |
| 分支 | `claude/nightly-server-address-preferences` |
| PR | [#47](https://github.com/dofliu/scanmail-bot/pull/47)（草稿，base `main`）|
| 結果 | 完成，**v3.21.0**（做完時標 3.19.0，見下方「合併衝突」）。`static/js/config.js` 拆成**兩段**：開機仍同步讀 `localStorage`（App 內它是原生儲存的鏡像，所以 `apiBase` 一載入就有值、下游零影響），新增的 `ready()` 再非同步跟 `SMNative.store` 對答案 —— 鏡像被清掉就把位址救回來並補寫鏡像，原生儲存沒有這個 key 就把舊位址搬過去（沿用簽名庫「沒有 key＝該搬家」那套契約）。`native.js` 的 `init()` 先 `await SM_CONFIG.ready()` **才**判斷要不要跳伺服器設定畫面。`save()` / `clear()` 改成非同步，設定畫面等寫入落地再 reload；原生寫入失敗退回 `localStorage`。`api.js` 新增 `onApiBaseChange` 訂閱 + `rebase()`。`atoms.jsx` 的 `ServerSetting` 訂閱位址變化。測試 +25（新的 `npm run test:config`）+2 pytest。併入 #48 之後全綠 —— pytest 277 passed + 3 skipped、瀏覽器 **376** 項（介面 90 / 圖片 71 / 簽名 52 / 文件 51 / 掃描 34 / 取景 32 / 位址 25 / 頁面 21）|
| 關鍵設計 | **選了「同步 `localStorage` 當開機快取 + 非同步校正」而不是把 `config.js` 移到 `native.js` 之後改全非同步**（上一筆建議的 (a) 案）。理由：位址被 `api.js` 在載入時就組成字串用著，改全非同步等於要所有 API 呼叫端等一個 ready promise，動到的面積遠大於這個增量該有的風險。兩段式只多一個訂閱點，而且網頁版 / 離線版一行行為都沒變 |
| 順序才是重點 | 少了 `native.js` 那個 `await`，位址其實**還是**救得回來 —— 但設定畫面已經蓋上去了，使用者看到的沒有任何改善。所以 `tests/test_mobile_build.py` 加了一條防呆，釘住原始碼裡 `SM_CONFIG.ready()` 必須排在 `openServerSetup()` 之前 |
| 容易漏掉的地方 | `api.js` 有**七個工具前綴**（`imgBase` / `pdfBase` / `cvtBase` / `gifBase` / `vidBase` / `renBase` / `formBase`）是在載入時就先組好的字串，不像各 function 裡的 `${BASE}` 是呼叫時求值。漏掉哪一個，那一類工具就會在清過快取的裝置上打到 `https://localhost`。第二條 pytest 防呆用正規式比對「宣告的每個 `xxxBase` 都要出現在 `rebase()` 裡」 |
| 測試作法 | `mobile/test/config.test.mjs` **每個情境都真的 `page.goto()` 一次**，harness 裡有一段 prelude 在 `config.js` 之前依查詢字串佈置旗標 / `localStorage` / 假的 `window.SMCap`，讓載入順序跟 App 裡一模一樣 —— 這件事最容易錯的就是順序，用 `_internals.boot()` 在同一頁重跑會測不到。**做過 mutation 檢查**：拿掉 `native.js` 的 `await` 與 `api.js` 的訂閱，25 項裡有 4 項會紅 |
| 合併衝突 | #48 先合併，所以這條分支要併上去。**踩到一個要注意的狀況**：使用者在 GitHub 上手動推了一個 merge commit（`10f3d2a`），但衝突是用「兩邊都留」收掉的 —— `main.py` 出現兩行 `version=`、`version.properties` 兩組版本號、`mobile/package.json` 少一個逗號（JSON 直接壞掉，`npm ci` 失敗所以 build 全紅）、`STATUS.yaml` 的 `last_updated` / `next_milestone` / `key_metrics` / `recent_changes` 各重複一次、`docs/TODO.md` 整段「後續工作」重複、兩個 Phase 20。**沒有 force push 蓋掉那個 commit**，而是在它上面補一個修正 commit。處理方式：版本號取 **3.21.0**（3.20.0 已被 #48 用掉，版本號跟著實際落地順序走，3.19.0 因此不存在）；`roadmap` 兩項都移除；TODO 的 Phase 依合併順序 —— #48 是 20、這份改成 21；變更日誌與本檔都把最新的擺最上面；兩支測試腳本 / 兩個 CI 步驟 / README 兩行都保留 |
| 環境注意事項 | 沿用前幾筆：①**不要跑 `playwright install`**，用 `PW_CHROMIUM=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome \| head -1) npm run test:xxx` ②`pip install -r requirements.txt` 之後補 `pip install cffi pytest`，`pip install` 加 `--timeout 120` ③改完版本號要跑一次 `python scripts/build_mobile.py`，否則 `mobile/android/version.properties` 對不上 `main.py` 會有一條 pytest 紅 ④`tests/generate_test_forms.py` 產出的 fixture 有進版控，重跑後 bytes 會變，提交前 `git checkout -- tests/fixtures/forms/` ⑤跑 `npm run test:studio` 前要先 `python scripts/build_mobile.py --offline` |
| 下一步 | 做 `roadmap[0]`：**即時取景 M2（自動快門）**。M1 已經在 v3.20.0 落地，`scan-live.js` 的 `onResult` 已經回傳平滑前的 `rawCorners`，在 session 裡多記幾筆算「連續 N 次角點位移 < 門檻」即可，UI 在 `StudioCamera` 加倒數與自動觸發 `capture()`。**門檻不要在合成串流上調**（它不會抖）—— 先把穩定度數值顯示在取景畫面上，拿真機手持看幾秒的實際範圍再定；測試改成「餵一段每幀都微幅位移的串流」驗不該觸發、「完全靜止」驗會觸發。另外 `docs/TODO.md` 有一項「取景節流門檻要看真機」（現在固定 350ms / 640px），適合一起量 |
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
