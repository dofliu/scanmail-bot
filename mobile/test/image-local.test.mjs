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
// 離線版自己有文字浮水印（composeToBlob 的 texts），但後端那支浮水印工具
// 還吃圖片浮水印、位移、透明度…等參數，runner 不假裝做得到
check('後端的浮水印工具 → runner 回傳 null，讓它走後端',
  runner.watermark === null, String(runner.watermark));

// ── 調整 / 打碼 / 文字 ──────────────────────────────────
const layers = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#c0392b'; x.fillRect(0, 0, 200, 200);
    x.fillStyle = '#2980b9'; x.fillRect(200, 0, 200, 200);
    return c;
  };
  const px = (cv, x, y) => {
    const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const blob = await new Promise((r) => mk().toBlob(r, 'image/png'));
  const item = await L.loadItem(new File([blob], 'a.png', { type: 'image/png' }));

  const out = {};
  out.filterString = L.filterOf({ brightness: 1.2, grayscale: 1 });
  out.noAdjust = L.filterOf(null);

  // 黑白濾鏡：紅藍兩半都該變成灰（三個通道相同）
  const mono = L.renderItem({ ...item, adjust: { grayscale: 1 } });
  const g = px(mono, 100, 100);
  out.grayscale = g[0] === g[1] && g[1] === g[2];

  // 打碼：塗黑那一塊要真的變黑，框外不能受影響
  const redacted = L.renderItem({
    ...item, redactions: [{ x: 0.25, y: 0.25, w: 0.5, h: 0.5, style: 'fill' }],
  });
  out.redactInside = px(redacted, 200, 100);
  out.redactOutside = px(redacted, 20, 100);

  // 旋轉之後打碼位置仍然正確 —— 這裡曾經因為畫布沒還原座標而整個位移出去
  const rotated = L.renderItem({
    ...item, rotate: 90, redactions: [{ x: 0, y: 0, w: 1, h: 0.5, style: 'fill' }],
  });
  out.rotatedSize = [rotated.width, rotated.height];
  out.rotatedTop = px(rotated, 100, 40);
  out.rotatedBottom = px(rotated, 100, 300);

  // 文字不是實心色塊，逐點比對會踩到字與字之間的空隙 ——
  // 所以改成數「某個區域裡有幾個像素被改掉」
  const region = (cv, x, y, w, h) => cv.getContext('2d').getImageData(x, y, w, h).data;
  const changed = (a, b, x, y, w, h) => {
    const pa = region(a, x, y, w, h);
    const pb = region(b, x, y, w, h);
    let n = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) n++;
    }
    return n;
  };

  const plain = L.composeToCanvas([item], {});

  // 馬賽克要真的改掉像素（純色區塊看不出來，所以先畫幾條白線進去）
  const striped = document.createElement('canvas');
  striped.width = 400; striped.height = 200;
  const sx = striped.getContext('2d');
  sx.drawImage(item.bitmap, 0, 0);
  sx.fillStyle = '#ffffff';
  for (let y = 0; y < 200; y += 6) sx.fillRect(0, y, 400, 2);
  const beforeMosaic = document.createElement('canvas');
  beforeMosaic.width = 400; beforeMosaic.height = 200;
  beforeMosaic.getContext('2d').drawImage(striped, 0, 0);
  L.applyRedactions(striped, [{ x: 0.4, y: 0.3, w: 0.2, h: 0.4, style: 'mosaic', cells: 3 }]);
  out.mosaicChanged = changed(beforeMosaic, striped, 160, 60, 80, 80);
  out.mosaicLeftAlone = changed(beforeMosaic, striped, 0, 60, 80, 80);

  // 文字：畫在正中央，中央那塊要有一堆像素被改掉
  const titled = L.composeToCanvas([item], {
    texts: [{ text: '機密', x: 0.5, y: 0.5, size: 0.6, color: '#00ff00', stroke: 0 }],
  });
  out.textCenter = changed(plain, titled, 140, 40, 120, 120);
  out.textCorner = changed(plain, titled, 0, 0, 40, 40);

  // 平鋪浮水印：四個象限都要有痕跡，才叫「蓋滿整張」
  const tiled = L.composeToCanvas([item], {
    texts: [{ text: '樣本', tile: true, size: 0.12, color: '#00ff00', opacity: 1, stroke: 0, gap: 0.02 }],
  });
  out.tiledQuadrants = [[0, 0], [200, 0], [0, 100], [200, 100]]
    .map(([x, y]) => changed(plain, tiled, x, y, 200, 100))
    .filter((n) => n > 50).length;

  // 空字串不該畫出任何東西
  const empty = L.composeToCanvas([item], { texts: [{ text: '   ' }] });
  out.emptyChanged = changed(plain, empty, 0, 0, 400, 200);
  return out;
});

check('色彩調整轉成 CSS filter 字串',
  layers.filterString === 'brightness(1.2) grayscale(1)' && layers.noAdjust === 'none',
  `${layers.filterString} / ${layers.noAdjust}`);
check('黑白濾鏡真的把顏色抽掉', layers.grayscale, JSON.stringify(layers));
check('打碼把框內塗掉、框外不動',
  layers.redactInside.join() === '0,0,0' && layers.redactOutside.join() === '192,57,43',
  JSON.stringify([layers.redactInside, layers.redactOutside]));
check('旋轉後打碼仍然落在正確位置',
  layers.rotatedSize.join() === '200,400' &&
  layers.rotatedTop.join() === '0,0,0' && layers.rotatedBottom.join() !== '0,0,0',
  JSON.stringify([layers.rotatedSize, layers.rotatedTop, layers.rotatedBottom]));
check('馬賽克改掉框內的像素、框外不動',
  layers.mosaicChanged > 500 && layers.mosaicLeftAlone === 0,
  `框內改了 ${layers.mosaicChanged} 點、框外改了 ${layers.mosaicLeftAlone} 點`);
check('文字疊在指定位置，沒有畫到別處',
  layers.textCenter > 500 && layers.textCorner === 0,
  `中央 ${layers.textCenter} 點、角落 ${layers.textCorner} 點`);
check('平鋪浮水印四個象限都蓋到',
  layers.tiledQuadrants === 4, `只蓋到 ${layers.tiledQuadrants} 個象限`);
check('空白文字不會留下痕跡', layers.emptyChanged === 0, `改了 ${layers.emptyChanged} 點`);

// ── 標註（箭頭 / 方框）─────────────────────────────────
console.log('\n標註');

const marks = await page.evaluate(() => {
  const L = window.SMImageLocal;
  // 純白底才看得出「哪些像素被畫上去了」—— 紅藍兩半會把顏色比對弄得很吵
  const white = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    return c;
  };
  const painted = (cv, x, y, w, h) => {
    const d = cv.getContext('2d').getImageData(x, y, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
    }
    return n;
  };

  // 「箭頭有沒有頭」問的是「靠近箭尖的地方是不是比箭身高」，
  // 所以量的是某一段 x 範圍內畫到的**垂直高度**，不是點數 ——
  // 點數會被線寬與暈邊稀釋，高度不會。
  const spanY = (cv, x, w) => {
    const d = cv.getContext('2d').getImageData(x, 0, w, cv.height).data;
    let top = -1;
    let bottom = -1;
    for (let row = 0; row < cv.height; row++) {
      for (let col = 0; col < w; col++) {
        const i = (row * w + col) * 4;
        if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) {
          if (top < 0) top = row;
          bottom = row;
          break;
        }
      }
    }
    return top < 0 ? 0 : bottom - top + 1;
  };

  const out = {};

  // 方框：四條邊上要有筆跡，正中間必須是空的 —— 方框是框不是色塊
  const boxed = white(400, 200);
  L.drawAnnotations(boxed, [{ kind: 'box', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }]);
  out.boxTop = painted(boxed, 96, 46, 208, 8);
  out.boxBottom = painted(boxed, 96, 146, 208, 8);
  out.boxLeft = painted(boxed, 96, 46, 8, 108);
  out.boxRight = painted(boxed, 296, 46, 8, 108);
  out.boxHollow = painted(boxed, 140, 80, 120, 40);
  out.boxOutside = painted(boxed, 0, 0, 60, 30);

  // 箭頭指向的那一端要比尾端粗 —— 箭頭有沒有頭，就看這個
  // 線寬指定成 0.02 而不是用預設值：測試畫布短邊只有 200px，預設的 0.006 算出來
  // 是 1.5px 的線、7px 的箭頭，頭跟尾在取樣格裡差不了幾個點。量的是幾何，不是預設值。
  const arrow = white(400, 200);
  L.drawAnnotations(arrow, [{ kind: 'arrow', x1: 0.1, y1: 0.5, x2: 0.9, y2: 0.5, width: 0.02 }]);
  out.arrowHead = spanY(arrow, 336, 20);
  out.arrowTail = spanY(arrow, 40, 20);

  // 反過來拖，頭要換到另一邊。方框做同樣的事得到的是同一塊 ——
  // 這一對是「為什麼存起點終點而不是 x/y/w/h」的證明
  const back = white(400, 200);
  L.drawAnnotations(back, [{ kind: 'arrow', x1: 0.9, y1: 0.5, x2: 0.1, y2: 0.5, width: 0.02 }]);
  out.backHead = spanY(back, 44, 20);
  out.backTail = spanY(back, 340, 20);

  const boxA = white(400, 200);
  const boxB = white(400, 200);
  L.drawAnnotations(boxA, [{ kind: 'box', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }]);
  L.drawAnnotations(boxB, [{ kind: 'box', x1: 0.75, y1: 0.75, x2: 0.25, y2: 0.25 }]);
  const same = (a, b) => {
    const pa = a.getContext('2d').getImageData(0, 0, 400, 200).data;
    const pb = b.getContext('2d').getImageData(0, 0, 400, 200).data;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return false;
    return true;
  };
  out.boxDirectionless = same(boxA, boxB);

  // 相對座標：換一個尺寸的畫布，落點的比例要一樣
  const small = white(200, 100);
  L.drawAnnotations(small, [{ kind: 'box', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }]);
  out.scaledTop = painted(small, 48, 21, 104, 8);
  out.scaledHollow = painted(small, 70, 40, 60, 20);

  // 顏色：指定的顏色要真的出現（暈邊是黑的，所以只找純色那一點）
  const tinted = white(400, 200);
  L.drawAnnotations(tinted, [{ kind: 'box', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8, color: '#00ff00', width: 0.02 }]);
  const scan = tinted.getContext('2d').getImageData(0, 0, 400, 200).data;
  let green = 0;
  for (let i = 0; i < scan.length; i += 4) {
    if (scan[i] < 60 && scan[i + 1] > 200 && scan[i + 2] < 60) green++;
  }
  out.green = green;

  // 暈邊：紅箭頭壓在紅底上，沒有暈邊就整支消失
  const red = document.createElement('canvas');
  red.width = 200; red.height = 200;
  const rx = red.getContext('2d');
  rx.fillStyle = '#e5322d'; rx.fillRect(0, 0, 200, 200);
  // 量的是「有沒有變暗」而不是「有沒有變」：同色疊同色在 alpha 合成下仍會有幾個
  // 位元組的捨入差，那不代表使用者看得見。暈邊的作用就是那一圈深色，所以數深色點。
  const darker = (data) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 180) n++;
    return n;
  };
  L.drawAnnotations(red, [{ kind: 'arrow', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, width: 0.02 }]);
  out.haloVisible = darker(rx.getImageData(0, 0, 200, 200).data);

  const flat = document.createElement('canvas');
  flat.width = 200; flat.height = 200;
  const fx = flat.getContext('2d');
  fx.fillStyle = '#e5322d'; fx.fillRect(0, 0, 200, 200);
  L.drawAnnotations(flat, [{ kind: 'arrow', x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, width: 0.02, halo: false }]);
  out.noHaloInvisible = darker(fx.getImageData(0, 0, 200, 200).data);

  // 沒有大小的那一筆（手抖點一下）不該留下任何東西
  const dot = white(400, 200);
  L.drawAnnotations(dot, [{ kind: 'box', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }]);
  L.drawAnnotations(dot, [{ kind: 'arrow', x1: 0.5, y1: 0.5, x2: 0.5001, y2: 0.5 }]);
  out.dotPainted = painted(dot, 0, 0, 400, 200);

  // 空陣列 / null 走原樣返回的快路
  const untouched = white(400, 200);
  out.emptySame = L.drawAnnotations(untouched, []) === untouched
    && L.drawAnnotations(untouched, null) === untouched
    && painted(untouched, 0, 0, 400, 200) === 0;

  // null 混在陣列裡不能整批爆掉
  const mixed = white(400, 200);
  let threw = false;
  try {
    L.drawAnnotations(mixed, [null, { kind: 'box', x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4 }]);
  } catch (e) { threw = true; }
  out.nullSafe = !threw && painted(mixed, 0, 0, 400, 200) > 0;

  return out;
});

check('方框畫的是框不是色塊（四邊有筆跡、中間空的）',
  marks.boxTop > 100 && marks.boxBottom > 100 && marks.boxLeft > 50 && marks.boxRight > 50
  && marks.boxHollow === 0 && marks.boxOutside === 0,
  JSON.stringify(marks));
check('箭頭的頭比箭身高（箭頭真的有頭）',
  marks.arrowHead > marks.arrowTail * 1.8 && marks.arrowTail > 0,
  `頭高 ${marks.arrowHead}px、身高 ${marks.arrowTail}px`);
check('反過來拖，箭頭的頭跟著換邊',
  marks.backHead > marks.backTail * 1.8 && marks.backTail > 0,
  `頭高 ${marks.backHead}px、身高 ${marks.backTail}px`);
check('方框沒有方向 —— 從哪個角拖都是同一塊',
  marks.boxDirectionless, '兩次拖曳畫出來的不一樣');
check('座標是相對的：換尺寸的畫布落點比例一樣',
  marks.scaledTop > 50 && marks.scaledHollow === 0,
  `上緣 ${marks.scaledTop} 點、中間 ${marks.scaledHollow} 點`);
check('指定的顏色真的畫得出來', marks.green > 200, `只有 ${marks.green} 個綠點`);
check('暈邊讓同色底上的標註仍然看得見',
  marks.haloVisible > 300 && marks.noHaloInvisible === 0,
  `有暈邊 ${marks.haloVisible} 個深色點、關掉暈邊 ${marks.noHaloInvisible} 個`);
check('沒有大小的那一筆不留痕跡', marks.dotPainted === 0, `改了 ${marks.dotPainted} 點`);
check('空的標註陣列原樣返回、不動畫布', marks.emptySame, JSON.stringify(marks.emptySame));
check('陣列裡混到 null 不會整批失敗', marks.nullSafe, JSON.stringify(marks.nullSafe));

const marksItem = await page.evaluate(async () => {
  const L = window.SMImageLocal;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 400, 200);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const item = await L.loadItem(new File([blob], 'w.png', { type: 'image/png' }));

  const painted = (cv, px, py, w, h) => {
    const d = cv.getContext('2d').getImageData(px, py, w, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
    }
    return n;
  };

  const out = {};
  out.defaultEmpty = Array.isArray(item.annotations) && item.annotations.length === 0;

  // renderItem 要把標註畫進去
  const shown = L.renderItem({ ...item, annotations: [{ kind: 'box', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }] });
  out.rendered = painted(shown, 96, 46, 208, 8);

  // 標註排在打碼**之後** —— 指著「這裡要改」的箭頭被馬賽克吃掉就白畫了。
  // 整張塗黑再畫一條綠框，看得到綠色才表示順序是對的
  const over = L.renderItem({
    ...item,
    redactions: [{ x: 0, y: 0, w: 1, h: 1, style: 'fill' }],
    annotations: [{ kind: 'box', x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75, color: '#00ff00', width: 0.02 }],
  });
  const d = over.getContext('2d').getImageData(0, 0, over.width, over.height).data;
  let green = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 60 && d[i + 1] > 200 && d[i + 2] < 60) green++;
  }
  out.aboveRedaction = green;

  // 標註跟裁切一樣在「看到的畫面」上：裁掉一半之後，同一組相對座標
  // 要落在裁切後的畫布上，而不是原圖的位置
  const cropped = L.renderItem({
    ...item, cropRect: { x: 0, y: 0, w: 0.5, h: 1 },
    annotations: [{ kind: 'box', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 }],
  });
  out.croppedSize = [cropped.width, cropped.height];
  out.croppedMark = painted(cropped, 36, 36, 130, 8);

  // 沒有標註的那條路徑要跟以前逐像素相同（不會有回歸）
  const plain = L.renderItem(item);
  const noneField = L.renderItem({ ...item, annotations: [] });
  const pa = plain.getContext('2d').getImageData(0, 0, 400, 200).data;
  const pb = noneField.getContext('2d').getImageData(0, 0, 400, 200).data;
  let diff = 0;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) diff++;
  out.noRegression = diff;
  return out;
});

check('新讀進來的圖片有一個空的標註陣列', marksItem.defaultEmpty, JSON.stringify(marksItem.defaultEmpty));
check('renderItem 會把標註畫進成品', marksItem.rendered > 100, `${marksItem.rendered} 點`);
check('標註疊在打碼之上，不會被遮蓋吃掉',
  marksItem.aboveRedaction > 200, `只有 ${marksItem.aboveRedaction} 個綠點`);
check('標註跟打碼一樣落在裁切後的畫面上',
  marksItem.croppedSize.join() === '200,200' && marksItem.croppedMark > 50,
  JSON.stringify([marksItem.croppedSize, marksItem.croppedMark]));
check('沒有標註時的輸出與改動前逐像素相同',
  marksItem.noRegression === 0, `差了 ${marksItem.noRegression} 個位元組`);

// ── 格子內的取景（縮放 + 對焦點）────────────────────────
console.log('\n格子內取景');

const framing = await page.evaluate(() => {
  const L = window.SMImageLocal;
  const box = { x: 0, y: 0, w: 100, h: 100 };

  // 沒動過取景時，回傳的幾何要跟舊行為一致 —— 這是「不會有回歸」的保證
  const coverDefault = L.fitBox(200, 100, box, 'cover', null);
  const containDefault = L.fitBox(200, 100, { x: 0, y: 0, w: 200, h: 100 }, 'contain', null);

  // cover + zoom=1：短邊剛好蓋滿，長邊溢出並置中
  const zoomed = L.fitBox(200, 100, box, 'cover', { zoom: 2, x: 0.5, y: 0.5 });
  // 對焦點往左 → 圖片往右移，但不能移到露出格子邊
  const leftFocus = L.fitBox(200, 100, box, 'cover', { zoom: 1, x: 0, y: 0.5 });
  const rightFocus = L.fitBox(200, 100, box, 'cover', { zoom: 1, x: 1, y: 0.5 });

  // 夾住：對焦點超出可動範圍時要被拉回來，不然手指會累積空行程
  const clampedFar = L.clampFit({ zoom: 1, x: 0, y: 0.5 }, box, { w: 200, h: 100 });
  const clampedZoom = L.clampFit({ zoom: 99, x: 0.5, y: 0.5 }, box, { w: 200, h: 100 });
  // 裝得下的方向沒有「對焦點」可言，一律回中心
  const clampedFits = L.clampFit({ zoom: 1, x: 0.2, y: 0.1 }, box, { w: 80, h: 80 });

  return {
    coverDefault, containDefault, zoomed, leftFocus, rightFocus,
    clampedFar, clampedZoom, clampedFits, maxZoom: L.MAX_ZOOM,
    isDefault: [L.isDefaultFit(null), L.isDefaultFit({ zoom: 1, x: 0.5, y: 0.5 }),
      L.isDefaultFit({ zoom: 1.5, x: 0.5, y: 0.5 }), L.isDefaultFit({ zoom: 1, x: 0.2, y: 0.5 })],
  };
});

// cover：100×100 的格子放 200×100 的圖 → 放大到高度剛好，寬度變 200，左右各溢出 50
check('cover 預設：短邊剛好蓋滿、長邊置中溢出',
  framing.coverDefault.w === 200 && framing.coverDefault.h === 100 &&
  framing.coverDefault.x === -50 && framing.coverDefault.y === 0,
  JSON.stringify(framing.coverDefault));
check('contain 預設：剛好填滿、不位移',
  framing.containDefault.w === 200 && framing.containDefault.h === 100 &&
  framing.containDefault.x === 0 && framing.containDefault.y === 0,
  JSON.stringify(framing.containDefault));
check('zoom 是相對「剛好填滿」的倍率', framing.zoomed.w === 400 && framing.zoomed.h === 200,
  JSON.stringify(framing.zoomed));
// 對焦點 0 = 看原圖最左邊 → 圖片要靠左對齊格子（x=0），而不是繼續往右跑
check('對焦點往左 → 露出原圖左緣，且不會拖出白邊',
  framing.leftFocus.x === 0, JSON.stringify(framing.leftFocus));
check('對焦點往右 → 露出原圖右緣，且不會拖出白邊',
  framing.rightFocus.x === -100, JSON.stringify(framing.rightFocus));

check('對焦點會被夾回實際可動的範圍',
  Math.abs(framing.clampedFar.x - 0.25) < 1e-6, JSON.stringify(framing.clampedFar));
check('縮放有上限', framing.clampedZoom.zoom === framing.maxZoom && framing.maxZoom > 1,
  JSON.stringify(framing.clampedZoom));
check('裝得下的方向沒有對焦點，一律回中心',
  framing.clampedFits.x === 0.5 && framing.clampedFits.y === 0.5,
  JSON.stringify(framing.clampedFits));
check('認得出「沒動過的取景」', JSON.stringify(framing.isDefault) === '[true,true,false,false]',
  JSON.stringify(framing.isDefault));

// 真的畫出來：動過取景之後，格子裡看到的內容要跟著換
const framedPixels = await page.evaluate(() => {
  // 左半紅、右半藍的來源圖
  const src = document.createElement('canvas');
  src.width = 200; src.height = 100;
  const sc = src.getContext('2d');
  sc.fillStyle = '#ff0000'; sc.fillRect(0, 0, 100, 100);
  sc.fillStyle = '#0000ff'; sc.fillRect(100, 0, 100, 100);

  const render = (fit) => {
    const c = document.createElement('canvas');
    c.width = 100; c.height = 100;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    window.SMImageLocal.drawCell(ctx, src, { x: 0, y: 0, w: 100, h: 100 }, {}, 'cover', fit);
    const d = ctx.getImageData(50, 50, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  };
  return {
    // 預設置中 → 正中央剛好落在紅藍交界，取樣點偏右一格避開接縫
    center: render(null),
    left: render({ zoom: 1, x: 0.15, y: 0.5 }),
    right: render({ zoom: 1, x: 0.85, y: 0.5 }),
  };
});

check('對焦點移到左邊 → 格子裡看到的是原圖左半（紅）',
  framedPixels.left.startsWith('255,'), framedPixels.left);
check('對焦點移到右邊 → 格子裡看到的是原圖右半（藍）',
  framedPixels.right.endsWith(',255'), framedPixels.right);

// ── 取景跟著旋轉 / 翻面走 ──────────────────────────────
console.log('\n取景跟著旋轉走');

const fitTransforms = await page.evaluate(() => {
  const L = window.SMImageLocal;
  const start = { zoom: 2.5, x: 0.2, y: 0.7 };

  // 對焦點就是一個沒有大小的裁切框，兩者的座標映射必須一致 ——
  // 不一致的話裁切框跟取景會在旋轉後各自跑到不同地方
  const agreesWithRect = [90, 180, 270, -90, 360].every((d) => {
    const asRect = L.rotateRect({ x: start.x, y: start.y, w: 0, h: 0 }, d);
    const asFit = L.rotateFit(start, d);
    return Math.abs(asRect.x - asFit.x) < 1e-9 && Math.abs(asRect.y - asFit.y) < 1e-9;
  });

  return {
    agreesWithRect,
    cw90: L.rotateFit(start, 90),
    round: L.rotateFit(L.rotateFit(L.rotateFit(L.rotateFit(start, 90), 90), 90), 90),
    ccw90: L.rotateFit(start, -90),
    noFit: [L.rotateFit(null, 90), L.flipFit(null, 'h')],
    // 沒填 x / y 的取景等同置中，不能算成 NaN
    partial: L.rotateFit({ zoom: 3 }, 90),
    flipH: L.flipFit(start, 'h'),
    flipV: L.flipFit(start, 'v'),
    flipTwice: L.flipFit(L.flipFit(start, 'h'), 'h'),
  };
});

check('旋轉對焦點跟裁切框用同一套座標映射',
  fitTransforms.agreesWithRect === true, JSON.stringify(fitTransforms.cw90));
// 順時針 90°：原圖左緣會轉到上緣，所以 (x, y) → (1 - y, x)
check('順時針 90°：(x, y) → (1 - y, x)',
  Math.abs(fitTransforms.cw90.x - 0.3) < 1e-9 && Math.abs(fitTransforms.cw90.y - 0.2) < 1e-9,
  JSON.stringify(fitTransforms.cw90));
check('轉四次回到原點', Math.abs(fitTransforms.round.x - 0.2) < 1e-9 &&
  Math.abs(fitTransforms.round.y - 0.7) < 1e-9, JSON.stringify(fitTransforms.round));
check('逆時針 90° 等同順時針 270°',
  Math.abs(fitTransforms.ccw90.x - 0.7) < 1e-9 && Math.abs(fitTransforms.ccw90.y - 0.8) < 1e-9,
  JSON.stringify(fitTransforms.ccw90));
check('縮放倍率跟方向無關，原封不動帶過去',
  fitTransforms.cw90.zoom === 2.5 && fitTransforms.flipH.zoom === 2.5,
  JSON.stringify([fitTransforms.cw90.zoom, fitTransforms.flipH.zoom]));
check('沒動過取景的圖不會被硬塞一個 fit',
  fitTransforms.noFit.every((v) => v === null), JSON.stringify(fitTransforms.noFit));
check('沒填對焦點時當作置中，不會算成 NaN',
  Math.abs(fitTransforms.partial.x - 0.5) < 1e-9 &&
  Math.abs(fitTransforms.partial.y - 0.5) < 1e-9 && fitTransforms.partial.zoom === 3,
  JSON.stringify(fitTransforms.partial));
check('水平翻面：對焦點換到對稱的另一側',
  Math.abs(fitTransforms.flipH.x - 0.8) < 1e-9 && fitTransforms.flipH.y === 0.7,
  JSON.stringify(fitTransforms.flipH));
check('垂直翻面：只動另一個軸',
  Math.abs(fitTransforms.flipV.y - 0.3) < 1e-9 && fitTransforms.flipV.x === 0.2,
  JSON.stringify(fitTransforms.flipV));
check('翻兩次回到原點', Math.abs(fitTransforms.flipTwice.x - 0.2) < 1e-9,
  JSON.stringify(fitTransforms.flipTwice));

// 真的畫出來：旋轉前後，格子中央看到的內容要是同一塊
const rotatedFraming = await page.evaluate(() => {
  const L = window.SMImageLocal;
  // 三條直帶（左紅、中綠、右藍）—— 兩色分不出「跟著轉」和「剛好停在接縫」
  const src = document.createElement('canvas');
  src.width = 240; src.height = 120;
  const sc = src.getContext('2d');
  [['#ff0000', 0], ['#00ff00', 80], ['#0000ff', 160]].forEach(([color, x]) => {
    sc.fillStyle = color; sc.fillRect(x, 0, 80, 120);
  });

  // 順時針轉 90°，畫法跟 renderItem 一致 —— 左邊那條紅帶會跑到最上面
  const rot = document.createElement('canvas');
  rot.width = 120; rot.height = 240;
  const rc = rot.getContext('2d');
  rc.translate(rot.width / 2, rot.height / 2);
  rc.rotate(Math.PI / 2);
  rc.drawImage(src, -src.width / 2, -src.height / 2);

  const sample = (img, fit) => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 120;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    L.drawCell(ctx, img, { x: 0, y: 0, w: 120, h: 120 }, {}, 'cover', fit);
    const d = ctx.getImageData(60, 60, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  };

  const before = { zoom: 1, x: 0.1, y: 0.5 };   // 對焦在最左邊的紅帶
  return {
    before: sample(src, before),
    after: sample(rot, L.rotateFit(before, 90)),
    stale: sample(rot, before),                 // 取景沒跟著轉會看到的東西
  };
});

check('旋轉前對焦在紅帶', rotatedFraming.before === '255,0,0', rotatedFraming.before);
check('旋轉後取景跟著走 → 格子中央還是同一塊（紅）',
  rotatedFraming.after === '255,0,0', rotatedFraming.after);
check('取景沒跟著轉的話構圖會飄掉（綠）—— 這是修掉的行為',
  rotatedFraming.stale === '0,255,0', rotatedFraming.stale);

// 拉正會把整張圖重新映射，舊的對焦點指到的不是同一塊內容了
const deskewFit = await page.evaluate(() => {
  const L = window.SMImageLocal;
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 40;
  // deskewItem 只用到 SMScanLite.warp，測這一段不需要真的跑透視校正
  window.SMScanLite = { warp: () => canvas };
  const item = {
    bitmap: canvas, preview: canvas,
    cropRect: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    fit: { zoom: 2, x: 0.2, y: 0.8 },
  };
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const deskewed = L.deskewItem(item, corners);
  return { after: deskewed.fit, reverted: L.undoDeskew(deskewed).fit };
});

check('拉正後取景歸零（跟裁切框一樣）', deskewFit.after === null, JSON.stringify(deskewFit));
check('還原拉正後取景也歸零', deskewFit.reverted === null, JSON.stringify(deskewFit));

// 即時取景拍下來的照片會帶著「快門當下抓到的框」，拉正畫面拿它當起點。
// 校正之後那個框指的是舊的那張圖 —— 留著的話再開一次拉正會照著它再切一刀
const deskewLive = await page.evaluate(() => {
  const L = window.SMImageLocal;
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 40;
  window.SMScanLite = { warp: () => canvas };
  const live = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }];
  const item = { bitmap: canvas, preview: canvas, cropRect: null, fit: null, liveCorners: live };
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const deskewed = L.deskewItem(item, corners);
  const reverted = L.undoDeskew(deskewed);
  return {
    after: deskewed.liveCorners,
    reverted: reverted.liveCorners && reverted.liveCorners[0],
  };
});
check('拉正後就不再沿用取景時的框', deskewLive.after === null, JSON.stringify(deskewLive.after));
check('還原成原圖後，取景時的框又對得上了',
  deskewLive.reverted && Math.abs(deskewLive.reverted.x - 0.1) < 1e-9,
  JSON.stringify(deskewLive.reverted));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
if (failed.length) {
  console.error(`\n${failed.length} 項失敗`);
  process.exit(1);
}
