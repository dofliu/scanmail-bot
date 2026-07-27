# ScanMail+ Android App

同一份前端，一邊在電腦瀏覽器跑，一邊打包成手機 App。

---

## 為什麼是這個架構

ScanMail+ 的重活全在後端：OpenCV 邊界偵測、Gemini Vision 辨識、PDF/影片處理、SMTP 寄信。
這些是 Python，**跑不進手機裡**。所以 App 不是「把整個系統搬到手機」，
而是「把既有的前端裝進手機，後端仍然在電腦或伺服器上」。

```
                    static/  ← 唯一的前端來源，開發功能只改這裡
                       │
          ┌────────────┴─────────────┐
          ▼                          ▼
   桌面瀏覽器                    Android App
   FastAPI 直接送出          build_mobile.py 打包進 APK
   http://localhost:8000       （React/pdf.js/字型都內建）
          │                          │
          └────────────┬─────────────┘
                       ▼
              同一個 FastAPI 後端
        （掃描 / AI / 寄信 / 檔案處理都在這裡）
```

外殼用 [Capacitor](https://capacitorjs.com/)：Android 專案是一個載入本機網頁的 WebView，
再加上 App 才有的能力（存檔、分享、狀態列、啟動畫面）。

---

## 前置需求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | 18 以上（建議 20 / 22） | Capacitor CLI、esbuild |
| JDK | 21 | Gradle 建置 |
| Android SDK | compileSdk 36、build-tools 36 | 產生 APK（裝 Android Studio 最省事） |
| Python | 3.10 以上 | `scripts/build_mobile.py` |

第一次要先裝 Node 相依套件（之後 `build_mobile.py` 會自動檢查）：

```bash
cd mobile && npm install
```

---

## 情境 A：在電腦上開發（跟以前完全一樣）

```bash
uvicorn main:app --reload
# 開 http://localhost:8000
```

改 `static/` 底下任何檔案，重整瀏覽器就看得到。**這條路徑沒有任何改變。**

---

## 情境 B：改一次，電腦和手機同時看

App 直接載入電腦上的 dev server，所以手機看到的就是最新的前端，改完存檔重整就好，
不必重新打包 APK。

```bash
# 1. 後端對區網開放（--host 0.0.0.0 是關鍵，預設只聽 127.0.0.1）
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 2. 查電腦在區網的 IP
#    macOS/Linux: ip addr | grep 192.168      Windows: ipconfig

# 3. 讓 App 指到那台電腦
python scripts/build_mobile.py --dev-server http://192.168.1.50:8000 --sync

# 4. 裝到用 USB 連著的手機
cd mobile/android && ./gradlew installDebug
```

之後改 `static/` → 存檔 → 手機上把 App 關掉重開（或下拉重整）就是新版本。
電腦瀏覽器同時開著同一個位址，兩邊看到的是同一份程式碼。

> **注意**：這個模式下 APK 被綁在那個 IP 上，換網路就連不到。
> 要回到一般模式，重跑一次不帶 `--dev-server` 的建置即可。
>
> 另外，live-reload 模式載入的是 `static/` 原檔，沒有 Capacitor 橋接層，
> 因此「下載處理結果」會走瀏覽器的路徑而在 WebView 裡無效。
> 要驗證下載功能請用情境 C 的打包版本。

---

## 情境 C：打包可以發出去的 APK

```bash
# 後端位址直接打包進去（校內伺服器或固定 IP 的電腦）
python scripts/build_mobile.py --api-base https://scanmail.example.com --sync

cd mobile/android
./gradlew assembleDebug      # 測試用
./gradlew assembleRelease    # 發佈用
```

APK 產出位置：

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
mobile/android/app/build/outputs/apk/release/app-release.apk
```

不指定 `--api-base` 也可以 —— App 第一次開啟會出現設定畫面，
請使用者自己輸入伺服器位址並測試連線，之後記在手機上。
一個 APK 就能給不同人連不同伺服器。

隨時可以在 App 內的 **設定 → 伺服器連線** 換位址。

---

## 情境 D：離線精簡版（不需要後端）

想要一個「隨手處理圖片」的工具，不想架伺服器、也不想在沒網路時卡住：

```bash
python scripts/build_mobile.py --offline --sync
cd mobile/android && ./gradlew assembleDebug
```

這個版本的 App **整個就是裝置端的媒體工具**：沒有掃描寄信、沒有導覽列、不用登入、
不會問伺服器位址。所有處理都在手機上直接做完，檔案不會離開裝置。

介面有三個分頁：**編輯**、**圖片**、**文件**。

### 🎨 編輯

**畫面上永遠只有畫布和一條工具列。** 所有選項都收在最下方，工具列依情境自動切換，
需要細調時才從下方推出面板，關掉就恢復滿版。

沒選圖時（拼貼模式）：

| 工具 | 內容 |
|------|------|
| ▦ 版面 | 直式 / 橫式 / 自動 / 2×2 / 2×3 / 3×2 / 3×3 / 4×4，點下去立刻套用 |
| ⬚ 圖框 | 無 / 圓角 / 細邊 / 白框 / 陰影 / 拍立得，另可調顏色、粗細、圓角 |
| ↔ 間距 | 格線間距、底色 |
| ＋ 加圖 · ✕ 清空 | |
| 💾 製作 | 輸出格式與品質，然後儲存 / 分享（釘在右側不隨捲動） |

點畫布上任何一張圖（或下方縮圖）就切到圖片模式：

| 工具 | 內容 |
|------|------|
| ↺ ↻ | 左轉 / 右轉，按一下就看到 |
| ⇋ ⇅ | 水平 / 垂直翻轉 |
| ⛶ 裁切 | 原始 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16 |
| ⤢ 大小 | 20–200% |
| 🗑 刪除 | |
| ✓ 完成 | 回到拼貼模式（釘在右側） |

正在編輯的那一張會在畫布上用虛線框標示。

**2×3 這類格狀預設用的是「裁切填滿」**：每一格大小完全一樣、圖片裁切後填滿格子，
這才是一般人講拼貼時期待的樣子。直式 / 橫式 / 自動則沿用等比縮放（留白露出底色），
與後端 `merge_images()` 的行為一致。

預覽用的是縮圖（長邊上限 1400px），所以按一下就有反應；
按下儲存時才用原圖重算一次，輸出品質不受預覽影響。
兩者共用同一套 `layoutBoxes()`，不會發生「預覽跟存出來的不一樣」。

### 已知的兩點差異（相對於後端版本）

* **輸出只支援 PNG / JPG / WebP。** Canvas 編不出 BMP / GIF（讀得進來，但存不出去）。
* **透明圖轉 JPG 會填白底**，後端則是直接丟掉 alpha（結果常常是黑底）。這裡刻意做得比較合理。

畫質方面，直接把大圖一次畫成小圖在瀏覽器裡是雙線性取樣，縮很多倍會糊；
引擎改成先反覆對半縮再畫最後一步，結果接近後端的 LANCZOS。

**批次結果不打包成 ZIP** —— 手機上還要再找程式解壓縮很麻煩。
改成列出每個檔案，可以單獨存，也可以「全部儲存」一次丟進系統分享面板
（App 內只會跳一次分享面板）。

### 🔄 圖片

縮放、壓縮、轉檔是同一件事，所以併成一次處理：選好檔案，一起設定長邊上限、
輸出格式與品質，只重新編碼一遍。

### 📑 文件

PDF / Word / Markdown 的互轉，一樣完全在裝置上做完。

| 讀得進來 | 產得出去 |
|------|------|
| PDF、Word（.docx）、Markdown、純文字 | PDF、Word、Markdown、純文字、HTML |

中間隔一層共用的文件模型，所以是任意組合而不是寫死的每一對轉換。標題階層、
項目符號、編號清單、表格、引用、程式碼區塊、粗體斜體、超連結都會保留。

選好檔案會先顯示解析後的排版預覽 —— 轉檔前就看得出來有沒有讀歪，
比事後開檔案才發現好。工具列同樣是情境式的：格式 / 頁面（只有輸出 PDF 時出現）/
換檔 / 清空，右側釘著「轉換」。

#### PDF 輸出為什麼要打包字型

PDF 規格要求字型必須嵌在檔案裡，收到檔案的人才看得到中文 —— 沒有「用系統字型」
這個選項，而且 WebView 也拿不到 Android 內建字型的檔案。

所以 App 內建一份裁過的 **Noto Sans TC**（`static/vendor/fonts/`，OFL 授權）：

| | |
|------|------|
| 涵蓋範圍 | Big5 全字集（常用 + 次常用漢字）、ASCII、注音、假名、標點與常用符號 |
| 大小 | 4.6 MB（原始 7.1 MB / 20812 字符） |
| 產生方式 | `python scripts/make_pdf_font.py`（需要 fonttools） |

輸出時 `static/js/ttf-lite.js` 會**再裁一次**，只把這份文件實際用到的字寫進 PDF。
一份幾百字的文件通常只有 30–80 KB，不會背著整份字型。同時附上 ToUnicode 對照表，
所以 PDF 裡的中文可以複製、可以搜尋，不是一張圖。

文件裡若出現字型沒有的字（例如罕見異體字），轉檔後會跳出提示列出是哪幾個字，
而不是安靜地留一片空白。

#### PDF 讀取的限制

PDF 裡沒有「段落」這種結構，只有一堆帶座標的文字片段。還原方式是看字級
（比內文大就是標題）、行距（跳太多就是新段落）與行首符號（項目符號 / 編號）。
排版複雜的檔案（多欄、圖文混排）還原出來的結構會比較粗糙。

**掃描出來的圖片型 PDF 抽不到文字**，這種情況會明確告訴你需要 OCR，
而不是給一份空白檔案。完整版可以走後端的 Vision 辨識。

### 還沒有的東西

* **影片** — ffmpeg.wasm 本體就 25–30MB，在手機上壓一支影片要好幾分鐘且容易記憶體不足，
  評估後認為不適合放進 WebView App。
* **PDF 裡的圖片** — 讀 PDF 只抽文字，圖片不會保留；Markdown 的圖片語法轉出去時
  會變成「［圖片：說明］」的文字佔位。
* **等寬字型** — 程式碼區塊用的是同一份 Noto Sans TC（再帶一份等寬中文字型太大），
  有底色標示但字寬不對齊。

> 完整版仍然保有全部功能，兩種版本共用同一份 `static/`，
> 差別只在打包時有沒有加 `--offline`。

---

## `build_mobile.py` 做了什麼

| 步驟 | 說明 |
|------|------|
| 複製 | `static/` → `mobile/www/`（`mobile/www/` 是產物，不進版控）；缺少 PDF 內嵌字型會直接中止 |
| 換掉 CDN | React / pdf.js / 字型改成打包在 App 內的檔案，手機沒網路也開得起來 |
| 預編譯 JSX | 用 esbuild 先把 `.jsx` 轉成 `.js`，App 內不必再載 3MB 的 Babel 即時編譯 |
| 橋接 | 打包 `mobile/src/bridge.js` → `window.SMCap`（存檔、分享、狀態列） |
| 注入旗標 | `window.SM_NATIVE = true`，讓前端知道要用絕對位址呼叫 API；加 `--offline` 時另外注入 `window.SM_OFFLINE = true` |
| 版本 | 從 `main.py` 讀版本號寫進 `mobile/android/version.properties` |

中文字型沿用 Android 內建的 Noto Sans CJK，不另外打包（省好幾 MB，外觀幾乎沒差）。

---

## 後端要注意的設定

**1. 監聽位址**

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

預設的 `127.0.0.1` 只有電腦自己連得到，手機會連線逾時。

**2. CORS**

App 的 WebView 來源是 `https://localhost`，跟後端不同源。
`.env` 預設 `ALLOWED_ORIGINS=*` 可以直接用；如果要收斂，記得把 App 的來源加進去：

```env
ALLOWED_ORIGINS=https://localhost,https://scanmail.example.com
```

**3. 防火牆**

Windows 第一次啟動 uvicorn 時要允許 8000 埠的私人網路連線。

**4. 多裝置使用請開啟認證**

`ENABLE_AUTH=False`（預設）時，所有連進來的裝置共用同一個 `default_user`，
連掃描中的暫存影像也是共用的 —— 電腦和手機**同時**掃描會互相蓋掉。
一個人單獨使用沒問題；多人或多裝置請開啟認證，各自登入後就有獨立的資料與工作階段：

```env
ENABLE_AUTH=True
ENCRYPTION_KEY=<自己產生的獨立金鑰>
```

---

## 簽章與發佈

### 產生金鑰（只做一次，檔案請自行備份，弄丟就無法更新已上架的 App）

```bash
keytool -genkey -v -keystore scanmail-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias scanmail
```

### 本機簽章建置

```bash
export ANDROID_KEYSTORE_FILE=/絕對路徑/scanmail-release.jks
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=scanmail
export ANDROID_KEY_PASSWORD=...

cd mobile/android && ./gradlew assembleRelease
```

沒設這些環境變數時仍然可以建置，只是產出未簽章的 APK（自己測試夠用）。

### 版本號

版本號的唯一來源是 `main.py` 的 `version="x.y.z"`：

* `versionName` = `3.9.0`
* `versionCode` = `30800`（`major*10000 + minor*100 + patch`）

改版時只要改 `main.py`，重跑 `build_mobile.py` 就會同步。
上架 Google Play 需要 `versionCode` 嚴格遞增，必要時可用 `ANDROID_VERSION_CODE` 覆寫。

---

## CI 自動建置

`.github/workflows/android.yml`：

* push / PR 動到 `static/`、`mobile/`、`scripts/build_mobile.py` → 先跑裝置端引擎的
  瀏覽器測試（圖片引擎、文件轉檔、離線版介面），再建置兩份 debug APK
  （完整版 `scanmail-debug-apk`、離線精簡版 `scanmail-offline-apk`），
  都放在該次 workflow 的 **Artifacts**
* 打 `android-v*` 標籤 → 另外建置 release APK
* 設定以下 repository secrets 後，release APK 會自動簽章：
  `ANDROID_KEYSTORE_BASE64`（`base64 -w0 scanmail-release.jks`）、
  `ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`
* 也可以手動觸發（workflow_dispatch）並指定要打包的後端位址

---

## 目前的限制

* **完整版的後端必須連得到。** 手機上沒有 Python，離線只能開得起 App，做不了事。
  只需要圖片與文件工具的話請改用情境 D 的離線精簡版。
* **iOS 沒有做。** Capacitor 支援 iOS，但需要 Mac + Xcode，且要另外 `npx cap add ios`。
* **App 內的「下載」是寫檔 + 叫出系統分享面板**，因為 Android WebView 不支援
  `blob:` 下載。可以存到「檔案」、雲端硬碟，或直接傳給別人。
* **`static/js/` 下的 `scanmail.js`、`app.js`、`image-tools.js` 等舊模組沒有被
  `index.html` 載入**（v4 的 React 介面已取代它們），也沒有跟著調整成 App 相容，
  未來若要重新啟用需一併處理 API 位址與下載行為。

---

## 疑難排解

| 症狀 | 可能原因 |
|------|----------|
| App 一開就出現「連線到伺服器」而且怎麼填都失敗 | 後端沒加 `--host 0.0.0.0`；手機和電腦不同網路；防火牆擋住 8000 |
| 畫面出得來但功能都轉圈圈 | 後端沒開，或 `ALLOWED_ORIGINS` 沒包含 `https://localhost` |
| 相機打不開 | 系統設定裡沒給 App 相機權限 |
| 背景任務（批次處理）卡在進度條 | 開了 `ENABLE_AUTH` 但 token 過期，重新登入 |
| `./gradlew` 找不到 SDK | 建立 `mobile/android/local.properties`，寫入 `sdk.dir=/你的/Android/sdk` |
| 剛 clone 下來直接跑 `./gradlew` 就失敗 | `capacitor-cordova-android-plugins/` 和 `www/` 是產物不進版控。先 `cd mobile && npm install`，再 `python scripts/build_mobile.py --sync` |
| 改了 `static/` 但 App 沒變 | 忘了重跑 `python scripts/build_mobile.py --sync` 再重新安裝 |
