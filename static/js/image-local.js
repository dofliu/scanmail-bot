/**
 * ScanMail+ 本地圖片處理引擎
 *
 * 用 Canvas 在裝置上直接做縮放 / 轉檔 / 壓縮 / 拼接 / 旋轉 / 翻轉，
 * 完全不需要後端 —— 手機沒網路也能用，也不必把照片上傳出去。
 *
 * 版面與縮放語意刻意對齊後端的 app/services/image_batch.py，
 * 同一組參數在兩邊應該得到同樣的結果。已知的差異只有兩處，都寫在對應的註解裡：
 *   1. 輸出格式只支援 PNG / JPG / WebP（Canvas 的限制，BMP / GIF 編不出來）
 *   2. 透明圖轉 JPG 時填白底（Pillow 是直接丟掉 alpha，結果通常是黑底）
 */
(function () {
  // Canvas 只保證編得出這三種；toBlob 遇到不認得的 type 會「安靜地」吐 PNG，
  // 所以一定要先擋掉，不能讓使用者以為自己拿到了 BMP。
  const MIME = {
    PNG: 'image/png',
    JPG: 'image/jpeg',
    JPEG: 'image/jpeg',
    WEBP: 'image/webp',
  };
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

  const available = (() => {
    try {
      return typeof document !== 'undefined' &&
        !!document.createElement('canvas').getContext('2d') &&
        typeof createImageBitmap === 'function';
    } catch (e) {
      return false;
    }
  })();

  function mimeOf(format) {
    return MIME[String(format || 'JPG').toUpperCase()] || null;
  }

  function supportsOutput(format) {
    return !!mimeOf(format);
  }

  /** 'auto' 代表沿用來源格式（對齊後端 output_format='auto'）；不支援的來源退成 JPG */
  function resolveFormat(file, format) {
    const f = String(format || '').toUpperCase();
    if (f && f !== 'AUTO') return f;
    const type = (file && file.type) || '';
    if (type === 'image/png') return 'PNG';
    if (type === 'image/webp') return 'WEBP';
    return 'JPG';
  }

  // ══════════════════════════════════════════════
  //  解碼 / 編碼
  // ══════════════════════════════════════════════

  /** 解碼成 ImageBitmap，並依 EXIF 轉正（對齊後端的 ImageOps.exif_transpose） */
  async function decode(blob) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (e) {
      // 舊版 WebView 不支援 options，退回預設行為
      try {
        return await createImageBitmap(blob);
      } catch (e2) {
        throw new Error('無法讀取圖片（格式可能不支援）');
      }
    }
  }

  function newCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { canvas: c, ctx };
  }

  /**
   * 縮放繪製。
   * 一次把大圖直接畫成小圖，瀏覽器用的是雙線性取樣，縮很多倍時會糊掉、鋸齒明顯。
   * 先反覆對半縮到接近目標尺寸再畫最後一步，畫質接近後端的 LANCZOS。
   */
  function drawScaled(ctx, src, dx, dy, dw, dh) {
    dw = Math.max(1, Math.round(dw));
    dh = Math.max(1, Math.round(dh));

    let cur = src;
    let cw = src.width;
    let ch = src.height;
    while (cw >= dw * 2 && ch >= dh * 2 && cw > 2 && ch > 2) {
      const nw = Math.max(1, Math.floor(cw / 2));
      const nh = Math.max(1, Math.floor(ch / 2));
      const step = newCanvas(nw, nh);
      step.ctx.drawImage(cur, 0, 0, nw, nh);
      cur = step.canvas;
      cw = nw;
      ch = nh;
    }
    ctx.drawImage(cur, dx, dy, dw, dh);
  }

  function toBlob(canvas, format, quality) {
    const type = mimeOf(format);
    if (!type) {
      throw new Error(`本地處理不支援輸出 ${format} 格式，請改用 PNG / JPG / WebP`);
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('圖片編碼失敗'))),
        type,
        // PNG 沒有品質參數，傳了也會被忽略
        Math.min(1, Math.max(0.01, (quality == null ? 85 : quality) / 100))
      );
    });
  }

  /** JPG 不能有透明像素；先鋪底色再畫，避免透明區變成黑色 */
  function needsOpaqueBackground(format) {
    return mimeOf(format) === 'image/jpeg';
  }

  function fill(ctx, w, h, color) {
    ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  function renameTo(filename, format) {
    const type = mimeOf(format);
    const ext = EXT[type] || 'jpg';
    const stem = String(filename || 'image').replace(/\.[^.]+$/, '');
    return `${stem}.${ext}`;
  }

  // ══════════════════════════════════════════════
  //  單張操作
  // ══════════════════════════════════════════════

  /**
   * 縮放。
   * mode: 'fit'（等比縮小後置中填底，不放大）/ 'cover'（等比填滿後裁切）/ 'stretch'（強制拉伸）
   */
  async function resize(file, opts = {}) {
    const width = Math.max(1, Math.round(opts.width || 800));
    const height = Math.max(1, Math.round(opts.height || 600));
    const mode = opts.mode || 'fit';
    const format = resolveFormat(file, opts.format || 'JPG');
    const bg = opts.bgColor || '#ffffff';

    const img = await decode(file);
    let out;

    if (mode === 'cover') {
      // 等比放大/縮小到能蓋滿目標尺寸，再從中央裁切
      const ratio = Math.max(width / img.width, height / img.height);
      const sw = img.width * ratio;
      const sh = img.height * ratio;
      out = newCanvas(width, height);
      if (needsOpaqueBackground(format)) fill(out.ctx, width, height, bg);
      drawScaled(out.ctx, img, (width - sw) / 2, (height - sh) / 2, sw, sh);
    } else if (mode === 'stretch') {
      out = newCanvas(width, height);
      if (needsOpaqueBackground(format)) fill(out.ctx, width, height, bg);
      drawScaled(out.ctx, img, 0, 0, width, height);
    } else {
      // fit：對齊後端的 thumbnail() —— 只縮小不放大，小圖維持原尺寸置中
      const ratio = Math.min(width / img.width, height / img.height, 1);
      const sw = Math.max(1, Math.round(img.width * ratio));
      const sh = Math.max(1, Math.round(img.height * ratio));
      out = newCanvas(width, height);
      // fit 一定要鋪底色，否則留白處會是透明的
      fill(out.ctx, width, height, bg);
      drawScaled(out.ctx, img, (width - sw) / 2, (height - sh) / 2, sw, sh);
    }

    img.close && img.close();
    return { blob: await toBlob(out.canvas, format, opts.quality), filename: renameTo(file.name, format) };
  }

  /** 格式轉換 —— 尺寸不變，只重新編碼 */
  async function convert(file, opts = {}) {
    const format = resolveFormat(file, opts.format || 'PNG');
    const img = await decode(file);
    const out = newCanvas(img.width, img.height);
    if (needsOpaqueBackground(format)) fill(out.ctx, img.width, img.height, opts.bgColor || '#ffffff');
    out.ctx.drawImage(img, 0, 0);
    img.close && img.close();
    return { blob: await toBlob(out.canvas, format, opts.quality), filename: renameTo(file.name, format) };
  }

  /** 壓縮 —— 固定輸出 JPG，可另外限制最大邊長（只縮小不放大） */
  async function compress(file, opts = {}) {
    const maxDim = Math.max(0, Math.round(opts.maxDimension || 0));
    const img = await decode(file);

    let w = img.width;
    let h = img.height;
    if (maxDim > 0 && (w > maxDim || h > maxDim)) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }

    const out = newCanvas(w, h);
    fill(out.ctx, w, h, '#ffffff');
    drawScaled(out.ctx, img, 0, 0, w, h);
    img.close && img.close();
    return {
      blob: await toBlob(out.canvas, 'JPG', opts.quality == null ? 70 : opts.quality),
      filename: renameTo(file.name, 'JPG'),
    };
  }

  /** 旋轉 90 / 180 / 270 度（順時針） */
  async function rotate(file, opts = {}) {
    const angle = ((Math.round(opts.angle || 90) % 360) + 360) % 360;
    const format = resolveFormat(file, opts.format || 'auto');
    const img = await decode(file);

    const swap = angle === 90 || angle === 270;
    const w = swap ? img.height : img.width;
    const h = swap ? img.width : img.height;
    const out = newCanvas(w, h);
    if (needsOpaqueBackground(format)) fill(out.ctx, w, h, opts.bgColor || '#ffffff');

    out.ctx.translate(w / 2, h / 2);
    out.ctx.rotate((angle * Math.PI) / 180);
    out.ctx.drawImage(img, -img.width / 2, -img.height / 2);
    img.close && img.close();

    return { blob: await toBlob(out.canvas, format, opts.quality), filename: renameTo(file.name, format) };
  }

  /** 翻轉 axis: 'horizontal' | 'vertical' */
  async function flip(file, opts = {}) {
    const axis = opts.axis || 'horizontal';
    const format = resolveFormat(file, opts.format || 'auto');
    const img = await decode(file);

    const out = newCanvas(img.width, img.height);
    if (needsOpaqueBackground(format)) fill(out.ctx, img.width, img.height, opts.bgColor || '#ffffff');
    if (axis === 'vertical') {
      out.ctx.translate(0, img.height);
      out.ctx.scale(1, -1);
    } else {
      out.ctx.translate(img.width, 0);
      out.ctx.scale(-1, 1);
    }
    out.ctx.drawImage(img, 0, 0);
    img.close && img.close();

    return { blob: await toBlob(out.canvas, format, opts.quality), filename: renameTo(file.name, format) };
  }

  // ══════════════════════════════════════════════
  //  版面計算（拼接與編輯器共用）
  // ══════════════════════════════════════════════

  /**
   * 算出每張圖在拼接畫布上的位置與尺寸。
   * 這是拼接的唯一版面來源 —— 編輯器的即時預覽與最後匯出都走這裡，
   * 才不會出現「預覽跟存出來的不一樣」。
   *
   * 規則對齊後端 merge_images()：
   *   vertical   — normalize 時全部等比縮到「最小寬度」，畫布寬取最大寬
   *   horizontal — normalize 時全部等比縮到「最小高度」，畫布高取最大高
   *   grid       — 格子取所有圖的最大寬高，normalize 只把超出格子的縮小
   */
  function layoutBoxes(sizes, opts = {}) {
    const direction = (opts.direction || 'vertical').toLowerCase();
    const gap = Math.max(0, Math.round(opts.gap || 0));
    const align = opts.align || 'center';
    const normalize = opts.normalize !== false;
    const n = sizes.length;

    if (direction === 'horizontal') {
      let s = sizes;
      if (normalize) {
        const targetH = Math.min(...sizes.map((v) => v.h));
        s = sizes.map((v) => ({ w: Math.max(1, Math.round(v.w * targetH / v.h)), h: targetH }));
      }
      const height = Math.max(...s.map((v) => v.h));
      const width = s.reduce((a, v) => a + v.w, 0) + gap * (n - 1);
      let x = 0;
      const boxes = s.map((v) => {
        const y = align === 'start' ? 0 : align === 'end' ? height - v.h : Math.floor((height - v.h) / 2);
        const box = { x, y, w: v.w, h: v.h };
        x += v.w + gap;
        return box;
      });
      return { width, height, boxes };
    }

    if (direction === 'grid') {
      const cols = opts.columns && opts.columns > 0
        ? Math.round(opts.columns)
        : Math.max(1, Math.round(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      const cellW = Math.max(...sizes.map((v) => v.w));

      // cover：每一格大小完全相同，圖片裁切填滿 —— 「2×3 拼貼」該長的樣子。
      // contain（預設）：格子取最大寬高、圖片等比縮進去，留白露出底色，
      // 這是後端 merge_images() 的行為，維持相容。
      if (opts.fill === 'cover') {
        const avgAspect = sizes.reduce((a, v) => a + v.w / v.h, 0) / n;
        const cellH = Math.max(1, Math.round(cellW / avgAspect));
        return {
          width: cols * cellW + (cols - 1) * gap,
          height: rows * cellH + (rows - 1) * gap,
          boxes: sizes.map((_, i) => ({
            x: (i % cols) * (cellW + gap),
            y: Math.floor(i / cols) * (cellH + gap),
            w: cellW,
            h: cellH,
          })),
        };
      }

      const cellH = Math.max(...sizes.map((v) => v.h));
      const s = normalize
        ? sizes.map((v) => {
            const ratio = Math.min(cellW / v.w, cellH / v.h, 1);
            return ratio < 1
              ? { w: Math.max(1, Math.round(v.w * ratio)), h: Math.max(1, Math.round(v.h * ratio)) }
              : v;
          })
        : sizes;
      const width = cols * cellW + (cols - 1) * gap;
      const height = rows * cellH + (rows - 1) * gap;
      const boxes = s.map((v, i) => ({
        x: (i % cols) * (cellW + gap) + Math.floor((cellW - v.w) / 2),
        y: Math.floor(i / cols) * (cellH + gap) + Math.floor((cellH - v.h) / 2),
        w: v.w,
        h: v.h,
      }));
      return { width, height, boxes };
    }

    let s = sizes;
    if (normalize) {
      const targetW = Math.min(...sizes.map((v) => v.w));
      s = sizes.map((v) => ({ w: targetW, h: Math.max(1, Math.round(v.h * targetW / v.w)) }));
    }
    const width = Math.max(...s.map((v) => v.w));
    const height = s.reduce((a, v) => a + v.h, 0) + gap * (n - 1);
    let y = 0;
    const boxes = s.map((v) => {
      const x = align === 'start' ? 0 : align === 'end' ? width - v.w : Math.floor((width - v.w) / 2);
      const box = { x, y, w: v.w, h: v.h };
      y += v.h + gap;
      return box;
    });
    return { width, height, boxes };
  }

  // ══════════════════════════════════════════════
  //  拼接
  // ══════════════════════════════════════════════

  async function merge(files, opts = {}) {
    if (!files || !files.length) throw new Error('至少需要一張圖片');

    const format = opts.format || 'JPG';
    const bitmaps = [];
    for (const f of files) {
      try {
        bitmaps.push(await decode(f));
      } catch (e) {
        console.warn('[ImageLocal] 跳過無法讀取的圖片', f && f.name, e);
      }
    }
    if (!bitmaps.length) throw new Error('沒有可用的圖片');

    const sizes = bitmaps.map((b) => ({ w: b.width, h: b.height }));
    const { width, height, boxes } = layoutBoxes(sizes, opts);
    const out = newCanvas(width, height);
    fill(out.ctx, width, height, opts.bgColor);
    boxes.forEach((b, i) => drawScaled(out.ctx, bitmaps[i], b.x, b.y, b.w, b.h));
    bitmaps.forEach((b) => b.close && b.close());

    return {
      blob: await toBlob(out.canvas, format, opts.quality == null ? 90 : opts.quality),
      filename: renameTo('merged', format),
    };
  }

  // ══════════════════════════════════════════════
  //  編輯器：可即時預覽的變形 + 拼接
  // ══════════════════════════════════════════════

  // 預覽用的縮圖上限。原圖動輒 4000px，每按一次旋轉都重畫全解析度會卡；
  // 預覽走縮圖、只有匯出時才用原圖。
  const PREVIEW_MAX = 1400;

  /**
   * 讀進一張圖並附上預設的變形狀態。
   * bitmap 是原圖（匯出用），preview 是縮圖（即時預覽用）。
   */
  async function loadItem(file) {
    const bitmap = await decode(file);
    let preview = bitmap;
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > PREVIEW_MAX) {
      const ratio = PREVIEW_MAX / longest;
      const pw = Math.max(1, Math.round(bitmap.width * ratio));
      const ph = Math.max(1, Math.round(bitmap.height * ratio));
      const tmp = newCanvas(pw, ph);
      drawScaled(tmp.ctx, bitmap, 0, 0, pw, ph);
      preview = tmp.canvas;
    }
    return {
      name: (file && file.name) || 'image',
      type: (file && file.type) || '',
      bitmap,
      preview,
      rotate: 0,
      flipH: false,
      flipV: false,
      scale: 1,
      cropRect: null,
      adjust: null,
      redactions: [],
      // 格子內的取景（縮放 + 對焦點）—— 拼貼時才用得到
      fit: null,
    };
  }

  /** 從一張畫布 / 點陣圖重建縮圖預覽 */
  function previewOf(source) {
    const longest = Math.max(source.width, source.height);
    if (longest <= PREVIEW_MAX) return source;
    const ratio = PREVIEW_MAX / longest;
    const pw = Math.max(1, Math.round(source.width * ratio));
    const ph = Math.max(1, Math.round(source.height * ratio));
    const tmp = newCanvas(pw, ph);
    drawScaled(tmp.ctx, source, 0, 0, pw, ph);
    return tmp.canvas;
  }

  /**
   * 透視校正：把四邊形拉正成矩形，換掉這一張的原圖。
   *
   * 這一步是**破壞性**的（跟旋轉 / 裁切那些即時套用的不一樣）——
   * 拉正之後尺寸與內容都變了，原本存的裁切框座標也就沒有意義。
   * 所以順手把 cropRect 清掉，並把舊的原圖收在 original 裡供「還原」。
   *
   * 角點收 0–1 的相對座標，跟這個檔案其他地方一致：在縮圖上框，
   * 套用時用原圖重算，兩邊看到的是同一個結果。
   */
  function deskewItem(item, relCorners) {
    const scan = window.SMScanLite;
    if (!scan) throw new Error('缺少 scan-lite.js，無法拉正');
    if (!relCorners || relCorners.length !== 4) throw new Error('需要四個角');
    const base = item.bitmap;
    const abs = relCorners.map((p) => ({ x: p.x * base.width, y: p.y * base.height }));
    const corrected = scan.warp(base, abs);
    return {
      ...item,
      bitmap: corrected,
      preview: previewOf(corrected),
      cropRect: null,
      // 透視校正會把整張圖重新映射，舊的對焦點指到的已經不是同一塊內容 ——
      // 跟裁切框一樣歸零，讓拉正後的結果從「剛好填滿」重新開始構圖
      fit: null,
      // 即時取景拍下時記的那個框是「拉正之前」那張的座標，套用之後就不再對應
      // 任何東西了。留著的話再開一次拉正會拿它當起點，把已經正了的圖再切一刀
      liveCorners: null,
      // 只留第一次的原圖 —— 拉正兩次的話「還原」該回到最初，不是回到上一次
      original: item.original || {
        bitmap: item.bitmap, preview: item.preview, liveCorners: item.liveCorners || null,
      },
    };
  }

  /** 還原成拉正之前的樣子 */
  function undoDeskew(item) {
    if (!item.original) return item;
    const { original, ...rest } = item;
    return {
      ...rest, bitmap: original.bitmap, preview: original.preview, cropRect: null, fit: null,
      // 回到原圖，取景時的框自然又對得上了
      liveCorners: original.liveCorners || null,
    };
  }

  /**
   * 依矩形裁切。rect 用 0–1 的相對座標，這樣不管拿的是原圖還是縮圖都通用。
   * rect 為空代表不裁。
   */
  function cropToRect(src, rect) {
    if (!rect) return src;
    const x = Math.round(clamp01(rect.x) * src.width);
    const y = Math.round(clamp01(rect.y) * src.height);
    const w = Math.max(1, Math.round(Math.min(rect.w, 1 - clamp01(rect.x)) * src.width));
    const h = Math.max(1, Math.round(Math.min(rect.h, 1 - clamp01(rect.y)) * src.height));
    if (x === 0 && y === 0 && w === src.width && h === src.height) return src;
    const out = newCanvas(w, h);
    out.ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
    return out.canvas;
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));

  /**
   * 指定長寬比時，先給一個置中、盡量大的裁切框當起點。
   * 使用者再自己拖，所以這只是預設值不是最終值。ratio 為 0 代表整張。
   */
  function centeredRect(width, height, ratio) {
    if (!ratio || ratio <= 0) return null;
    const current = width / height;
    let w = 1;
    let h = 1;
    if (current > ratio) w = ratio / current;
    else h = current / ratio;
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  /** 依指定長寬比從中央裁切；ratio 為 0 / 空值代表不裁 */
  function cropToAspect(src, ratio) {
    if (!ratio || ratio <= 0) return src;
    const current = src.width / src.height;
    if (Math.abs(current - ratio) < 0.001) return src;

    let sw = src.width;
    let sh = src.height;
    if (current > ratio) sw = Math.max(1, Math.round(src.height * ratio));
    else sh = Math.max(1, Math.round(src.width / ratio));

    const out = newCanvas(sw, sh);
    out.ctx.drawImage(src, Math.round((src.width - sw) / 2), Math.round((src.height - sh) / 2),
      sw, sh, 0, 0, sw, sh);
    return out.canvas;
  }

  /**
   * 套用單張的縮放 / 旋轉 / 翻轉 / 裁切，回傳一張新的 canvas。
   *
   * 順序是「先轉再裁」：裁切框是使用者在畫面上拉的，而畫面上看到的是轉過的圖，
   * 所以 cropRect 存的是「轉正之後」的相對座標。反過來做會裁到別的地方。
   */
  function renderItem(item, { usePreview = false } = {}) {
    const base = usePreview ? item.preview : item.bitmap;
    const scale = item.scale == null ? 1 : item.scale;

    let src = base;
    if (scale !== 1) {
      const sw = Math.max(1, Math.round(base.width * scale));
      const sh = Math.max(1, Math.round(base.height * scale));
      const tmp = newCanvas(sw, sh);
      drawScaled(tmp.ctx, base, 0, 0, sw, sh);
      src = tmp.canvas;
    }

    const rotate = (((Math.round(item.rotate || 0) % 360) + 360) % 360);
    const swap = rotate === 90 || rotate === 270;
    const w = swap ? src.height : src.width;
    const h = swap ? src.width : src.height;

    const out = newCanvas(w, h);
    // 這一段的位移 / 旋轉只給這次繪製用；沒有 restore 的話，
    // 後面拿同一個 context 畫遮罩會整個跟著位移出去。
    out.ctx.save();
    out.ctx.translate(w / 2, h / 2);
    out.ctx.rotate((rotate * Math.PI) / 180);
    out.ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    // 調色交給瀏覽器的 filter —— 走的是 GPU，比自己逐像素算快得多
    out.ctx.filter = filterOf(item.adjust);
    out.ctx.drawImage(src, -src.width / 2, -src.height / 2);
    out.ctx.restore();

    const cropped = cropToRect(out.canvas, item.cropRect);
    // 打碼排在裁切之後：使用者是在「看到的畫面」上框的
    return applyRedactions(cropped, item.redactions);
  }

  /**
   * 色彩調整 → CSS filter 字串。
   * 值都用「1 = 原樣」的倍率，跟 CSS 的慣例一致。
   */
  function filterOf(adjust) {
    if (!adjust) return 'none';
    const parts = [];
    const num = (v, base) => (v == null ? base : v);
    if (num(adjust.brightness, 1) !== 1) parts.push(`brightness(${adjust.brightness})`);
    if (num(adjust.contrast, 1) !== 1) parts.push(`contrast(${adjust.contrast})`);
    if (num(adjust.saturate, 1) !== 1) parts.push(`saturate(${adjust.saturate})`);
    if (adjust.grayscale) parts.push(`grayscale(${adjust.grayscale})`);
    if (adjust.sepia) parts.push(`sepia(${adjust.sepia})`);
    if (adjust.blur) parts.push(`blur(${adjust.blur}px)`);
    if (adjust.hue) parts.push(`hue-rotate(${adjust.hue}deg)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  /**
   * 打碼。分享文件截圖前把個資遮掉 —— 這件事本來就不該把圖傳上網才做得到。
   *
   * 三種都是「不可逆」的：直接把像素改掉，不是蓋一層可以移除的東西。
   * 區域用 0–1 的相對座標，所以縮圖預覽與原圖匯出會落在同一個位置。
   */
  function applyRedactions(canvas, redactions) {
    if (!redactions || !redactions.length) return canvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    const W = canvas.width;
    const H = canvas.height;

    for (const r of redactions) {
      const x = Math.max(0, Math.round(r.x * W));
      const y = Math.max(0, Math.round(r.y * H));
      const w = Math.min(W - x, Math.round(r.w * W));
      const h = Math.min(H - y, Math.round(r.h * H));
      if (w < 1 || h < 1) continue;

      if (r.style === 'fill') {
        ctx.save();
        ctx.filter = 'none';
        ctx.fillStyle = r.color || '#000000';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        continue;
      }

      if (r.style === 'blur') {
        // 模糊會往外吃周邊像素，只取選區的話邊緣會透出半透明。
        // 解法是連周邊一起取樣，模糊完再裁回中心。
        const pad = Math.max(4, Math.round(Math.min(w, h) / 4));
        const sx = Math.max(0, x - pad);
        const sy = Math.max(0, y - pad);
        const sw = Math.min(W - sx, w + pad * 2);
        const sh = Math.min(H - sy, h + pad * 2);
        const tmp = newCanvas(sw, sh);
        tmp.ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.filter = `blur(${Math.max(3, Math.round(Math.min(w, h) / 8))}px)`;
        ctx.drawImage(tmp.canvas, sx, sy, sw, sh);
        ctx.restore();
        continue;
      }

      // 馬賽克：縮到很小再放大回來，關掉平滑才會是方格而不是糊成一片
      const cells = Math.max(3, Math.round(r.cells || 12));
      const tw = Math.max(1, Math.min(cells, w));
      const th = Math.max(1, Math.round((tw * h) / w) || 1);
      const small = newCanvas(tw, th);
      small.ctx.imageSmoothingEnabled = false;
      small.ctx.drawImage(canvas, x, y, w, h, 0, 0, tw, th);
      ctx.save();
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small.canvas, 0, 0, tw, th, x, y, w, h);
      ctx.restore();
    }
    return canvas;
  }

  /**
   * 轉圖的時候裁切框要跟著轉，不然「轉一下」會讓已經裁好的範圍飄到別的地方。
   * delta 是順時針角度（90 的倍數）。
   */
  function rotateRect(rect, delta) {
    if (!rect) return null;
    let r = { ...rect };
    let times = ((Math.round(delta / 90) % 4) + 4) % 4;
    while (times--) r = { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    return r;
  }

  function flipRect(rect, axis) {
    if (!rect) return null;
    return axis === 'h'
      ? { ...rect, x: 1 - rect.x - rect.w }
      : { ...rect, y: 1 - rect.y - rect.h };
  }

  /**
   * 格子內的取景也要跟著轉，理由跟裁切框一樣：對焦點是「原圖上的哪一點」，
   * 圖轉了它就落到別的內容上，調好的構圖會在按下旋轉的瞬間跳掉。
   * 座標映射沿用 rotateRect 那一套 —— 順時針 90° 時 (x, y) → (1 - y, x)。
   * zoom 是「相對於剛好填滿格子」的倍率，跟方向無關，原封不動帶過去。
   */
  function rotateFit(fit, delta) {
    if (!fit) return null;
    let f = { ...fit };
    let times = ((Math.round(delta / 90) % 4) + 4) % 4;
    while (times--) {
      const x = f.x == null ? 0.5 : f.x;
      const y = f.y == null ? 0.5 : f.y;
      f = { ...f, x: 1 - y, y: x };
    }
    return f;
  }

  /** 鏡射同理：翻面之後對焦點要換到對稱的另一側 */
  function flipFit(fit, axis) {
    if (!fit) return null;
    return axis === 'h'
      ? { ...fit, x: 1 - (fit.x == null ? 0.5 : fit.x) }
      : { ...fit, y: 1 - (fit.y == null ? 0.5 : fit.y) };
  }

  /** 在指定方框內畫圖：contain 等比縮入（可能留白）、cover 裁切填滿 */
  /** 沒有動過的取景 —— 剛好填滿、對齊中心 */
  const DEFAULT_FIT = { zoom: 1, x: 0.5, y: 0.5 };

  function isDefaultFit(fit) {
    if (!fit) return true;
    const z = fit.zoom == null ? 1 : fit.zoom;
    const x = fit.x == null ? 0.5 : fit.x;
    const y = fit.y == null ? 0.5 : fit.y;
    return Math.abs(z - 1) < 1e-4 && Math.abs(x - 0.5) < 1e-4 && Math.abs(y - 0.5) < 1e-4;
  }

  /**
   * 算出「這張圖要用多大、畫在哪」才能讓取景成立。
   *
   * fit.zoom 是相對於「剛好填滿格子」的倍率；fit.x / fit.y 是原圖上的
   * 對焦點（0–1），那個點會被擺到格子正中央。
   *
   * 位置會被夾住，讓圖片至少蓋滿格子 —— 拖過頭跑出白邊比拖不動更難用。
   */
  function fitBox(srcW, srcH, box, mode, fit) {
    const zoom = Math.max(1, (fit && fit.zoom) || 1);
    const fx = fit && fit.x != null ? clamp01(fit.x) : 0.5;
    const fy = fit && fit.y != null ? clamp01(fit.y) : 0.5;
    const base = mode === 'cover'
      ? Math.max(box.w / srcW, box.h / srcH)
      : Math.min(box.w / srcW, box.h / srcH);
    const scale = base * zoom;
    const dw = srcW * scale;
    const dh = srcH * scale;

    const place = (boxPos, boxLen, drawLen, focal) => {
      if (drawLen <= boxLen) return boxPos + (boxLen - drawLen) / 2;  // 裝得下就置中
      const want = boxPos + boxLen / 2 - focal * drawLen;
      return Math.min(boxPos, Math.max(boxPos + boxLen - drawLen, want));
    };
    return { x: place(box.x, box.w, dw, fx), y: place(box.y, box.h, dh, fy), w: dw, h: dh };
  }

  /** 縮放上限。再放大下去就是看馬賽克了，而且手指很容易一滑就飛掉 */
  const MAX_ZOOM = 6;

  /**
   * 把取景參數夾回「有意義」的範圍。
   *
   * 對焦點若超過會讓圖片露出格子邊，`fitBox` 會把位置夾住 —— 但如果不同時
   * 把對焦點本身也夾住，手指就會累積一堆「拖了卻不動」的空行程，
   * 回拖時要先把那段還回來，感覺像卡住。
   */
  function clampFit(fit, box, draw) {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, (fit && fit.zoom) || 1));
    const axis = (value, boxLen, drawLen) => {
      if (!(drawLen > boxLen)) return 0.5;      // 裝得下 → 對焦點沒有意義
      const half = boxLen / 2 / drawLen;
      return Math.min(1 - half, Math.max(half, value == null ? 0.5 : value));
    };
    return {
      zoom,
      x: axis(fit && fit.x, box.w, draw.w),
      y: axis(fit && fit.y, box.h, draw.h),
    };
  }

  function drawInBox(ctx, src, box, mode, fit) {
    // 沒動過取景就走原本的路，一個像素都不會變
    if (isDefaultFit(fit)) {
      if (mode !== 'cover') {
        drawScaled(ctx, src, box.x, box.y, box.w, box.h);
        return;
      }
      const cropped = cropToAspect(src, box.w / box.h);
      drawScaled(ctx, cropped, box.x, box.y, box.w, box.h);
      return;
    }
    const r = fitBox(src.width, src.height, box, mode, fit);
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    drawScaled(ctx, src, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function roundedPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /**
   * 畫一格（圖片 + 圖框）。
   * 圖框一律往方框「內」縮，不往外長 —— 否則會超出 layoutBoxes 算好的版面。
   */
  function drawCell(ctx, src, box, frame = {}, fillMode = 'contain', fit = null) {
    const style = frame.style || 'none';
    const color = frame.color || '#ffffff';
    const unit = Math.min(box.w, box.h);
    const pad = Math.round(unit * (frame.width == null ? 0 : frame.width) / 100);
    const radius = Math.round(unit * (frame.radius == null ? 0 : frame.radius) / 100);

    // 拍立得：下緣特別厚，模仿相紙
    const bottomExtra = style === 'polaroid' ? Math.round(pad * 2.2) : 0;
    const inner = {
      x: box.x + pad,
      y: box.y + pad,
      w: Math.max(1, box.w - pad * 2),
      h: Math.max(1, box.h - pad * 2 - bottomExtra),
    };

    ctx.save();

    if (style === 'shadow') {
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = Math.max(2, Math.round(unit * 0.04));
      ctx.shadowOffsetY = Math.max(1, Math.round(unit * 0.015));
    }

    // 有底的圖框先鋪一塊底板
    if (style === 'card' || style === 'polaroid' || style === 'shadow') {
      ctx.fillStyle = color;
      if (radius > 0) { roundedPath(ctx, box.x, box.y, box.w, box.h, radius); ctx.fill(); }
      else ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.shadowColor = 'transparent';

    // 圓角要裁切影像本身
    if (radius > 0 && style !== 'card' && style !== 'polaroid' && style !== 'shadow') {
      roundedPath(ctx, inner.x, inner.y, inner.w, inner.h, radius);
      ctx.clip();
    } else if (radius > 0) {
      roundedPath(ctx, inner.x, inner.y, inner.w, inner.h, Math.max(0, radius - pad));
      ctx.clip();
    }

    drawInBox(ctx, src, inner, fillMode, fit);
    ctx.restore();

    // 細邊：畫在影像邊緣上
    if (style === 'line') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.round(unit * 0.012));
      const half = ctx.lineWidth / 2;
      if (radius > 0) {
        roundedPath(ctx, inner.x + half, inner.y + half, inner.w - ctx.lineWidth, inner.h - ctx.lineWidth, radius);
        ctx.stroke();
      } else {
        ctx.strokeRect(inner.x + half, inner.y + half, inner.w - ctx.lineWidth, inner.h - ctx.lineWidth);
      }
      ctx.restore();
    }
  }

  /** 把一組已編輯的項目排版成一張 canvas */
  /**
   * 濾鏡預設。「文件」那組是掃描紙本用的 —— 泛黃的紙拉成乾淨的黑白，
   * 比原樣拍出來好認很多，也小很多。
   */
  const ADJUST_PRESETS = [
    { id: 'none',  label: '原圖', adjust: null },
    { id: 'vivid', label: '鮮豔', adjust: { saturate: 1.35, contrast: 1.12 } },
    { id: 'soft',  label: '柔和', adjust: { saturate: 0.85, brightness: 1.06, contrast: 0.94 } },
    { id: 'mono',  label: '黑白', adjust: { grayscale: 1, contrast: 1.08 } },
    { id: 'retro', label: '復古', adjust: { sepia: 0.45, saturate: 0.9, contrast: 1.05 } },
    { id: 'cool',  label: '冷色', adjust: { hue: -12, saturate: 1.1 } },
    { id: 'warm',  label: '暖色', adjust: { hue: 12, saturate: 1.08, brightness: 1.03 } },
    { id: 'paper', label: '紙本', adjust: { grayscale: 1, contrast: 1.7, brightness: 1.18 } },
  ];

  /**
   * 文字圖層 / 平鋪浮水印。
   *
   * 字型直接用系統的 —— 畫在 canvas 上不必像 PDF 那樣把字型嵌進檔案，
   * 所以中文不用額外成本。
   *
   * 位置與字級都用相對值（0–1、相對於短邊），縮圖預覽和原圖匯出才會長得一樣。
   */
  function drawTexts(canvas, texts) {
    if (!texts || !texts.length) return canvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = canvas.width;
    const H = canvas.height;
    const unit = Math.min(W, H);

    for (const t of texts) {
      const lines = String(t.text == null ? '' : t.text).split('\n');
      if (!lines.join('').trim()) continue;

      const px = Math.max(8, Math.round((t.size == null ? 0.07 : t.size) * unit));
      const lead = px * 1.25;
      ctx.save();
      ctx.filter = 'none';
      ctx.globalAlpha = t.opacity == null ? 1 : Math.max(0.02, Math.min(1, t.opacity));
      ctx.font = `${t.weight || 700} ${px}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;

      // 描邊讓文字在任何底色上都看得見 —— 白字壓在白紙上就是看不到
      const strokeWidth = t.stroke ? px * t.stroke : 0;
      const paint = (str, x, y) => {
        if (strokeWidth > 0) {
          ctx.lineWidth = strokeWidth;
          ctx.strokeStyle = t.strokeColor || '#000000';
          ctx.strokeText(str, x, y);
        }
        ctx.fillStyle = t.color || '#ffffff';
        ctx.fillText(str, x, y);
      };
      const block = (cx, cy, align) => {
        ctx.textAlign = align;
        const top = cy - ((lines.length - 1) * lead) / 2;
        lines.forEach((line, i) => paint(line, cx, top + i * lead));
      };

      if (t.tile) {
        // 平鋪浮水印：旋轉整個座標系，畫滿到對角線長度，四邊都不會缺角
        const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), px);
        const gapX = widest + unit * (t.gap == null ? 0.12 : t.gap);
        const gapY = lead * lines.length + unit * (t.gap == null ? 0.12 : t.gap);
        const reach = Math.hypot(W, H) / 2 + Math.max(gapX, gapY);
        ctx.translate(W / 2, H / 2);
        ctx.rotate(((t.rotate == null ? -30 : t.rotate) * Math.PI) / 180);
        for (let y = -reach; y <= reach; y += gapY) {
          for (let x = -reach; x <= reach; x += gapX) block(x, y, 'center');
        }
      } else {
        const x = (t.x == null ? 0.5 : t.x) * W;
        const y = (t.y == null ? 0.9 : t.y) * H;
        ctx.translate(x, y);
        if (t.rotate) ctx.rotate((t.rotate * Math.PI) / 180);
        block(0, 0, t.align || 'center');
      }
      ctx.restore();
    }
    return canvas;
  }

  /**
   * 簽名 / 印章圖層。
   *
   * 位置與大小都存相對值（0–1，相對於整張成品），高度由簽名自己的長寬比推得
   * —— 簽名被拉扁就不像本人的字了。
   */
  function drawSignatures(canvas, signatures) {
    if (!signatures || !signatures.length) return canvas;
    const sign = window.SMSignLite;
    if (!sign) return canvas;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const W = canvas.width;
    const H = canvas.height;

    for (const s of signatures) {
      if (!s || !s.sig) continue;
      const w = Math.max(1, (s.w == null ? 0.3 : s.w) * W);
      const h = w / (s.sig.aspect || 1);
      sign.drawInto(ctx, s.sig, {
        x: (s.x == null ? 0.5 : s.x) * W - w / 2,
        y: (s.y == null ? 0.8 : s.y) * H - h / 2,
        w, h,
      }, { opacity: s.opacity, rotate: s.rotate, color: s.color });
    }
    return canvas;
  }

  function composeToCanvas(items, opts = {}, renderOpts = {}) {
    if (!items || !items.length) throw new Error('至少需要一張圖片');
    const rendered = items.map((it) => renderItem(it, renderOpts));
    const sizes = rendered.map((c) => ({ w: c.width, h: c.height }));
    const { width, height, boxes } = layoutBoxes(sizes, opts);
    const out = newCanvas(width, height);
    // 單張且沒有圖框時不鋪底色，才不會把透明背景蓋掉
    const hasFrame = opts.frame && opts.frame.style && opts.frame.style !== 'none';
    if (items.length > 1 || hasFrame || needsOpaqueBackground(opts.format || 'JPG')) {
      fill(out.ctx, width, height, opts.bgColor);
    }
    const fillMode = opts.fill === 'cover' ? 'cover' : 'contain';
    boxes.forEach((b, i) => drawCell(out.ctx, rendered[i], b, opts.frame, fillMode, items[i].fit));
    // 文字與簽名疊在最上面，位置是相對整張成品而不是某一格。
    // 簽名畫在文字之上 —— 簽名是最後蓋的那一道。
    drawTexts(out.canvas, opts.texts);
    return drawSignatures(out.canvas, opts.signatures);
  }

  /** 匯出：用原圖重算一次，輸出檔案 */
  async function composeToBlob(items, opts = {}) {
    const format = opts.format || 'JPG';
    const canvas = composeToCanvas(items, { ...opts, format }, { usePreview: false });
    const base = items.length === 1 ? String(items[0].name || 'image').replace(/\.[^.]+$/, '') : 'merged';
    return {
      blob: await toBlob(canvas, format, opts.quality == null ? 92 : opts.quality),
      filename: renameTo(base, format),
    };
  }

  /** 即時預覽：用縮圖排版後畫進畫面上的 canvas，回傳每張圖的實際顯示位置 */
  function previewInto(targetCanvas, items, opts = {}, maxSize = 1024) {
    const composed = composeToCanvas(items, opts, { usePreview: true });
    const ratio = Math.min(maxSize / composed.width, maxSize / composed.height, 1);
    const w = Math.max(1, Math.round(composed.width * ratio));
    const h = Math.max(1, Math.round(composed.height * ratio));
    targetCanvas.width = w;
    targetCanvas.height = h;
    const ctx = targetCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(composed, 0, 0, w, h);

    // 讓 UI 能算出點到哪一張。另外附上「圖片實際被畫成多大」——
    // 手指拖幾個像素要換算成對焦點移動多少，需要這個數字。
    const rendered = items.map((it) => renderItem(it, { usePreview: true }));
    const layout = layoutBoxes(rendered.map((c) => ({ w: c.width, h: c.height })), opts);
    const fillMode = opts.fill === 'cover' ? 'cover' : 'contain';
    return {
      width: w,
      height: h,
      scale: ratio,
      boxes: layout.boxes.map((b, i) => {
        const drawn = fitBox(rendered[i].width, rendered[i].height, b, fillMode, items[i].fit);
        return {
          x: b.x * ratio, y: b.y * ratio, w: b.w * ratio, h: b.h * ratio,
          draw: { x: drawn.x * ratio, y: drawn.y * ratio, w: drawn.w * ratio, h: drawn.h * ratio },
        };
      }),
    };
  }

  // ══════════════════════════════════════════════
  //  轉換：縮放 + 壓縮 + 格式一次做完
  // ══════════════════════════════════════════════

  /**
   * 把縮放、壓縮、轉檔合成單一步驟 —— 這三件事本來就是同一次重新編碼，
   * 拆成三個功能只是逼使用者跑三趟、每跑一趟就多損失一次畫質。
   *
   * opts: { maxDimension, width, height, mode, format, quality, bgColor }
   *   maxDimension > 0 → 限制長邊（只縮不放）
   *   width/height + mode → 指定畫布尺寸（fit / cover / stretch）
   *   兩者都沒給就維持原尺寸，只重新編碼
   */
  async function transform(file, opts = {}) {
    const format = resolveFormat(file, opts.format || 'auto');
    if (opts.width && opts.height && opts.mode) {
      return resize(file, { ...opts, format });
    }

    const maxDim = Math.max(0, Math.round(opts.maxDimension || 0));
    const img = await decode(file);
    let w = img.width;
    let h = img.height;
    if (maxDim > 0 && (w > maxDim || h > maxDim)) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }

    const out = newCanvas(w, h);
    if (needsOpaqueBackground(format)) fill(out.ctx, w, h, opts.bgColor || '#ffffff');
    drawScaled(out.ctx, img, 0, 0, w, h);
    img.close && img.close();
    return {
      blob: await toBlob(out.canvas, format, opts.quality == null ? 85 : opts.quality),
      filename: renameTo(file.name, format),
    };
  }

  // ══════════════════════════════════════════════
  //  批次
  // ══════════════════════════════════════════════

  const OPS = { resize, convert, compress, rotate, flip, transform };

  /**
   * 對多個檔案跑同一個操作，回傳結果陣列。
   * 每張之間讓出主執行緒，避免大批圖片處理時畫面整個凍住。
   */
  async function batch(op, files, opts = {}, onProgress) {
    const fn = OPS[op];
    if (!fn) throw new Error(`不支援的操作：${op}`);

    const results = [];
    for (let i = 0; i < files.length; i++) {
      if (onProgress) {
        onProgress(Math.round((i / files.length) * 100), `處理中 (${i + 1}/${files.length})`);
      }
      results.push(await fn(files[i], opts));
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(100, '完成！');
    return results;
  }

  // ══════════════════════════════════════════════
  //  給 UI 用的轉接層
  // ══════════════════════════════════════════════

  /**
   * 依圖片工具的 action / opts 產生 ToolProcessor 的 local 執行函式。
   * 回傳 null 代表這個組合在本地做不到（不支援的操作，或要輸出 BMP / GIF），
   * UI 可以據此決定隱藏或退回後端。
   */
  function runner(action, opts = {}) {
    if (!available) return null;

    const format = opts.format || 'JPEG';
    const quality = opts.quality;

    if (action === 'merge') {
      if (!supportsOutput(format)) return null;
      return async (files, onProgress) => {
        if (onProgress) onProgress(30, `拼接 ${files.length} 張圖片...`);
        const out = await merge(files, {
          direction: opts.direction,
          gap: opts.gap,
          bgColor: opts.bg_color,
          align: opts.align || 'center',
          columns: opts.columns,
          normalize: opts.normalize,
          format,
          quality: quality == null ? 90 : quality,
        });
        if (onProgress) onProgress(100, '完成！');
        return [out];
      };
    }

    const perFile = {
      resize: { width: opts.width, height: opts.height, mode: opts.mode, format, quality, bgColor: opts.bg_color },
      convert: { format, quality },
      compress: { quality, maxDimension: opts.maxDimension || 0 },
      rotate: { angle: opts.angle, format: 'auto', quality },
      flip: { axis: opts.flipAxis || opts.axis, format: 'auto', quality },
    }[action];

    if (!perFile) return null;
    // compress / rotate / flip 的輸出格式由來源決定，不受這裡的 format 影響
    if ((action === 'resize' || action === 'convert') && !supportsOutput(format)) return null;

    return (files, onProgress) => batch(action, files, perFile, onProgress);
  }

  // ══════════════════════════════════════════════
  //  圖片 → PDF
  // ══════════════════════════════════════════════

  const PDF_PAGES = { A4: 'A4', A5: 'A5', LETTER: 'LETTER' };

  /**
   * 取得可以塞進 PDF 的 JPEG 位元組。
   *
   * 能原樣沿用就沿用 —— PDF 的 /DCTDecode 吃的就是 JPEG 原始位元組，
   * 手機拍的照片多半可以完全不解碼、不重新編碼地放進去，畫質一點都不掉。
   * 只有在格式不合（漸進式 / CMYK / PNG）或需要縮小時才重新編碼。
   */
  async function jpegBytesFor(source, opts = {}) {
    const maxDimension = opts.maxDimension || 0;
    const quality = opts.quality == null ? 88 : opts.quality;

    if (source instanceof Blob && window.SMPDFWriter) {
      const raw = new Uint8Array(await source.arrayBuffer());
      const info = window.SMPDFWriter.readJpeg(raw);
      if (info && info.embeddable) {
        const longest = Math.max(info.width, info.height);
        if (!maxDimension || longest <= maxDimension) return { bytes: raw, reused: true };
      }
    }

    let src = source instanceof Blob ? await decode(source) : source;
    let w = src.width;
    let h = src.height;
    if (maxDimension && Math.max(w, h) > maxDimension) {
      const ratio = maxDimension / Math.max(w, h);
      w = Math.max(1, Math.round(w * ratio));
      h = Math.max(1, Math.round(h * ratio));
    }
    // JPEG 沒有透明度，先鋪白底免得透明區變黑
    const out = newCanvas(w, h);
    fill(out.ctx, w, h, '#ffffff');
    drawScaled(out.ctx, src, 0, 0, w, h);
    const blob = await toBlob(out.canvas, 'JPG', quality);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), reused: false };
  }

  /**
   * 多張圖 → 一份多頁 PDF。
   *
   * @param {Array<Blob|HTMLCanvasElement>} sources
   * @param {{pageSize, landscape, margin, quality, maxDimension}} opts
   *        pageSize 'fit' 代表頁面貼合照片比例（不留白邊）
   */
  async function imagesToPdf(sources, opts = {}, onProgress) {
    if (!window.SMPDFWriter) throw new Error('缺少 PDF 模組');
    if (!sources || !sources.length) throw new Error('沒有可以轉換的圖片');

    const fitPage = String(opts.pageSize || 'A4').toLowerCase() === 'fit';
    const doc = window.SMPDFWriter.create({
      size: fitPage ? 'A4' : opts.pageSize || 'A4',
      landscape: !!opts.landscape,
    });
    const margin = fitPage ? 0 : (opts.margin == null ? 28 : opts.margin);
    let reusedCount = 0;

    for (let i = 0; i < sources.length; i++) {
      if (onProgress) onProgress(Math.round((i / sources.length) * 95), `處理第 ${i + 1}/${sources.length} 張`);
      const { bytes, reused } = await jpegBytesFor(sources[i], opts);
      if (reused) reusedCount++;
      const img = doc.useImage(bytes);

      if (fitPage) {
        doc.addPage({ width: img.width, height: img.height });
        doc.drawImage(img, 0, 0, img.width, img.height);
        continue;
      }

      doc.addPage();
      const boxW = doc.width - margin * 2;
      const boxH = doc.height - margin * 2;
      // 等比縮入頁面，置中；只縮不放，小圖不會被拉糊
      const scale = Math.min(boxW / img.width, boxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.drawImage(img, margin + (boxW - w) / 2, margin + (boxH - h) / 2, w, h);
    }

    if (onProgress) onProgress(98, '組合 PDF');
    const blob = await doc.toBlob({ title: opts.title || '' });
    return { blob, pages: sources.length, reused: reusedCount };
  }

  window.SMImageLocal = {
    available,
    runner,
    // 編輯器
    loadItem,
    renderItem,
    layoutBoxes,
    composeToCanvas,
    drawCell,
    cropToAspect,
    cropToRect,
    centeredRect,
    rotateRect,
    flipRect,
    rotateFit,
    flipFit,
    filterOf,
    applyRedactions,
    drawTexts,
    drawSignatures,
    fitBox,
    clampFit,
    isDefaultFit,
    DEFAULT_FIT,
    MAX_ZOOM,
    deskewItem,
    undoDeskew,
    previewOf,
    ADJUST_PRESETS,
    composeToBlob,
    previewInto,
    jpegBytesFor,
    imagesToPdf,
    PDF_PAGES,
    // 轉換三合一
    transform,
    supportsOutput,
    resize,
    convert,
    compress,
    rotate,
    flip,
    merge,
    batch,
  };
})();
