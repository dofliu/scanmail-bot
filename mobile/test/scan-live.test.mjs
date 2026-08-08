/**
 * 即時取景引擎（static/js/scan-live.js）的功能測試。
 *
 * 沒有真的相機也驗得出來 —— 用 `canvas.captureStream()` 合成一條**會動的**
 * 影像串流當假相機：畫面內容是「桌上的一張紙」，四個角的座標是已知的，
 * 所以偵測回來的框對不對可以直接量。這樣測到的是真正要緊的三件事：
 *
 *   1. **框對不對**：相對座標 vs 已知角點
 *   2. **節流有沒有生效**：偵測是同步的，沒節流會把 UI 執行緒吃光 ——
 *      所以驗兩次偵測之間真的隔了 interval，而不是每幀都跑
 *   3. **收得乾不乾淨**：stop() 之後軌道要 ended、不能再有回呼 ——
 *      漏收的話相機燈會一直亮著，使用者只會覺得這個 App 在偷拍
 *   4. **自動快門拍不拍**：靜止的畫面要拍、一直在動的不能拍、抓不準的不能拍，
 *      而且拍到一半被收掉時那張照片不能事後才冒出來
 *
 * 另外驗快門：拍下來的是**全解析度**的那一張（不是偵測用的縮圖），
 * 而且回傳的框是對這張重新測過的 —— 拉正畫面才不會「拍完框就變了」。
 *
 * **自動快門這一段的時間都用輪詢而不是固定秒數**：偵測是同步的，機器忙的時候
 * 一次可能久上好幾倍，等固定秒數紅的會是 CI 的負載而不是這個功能。
 *
 * 執行：cd mobile && npm run test:live
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const PORT = 8973;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>live harness</title>
<script src="/js/image-local.js"><\/script>
<script src="/js/scan-lite.js"><\/script>
<script src="/js/scan-live.js"><\/script>
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

// ── 假相機 ────────────────────────────────────────────────
await page.evaluate(() => {
  /** 桌上的一張紙。內文畫在紙的座標系上再投影回影像，斜拍時才不會變成假邊 */
  window.paintScene = (ctx, w, h, corners) => {
    ctx.fillStyle = '#4a4038';
    ctx.fillRect(0, 0, w, h);
    if (!corners) return;
    const [tl, tr, br, bl] = corners;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y);
    ctx.closePath();
    ctx.fillStyle = '#f2f0ea';
    ctx.fill();
    ctx.clip();
    const H = window.SMScanLite._internals.homography([tl, tr, br, bl]);
    const map = (u, v) => {
      const d = H[6] * u + H[7] * v + H[8];
      return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
    };
    ctx.strokeStyle = '#333';
    // 線要細 —— 畫成 5px 的粗黑條時，偵測器會把最上面那條當成紙的邊而整組失敗。
    // 那是測資的問題不是引擎的問題（真正的內文相對紙張就是這個比例）
    ctx.lineWidth = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y) / 200);
    for (let i = 1; i <= 9; i++) {
      const v = i / 11;
      const a = map(0.14, v);
      const b = map(i % 3 === 0 ? 0.58 : 0.85, v);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  };

  /**
   * 一條會持續送幀的假串流。真的相機一直在送新的畫面，
   * 只畫一次的 captureStream 測不出「迴圈有沒有一直在跑」。
   *
   * 場景先畫在離屏畫布上，再用**一次** drawImage 貼過去 ——
   * captureStream 是在畫布被畫到的當下取樣的，直接一筆一筆畫上去
   * 會送出「只有背景、紙還沒畫上」的半成品幀，測起來像偵測壞了。
   */
  window.fakeCamera = (o = {}) => {
    const c = document.createElement('canvas');
    c.width = o.width || 800;
    c.height = o.height || 600;
    const ctx = c.getContext('2d');
    const off = document.createElement('canvas');
    off.width = c.width;
    off.height = c.height;
    const offCtx = off.getContext('2d');
    const state = { corners: o.corners || null };
    const paint = () => {
      window.paintScene(offCtx, off.width, off.height, state.corners);
      ctx.drawImage(off, 0, 0);
    };
    paint();
    const stream = c.captureStream(o.fps || 15);
    const timer = setInterval(paint, 70);
    return {
      canvas: c, stream, state,
      move: (corners) => { state.corners = corners; },
      close: () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); },
    };
  };

  window.PAPER = [
    { x: 120, y: 90 }, { x: 690, y: 80 }, { x: 700, y: 520 }, { x: 110, y: 530 },
  ];
  window.newVideo = () => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    document.body.appendChild(v);
    return v;
  };
});

const PAPER_REL = [
  { x: 120 / 800, y: 90 / 600 }, { x: 690 / 800, y: 80 / 600 },
  { x: 700 / 800, y: 520 / 600 }, { x: 110 / 800, y: 530 / 600 },
];
/** 相對座標下的平均角點誤差 */
const cornerError = (got, want = PAPER_REL) => {
  if (!got || got.length !== 4) return 1;
  return got.reduce((sum, p, i) => sum + Math.hypot(p.x - want[i].x, p.y - want[i].y), 0) / 4;
};

// ── 支援判斷 ──────────────────────────────────────────────
const support = await page.evaluate(() => {
  const withEngine = window.SMScanLive.isSupported();
  const scan = window.SMScanLite;
  delete window.SMScanLite;
  const withoutEngine = window.SMScanLive.isSupported();
  window.SMScanLite = scan;
  return { withEngine, withoutEngine };
});
check('有相機也有偵測引擎時回報「可以取景」', support.withEngine === true, JSON.stringify(support));
// 少了 scan-lite 只會取到一條沒人看的串流，相機燈還白亮著
check('偵測引擎沒載入時回報「不能取景」', support.withoutEngine === false, JSON.stringify(support));

// ── 取景迴圈：框準不準、有沒有節流、收不收得乾淨 ──────────
const loop = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const got = [];
  const started = Date.now();
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream,
    interval: 250,
    onResult: (r) => got.push({
      at: r.at, ms: r.ms, corners: r.corners, raw: r.rawCorners,
      confidence: r.confidence, method: r.method, low: r.low, frame: r.frame,
    }),
  });
  await new Promise((r) => setTimeout(r, 1500));
  const elapsed = Date.now() - started;
  const trackDuring = cam.stream.getVideoTracks()[0].readyState;
  session.stop();
  const countAtStop = got.length;
  await new Promise((r) => setTimeout(r, 700));
  const out = {
    elapsed,
    count: got.length,
    countAtStop,
    afterStop: got.length - countAtStop,
    trackDuring,
    trackAfter: cam.stream.getVideoTracks()[0].readyState,
    running: session.running,
    errors: session.errors,
    frames: session.frames,
    srcObject: video.srcObject,
    last: got[got.length - 1] || null,
    gaps: got.slice(1).map((r, i) => r.at - got[i].at),
  };
  cam.close();
  video.remove();
  return out;
});

check('偵測迴圈一直在跑，1.5 秒內測了好幾次', loop.count >= 3, `只有 ${loop.count} 次`);
check('框的位置對得上已知的四個角', cornerError(loop.last && loop.last.corners) < 0.03,
  `平均誤差 ${cornerError(loop.last && loop.last.corners).toFixed(4)}`);
check('信心足夠，不會被當成抓不準', loop.last && !loop.last.low && loop.last.method === 'hough',
  JSON.stringify({ confidence: loop.last?.confidence, method: loop.last?.method }));
check('回報的是相機原始解析度（不是偵測用的縮圖）',
  loop.last && loop.last.frame.width === 800 && loop.last.frame.height === 600,
  JSON.stringify(loop.last && loop.last.frame));
// 節流是這個模組的核心：偵測會擋住 UI 執行緒，每幀都跑等於畫面卡死
check('兩次偵測之間有隔開（節流生效）',
  loop.gaps.length > 0 && loop.gaps.every((g) => g >= 200),
  `間隔 ${loop.gaps.join(', ')} ms`);
check('沒有把偵測排成一條隊伍（次數不超過時間 ÷ 間隔）',
  loop.count <= Math.ceil(loop.elapsed / 250) + 1,
  `${loop.count} 次 / ${loop.elapsed} ms`);
check('過程中沒有偵測失敗', loop.errors === 0, `errors=${loop.errors}`);
check('停掉之後相機軌道真的關了（相機燈不會一直亮）',
  loop.trackDuring === 'live' && loop.trackAfter === 'ended',
  `${loop.trackDuring} → ${loop.trackAfter}`);
check('停掉之後不再有回呼', loop.afterStop === 0, `又多了 ${loop.afterStop} 次`);
check('停掉之後 running 是 false、video 也放開串流',
  loop.running === false && !loop.srcObject, JSON.stringify({ running: loop.running }));

// ── 平滑：抖動要收斂，真的移開要跟上 ──────────────────────
const smooth = await page.evaluate(() => {
  const { smoothCorners } = window.SMScanLive._internals;
  const prev = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
  const jitter = prev.map((p) => ({ x: p.x + 0.02, y: p.y }));
  const moved = prev.map((p) => ({ x: p.x + 0.3, y: p.y }));
  return {
    first: smoothCorners(null, jitter, 0.5, 0.1),
    jitter: smoothCorners(prev, jitter, 0.5, 0.1),
    moved: smoothCorners(prev, moved, 0.5, 0.1),
  };
});
check('第一次偵測直接採用，不跟不存在的上一次平均',
  Math.abs(smooth.first[0].x - 0.12) < 1e-6, JSON.stringify(smooth.first[0]));
check('小抖動會被收斂（框不會逐幀跳）',
  Math.abs(smooth.jitter[0].x - 0.11) < 1e-6, JSON.stringify(smooth.jitter[0]));
// 平滑的代價是延遲。鏡頭真的移開時，延遲比抖動更難看 —— 這時候要直接跟上
check('大幅移動不平滑，直接跟上新位置',
  Math.abs(smooth.moved[0].x - 0.4) < 1e-6, JSON.stringify(smooth.moved[0]));

// ── 紙移動了，框要跟過去 ──────────────────────────────────
const follow = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  let last = null;
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 200, onResult: (r) => { last = r; },
  });
  await new Promise((r) => setTimeout(r, 900));
  const before = last && last.corners;
  const shifted = window.PAPER.map((p) => ({ x: p.x - 60, y: p.y + 40 }));
  cam.move(shifted);
  await new Promise((r) => setTimeout(r, 1200));
  const after = last && last.corners;
  session.stop();
  cam.close();
  video.remove();
  return { before, after, want: shifted.map((p) => ({ x: p.x / 800, y: p.y / 600 })) };
});
check('紙移動之後，框跟著移過去',
  cornerError(follow.after, follow.want) < 0.03,
  `移動後誤差 ${cornerError(follow.after, follow.want).toFixed(4)}`);
check('（對照）移動前的框在舊位置，不是一路都沒更新',
  cornerError(follow.before) < 0.03 && cornerError(follow.before, follow.want) > 0.05,
  `舊框誤差 ${cornerError(follow.before).toFixed(4)}`);

// ── 快門 ──────────────────────────────────────────────────
const shot = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const session = await window.SMScanLive.start(video, { stream: cam.stream, interval: 250 });
  await new Promise((r) => setTimeout(r, 700));
  const shot = await session.capture();
  const plain = await session.capture({ detect: false, name: 'x.jpg' });
  const ctx2d = !!shot.canvas.getContext('2d');
  const out = {
    width: shot.width, height: shot.height,
    canvas: [shot.canvas.width, shot.canvas.height],
    isFile: shot.file instanceof File,
    name: shot.file.name, type: shot.file.type, size: shot.file.size,
    corners: shot.corners, confidence: shot.confidence, low: shot.low,
    ctx2d,
    plainCorners: plain.corners, plainSize: plain.file.size,
  };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
// 偵測跑在 640 寬的取樣上，但留下來的照片必須是相機給的原始解析度
check('拍下來的是全解析度的那一張，不是偵測用的縮圖',
  shot.width === 800 && shot.height === 600 && shot.canvas[0] === 800,
  JSON.stringify({ size: [shot.width, shot.height], canvas: shot.canvas }));
check('拍出來的是一般的 2D 畫布，接得上編輯器', shot.ctx2d === true, '拿不到 2D context');
check('回傳可以直接丟進編輯器的 File', shot.isFile && shot.type === 'image/jpeg' && shot.size > 1000,
  JSON.stringify({ isFile: shot.isFile, type: shot.type, size: shot.size }));
check('檔名帶得出來', shot.name.endsWith('.jpg'), shot.name);
// 取景時的結果是「上一張」的 —— 快門要對留下來的這一張重測，
// 拉正畫面才不會出現「跟剛剛看到的不一樣」的框
check('快門對照片本身重新偵測，框對得上', cornerError(shot.corners) < 0.03,
  `平均誤差 ${cornerError(shot.corners).toFixed(4)}`);
check('信心值跟著照片一起回傳', shot.confidence > 0.45 && shot.low === false,
  JSON.stringify({ confidence: shot.confidence, low: shot.low }));
check('明講不要偵測就真的不測（省下 100–300ms）',
  shot.plainCorners === null && shot.plainSize > 1000,
  JSON.stringify({ corners: shot.plainCorners }));

// ── 相機開不起來時的訊息 ──────────────────────────────────
const errors = await page.evaluate(async () => {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const out = {};
  const fail = (name) => Object.assign(new Error(name), { name });

  // 權限被拒是使用者的決定 —— 換個條件再問一次只會再被拒一次
  let denyCalls = 0;
  navigator.mediaDevices.getUserMedia = () => { denyCalls += 1; return Promise.reject(fail('NotAllowedError')); };
  try {
    await window.SMScanLive.start(window.newVideo());
  } catch (e) {
    out.denied = { message: e.message, name: e.cameraError, calls: denyCalls };
  }

  // 沒有相機
  navigator.mediaDevices.getUserMedia = () => Promise.reject(fail('NotFoundError'));
  try {
    await window.SMScanLive.start(window.newVideo());
  } catch (e) {
    out.missing = { message: e.message, name: e.cameraError };
  }

  // 沒有後鏡頭（桌機 / 部分平板）：退回「隨便一顆」再試一次
  const cam = window.fakeCamera({ corners: window.PAPER });
  let calls = 0;
  navigator.mediaDevices.getUserMedia = (c) => {
    calls += 1;
    if (calls === 1) return Promise.reject(fail('OverconstrainedError'));
    return Promise.resolve(cam.stream);
  };
  const video = window.newVideo();
  const session = await window.SMScanLive.start(video, { interval: 300 });
  await new Promise((r) => setTimeout(r, 500));
  out.fallback = { calls, running: session.running, frames: session.frames };
  session.stop();
  cam.close();
  video.remove();

  navigator.mediaDevices.getUserMedia = real;
  return out;
});
check('權限被拒：訊息說得出下一步該做什麼',
  errors.denied && errors.denied.message.includes('權限') && errors.denied.name === 'NotAllowedError',
  JSON.stringify(errors.denied));
check('權限被拒就不再重試（重試也只是再被拒一次）', errors.denied && errors.denied.calls === 1,
  `試了 ${errors.denied && errors.denied.calls} 次`);
check('沒有相機：訊息請使用者改用現成的照片',
  errors.missing && errors.missing.message.includes('找不到相機'), JSON.stringify(errors.missing));
check('沒有後鏡頭時退回任何一顆鏡頭，取景照樣跑得起來',
  errors.fallback && errors.fallback.calls === 2 && errors.fallback.running && errors.fallback.frames > 0,
  JSON.stringify(errors.fallback));

// ── 取樣 ──────────────────────────────────────────────────
const grab = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const session = await window.SMScanLive.start(video, { stream: cam.stream, interval: 5000 });
  const canvas = document.createElement('canvas');
  const a = window.SMScanLive._internals.grabFrame(video, canvas, 640);
  const sameCanvas = a && a.canvas === canvas;
  const b = window.SMScanLive._internals.grabFrame(video, canvas, 640);
  const out = {
    size: a && [a.width, a.height],
    source: a && [a.sourceWidth, a.sourceHeight],
    sameCanvas: sameCanvas && b.canvas === canvas,
  };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('取樣縮到指定寬度並維持比例', grab.size && grab.size[0] === 640 && grab.size[1] === 480,
  JSON.stringify(grab.size));
check('取樣記得原始解析度（快門要用）', grab.source && grab.source[0] === 800, JSON.stringify(grab.source));
// 一秒三次的迴圈每次都 new 一塊畫布，GC 會一直有事做
check('取樣重複使用同一塊畫布', grab.sameCanvas === true, '每次都換新畫布');

// ── 穩定度 ────────────────────────────────────────────────
const motion = await page.evaluate(() => {
  const { cornerMotion } = window.SMScanLive._internals;
  const a = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
  const nudged = a.map((p) => ({ x: p.x + 0.01, y: p.y }));
  const oneCorner = a.map((p, i) => (i === 0 ? { x: p.x, y: p.y + 0.04 } : p));
  return {
    none: cornerMotion(null, a),
    same: cornerMotion(a, a),
    nudged: cornerMotion(a, nudged),
    oneCorner: cornerMotion(a, oneCorner),
  };
});
// 「還不知道」跟「完全沒動」是兩件事 —— 回 0 的話第一次偵測就會被算成一次穩定
check('第一次偵測的位移是「還不知道」而不是 0', motion.none === null, JSON.stringify(motion.none));
check('完全沒動時位移是 0', motion.same === 0, JSON.stringify(motion.same));
check('整體平移多少，位移就是多少', Math.abs(motion.nudged - 0.01) < 1e-9, JSON.stringify(motion.nudged));
// 只有一個角在飄的框一樣不該算穩 —— 平均之後仍要看得到那個位移
check('只有一個角在動也算得出來', Math.abs(motion.oneCorner - 0.01) < 1e-9, JSON.stringify(motion.oneCorner));

// ── 自動快門 ──────────────────────────────────────────────
/**
 * 靜止的假相機 → 應該自己按下快門。
 *
 * 順便驗「拍完就解除」：一次取景只能自動拍一張，否則使用者還沒反應過來
 * 就已經連拍了五張同樣的紙。
 */
const auto = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const shots = [];
  const results = [];
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 150, auto: true, steadyHits: 3,
    onResult: (r) => results.push({ motion: r.motion, steady: r.steady, stable: r.stable, auto: r.auto }),
    onAuto: (shot) => shots.push({ at: Date.now(), corners: shot.corners, auto: shot.auto, size: shot.file.size }),
  });
  // 等它自己拍，不是等一個固定的秒數 —— 機器忙的時候一次偵測可能久到
  // 2.5 秒內湊不滿 4 次，那樣紅的是 CI 的負載不是這個功能
  const deadline = Date.now() + 8000;
  while (!shots.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 900));   // 再看一下會不會連拍第二張
  const out = {
    count: shots.length,
    first: shots[0] || null,
    stillArmed: session.auto,
    detections: results.length,
    firstMotion: results[0] ? results[0].motion : 'missing',
    hitAt: results.findIndex((r) => r.stable) + 1,
    errors: session.errors,
  };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('框穩住之後自動拍了一張', auto.count === 1, `拍了 ${auto.count} 張`);
check('自動拍的那張帶著框，也標明是自動拍的',
  auto.first && auto.first.auto === true && cornerError(auto.first.corners) < 0.03 && auto.first.size > 1000,
  JSON.stringify({ auto: auto.first?.auto, err: cornerError(auto.first?.corners).toFixed(4) }));
// 第一次偵測沒有「上一次」可以比，不能白送一次穩定
check('第一次偵測不算一次「沒動」', auto.firstMotion === null, JSON.stringify(auto.firstMotion));
check('要連續 3 次沒動才拍（不是一偵測到就拍）', auto.hitAt >= 4, `第 ${auto.hitAt} 次就滿了`);
check('拍完就解除，不會連拍', auto.stillArmed === false && auto.count === 1,
  JSON.stringify({ auto: auto.stillArmed, count: auto.count }));
check('自動快門過程中沒有偵測失敗', auto.errors === 0, `errors=${auto.errors}`);

/**
 * 一直在動的畫面 → 不該拍。
 *
 * 紙的位置是**跟著偵測走**的，不是掛在 setInterval 上：偵測是同步的、會把
 * UI 執行緒整段吃掉，計時器在那段時間根本不會跑，用時間驅動的話兩次偵測之間
 * 實際只移動了幾個像素（第一版就是這樣，位移只有一半超過門檻，最後還是自動拍了）。
 * 每偵測完一次就把紙挪到另一個定點（32px ≈ 畫面的 4%），
 * 每一次偵測都確實走了門檻 1.2% 的三倍以上。門檻用預設值 —— 這條測的正是預設值擋不擋得住。
 */
const moving = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const shots = [];
  const seen = [];
  let n = 0;
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 250, auto: true, steadyHits: 3,
    onResult: (r) => {
      seen.push({ motion: r.motion, steady: r.steady, low: r.low });
      n += 1;
      cam.move(window.PAPER.map((p) => ({ x: p.x + (n % 2 ? 32 : 0), y: p.y })));
    },
    onAuto: (shot) => shots.push(shot),
  });
  await new Promise((r) => setTimeout(r, 3000));
  const out = {
    count: shots.length,
    detections: seen.length,
    maxSteady: seen.reduce((m, r) => Math.max(m, r.steady), 0),
    moved: seen.filter((r) => r.motion != null && r.motion > window.SMScanLive.STEADY_MOVE).length,
    measured: seen.filter((r) => r.motion != null).length,
    stillArmed: session.auto,
  };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('畫面一直在動就不會自動拍', moving.count === 0, `還是拍了 ${moving.count} 張`);
// 容許一次沒動到：假相機的重畫要等 captureStream 取樣，機器忙的時候
// 偶爾會有一幀還沒換過來。連續兩次沒動就會累出穩定計數，下一條就會抓到
check('（對照）測資真的在動，位移確實超過門檻',
  moving.measured >= 5 && moving.moved >= moving.measured - 1,
  JSON.stringify({ moved: moving.moved, measured: moving.measured }));
check('動的期間穩定計數被歸零，累不到門檻',
  moving.maxSteady < 3 && moving.stillArmed === true, `最高累到 ${moving.maxSteady}`);

/** 沒開自動快門就完全不該碰快門，即使畫面一動也不動 */
const manual = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const shots = [];
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 150, steadyHits: 2, onAuto: (s) => shots.push(s),
  });
  const settle = Date.now() + 5000;
  while (session.steady < 3 && Date.now() < settle) await new Promise((r) => setTimeout(r, 50));
  const offCount = shots.length;
  const steadyWhileOff = session.steady;
  // 中途打開 → 從頭數起，然後才拍
  session.setAuto(true);
  const steadyAfterArm = session.steady;
  const deadline = Date.now() + 8000;
  while (!shots.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const onCount = shots.length;
  const out = { offCount, onCount, steadyWhileOff, steadyAfterArm };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('沒開自動快門就不會自己拍', manual.offCount === 0, `拍了 ${manual.offCount} 張`);
// 穩定度一直在算（介面要顯示），只是沒人按快門
check('關著的時候穩定度照樣在算', manual.steadyWhileOff > 0, `steady=${manual.steadyWhileOff}`);
check('中途打開時計數歸零，不沿用剛剛那幾次', manual.steadyAfterArm === 0, `steady=${manual.steadyAfterArm}`);
check('打開之後就會自動拍', manual.onCount === 1, `拍了 ${manual.onCount} 張`);

/** 抓不準的框不該自動拍 —— 連續三次抓錯同一個東西也是「很穩」 */
const lowConf = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: null });   // 只有桌面，沒有紙
  const video = window.newVideo();
  const shots = [];
  const seen = [];
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 150, auto: true, steadyHits: 3,
    onResult: (r) => seen.push({ low: r.low, motion: r.motion, steady: r.steady }),
    onAuto: (s) => shots.push(s),
  });
  await new Promise((r) => setTimeout(r, 3000));
  const out = {
    count: shots.length,
    detections: seen.length,
    lows: seen.filter((r) => r.low).length,
    maxSteady: seen.reduce((m, r) => Math.max(m, r.steady), 0),
    stillMotion: seen.filter((r) => r.motion != null && r.motion <= 0.001).length,
  };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('抓不準的時候不自動拍，即使框完全沒動',
  lowConf.count === 0 && lowConf.lows === lowConf.detections && lowConf.detections >= 3,
  JSON.stringify({ count: lowConf.count, lows: lowConf.lows, n: lowConf.detections }));
check('（對照）這個場景的框確實是穩的，擋下來的是信心不是位移',
  lowConf.stillMotion >= 2 && lowConf.maxSteady === 0,
  JSON.stringify({ still: lowConf.stillMotion, maxSteady: lowConf.maxSteady }));

/**
 * **拍到一半被收掉**：使用者按了取消、或元件卸載，這時自動快門的 `capture()`
 * 可能還在等 `toBlob`。照片不能在那之後還冒出來 —— 取景畫面早就不在了，
 * 那張照片會直接掉進一個沒人接的地方，是最難查的那種 bug。
 *
 * 時機不能靠猜：把 `toBlob` 延後 400ms 回呼，讓「拍攝中」這個狀態長到能穩定命中，
 * 再在 steady 剛滿的當下 stop()。
 */
const afterStop = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const shots = [];
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) {
    realToBlob.call(this, (b) => setTimeout(() => cb(b), 400), ...rest);
  };
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 100, auto: true, steadyHits: 3, onAuto: (s) => shots.push(s),
  });
  // 等到自動快門真的被觸發（steady 滿了、auto 跟著解除）再收掉
  const deadline = Date.now() + 4000;
  while (session.auto && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  const triggered = !session.auto;
  const atStop = shots.length;
  session.stop();
  await new Promise((r) => setTimeout(r, 1200));
  HTMLCanvasElement.prototype.toBlob = realToBlob;
  const out = { triggered, atStop, after: shots.length, auto: session.auto };
  cam.close();
  video.remove();
  return out;
});
check('（前提）自動快門確實被觸發了，測的是拍到一半被收掉',
  afterStop.triggered === true && afterStop.atStop === 0, JSON.stringify(afterStop));
check('拍到一半被收掉，照片不會事後才冒出來', afterStop.after === 0, JSON.stringify(afterStop));
check('停掉的同時解除自動快門', afterStop.auto === false, JSON.stringify(afterStop.auto));

/** 拍不出來（例如畫布輸出失敗）要退回手動，不能整個取景卡死在「正在拍」 */
const autoFail = await page.evaluate(async () => {
  const cam = window.fakeCamera({ corners: window.PAPER });
  const video = window.newVideo();
  const errs = [];
  const shots = [];
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
  const session = await window.SMScanLive.start(video, {
    stream: cam.stream, interval: 150, auto: true, steadyHits: 3,
    onAuto: (s) => shots.push(s), onError: (e) => errs.push(e.message),
  });
  await new Promise((r) => setTimeout(r, 2000));
  HTMLCanvasElement.prototype.toBlob = realToBlob;
  // 退回手動：按鈕還按得動
  let manualOk = false;
  try {
    const shot = await session.capture();
    manualOk = shot.file.size > 1000;
  } catch (e) { manualOk = false; }
  const out = { errs: errs.length, first: errs[0] || null, shots: shots.length, manualOk, running: session.running };
  session.stop();
  cam.close();
  video.remove();
  return out;
});
check('自動快門失敗時報一次錯，不會靜靜地什麼都沒發生',
  autoFail.errs === 1 && autoFail.shots === 0, JSON.stringify(autoFail));
check('自動快門失敗之後取景還活著，手動快門照樣拍得出來',
  autoFail.running === true && autoFail.manualOk === true, JSON.stringify(autoFail));

check('過程中沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
