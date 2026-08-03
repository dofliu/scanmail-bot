/**
 * 文件邊界偵測 + 透視校正的功能測試（static/js/scan-lite.js）。
 *
 * 驗法是**合成有標準答案的「拍紙本」影像**：白色四邊形放在深色背景上，
 * 裡面畫幾條線當內文，四個角的座標是已知的。偵測完直接量角點誤差。
 *
 * 這樣才驗得出真正要緊的事 —— 不是「有沒有回傳四個點」，而是
 * 「回傳的點對不對」。另外刻意放了幾個**應該偵測失敗**的場景
 * （整片同色、只有背景），確認它會誠實回報低信心而不是硬給一個答案：
 * 亂裁一通比不裁更糟，使用者不會發現。
 *
 * 執行：cd mobile && npm run test:scan
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const PORT = 8971;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>scan harness</title>
<script src="/js/image-local.js"><\/script>
<script src="/js/scan-lite.js"><\/script>
</head><body></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/__harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = path.join(STATIC, url);
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
await page.waitForTimeout(200);

await page.evaluate(() => {
  /**
   * 合成一張「桌上的紙」。
   * @param {object} o corners 給四個角（順時針 TL,TR,BR,BL），null 表示不畫紙
   */
  window.makeShot = (o = {}) => {
    const w = o.width || 640;
    const h = o.height || 480;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    // 背景：深色桌面，加一點雜訊避免完全平坦（真實照片不會是純色）
    ctx.fillStyle = o.bg || '#4a4038';
    ctx.fillRect(0, 0, w, h);
    if (o.noise !== false) {
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 18;
        img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
    }
    if (!o.corners) return c;

    const [tl, tr, br, bl] = o.corners;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y);
    ctx.lineTo(tr.x, tr.y);
    ctx.lineTo(br.x, br.y);
    ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = o.paper || '#f2f0ea';
    ctx.fill();
    ctx.clip();

    // 內文：幾條深色橫線。**要畫在「紙的座標系」上再投影回影像** ——
    // 真實照片裡的文字是跟著紙一起變形的。直接畫水平線的話，斜拍時那些線
    // 會比紙的上緣更「水平」，偵測器就會把最上面那條字當成紙的邊，
    // 那是測資造出來的假問題，不是演算法的問題。
    if (o.text !== false) {
      const H = window.SMScanLite._internals.homography([tl, tr, br, bl]);
      const map = (u, v) => {
        const d = H[6] * u + H[7] * v + H[8];
        return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
      };
      ctx.strokeStyle = '#333';
      ctx.lineWidth = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y) / 90);
      for (let i = 1; i <= 9; i++) {
        const v = i / 11;
        const a = map(0.14, v);
        const b = map(i % 3 === 0 ? 0.58 : 0.85, v);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 反光：打在紙面上的白色熱點（燈或窗戶正對著紙的樣子）。
    // 裁到紙的形狀內 —— 反光是紙面反射出來的，不會溢到桌面上
    if (o.glare) {
      const g = ctx.createRadialGradient(o.glare.x, o.glare.y, 4, o.glare.x, o.glare.y, o.glare.r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    return c;
  };

  /** 偵測結果與標準答案的角點誤差（像素） */
  window.cornerError = (got, truth) => {
    const order = window.SMScanLite._internals.order;
    const a = order(got);
    const b = order(truth);
    return a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y));
  };
});

console.log('\n偵測：正對著拍');

const straight = await page.evaluate(() => {
  const corners = [
    { x: 120, y: 70 }, { x: 520, y: 70 }, { x: 520, y: 410 }, { x: 120, y: 410 },
  ];
  const shot = window.makeShot({ corners });
  const t0 = performance.now();
  const res = window.SMScanLite.detect(shot);
  const ms = performance.now() - t0;
  return { res, err: window.cornerError(res.corners, corners), ms };
});

check('正對著拍：四個角都抓得準（誤差 < 6px）',
  Math.max(...straight.err) < 6,
  `誤差 ${straight.err.map((e) => e.toFixed(1)).join(', ')}`);
check('正對著拍：信心夠高，可以自動裁切',
  straight.res.confidence > 0.45, `confidence=${straight.res.confidence.toFixed(3)}`);
check('偵測夠快（單張 < 700ms）', straight.ms < 700, `${straight.ms.toFixed(0)}ms`);

console.log('\n偵測：斜著拍（透視變形）');

const skewed = await page.evaluate(() => {
  // 由左往右拍，右邊比較遠所以比較短 —— 典型的斜拍梯形
  const corners = [
    { x: 100, y: 90 }, { x: 505, y: 130 }, { x: 500, y: 380 }, { x: 95, y: 425 },
  ];
  const shot = window.makeShot({ corners });
  const res = window.SMScanLite.detect(shot);
  return { res, err: window.cornerError(res.corners, corners) };
});

check('斜著拍：四個角都抓得準（誤差 < 8px）',
  Math.max(...skewed.err) < 8, `誤差 ${skewed.err.map((e) => e.toFixed(1)).join(', ')}`);
check('斜著拍：信心夠高', skewed.res.confidence > 0.45,
  `confidence=${skewed.res.confidence.toFixed(3)}`);

console.log('\n偵測：難一點的場景');

const hard = await page.evaluate(() => {
  const out = {};

  // 1. 角被手指擋住 —— 選 Hough 而不是輪廓追蹤，主要就是為了這個：
  //    直線由整條邊投票決定，缺一個角不影響那兩條線的位置
  {
    const corners = [
      { x: 120, y: 70 }, { x: 520, y: 70 }, { x: 520, y: 410 }, { x: 120, y: 410 },
    ];
    const shot = window.makeShot({ corners });
    const ctx = shot.getContext('2d');
    ctx.fillStyle = '#c8a288';           // 手指
    ctx.beginPath();
    ctx.ellipse(120, 410, 52, 30, -0.5, 0, Math.PI * 2);
    ctx.fill();
    const res = window.SMScanLite.detect(shot);
    out.occluded = { conf: res.confidence, err: window.cornerError(res.corners, corners) };
  }

  // 2. 文件是斜的（沒有對齊畫面）
  {
    const cx = 320;
    const cy = 240;
    const a = (14 * Math.PI) / 180;
    const rot = (p) => ({
      x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
      y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
    });
    const corners = [
      { x: 150, y: 90 }, { x: 490, y: 90 }, { x: 490, y: 390 }, { x: 150, y: 390 },
    ].map(rot);
    const res = window.SMScanLite.detect(window.makeShot({ corners }));
    out.rotated = { conf: res.confidence, err: window.cornerError(res.corners, corners) };
  }

  // 3. 昏暗、對比低的照片 —— 門檻若寫死就會整個失效
  {
    const corners = [
      { x: 130, y: 80 }, { x: 510, y: 80 }, { x: 510, y: 400 }, { x: 130, y: 400 },
    ];
    const res = window.SMScanLite.detect(window.makeShot({
      corners, bg: '#2e2c28', paper: '#6b6862',
    }));
    out.dim = { conf: res.confidence, err: window.cornerError(res.corners, corners) };
  }

  return out;
});

check('角被手指擋住仍抓得到（誤差 < 10px）',
  Math.max(...hard.occluded.err) < 10,
  `誤差 ${hard.occluded.err.map((e) => e.toFixed(1)).join(', ')} conf=${hard.occluded.conf.toFixed(2)}`);
check('文件斜放（旋轉 14°）仍抓得到（誤差 < 10px）',
  Math.max(...hard.rotated.err) < 10,
  `誤差 ${hard.rotated.err.map((e) => e.toFixed(1)).join(', ')} conf=${hard.rotated.conf.toFixed(2)}`);
check('昏暗低對比的照片仍抓得到（誤差 < 10px）—— 梯度門檻是取分位數不是寫死',
  Math.max(...hard.dim.err) < 10,
  `誤差 ${hard.dim.err.map((e) => e.toFixed(1)).join(', ')} conf=${hard.dim.conf.toFixed(2)}`);

console.log('\n偵測：該失敗的時候要老實說');

const negatives = await page.evaluate(() => {
  const blank = window.SMScanLite.detect(window.makeShot({ corners: null }));
  // 整張都是紙（沒有背景可比）—— 四邊都貼邊，應該被貼邊規則擋掉
  const full = window.SMScanLite.detect(window.makeShot({
    corners: [{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 480 }, { x: 0, y: 480 }],
  }));
  return { blank, full };
});

check('只有背景、沒有文件 → 低信心',
  negatives.blank.confidence < 0.45,
  `confidence=${negatives.blank.confidence.toFixed(3)} method=${negatives.blank.method}`);
check('失敗時仍給一個可以手動調整的起始框',
  negatives.blank.corners.length === 4 && negatives.blank.corners.every((p) => isFinite(p.x)),
  JSON.stringify(negatives.blank.corners));
check('整張照片都是紙 → 不會硬說「這就是文件」',
  negatives.full.confidence < 0.45,
  `confidence=${negatives.full.confidence.toFixed(3)}`);

console.log('\n拍壞的時候要說得出「為什麼」');

// 「沒把握」不可行動 —— 使用者只能原地再拍一張一模一樣的照片。
// 這一段驗的是 detect() 有沒有把偵測時算過的量測值換成具體的補救動作。
// 每個情境都只改一個變因，所以出來的建議應該剛好對上那個變因。
const diag = await page.evaluate(() => {
  const NORMAL = [{ x: 120, y: 70 }, { x: 520, y: 70 }, { x: 520, y: 410 }, { x: 120, y: 410 }];
  const run = (o) => {
    const r = window.SMScanLite.detect(window.makeShot(o));
    return {
      conf: r.confidence,
      codes: r.hints.map((h) => h.code),
      sev: r.hints.map((h) => h.severity),
      texts: r.hints.map((h) => h.text),
      quality: r.quality,
    };
  };
  return {
    ok: run({ corners: NORMAL }),
    dark: run({ corners: NORMAL, bg: '#151310', paper: '#4a473f' }),
    dim: run({ corners: NORMAL, bg: '#2e2c28', paper: '#6b6862' }),
    glare: run({ corners: NORMAL, glare: { x: 330, y: 230, r: 130 } }),
    far: run({ corners: [{ x: 250, y: 180 }, { x: 390, y: 180 }, { x: 390, y: 300 }, { x: 250, y: 300 }] }),
    flat: run({ corners: NORMAL, bg: '#e2e0da', paper: '#f2f0ea' }),
    cropped: run({ corners: [{ x: 200, y: 70 }, { x: 639, y: 70 }, { x: 639, y: 410 }, { x: 200, y: 410 }] }),
    blank: run({ corners: null }),
    // 又暗又小又跟桌面同色 —— 一次踩到好幾個問題
    messy: run({
      corners: [{ x: 260, y: 190 }, { x: 380, y: 190 }, { x: 380, y: 290 }, { x: 260, y: 290 }],
      bg: '#26241f', paper: '#38352e',
    }),
  };
});

check('拍得好的照片不會被亂給建議',
  diag.ok.codes.length === 0,
  `conf=${diag.ok.conf.toFixed(2)} 卻給了 ${diag.ok.codes.join(',')}`);
check('太暗 → 說得出「光線不足」而不是只說沒把握',
  diag.dark.codes.includes('dark'),
  `codes=${diag.dark.codes.join(',')} paperMean=${diag.dark.quality.paperMean?.toFixed(0)}`);
check('昏暗但拍得清楚的照片不會被誤判成太暗 —— 門檻要留餘裕',
  !diag.dim.codes.includes('dark'),
  `paperMean=${diag.dim.quality.paperMean?.toFixed(0)} codes=${diag.dim.codes.join(',')}`);
check('紙面反光 → 說得出「反光」',
  diag.glare.codes.includes('glare'),
  `codes=${diag.glare.codes.join(',')} glare=${diag.glare.quality.glare?.toFixed(3)}`);
check('反光的判準是過曝比例，不是「整體偏亮」',
  diag.glare.quality.glare > 0.03 && diag.ok.quality.glare < 0.005,
  `反光 ${diag.glare.quality.glare?.toFixed(3)} vs 正常 ${diag.ok.quality.glare?.toFixed(3)}`);
check('離太遠 → 說得出「靠近一點」',
  diag.far.codes.includes('far'),
  `codes=${diag.far.codes.join(',')} areaRatio=${diag.far.quality.areaRatio?.toFixed(3)}`);
check('紙跟桌面同色 → 說得出「換張深色桌面」',
  diag.flat.codes.includes('flat'),
  `codes=${diag.flat.codes.join(',')} contrast=${diag.flat.quality.contrast?.toFixed(1)}`);
check('紙被畫面切掉 → 說得出「退後一點」',
  diag.cropped.codes.includes('cropped'),
  `codes=${diag.cropped.codes.join(',')} touching=${diag.cropped.quality.touching}`);
// 量不出原因也不能沉默 —— 沉默等於把使用者丟回原地
check('低信心但量不出原因時，至少給一句通用的補救方向',
  diag.blank.conf < 0.45 && diag.blank.codes.length > 0,
  `conf=${diag.blank.conf.toFixed(2)} codes=${diag.blank.codes.join(',')}`);
check('建議依嚴重程度排序，而且不會一次倒一長串（最多 3 條）',
  diag.messy.codes.length >= 2 && diag.messy.codes.length <= 3
    && diag.messy.sev.every((s, i) => i === 0 || s <= diag.messy.sev[i - 1]),
  `codes=${diag.messy.codes.join(',')} sev=${diag.messy.sev.map((s) => s.toFixed(2)).join(',')}`);
check('每條建議都帶著可以直接顯示的中文文案',
  diag.dark.texts.every((t) => typeof t === 'string' && t.length > 8),
  JSON.stringify(diag.dark.texts));
check('抓得準的時候 hints 是空陣列而不是 undefined —— 呼叫端不必特判',
  Array.isArray(diag.ok.codes) && diag.ok.conf > 0.45,
  `conf=${diag.ok.conf.toFixed(2)}`);

console.log('\n真實寬高比反推');

const aspect = await page.evaluate(() => {
  // A4 直式（1:√2 ≈ 0.707）用針孔相機投影出來的四邊形
  const f = 800;
  const project = (X, Y, Z) => ({ x: 320 + (f * X) / Z, y: 240 + (f * Y) / Z });
  // 紙在空間中傾斜：繞 y 軸轉 35°
  const a = (35 * Math.PI) / 180;
  const W = 210;
  const H = 297;
  const pt = (u, v) => {
    const X0 = (u - 0.5) * W;
    const Y0 = (v - 0.5) * H;
    return project(X0 * Math.cos(a), Y0, 900 + X0 * Math.sin(a));
  };
  const corners = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];
  const recovered = window.SMScanLite.recoverAspect(corners, 640, 480);
  const naive = (() => {
    const o = window.SMScanLite._internals.order(corners);
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    const wAvg = (d(o[0], o[1]) + d(o[3], o[2])) / 2;
    const hAvg = (d(o[0], o[3]) + d(o[1], o[2])) / 2;
    return wAvg / hAvg;
  })();
  return { recovered, naive, truth: W / H };
});

check('斜拍的 A4 能反推回 1:√2（誤差 < 8%）',
  aspect.recovered && Math.abs(aspect.recovered - aspect.truth) / aspect.truth < 0.08,
  `反推 ${aspect.recovered?.toFixed(3)} vs 真值 ${aspect.truth.toFixed(3)}`);
check('反推確實比「直接量影像上的邊長」準',
  Math.abs(aspect.recovered - aspect.truth) < Math.abs(aspect.naive - aspect.truth),
  `反推 ${aspect.recovered?.toFixed(3)} / 直接量 ${aspect.naive.toFixed(3)} / 真值 ${aspect.truth.toFixed(3)}`);

console.log('\n透視校正');

const warped = await page.evaluate(async () => {
  // 畫一個有明顯格線的梯形，拉正之後格線應該變成正交的直線
  const w = 640;
  const h = 480;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, w, h);

  const corners = [
    { x: 120, y: 60 }, { x: 520, y: 120 }, { x: 500, y: 400 }, { x: 100, y: 430 },
  ];
  const H = window.SMScanLite._internals.homography(
    window.SMScanLite._internals.order(corners));
  const map = (u, v) => {
    const d = H[6] * u + H[7] * v + H[8];
    return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
  };
  // 白紙
  ctx.beginPath();
  const o = window.SMScanLite._internals.order(corners);
  ctx.moveTo(o[0].x, o[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(o[i].x, o[i].y);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  // 在「紙的座標系」上畫十字，投影到影像上會變成斜的
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  for (const t of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    let p = map(t, 0.05);
    ctx.moveTo(p.x, p.y);
    for (let s = 0.05; s <= 0.95; s += 0.05) { p = map(t, s); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }

  const out = window.SMScanLite.warp(c, corners);
  const out2d = window.SMScanLite.warp(c, corners, { force2d: true });

  /** 量「每一條黑線在各個高度的 x 位置」的抖動 —— 拉正後應該是垂直的 */
  const verticality = (canvas) => {
    const cc = document.createElement('canvas');
    cc.width = canvas.width; cc.height = canvas.height;
    const cx = cc.getContext('2d', { willReadFrequently: true });
    cx.drawImage(canvas, 0, 0);
    const { data } = cx.getImageData(0, 0, cc.width, cc.height);
    const rows = [];
    for (let y = Math.round(cc.height * 0.2); y < cc.height * 0.8; y += 4) {
      const xs = [];
      for (let x = 0; x < cc.width; x++) {
        if (data[(y * cc.width + x) * 4] < 110) xs.push(x);
      }
      // 把連續的黑點併成一條線，取中心
      const centers = [];
      let run = [];
      for (const x of xs) {
        if (run.length && x - run[run.length - 1] > 3) {
          centers.push(run.reduce((a, b) => a + b, 0) / run.length);
          run = [];
        }
        run.push(x);
      }
      if (run.length) centers.push(run.reduce((a, b) => a + b, 0) / run.length);
      if (centers.length === 3) rows.push(centers);
    }
    if (rows.length < 5) return null;
    // 每一條線在不同高度的 x 標準差
    return [0, 1, 2].map((i) => {
      const vals = rows.map((r) => r[i]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    });
  };

  return {
    size: [out.width, out.height],
    gl: verticality(out),
    twoD: verticality(out2d),
    sameSize: out.width === out2d.width && out.height === out2d.height,
  };
});

// 方向：只驗「線是不是直的」抓不到上下顛倒 —— 垂直線翻過來還是垂直線。
// 所以另外拿四個顏色不同的象限做恆等變換，看它們有沒有各就各位。
const orientation = await page.evaluate(() => {
  const w = 400;
  const h = 300;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, w / 2, h / 2);         // 左上 紅
  ctx.fillStyle = '#00ff00'; ctx.fillRect(w / 2, 0, w / 2, h / 2);     // 右上 綠
  ctx.fillStyle = '#0000ff'; ctx.fillRect(0, h / 2, w / 2, h / 2);     // 左下 藍
  ctx.fillStyle = '#ffff00'; ctx.fillRect(w / 2, h / 2, w / 2, h / 2); // 右下 黃

  const idQuad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const probe = (canvas) => {
    const t = document.createElement('canvas');
    t.width = canvas.width; t.height = canvas.height;
    const tc = t.getContext('2d', { willReadFrequently: true });
    tc.drawImage(canvas, 0, 0);
    const at = (fx, fy) => {
      const d = tc.getImageData(Math.round(fx * (t.width - 1)), Math.round(fy * (t.height - 1)), 1, 1).data;
      return `${d[0]},${d[1]},${d[2]}`;
    };
    return [at(0.25, 0.25), at(0.75, 0.25), at(0.25, 0.75), at(0.75, 0.75)].join(' | ');
  };
  const expect = '255,0,0 | 0,255,0 | 0,0,255 | 255,255,0';
  return {
    expect,
    gl: probe(window.SMScanLite.warp(c, idQuad)),
    two: probe(window.SMScanLite.warp(c, idQuad, { force2d: true })),
  };
});

check('恆等變換不會把影像翻過來（WebGL）',
  orientation.gl === orientation.expect, `得到 ${orientation.gl} / 應為 ${orientation.expect}`);
check('恆等變換不會把影像翻過來（canvas 2D）',
  orientation.two === orientation.expect, `得到 ${orientation.two} / 應為 ${orientation.expect}`);

check('拉正後線條變垂直（WebGL，抖動 < 1.5px）',
  warped.gl && Math.max(...warped.gl) < 1.5,
  `抖動 ${warped.gl?.map((v) => v.toFixed(2)).join(', ')}`);
check('canvas 2D 退路的結果一樣可用（抖動 < 2.5px）',
  warped.twoD && Math.max(...warped.twoD) < 2.5,
  `抖動 ${warped.twoD?.map((v) => v.toFixed(2)).join(', ')}`);
check('兩條路徑輸出同樣的尺寸', warped.sameSize, JSON.stringify(warped.size));

console.log('\n端到端：偵測 → 拉正');

const endToEnd = await page.evaluate(() => {
  const corners = [
    { x: 110, y: 80 }, { x: 512, y: 128 }, { x: 498, y: 388 }, { x: 96, y: 418 },
  ];
  const shot = window.makeShot({ corners });
  const res = window.SMScanLite.detect(shot);
  const out = window.SMScanLite.warp(shot, res.corners);

  // 拉正後四個角應該都是紙（亮），而不是桌面（暗）
  const cx = out.getContext('2d', { willReadFrequently: true });
  if (!cx) return { error: 'warp 回傳的畫布拿不到 2D context' };
  const probe = (x, y) => {
    const d = cx.getImageData(Math.min(x, out.width - 1), Math.min(y, out.height - 1), 1, 1).data;
    return (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114);
  };
  const inset = 6;
  const corners4 = [
    probe(inset, inset), probe(out.width - inset, inset),
    probe(out.width - inset, out.height - inset), probe(inset, out.height - inset),
  ];
  return { confidence: res.confidence, size: [out.width, out.height], corners4 };
});

// 一張 canvas 只能有一種 context —— warp 若直接回傳 WebGL 畫布，
// 呼叫端的 getContext('2d') 會拿到 null，後面的合成整條斷掉
check('warp 回傳的是一般的 2D 畫布，接得上其他工具', !endToEnd.error, endToEnd.error);
check('端到端：拉正後四個角落都是紙，沒有把桌面帶進來',
  endToEnd.corners4 && endToEnd.corners4.every((v) => v > 150),
  `四角亮度 ${endToEnd.corners4?.map((v) => v.toFixed(0)).join(', ')}`);
check('端到端：輸出尺寸合理', endToEnd.size && endToEnd.size[0] > 200 && endToEnd.size[1] > 150,
  JSON.stringify(endToEnd.size));

check('過程中沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
