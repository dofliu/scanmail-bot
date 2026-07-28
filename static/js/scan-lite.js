/**
 * 文件邊界偵測 + 透視校正 —— 純前端，不連後端。
 *
 * 離線版本來只有自由裁切，四個角要自己拉。真正「掃描」的那一半 ——
 * 自動抓出紙張、把斜拍的梯形拉回矩形 —— 一直長在後端的 OpenCV 裡。
 * 這一份把它搬進裝置，但不是照抄：
 *
 *   後端 v5 跑七種策略（Canny×3 / 白區 / Otsu / Laplacian / HED / GrabCut / U-Net）
 *   再評分挑最好的。瀏覽器裡沒有那個預算，所以只留一條路 ——
 *   **梯度導向的 Hough 直線偵測**，理由是文件的邊本來就是直線，而且
 *   直線偵測對「角被手指擋住」天生免疫（後端當初得補凸包才解決這件事）。
 *
 *   評分則整套照搬 v5 的觀念，因為那是真的被 22 個案例的基準測試磨出來的：
 *   凸性（不懲罰透視梯形）、逐邊梯度支持度、最弱邊乘法門控。
 *
 * 幾個為了在手機上跑得動而做的取捨，都寫在各自的函式上。
 */
(function () {
  'use strict';

  /** 偵測用的工作解析度。480px 夠找出邊，再大就是白花時間 */
  const WORK_SIZE = 480;
  /** 信心低於這個值就不自動裁切，改請使用者自己拉 —— 對齊後端的門檻 */
  const MIN_CONFIDENCE = 0.45;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // ── 影像特徵（每張圖只算一次，所有候選共用）──────────────

  function toWorking(source, size) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    if (!sw || !sh) throw new Error('讀不到這張圖片');
    const scale = Math.min(1, size / Math.max(sw, sh));
    const w = Math.max(8, Math.round(sw * scale));
    const h = Math.max(8, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, scale: sw / w };
  }

  /** 可分離的箱型模糊 —— 高斯的便宜替身，跑兩次就夠像了 */
  function blur(src, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = radius * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / span;
        sum -= src[row + clamp(x - radius, 0, w - 1)];
        sum += src[row + clamp(x + radius + 1, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / span;
        sum -= tmp[clamp(y - radius, 0, h - 1) * w + x];
        sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  /**
   * 灰階、梯度、積分圖。
   *
   * 積分圖是為了讓「四邊形內部的平均亮度與標準差」變成 O(高度) 而不是
   * O(面積) —— 幾百個候選各掃一次內部像素的話，手機上會卡住。
   */
  function features(source, size) {
    const { data, width: w, height: h, scale } = toWorking(source, size);

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    const smooth = blur(gray, w, h, 2);

    const gx = new Float32Array(w * h);
    const gy = new Float32Array(w * h);
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const a = smooth[i - w - 1]; const b = smooth[i - w]; const c = smooth[i - w + 1];
        const d = smooth[i - 1];     /*      中心      */     const f = smooth[i + 1];
        const g = smooth[i + w - 1]; const k = smooth[i + w]; const l = smooth[i + w + 1];
        const sx = (c + 2 * f + l) - (a + 2 * d + g);
        const sy = (g + 2 * k + l) - (a + 2 * b + c);
        gx[i] = sx;
        gy[i] = sy;
        mag[i] = Math.hypot(sx, sy);
      }
    }

    // 3×3 最大值濾波：沿著邊取樣時容忍 1px 的量化誤差
    const magMax = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clamp(y + dy, 0, h - 1);
          for (let dx = -1; dx <= 1; dx++) {
            const v = mag[yy * w + clamp(x + dx, 0, w - 1)];
            if (v > best) best = v;
          }
        }
        magMax[y * w + x] = best;
      }
    }

    // 積分圖多一列一行的邊界，取區間時不必特判
    const iw = w + 1;
    const sum = new Float64Array(iw * (h + 1));
    const sumSq = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0;
      let rq = 0;
      for (let x = 0; x < w; x++) {
        const v = gray[y * w + x];
        rs += v;
        rq += v * v;
        sum[(y + 1) * iw + x + 1] = sum[y * iw + x + 1] + rs;
        sumSq[(y + 1) * iw + x + 1] = sumSq[y * iw + x + 1] + rq;
      }
    }

    return { gray, gx, gy, mag, magMax, sum, sumSq, width: w, height: h, scale, iw };
  }

  /** 某一列 [x0, x1) 的亮度和 / 平方和 */
  function rowSums(ft, y, x0, x1) {
    if (x1 <= x0) return [0, 0, 0];
    const a = y * ft.iw;
    const b = (y + 1) * ft.iw;
    return [
      ft.sum[b + x1] - ft.sum[b + x0] - ft.sum[a + x1] + ft.sum[a + x0],
      ft.sumSq[b + x1] - ft.sumSq[b + x0] - ft.sumSq[a + x1] + ft.sumSq[a + x0],
      x1 - x0,
    ];
  }

  // ── 幾何 ────────────────────────────────────────────────

  /** 排成順時針 TL, TR, BR, BL */
  function order(pts) {
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    const sorted = pts.slice().sort((p, q) =>
      Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
    // 排序後是順時針，但起點不定 —— 轉到「最左上」那個為 TL
    let start = 0;
    let best = Infinity;
    sorted.forEach((p, i) => {
      const d = p.x + p.y;
      if (d < best) { best = d; start = i; }
    });
    return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  }

  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  /** 凸四邊形？（順時針排好之後，四個轉角的外積要同號） */
  function isConvex(pts) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const c = pts[(i + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /** 兩條線的交點。線用 (cos θ, sin θ, ρ) 表示：x cos θ + y sin θ = ρ */
  function intersect(l1, l2) {
    const det = l1.cos * l2.sin - l2.cos * l1.sin;
    if (Math.abs(det) < 1e-6) return null;
    return {
      x: (l1.rho * l2.sin - l2.rho * l1.sin) / det,
      y: (l1.cos * l2.rho - l2.cos * l1.rho) / det,
    };
  }

  // ── 直線偵測（梯度導向的 Hough）──────────────────────────

  /**
   * 梯度導向的 Hough。
   *
   * 一般的 Hough 每個邊緣點要投 180 個 θ；這裡利用「梯度方向垂直於邊」
   * 這件事，每個點只投它自己的角度加減幾度。同樣的結果，快兩個數量級，
   * 而且峰值乾淨很多 —— 雜訊點的梯度方向是亂的，投不出峰。
   */
  function houghLines(ft, opts = {}) {
    const { gx, gy, mag, width: w, height: h } = ft;
    const thetaBins = 180;                 // 1° 一格
    const diag = Math.hypot(w, h);
    const rhoStep = 2;
    const rhoBins = Math.ceil((diag * 2) / rhoStep) + 1;
    const acc = new Float32Array(thetaBins * rhoBins);

    // 門檻取「梯度的高分位數」而不是固定值 —— 昏暗照片的梯度整體偏低，
    // 固定門檻會什麼都找不到
    const sorted = [];
    for (let i = 0; i < mag.length; i++) if (mag[i] > 1) sorted.push(mag[i]);
    if (!sorted.length) return [];
    sorted.sort((a, b) => a - b);
    const cut = Math.max(12, sorted[Math.floor(sorted.length * (opts.percentile || 0.88))]);

    const cosT = new Float32Array(thetaBins);
    const sinT = new Float32Array(thetaBins);
    for (let t = 0; t < thetaBins; t++) {
      const a = (t * Math.PI) / thetaBins;
      cosT[t] = Math.cos(a);
      sinT[t] = Math.sin(a);
    }

    const spread = 2;   // 容忍梯度方向的雜訊
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mag[i];
        if (m < cut) continue;
        // 梯度方向即直線法線方向，值域收到 0..180
        let deg = Math.round((Math.atan2(gy[i], gx[i]) * 180) / Math.PI);
        deg = ((deg % 180) + 180) % 180;
        for (let d = -spread; d <= spread; d++) {
          const t = ((deg + d) % 180 + 180) % 180;
          const rho = x * cosT[t] + y * sinT[t];
          const r = Math.round((rho + diag) / rhoStep);
          if (r >= 0 && r < rhoBins) acc[t * rhoBins + r] += m;
        }
      }
    }

    // 找峰：先取所有夠強的局部極大，再做非極大抑制
    let peak = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
    if (peak <= 0) return [];
    const floor = peak * (opts.relative || 0.22);

    const found = [];
    for (let t = 0; t < thetaBins; t++) {
      for (let r = 1; r < rhoBins - 1; r++) {
        const v = acc[t * rhoBins + r];
        if (v < floor) continue;
        let isMax = true;
        for (let dt = -2; dt <= 2 && isMax; dt++) {
          const tt = ((t + dt) % thetaBins + thetaBins) % thetaBins;
          for (let dr = -3; dr <= 3; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= rhoBins) continue;
            if (acc[tt * rhoBins + rr] > v) { isMax = false; break; }
          }
        }
        if (!isMax) continue;
        const angle = (t * Math.PI) / thetaBins;
        found.push({
          theta: angle, cos: Math.cos(angle), sin: Math.sin(angle),
          rho: r * rhoStep - diag, weight: v,
        });
      }
    }
    found.sort((a, b) => b.weight - a.weight);
    return found.slice(0, opts.maxLines || 16);
  }

  /**
   * 直線 → 候選四邊形。
   *
   * 先把線依角度分成兩族（文件的對邊互相平行），再從各族挑兩條組成四邊形。
   * 不分族直接四取一的話組合數會爆掉，而且大多是無意義的細長三角形。
   */
  function quadsFromLines(lines, w, h) {
    const quads = [];
    if (lines.length < 4) return quads;

    // 角度分族：以最強的那條線為基準，夾角 < 40° 算同族
    const base = lines[0].theta;
    const famA = [];
    const famB = [];
    for (const l of lines) {
      let diff = Math.abs(l.theta - base);
      if (diff > Math.PI / 2) diff = Math.PI - diff;
      (diff < (40 * Math.PI) / 180 ? famA : famB).push(l);
    }
    if (famA.length < 2 || famB.length < 2) return quads;

    const top = (arr) => arr.slice(0, 5);
    const A = top(famA);
    const B = top(famB);
    const minSep = Math.min(w, h) * 0.15;

    for (let i = 0; i < A.length; i++) {
      for (let j = i + 1; j < A.length; j++) {
        // 兩條同族的線要離得夠遠，否則是同一條邊的重複偵測
        if (Math.abs(A[i].rho - A[j].rho) < minSep) continue;
        for (let m = 0; m < B.length; m++) {
          for (let n = m + 1; n < B.length; n++) {
            if (Math.abs(B[m].rho - B[n].rho) < minSep) continue;
            const pts = [
              intersect(A[i], B[m]), intersect(A[i], B[n]),
              intersect(A[j], B[n]), intersect(A[j], B[m]),
            ];
            if (pts.some((p) => !p)) continue;
            // 允許稍微超出畫面 —— 文件的角常常被裁掉一點點
            const pad = Math.max(w, h) * 0.12;
            if (pts.some((p) => p.x < -pad || p.y < -pad || p.x > w + pad || p.y > h + pad)) continue;
            const quad = order(pts);
            if (!isConvex(quad)) continue;
            quads.push(quad);
          }
        }
      }
    }
    return quads;
  }

  // ── 評分（搬自後端 v5）───────────────────────────────────

  /** 硬性條件：不合理的就直接淘汰，不必進評分 */
  function isValidQuad(quad, w, h) {
    const area = polyArea(quad);
    const ratio = area / (w * h);
    if (ratio < 0.05 || ratio > 0.97) return false;

    const [tl, tr, br, bl] = quad;

    // 手持文件不可能四條邊都緊貼畫面邊緣 —— 那是「整張照片被當成文件」
    const margin = Math.max(w, h) * 0.03;
    let touching = 0;
    if (tl.y < margin && tr.y < margin) touching++;
    if (bl.y > h - margin && br.y > h - margin) touching++;
    if (tl.x < margin && bl.x < margin) touching++;
    if (tr.x > w - margin && br.x > w - margin) touching++;
    if (touching >= 3) return false;

    const wTop = dist(tl, tr);
    const wBot = dist(bl, br);
    const hLeft = dist(tl, bl);
    const hRight = dist(tr, br);
    const maxSide = Math.max(wTop, wBot, hLeft, hRight);
    const minSide = Math.min(wTop, wBot, hLeft, hRight);
    if (minSide < maxSide * 0.15) return false;
    // 對邊差太多 → 不是透視，是抓錯
    if (Math.min(wTop, wBot) / Math.max(wTop, wBot) < 0.2) return false;
    if (Math.min(hLeft, hRight) / Math.max(hLeft, hRight) < 0.2) return false;
    return true;
  }

  /**
   * 逐邊評估「這條邊底下真的有文件邊緣嗎」。
   *
   * 每條邊取樣 20 點，比較邊上的梯度與「往內側偏移一點」的梯度。
   * 真的紙張邊界：邊上強、內側平滑（紙張留白）。
   * 木紋桌面之類的假邊：兩邊差不多 → 不算支持。
   *
   * 這一條是後端 v5 最關鍵的改進，用來淘汰「貼著畫面邊框的假邊」。
   */
  function edgeSupport(ft, quad) {
    const { magMax, width: w, height: h } = ft;
    const inner = Math.max(5, 0.01 * Math.max(w, h));
    const scores = [];
    for (let i = 0; i < 4; i++) {
      const p1 = quad[i];
      const p2 = quad[(i + 1) % 4];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 4) { scores.push(0); continue; }
      // 順時針排序下，(-dy, dx) 指向四邊形內側
      const nx = -dy / len;
      const ny = dx / len;

      let supported = 0;
      let strength = 0;
      const N = 20;
      for (let s = 0; s < N; s++) {
        const t = 0.08 + (0.84 * s) / (N - 1);
        const ex = p1.x + t * dx;
        const ey = p1.y + t * dy;
        const gEdge = magMax[clamp(Math.round(ey), 0, h - 1) * w + clamp(Math.round(ex), 0, w - 1)];
        const gIn = magMax[clamp(Math.round(ey + ny * inner), 0, h - 1) * w
          + clamp(Math.round(ex + nx * inner), 0, w - 1)];
        if (gEdge > Math.max(1.6 * gIn, 25)) supported++;
        strength += Math.min(gEdge / 60, 1);
      }
      scores.push((supported / N) * (0.5 + 0.5 * (strength / N)));
    }
    return scores;
  }

  /** 四邊形內部的亮度統計 —— 走積分圖，逐列 O(1) */
  function quadStats(ft, quad) {
    const { width: w, height: h } = ft;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of quad) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const y0 = clamp(Math.floor(minY), 0, h - 1);
    const y1 = clamp(Math.ceil(maxY), 0, h - 1);

    let total = 0;
    let totalSq = 0;
    let count = 0;
    for (let y = y0; y <= y1; y++) {
      // 這一列與四條邊的交點 → [左, 右]
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 4; i++) {
        const a = quad[i];
        const b = quad[(i + 1) % 4];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
      if (!isFinite(lo) || hi <= lo) continue;
      const x0 = clamp(Math.round(lo), 0, w);
      const x1 = clamp(Math.round(hi), 0, w);
      const [s, q, n] = rowSums(ft, y, x0, x1);
      total += s;
      totalSq += q;
      count += n;
    }
    if (count < 100) return null;
    const mean = total / count;
    const variance = Math.max(0, totalSq / count - mean * mean);
    return { mean, std: Math.sqrt(variance), count, total };
  }

  /**
   * 候選四邊形的「文件可信度」。
   *
   * 權重與分段全部照搬後端 v5 —— 那些數字是 22 個案例的基準測試調出來的，
   * 憑感覺重寫只會退步。唯一拿掉的是膚色遮罩（手指誤判），
   * 因為 Hough 走直線，本來就不太會把手掌的邊當成文件的邊。
   */
  function scoreQuad(ft, quad) {
    const w = ft.width;
    const h = ft.height;
    const area = polyArea(quad);
    const ratio = area / (w * h);

    // 面積：10%~90% 都給滿分（近距離拍到快滿版是建議的拍法）
    let areaS;
    if (ratio < 0.05) areaS = 0;
    else if (ratio < 0.15) areaS = (ratio - 0.05) / 0.1;
    else if (ratio < 0.9) areaS = 1;
    else if (ratio < 0.97) areaS = 1 - (ratio - 0.9) / 0.07;
    else areaS = 0;

    // 凸性取代「矩形度」—— 透視下的文件本來就是梯形，不該被懲罰
    const convexity = isConvex(quad) ? 1 : 0.35;

    const [tl, tr, br, bl] = quad;
    const borderMin = Math.min(
      tl.x, tl.y, w - tr.x, tr.y, w - br.x, h - br.y, bl.x, h - bl.y);
    const borderS = clamp(borderMin / (Math.max(w, h) * 0.05), 0, 1);

    const wAvg = (dist(tl, tr) + dist(bl, br)) / 2;
    const hAvg = (dist(tl, bl) + dist(tr, br)) / 2;
    const aspect = Math.max(wAvg, hAvg) > 0 ? Math.min(wAvg, hAvg) / Math.max(wAvg, hAvg) : 0;
    const aspectS = aspect >= 0.4 && aspect <= 1
      ? 1
      : Math.max(0, 1 - Math.min(Math.abs(aspect - 0.4), Math.abs(aspect - 1)) * 2.5);

    const geo = areaS * 0.35 + convexity * 0.25 + borderS * 0.2 + aspectS * 0.2;

    // ── 內容 ──
    const inside = quadStats(ft, quad);
    if (!inside) return { score: geo * 0.4, geo, edgeMin: 0 };

    // 外部＝畫面內縮 5% 之後扣掉四邊形。用整體減內部估算，夠用而且是 O(1)
    const margin = Math.round(Math.max(w, h) * 0.05);
    const mx0 = clamp(margin, 0, w);
    const my0 = clamp(margin, 0, h);
    const mx1 = clamp(w - margin, 0, w);
    const my1 = clamp(h - margin, 0, h);
    let outTotal = 0;
    let outCount = 0;
    for (let y = my0; y < my1; y++) {
      const [s, , n] = rowSums(ft, y, mx0, mx1);
      outTotal += s;
      outCount += n;
    }
    outTotal -= inside.total;
    outCount -= inside.count;

    let brightS = 0;
    if (outCount > 100) {
      const diff = inside.mean - outTotal / outCount;
      if (diff > 60) brightS = 1;
      else if (diff > 20) brightS = (diff - 20) / 40;
      else if (diff > 0) brightS = (diff / 20) * 0.3;
    } else {
      brightS = 0.5;   // 幾乎填滿畫面，沒有外部可比 —— 不獎不罰
    }

    // 紙張的亮度應該均勻；複雜場景的標準差會明顯高
    const std = inside.std;
    let uniformS;
    if (std < 30) uniformS = 1;
    else if (std < 50) uniformS = 1 - ((std - 30) / 20) * 0.5;
    else if (std < 70) uniformS = 0.5 - ((std - 50) / 20) * 0.3;
    else uniformS = 0.2;

    const edges = edgeSupport(ft, quad);
    const edgeMean = edges.reduce((a, b) => a + b, 0) / 4;
    const edgeMin = Math.min(...edges);
    const edgeS = edgeMean * (0.35 + 0.65 * edgeMin);

    const content = brightS * 0.35 + uniformS * 0.2 + edgeS * 0.45;
    // 最弱邊乘法門控：任何一條邊沒有影像證據 → 不管其他分數多高都重罰
    const score = (geo * 0.4 + content * 0.6) * (0.55 + 0.45 * edgeMin);
    return { score, geo, content, edgeMin, edges };
  }

  // ── 對外：偵測 ───────────────────────────────────────────

  /**
   * 找出文件的四個角。
   *
   * @returns {{corners, confidence, method}} corners 是**原圖座標**；
   *          confidence < 0.45 時呼叫端不該自動裁切，應該請使用者自己拉
   */
  function detect(source, opts = {}) {
    const ft = features(source, opts.workSize || WORK_SIZE);
    const lines = houghLines(ft, opts);
    const candidates = quadsFromLines(lines, ft.width, ft.height);

    let best = null;
    for (const quad of candidates) {
      if (!isValidQuad(quad, ft.width, ft.height)) continue;
      const s = scoreQuad(ft, quad);
      if (!best || s.score > best.score) best = { quad, ...s };
    }

    const toSource = (p) => ({ x: p.x * ft.scale, y: p.y * ft.scale });
    if (!best) {
      // 找不到就退回「整張圖稍微內縮」，讓使用者從一個合理的框開始拉
      const inset = 0.04;
      const w = ft.width;
      const h = ft.height;
      return {
        corners: [
          { x: w * inset, y: h * inset }, { x: w * (1 - inset), y: h * inset },
          { x: w * (1 - inset), y: h * (1 - inset) }, { x: w * inset, y: h * (1 - inset) },
        ].map(toSource),
        confidence: 0,
        method: 'fallback',
        lines: lines.length,
      };
    }

    return {
      corners: best.quad.map(toSource),
      confidence: clamp(best.score, 0, 1),
      method: 'hough',
      lines: lines.length,
      detail: { geo: best.geo, content: best.content, edgeMin: best.edgeMin },
    };
  }

  // ── 對外：真實寬高比 ─────────────────────────────────────

  const cross3 = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /**
   * 從透視四邊形反推文件的真實（物理）寬高比。
   *
   * Zhang & He「Whiteboard Scanning and Image Enhancement」：假設針孔相機、
   * 主點在影像中心，從矩形的透視投影反推焦距與真實寬高比。
   *
   * 不做這一步的話，輸出尺寸只能用「影像上的邊長」決定 ——
   * 斜拍的 A4 在影像上的寬高比跟 1:√2 差很多，拉正之後會系統性地變形。
   *
   * @returns {number|null} width/height，退化情況回 null（呼叫端自己 fallback）
   */
  function recoverAspect(corners, imgW, imgH) {
    const [tl, tr, br, bl] = order(corners);
    const u0 = imgW / 2;
    const v0 = imgH / 2;
    const diag = Math.hypot(imgW, imgH);

    const m1 = [tl.x - u0, tl.y - v0, 1];
    const m2 = [tr.x - u0, tr.y - v0, 1];
    const m3 = [bl.x - u0, bl.y - v0, 1];
    const m4 = [br.x - u0, br.y - v0, 1];

    const d2 = dot3(cross3(m2, m4), m3);
    const d3 = dot3(cross3(m3, m4), m2);
    if (Math.abs(d2) < 1e-8 || Math.abs(d3) < 1e-8) return null;
    const k2 = dot3(cross3(m1, m4), m3) / d2;
    const k3 = dot3(cross3(m1, m4), m2) / d3;

    const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
    const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

    // 一點透視（某方向的對邊近乎平行）時焦距在數學上不可觀測，
    // 這時改用「典型手機相機」的假設焦距
    let f = null;
    if (Math.min(Math.abs(n2[2]), Math.abs(n3[2])) > 0.015) {
      const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
      if (f2 > 0) {
        const est = Math.sqrt(f2);
        if (est >= 0.3 * diag && est <= 3 * diag) f = est;
      }
    }
    if (f === null) f = 0.75 * diag;

    const v2 = [n2[0] / f, n2[1] / f, n2[2]];
    const v3 = [n3[0] / f, n3[1] / f, n3[2]];
    const denom = dot3(v3, v3);
    if (denom < 1e-12) return null;
    const ratio = Math.sqrt(dot3(v2, v2) / denom);
    return isFinite(ratio) && ratio > 0 ? ratio : null;
  }

  /** 拉正之後該輸出多大 —— 用真實寬高比，退化時才退回影像上的邊長 */
  function outputSize(corners, imgW, imgH, opts = {}) {
    const [tl, tr, br, bl] = order(corners);
    const wAvg = (dist(tl, tr) + dist(bl, br)) / 2;
    const hAvg = (dist(tl, bl) + dist(tr, br)) / 2;
    let ratio = opts.aspect || recoverAspect(corners, imgW, imgH);
    // 反推出來的比例太離譜就不要信它
    if (!ratio || ratio < 0.15 || ratio > 6.7) ratio = wAvg / Math.max(1, hAvg);

    // 面積對齊影像上的四邊形，才不會因為拉正就放大或縮小解析度
    const area = Math.max(1, wAvg * hAvg);
    let outH = Math.sqrt(area / ratio);
    let outW = outH * ratio;
    const cap = opts.maxSize || 4000;
    const over = Math.max(outW, outH) / cap;
    if (over > 1) { outW /= over; outH /= over; }
    return { width: Math.max(1, Math.round(outW)), height: Math.max(1, Math.round(outH)), aspect: ratio };
  }

  // ── 對外：透視校正 ───────────────────────────────────────

  /**
   * 單位正方形 → 四邊形的投影變換矩陣。
   *
   * (0,0)→TL、(1,0)→TR、(1,1)→BR、(0,1)→BL。有閉合解，不必解 8×8 線性方程。
   */
  function homography(quad) {
    const [p0, p1, p2, p3] = quad;
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - dx2 * sy) / den;
    const hh = (dx1 * sy - sx * dy1) / den;
    return [
      p1.x - p0.x + g * p1.x, p3.x - p0.x + hh * p3.x, p0.x,
      p1.y - p0.y + g * p1.y, p3.y - p0.y + hh * p3.y, p0.y,
      g, hh, 1,
    ];
  }

  const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

  // 逐像素反推來源座標。GPU 順便給了雙線性取樣，不必自己寫。
  const FRAG = `
precision highp float;
uniform sampler2D u_img;
uniform mat3 u_h;
uniform vec2 u_size;
varying vec2 v_uv;
void main() {
  vec3 p = u_h * vec3(v_uv.x, 1.0 - v_uv.y, 1.0);
  vec2 src = p.xy / p.z;
  vec2 uv = src / u_size;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);   // 超出原圖 → 白，當作紙的留白
    return;
  }
  // UNPACK_FLIP_Y_WEBGL 是關的，所以貼圖的 t=0 就是影像的第一列（最上面那列），
  // uv.y 直接當 t 用。這裡多翻一次的話輸出會上下顛倒 ——
  // 而且「線還是直的」，只有靠內容的方向才驗得出來
  gl_FragColor = texture2D(u_img, uv);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader 編譯失敗：' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function warpGL(source, quad, outW, outH, srcW, srcH) {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
      || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
    if (!gl) return null;

    const H = homography(quad);
    if (!H) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // WebGL 的 mat3 是行主序，所以要轉置再送
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'u_h'), false, new Float32Array([
      H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8],
    ]));
    gl.uniform2f(gl.getUniformLocation(prog, 'u_size'), srcW, srcH);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_img'), 0);

    gl.viewport(0, 0, outW, outH);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return canvas;
  }

  /**
   * 沒有 WebGL 時的退路：把輸出切成細格，每一格用仿射近似。
   *
   * canvas 2D 只做得到仿射，做不到投影變換。但格子夠小的時候，
   * 每一格內部的投影變換跟仿射的差距小於一個像素 —— 看不出來。
   * 每格畫的時候往外多畫半格，接縫才不會露出背景。
   */
  function warp2D(source, quad, outW, outH) {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const H = homography(quad);
    if (!H) return canvas;
    const map = (u, v) => {
      const d = H[6] * u + H[7] * v + H[8];
      return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
    };

    const N = 40;
    const cw = outW / N;
    const ch = outH / N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u0 = i / N;
        const v0 = j / N;
        const u1 = (i + 1) / N;
        const v1 = (j + 1) / N;
        const a = map(u0, v0);
        const b = map(u1, v0);
        const c = map(u0, v1);

        // 用三個角推仿射：(u0,v0)→a、(u1,v0)→b、(u0,v1)→c
        const m11 = (b.x - a.x) / cw;
        const m12 = (c.x - a.x) / ch;
        const m21 = (b.y - a.y) / cw;
        const m22 = (c.y - a.y) / ch;
        const dx = i * cw;
        const dy = j * ch;

        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, cw + 0.6, ch + 0.6);   // 多蓋一點，避免接縫
        ctx.clip();
        // 目標 → 來源的反矩陣：先套來源，再把目標平移回原位
        const det = m11 * m22 - m12 * m21;
        if (Math.abs(det) > 1e-9) {
          const i11 = m22 / det;
          const i12 = -m12 / det;
          const i21 = -m21 / det;
          const i22 = m11 / det;
          const e = dx - (i11 * a.x + i12 * a.y);
          const f = dy - (i21 * a.x + i22 * a.y);
          ctx.setTransform(i11, i21, i12, i22, e, f);
          ctx.drawImage(source, 0, 0);
        }
        ctx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return canvas;
  }

  /**
   * 把四邊形拉正成矩形。
   *
   * @param {CanvasImageSource} source
   * @param {Array<{x,y}>} corners  原圖座標，任意順序
   * @param {{aspect, maxSize}} [opts]
   * @returns {HTMLCanvasElement}
   */
  function warp(source, corners, opts = {}) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;
    if (!srcW || !srcH) throw new Error('讀不到這張圖片');
    const quad = order(corners);
    const { width, height } = outputSize(quad, srcW, srcH, opts);
    if (opts.force2d) return warp2D(source, quad, width, height);
    try {
      const gl = warpGL(source, quad, width, height, srcW, srcH);
      // 一定要搬回 2D 畫布再回傳 —— 一張 canvas 只能有一種 context，
      // 直接回傳 WebGL 畫布的話呼叫端的 getContext('2d') 會拿到 null，
      // 後面所有的合成（濾鏡、打碼、拼貼）就整條斷掉
      if (gl) {
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        out.getContext('2d').drawImage(gl, 0, 0);
        return out;
      }
    } catch (e) {
      // 低階裝置上 WebGL 可能拿不到 context —— 退回 canvas 2D 而不是失敗
    }
    return warp2D(source, quad, width, height);
  }

  window.SMScanLite = {
    MIN_CONFIDENCE, WORK_SIZE,
    detect, warp, recoverAspect, outputSize,
    // 測試用
    _internals: {
      features, houghLines, quadsFromLines, scoreQuad, isValidQuad,
      edgeSupport, order, polyArea, isConvex, homography, warp2D, warpGL, blur,
    },
  };
})();
