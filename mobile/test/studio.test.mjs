/**
 * 離線精簡版介面（static/js/studio.jsx）的功能測試。
 *
 * 這裡驗的是「即時反應」這件事本身：按下旋轉之後，預覽畫布的尺寸有沒有
 * 真的在同一個 tick 內換過來；切換拼接方向後版面是不是真的重排。
 * 這些都只有在真的瀏覽器裡跑得出來。
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
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
// 瀏覽器自己會去要 favicon，404 與 App 無關
page.on('requestfailed', () => {});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

/** 在瀏覽器裡造一張測試圖，回傳可以餵給 setInputFiles 的 buffer */
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

// ── 起始畫面 ────────────────────────────────────────────
check('啟動就是編輯畫面（沒有伺服器設定、沒有登入）',
  (await page.locator('text=選擇圖片開始編輯').count()) === 1 &&
  (await page.locator('#sm-server-setup').count()) === 0,
  '起始畫面不如預期');

check('只有編輯 / 轉換兩個分頁',
  (await page.locator('.m-tab').count()) === 2,
  `分頁數 ${await page.locator('.m-tab').count()}`);

// ── 單張：即時旋轉 / 翻轉 ────────────────────────────────
await page.locator('input[type=file]').first().setInputFiles([await makePng(200, 100, 'a.png')]);
await page.waitForTimeout(600);

let size = await canvasSize();
check('上傳單張後立刻出現預覽', size && size.w === 200 && size.h === 100, JSON.stringify(size));

check('單張時不顯示拼接選項',
  (await page.locator('text=拼接方式').count()) === 0, '不該出現拼接設定');

await page.locator('button:has-text("右轉")').click();
await page.waitForTimeout(300);
size = await canvasSize();
check('按右轉 → 預覽立刻變成直式（不用等處理）',
  size && size.w === 100 && size.h === 200, JSON.stringify(size));

await page.locator('button:has-text("右轉")').click();
await page.waitForTimeout(300);
size = await canvasSize();
check('再按一次右轉 → 轉回橫式（180°）',
  size && size.w === 200 && size.h === 100, JSON.stringify(size));

await page.locator('button:has-text("水平翻")').click();
await page.waitForTimeout(300);
check('水平翻轉會標示為啟用中',
  (await page.locator('button:has-text("水平翻")').getAttribute('class')).includes('on'),
  '按鈕沒有 on 狀態');

await page.locator('button:has-text("復原")').click();
await page.waitForTimeout(300);
size = await canvasSize();
check('復原回到原始狀態', size && size.w === 200 && size.h === 100, JSON.stringify(size));

// ── 多張：拼接 + 個別編輯 ────────────────────────────────
await page.locator('button:has-text("清空")').click();
await page.waitForTimeout(300);
await page.locator('input[type=file]').first().setInputFiles([
  await makePng(200, 100, 'a.png'),
  await makePng(100, 100, 'b.png'),
]);
await page.waitForTimeout(800);

check('多張時才出現拼接設定',
  (await page.locator('text=拼接方式').count()) === 1, '應該要有拼接設定');

size = await canvasSize();
check('直向拼接 + 等比對齊（100x50 疊 100x100 = 100x150）',
  size && size.w === 100 && size.h === 150, JSON.stringify(size));

await page.locator('button:has-text("橫向")').click();
await page.waitForTimeout(400);
size = await canvasSize();
check('切成橫向 → 版面立刻重排（300x100）',
  size && size.w === 300 && size.h === 100, JSON.stringify(size));

await page.locator('button:has-text("格狀")').click();
await page.waitForTimeout(400);
size = await canvasSize();
check('切成格狀（自動 1 欄 → 200x200）',
  size && size.w === 200 && size.h === 200, JSON.stringify(size));

check('多張時出現縮圖列可以挑要編輯哪一張',
  (await page.locator('.m-body img').count()) === 2,
  `縮圖數 ${await page.locator('.m-body img').count()}`);

// 選第 2 張再旋轉，只有那一張要變
await page.locator('.m-body img').nth(1).click();
await page.waitForTimeout(200);
check('選到第 2 張', (await page.locator('text=編輯第 2 張').count()) === 1, '沒有切換選取');

await page.locator('button:has-text("右轉")').click();
await page.waitForTimeout(400);
size = await canvasSize();
check('只旋轉選中的那張（正方形轉了也還是 200x200）',
  size && size.w === 200 && size.h === 200, JSON.stringify(size));

// ── 轉換分頁 ────────────────────────────────────────────
await page.locator('.m-tab:has-text("轉換")').click();
await page.waitForTimeout(300);
check('轉換分頁把縮放 / 壓縮 / 格式放在同一頁',
  (await page.locator('text=限制長邊').count()) === 1 &&
  (await page.locator('text=格式與品質').count()) === 1,
  '轉換分頁內容不如預期');

await page.locator('input[type=file]').first().setInputFiles([
  await makePng(1200, 800, 'big1.png'),
  await makePng(900, 600, 'big2.png'),
]);
await page.waitForTimeout(400);
await page.locator('button:has-text("開始轉換")').click();
await page.waitForTimeout(2500);

check('批次轉換完成並列出每個檔案',
  (await page.locator('text=完成 2 個檔案').count()) === 1,
  '沒有出現結果清單');
check('顯示前後容量對比',
  (await page.locator('text=/→/').count()) > 0, '沒有容量對比');

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
