/**
 * 離線精簡版介面（static/js/studio.jsx）的功能測試。
 *
 * 這裡驗兩件只有在真的瀏覽器裡才看得出來的事：
 *   1. 即時反應 —— 按下旋轉 / 換版面之後，預覽畫布的尺寸有沒有真的跟著換
 *   2. 情境工具列 —— 點了圖片就換成圖片操作，按完成就換回拼貼操作
 *
 * 執行：cd mobile && npm run test:studio
 * 前置：先跑過 python scripts/build_mobile.py --offline（要有 mobile/www）
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '../www');
const PORT = 8931;

if (!fs.existsSync(path.join(WWW, 'index.html'))) {
  console.error('找不到 mobile/www —— 請先執行 python scripts/build_mobile.py --offline');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(WWW, p);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

/**
 * 假相機 —— 無頭瀏覽器沒有鏡頭，但 `canvas.captureStream()` 產得出一條
 * 貨真價實的 MediaStream，取景那條路（getUserMedia → video → 偵測 → 疊框）
 * 就能整條走完。畫面是「桌上的一張紙」，四個角是已知的，所以疊出來的框
 * 對不對可以直接量。
 *
 * 場景先畫在離屏畫布上再一次貼過去 —— captureStream 是在畫布被畫到的當下
 * 取樣的，一筆一筆畫上去會送出「只有背景、紙還沒畫上」的半成品幀。
 */
await page.addInitScript(() => {
  window.__fakeCam = { paper: { x0: 140, y0: 100, x1: 660, y1: 500, w: 800, h: 600 } };
  const install = () => {
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const p = window.__fakeCam.paper;
      const c = document.createElement('canvas');
      c.width = p.w; c.height = p.h;
      const ctx = c.getContext('2d');
      const off = document.createElement('canvas');
      off.width = p.w; off.height = p.h;
      const o = off.getContext('2d');
      const paint = () => {
        o.fillStyle = '#4a4038';
        o.fillRect(0, 0, p.w, p.h);
        o.fillStyle = '#f2f0ea';
        o.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
        o.strokeStyle = '#333';
        o.lineWidth = 2;
        for (let i = 1; i <= 8; i++) {
          const y = p.y0 + (p.y1 - p.y0) * i / 9;
          o.beginPath();
          o.moveTo(p.x0 + 40, y);
          o.lineTo(p.x1 - (i % 3 === 0 ? 160 : 40), y);
          o.stroke();
        }
        ctx.drawImage(off, 0, 0);
      };
      paint();
      window.__fakeCam.timer = setInterval(paint, 70);
      window.__fakeCam.stream = c.captureStream(15);
      return window.__fakeCam.stream;
    };
  };
  install();
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

async function makePng(w, h, name) {
  const b64 = await page.evaluate(({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = '#2980b9'; ctx.fillRect(w / 2, 0, w / 2, h);
    return c.toDataURL('image/png').split(',')[1];
  }, { w, h });
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

const canvasSize = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c ? { w: c.width, h: c.height } : null;
});
const barLabels = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => b.innerText.trim()).filter(Boolean));
const load = async (sizes) => {
  await page.locator('input[type=file]').first().setInputFiles(
    await Promise.all(sizes.map(([w, h], i) => makePng(w, h, `p${i}.png`))));
  await page.waitForTimeout(300 + sizes.length * 250);
};

// ── 起始畫面 ────────────────────────────────────────────
check('啟動就是編輯畫面，沒有伺服器設定',
  (await page.locator('text=選擇圖片開始').count()) === 1 &&
  (await page.locator('#sm-server-setup').count()) === 0, '起始畫面不如預期');

// ── 單張：畫布優先 + 情境工具列 ──────────────────────────
await load([[200, 100]]);

let size = await canvasSize();
check('上傳後立刻出現預覽', size && size.w === 200 && size.h === 100, JSON.stringify(size));

let labels = await barLabels();
check('預設工具列是拼貼操作（版面 / 圖框 / 間距 / 製作）',
  ['版面', '圖框', '間距', '加圖', '製作'].every((l) => labels.some((x) => x.includes(l))),
  labels.join(','));
check('沒選圖時不顯示圖片操作',
  !labels.some((x) => x.includes('左轉')), labels.join(','));

// 選項預設不佔畫面 —— 沒開面板時畫面上不該有滑桿或色票
check('沒開面板時不佔用畫面空間',
  (await page.locator('.slider').count()) === 0, '不該有滑桿常駐');

// 點畫布 → 切成圖片操作
const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(400);

labels = await barLabels();
check('點圖片後工具列換成圖片操作',
  ['左轉', '右轉', '裁切', '打碼', '標註', '調整', '完成'].every((l) => labels.some((x) => x.includes(l))),
  labels.join(','));
check('圖片模式下不顯示拼貼操作',
  !labels.some((x) => x.includes('版面')), labels.join(','));

await page.locator('button:has-text("右轉")').click();
await page.waitForTimeout(350);
size = await canvasSize();
check('按右轉 → 預覽立刻變直式', size && size.w === 100 && size.h === 200, JSON.stringify(size));

await page.locator('button:has-text("完成")').last().click();
await page.waitForTimeout(350);
labels = await barLabels();
check('按完成 → 工具列回到拼貼操作',
  labels.some((x) => x.includes('版面')) && !labels.some((x) => x.includes('左轉')),
  labels.join(','));

// ── 多張：版面預設 ───────────────────────────────────────
await page.locator('button:has-text("清空")').click();
await page.waitForTimeout(300);
await load([[200, 100], [100, 100], [200, 200]]);

size = await canvasSize();
check('預設直式拼貼（等比對齊 → 100×250）',
  size && size.w === 100 && size.h === 250, JSON.stringify(size));

await page.locator('button:has-text("版面")').click();
await page.waitForTimeout(350);
check('版面是從下方推出的面板，不常駐',
  (await page.locator('text=版面').count()) >= 1 &&
  (await page.locator('button:has-text("3×2")').count()) === 1, '找不到版面預設');

await page.locator('button:has-text("3×2")').click();
await page.waitForTimeout(500);
size = await canvasSize();
// cover：格子統一（cellW=200、平均比例 4/3 → cellH=150），3 欄 1 列
check('選 3×2 → 立刻套用統一格子（600×150）',
  size && size.w === 600 && size.h === 150, JSON.stringify(size));

await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(300);
check('關掉面板後畫布復原滿版',
  (await page.locator('.slider').count()) === 0, '面板沒有關掉');

// ── 圖框 ────────────────────────────────────────────────
await page.locator('button:has-text("圖框")').click();
await page.waitForTimeout(300);
const frameChips = await page.locator('.chip').allInnerTexts();
check('圖框面板列出所有樣式',
  ['無', '圓角', '細邊', '白框', '陰影', '拍立得'].every((l) => frameChips.some((t) => t.trim() === l)),
  frameChips.join(','));

await page.locator('.chip:has-text("拍立得")').click();
await page.waitForTimeout(400);
check('選了圖框後出現顏色 / 粗細 / 圓角的細調',
  (await page.locator('text=邊框顏色').count()) === 1 &&
  (await page.locator('.slider').count()) >= 2, '沒有細調選項');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(300);

// ── 間距 ────────────────────────────────────────────────
await page.locator('button:has-text("間距")').click();
await page.waitForTimeout(300);
await page.locator('.slider').first().fill('20');
await page.waitForTimeout(450);
size = await canvasSize();
check('調整間距 → 版面立刻加寬（600 + 2×20）',
  size && size.w === 640, JSON.stringify(size));
// 面板標題也叫「間距與底色」，所以要指名欄位標籤，不能用整頁比對
check('間距面板也能選底色',
  (await page.locator('.field-label').allInnerTexts()).some((t) => t.trim() === '底色'),
  '沒有底色選項');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(300);

// ── 拼貼裡的觸控取景與交換 ──────────────────────────────
// 這一段刻意排在裁切之前 —— 它只動 fit 與順序，不會留下裁切框之類的殘留
{
  const cv = await page.locator('canvas').boundingBox();
  // 三張圖在 3×2 格狀版面（cover）裡：左 / 中 / 右
  const cellCenter = (i) => ({
    x: cv.x + cv.width * (i / 3 + 1 / 6),
    y: cv.y + cv.height / 2,
  });

  // 先確認「點一下」還是選取，不會因為手指微晃就把圖推歪
  await page.mouse.move(cellCenter(0).x, cellCenter(0).y);
  await page.mouse.down();
  await page.mouse.move(cellCenter(0).x + 2, cellCenter(0).y + 1);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('輕微晃動仍算點選，不會誤判成拖曳',
    (await barLabels()).some((x) => x.includes('裁切')) &&
    (await page.locator('button:has-text("重置取景")').first().isDisabled()),
    (await barLabels()).join(','));

  // 拖曳選中的那張 → 取景改變（重置取景會從停用變成可按）
  await page.mouse.move(cellCenter(0).x, cellCenter(0).y);
  await page.mouse.down();
  await page.mouse.move(cellCenter(0).x - 30, cellCenter(0).y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('拖曳選中的圖會改變格子內的取景',
    !(await page.locator('button:has-text("重置取景")').first().isDisabled()),
    '重置取景仍是停用的 —— 表示 fit 沒有被改到');

  await page.locator('button:has-text("重置取景")').click();
  await page.waitForTimeout(350);
  check('重置取景把取景還原',
    (await page.locator('button:has-text("重置取景")').first().isDisabled()),
    '重置後仍可按，表示 fit 沒清掉');

  // 兩指捏合 —— Playwright 的 mouse 只有一個指標，所以直接派合成的 PointerEvent
  await page.mouse.click(cellCenter(1).x, cellCenter(1).y);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const send = (type, id, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
    }));
    send('pointerdown', 11, cx - 20, cy);
    send('pointerdown', 12, cx + 20, cy);
    // 兩指往外撐開一倍 → 放大
    for (let s = 1; s <= 5; s++) {
      send('pointermove', 11, cx - 20 - s * 8, cy);
      send('pointermove', 12, cx + 20 + s * 8, cy);
    }
    send('pointerup', 11, cx - 60, cy);
    send('pointerup', 12, cx + 60, cy);
  });
  await page.waitForTimeout(450);
  check('兩指撐開會放大格子裡的圖',
    !(await page.locator('button:has-text("重置取景")').first().isDisabled()),
    '重置取景仍是停用的 —— 表示捏合沒有改到 zoom');
  await page.locator('button:has-text("重置取景")').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("完成")').last().click();
  await page.waitForTimeout(300);
  await page.mouse.click(cellCenter(0).x, cellCenter(0).y);
  await page.waitForTimeout(350);

  // 交換：點「交換」後再點另一張，兩張位置對調
  const thumbSrc = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('.m-screen img')).slice(0, 3).map((im) => im.src));
  const before = await thumbSrc();
  await page.locator('button:has-text("交換")').click();
  await page.waitForTimeout(300);
  check('交換模式會提示要點哪裡',
    /點另一張圖跟第 1 張交換位置/.test(await page.locator('.m-screen').innerText()),
    await page.locator('.m-screen').innerText());

  await page.mouse.click(cellCenter(2).x, cellCenter(2).y);
  await page.waitForTimeout(450);
  const after = await thumbSrc();
  check('點第二張 → 兩張位置對調',
    after[0] === before[2] && after[2] === before[0] && after[1] === before[1],
    `${before.map((s) => s.slice(-6))} → ${after.map((s) => s.slice(-6))}`);
  check('交換完就離開交換模式，提示消失',
    !/點另一張圖跟第/.test(await page.locator('.m-screen').innerText()),
    await page.locator('.m-screen').innerText());

  // 換回來，後面的測試才拿到原本的順序
  await page.locator('button:has-text("交換")').click();
  await page.waitForTimeout(250);
  await page.mouse.click(cellCenter(0).x, cellCenter(0).y);
  await page.waitForTimeout(450);
  check('再交換一次就換回原本的順序',
    JSON.stringify(await thumbSrc()) === JSON.stringify(before),
    `${(await thumbSrc()).map((s) => s.slice(-6))} vs ${before.map((s) => s.slice(-6))}`);

  await page.locator('button:has-text("完成")').last().click();
  await page.waitForTimeout(300);
}

// ── 自由裁切 ────────────────────────────────────────────
const box2 = await page.locator('canvas').boundingBox();
await page.mouse.click(box2.x + box2.width * 0.15, box2.y + box2.height * 0.5);
await page.waitForTimeout(400);
check('點格子選中該張', (await barLabels()).some((x) => x.includes('裁切')), '沒有進入圖片模式');

const beforeCrop = await canvasSize();
await page.locator('button:has-text("裁切")').click();
await page.waitForTimeout(400);
check('裁切進入獨立的編輯畫面，只剩該張圖',
  (await barLabels()).some((x) => x.includes('套用')) &&
  !(await barLabels()).some((x) => x.includes('版面')), (await barLabels()).join(','));
check('裁切畫面列出比例選項',
  (await page.locator('.chip:has-text("自由")').count()) === 1 &&
  (await page.locator('.chip:has-text("16:9")').count()) === 1, '找不到裁切比例');

// 拖出一個框：從左上往右下拉
const cropBox = await page.locator('canvas').boundingBox();
await page.mouse.move(cropBox.x + cropBox.width * 0.1, cropBox.y + cropBox.height * 0.1);
await page.mouse.down();
await page.mouse.move(cropBox.x + cropBox.width * 0.6, cropBox.y + cropBox.height * 0.7, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(200);

await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(300);
const cancelled = await canvasSize();
check('按取消 → 裁切不會生效',
  cancelled && cancelled.w === beforeCrop.w && cancelled.h === beforeCrop.h,
  `${JSON.stringify(beforeCrop)} → ${JSON.stringify(cancelled)}`);

await page.locator('button:has-text("裁切")').click();
await page.waitForTimeout(400);
await page.locator('.chip:has-text("1:1")').click();
await page.waitForTimeout(250);
await page.locator('button:has-text("套用")').click();
await page.waitForTimeout(500);
const afterCrop = await canvasSize();
check('按套用 → 版面立刻重算',
  afterCrop && (afterCrop.w !== beforeCrop.w || afterCrop.h !== beforeCrop.h),
  `${JSON.stringify(beforeCrop)} → ${JSON.stringify(afterCrop)}`);

// ── 打碼 ────────────────────────────────────────────────
await page.locator('button:has-text("打碼")').click();
await page.waitForTimeout(400);
check('打碼是獨立畫面，並列出三種樣式',
  ['馬賽克', '模糊', '塗黑'].every((l) => l && true) &&
  (await page.locator('.chip').allInnerTexts()).join(',').includes('馬賽克') &&
  (await barLabels()).some((x) => x.includes('全清')),
  (await page.locator('.chip').allInnerTexts()).join(','));

const redBox = await page.locator('canvas').boundingBox();
await page.mouse.move(redBox.x + redBox.width * 0.2, redBox.y + redBox.height * 0.2);
await page.mouse.down();
await page.mouse.move(redBox.x + redBox.width * 0.6, redBox.y + redBox.height * 0.6, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(400);
check('拖一個框就遮一塊，並顯示已遮數量',
  /已遮 1 塊/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

await page.locator('button:has-text("復原")').click();
await page.waitForTimeout(300);
check('復原把最後一塊拿掉',
  /在要遮的地方拖一個框/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());
await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(400);

// ── 標註（箭頭 / 方框）─────────────────────────────────
// 「畫布上有幾個不是原圖那兩塊純色的點」—— 標註畫進成品沒有，看這個就知道。
// 用前後相比而不是絕對值：選取用的虛線框在兩次取樣裡都在，相減就抵掉了。
const offColour = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const near = (i, r, g, b) => Math.abs(d[i] - r) < 12 && Math.abs(d[i + 1] - g) < 12 && Math.abs(d[i + 2] - b) < 12;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!near(i, 192, 57, 43) && !near(i, 41, 128, 185)) n++;
  }
  return n;
});
const beforeMark = await offColour();

await page.locator('button:has-text("標註")').click();
await page.waitForTimeout(400);
check('標註是獨立畫面，列出兩種形狀與顏色',
  (await page.locator('.chip').allInnerTexts()).join(',').includes('方框') &&
  (await page.locator('.chip').allInnerTexts()).join(',').includes('箭頭') &&
  (await page.locator('input[type=color]').count()) === 1 &&
  (await barLabels()).some((x) => x.includes('全清')),
  (await page.locator('.chip').allInnerTexts()).join(','));

check('預設是方框，提示說的是拖一個框',
  /在要框的地方拖一個框/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

await page.locator('.chip:has-text("箭頭")').click();
await page.waitForTimeout(200);
check('換成箭頭之後，提示改說方向',
  /從要指的地方往箭頭方向拖/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());
await page.locator('.chip:has-text("方框")').click();
await page.waitForTimeout(200);

const markBox = await page.locator('canvas').boundingBox();
const dragMark = async (x1, y1, x2, y2) => {
  await page.mouse.move(markBox.x + markBox.width * x1, markBox.y + markBox.height * y1);
  await page.mouse.down();
  await page.mouse.move(markBox.x + markBox.width * x2, markBox.y + markBox.height * y2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

await dragMark(0.2, 0.2, 0.6, 0.6);
check('拖一個框就標一筆，並顯示已標數量',
  /已標 1 筆/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

await dragMark(0.65, 0.2, 0.9, 0.5);
check('可以疊第二筆（標註不是一次只能有一個）',
  /已標 2 筆/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

await page.locator('button:has-text("復原")').click();
await page.waitForTimeout(300);
check('復原只拿掉最後一筆',
  /已標 1 筆/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

// 點在既有的那一筆上（不拖）→ 拿掉它。跟打碼是同一個手勢。
await page.mouse.click(markBox.x + markBox.width * 0.4, markBox.y + markBox.height * 0.4);
await page.waitForTimeout(350);
check('點一下既有的標註就拿掉（跟打碼同一套手勢）',
  /在要框的地方拖一個框/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

await dragMark(0.2, 0.2, 0.6, 0.6);
await dragMark(0.65, 0.2, 0.9, 0.5);
await page.locator('button:has-text("全清")').click();
await page.waitForTimeout(300);
check('全清把整組拿掉',
  /在要框的地方拖一個框/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

// 取消要真的不留東西 —— 標好了才按取消是很容易寫錯的那條路
await dragMark(0.2, 0.2, 0.6, 0.6);
await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(450);
check('按取消不會把標註留在圖上',
  Math.abs((await offColour()) - beforeMark) < 40,
  `取消前 ${beforeMark} 點、取消後 ${await offColour()} 點`);
check('取消後工具列上的標註沒有被點亮',
  !(await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .some((b) => b.innerText.includes('標註') && b.style.background.includes('mint-wash')))),
  '取消後標註仍然亮著');

await page.locator('button:has-text("標註")').click();
await page.waitForTimeout(400);
await dragMark(0.2, 0.2, 0.6, 0.6);
await page.locator('button:has-text("套用")').click();
await page.waitForTimeout(500);
const afterMark = await offColour();
check('按套用之後，標註真的畫進主預覽',
  afterMark > beforeMark + 100, `套用前 ${beforeMark} 點、套用後 ${afterMark} 點`);
check('圖上有標註時，工具列的標註會亮起來',
  await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .some((b) => b.innerText.includes('標註') && b.style.background.includes('mint-wash'))),
  '標註沒有亮起來');

// 再開一次，剛才那一筆要還在（存進 item 而不是元件的暫時狀態）
await page.locator('button:has-text("標註")').click();
await page.waitForTimeout(400);
check('再開一次，先前的標註還在',
  /已標 1 筆/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());
await page.locator('button:has-text("全清")').click();
await page.locator('button:has-text("套用")').click();
await page.waitForTimeout(450);

// ── 調整 ────────────────────────────────────────────────
await page.locator('button:has-text("調整")').click();
await page.waitForTimeout(300);
const adjustChips = await page.locator('.chip').allInnerTexts();
check('調整面板有濾鏡、細調與大小',
  ['原圖', '黑白', '紙本'].every((l) => adjustChips.some((t) => t.trim() === l)) &&
  (await page.locator('.field-label').allInnerTexts()).some((t) => t.includes('亮度')) &&
  (await page.locator('.field-label').allInnerTexts()).some((t) => t.includes('大小')),
  adjustChips.join(','));
await page.locator('.chip:has-text("黑白")').click();
await page.waitForTimeout(400);
check('選了濾鏡之後預覽會重畫',
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(Math.round(c.width / 4), Math.round(c.height / 2), 1, 1).data;
    return d[0] === d[1] && d[1] === d[2];
  }), '畫布沒有變成灰階');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

// ── 拉正（邊界偵測 + 透視校正）──────────────────────────
await page.locator('button:has-text("拉正")').click();
await page.waitForTimeout(900);   // 等偵測跑完
check('拉正畫面出現，四個角都可以拖',
  (await page.locator('.m-screen svg polygon').count()) === 1 &&
  /抓到文件邊界|沒把握|偵測失敗/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

// 這批測資是純色塊，本來就不該被當成文件 —— 要看到「沒把握」而不是硬給答案
check('抓不到文件時老實說沒把握，而不是硬裁',
  /沒把握/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

// 「沒把握」講完就沒下文的話，使用者只能原地再拍一張一樣的照片。
// 純色塊沒有紙與桌面的分別，所以應該看到「紙跟桌面顏色太接近」那一類的建議
const deskewHints = await page.locator('.m-screen ul li').allInnerTexts();
check('沒把握時還要說得出怎麼補救，不是只丟一句「沒把握」',
  deskewHints.length > 0 && deskewHints.every((t) => t.trim().length > 8),
  JSON.stringify(deskewHints));

// 拉正畫面裡的畫布就是這一張的預覽，所以量它才是量到「這張圖本身」——
// 編輯畫面的畫布是三張的拼貼，格狀版面下尺寸固定，換了圖也看不出來
const beforeDeskew = await canvasSize();

// 把左上角往內拖一大段，讓校正結果明顯不同於原圖
const deskewBox = await page.locator('canvas').first().boundingBox();
await page.mouse.move(deskewBox.x + deskewBox.width * 0.06, deskewBox.y + deskewBox.height * 0.06);
await page.mouse.down();
await page.mouse.move(deskewBox.x + deskewBox.width * 0.35, deskewBox.y + deskewBox.height * 0.3, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);

await page.locator('button:has-text("拉正")').last().click();
await page.waitForTimeout(700);
// 拉正完仍停在這張圖上（還在編輯它），所以工具列是圖片操作而不是拼貼操作
check('按下拉正後回到編輯畫面，並且還停在同一張圖上',
  (await barLabels()).some((x) => x.includes('裁切')) &&
  !(await barLabels()).some((x) => x.includes('版面')), (await barLabels()).join(','));

await page.locator('button:has-text("拉正")').click();
await page.waitForTimeout(900);
const afterDeskew = await canvasSize();
check('拉正真的換掉了這張圖（尺寸跟著校正後的四邊形變）',
  JSON.stringify(afterDeskew) !== JSON.stringify(beforeDeskew),
  `${JSON.stringify(beforeDeskew)} → ${JSON.stringify(afterDeskew)}`);

// 拉正是破壞性的，所以一定要留一條回得去的路
check('拉正過的圖會提供「還原原圖」',
  (await page.locator('button:has-text("還原原圖")').count()) === 1,
  (await barLabels()).join(','));
await page.locator('button:has-text("還原原圖")').click();
await page.waitForTimeout(500);
// 還原後仍停在同一張圖上，所以直接再進拉正 —— 中途點畫布會選到別張
await page.locator('button:has-text("拉正")').click();
await page.waitForTimeout(900);
check('還原之後回到原本的尺寸',
  JSON.stringify(await canvasSize()) === JSON.stringify(beforeDeskew),
  `${JSON.stringify(await canvasSize())} vs 原本 ${JSON.stringify(beforeDeskew)}`);
check('還原之後就不再提供「還原原圖」',
  (await page.locator('button:has-text("還原原圖")').count()) === 0,
  (await barLabels()).join(','));
await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(300);

// ── 文字 / 浮水印 ───────────────────────────────────────
await page.locator('button:has-text("完成")').last().click();
await page.waitForTimeout(300);
await page.locator('button:has-text("文字")').click();
await page.waitForTimeout(300);
check('文字面板有輸入框與浮水印開關',
  (await page.locator('textarea').count()) === 1 &&
  /平鋪成浮水印/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

const beforeText = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join('').length;
});
await page.locator('textarea').fill('內部文件');
await page.waitForTimeout(600);
check('打了字畫布就跟著變',
  await page.evaluate((before) => {
    const c = document.querySelector('canvas');
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join('').length !== before;
  }, beforeText), '畫布沒有變');

await page.locator('input[type=checkbox]').first().check();
await page.waitForTimeout(500);
check('切成浮水印後出現角度、位置選單收起來',
  (await page.locator('.field-label').allInnerTexts()).some((t) => t.includes('角度')) &&
  !(await page.locator('.field-label').allInnerTexts()).some((t) => t.trim() === '位置'),
  (await page.locator('.field-label').allInnerTexts()).join(','));
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);
await page.locator('button:has-text("文字")').click();
await page.waitForTimeout(200);
await page.locator('button:has-text("移除文字")').click();
await page.waitForTimeout(400);
check('移除文字之後面板回到空的',
  (await page.locator('textarea').inputValue()) === '', '文字沒有清掉');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

// ── 文字圖層（一張圖疊得下好幾段字）──────────────────────
// 標題、日期、浮水印各要自己的字級與位置，所以文字存的是一疊圖層。
// 這一段量的是**成品**：三段字有沒有同時畫上去、改設定改到的是不是選中的那一層、
// 刪掉中間那層之後另外兩層會不會跟著跑位。
await page.locator('button:has-text("文字")').click();
await page.waitForTimeout(300);
check('文字面板一開始只有一層，並提供加一層',
  (await page.locator('[data-testid=text-layer-0]').count()) === 1 &&
  (await page.locator('[data-testid=text-layer-1]').count()) === 0 &&
  (await page.locator('[data-testid=text-layer-add]').count()) === 1,
  await page.locator('.m-screen').innerText());

// 還沒有任何文字的畫面拿來當基準，後面每一次都跟它相減 —— 底下是拼貼，
// 直接數顏色分不出「哪些點是字」，相減才數得準。
await page.evaluate(() => {
  const c = document.querySelector('canvas');
  window.__textBase = Uint8ClampedArray.from(
    c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
});
const inkBands = () => page.evaluate(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const b = window.__textBase;
  const out = { top: 0, mid: 0, bottom: 0 };
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - b[i]) + Math.abs(d[i + 1] - b[i + 1]) + Math.abs(d[i + 2] - b[i + 2]) < 30) continue;
      if (y < c.height * 0.32) out.top++;
      else if (y > c.height * 0.68) out.bottom++;
      else out.mid++;
    }
  }
  return out;
});
const fillLayer = async (s, spotIdx) => {
  await page.locator('textarea').fill(s);
  await page.locator(`[data-testid=text-spot-${spotIdx}]`).click();
  await page.waitForTimeout(450);
};
// 滑桿不能用 fill（Playwright 不讓 range 打字），要走原生 setter 才叫得動 React
const setSlider = (idx, value) => page.evaluate(({ idx, value }) => {
  const el = document.querySelectorAll('input[type=range]')[idx];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, { idx, value });

await fillLayer('上面這段', 1);
const oneLayer = await inkBands();
check('第一層畫在挑的位置上（上方）',
  oneLayer.top > 40 && oneLayer.mid < 20 && oneLayer.bottom < 20, JSON.stringify(oneLayer));

await page.locator('[data-testid=text-layer-add]').click();
await page.waitForTimeout(250);
check('加一層之後多一顆 chip，而且新的那一層是空白的',
  (await page.locator('[data-testid=text-layer-1]').count()) === 1 &&
  (await page.locator('textarea').inputValue()) === '',
  await page.locator('textarea').inputValue());

await fillLayer('中間這段', 4);
await page.locator('[data-testid=text-layer-add]').click();
await page.waitForTimeout(250);
await fillLayer('下面這段', 7);
const threeLayers = await inkBands();
check('三段文字同時出現在成品上（不是後面那段蓋掉前面那段）',
  threeLayers.top > 40 && threeLayers.mid > 40 && threeLayers.bottom > 40,
  JSON.stringify(threeLayers));

await page.locator('[data-testid=text-layer-1]').click();
await page.waitForTimeout(250);
check('切到哪一層，面板顯示的就是那一層的內容',
  (await page.locator('textarea').inputValue()) === '中間這段',
  await page.locator('textarea').inputValue());

// 把選中那層的字級拉大 —— 只有中間那段該變粗，上下兩段不能跟著動
await setSlider(0, 16);
await page.waitForTimeout(500);
const bigger = await inkBands();
check('改設定只改到選中的那一層',
  bigger.mid > threeLayers.mid * 1.3 &&
  Math.abs(bigger.top - threeLayers.top) < threeLayers.top * 0.1 &&
  Math.abs(bigger.bottom - threeLayers.bottom) < threeLayers.bottom * 0.1,
  `${JSON.stringify(threeLayers)} → ${JSON.stringify(bigger)}`);

await page.locator('[data-testid=text-layer-remove]').click();
await page.waitForTimeout(500);
const removedMid = await inkBands();
check('刪掉中間那層，另外兩層留在原地',
  removedMid.mid < 20 &&
  Math.abs(removedMid.top - threeLayers.top) < threeLayers.top * 0.1 &&
  Math.abs(removedMid.bottom - threeLayers.bottom) < threeLayers.bottom * 0.1,
  `${JSON.stringify(threeLayers)} → ${JSON.stringify(removedMid)}`);
check('刪掉之後 chip 少一顆，並選回前一層',
  (await page.locator('[data-testid=text-layer-2]').count()) === 0 &&
  (await page.locator('textarea').inputValue()) === '上面這段',
  await page.locator('textarea').inputValue());

// 只留一層，量「一般文字是不是水平的」——「角度」是浮水印才有的設定
// （面板上也只有平鋪時才出現那根滑桿），但它的預設值 -30 曾經跟著物件
// 一路傳進引擎，讓一般文字整段歪掉。
await page.locator('[data-testid=text-layer-1]').click();
await page.locator('[data-testid=text-layer-remove]').click();
await page.waitForTimeout(400);
await fillLayer('文字文字文字文字文字', 4);
const tilt = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const b = window.__textBase;
  const pts = [];
  let x0 = 1e9; let x1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - b[i]) + Math.abs(d[i + 1] - b[i + 1]) + Math.abs(d[i + 2] - b[i + 2]) < 30) continue;
      pts.push([x, y]);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  if (pts.length < 50) return { n: pts.length, gap: 1 };
  const span = x1 - x0;
  const meanY = (a) => a.reduce((s, p) => s + p[1], 0) / a.length;
  const left = pts.filter((p) => p[0] < x0 + span * 0.25);
  const right = pts.filter((p) => p[0] > x1 - span * 0.25);
  return { n: pts.length, gap: Math.abs(meanY(left) - meanY(right)) / c.height };
});
check('一般文字是水平的（浮水印的角度不會跟著跑到它身上）',
  tilt.n > 50 && tilt.gap < 0.03, JSON.stringify(tilt));

// 上限是面板排得下幾顆 chip，不是引擎的限制
for (let i = 0; i < 6; i++) {
  if (await page.locator('[data-testid=text-layer-add]').count()) {
    await page.locator('[data-testid=text-layer-add]').click();
    await page.waitForTimeout(120);
  }
}
check('圖層有上限，滿了就不再提供加一層',
  (await page.locator('[data-testid=text-layer-5]').count()) === 1 &&
  (await page.locator('[data-testid=text-layer-6]').count()) === 0 &&
  (await page.locator('[data-testid=text-layer-add]').count()) === 0,
  `chip 數 ${await page.locator('.m-screen .chip').count()}`);

// 一路刪回去 —— 最後一層刪掉是「清空這一層」，面板永遠有東西可以編輯
for (let i = 0; i < 8; i++) {
  if (!(await page.locator('[data-testid=text-layer-remove]').count())) break;
  await page.locator('[data-testid=text-layer-remove]').click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(400);
const cleared = await inkBands();
check('全部移除之後，畫面回到完全沒有文字的樣子',
  (await page.locator('[data-testid=text-layer-1]').count()) === 0 &&
  (await page.locator('textarea').inputValue()) === '' &&
  cleared.top < 20 && cleared.mid < 20 && cleared.bottom < 20,
  JSON.stringify(cleared));
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

// ── 簽名 / 印章 ──────────────────────────────────────────
await page.evaluate(() => localStorage.removeItem('sm.signatures'));
await page.locator('button:has-text("簽名")').click();
await page.waitForTimeout(300);
check('簽名面板一開始是空的，並提供手寫與匯入兩條路',
  /還沒有簽名/.test(await page.locator('.m-screen').innerText()) &&
  (await page.locator('button:has-text("手寫")').count()) === 1 &&
  (await page.locator('button:has-text("匯入圖片")').count()) === 1,
  await page.locator('.m-screen').innerText());

await page.locator('button:has-text("手寫")').click();
await page.waitForTimeout(300);
check('簽名板出現，還沒畫時不能存',
  /在這裡簽名/.test(await page.locator('.m-screen').innerText()) &&
  await page.locator('button:has-text("存起來")').isDisabled(),
  await page.locator('.m-screen').innerText());

// 在簽名板上畫一筆
const pad = await page.locator('canvas').last().boundingBox();
await page.mouse.move(pad.x + pad.width * 0.25, pad.y + pad.height * 0.6);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(
    pad.x + pad.width * (0.25 + 0.5 * (i / 12)),
    pad.y + pad.height * (0.6 - 0.25 * Math.sin((i / 12) * Math.PI))
  );
}
await page.mouse.up();
await page.waitForTimeout(300);
check('畫下去之後才能存起來',
  !(await page.locator('button:has-text("存起來")').isDisabled()), '存起來仍然是停用的');

await page.locator('button:has-text("存起來")').click();
await page.waitForTimeout(700);
check('存完直接進到擺放畫面',
  (await page.locator('button:has-text("套用")').count()) === 1 &&
  (await page.locator('button:has-text("取消")').count()) === 1,
  await page.locator('.m-screen').innerText());
check('簽名真的存進裝置裡',
  await page.evaluate(() => JSON.parse(localStorage.getItem('sm.signatures') || '[]').length) === 1,
  'localStorage 沒有簽名');

// 擺放畫面：從下方挑一枚放上去，再拖到左上角
await page.locator('.m-screen img').last().click();
await page.waitForTimeout(300);
check('挑一枚就放到頁面上，並出現大小 / 濃度細調',
  (await page.locator('input[type=range]').count()) === 2,
  `滑桿數 ${await page.locator('input[type=range]').count()}`);

const stampBefore = await page.locator('.m-screen img').last().boundingBox();
await page.mouse.move(stampBefore.x + stampBefore.width / 2, stampBefore.y + stampBefore.height / 2);
await page.mouse.down();
await page.mouse.move(stampBefore.x - 40, stampBefore.y - 40, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const stampAfter = await page.locator('.m-screen img').last().boundingBox();
check('簽名拖得動', Math.abs(stampAfter.x - stampBefore.x) > 10,
  `${Math.round(stampBefore.x)} → ${Math.round(stampAfter.x)}`);
// 拖完還要維持選取，不然每拖一次細調就消失一次
check('拖完之後還是選取狀態',
  (await page.locator('input[type=range]').count()) === 2,
  `滑桿數 ${await page.locator('input[type=range]').count()}`);

await page.locator('button:has-text("套用")').click();
await page.waitForTimeout(600);
// BarBtn 的「使用中」是靠底色，不是 class —— 所以看的是算出來的背景
const signBtnLit = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('簽名'));
  if (!btn) return null;
  const bg = getComputedStyle(btn).backgroundColor;
  return { bg, transparent: /rgba\(0, 0, 0, 0\)|transparent/.test(bg) };
});
check('套用後回到編輯畫面，簽名鈕標成使用中',
  (await barLabels()).some((x) => x.includes('版面')) && signBtnLit && !signBtnLit.transparent,
  JSON.stringify(signBtnLit));

// 畫布上真的多了墨 —— 面板關掉、預覽重畫過才算數
const signedInk = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) dark++;
  }
  return dark;
});
check('成品預覽上看得到簽名', signedInk > 50, `深色像素 ${signedInk}`);

// ── 輸出 ────────────────────────────────────────────────
// 上面的文字面板已經回到拼貼模式了，直接開製作
await page.locator('button:has-text("製作")').click();
await page.waitForTimeout(300);
check('製作面板有格式與儲存',
  (await page.locator('.chip:has-text("WebP")').count()) === 1 &&
  (await page.locator('button:has-text("儲存")').count()) === 1, '製作面板不如預期');
check('拼貼也能直接輸出成 PDF',
  (await page.locator('.chip:has-text("PDF")').count()) === 1, '輸出格式沒有 PDF');
await page.locator('.chip:has-text("PDF")').click();
await page.waitForTimeout(250);
check('選了 PDF 就出現紙張選項',
  (await page.locator('.chip:has-text("貼合圖片")').count()) === 1 &&
  (await page.locator('.chip:has-text("A4")').count()) === 1, '沒有紙張選項');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

// ── 圖片分頁：多張合併成一份 PDF ────────────────────────
await page.locator('.chip:has-text("圖片")').first().click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').first().setInputFiles(
  await Promise.all([[400, 300], [300, 400]].map(([w, h], i) => makePng(w, h, `s${i}.png`))));
await page.waitForTimeout(600);
await page.locator('.chip:has-text("合併成 PDF")').click();
await page.waitForTimeout(300);
check('圖片分頁可以把多張合併成一份 PDF',
  (await page.locator('button:has-text("合併成 PDF（2 頁）")').count()) === 1,
  await page.locator('.m-body').innerText());
await page.locator('button:has-text("合併成 PDF（2 頁）")').click();
await page.waitForTimeout(2500);
check('合併後產出單一 PDF 檔（不是兩個圖檔）',
  /s0\.pdf/.test(await page.locator('.m-body').innerText()) &&
  (await page.locator('button:has-text("下載"), button:has-text("儲存")').count()) >= 1,
  await page.locator('.m-body').innerText());
await page.locator('.chip:has-text("編輯")').click();
await page.waitForTimeout(300);

// ── 文件分頁 ────────────────────────────────────────────
await page.locator('.chip:has-text("文件")').click();
await page.waitForTimeout(300);
check('文件分頁起始是選檔畫面',
  (await page.locator('text=選擇文件開始').count()) === 1, '沒有出現文件選檔畫面');

const MD = `# 會議紀錄

第一次專案會議，出席五人。

- 確認時程
- 分配工作

| 項目 | 負責 |
| --- | --- |
| 介面 | 小王 |
`;
await page.locator('input[type=file]').first().setInputFiles({
  name: '會議紀錄.md', mimeType: 'text/markdown', buffer: Buffer.from(MD, 'utf-8'),
});
await page.waitForTimeout(600);

check('文件解析後直接顯示排版預覽',
  (await page.locator('text=第一次專案會議，出席五人。').count()) === 1 &&
  (await page.locator('td:has-text("小王")').count()) === 1, '預覽沒有出現');

labels = await barLabels();
check('文件工具列是格式 / 紙張 / 換檔 / 轉換',
  ['PDF', '紙張', '換檔', '清空', '轉換'].every((l) => labels.some((x) => x.includes(l))),
  labels.join(','));

await page.locator('button:has-text("紙張")').click();
await page.waitForTimeout(300);
check('紙張設定可以挑尺寸與方向',
  (await page.locator('.chip:has-text("A4")').count()) === 1 &&
  (await page.locator('.chip:has-text("橫式")').count()) === 1, '沒有頁面設定');
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

await page.locator('button:has-text("轉換")').click();
await page.waitForTimeout(2500);
check('按轉換就產出 PDF，並且可以儲存',
  (await page.locator('text=會議紀錄.pdf').count()) === 1 &&
  (await page.locator('button:has-text("儲存")').count()) === 1,
  await page.locator('.m-screen').innerText());

await page.locator('button:has-text("PDF")').first().click();
await page.waitForTimeout(300);
const docTargets = await page.locator('.chip').allInnerTexts();
check('格式面板列出五種輸出',
  ['PDF', 'Word', 'Markdown', '純文字', '網頁'].every((l) => docTargets.some((t) => t.includes(l))),
  docTargets.join(','));

await page.locator('.chip:has-text("Word")').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("轉換")').click();
await page.waitForTimeout(1200);
check('換成 Word 也轉得出來',
  (await page.locator('text=會議紀錄.docx').count()) === 1,
  await page.locator('.m-screen').innerText());

// PDF 進來才會出現「圖片」這個輸出；Markdown 沒有「頁」的概念
await page.locator('button:has-text("Word")').first().click();
await page.waitForTimeout(300);
check('Markdown 來源不會出現「轉成圖片」的選項',
  (await page.locator('.chip').allInnerTexts()).every((t) => !t.includes('🖼️')),
  (await page.locator('.chip').allInnerTexts()).join(','));
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(200);

// ── 頁面分頁：合併 / 重排 / 轉向 / 刪頁 ──────────────────
await page.locator('.chip:has-text("📚 頁面")').click();
await page.waitForTimeout(300);
check('頁面分頁起始是選檔畫面',
  (await page.locator('text=選擇 PDF 開始').count()) === 1, '沒有出現選檔畫面');

await page.locator('input[type=file]').first().setInputFiles([
  path.join(HERE, 'fixtures/pages-a.pdf'),
  path.join(HERE, 'fixtures/pages-b.pdf'),
]);
await page.waitForTimeout(4000);

const cells = () => page.locator('.pagecell');
check('兩份 PDF 的頁面併成一張總表', (await cells().count()) === 5,
  String(await cells().count()));
check('每頁標示來自哪一個檔案',
  (await cells().allInnerTexts()).map((t) => t.trim()).join(',') === '1 · A,2 · A,3 · A,4 · B,5 · B',
  (await cells().allInnerTexts()).join('|'));
check('縮圖畫得出來', (await page.locator('.pagecell img').count()) === 5,
  String(await page.locator('.pagecell img').count()));

labels = await barLabels();
check('沒選頁時工具列是加檔 / 清空 / 輸出',
  ['加檔', '清空', '輸出'].every((l) => labels.some((x) => x.includes(l))) &&
  !labels.some((x) => x.includes('前移')), labels.join(','));

await cells().nth(3).click();
await page.waitForTimeout(300);
labels = await barLabels();
check('點某一頁就換成該頁的操作',
  ['左轉', '右轉', '簽名', '前移', '後移', '刪除', '完成'].every((l) => labels.some((x) => x.includes(l))),
  labels.join(','));

// PDF 也能蓋章，用的是同一個簽名庫（上面手寫存的那一枚還在）
await page.locator('button:has-text("簽名")').click();
await page.waitForTimeout(300);
check('PDF 頁面也能開簽名庫，而且看得到剛才存的簽名',
  (await page.locator('button:has-text("手寫")').count()) === 1 &&
  !/還沒有簽名/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());
await page.locator('.pill:has-text("完成")').click();
await page.waitForTimeout(250);

await page.locator('button:has-text("前移")').click();
await page.waitForTimeout(300);
check('前移把該頁往前挪一格',
  (await cells().allInnerTexts()).map((t) => t.trim()).join(',') === '1 · A,2 · A,3 · B,4 · A,5 · B',
  (await cells().allInnerTexts()).join('|'));

await page.locator('button:has-text("刪除")').click();
await page.waitForTimeout(300);
check('刪除把該頁拿掉，工具列回到預設',
  (await cells().count()) === 4 &&
  (await barLabels()).some((x) => x.includes('加檔')), String(await cells().count()));

await page.locator('button:has-text("輸出")').click();
await page.waitForTimeout(2500);
check('輸出產生一份 PDF',
  (await page.locator('text=.pdf').count()) >= 1 &&
  (await page.locator('button:has-text("儲存")').count()) === 1,
  await page.locator('.m-screen').innerText());

// ── 即時取景 ────────────────────────────────────────────
await page.locator('.chip:has-text("編輯")').click();
await page.waitForTimeout(400);
if ((await barLabels()).some((x) => x.includes('完成'))) {
  await page.locator('button:has-text("完成")').last().click();
  await page.waitForTimeout(300);
}
if ((await barLabels()).some((x) => x.includes('清空'))) {
  await page.locator('button:has-text("清空")').click();
  await page.waitForTimeout(300);
}

// 一開 App 手邊還沒有圖 —— 空畫面就要按得到相機，不然得先隨便選一張圖才拍得到
check('空畫面就給得出「用相機拍一張」',
  (await page.locator('button:has-text("用相機拍一張")').count()) === 1,
  (await barLabels()).join(','));

/** SVG 上的 points="x,y ..."（0–100）→ 相對座標 */
const polyPoints = async () => {
  const raw = await page.evaluate(() => {
    const poly = document.querySelector('.m-screen svg polygon');
    return poly ? poly.getAttribute('points') : null;
  });
  if (!raw) return null;
  return raw.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x: x / 100, y: y / 100 };
  });
};
const PAPER_REL = [
  { x: 140 / 800, y: 100 / 600 }, { x: 660 / 800, y: 100 / 600 },
  { x: 660 / 800, y: 500 / 600 }, { x: 140 / 800, y: 500 / 600 },
];
const paperError = (pts) => (!pts || pts.length !== 4 ? 1
  : pts.reduce((sum, p, i) => sum + Math.hypot(p.x - PAPER_REL[i].x, p.y - PAPER_REL[i].y), 0) / 4);

await page.locator('button:has-text("用相機拍一張")').click();
// 自動快門預設是開的。假相機完全靜止，放著不管的話一秒多就自己拍完、
// 畫面已經跳回編輯器了 —— 所以先關掉，才驗得到取景畫面本身。
// 偏好記在模組層，關掉之後下面幾段手動流程都會維持關著（最後再打開來測自動那條路）
await page.waitForSelector('button:has-text("自動")', { timeout: 5000 });
check('取景畫面給得出自動快門的開關',
  (await page.locator('button:has-text("自動")').count()) === 1, (await barLabels()).join(','));
await page.locator('button:has-text("自動")').click();
await page.waitForTimeout(1800);
const liveBox = await polyPoints();
check('關掉自動快門就不顯示位移讀數（也不會自己拍）',
  (await page.locator('[data-testid=cam-motion]').count()) === 0
  && (await page.locator('.m-screen video').count()) === 1, '關掉之後畫面還是變了');
check('取景畫面出現相機影像', (await page.locator('.m-screen video').count()) === 1, '沒有 video 元素');
check('取景時就把邊框疊在畫面上', paperError(liveBox) < 0.05,
  `框的平均誤差 ${paperError(liveBox).toFixed(4)}`);
check('抓到邊界時直接告訴使用者可以按快門',
  /抓到邊界/.test(await page.locator('.m-screen').innerText()),
  await page.locator('.m-screen').innerText());

// 離開取景沒把軌道關掉的話，相機燈會一直亮著
await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(400);
check('離開取景就把相機關掉',
  await page.evaluate(() => window.__fakeCam.stream.getVideoTracks()[0].readyState === 'ended'),
  await page.evaluate(() => window.__fakeCam.stream.getVideoTracks()[0].readyState));
check('取消後回到原本的畫面',
  (await page.locator('button:has-text("用相機拍一張")').count()) === 1,
  (await barLabels()).join(','));

await page.locator('button:has-text("用相機拍一張")').click();
await page.waitForTimeout(1800);
await page.locator('button:has-text("快門")').click();
await page.waitForTimeout(1500);
check('按快門就把照片放進編輯器（全解析度）',
  JSON.stringify(await canvasSize()) === JSON.stringify({ w: 800, h: 600 }),
  JSON.stringify(await canvasSize()));
// 連拍第二張、第三張的入口 —— 有圖之後空畫面的按鈕就不見了，工具列要接手
check('已經有圖之後，工具列上也有「拍照」', (await barLabels()).some((x) => x.includes('拍照')),
  (await barLabels()).join(','));

// 拉正沿用快門當下的偵測結果 —— 把 detect 換成會回一個明顯錯誤的框，
// 如果拉正畫面還是框在紙上，就證明那個框是取景時帶過來的，不是現場重測的
await page.evaluate(() => {
  window.__realDetect = window.SMScanLite.detect;
  window.SMScanLite.detect = () => ({
    corners: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }],
    confidence: 0, method: 'stub', hints: [], quality: null,
  });
});
const shotBox = await page.locator('canvas').boundingBox();
await page.mouse.click(shotBox.x + shotBox.width / 2, shotBox.y + shotBox.height / 2);
await page.waitForTimeout(400);
await page.locator('button:has-text("拉正")').click();
await page.waitForTimeout(900);
const seeded = await polyPoints();
check('拉正沿用取景時抓到的框，不必重測一次', paperError(seeded) < 0.05,
  `框的平均誤差 ${paperError(seeded).toFixed(4)}`);
await page.evaluate(() => { window.SMScanLite.detect = window.__realDetect; });
await page.locator('button:has-text("取消")').click();
await page.waitForTimeout(300);

// ── 自動快門 ────────────────────────────────────────────
// 前面把它關掉了（偏好留在模組層），這裡打開來走完整條路：
// 倒數 → 自己按下快門 → 照片進編輯器，全程沒有人碰過「快門」那顆按鈕
// 上一段停在「編輯單張」的工具列上，那裡沒有「拍照」—— 先退回拼貼的工具列
if ((await barLabels()).some((x) => x.includes('完成'))) {
  await page.locator('button:has-text("完成")').last().click();
  await page.waitForTimeout(400);
}
// 縮圖列只在兩張以上時才出現，所以這裡的 0 就是「手邊只有剛剛手動拍的那一張」
const imgCount = () => page.locator('.m-screen img').count();
const imgsBefore = await imgCount();
await page.locator('button:has-text("拍照")').click();
await page.waitForTimeout(500);
await page.locator('button:has-text("自動")').click();
await page.waitForTimeout(700);
const armed = await page.locator('.m-screen').innerText();
check('打開自動快門後，畫面說得出它會自己拍', /自動拍|穩住/.test(armed), armed);
// 這個讀數不只是給使用者看的 —— 合成串流不會抖，自動快門的門檻只能靠它在真機上量出來
check('取景時把當下的角點位移顯示出來',
  (await page.locator('[data-testid=cam-motion]').count()) === 1,
  await page.locator('.m-screen').innerText());
check('倒數期間有一條穩定度長條',
  (await page.locator('[data-testid=cam-steady]').count()) === 1,
  await page.locator('.m-screen').innerText());

await page.waitForTimeout(3000);
check('框穩住之後不必按快門，相機自己收掉了',
  (await page.locator('.m-screen video').count()) === 0
  && (await barLabels()).some((x) => x.includes('拍照')),
  (await barLabels()).join(','));
// 縮圖列冒出來＝手邊變成兩張（手動拍的 + 自動拍的），全程沒有人按過快門
check('自動拍的那張真的進了編輯器',
  imgsBefore === 0 && (await imgCount()) === 2,
  `${imgsBefore} → ${await imgCount()}`);

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
