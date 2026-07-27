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
    };
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

  /** 套用單張的裁切 / 縮放 / 旋轉 / 翻轉，回傳一張新的 canvas */
  function renderItem(item, { usePreview = false } = {}) {
    const base = cropToAspect(usePreview ? item.preview : item.bitmap, item.crop);
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
    out.ctx.translate(w / 2, h / 2);
    out.ctx.rotate((rotate * Math.PI) / 180);
    out.ctx.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    out.ctx.drawImage(src, -src.width / 2, -src.height / 2);
    return out.canvas;
  }

  /** 在指定方框內畫圖：contain 等比縮入（可能留白）、cover 裁切填滿 */
  function drawInBox(ctx, src, box, mode) {
    if (mode !== 'cover') {
      drawScaled(ctx, src, box.x, box.y, box.w, box.h);
      return;
    }
    const cropped = cropToAspect(src, box.w / box.h);
    drawScaled(ctx, cropped, box.x, box.y, box.w, box.h);
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
  function drawCell(ctx, src, box, frame = {}, fillMode = 'contain') {
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

    drawInBox(ctx, src, inner, fillMode);
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
    boxes.forEach((b, i) => drawCell(out.ctx, rendered[i], b, opts.frame, fillMode));
    return out.canvas;
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

    // 讓 UI 能算出點到哪一張
    const rendered = items.map((it) => renderItem(it, { usePreview: true }));
    const layout = layoutBoxes(rendered.map((c) => ({ w: c.width, h: c.height })), opts);
    return {
      width: w,
      height: h,
      scale: ratio,
      boxes: layout.boxes.map((b) => ({
        x: b.x * ratio, y: b.y * ratio, w: b.w * ratio, h: b.h * ratio,
      })),
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
    composeToBlob,
    previewInto,
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
