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
  //  拼接
  // ══════════════════════════════════════════════

  /**
   * 把多張圖拼成一張。版面規則對齊後端 merge_images()：
   *   vertical   — normalize 時全部等比縮到「最小寬度」，畫布寬取最大寬
   *   horizontal — normalize 時全部等比縮到「最小高度」，畫布高取最大高
   *   grid       — 格子大小取所有圖的最大寬高，normalize 只把超出格子的縮小
   */
  async function merge(files, opts = {}) {
    if (!files || !files.length) throw new Error('至少需要一張圖片');

    const direction = (opts.direction || 'vertical').toLowerCase();
    const gap = Math.max(0, Math.round(opts.gap || 0));
    const align = opts.align || 'center';
    const format = opts.format || 'JPG';
    const bg = opts.bgColor || '#ffffff';
    const normalize = opts.normalize !== false;

    const bitmaps = [];
    for (const f of files) {
      try {
        bitmaps.push(await decode(f));
      } catch (e) {
        console.warn('[ImageLocal] 跳過無法讀取的圖片', f && f.name, e);
      }
    }
    if (!bitmaps.length) throw new Error('沒有可用的圖片');

    // 每張圖在畫布上的目標尺寸
    let sizes = bitmaps.map((b) => ({ w: b.width, h: b.height }));
    let out;

    if (direction === 'horizontal') {
      if (normalize) {
        const targetH = Math.min(...sizes.map((s) => s.h));
        sizes = sizes.map((s) => ({ w: Math.max(1, Math.round(s.w * targetH / s.h)), h: targetH }));
      }
      const maxH = Math.max(...sizes.map((s) => s.h));
      const totalW = sizes.reduce((a, s) => a + s.w, 0) + gap * (sizes.length - 1);
      out = newCanvas(totalW, maxH);
      fill(out.ctx, totalW, maxH, bg);
      let x = 0;
      sizes.forEach((s, i) => {
        const y = align === 'start' ? 0 : align === 'end' ? maxH - s.h : Math.floor((maxH - s.h) / 2);
        drawScaled(out.ctx, bitmaps[i], x, y, s.w, s.h);
        x += s.w + gap;
      });
    } else if (direction === 'grid') {
      const n = sizes.length;
      const cols = opts.columns && opts.columns > 0
        ? Math.round(opts.columns)
        : Math.max(1, Math.round(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      // 格子尺寸用「原始」最大寬高，normalize 只負責把超出格子的縮進去
      const cellW = Math.max(...sizes.map((s) => s.w));
      const cellH = Math.max(...sizes.map((s) => s.h));
      if (normalize) {
        sizes = sizes.map((s) => {
          const ratio = Math.min(cellW / s.w, cellH / s.h, 1);
          return ratio < 1
            ? { w: Math.max(1, Math.round(s.w * ratio)), h: Math.max(1, Math.round(s.h * ratio)) }
            : s;
        });
      }
      const canvasW = cols * cellW + (cols - 1) * gap;
      const canvasH = rows * cellH + (rows - 1) * gap;
      out = newCanvas(canvasW, canvasH);
      fill(out.ctx, canvasW, canvasH, bg);
      sizes.forEach((s, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const x = c * (cellW + gap) + Math.floor((cellW - s.w) / 2);
        const y = r * (cellH + gap) + Math.floor((cellH - s.h) / 2);
        drawScaled(out.ctx, bitmaps[i], x, y, s.w, s.h);
      });
    } else {
      if (normalize) {
        const targetW = Math.min(...sizes.map((s) => s.w));
        sizes = sizes.map((s) => ({ w: targetW, h: Math.max(1, Math.round(s.h * targetW / s.w)) }));
      }
      const maxW = Math.max(...sizes.map((s) => s.w));
      const totalH = sizes.reduce((a, s) => a + s.h, 0) + gap * (sizes.length - 1);
      out = newCanvas(maxW, totalH);
      fill(out.ctx, maxW, totalH, bg);
      let y = 0;
      sizes.forEach((s, i) => {
        const x = align === 'start' ? 0 : align === 'end' ? maxW - s.w : Math.floor((maxW - s.w) / 2);
        drawScaled(out.ctx, bitmaps[i], x, y, s.w, s.h);
        y += s.h + gap;
      });
    }

    bitmaps.forEach((b) => b.close && b.close());
    return {
      blob: await toBlob(out.canvas, format, opts.quality == null ? 90 : opts.quality),
      filename: renameTo('merged', format),
    };
  }

  // ══════════════════════════════════════════════
  //  批次
  // ══════════════════════════════════════════════

  const OPS = { resize, convert, compress, rotate, flip };

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
