/**
 * 裝置端 OCR（M1：數字與英文）—— 把「看得到、抽不出來」的字讀出來。
 *
 * `doc-local.js` 的 `fromPdf()` 碰到掃描型 PDF 會直接丟
 * 「這份 PDF 抽不到文字 —— 需要 OCR 才讀得出來」。那是程式碼裡自己承認的洞：
 * 頁面上明明有字，只是那些字是像素不是文字。這支把洞補起來。
 *
 * 引擎是 tesseract.js（LSTM），跑在 WebAssembly 裡，**完全在裝置上**。
 * 離線版把 worker / wasm / 語言包三個檔案打包進 App（見 scripts/build_mobile.py），
 * 網頁版從 CDN 載 —— 位置由 `window.SM_OCR_PATHS` 給，跟 pdf.js 的做法一致。
 *
 * ── M1 只做數字與英文，這是成本決定 ──────────────────────
 * 英文語言包（4.0.0_best_int）2.9MB，中文的大一個量級，而且辨識率還不如後端的
 * PaddleOCR。發票金額、單號、日期這些高頻需求英數就吃得下，所以先做這一段；
 * 中文留給 M2 做成使用者自己選要不要下載。
 *
 * ── 四個踩過才知道的決定 ────────────────────────────────
 *
 *   1. **worker 只開一次、共用**。初始化要 ~0.5 秒（3MB wasm 編譯 + 2.9MB 語言包），
 *      一頁開一個的話，20 頁的 PDF 光是重複開關就多花十幾秒在同一件事上。
 *      `ready()` 可以重入 —— 併發呼叫拿到的是同一個 promise，不會開出第二個。
 *
 *   2. **`workerBlobURL: false`**。tesseract.js 預設把 worker 包成 `blob:` URL 執行，
 *      於是 emscripten 那一側的 `scriptDirectory` 是空字串，core 要載自己的 `.wasm`
 *      時用的是相對路徑，直接炸 `Failed to parse URL from
 *      tesseract-core-simd-lstm.wasm`。關掉 blob、讓 worker 從它自己的網址載入，
 *      相對路徑才有基準。代價是 worker 必須同源 —— 離線版是 vendor/、網頁版是 CDN，
 *      兩邊都成立。另一條路是改用單檔版（wasm 以 base64 內嵌進 .js），
 *      但那是 3.86MB 對上 2.87+0.12MB，為了省一個設定多背 0.86MB 不划算。
 *
 *   3. **白名單模式不是預設**。實測把數字白名單套在 `INVOICE NO. AB-20260901` 上，
 *      出來的是 `0.-20260901` —— tesseract **不會把非白名單的字丟掉**，
 *      它會硬塞成最接近的白名單字元。所以 `digits` 只在呼叫端明講「我只要數字」
 *      的時候用（例如只框了金額那一格），整頁文件一律走全字集。
 *
 *   4. **解析度是品質的主要變因**，不是前處理。量出來的（一頁 10pt 內文的合成
 *      掃描件）：scale 1 render 出來的 A4 只有 595px 寬，信心 84 而且會多讀出一個
 *      原文沒有的句點；放大到 1000px 就到頂（信心 95、全對）。所以呼叫端要負責
 *      把圖放大到夠大再送進來 —— `doc-local.js` 的 `OCR_RENDER_WIDTH` 就是這件事。
 *      這支只負責提醒：行高的中位數太小就在結果上標 `small`。
 *
 * 回傳的座標是**影像像素、左上原點**（就是傳進來那張圖的座標系）。
 * 要換算成別的座標系是呼叫端的事 —— PDF 是左下原點、單位是點，
 * 那個換算需要知道 render 時用的縮放倍率，只有呼叫端知道。
 *
 * 執行：cd mobile && npm run test:ocr
 */
(function () {
  'use strict';

  /** OEM 1 = LSTM_ONLY。core 打包的是 lstm-only 版，用別的值會找不到 legacy 引擎 */
  const OEM_LSTM_ONLY = 1;

  /** 低於這個信心的行丟掉 —— 掃描件的雜點很容易被認成標點，一整頁下來會多出幾十個 `.` */
  const CONF_FLOOR = 40;

  /** 大寫字高低於這個像素數，tesseract 開始明顯掉字。用來標記「這張圖太小了」 */
  const MIN_CAP_HEIGHT = 14;

  /** 只要數字的模式；見上面第 3 點 —— 這不是「過濾」，是「強迫每個字都變成這些字元之一」 */
  const DIGITS = '0123456789.,-/:';

  /**
   * 送進辨識之前，一塊裁出來的區域至少要有這麼寬（像素）。
   *
   * 這是 v3.26.0 那次量出來的同一件事的另一面：整頁 A4 的量測顯示
   * 乾淨頁面在 1000px 寬到頂（信心 95、全對），595px 會掉到 84。
   * 裁一小塊出來時風險更大 —— 使用者框住發票上的一行金額，那一塊在原圖上
   * 可能只有兩三百像素寬，字高剩個位數。
   *
   * **放大不會憑空生出資訊**，但 tesseract 的 LSTM 吃的是固定高度的條帶，
   * 把小字內插放大到它習慣的尺度確實會準一些。這是量出來的，不是想當然 ——
   * 見 `npm run test:ocr` 的「小塊區域放大之後才讀得出來」那一條。
   */
  const MIN_CROP_WIDTH = 1000;

  /** 放大倍率上限。再往上只是讓手機吃一張更大的 canvas，內插也補不出細節 */
  const MAX_CROP_SCALE = 4;

  /** 一張圖最多這麼多像素（約 4000×3000）—— 手機上再大就有 OOM 的風險 */
  const MAX_PIXELS = 12e6;

  const LANG = 'eng';

  let worker = null;
  let starting = null;
  let mode = null;      // 目前 worker 上掛的白名單模式，避免每次辨識都重設參數
  // logger 是建立 worker 的時候綁死的，但進度回呼是**每次辨識**各自的。
  // 所以綁一個固定的 logger，讓它去讀這個變數，由 recognize() 逐次換掉。
  let progressTo = null;

  /**
   * 三個資產的位置。`vendor/...` 這種相對路徑可以直接送進去 ——
   * tesseract.js 自己會把 `corePath` / `workerPath` / `langPath` 對
   * `window.location.href` 解成絕對網址，再交給 worker。
   *
   * 這裡本來多寫了一層自己解析，理由是「worker 裡的相對路徑是相對於 worker 自己，
   * `langPath: 'vendor'` 會變成 `vendor/vendor`」—— 那個推論是錯的。
   * mutation 測試（把那層拿掉，25 條全過）證明它從頭到尾都沒有作用，所以拿掉了。
   * 網頁版掛在子目錄底下也成立：測試的 harness 就是掛在 `/app/` 底下跑的。
   */
  function paths() {
    return (typeof window !== 'undefined' && window.SM_OCR_PATHS) || null;
  }

  function isSupported() {
    return !!(typeof window !== 'undefined' && window.Tesseract && paths());
  }

  /**
   * 初始化（可重入）。併發呼叫共用同一個 promise —— 一份 PDF 的每一頁都會呼叫這裡，
   * 沒有這層保護就會同時開出好幾個 worker，每個都去編譯一次 3MB 的 wasm。
   */
  async function ready(opts = {}) {
    if (worker) return worker;
    if (starting) return starting;
    if (!isSupported()) {
      throw new Error('這個版本沒有帶 OCR 引擎 —— 需要 tesseract.js 與英文語言包');
    }
    const p = paths();
    starting = window.Tesseract.createWorker(LANG, OEM_LSTM_ONLY, {
      workerPath: p.worker,
      corePath: p.core,
      langPath: p.lang,
      gzip: true,
      // 見檔頭第 2 點：開著的話 core 載不到自己的 .wasm
      workerBlobURL: false,
      logger: (m) => {
        if (!m) return;
        if (m.status === 'recognizing text' && progressTo) progressTo(m.progress || 0);
        if (opts.onLoad) opts.onLoad(m.status, m.progress || 0);
      },
    }).then((w) => {
      worker = w;
      mode = null;
      starting = null;
      return w;
    }).catch((err) => {
      starting = null;
      throw new Error(`OCR 引擎載入失敗：${(err && err.message) || err}`);
    });
    return starting;
  }

  /** 白名單只在換模式的時候設 —— setParameters 會讓 tesseract 重建一次辨識器 */
  async function useMode(w, want) {
    if (mode === want) return;
    await w.setParameters({ tessedit_char_whitelist: want === 'digits' ? DIGITS : '' });
    mode = want;
  }

  /**
   * 辨識一張圖。
   *
   * @param source canvas / ImageData / Blob / dataURL —— tesseract.js 吃得下的都行
   * @param opts.mode 'text'（預設，全字集）或 'digits'（見檔頭第 3 點）
   * @param opts.onProgress (0..1)
   * @returns {{ text, confidence, lines, small }} 座標是影像像素、左上原點
   */
  async function recognize(source, opts = {}) {
    const w = await ready();
    await useMode(w, opts.mode === 'digits' ? 'digits' : 'text');

    progressTo = opts.onProgress || null;
    let result;
    try {
      result = await w.recognize(source, {}, { blocks: true, text: true });
    } finally {
      progressTo = null;
    }
    const data = result.data || {};

    const lines = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          const text = (line.text || '').replace(/\s+$/, '');
          if (!text) continue;
          if ((line.confidence || 0) < CONF_FLOOR) continue;
          const b = line.bbox || {};
          lines.push({
            text,
            confidence: line.confidence || 0,
            x: b.x0 || 0,
            y: b.y0 || 0,
            w: (b.x1 || 0) - (b.x0 || 0),
            h: (b.y1 || 0) - (b.y0 || 0),
          });
        }
      }
    }

    // 「這張圖太小」是最常見的失敗原因，而且是呼叫端**可以修**的（render 大一點再來）。
    // 拿行高的中位數當大寫字高的近似 —— 一行的 bbox 高度約等於字高加上下伸部。
    const heights = lines.map((l) => l.h).sort((a, b) => a - b);
    const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;

    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      lines,
      small: lines.length > 0 && median < MIN_CAP_HEIGHT,
    };
  }

  /**
   * 裁一塊區域出來、必要時放大到認得動的尺寸。
   *
   * @param source  canvas / image —— **要傳全解析度的那一張**。
   *                從預覽畫布裁出來的小框只有幾十個像素，怎麼放大都沒用：
   *                資訊在縮圖的時候就已經丟掉了。
   * @param region  `{x, y, w, h}`，**相對座標 0..1**（`useDragBoxes` 回傳的格式）。
   *                傳 null / 省略 = 整張。
   * @returns canvas，可以直接餵給 `recognize()`
   */
  function crop(source, region) {
    const sw = source.width;
    const sh = source.height;
    const r = region || { x: 0, y: 0, w: 1, h: 1 };

    // 夾在圖內，並且保證至少 1px —— 使用者手一抖點出一個零寬度的框是常態
    const x = Math.max(0, Math.min(1, r.x)) * sw;
    const y = Math.max(0, Math.min(1, r.y)) * sh;
    const w = Math.max(1, Math.min(sw - x, r.w * sw));
    const h = Math.max(1, Math.min(sh - y, r.h * sh));

    let scale = w < MIN_CROP_WIDTH ? Math.min(MAX_CROP_SCALE, MIN_CROP_WIDTH / w) : 1;
    if (w * h * scale * scale > MAX_PIXELS) {
      scale = Math.max(1, Math.sqrt(MAX_PIXELS / (w * h)));
    }

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    const ctx = out.getContext('2d');
    // 白底：裁到透明區域（例如拉正之後的邊角）時，黑底會讓 tesseract 什麼都讀不到
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, x, y, w, h, 0, 0, out.width, out.height);
    return out;
  }

  /** 收掉 worker。`ready()` 之後再呼叫會重新開一個 */
  async function release() {
    const w = worker;
    worker = null;
    mode = null;
    progressTo = null;
    if (w) await w.terminate();
  }

  window.SMOcrLite = {
    get available() { return isSupported(); },
    get running() { return !!worker; },
    LANG, DIGITS, CONF_FLOOR, MIN_CAP_HEIGHT, MIN_CROP_WIDTH,
    ready, recognize, release, paths, crop,
  };
})();
