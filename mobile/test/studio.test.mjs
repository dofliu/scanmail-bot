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
  ['左轉', '右轉', '裁切', '大小', '完成'].every((l) => labels.some((x) => x.includes(l))),
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

// ── 輸出 ────────────────────────────────────────────────
await page.locator('button:has-text("完成")').last().click();
await page.waitForTimeout(300);
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
check('文件工具列是格式 / 頁面 / 換檔 / 轉換',
  ['PDF', '頁面', '換檔', '清空', '轉換'].every((l) => labels.some((x) => x.includes(l))),
  labels.join(','));

await page.locator('button:has-text("頁面")').click();
await page.waitForTimeout(300);
check('頁面設定可以挑紙張與方向',
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

const realErrors = pageErrors.filter((e) => !/favicon/i.test(e) && !/status of 404/.test(e));
check('全程沒有 JS 錯誤', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) process.exit(1);
