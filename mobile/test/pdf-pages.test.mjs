/**
 * PDF 頁面操作的功能測試（static/js/pdf-lite.js）。
 *
 * 合併 / 刪頁 / 抽頁 / 重排要是「無損」的 —— 文字還是文字、圖還是原本那張圖。
 * 所以測法是：組完之後交給 pdf.js 讀回來，比對每一頁的文字、尺寸與方向；
 * 另外再讓 qpdf（pikepdf）驗一次結構，pdf.js 容忍得了的毛病它不會放過。
 *
 * 素材刻意用兩種不同結構的 PDF（mobile/test/fixtures/make_fixtures.py 產生）：
 *   pages-a.pdf  傳統 xref 表
 *   pages-b.pdf  xref 串流 + 物件串流，而且 MediaBox 只寫在父節點（屬性繼承）
 *
 * 執行：cd mobile && npm run test:pages
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const PDFJS = path.join(ROOT, 'mobile/node_modules/pdfjs-dist/build');
const FIXTURES = path.join(HERE, 'fixtures');
const PORT = 8951;

for (const name of ['pages-a.pdf', 'pages-b.pdf', 'pages-locked.pdf', 'pages-incremental.pdf']) {
  if (!fs.existsSync(path.join(FIXTURES, name))) {
    console.error(`缺少測試素材 ${name} —— 請執行 python mobile/test/fixtures/make_fixtures.py`);
    process.exit(1);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.css': 'text/css',
};

const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>pdf pages harness</title>
<script src="/pdfjs/pdf.min.js"></script>
<script>window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';<\/script>
<script src="/js/image-local.js"><\/script>
<script src="/js/zip-lite.js"><\/script>
<script src="/js/ttf-lite.js"><\/script>
<script src="/js/pdf-write.js"><\/script>
<script src="/js/pdf-lite.js"><\/script>
<script src="/js/doc-local.js"><\/script>
</head><body></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/__harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  const file = url.startsWith('/pdfjs/') ? path.join(PDFJS, url.slice('/pdfjs/'.length))
    : url.startsWith('/__fixtures/') ? path.join(FIXTURES, url.slice('/__fixtures/'.length))
    : path.join(STATIC, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${pass ? '' : ` — ${detail}`}`);
}

/** 用 qpdf 驗結構。沒有 pikepdf 就跳過，不讓測試因為環境而紅。 */
function qpdfCheck(bytes) {
  const tmp = path.join(os.tmpdir(), `smpages-${process.pid}-${bytes.length}.pdf`);
  fs.writeFileSync(tmp, bytes);
  try {
    const out = execFileSync('python3', ['-c', `
import io, sys, pikepdf
with pikepdf.open(sys.argv[1]) as pdf:
    problems = pdf.check_pdf_syntax()
    # 逐頁把物件走一遍，參照斷掉的話這裡就會炸
    for page in pdf.pages:
        page.mediabox
        pikepdf.Page(page).obj.get("/Contents")
    pdf.save(io.BytesIO())   # qpdf 重寫一次，結構有問題會拒絕
    print("PAGES", len(pdf.pages))
    print("PROBLEMS", "; ".join(problems) if problems else "none")
`, tmp], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: /PROBLEMS none/.test(out), out: out.trim() };
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (/No module named 'pikepdf'|not found/.test(msg)) return { skipped: true };
    return { ok: false, out: msg.slice(0, 400) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/__harness.html`, { waitUntil: 'load' });
await page.waitForTimeout(300);

// 在瀏覽器裡先把兩份素材開起來，之後的測試都共用
await page.evaluate(async () => {
  const load = async (name) =>
    window.SMPDFLite.open(await (await fetch(`/__fixtures/${name}`)).arrayBuffer());
  window.A = await load('pages-a.pdf');
  window.B = await load('pages-b.pdf');
  /** 讀回一份 PDF 的每頁文字與尺寸 —— 判斷有沒有無損搬過去就看這個 */
  window.readBack = async (blob) => {
    const doc = await window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const v = p.getViewport({ scale: 1 });
      const text = (await p.getTextContent()).items.map((it) => it.str).join('').trim();
      out.push({ text, w: Math.round(v.width), h: Math.round(v.height), rotate: p.rotate });
    }
    return out;
  };
});

// ── 解析 ────────────────────────────────────────────────
const parsed = await page.evaluate(() => ({
  a: { pages: window.A.pages.length, info: [0, 1, 2].map((i) => window.A.pageInfo(i)) },
  b: { pages: window.B.pages.length, info: [0, 1].map((i) => window.B.pageInfo(i)) },
}));

check('讀得懂傳統 xref 表的 PDF', parsed.a.pages === 3, JSON.stringify(parsed.a));
check('每頁的尺寸與方向都讀得出來',
  parsed.a.info[0].width === 612 && parsed.a.info[1].width === 842 &&
  parsed.a.info[2].rotate === 90 &&
  // 轉 90 度後長寬對調，回報的是「看起來的」尺寸
  parsed.a.info[2].width === 792 && parsed.a.info[2].height === 612,
  JSON.stringify(parsed.a.info));
check('讀得懂 xref 串流 + 物件串流的 PDF', parsed.b.pages === 2, JSON.stringify(parsed.b));
check('MediaBox 寫在父節點時能沿著頁面樹繼承下來',
  parsed.b.info.every((i) => i.width === 595 && i.height === 842), JSON.stringify(parsed.b.info));

// ── 合併 ────────────────────────────────────────────────
const merged = await page.evaluate(async () => {
  const picks = [
    ...[0, 1, 2].map((page) => ({ doc: window.A, page })),
    ...[0, 1].map((page) => ({ doc: window.B, page })),
  ];
  const blob = await window.SMPDFLite.compose(picks, { title: '合併測試' });
  return { pages: await window.readBack(blob), size: blob.size, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
});

check('兩份 PDF 合併成一份，順序正確',
  merged.pages.map((p) => p.text).join(',') === 'PAGE-A1,PAGE-A2,PAGE-A3,PAGE-B1,PAGE-B2',
  JSON.stringify(merged.pages.map((p) => p.text)));
check('合併後每頁的尺寸各自保留',
  merged.pages[0].w === 612 && merged.pages[1].w === 842 && merged.pages[3].w === 595,
  JSON.stringify(merged.pages.map((p) => [p.w, p.h])));
check('合併後方向也保留', merged.pages[2].rotate === 90,
  JSON.stringify(merged.pages.map((p) => p.rotate)));

const structure = qpdfCheck(Uint8Array.from(merged.bytes));
if (structure.skipped) console.log('  · 跳過 qpdf 結構檢查（沒有 pikepdf）');
else check('合併結果通過 qpdf 的結構檢查', structure.ok && /PAGES 5/.test(structure.out), structure.out);

// ── 刪頁 / 抽頁 / 重排 / 轉向 ───────────────────────────
const edited = await page.evaluate(async () => {
  const A = window.A;
  const pick = async (picks) => window.readBack(await window.SMPDFLite.compose(picks));
  return {
    dropped: await pick([{ doc: A, page: 0 }, { doc: A, page: 2 }]),
    single: await pick([{ doc: A, page: 1 }]),
    reordered: await pick([{ doc: A, page: 2 }, { doc: A, page: 0 }, { doc: A, page: 1 }]),
    rotated: await pick([
      { doc: A, page: 0, rotate: 90 },
      { doc: A, page: 2, rotate: 90 },   // 原本就轉了 90 度，再轉就是 180
      { doc: A, page: 1, rotate: -90 },
    ]),
  };
});

check('刪頁：中間那頁拿掉，剩下的還在',
  edited.dropped.map((p) => p.text).join(',') === 'PAGE-A1,PAGE-A3', JSON.stringify(edited.dropped));
check('抽頁：只留一頁',
  edited.single.length === 1 && edited.single[0].text === 'PAGE-A2', JSON.stringify(edited.single));
check('重排：照挑選的順序輸出',
  edited.reordered.map((p) => p.text).join(',') === 'PAGE-A3,PAGE-A1,PAGE-A2',
  JSON.stringify(edited.reordered.map((p) => p.text)));
check('轉向：疊加在頁面原本的方向上',
  edited.rotated[0].rotate === 90 && edited.rotated[1].rotate === 180 && edited.rotated[2].rotate === 270,
  JSON.stringify(edited.rotated.map((p) => p.rotate)));

// ── 內容真的是原封不動搬過去的嗎 ────────────────────────
// 拿自己產的 PDF 來測：一份有內嵌中文字型、一份有照片。
// 這兩種最容易在複製時漏掉相依物件 —— 漏了就會變空白頁或方框。
const rich = await page.evaluate(async () => {
  const D = window.SMDocLocal;
  const { blob: textPdf } = await D.toPdf(D.fromMarkdown('# 第一頁標題\n\n中文內容測試。\n'));

  const c = document.createElement('canvas');
  c.width = 400; c.height = 300;
  const x = c.getContext('2d');
  x.fillStyle = '#c0392b'; x.fillRect(0, 0, 200, 300);
  x.fillStyle = '#2980b9'; x.fillRect(200, 0, 200, 300);
  const photo = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const { blob: imgPdf } = await window.SMImageLocal.imagesToPdf([photo], { pageSize: 'fit' });

  const L = window.SMPDFLite;
  const t = await L.open(await textPdf.arrayBuffer());
  const i = await L.open(await imgPdf.arrayBuffer());
  const blob = await L.compose([
    { doc: i, page: 0 },
    { doc: t, page: 0 },
    { doc: window.A, page: 0 },
  ]);

  // 把合併後的第一頁畫出來，確認照片真的還在（不是空白頁）
  const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const p1 = await doc.getPage(1);
  const vp = p1.getViewport({ scale: 1 });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height);
  await p1.render({ canvasContext: cx, viewport: vp }).promise;
  const at = (px, py) => {
    const d = cx.getImageData(Math.round(px), Math.round(py), 1, 1).data;
    return d[0] > 150 && d[1] < 100 ? '紅' : d[2] > 130 && d[0] < 100 ? '藍' : '白';
  };

  return {
    pages: await window.readBack(blob),
    left: at(cv.width * 0.25, cv.height * 0.5),
    right: at(cv.width * 0.75, cv.height * 0.5),
    imgSize: imgPdf.size,
    mergedSize: blob.size,
  };
});

check('合併後中文字型還在，文字抽得回來',
  /第一頁標題/.test(rich.pages[1].text) && /中文內容測試/.test(rich.pages[1].text),
  JSON.stringify(rich.pages[1].text));
check('合併後照片還在（不是空白頁）',
  rich.left === '紅' && rich.right === '藍', `左${rich.left} 右${rich.right}`);
check('照片是整包搬過去的，沒有重新編碼',
  rich.mergedSize > rich.imgSize * 0.8, `${rich.imgSize} → ${rich.mergedSize}`);
check('混合來源的頁面順序正確',
  rich.pages.length === 3 && /PAGE-A1/.test(rich.pages[2].text), JSON.stringify(rich.pages.map((p) => p.text)));

// ── 加密的檔案要明確拒絕 ────────────────────────────────
const locked = await page.evaluate(async () => {
  try {
    await window.SMPDFLite.open(await (await fetch('/__fixtures/pages-locked.pdf')).arrayBuffer());
    return null;
  } catch (e) {
    return e.message;
  }
});
check('加密的 PDF 給出看得懂的錯誤，不是壞掉的輸出',
  !!locked && /加密/.test(locked), String(locked));

// ── 增量更新：/Prev 鏈，後面的覆蓋前面的 ────────────────
const incremental = await page.evaluate(async () => {
  const doc = await window.SMPDFLite.open(
    await (await fetch('/__fixtures/pages-incremental.pdf')).arrayBuffer());
  const blob = await window.SMPDFLite.compose([0, 1, 2].map((page) => ({ doc, page })));
  return { pages: doc.pages.length, info: doc.pageInfo(1), back: await window.readBack(blob) };
});
check('沿著 /Prev 讀完整條 xref 鏈', incremental.pages === 3, JSON.stringify(incremental));
check('增量更新裡「後面的覆蓋前面的」',
  incremental.info.rotate === 180 && incremental.back[1].rotate === 180,
  JSON.stringify([incremental.info, incremental.back[1]]));

// ── 壞掉的 xref 也要救得回來 ────────────────────────────
const broken = await page.evaluate(async () => {
  const raw = new Uint8Array(await (await fetch('/__fixtures/pages-a.pdf')).arrayBuffer());
  // 把 startxref 指到一個不存在的位置，模擬被改壞的檔案。
  // 一定要在位元組層面動手 —— 走一趟字串會把壓縮過的串流編碼壞掉。
  const marker = new TextEncoder().encode('startxref');
  let at = -1;
  outer: for (let i = raw.length - marker.length; i >= 0; i--) {
    for (let j = 0; j < marker.length; j++) if (raw[i + j] !== marker[j]) continue outer;
    at = i; break;
  }
  const tail = new TextEncoder().encode('startxref\n999999\n%%EOF\n');
  const patched = new Uint8Array(at + tail.length);
  patched.set(raw.subarray(0, at), 0);
  patched.set(tail, at);
  const doc = await window.SMPDFLite.open(patched);
  const blob = await window.SMPDFLite.compose([{ doc, page: 1 }]);
  return { pages: doc.pages.length, back: await window.readBack(blob) };
});
check('xref 壞掉時退回全檔掃描，還是讀得到頁面',
  broken.pages === 3 && broken.back[0].text === 'PAGE-A2', JSON.stringify(broken));

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
