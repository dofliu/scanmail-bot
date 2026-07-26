/**
 * static/js/image-local.js 的功能測試。
 *
 * 這支引擎是離線精簡版的全部價值所在，而且它只能在瀏覽器裡跑（Canvas），
 * pytest 測不到，所以用 Playwright 開一個真的 Chromium 來驗。
 *
 * 執行：cd mobile && npm run test:image
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = resolve(HERE, '../../static/js/image-local.js');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${pass ? '' : ` — ${detail}`}`);
}

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
});
const page = await browser.newPage();
// about:blank 就夠了 —— 引擎只用 Canvas，不碰網路也不碰 DOM 版面
await page.goto('about:blank');
await page.addScriptTag({ content: readFileSync(ENGINE, 'utf8') });

// 瀏覽器端的共用工具：造圖、量測結果
await page.evaluate(() => {
  window.T = {
    /** 產生一張指定尺寸的測試圖（左半紅、右半藍，方便看出翻轉/旋轉） */
    async makeFile(w, h, name = 'test.png', type = 'image/png') {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = '#0000ff'; ctx.fillRect(w / 2, 0, w / 2, h);
      const blob = await new Promise((r) => c.toBlob(r, type));
      return new File([blob], name, { type });
    },
    /** 量出 blob 的實際尺寸與型別 */
    async measure(blob) {
      const bmp = await createImageBitmap(blob);
      const out = { w: bmp.width, h: bmp.height, type: blob.type, size: blob.size };
      bmp.close();
      return out;
    },
    /** 取某個座標的像素顏色 */
    async pixel(blob, x, y) {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      bmp.close();
      return [d[0], d[1], d[2]];
    },
  };
});

// ── 引擎可用性 ───────────────────────────────────────────
const avail = await page.evaluate(() => ({
  available: window.SMImageLocal.available,
  png: window.SMImageLocal.supportsOutput('PNG'),
  jpg: window.SMImageLocal.supportsOutput('JPG'),
  webp: window.SMImageLocal.supportsOutput('WebP'),
  bmp: window.SMImageLocal.supportsOutput('BMP'),
  gif: window.SMImageLocal.supportsOutput('GIF'),
}));
check('引擎可用', avail.available === true, JSON.stringify(avail));
check('支援 PNG / JPG / WebP 輸出', avail.png && avail.jpg && avail.webp, JSON.stringify(avail));
check('明確拒絕 BMP / GIF 輸出', !avail.bmp && !avail.gif,
  'toBlob 遇到不認得的格式會安靜地吐 PNG，必須先擋掉');

// ── 縮放 ────────────────────────────────────────────────
const resize = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const big = await window.T.makeFile(1200, 400);
  const small = await window.T.makeFile(100, 50);
  return {
    fit: await window.T.measure((await L.resize(big, { width: 800, height: 600, mode: 'fit', format: 'JPG' })).blob),
    fitNoUpscale: await window.T.measure((await L.resize(small, { width: 800, height: 600, mode: 'fit', format: 'PNG' })).blob),
    // fit 的留白處要是底色，不能是透明/黑色
    fitCorner: await window.T.pixel((await L.resize(big, { width: 800, height: 600, mode: 'fit', format: 'JPG', bgColor: '#ffffff' })).blob, 5, 5),
    cover: await window.T.measure((await L.resize(big, { width: 400, height: 400, mode: 'cover', format: 'JPG' })).blob),
    stretch: await window.T.measure((await L.resize(big, { width: 333, height: 222, mode: 'stretch', format: 'PNG' })).blob),
    name: (await L.resize(big, { width: 10, height: 10, format: 'WebP' })).filename,
  };
});
check('fit → 輸出正好是指定畫布尺寸', resize.fit.w === 800 && resize.fit.h === 600, JSON.stringify(resize.fit));
check('fit → 小圖不放大（對齊 Pillow thumbnail）',
  resize.fitNoUpscale.w === 800 && resize.fitNoUpscale.h === 600, JSON.stringify(resize.fitNoUpscale));
check('fit → 留白填底色而非透明',
  resize.fitCorner[0] > 240 && resize.fitCorner[1] > 240 && resize.fitCorner[2] > 240,
  `角落像素 rgb(${resize.fitCorner})`);
check('cover → 裁切成指定尺寸', resize.cover.w === 400 && resize.cover.h === 400, JSON.stringify(resize.cover));
check('stretch → 強制拉伸到指定尺寸', resize.stretch.w === 333 && resize.stretch.h === 222, JSON.stringify(resize.stretch));
check('輸出副檔名跟著格式走', resize.name === 'test.webp', resize.name);

// ── 格式轉換 ─────────────────────────────────────────────
const convert = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const src = await window.T.makeFile(200, 100);
  const jpg = await window.T.measure((await L.convert(src, { format: 'JPG' })).blob);
  const webp = await window.T.measure((await L.convert(src, { format: 'WebP' })).blob);
  const png = await window.T.measure((await L.convert(src, { format: 'PNG' })).blob);
  let bmpError = null;
  try { await L.convert(src, { format: 'BMP' }); } catch (e) { bmpError = e.message; }
  return { jpg, webp, png, bmpError };
});
check('轉 JPG', convert.jpg.type === 'image/jpeg' && convert.jpg.w === 200, JSON.stringify(convert.jpg));
check('轉 WebP', convert.webp.type === 'image/webp' && convert.webp.w === 200, JSON.stringify(convert.webp));
check('轉 PNG 保持尺寸', convert.png.type === 'image/png' && convert.png.h === 100, JSON.stringify(convert.png));
check('轉 BMP 明確報錯而不是假裝成功', !!convert.bmpError, String(convert.bmpError));

// ── 壓縮 ────────────────────────────────────────────────
const compress = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const src = await window.T.makeFile(1200, 400, 'photo.png');
  const plain = await L.compress(src, { quality: 40 });
  const capped = await L.compress(src, { quality: 40, maxDimension: 500 });
  return {
    plain: await window.T.measure(plain.blob),
    capped: await window.T.measure(capped.blob),
    name: plain.filename,
    srcSize: src.size,
  };
});
check('壓縮輸出 JPG', compress.plain.type === 'image/jpeg' && compress.name === 'photo.jpg',
  `${compress.plain.type} / ${compress.name}`);
check('壓縮不改尺寸（未設定最大邊長）',
  compress.plain.w === 1200 && compress.plain.h === 400, JSON.stringify(compress.plain));
check('最大邊長 → 等比縮到長邊 500',
  compress.capped.w === 500 && compress.capped.h === 167, JSON.stringify(compress.capped));

// ── 旋轉 / 翻轉 ──────────────────────────────────────────
const orient = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const src = await window.T.makeFile(200, 100);
  const r90 = await L.rotate(src, { angle: 90, format: 'PNG' });
  const r180 = await L.rotate(src, { angle: 180, format: 'PNG' });
  const fh = await L.flip(src, { axis: 'horizontal', format: 'PNG' });
  return {
    r90: await window.T.measure(r90.blob),
    r180: await window.T.measure(r180.blob),
    // 原圖左紅右藍；旋轉 180 後左邊應該變藍
    r180Left: await window.T.pixel(r180.blob, 5, 50),
    fh: await window.T.measure(fh.blob),
    fhLeft: await window.T.pixel(fh.blob, 5, 50),
  };
});
check('旋轉 90° → 寬高對調', orient.r90.w === 100 && orient.r90.h === 200, JSON.stringify(orient.r90));
check('旋轉 180° → 尺寸不變', orient.r180.w === 200 && orient.r180.h === 100, JSON.stringify(orient.r180));
check('旋轉 180° → 左右內容真的換邊', orient.r180Left[2] > 200 && orient.r180Left[0] < 60,
  `左側像素 rgb(${orient.r180Left})，預期偏藍`);
check('水平翻轉 → 尺寸不變', orient.fh.w === 200 && orient.fh.h === 100, JSON.stringify(orient.fh));
check('水平翻轉 → 左右內容真的換邊', orient.fhLeft[2] > 200 && orient.fhLeft[0] < 60,
  `左側像素 rgb(${orient.fhLeft})，預期偏藍`);

// ── 拼接（版面規則對齊後端 merge_images）─────────────────
const merge = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const a = await window.T.makeFile(200, 100, 'a.png');
  const b = await window.T.makeFile(100, 100, 'b.png');
  return {
    // normalize：全部縮到最小寬度 100 → a 變 100x50、b 維持 100x100 → 畫布 100x150
    vertical: await window.T.measure((await L.merge([a, b], { direction: 'vertical', format: 'PNG' })).blob),
    // gap 10 → 100x160
    verticalGap: await window.T.measure((await L.merge([a, b], { direction: 'vertical', gap: 10, format: 'PNG' })).blob),
    // normalize：全部縮到最小高度 100（兩張都已是 100）→ 畫布 300x100
    horizontal: await window.T.measure((await L.merge([a, b], { direction: 'horizontal', format: 'PNG' })).blob),
    // 不 normalize → 畫布寬取最大 200、高度相加 200
    noNormalize: await window.T.measure((await L.merge([a, b], { direction: 'vertical', normalize: false, format: 'PNG' })).blob),
    // grid：cols = round(sqrt(2)) = 1 → 2 列，格子 200x100 → 畫布 200x200
    grid: await window.T.measure((await L.merge([a, b], { direction: 'grid', format: 'PNG' })).blob),
    grid2col: await window.T.measure((await L.merge([a, b], { direction: 'grid', columns: 2, format: 'PNG' })).blob),
    name: (await L.merge([a, b], { format: 'JPG' })).filename,
  };
});
check('直向拼接 + normalize', merge.vertical.w === 100 && merge.vertical.h === 150, JSON.stringify(merge.vertical));
check('直向拼接 + 間距', merge.verticalGap.w === 100 && merge.verticalGap.h === 160, JSON.stringify(merge.verticalGap));
check('橫向拼接 + normalize', merge.horizontal.w === 300 && merge.horizontal.h === 100, JSON.stringify(merge.horizontal));
check('關閉 normalize 時各自保留原尺寸', merge.noNormalize.w === 200 && merge.noNormalize.h === 200, JSON.stringify(merge.noNormalize));
check('九宮格自動欄數', merge.grid.w === 200 && merge.grid.h === 200, JSON.stringify(merge.grid));
check('九宮格指定 2 欄', merge.grid2col.w === 400 && merge.grid2col.h === 100, JSON.stringify(merge.grid2col));
check('拼接結果檔名', merge.name === 'merged.jpg', merge.name);

// ── UI 轉接層 ────────────────────────────────────────────
const runner = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const files = [await window.T.makeFile(200, 100, 'a.png'), await window.T.makeFile(120, 60, 'b.png')];
  const steps = [];
  const batchOut = await L.runner('resize', { width: 50, height: 50, mode: 'fit', format: 'PNG' })(
    files, (p, m) => steps.push([p, m])
  );
  return {
    batchCount: batchOut.length,
    firstSize: await window.T.measure(batchOut[0].blob),
    sawProgress: steps.length >= 2 && steps[steps.length - 1][0] === 100,
    mergeSingle: (await L.runner('merge', { direction: 'vertical', format: 'PNG' })(files, () => {})).length,
    unsupportedFormat: L.runner('convert', { format: 'BMP' }),
    unknownAction: L.runner('nope', {}),
    watermark: L.runner('watermark', {}),
  };
});
check('批次處理每個檔案都有結果', runner.batchCount === 2, String(runner.batchCount));
check('批次結果套用了設定', runner.firstSize.w === 50 && runner.firstSize.h === 50, JSON.stringify(runner.firstSize));
check('批次回報進度且以 100 收尾', runner.sawProgress, '沒有收到完整的進度回呼');
check('拼接只產生一個結果', runner.mergeSingle === 1, String(runner.mergeSingle));
check('不支援的輸出格式 → runner 回傳 null', runner.unsupportedFormat === null, String(runner.unsupportedFormat));
check('未知操作 → runner 回傳 null', runner.unknownAction === null, String(runner.unknownAction));
check('浮水印做不到 → runner 回傳 null', runner.watermark === null, String(runner.watermark));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) {
  console.error(`\n${failed.length} 項失敗`);
  process.exit(1);
}
