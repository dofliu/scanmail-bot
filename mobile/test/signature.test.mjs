/**
 * 簽名 / 印章的功能測試（static/js/sign-lite.js + pdf-lite.js 的蓋章）。
 *
 * 最容易寫錯、而且錯了會很明顯的是**座標**：PDF 的原點在左下角、y 往上，
 * 而且 /Rotate 是交給檢視器轉的 —— 內容串流裡的座標不會跟著轉。
 * 使用者在轉過向的頁面上點右下角，蓋出來很可能跑到左上角去。
 *
 * 所以驗法不是比對數字，而是**把蓋完的 PDF 畫出來數墨點**：
 * 簽名放在哪一個象限，就只有那一個象限的深色像素會變多。
 * 矩陣寫錯的話墨會出現在別的象限，這種錯誤逃不掉。
 *
 * 另外驗兩件事：
 *   - 原本的內容還在（蓋章不該把文字弄壞）
 *   - 點陣印章的透明是真的透明（白底沒有把底下的字蓋掉）
 *
 * 執行：cd mobile && npm run test:sign
 * 前置：python mobile/test/fixtures/make_fixtures.py
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
const PORT = 8961;

if (!fs.existsSync(path.join(FIXTURES, 'pages-a.pdf'))) {
  console.error('缺少測試素材 —— 請執行 python mobile/test/fixtures/make_fixtures.py');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.css': 'text/css',
};

const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>signature harness</title>
<script src="/pdfjs/pdf.min.js"></script>
<script>window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js';<\/script>
<script src="/js/image-local.js"><\/script>
<script src="/js/sign-lite.js"><\/script>
<script src="/js/pdf-write.js"><\/script>
<script src="/js/pdf-lite.js"><\/script>
</head><body></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/__harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  // 瀏覽器一定會來要 favicon —— 回 204 就不會混進錯誤清單，
  // 這樣「沒有 JS 例外」那條就能維持嚴格，真的少了檔案還是抓得到
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
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

function qpdfCheck(bytes) {
  const tmp = path.join(os.tmpdir(), `smsign-${process.pid}-${bytes.length}.pdf`);
  fs.writeFileSync(tmp, bytes);
  try {
    const out = execFileSync('python3', ['-c', `
import io, sys, pikepdf
with pikepdf.open(sys.argv[1]) as pdf:
    problems = pdf.check_pdf_syntax()
    for page in pdf.pages:
        page.mediabox
        pikepdf.Page(page).obj.get("/Contents")
    pdf.save(io.BytesIO())
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

await page.evaluate(async () => {
  window.A = await window.SMPDFLite.open(await (await fetch('/__fixtures/pages-a.pdf')).arrayBuffer());

  /** 一枚看得出來的手寫簽名：兩筆對角線，佔滿整個邊界框 */
  window.demoSig = () => window.SMSignLite.fromStrokes([
    [{ x: 10, y: 60 }, { x: 40, y: 20 }, { x: 70, y: 60 }, { x: 100, y: 20 }],
    [{ x: 10, y: 45 }, { x: 100, y: 45 }],
  ], { color: '#000000', width: 0.06 });

  /**
   * 把 PDF 的某一頁畫出來，數每個象限有多少「深色」像素。
   *
   * 不比對單點 —— 筆畫是細的，逐點比對會落在筆畫之間的空隙上。
   * 數量才反映得出「這一區有沒有多出東西」。
   */
  window.inkByQuadrant = async (blob, pageNo = 1, scale = 1.5) => {
    const doc = await window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    }).promise;
    const p = await doc.getPage(pageNo);
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const q = [0, 0, 0, 0];   // 左上 右上 左下 右下
    for (let i = 0, n = 0; i < data.length; i += 4, n++) {
      const luma = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      if (luma > 0.6) continue;
      const x = n % canvas.width;
      const y = (n - x) / canvas.width;
      q[(y < canvas.height / 2 ? 0 : 2) + (x < canvas.width / 2 ? 0 : 1)]++;
    }
    return { q, width: canvas.width, height: canvas.height };
  };

  window.textOf = async (blob, pageNo = 1) => {
    const doc = await window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    }).promise;
    const p = await doc.getPage(pageNo);
    return (await p.getTextContent()).items.map((it) => it.str).join('').trim();
  };
});

console.log('\n簽名模型');

// ── 正規化 / 簡化 ───────────────────────────────────────
const model = await page.evaluate(() => {
  const sig = window.demoSig();
  const all = sig.strokes.flat();
  const noisy = Array.from({ length: 240 }, (_, i) => ({ x: i, y: 50 + Math.sin(i / 40) * 0.05 }));
  const simplified = window.SMSignLite._internals.simplify(
    noisy.map((p) => ({ x: p.x / 240, y: p.y / 240 })), 0.0014);
  return {
    kind: sig.kind,
    aspect: sig.aspect,
    inRange: all.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
    strokes: sig.strokes.length,
    simplifiedFrom: noisy.length,
    simplifiedTo: simplified.length,
    // 端點必須留著，不然筆畫會少一截
    keepsEnds: simplified[0].x === 0 && Math.abs(simplified[simplified.length - 1].x - 239 / 240) < 1e-9,
  };
});

check('手繪筆畫存的是向量而不是像素', model.kind === 'draw' && model.strokes === 2, JSON.stringify(model));
check('座標正規化到 0–1', model.inRange, JSON.stringify(model));
// 邊界框 90×40 再往外各留半個筆畫寬 → 比 90/40 稍微方一點
check('長寬比反映邊界框', model.aspect > 1.6 && model.aspect < 2.6, `aspect=${model.aspect}`);
check('幾乎共線的點會被砍掉', model.simplifiedTo < 12 && model.simplifiedFrom === 240,
  `${model.simplifiedFrom} → ${model.simplifiedTo}`);
check('簡化後仍保留頭尾兩端', model.keepsEnds, JSON.stringify(model));

// ── 匯入圖片：去白底 ────────────────────────────────────
const imported = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 100;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 200, 100);
  ctx.fillStyle = '#c0202a';           // 紅色關防
  ctx.fillRect(60, 30, 80, 40);

  const keep = window.SMSignLite.fromImage(c, { mode: 'keep' });
  const inked = window.SMSignLite.fromImage(c, { mode: 'ink', color: '#0000ff' });

  const sample = (sig) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const t = document.createElement('canvas');
      t.width = img.width; t.height = img.height;
      const tc = t.getContext('2d', { willReadFrequently: true });
      tc.drawImage(img, 0, 0);
      const mid = tc.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
      const corner = tc.getImageData(0, 0, 1, 1).data;
      resolve({ mid: [...mid], corner: [...corner], w: img.width, h: img.height });
    };
    img.src = sig.data;
  });

  return Promise.all([sample(keep), sample(inked)]).then(([k, i]) => ({
    keep: k, ink: i, keepAspect: keep.aspect,
  }));
});

check('白底變成完全透明', imported.keep.corner[3] === 0, JSON.stringify(imported.keep.corner));
check('墨的地方不透明', imported.keep.mid[3] > 200, JSON.stringify(imported.keep.mid));
check('「保留原色」留住紅色關防',
  imported.keep.mid[0] > 150 && imported.keep.mid[2] < 100, JSON.stringify(imported.keep.mid));
check('「轉成墨色」換掉顏色',
  imported.ink.mid[2] > 200 && imported.ink.mid[0] < 60, JSON.stringify(imported.ink.mid));
// 原圖 200×100，但墨只有 80×40 —— 裁掉四周空白，擺放時框的才是簽名本身
check('自動裁掉四周的空白', imported.keep.w < 110 && imported.keep.h < 70,
  `${imported.keep.w}×${imported.keep.h}`);

console.log('\n座標：畫面 → PDF');

// ── 變換矩陣 ────────────────────────────────────────────
const matrices = await page.evaluate(() => {
  const dm = window.SMPDFLite._internals.displayMatrix;
  // 把「畫面座標」的四個角丟進矩陣，看落到 PDF 的哪個角
  const corner = (rotate, w, h, dx, dy) => {
    const { matrix: m } = dm(rotate, w, h);
    return [
      Math.round(m[0] * dx + m[2] * dy + m[4]),
      Math.round(m[1] * dx + m[3] * dy + m[5]),
    ];
  };
  return {
    // 沒轉向：畫面左上 → PDF 左上（x=0, y=h）
    r0: corner(0, 600, 800, 0, 0),
    // 轉 90°：畫面尺寸變成 800×600，左上角 → PDF 的左下角原點
    r90size: [dm(90, 600, 800).width, dm(90, 600, 800).height],
    r90: corner(90, 600, 800, 0, 0),
    r90br: corner(90, 600, 800, 800, 600),
    r180: corner(180, 600, 800, 0, 0),
    r270: corner(270, 600, 800, 0, 0),
    // MediaBox 原點不在 (0,0) 時要平移
    offset: (() => {
      const { matrix: m } = dm(0, 600, 800, 9, 12);
      return [Math.round(m[4]), Math.round(m[5])];
    })(),
  };
});

check('沒轉向：畫面左上角 → PDF 的左上角', String(matrices.r0) === '0,800', String(matrices.r0));
check('轉 90° 後畫面的長寬對調', String(matrices.r90size) === '800,600', String(matrices.r90size));
check('轉 90°：畫面左上角 → PDF 原點', String(matrices.r90) === '0,0', String(matrices.r90));
check('轉 90°：畫面右下角 → PDF 的右上角', String(matrices.r90br) === '600,800', String(matrices.r90br));
check('轉 180°：畫面左上角 → PDF 的右下角', String(matrices.r180) === '600,0', String(matrices.r180));
check('轉 270°：畫面左上角 → PDF 的右上角', String(matrices.r270) === '600,800', String(matrices.r270));
check('MediaBox 原點不在 (0,0) 時會平移', String(matrices.offset) === '9,812', String(matrices.offset));

console.log('\n蓋到 PDF 上');

// ── 位置：墨要落在指定的象限 ─────────────────────────────
const placed = await page.evaluate(async () => {
  const sig = window.demoSig();
  const plain = await window.SMPDFLite.compose([{ doc: window.A, page: 0 }]);
  const base = await window.inkByQuadrant(plain);

  const at = async (x, y) => {
    const blob = await window.SMPDFLite.compose([{
      doc: window.A, page: 0, stamps: [{ sig, x, y, w: 0.3 }],
    }]);
    const ink = await window.inkByQuadrant(blob);
    return { gain: ink.q.map((v, i) => v - base.q[i]), text: await window.textOf(blob) };
  };

  return {
    base: base.q,
    br: await at(0.75, 0.8),   // 右下
    tr: await at(0.75, 0.2),   // 右上
    bl: await at(0.25, 0.8),   // 左下
  };
});

const winner = (gain) => gain.indexOf(Math.max(...gain));
check('放在右下角就蓋在右下角',
  winner(placed.br.gain) === 3 && placed.br.gain[3] > 400, JSON.stringify(placed.br.gain));
check('放在右上角就蓋在右上角',
  winner(placed.tr.gain) === 1 && placed.tr.gain[1] > 400, JSON.stringify(placed.tr.gain));
check('放在左下角就蓋在左下角',
  winner(placed.bl.gain) === 2 && placed.bl.gain[2] > 400, JSON.stringify(placed.bl.gain));
check('只有放上去的那一區變多',
  placed.br.gain.filter((v) => v > 100).length === 1, JSON.stringify(placed.br.gain));
check('原本的文字沒被動到', placed.br.text === 'PAGE-A1', placed.br.text);

// ── 轉過向的頁面 ────────────────────────────────────────
// 這是整個功能最容易寫錯的地方：/Rotate 是檢視器轉的，內容串流的座標不會跟著轉。
const rotated = await page.evaluate(async () => {
  const sig = window.demoSig();
  const out = {};
  // pages-a.pdf 第 3 頁本身就有 /Rotate 90；再讓使用者按一次右轉試 180
  for (const [key, pick] of Object.entries({
    inherent: { doc: window.A, page: 2 },
    plusUser: { doc: window.A, page: 2, rotate: 90 },
    userOnly: { doc: window.A, page: 0, rotate: 90 },
  })) {
    const plain = await window.SMPDFLite.compose([pick]);
    const base = await window.inkByQuadrant(plain);
    const blob = await window.SMPDFLite.compose([{ ...pick, stamps: [{ sig, x: 0.75, y: 0.8, w: 0.3 }] }]);
    const ink = await window.inkByQuadrant(blob);
    out[key] = { gain: ink.q.map((v, i) => v - base.q[i]), size: [ink.width, ink.height] };
  }
  return out;
});

check('頁面本身就是橫的：仍蓋在畫面的右下角',
  winner(rotated.inherent.gain) === 3 && rotated.inherent.gain[3] > 400,
  JSON.stringify(rotated.inherent));
check('再按一次右轉（合計 180°）：仍蓋在畫面的右下角',
  winner(rotated.plusUser.gain) === 3 && rotated.plusUser.gain[3] > 400,
  JSON.stringify(rotated.plusUser));
check('直式頁面按右轉後：仍蓋在畫面的右下角',
  winner(rotated.userOnly.gain) === 3 && rotated.userOnly.gain[3] > 400,
  JSON.stringify(rotated.userOnly));

// ── 大小與長寬比 ────────────────────────────────────────
const sized = await page.evaluate(async () => {
  const sig = window.demoSig();
  const measure = async (w) => {
    const blob = await window.SMPDFLite.compose([{
      doc: window.A, page: 0, stamps: [{ sig, x: 0.5, y: 0.5, w }],
    }]);
    // 量墨跡的外框，確認寬高比等於簽名自己的長寬比
    const doc = await window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    }).promise;
    const p = await doc.getPage(1);
    const viewport = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let i = 0, n = 0; i < data.length; i += 4, n++) {
      if (data[i] > 150) continue;
      const x = n % canvas.width;
      const y = (n - x) / canvas.width;
      if (y < canvas.height * 0.25) continue;   // 跳過頁首的文字
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return { w: maxX - minX, h: maxY - minY, pageW: canvas.width, aspect: sig.aspect };
  };
  return { small: await measure(0.2), big: await measure(0.5) };
});

check('大小是相對頁寬的比例',
  Math.abs(sized.small.w / sized.small.pageW - 0.2) < 0.04 &&
  Math.abs(sized.big.w / sized.big.pageW - 0.5) < 0.04,
  JSON.stringify([sized.small.w / sized.small.pageW, sized.big.w / sized.big.pageW]));
check('簽名不會被拉扁 —— 高度由長寬比決定',
  Math.abs(sized.big.w / sized.big.h - sized.big.aspect) / sized.big.aspect < 0.12,
  `畫出來 ${(sized.big.w / sized.big.h).toFixed(2)} vs 簽名 ${sized.big.aspect.toFixed(2)}`);

// ── 傾斜的方向要跟畫面上看到的一致 ──────────────────────
// CSS 的 rotate(正值) 是順時針，canvas 的 ctx.rotate(正值) 也是。
// PDF 這條路多套了一層上下翻轉的矩陣，符號很容易寫反 ——
// 寫反了畫面上往右傾、蓋出來往左傾，而且只有列印出來才會發現。
const tilt = await page.evaluate(async () => {
  // 墨集中在上半部的簽名：轉了之後「重心跑去哪」就看得出轉的方向
  const topHeavy = window.SMSignLite.fromStrokes([
    [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 6 }, { x: 100, y: 6 }],
    [{ x: 0, y: 12 }, { x: 100, y: 12 }],
    [{ x: 0, y: 100 }, { x: 100, y: 100 }],
  ], { color: '#000000', width: 0.05 });

  /** 墨的重心相對於蓋章中心的位移（畫面座標，y 往下） */
  const centroid = async (rotate) => {
    const blob = await window.SMPDFLite.compose([{
      doc: window.A, page: 0, stamps: [{ sig: topHeavy, x: 0.5, y: 0.55, w: 0.4, rotate }],
    }]);
    const doc = await window.pdfjsLib.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
    }).promise;
    const p = await doc.getPage(1);
    const viewport = p.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0, k = 0; i < data.length; i += 4, k++) {
      if (data[i] > 150) continue;
      const x = k % canvas.width;
      const y = (k - x) / canvas.width;
      if (y < canvas.height * 0.3) continue;    // 跳過頁首的文字
      sx += x; sy += y; n++;
    }
    return n ? {
      dx: sx / n - canvas.width * 0.5,
      dy: sy / n - canvas.height * 0.55,
    } : null;
  };

  return { none: await centroid(0), cw: await centroid(90), ccw: await centroid(-90) };
});

check('沒傾斜時墨集中在上半部', tilt.none.dy < -8, JSON.stringify(tilt.none));
check('正角度是順時針 —— 上方的墨轉到右邊',
  tilt.cw.dx > 8 && Math.abs(tilt.cw.dy) < Math.abs(tilt.none.dy), JSON.stringify(tilt.cw));
check('負角度是逆時針 —— 上方的墨轉到左邊',
  tilt.ccw.dx < -8, JSON.stringify(tilt.ccw));

// ── 點陣印章：透明真的是透明 ────────────────────────────
const raster = await page.evaluate(async () => {
  // 一枚實心方塊印章。如果 SMask 沒生效，白底會蓋掉底下的字
  const c = document.createElement('canvas');
  c.width = 120; c.height = 120;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 120, 120);
  ctx.strokeStyle = '#c0202a';
  ctx.lineWidth = 10;
  ctx.strokeRect(15, 15, 90, 90);          // 只有外框有墨，中間是白的
  const sig = { ...window.SMSignLite.fromImage(c, { mode: 'keep' }), id: 'chop-1' };

  // 蓋在頁首的文字上，看得出來有沒有把字遮掉
  const blob = await window.SMPDFLite.compose([{
    doc: window.A, page: 0, stamps: [{ sig, x: 0.2, y: 0.12, w: 0.25 }],
  }]);
  const text = await window.textOf(blob);

  const doc = await window.pdfjsLib.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
  }).promise;
  const p = await doc.getPage(1);
  const viewport = p.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const cc = canvas.getContext('2d', { willReadFrequently: true });
  cc.fillStyle = '#fff';
  cc.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: cc, viewport }).promise;
  const { data } = cc.getImageData(0, 0, canvas.width, canvas.height);

  let red = 0;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 130 && data[i + 1] < 90 && data[i + 2] < 90) red++;
    if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) dark++;
  }
  return { red, dark, text, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
});

check('點陣印章蓋得上去，而且是紅的', raster.red > 300, `紅色像素 ${raster.red}`);
check('印章中間是透明的 —— 底下的黑字還在', raster.dark > 200, `深色像素 ${raster.dark}`);
check('點陣印章不影響文字抽取', raster.text === 'PAGE-A1', raster.text);

const rasterStructure = qpdfCheck(Uint8Array.from(raster.bytes));
if (rasterStructure.skipped) console.log('  · 跳過 qpdf 結構檢查（沒有 pikepdf）');
else check('含影像 XObject + SMask 的輸出通過 qpdf 檢查', rasterStructure.ok, rasterStructure.out);

// ── 多頁 / 資源不互相污染 ───────────────────────────────
const spread = await page.evaluate(async () => {
  const sig = window.demoSig();
  const picks = [0, 1, 2].map((p) => ({ doc: window.A, page: p }));
  const plain = await window.SMPDFLite.compose(picks);
  const before = await Promise.all([1, 2, 3].map((n) => window.inkByQuadrant(plain, n)));

  // 只蓋第 2 頁
  picks[1] = { ...picks[1], stamps: [{ sig, x: 0.75, y: 0.8, w: 0.3 }] };
  const blob = await window.SMPDFLite.compose(picks);
  const after = await Promise.all([1, 2, 3].map((n) => window.inkByQuadrant(blob, n)));

  return {
    gains: after.map((a, i) => a.q.map((v, j) => v - before[i].q[j])),
    texts: await Promise.all([1, 2, 3].map((n) => window.textOf(blob, n))),
    bytes: [...new Uint8Array(await blob.arrayBuffer())],
  };
});

check('只蓋指定的那一頁', spread.gains[1][3] > 400, JSON.stringify(spread.gains[1]));
check('沒指定的頁面完全沒被改到',
  spread.gains[0].every((v) => Math.abs(v) < 40) && spread.gains[2].every((v) => Math.abs(v) < 40),
  JSON.stringify([spread.gains[0], spread.gains[2]]));
check('三頁的文字都還在', spread.texts.join(',') === 'PAGE-A1,PAGE-A2,PAGE-A3', spread.texts.join(','));

const structure = qpdfCheck(Uint8Array.from(spread.bytes));
if (structure.skipped) console.log('  · 跳過 qpdf 結構檢查（沒有 pikepdf）');
else check('蓋章後的結構通過 qpdf 檢查', structure.ok && /PAGES 3/.test(structure.out), structure.out);

console.log('\n蓋到圖片上');

// ── 圖片合成 ────────────────────────────────────────────
const onImage = await page.evaluate(async () => {
  const sig = window.demoSig();
  const canvas = document.createElement('canvas');
  canvas.width = 400; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 300);

  window.SMImageLocal.drawSignatures(canvas, [{ sig, x: 0.75, y: 0.8, w: 0.3, color: '#000000' }]);

  const cc = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = cc.getImageData(0, 0, 400, 300);
  const q = [0, 0, 0, 0];
  for (let i = 0, n = 0; i < data.length; i += 4, n++) {
    if (data[i] > 128) continue;
    const x = n % 400;
    const y = (n - x) / 400;
    q[(y < 150 ? 0 : 2) + (x < 200 ? 0 : 1)]++;
  }

  // 大小要跟著畫布縮放：同樣的 w，畫布大一倍墨也該多一倍（面積是四倍）
  const bigger = document.createElement('canvas');
  bigger.width = 800; bigger.height = 600;
  const bctx = bigger.getContext('2d');
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0, 0, 800, 600);
  window.SMImageLocal.drawSignatures(bigger, [{ sig, x: 0.75, y: 0.8, w: 0.3, color: '#000000' }]);
  const bdata = bigger.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 800, 600).data;
  let bigInk = 0;
  for (let i = 0; i < bdata.length; i += 4) if (bdata[i] < 128) bigInk++;

  return { q, small: q.reduce((a, b) => a + b, 0), bigInk };
});

check('簽名畫在圖片上的指定位置', winner(onImage.q) === 3 && onImage.q[3] > 200, JSON.stringify(onImage.q));
check('位置與大小是相對值 —— 換個尺寸重畫也對得上',
  onImage.bigInk / onImage.small > 3 && onImage.bigInk / onImage.small < 5,
  `${onImage.small} → ${onImage.bigInk}（比值 ${(onImage.bigInk / onImage.small).toFixed(2)}）`);

// ── 儲存 ────────────────────────────────────────────────
const storage = await page.evaluate(() => {
  localStorage.removeItem(window.SMSignLite._internals.KEY);
  const a = window.SMSignLite.save({ ...window.demoSig(), name: '第一枚' });
  const b = window.SMSignLite.save({ ...window.demoSig(), name: '第二枚' });
  const renamed = window.SMSignLite.rename(a.saved.id, '改過名');
  const afterRemove = window.SMSignLite.remove(b.saved.id);
  const raw = JSON.parse(localStorage.getItem(window.SMSignLite._internals.KEY));
  return {
    count: b.items.length,
    newestFirst: b.items[0].name === '第二枚',
    renamed: renamed.find((s) => s.id === a.saved.id).name,
    left: afterRemove.length,
    stripped: raw.every((s) => !Object.keys(s).some((k) => k.startsWith('_'))),
  };
});

check('簽名存得起來、最新的排前面', storage.count === 2 && storage.newestFirst, JSON.stringify(storage));
check('可以改名', storage.renamed === '改過名', storage.renamed);
check('可以刪除', storage.left === 1, String(storage.left));
check('存檔時丟掉快取欄位', storage.stripped, JSON.stringify(storage));

// ── 收尾 ────────────────────────────────────────────────
check('過程中沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
