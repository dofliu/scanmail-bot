/**
 * 簽名 / 印章 —— 純前端，不連後端。
 *
 * 兩種簽名，走的路完全不一樣：
 *
 *   手繪（kind: 'draw'）  存的是筆畫的「點」，不是像素。所以放大不糊、
 *                        存進 localStorage 只有幾 KB，蓋進 PDF 時直接輸出
 *                        向量路徑 —— 印出來跟原生文件一樣銳利。
 *   匯入（kind: 'image'） 拍一張紙上的簽名或關防，去掉白底變成透明 PNG。
 *                        蓋進 PDF 走影像 XObject + SMask。
 *
 * 座標一律正規化到 0–1（相對於簽名自己的邊界框），另外記 aspect，
 * 所以同一份簽名在縮圖預覽、原圖匯出、PDF 蓋章上長得一模一樣。
 *
 * 曲線用「相鄰兩點的中點連成二次貝茲」——手指畫出來的點是抖的，直接連線會有
 * 稜角。Canvas 用 quadraticCurveTo，PDF 沒有二次曲線運算子，改寫成三次貝茲，
 * 兩邊算的是同一條線，所以看到的就是蓋出來的。
 */
(function () {
  'use strict';

  const DEFAULTS = {
    color: '#1a2b4a',   // 深藍：實體簽名筆的顏色，跟印刷黑字分得開
    width: 0.035,       // 筆畫寬，相對於邊界框的長邊
    smooth: 1.4,        // 簡化容差（相對於長邊的千分比），愈大點愈少
  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ── 筆畫 ────────────────────────────────────────────────

  /**
   * Ramer–Douglas–Peucker：把手指畫出來的上百個點砍到剩幾十個。
   * 存進 localStorage 才不會爆，而且 PDF 路徑也短很多。
   */
  function simplify(points, tolerance) {
    if (points.length < 3) return points.slice();
    const tol2 = tolerance * tolerance;

    const segDist2 = (p, a, b) => {
      let x = a.x;
      let y = a.y;
      let dx = b.x - x;
      let dy = b.y - y;
      if (dx || dy) {
        const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b.x; y = b.y; }
        else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p.x - x;
      dy = p.y - y;
      return dx * dx + dy * dy;
    };

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    // 用堆疊而不是遞迴 —— 長筆畫遞迴會很深
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let worst = 0;
      let at = -1;
      for (let i = first + 1; i < last; i++) {
        const d = segDist2(points[i], points[first], points[last]);
        if (d > worst) { worst = d; at = i; }
      }
      if (at > 0 && worst > tol2) {
        keep[at] = 1;
        stack.push([first, at], [at, last]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  /**
   * 原始筆畫（畫布座標）→ 正規化的簽名物件。
   *
   * 邊界框會往外留半個筆畫寬，不然筆尖會被切掉。
   */
  function fromStrokes(strokes, opts = {}) {
    const raw = (strokes || []).map((s) => (s || []).filter((p) => p && isFinite(p.x) && isFinite(p.y)))
      .filter((s) => s.length);
    if (!raw.length) throw new Error('還沒畫上去');

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of raw) {
      for (const p of s) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    const width = opts.width == null ? DEFAULTS.width : opts.width;
    // 只有一個點（點一下就放開）時邊界框是零 —— 給它一個筆畫寬的大小
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const pad = (span * width) / 2;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    const boxW = Math.max(maxX - minX, 1e-6);
    const boxH = Math.max(maxY - minY, 1e-6);
    const scale = Math.max(boxW, boxH);
    const tol = (opts.smooth == null ? DEFAULTS.smooth : opts.smooth) / 1000;

    const norm = raw.map((s) => {
      const mapped = s.map((p) => ({ x: (p.x - minX) / boxW, y: (p.y - minY) / boxH }));
      return simplify(mapped, tol).map((p) => ({
        x: Math.round(clamp01(p.x) * 10000) / 10000,
        y: Math.round(clamp01(p.y) * 10000) / 10000,
      }));
    });

    return {
      kind: 'draw',
      strokes: norm,
      aspect: boxW / boxH,
      color: opts.color || DEFAULTS.color,
      // 筆畫寬存成「相對於長邊」—— 邊界框被正規化成 0–1 之後，
      // x 與 y 的縮放比例不同，畫的時候要用長邊還原才不會變成橢圓筆尖
      width: (width * span) / scale,
    };
  }

  /**
   * 走一條筆畫，把中點當節點、原始點當控制點。
   *
   * @param {(kind, ...args) => void} emit  'move' | 'quad' | 'line' | 'dot'
   */
  function walk(points, emit) {
    if (!points.length) return;
    if (points.length === 1) { emit('dot', points[0]); return; }
    if (points.length === 2) {
      emit('move', points[0]);
      emit('line', points[1]);
      return;
    }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    emit('move', points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      emit('quad', points[i], mid(points[i], points[i + 1]));
    }
    // 最後一段直接收到終點，不然筆畫會短一截
    emit('quad', points[points.length - 2], points[points.length - 1]);
  }

  // ── 畫到 canvas ──────────────────────────────────────────

  /**
   * 把簽名畫進畫布上的方框。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} sig
   * @param {{x, y, w, h}} box  目標方框（畫布座標）
   * @param {{opacity, rotate, color}} [opts]
   */
  function drawInto(ctx, sig, box, opts = {}) {
    if (!sig || !box || box.w <= 0 || box.h <= 0) return;
    ctx.save();
    ctx.filter = 'none';
    ctx.globalAlpha = opts.opacity == null ? 1 : Math.max(0.02, Math.min(1, opts.opacity));

    if (opts.rotate) {
      ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
      ctx.rotate((opts.rotate * Math.PI) / 180);
      ctx.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
    }

    if (sig.kind === 'image') {
      const img = sig._bitmap || sig._img;
      if (img) ctx.drawImage(img, box.x, box.y, box.w, box.h);
      ctx.restore();
      return;
    }

    const X = (u) => box.x + u * box.w;
    const Y = (v) => box.y + v * box.h;
    // 筆畫寬跟著長邊縮放 —— 橫著拉寬時線條不該跟著變扁
    const lw = Math.max(0.4, (sig.width || DEFAULTS.width) * Math.max(box.w, box.h));

    ctx.strokeStyle = opts.color || sig.color || DEFAULTS.color;
    ctx.fillStyle = opts.color || sig.color || DEFAULTS.color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of sig.strokes || []) {
      ctx.beginPath();
      let dotted = false;
      walk(stroke, (kind, a, b) => {
        if (kind === 'move') ctx.moveTo(X(a.x), Y(a.y));
        else if (kind === 'line') ctx.lineTo(X(a.x), Y(a.y));
        else if (kind === 'quad') ctx.quadraticCurveTo(X(a.x), Y(a.y), X(b.x), Y(b.y));
        else if (kind === 'dot') {
          ctx.arc(X(a.x), Y(a.y), lw / 2, 0, Math.PI * 2);
          dotted = true;
        }
      });
      if (dotted) ctx.fill();
      else ctx.stroke();
    }
    ctx.restore();
  }

  /** 產生預覽縮圖（透明底 PNG） */
  function preview(sig, maxSize = 240) {
    const aspect = sig.aspect || 1;
    const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
    const h = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    drawInto(canvas.getContext('2d'), sig, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    return canvas.toDataURL('image/png');
  }

  // ── 匯入圖片 ─────────────────────────────────────────────

  /**
   * 拍一張紙上的簽名 / 關防 → 去掉白底。
   *
   * 用亮度當透明度：愈接近白色愈透明。這樣紅色關防的紅會留著（`keep`），
   * 黑色簽名則可以整個換成想要的墨色（`ink`）。
   *
   * @param {CanvasImageSource} source
   * @param {{mode:'keep'|'ink', color, threshold, maxSize}} [opts]
   */
  function fromImage(source, opts = {}) {
    const mode = opts.mode === 'ink' ? 'ink' : 'keep';
    const maxSize = opts.maxSize || 900;
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    if (!sw || !sh) throw new Error('讀不到這張圖片');

    const scale = Math.min(1, maxSize / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    // white：比這個亮就是純背景；black：比這個暗就是純墨。中間線性過渡，
    // 留一段過渡帶邊緣才不會有鋸齒。
    const white = Math.max(0.05, Math.min(1, opts.threshold == null ? 0.78 : opts.threshold));
    const black = white * 0.55;
    const ink = mode === 'ink' ? hexToRgb(opts.color || DEFAULTS.color) : null;

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const luma = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      let a = (white - luma) / Math.max(1e-6, white - black);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      const alpha = Math.round(a * (px[i + 3] / 255) * 255);
      if (ink) {
        px[i] = ink[0];
        px[i + 1] = ink[1];
        px[i + 2] = ink[2];
      }
      px[i + 3] = alpha;
      if (alpha > 24) {
        const x = p % w;
        const y = (p - x) / w;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) throw new Error('這張圖看起來整片空白 —— 換一張、或把門檻調高');

    ctx.putImageData(img, 0, 0);

    // 裁掉四周的空白，之後擺放時方框就是簽名本身而不是一大片透明
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04) + 1;
    const cx = Math.max(0, minX - pad);
    const cy = Math.max(0, minY - pad);
    const cw = Math.min(w, maxX + pad + 1) - cx;
    const ch = Math.min(h, maxY + pad + 1) - cy;

    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d').drawImage(canvas, cx, cy, cw, ch, 0, 0, cw, ch);

    return {
      kind: 'image',
      data: out.toDataURL('image/png'),
      aspect: cw / ch,
      width: cw,
      height: ch,
    };
  }

  function hexToRgb(color) {
    const hex = (color || '#000000').replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const v = parseInt(full, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /** 點陣簽名的 dataURL → <img>，畫之前要先等它載入 */
  function hydrate(sig) {
    if (!sig || sig.kind !== 'image' || sig._img || !sig.data) return Promise.resolve(sig);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { sig._img = img; resolve(sig); };
      img.onerror = () => reject(new Error('簽名圖片讀取失敗'));
      img.src = sig.data;
    });
  }

  /** 取點陣簽名的像素（給 PDF 影像 XObject 用） */
  function pixels(sig) {
    const img = sig._img || sig._bitmap;
    if (!img) throw new Error('簽名圖片還沒載入');
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { rgba: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  }

  // ── 輸出成 PDF 運算子 ─────────────────────────────────────

  const fmt = (n) => {
    const v = Math.round(n * 1000) / 1000;
    return Object.is(v, -0) ? '0' : String(v);
  };

  /**
   * 產生蓋章的 PDF 內容運算子。
   *
   * 座標用「左上角原點、y 往下」—— 呼叫端（pdf-lite）已經套好把這個座標系
   * 轉成 PDF 慣用座標的 CTM，所以這裡直接用畫面上的數字就好。
   *
   * @param {object} sig
   * @param {{x, y, w, h}} box
   * @param {{opacity, rotate, useImage, useAlpha}} opts
   *   useImage(sig) → 影像 XObject 的名稱。登記影像是呼叫端的事（要先 hydrate、
   *   再用 pixels() 取像素），因為建 XObject 得壓縮、是非同步的，而這裡是同步的。
   *   useAlpha(value) → ExtGState 名稱
   */
  function pdfOps(sig, box, opts = {}) {
    if (!sig || !box || box.w <= 0 || box.h <= 0) return '';
    const out = ['q'];

    const opacity = opts.opacity == null ? 1 : Math.max(0.02, Math.min(1, opts.opacity));
    if (opacity < 1 && opts.useAlpha) out.push(`/${opts.useAlpha(opacity)} gs`);

    if (opts.rotate) {
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      // 這裡的 y 是往下的，所以正角度本來就是順時針 —— 跟 CSS 的 rotate()
      // 與 canvas 的 ctx.rotate() 一致。外層那層上下翻轉的矩陣不影響這裡：
      // cm 是接在「目前的座標系」上，而目前就是畫面座標系。
      const t = (opts.rotate * Math.PI) / 180;
      const c = Math.cos(t);
      const s = Math.sin(t);
      out.push(`1 0 0 1 ${fmt(cx)} ${fmt(cy)} cm`);
      out.push(`${fmt(c)} ${fmt(s)} ${fmt(-s)} ${fmt(c)} 0 0 cm`);
      out.push(`1 0 0 1 ${fmt(-cx)} ${fmt(-cy)} cm`);
    }

    if (sig.kind === 'image') {
      if (!opts.useImage) throw new Error('點陣簽名需要 useImage 回呼');
      const name = opts.useImage(sig);
      // 影像 XObject 畫在單位正方形裡，第一列在上緣（v = 1）。這裡的 y 是往下的，
      // 所以 d 取負、f 取方框底部，圖才不會上下顛倒。
      out.push(`${fmt(box.w)} 0 0 ${fmt(-box.h)} ${fmt(box.x)} ${fmt(box.y + box.h)} cm`);
      out.push(`/${name} Do`);
      out.push('Q');
      return out.join('\n');
    }

    const [r, g, b] = hexToRgb(opts.color || sig.color || DEFAULTS.color).map((v) => v / 255);
    const lw = Math.max(0.1, (sig.width || DEFAULTS.width) * Math.max(box.w, box.h));
    const X = (u) => box.x + u * box.w;
    const Y = (v) => box.y + v * box.h;

    out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`);
    out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    out.push(`${fmt(lw)} w 1 J 1 j`);

    for (const stroke of sig.strokes || []) {
      const ops = [];
      let cur = null;
      let dotted = false;
      walk(stroke, (kind, a, b) => {
        if (kind === 'move') {
          cur = { x: X(a.x), y: Y(a.y) };
          ops.push(`${fmt(cur.x)} ${fmt(cur.y)} m`);
        } else if (kind === 'line') {
          cur = { x: X(a.x), y: Y(a.y) };
          ops.push(`${fmt(cur.x)} ${fmt(cur.y)} l`);
        } else if (kind === 'quad') {
          // PDF 沒有二次貝茲，換算成三次：控制點各往端點拉回 1/3
          const q = { x: X(a.x), y: Y(a.y) };
          const end = { x: X(b.x), y: Y(b.y) };
          const p0 = cur || q;
          const c1 = { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) };
          const c2 = { x: end.x + (2 / 3) * (q.x - end.x), y: end.y + (2 / 3) * (q.y - end.y) };
          ops.push(`${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(end.x)} ${fmt(end.y)} c`);
          cur = end;
        } else if (kind === 'dot') {
          // 單點：用四段貝茲畫個圓，PDF 沒有畫圓的運算子
          const k = 0.5523 * (lw / 2);
          const x = X(a.x);
          const y = Y(a.y);
          const rr = lw / 2;
          ops.push(`${fmt(x + rr)} ${fmt(y)} m`);
          ops.push(`${fmt(x + rr)} ${fmt(y + k)} ${fmt(x + k)} ${fmt(y + rr)} ${fmt(x)} ${fmt(y + rr)} c`);
          ops.push(`${fmt(x - k)} ${fmt(y + rr)} ${fmt(x - rr)} ${fmt(y + k)} ${fmt(x - rr)} ${fmt(y)} c`);
          ops.push(`${fmt(x - rr)} ${fmt(y - k)} ${fmt(x - k)} ${fmt(y - rr)} ${fmt(x)} ${fmt(y - rr)} c`);
          ops.push(`${fmt(x + k)} ${fmt(y - rr)} ${fmt(x + rr)} ${fmt(y - k)} ${fmt(x + rr)} ${fmt(y)} c`);
          dotted = true;
        }
      });
      if (!ops.length) continue;
      out.push(ops.join('\n'));
      out.push(dotted ? 'f' : 'S');
    }

    out.push('Q');
    return out.join('\n');
  }

  // ── 存放 ────────────────────────────────────────────────

  const KEY = 'sm.signatures';
  const MAX = 12;

  function list() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((s) => s && (s.kind === 'draw' || s.kind === 'image')) : [];
    } catch (e) {
      return [];
    }
  }

  function persist(items) {
    // 存不下（點陣簽名太多）時砍掉最舊的再試，而不是整批丟失
    let keep = items.slice(0, MAX);
    for (;;) {
      try {
        localStorage.setItem(KEY, JSON.stringify(keep.map(strip)));
        return keep;
      } catch (e) {
        if (keep.length <= 1) throw new Error('簽名存不進來 —— 裝置的儲存空間滿了');
        keep = keep.slice(0, keep.length - 1);
      }
    }
  }

  /** 存檔時丟掉快取用的欄位（Image 物件序列化不了） */
  function strip(sig) {
    const out = {};
    for (const [k, v] of Object.entries(sig)) if (!k.startsWith('_')) out[k] = v;
    return out;
  }

  function save(sig) {
    const id = sig.id || `sig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = { ...strip(sig), id, name: sig.name || '' };
    const rest = list().filter((s) => s.id !== id);
    return { saved: entry, items: persist([entry, ...rest]) };
  }

  function remove(id) {
    return persist(list().filter((s) => s.id !== id));
  }

  function rename(id, name) {
    return persist(list().map((s) => (s.id === id ? { ...s, name } : s)));
  }

  window.SMSignLite = {
    DEFAULTS, MAX,
    fromStrokes, fromImage, drawInto, preview, pdfOps, hydrate, pixels,
    list, save, remove, rename,
    // 測試用
    _internals: { simplify, walk, hexToRgb, KEY },
  };
})();
