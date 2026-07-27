/**
 * 文件轉檔引擎的功能測試（zip-lite / ttf-lite / pdf-write / doc-local）。
 *
 * 這些東西沒辦法用單純的字串比對驗完 —— 產出的是真的 zip 與真的 PDF，
 * 所以測試方式是「產完再讀回來」：
 *   - DOCX：自己寫的 zip 打包後，再用自己的 zip 解開、解析回文件模型
 *   - PDF：產出後交給 pdf.js 抽文字，中文抽得回來才算字型內嵌正確
 *
 * 執行：cd mobile && npm run test:doc
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const PDFJS = path.join(ROOT, 'mobile/node_modules/pdfjs-dist/build');
const FIXTURES = path.join(HERE, 'fixtures');
const PORT = 8933;

for (const [what, where] of [['static/', STATIC], ['pdfjs-dist', PDFJS]]) {
  if (!fs.existsSync(where)) {
    console.error(`找不到 ${what}（${where}）`);
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(STATIC, 'vendor/fonts/NotoSansTC-Subset.ttf'))) {
  console.error('缺少中文字型子集 —— 請先執行 python scripts/make_pdf_font.py');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf', '.png': 'image/png', '.woff2': 'font/woff2',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// 只載轉檔會用到的東西，不跑整個 App —— 這樣測的是引擎本身
const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>doc engine harness</title>
<script src="/pdfjs/pdf.min.js"></script>
<script>window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';<\/script>
<script src="/js/image-local.js"><\/script>
<script src="/js/zip-lite.js"><\/script>
<script src="/js/ttf-lite.js"><\/script>
<script src="/js/pdf-write.js"><\/script>
<script src="/js/doc-local.js"><\/script>
</head><body><div id="root"></div></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/__harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  const file = url.startsWith('/pdfjs/')
    ? path.join(PDFJS, url.slice('/pdfjs/'.length))
    : url.startsWith('/__fixtures/')
      ? path.join(FIXTURES, url.slice('/__fixtures/'.length))
      : path.join(STATIC, url);
  const inside = file.startsWith(PDFJS) || file.startsWith(STATIC) || file.startsWith(FIXTURES);
  if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/__harness.html`, { waitUntil: 'load' });
await page.waitForTimeout(300);

const SAMPLE = `# 專案週報

這是一段**很重要**的說明文字，裡面混了 English words 與 \`inline code\`。

## 本週進度

- 完成圖片拼接功能
- 修好工具列擠爆的問題
  - 改成情境切換
- 開始做文件轉檔

1. 第一項
2. 第二項

> 引用一段話：慢慢來比較快。

\`\`\`python
def hello():
    print("你好")
\`\`\`

| 項目 | 狀態 |
| --- | --- |
| 拼接 | 完成 |
| 轉檔 | 進行中 |

---

最後一段，帶一個[連結](https://example.com)。
`;

// ── 模組載入 ────────────────────────────────────────────
check('四個模組都載進來了', await page.evaluate(() =>
  !!(window.SMZip && window.SMTTF && window.SMPDFWriter && window.SMDocLocal)), '有模組沒載到');
check('引擎回報可用', await page.evaluate(() => window.SMDocLocal.available), 'available 是 false');

// ── Markdown 解析 ───────────────────────────────────────
const model = await page.evaluate((md) => {
  const doc = window.SMDocLocal.fromMarkdown(md);
  return {
    title: doc.title,
    types: doc.blocks.map((b) => b.type),
    headings: doc.blocks.filter((b) => b.type === 'heading').map((b) => b.level),
    lists: doc.blocks.filter((b) => b.type === 'list').map((b) => ({ ordered: b.ordered, n: b.items.length })),
    code: (doc.blocks.find((b) => b.type === 'code') || {}).text,
    tableRows: (doc.blocks.find((b) => b.type === 'table') || {}).rows?.length,
    bold: doc.blocks.some((b) => (b.spans || []).some((s) => s.bold && s.text === '很重要')),
    link: JSON.stringify(doc.blocks.flatMap((b) => b.spans || []).find((s) => s.link) || null),
  };
}, SAMPLE);

check('標題階層解析正確', model.title === '專案週報' && model.headings.join() === '1,2', JSON.stringify(model.headings));
check('粗體 / 行內程式碼 / 連結都認得', model.bold && /example\.com/.test(model.link), model.link);
check('項目清單分成無序與有序兩組',
  model.lists.length === 2 && model.lists[0].ordered === false && model.lists[0].n === 4 &&
  model.lists[1].ordered === true && model.lists[1].n === 2, JSON.stringify(model.lists));
check('程式碼區塊保留原始換行與縮排',
  model.code === 'def hello():\n    print("你好")', JSON.stringify(model.code));
check('表格解析成三列', model.tableRows === 3, String(model.tableRows));
check('引用與分隔線都在', model.types.includes('quote') && model.types.includes('hr'), model.types.join(','));

// ── Markdown 來回轉換 ───────────────────────────────────
const roundTrip = await page.evaluate((md) => {
  const once = window.SMDocLocal.toMarkdown(window.SMDocLocal.fromMarkdown(md));
  const twice = window.SMDocLocal.toMarkdown(window.SMDocLocal.fromMarkdown(once));
  return { once, stable: once === twice };
}, SAMPLE);
check('Markdown → 模型 → Markdown 是穩定的', roundTrip.stable, '第二輪結果跟第一輪不同');
check('轉回來的 Markdown 保留了結構',
  /^# 專案週報/m.test(roundTrip.once) && /^- 完成圖片拼接功能/m.test(roundTrip.once) &&
  /^\| 項目 \| 狀態 \|/m.test(roundTrip.once) && /```python/.test(roundTrip.once),
  roundTrip.once.slice(0, 200));

// ── DOCX：自己產、自己讀回來 ────────────────────────────
const docx = await page.evaluate(async (md) => {
  const D = window.SMDocLocal;
  const blob = await D.toDocx(D.fromMarkdown(md));
  const buf = await blob.arrayBuffer();
  const files = [...(await window.SMZip.read(buf)).keys()];
  const back = await D.fromDocx(buf);
  return {
    size: blob.size,
    files,
    md: D.toMarkdown(back),
    headings: back.blocks.filter((b) => b.type === 'heading').map((b) => b.level),
    lists: back.blocks.filter((b) => b.type === 'list').map((b) => ({ ordered: b.ordered, n: b.items.length })),
    table: (back.blocks.find((b) => b.type === 'table') || {}).rows?.length,
  };
}, SAMPLE);

check('DOCX 內含 Word 需要的六個部件',
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
   'word/numbering.xml', 'word/_rels/document.xml.rels'].every((f) => docx.files.includes(f)),
  docx.files.join(','));
check('DOCX 解回來標題階層沒跑掉', docx.headings.join() === '1,2', JSON.stringify(docx.headings));
check('DOCX 解回來清單的有序 / 無序沒弄反',
  docx.lists.length === 2 && docx.lists[0].ordered === false && docx.lists[1].ordered === true,
  JSON.stringify(docx.lists));
check('DOCX 解回來表格還是三列', docx.table === 3, String(docx.table));
check('DOCX 解回來中文沒亂碼', /完成圖片拼接功能/.test(docx.md) && /慢慢來比較快/.test(docx.md), docx.md.slice(0, 200));

// ── 真的 Word 產出的檔案 ────────────────────────────────
// 上面測的是「自己產、自己讀」，這裡才測得出解析器有沒有只認得自己的寫法
const wordFile = await page.evaluate(async () => {
  const D = window.SMDocLocal;
  const buf = await (await fetch('/__fixtures/word-sample.docx')).arrayBuffer();
  const doc = await D.fromDocx(buf);
  return {
    title: doc.title,
    types: doc.blocks.map((b) => b.type),
    lists: doc.blocks.filter((b) => b.type === 'list').map((b) => ({ ordered: b.ordered, n: b.items.length })),
    bold: doc.blocks.flatMap((b) => b.spans || []).filter((s) => s.bold).map((s) => s.text),
    italic: doc.blocks.flatMap((b) => b.spans || []).filter((s) => s.italic).map((s) => s.text),
    table: (doc.blocks.find((b) => b.type === 'table') || {}).rows?.map((r) => r.map((c) => c.map((s) => s.text).join(''))),
    md: D.toMarkdown(doc),
  };
});
check('讀得懂 Word 自己產的 docx', wordFile.title === '季度營運報告', wordFile.title);
check('Word 的項目符號與編號清單都認得',
  wordFile.lists.length === 2 && wordFile.lists[0].ordered === false && wordFile.lists[0].n === 3 &&
  wordFile.lists[1].ordered === true && wordFile.lists[1].n === 2, JSON.stringify(wordFile.lists));
check('Word 的粗體 / 斜體標記讀得出來',
  wordFile.bold.join() === '12.4%' && wordFile.italic.join() === '斜體結尾',
  JSON.stringify([wordFile.bold, wordFile.italic]));
check('Word 的表格讀得出來',
  JSON.stringify(wordFile.table) === JSON.stringify([['區域', '營收'], ['北美', '3.2 億']]),
  JSON.stringify(wordFile.table));
check('Word 的引用樣式對應到引用區塊', wordFile.types.includes('quote'), wordFile.types.join(','));

// ── 字型子集 ────────────────────────────────────────────
const subset = await page.evaluate(async () => {
  const buf = await (await fetch('/vendor/fonts/NotoSansTC-Subset.ttf')).arrayBuffer();
  const font = window.SMTTF.parse(buf);
  const gids = new Set([...'你好世界ABC123，。'].map((c) => font.gidFor(c.codePointAt(0))));
  const out = font.subset(gids);
  const reparsed = window.SMTTF.parse(out.data);
  return {
    original: buf.byteLength,
    subsetSize: out.data.length,
    glyphs: out.count,
    numGlyphs: reparsed.numGlyphs,
    upem: font.unitsPerEm,
    advance: font.advance(font.gidFor('你'.codePointAt(0))),
    missing: font.gidFor('𠮷'.codePointAt(0)),
  };
});
check('字型解析得到合理的度量',
  subset.upem === 1000 && subset.advance > 800 && subset.advance <= 1000, JSON.stringify(subset));
check('子集只留下用到的字',
  subset.glyphs <= 16 && subset.subsetSize < subset.original / 100,
  `${subset.glyphs} 個字符 / ${subset.subsetSize} bytes（原始 ${subset.original}）`);
check('子集本身是可以再解析的合法 TTF',
  subset.numGlyphs === subset.glyphs, `${subset.numGlyphs} vs ${subset.glyphs}`);
check('字型沒有的字回報 0 而不是亂給', subset.missing === 0, String(subset.missing));

// ── PDF：產出後用 pdf.js 讀回來 ─────────────────────────
const pdf = await page.evaluate(async (md) => {
  const D = window.SMDocLocal;
  const { blob, missing } = await D.toPdf(D.fromMarkdown(md));
  const buf = await blob.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 8)));

  const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = '';
  const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    text += (await page.getTextContent()).items.map((it) => it.str).join('');
    for (const a of await page.getAnnotations()) if (a.url) links.push(a.url);
  }
  return { size: blob.size, head, pages: doc.numPages, text, missing, links };
}, SAMPLE);

check('產出的是合法 PDF', pdf.head.startsWith('%PDF-1.'), pdf.head);
check('PDF 只嵌入用到的字，檔案不會背著整份字型',
  pdf.size > 10_000 && pdf.size < 400_000, `${pdf.size} bytes`);
check('沒有字型缺字', pdf.missing.length === 0, pdf.missing.join(''));
check('PDF 裡的中文可以被複製出來（ToUnicode 正確）',
  /專案週報/.test(pdf.text) && /完成圖片拼接功能/.test(pdf.text) && /慢慢來比較快/.test(pdf.text),
  pdf.text.slice(0, 300));
check('PDF 裡的英數字與程式碼也正確',
  /English words/.test(pdf.text) && /def hello\(\)/.test(pdf.text), pdf.text.slice(0, 300));
// 網址只存在連結註解裡，不在內文 —— 內文顯示的是「連結」兩個字
check('Markdown 的連結變成 PDF 裡可以點的連結',
  pdf.links.some((u) => u.startsWith('https://example.com')), JSON.stringify(pdf.links));

// ── PDF → Markdown ──────────────────────────────────────
const back = await page.evaluate(async (md) => {
  const D = window.SMDocLocal;
  const { blob } = await D.toPdf(D.fromMarkdown(md));
  const doc = await D.fromPdf(await blob.arrayBuffer());
  return {
    title: doc.title,
    types: doc.blocks.map((b) => b.type),
    md: D.toMarkdown(doc),
  };
}, SAMPLE);
check('PDF 讀回來認得出標題', back.title === '專案週報', back.title);
check('PDF 讀回來認得出項目清單', back.types.includes('list'), back.types.join(','));
check('PDF 讀回來的內文沒掉字',
  /完成圖片拼接功能/.test(back.md) && /慢慢來比較快/.test(back.md), back.md.slice(0, 300));

// ── 圖片 → PDF ──────────────────────────────────────────
// 掃描類 App 的核心動作：拍幾張紙本，變成一份 PDF
const img2pdf = await page.evaluate(async () => {
  const mk = (w, h, type) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (type !== 'image/png') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
    x.fillStyle = '#c0392b'; x.fillRect(0, 0, w / 2, h);
    return new Promise((r) => c.toBlob(r, type, 0.9));
  };
  const jpegs = [await mk(800, 600, 'image/jpeg'), await mk(600, 900, 'image/jpeg')];
  const png = await mk(500, 500, 'image/png');

  const sizeOf = async (blob) => {
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const v = (await doc.getPage(i)).getViewport({ scale: 1 });
      out.push([Math.round(v.width), Math.round(v.height)]);
    }
    return out;
  };

  const a4 = await window.SMImageLocal.imagesToPdf([...jpegs, png], { pageSize: 'A4' });
  const fit = await window.SMImageLocal.imagesToPdf([...jpegs, png], { pageSize: 'fit' });
  return {
    a4: { pages: await sizeOf(a4.blob), reused: a4.reused, size: a4.blob.size },
    fit: { pages: await sizeOf(fit.blob), reused: fit.reused },
  };
});

check('多張圖合併成一份多頁 PDF',
  img2pdf.a4.pages.length === 3 && img2pdf.a4.pages.every((p) => p[0] === 595 && p[1] === 842),
  JSON.stringify(img2pdf.a4.pages));
check('「貼合圖片」讓每頁尺寸等於該張照片',
  JSON.stringify(img2pdf.fit.pages) === JSON.stringify([[800, 600], [600, 900], [500, 500]]),
  JSON.stringify(img2pdf.fit.pages));
check('JPEG 原樣嵌入不重新編碼（PNG 才需要轉一次）',
  img2pdf.a4.reused === 2 && img2pdf.fit.reused === 2,
  `${img2pdf.a4.reused} / ${img2pdf.fit.reused}`);

// Exif 方向：PDF 檢視器不看 Exif，得靠變換矩陣轉正
const exif = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#c0392b'; x.fillRect(0, 0, 400, 400);
  x.fillStyle = '#2980b9'; x.fillRect(400, 0, 400, 400);
  const base = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());

  // 手工插一段只有 orientation 的 Exif APP1
  const tag = (src, o) => {
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0,
      0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8, 0, 1,
      0x01, 0x12, 0, 3, 0, 0, 0, 1, (o >> 8) & 255, o & 255, 0, 0, 0, 0, 0, 0];
    const len = payload.length + 2;
    const app1 = [0xFF, 0xE1, (len >> 8) & 255, len & 255, ...payload];
    const out = new Uint8Array(2 + app1.length + src.length - 2);
    out.set(src.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(src.subarray(2), 2 + app1.length);
    return out;
  };

  const res = {};
  for (const o of [1, 6]) {
    const bytes = tag(base, o);
    const file = new File([bytes], `o${o}.jpg`, { type: 'image/jpeg' });
    const { blob, reused } = await window.SMImageLocal.imagesToPdf([file], { pageSize: 'fit' });
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    const at = (px, py) => {
      const d = cx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
      return d[0] > 150 && d[1] < 100 ? '紅' : d[2] > 130 && d[0] < 100 ? '藍' : '?';
    };
    res[o] = {
      exif: window.SMPDFWriter.readJpeg(bytes).orientation, reused,
      page: [cv.width, cv.height],
      topLeft: at(cv.width * 0.1, cv.height * 0.1),
      topRight: at(cv.width * 0.9, cv.height * 0.1),
    };
  }
  return res;
});
check('讀得出 Exif 方向', exif['1'].exif === 1 && exif['6'].exif === 6, JSON.stringify(exif));
check('方向 1 的照片左紅右藍、頁面是橫的',
  exif['1'].page.join() === '800,400' && exif['1'].topLeft === '紅' && exif['1'].topRight === '藍',
  JSON.stringify(exif['1']));
check('方向 6 的照片在 PDF 裡被轉正（頁面變直的、紅色跑到上方）',
  exif['6'].page.join() === '400,800' && exif['6'].topLeft === '紅' && exif['6'].topRight === '紅',
  JSON.stringify(exif['6']));
check('轉正是靠矩陣，照片本身還是原樣嵌入', exif['6'].reused === 1, String(exif['6'].reused));

// ── PDF → 圖片 ──────────────────────────────────────────
const pdf2img = await page.evaluate(async (md) => {
  const D = window.SMDocLocal;
  const { blob } = await D.toPdf(D.fromMarkdown(md));
  const buf = await blob.arrayBuffer();
  const low = await D.pdfToImages(buf, { dpi: 72 });
  const high = await D.pdfToImages(buf, { dpi: 200, format: 'PNG' });
  const bmp = await createImageBitmap(low[0].blob);
  return {
    count: low.length, ext: low[0].ext, page: low[0].page,
    width: bmp.width, height: bmp.height,
    pngExt: high[0].ext, bigger: high[0].blob.size > low[0].blob.size,
  };
}, SAMPLE);
check('PDF 每頁算成一張圖', pdf2img.count >= 1 && pdf2img.page === 1, JSON.stringify(pdf2img));
check('72 dpi 的 A4 就是 595×842', pdf2img.width === 595 && pdf2img.height === 842,
  `${pdf2img.width}x${pdf2img.height}`);
check('可以挑解析度與格式', pdf2img.ext === 'jpg' && pdf2img.pngExt === 'png' && pdf2img.bigger,
  JSON.stringify(pdf2img));

// ── 自由裁切 ────────────────────────────────────────────
const crop = await page.evaluate(async () => {
  const E = window.SMImageLocal;
  const c = document.createElement('canvas');
  c.width = 800; c.height = 400;
  c.getContext('2d').fillRect(0, 0, 800, 400);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const item = await E.loadItem(new File([blob], 'a.jpg', { type: 'image/jpeg' }));

  const sized = (patch) => {
    const out = E.renderItem({ ...item, ...patch });
    return [out.width, out.height];
  };
  return {
    none: sized({}),
    half: sized({ cropRect: { x: 0.25, y: 0, w: 0.5, h: 1 } }),
    // 先轉再裁：轉 90 度後畫面是 400×800，裁上半就是 400×400
    rotated: sized({ rotate: 90, cropRect: { x: 0, y: 0, w: 1, h: 0.5 } }),
    preset: E.centeredRect(800, 400, 1),
    rotateRect: E.rotateRect({ x: 0, y: 0, w: 0.5, h: 1 }, 90),
    flipRect: E.flipRect({ x: 0, y: 0, w: 0.25, h: 1 }, 'h'),
  };
});
check('裁切框用相對座標，切出來的尺寸正確',
  crop.none.join() === '800,400' && crop.half.join() === '400,400', JSON.stringify(crop));
check('先旋轉再裁切 —— 使用者裁的是他看到的畫面',
  crop.rotated.join() === '400,400', JSON.stringify(crop.rotated));
check('選比例時給一個置中、盡量大的起始框',
  Math.abs(crop.preset.w - 0.5) < 0.001 && crop.preset.h === 1 && Math.abs(crop.preset.x - 0.25) < 0.001,
  JSON.stringify(crop.preset));
check('轉圖 / 翻圖時裁切框跟著動，不會飄到別的地方',
  JSON.stringify(crop.rotateRect) === JSON.stringify({ x: 0, y: 0, w: 1, h: 0.5 }) &&
  JSON.stringify(crop.flipRect) === JSON.stringify({ x: 0.75, y: 0, w: 0.25, h: 1 }),
  JSON.stringify([crop.rotateRect, crop.flipRect]));

// ── 斷行 ────────────────────────────────────────────────
const wrap = await page.evaluate(() => {
  const { tokenize, joinText } = window.SMDocLocal._internals;
  return {
    cjk: tokenize('中文字'),
    latin: tokenize('hello world'),
    mixed: tokenize('中文abc'),
    joinCJK: joinText('中文', '接續'),
    joinLatin: joinText('hello', 'world'),
  };
});
check('中文逐字可斷、英文整字不拆',
  wrap.cjk.join('|') === '中|文|字' && wrap.latin.join('|') === 'hello| |world' &&
  wrap.mixed.join('|') === '中|文|abc', JSON.stringify(wrap));
check('接行時中文不補空格、英文才補',
  wrap.joinCJK === '中文接續' && wrap.joinLatin === 'hello world', JSON.stringify(wrap));

// ── 各種輸出格式都出得來 ────────────────────────────────
const all = await page.evaluate(async (md) => {
  const D = window.SMDocLocal;
  const file = new File([md], '週報.md', { type: 'text/markdown' });
  const out = {};
  for (const target of D.OUTPUTS) {
    const r = await D.convert(file, target);
    out[target] = { name: r.name, size: r.blob.size };
  }
  return out;
}, SAMPLE);
check('五種輸出格式都產得出檔案，副檔名也對',
  ['md', 'docx', 'pdf', 'txt', 'html'].every(
    (t) => all[t] && all[t].size > 0 && all[t].name === `週報.${t}`),
  JSON.stringify(all));

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
