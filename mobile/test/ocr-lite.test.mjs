/**
 * 裝置端 OCR（static/js/ocr-lite.js）與「掃描型 PDF 讀得出字」的功能測試。
 *
 * 這一支跑的是**真的 tesseract**：真的 wasm、真的英文語言包、真的辨識。
 * 沒有替身可以用 —— 要驗的正是「認不認得出來」，換成假的引擎就什麼都沒驗到。
 * 資產從 mobile/node_modules 供出去，路徑刻意排成跟 App 一樣的
 * `vendor/` 相對路徑（見下面那條「相對路徑不會變成 vendor/vendor」的測試）。
 *
 * 掃描型 PDF 的 fixture 是現做的：把字畫在 canvas 上 → 匯出成 JPEG →
 * `SMImageLocal.imagesToPdf()` 包成 PDF。這樣產出來的 PDF **真的**抽不到文字，
 * 跟手機拍完存成 PDF 的那種檔案是同一回事，不是模擬。
 *
 * 執行：cd mobile && npm run test:ocr
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const NM = path.join(ROOT, 'mobile/node_modules');
const PDFJS = path.join(NM, 'pdfjs-dist/build');
const PORT = 8977;

/** 直接從引擎讀 —— 測試裡再抄一份數字，改了常數之後測到的就是舊值 */
const RENDER_WIDTH = Number(
  /const OCR_RENDER_WIDTH = (\d+)/.exec(
    fs.readFileSync(path.join(STATIC, 'js/doc-local.js'), 'utf8'))[1]);

/** App 內 vendor/ 底下那五個檔案，檔名跟 scripts/build_mobile.py 打包出來的一致 */
const VENDOR = {
  'tesseract.min.js': path.join(NM, 'tesseract.js/dist/tesseract.min.js'),
  'tesseract-worker.min.js': path.join(NM, 'tesseract.js/dist/worker.min.js'),
  'tesseract-core-simd-lstm.js': path.join(NM, 'tesseract.js-core/tesseract-core-simd-lstm.js'),
  'tesseract-core-simd-lstm.wasm': path.join(NM, 'tesseract.js-core/tesseract-core-simd-lstm.wasm'),
  'eng.traineddata.gz': path.join(NM, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
};

for (const [name, file] of Object.entries(VENDOR)) {
  if (!fs.existsSync(file)) {
    console.error(`缺少 OCR 資產 ${name}（${file}）—— 請在 mobile/ 執行 npm install`);
    process.exit(1);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.ttf': 'font/ttf',
};

// 頁面掛在 /app/ 底下（不是網站根目錄）—— 這樣「相對路徑解錯」會在測試裡現形，
// 而不是等到 App 裝到手機上才發現語言包 404。
const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>ocr harness</title>
<script src="/pdfjs/pdf.min.js"><\/script>
<script>
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';
  // 頁面掛在 /app/ 底下，PDF 中文字型的預設相對路徑會找到 /app/vendor/ 去
  window.SM_DOC_FONT_URL = '/vendor/fonts/NotoSansTC-Subset.ttf';
<\/script>
<script src="vendor/tesseract.min.js"><\/script>
<script>
  window.SM_OCR_PATHS = {
    worker: 'vendor/tesseract-worker.min.js',
    core: 'vendor/tesseract-core-simd-lstm.js',
    lang: 'vendor',
  };
<\/script>
<script src="/js/ocr-lite.js"><\/script>
<script src="/js/image-local.js"><\/script>
<script src="/js/zip-lite.js"><\/script>
<script src="/js/ttf-lite.js"><\/script>
<script src="/js/pdf-write.js"><\/script>
<script src="/js/pdf-lite.js"><\/script>
<script src="/js/doc-local.js"><\/script>
</head><body><div id="root"></div></body></html>`;

/** 伺服器收到的每一個網址，用來驗「語言包到底被要到哪裡去了」 */
const served = [];

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  served.push(url);

  if (url === '/app/' || url === '/app/harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  let file = null;
  if (url.startsWith('/app/vendor/')) {
    file = VENDOR[url.slice('/app/vendor/'.length)] || null;
  } else if (url.startsWith('/pdfjs/')) {
    file = path.join(PDFJS, url.slice('/pdfjs/'.length));
    if (!file.startsWith(PDFJS)) file = null;
  } else {
    const cand = path.join(STATIC, url);
    file = cand.startsWith(STATIC) ? cand : null;
  }
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${pass ? '' : ` — ${detail}`}`);
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
const pageErrors = [];
const external = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith(`http://127.0.0.1:${PORT}`) && !u.startsWith('blob:') && !u.startsWith('data:')) {
    external.push(u);
  }
});

await page.goto(`http://127.0.0.1:${PORT}/app/harness.html`, { waitUntil: 'load' });
await page.waitForTimeout(300);

// 在頁面裡共用的小工具：把幾行字畫成一張「掃描件」
await page.addScriptTag({
  content: `
    window.__draw = function (lines, opts) {
      const o = opts || {};
      const c = document.createElement('canvas');
      const font = (l) => (l.weight ? l.weight + ' ' : '') + l.size + 'px "DejaVu Sans", sans-serif';
      // 沒指定寬度就量出來 —— 猜一個「大概夠寬」的數字會在字型換掉的時候
      // 把最後兩個字切掉，然後看起來像是 OCR 認錯
      if (!o.width) {
        const probe = document.createElement('canvas').getContext('2d');
        let right = 0;
        for (const l of lines) { probe.font = font(l); right = Math.max(right, l.x + probe.measureText(l.text).width); }
        o.width = Math.ceil(right + Math.max(20, lines[0].size * 0.5));
      }
      c.width = o.width;
      c.height = o.height || 1754;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#000000';
      x.textBaseline = 'alphabetic';
      for (const l of lines) {
        x.font = font(l);
        x.fillText(l.text, l.x, l.y);
      }
      return c;
    };
    window.__file = function (canvas, name) {
      return new Promise((res) => canvas.toBlob(
        (b) => res(new File([b], name || 'scan.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.92));
    };
    // A4 150dpi（1240 x 1754）上的 10pt 內文 = 21px，標題 = 34px。
    // 尺寸刻意照真實文件抓 —— 畫成 70px 的大字，等於在測一個不會發生的情境。
    // 版面刻意排成「只有行距說得出段落在哪裡」：**沒有任何一行以句號收尾** ——
    // 段落判斷有兩條規則（行距變大、上一行以句號收尾），留著句號的話後面那條
    // 會先成立，行距這條就永遠測不到。
    window.__page10pt = function () {
      return [
        { text: 'QUARTERLY REPORT', x: 90, y: 150, size: 34 },
        // 這兩行間距 32px 對 21px 的字（1.5 倍）→ 同一段，要接在一起
        { text: 'Revenue for the period was 1,204,500 USD', x: 90, y: 220, size: 21 },
        { text: 'and remains subject to an external audit', x: 90, y: 252, size: 21 },
        // 這一行隔了 148px（7 倍）→ 新的一段
        { text: 'Invoice AB-20260901 remains unpaid', x: 90, y: 400, size: 21 },
      ];
    };
    // 一份「掃描的」PDF：字是像素，抽不到任何 text item
    window.__scannedPdf = async function (lines, opts) {
      const file = await window.__file(window.__draw(lines, opts));
      const { blob } = await window.SMImageLocal.imagesToPdf([file], { pageSize: 'A4' });
      return new Uint8Array(await blob.arrayBuffer());
    };
  `,
});

// ── 模組與資產 ──────────────────────────────────────────
check('引擎載進來而且回報可用', await page.evaluate(() =>
  !!(window.SMOcrLite && window.SMOcrLite.available)), 'SMOcrLite.available 是 false');

check('沒設定資產位置時就說自己不可用', await page.evaluate(() => {
  const keep = window.SM_OCR_PATHS;
  window.SM_OCR_PATHS = null;
  const got = window.SMOcrLite.available;
  window.SM_OCR_PATHS = keep;
  return got === false;
}), '少了 SM_OCR_PATHS 還說可用');

// ── 認得出英數 ──────────────────────────────────────────
const invoice = await page.evaluate(async () => {
  const c = window.__draw([
    { text: 'INVOICE NO. AB-20260901', x: 60, y: 120, size: 64 },
    { text: 'TOTAL 12,345.67', x: 60, y: 260, size: 72 },
  ], { width: 1400, height: 360 });
  const t0 = performance.now();
  const r = await window.SMOcrLite.recognize(c);
  return { ...r, ms: Math.round(performance.now() - t0) };
});
check('印刷體的英文與數字認得出來',
  /INVOICE\s+NO/.test(invoice.text) && invoice.text.includes('12,345.67'),
  JSON.stringify(invoice.text));
check('兩行字就回兩行，不是黏成一行', invoice.lines.length === 2,
  `拿到 ${invoice.lines.length} 行`);
check('行的座標對得上畫上去的位置',
  invoice.lines[0] && invoice.lines[1]
    && invoice.lines[0].y < invoice.lines[1].y
    && Math.abs(invoice.lines[0].x - 60) < 25,
  JSON.stringify(invoice.lines.map((l) => ({ x: l.x, y: l.y }))));
console.log(`    （辨識 ${invoice.ms}ms，信心 ${Math.round(invoice.confidence)}）`);

// ── 解析度：量的是真實的那條路 ──────────────────────────
// 合成的字畫得再小，只要邊緣是乾淨的，tesseract 照樣讀得出來 —— 所以
// 「把字畫小」證明不了什麼。真正會掉品質的是**掃描件經過 JPEG、再被 render 縮小**
// 這條路，所以直接拿掃描型 PDF 在兩種 render 寬度下各認一次。
const byWidth = await page.evaluate(async (target) => {
  const bytes = await window.__scannedPdf(window.__page10pt());
  const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const page1 = await pdf.getPage(1);
  const base = page1.getViewport({ scale: 1 });
  const out = {};
  for (const [key, width] of [['scale1', Math.round(base.width)], ['tuned', target]]) {
    const scale = Math.min(4, Math.max(1, width / base.width));
    const vp = page1.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page1.render({ canvasContext: x, viewport: vp }).promise;
    const r = await window.SMOcrLite.recognize(c);
    out[key] = { w: c.width, conf: Math.round(r.confidence), small: r.small, text: r.text.trim() };
  }
  return out;
}, RENDER_WIDTH);
check('scale 1 render 的 10pt 內文，信心明顯比放大過的低',
  byWidth.scale1.conf + 5 < byWidth.tuned.conf,
  `scale1 ${byWidth.scale1.conf} vs tuned ${byWidth.tuned.conf}`);
check('scale 1 render 會讀出原文沒有的字元',
  byWidth.scale1.text !== byWidth.tuned.text,
  '兩種寬度讀到一模一樣的字，這條測試就證明不了 render 寬度有影響');
check('太小的那一張會被標記 small，放大過的不會',
  byWidth.scale1.small === true && byWidth.tuned.small === false,
  `scale1.small=${byWidth.scale1.small} tuned.small=${byWidth.tuned.small}`);
console.log(`    （${byWidth.scale1.w}px 信心 ${byWidth.scale1.conf}`
  + ` → ${byWidth.tuned.w}px 信心 ${byWidth.tuned.conf}）`);

// ── 白名單模式不是過濾器 ────────────────────────────────
const digits = await page.evaluate(async () => {
  const c = window.__draw([
    { text: 'INVOICE NO. AB-20260901', x: 60, y: 120, size: 64 },
    { text: 'TOTAL 12,345.67', x: 60, y: 260, size: 72 },
  ], { width: 1400, height: 360 });
  const d = await window.SMOcrLite.recognize(c, { mode: 'digits' });
  const back = await window.SMOcrLite.recognize(c);   // 換回全字集
  return { digits: d.text, back: back.text };
});
check('digits 模式讀得到金額', digits.digits.includes('12,345.67'),
  JSON.stringify(digits.digits));
check('digits 模式會把英文硬塞成數字，不是把它丟掉（所以不能當預設）',
  !digits.digits.includes('INVOICE'), JSON.stringify(digits.digits));
check('切回全字集之後英文又回來了', /INVOICE/.test(digits.back), JSON.stringify(digits.back));

// ── worker 只開一次 ─────────────────────────────────────
const wasmHits = served.filter((u) => u.endsWith('.wasm')).length;
check('併發初始化只載一次 wasm（一頁開一個 worker 的話 20 頁就重編譯 20 次）',
  wasmHits === 1, `wasm 被要了 ${wasmHits} 次`);

const concurrent = await page.evaluate(async () => {
  const a = window.SMOcrLite.ready();
  const b = window.SMOcrLite.ready();
  return (await a) === (await b);
});
check('ready() 併發呼叫拿到同一個 worker', concurrent, '開出了第二個 worker');

// ── 相對路徑 ────────────────────────────────────────────
// harness 掛在 /app/ 底下（不是網站根目錄），所以「相對的 vendor/ 路徑到底解到哪裡」
// 這件事在這裡是真的會出錯的。tesseract.js 自己會對 window.location.href 解，
// 這條測試守的是那個行為 —— 它變了的話，App 會在使用者按下轉檔時才 404。
check('相對的 vendor/ 路徑在子目錄底下也拿得到語言包',
  served.includes('/app/vendor/eng.traineddata.gz')
    && !served.some((u) => u.includes('vendor/vendor')),
  served.filter((u) => u.includes('traineddata')).join(' | ') || '語言包根本沒被要求');

// ── 掃描型 PDF ──────────────────────────────────────────
const scanned = await page.evaluate(async () => {
  const bytes = await window.__scannedPdf(window.__page10pt());
  const t0 = performance.now();
  const doc = await window.SMDocLocal.fromPdf(bytes);
  const text = window.SMDocLocal.toText(doc);
  return {
    text, ocred: doc.ocred, ms: Math.round(performance.now() - t0),
    heading: doc.blocks.find((b) => b.type === 'heading'),
    kinds: doc.blocks.map((b) => b.type),
    paras: doc.blocks.filter((b) => b.type === 'para').length,
  };
});
check('掃描型 PDF 不再丟「需要 OCR」，字讀得出來',
  /QUARTERLY REPORT/i.test(scanned.text) && scanned.text.includes('1,204,500'),
  JSON.stringify(scanned.text).slice(0, 300));
check('回報哪幾頁是認出來的', JSON.stringify(scanned.ocred) === '[1]',
  JSON.stringify(scanned.ocred));
check('最大的那一行變成標題（OCR 的字級跟抽出來的走同一套判斷）',
  !!scanned.heading && /QUARTERLY/i.test(
    scanned.heading.spans.map((s) => s.text).join('')),
  JSON.stringify(scanned.kinds));
check('行的順序是由上而下', scanned.text.indexOf('QUARTERLY') < scanned.text.indexOf('1,204,500')
    && scanned.text.indexOf('1,204,500') < scanned.text.indexOf('AB-20260901'),
  JSON.stringify(scanned.text).slice(0, 200));
// **這條才是「上下翻轉」真正守得住的地方。** OCR 給的是影像座標（往下 y 變大），
// PDF 是左下原點（往下 y 變小），而換段落的判斷算的是 `prev.y - line.y`。
// 少了翻轉，那個差一律是負的 → 門檻永遠過不了 → 整頁黏成一大段，
// 但每個字都還在、順序也沒變，所以只驗內容或順序的斷言一條都不會紅。
check('行距大就換段落、行距小就接在一起（不是整頁黏成一段）',
  scanned.paras === 2, `數到 ${scanned.paras} 段：${JSON.stringify(scanned.kinds)}`);
console.log(`    （整頁 A4 掃描件 ${scanned.ms}ms）`);

// ── 有文字的頁不會白跑 OCR ──────────────────────────────
const digital = await page.evaluate(async () => {
  const { blob } = await window.SMDocLocal.toPdf(
    window.SMDocLocal.fromMarkdown('# Digital Heading\n\nPlain extractable text here.\n'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const before = window.SMOcrLite.running;
  const t0 = performance.now();
  const doc = await window.SMDocLocal.fromPdf(bytes);
  return {
    ocred: doc.ocred, ms: Math.round(performance.now() - t0),
    text: window.SMDocLocal.toText(doc), before,
  };
});
check('抽得到文字的 PDF 一頁都不會送去 OCR',
  JSON.stringify(digital.ocred) === '[]', JSON.stringify(digital.ocred));
check('抽得到文字的 PDF 內容照舊', digital.text.includes('Digital Heading'),
  JSON.stringify(digital.text).slice(0, 200));

// ── 混合文件逐頁判斷 ────────────────────────────────────
const mixed = await page.evaluate(async () => {
  const { blob } = await window.SMDocLocal.toPdf(
    window.SMDocLocal.fromMarkdown('# Digital Heading\n\nPlain extractable text here.\n'));
  const scan = await window.__scannedPdf([
    { text: 'SCANNED APPENDIX', x: 90, y: 150, size: 34 },
    { text: 'Reference number 55-8891 attached.', x: 90, y: 220, size: 21 },
  ]);
  const a = await window.SMPDFLite.open(new Uint8Array(await blob.arrayBuffer()));
  const b = await window.SMPDFLite.open(scan);
  const merged = await window.SMPDFLite.compose([
    { doc: a, page: 0 }, { doc: b, page: 0 },
  ]);
  const doc = await window.SMDocLocal.fromPdf(new Uint8Array(await merged.arrayBuffer()));
  return {
    ocred: doc.ocred, text: window.SMDocLocal.toText(doc), pages: doc.pages,
    headings: doc.blocks.filter((b) => b.type === 'heading')
      .map((b) => b.spans.map((s) => s.text).join('')),
  };
});
check('一份 PDF 前面是電子檔、後面是掃描的，只有掃描那一頁走 OCR',
  JSON.stringify(mixed.ocred) === '[2]', `${JSON.stringify(mixed.ocred)} / ${mixed.pages} 頁`);
check('兩種來源的文字都在同一份輸出裡',
  mixed.text.includes('Digital Heading') && /SCANNED APPENDIX/i.test(mixed.text),
  JSON.stringify(mixed.text).slice(0, 300));
// 標題的判斷是「字級比內文大」，而內文字級是**整份文件**一起數出來的。
// OCR 只知道行的 bbox 有多高，要先換算成字級才跟電子頁的 pt 比得起來（OCR_CAP_RATIO）——
// 沒換算的話掃描頁的字級整體偏小，那一頁的標題就沉進內文裡了。
check('掃描頁的標題跟電子頁的標題一樣被認成標題',
  mixed.headings.some((h) => /Digital Heading/.test(h))
    && mixed.headings.some((h) => /SCANNED APPENDIX/i.test(h)),
  JSON.stringify(mixed.headings));

// ── 雜訊不會變成一堆假的行 ──────────────────────────────
// 掃描件的雜點很容易被認成標點，一整頁下來會多出幾十個「.」。
// 這裡故意餵一張只有雜訊的圖，驗信心門檻真的把它們擋掉了。
const noise = await page.evaluate(async (floor) => {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 800;
  const x = c.getContext('2d');
  const img = x.createImageData(c.width, c.height);
  let seed = 20260901;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;   // 固定種子，每次跑都一樣
    const v = 150 + (seed % 106);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const r = await window.SMOcrLite.recognize(c);
  return { lines: r.lines.length, below: r.lines.filter((l) => l.confidence < floor).length };
}, 40);
check('純雜訊不會產出任何一行', noise.lines === 0, `產出了 ${noise.lines} 行`);
check('留下來的行都在信心門檻之上', noise.below === 0, `有 ${noise.below} 行低於門檻`);

// ── 關掉 OCR ────────────────────────────────────────────
const off = await page.evaluate(async () => {
  const bytes = await window.__scannedPdf([{ text: 'ANYTHING', x: 90, y: 150, size: 34 }]);
  try {
    await window.SMDocLocal.fromPdf(bytes, null, { ocr: 'off' });
    return '沒有丟錯';
  } catch (e) { return e.message; }
});
check('ocr: off 時維持原本那句明確的錯誤', /需要 OCR/.test(off), off);


// ── 收尾 ────────────────────────────────────────────────
check('release() 之後還能再認一次', await page.evaluate(async () => {
  await window.SMOcrLite.release();
  if (window.SMOcrLite.running) return false;
  const c = window.__draw([{ text: 'RESTARTED 2026', x: 20, y: 70, size: 56 }],
    { width: 700, height: 110 });
  const r = await window.SMOcrLite.recognize(c);
  return /RESTARTED/.test(r.text);
}), 'release 之後認不出來了');

check('全程沒有連到任何外部網站（離線版的前提）',
  external.length === 0, external.join(' | '));

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
