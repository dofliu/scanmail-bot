/**
 * TrueType 解析 + 子集化。
 *
 * 為什麼需要這個：PDF 一定要把字型嵌進檔案裡，收到檔案的人才看得到中文。
 * 但我們帶進 App 的 Noto Sans TC 子集有 4.5 MB —— 每份 PDF 都塞一份
 * 顯然不行。所以輸出 PDF 時再裁一次，只留這份文件真正用到的字，
 * 一份幾百字的文件大概只要 30–80 KB。
 *
 * 只處理 glyf 外框的 TrueType（Noto Sans TC 的 TTF 就是），
 * CFF/OpenType-PS 不在支援範圍內，遇到會直接丟錯。
 *
 * 產出的子集只保留 PDF 內嵌需要的表：head / hhea / maxp / hmtx /
 * loca / glyf（外加原本就有的 cvt / fpgm / prep）。cmap 不需要 ——
 * PDF 用 Identity-H 直接以字符編號定位。
 */
(function () {
  'use strict';

  const tag = (s) => (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3);

  // 複合字符的旗標
  const ARG_1_AND_2_ARE_WORDS = 0x0001;
  const WE_HAVE_A_SCALE = 0x0008;
  const MORE_COMPONENTS = 0x0020;
  const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
  const WE_HAVE_A_TWO_BY_TWO = 0x0080;

  function readTables(view) {
    const sfnt = view.getUint32(0);
    if (sfnt === tag('ttcf')) throw new Error('不支援 TrueType Collection（.ttc）');
    if (sfnt === tag('OTTO')) throw new Error('不支援 CFF 外框的 OpenType 字型');
    const numTables = view.getUint16(4);
    const tables = new Map();
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16;
      tables.set(view.getUint32(p), {
        offset: view.getUint32(p + 8),
        length: view.getUint32(p + 12),
      });
    }
    return tables;
  }

  /** cmap → Map<codePoint, gid>。只認 format 4（BMP）與 format 12（含增補平面）。 */
  function readCmap(view, base) {
    const n = view.getUint16(base + 2);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      const p = base + 4 + i * 8;
      const platform = view.getUint16(p);
      const encoding = view.getUint16(p + 2);
      const offset = base + view.getUint32(p + 4);
      const format = view.getUint16(offset);
      if (format !== 4 && format !== 12) continue;
      // 越後面分數越高：Windows UCS-4 > Windows BMP > Unicode
      let score = 1;
      if (platform === 3 && encoding === 1) score = 2;
      if (platform === 3 && encoding === 10) score = 3;
      if (score > bestScore) { bestScore = score; best = offset; }
    }
    if (best < 0) throw new Error('字型缺少可用的 cmap 對照表');

    const map = new Map();
    const format = view.getUint16(best);
    if (format === 12) {
      const groups = view.getUint32(best + 12);
      for (let i = 0; i < groups; i++) {
        const p = best + 16 + i * 12;
        const start = view.getUint32(p);
        const end = view.getUint32(p + 4);
        const gid = view.getUint32(p + 8);
        for (let c = start; c <= end; c++) map.set(c, gid + (c - start));
      }
      return map;
    }

    const segX2 = view.getUint16(best + 6);
    const segs = segX2 / 2;
    const endsAt = best + 14;
    const startsAt = endsAt + segX2 + 2;
    const deltasAt = startsAt + segX2;
    const rangesAt = deltasAt + segX2;
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(endsAt + s * 2);
      const start = view.getUint16(startsAt + s * 2);
      if (start > end || start === 0xffff) continue;
      const delta = view.getInt16(deltasAt + s * 2);
      const rangeOffset = view.getUint16(rangesAt + s * 2);
      for (let c = start; c <= end; c++) {
        let gid;
        if (rangeOffset === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          const at = rangesAt + s * 2 + rangeOffset + (c - start) * 2;
          gid = view.getUint16(at);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid) map.set(c, gid);
      }
    }
    return map;
  }

  function readLoca(view, table, numGlyphs, longFormat) {
    const out = new Uint32Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
      out[i] = longFormat
        ? view.getUint32(table.offset + i * 4)
        : view.getUint16(table.offset + i * 2) * 2;
    }
    return out;
  }

  function readHmtx(view, table, numGlyphs, numHMetrics) {
    const adv = new Uint16Array(numGlyphs);
    const lsb = new Int16Array(numGlyphs);
    let last = 0;
    for (let i = 0; i < numGlyphs; i++) {
      if (i < numHMetrics) {
        last = view.getUint16(table.offset + i * 4);
        adv[i] = last;
        lsb[i] = view.getInt16(table.offset + i * 4 + 2);
      } else {
        adv[i] = last;
        lsb[i] = view.getInt16(table.offset + numHMetrics * 4 + (i - numHMetrics) * 2);
      }
    }
    return { adv, lsb };
  }

  // ── 子集化 ──────────────────────────────────────────────

  /** 複合字符會參照其他字符，少帶一個就會缺一塊，所以要遞迴收齊。 */
  function closeOver(gids, view, loca, glyfOffset, numGlyphs) {
    const queue = [...gids];
    while (queue.length) {
      const gid = queue.pop();
      if (gid >= numGlyphs) continue;
      const start = glyfOffset + loca[gid];
      if (loca[gid + 1] - loca[gid] < 10) continue;
      if (view.getInt16(start) >= 0) continue; // 單純外框，沒有參照
      let p = start + 10;
      for (;;) {
        const flags = view.getUint16(p);
        const ref = view.getUint16(p + 2);
        if (!gids.has(ref)) { gids.add(ref); queue.push(ref); }
        p += 4;
        p += flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2;
        if (flags & WE_HAVE_A_SCALE) p += 2;
        else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) p += 4;
        else if (flags & WE_HAVE_A_TWO_BY_TWO) p += 8;
        if (!(flags & MORE_COMPONENTS)) break;
      }
    }
  }

  function checksum(bytes) {
    let sum = 0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const whole = bytes.length & ~3;
    for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
    if (whole < bytes.length) {
      let tail = 0;
      for (let i = whole; i < bytes.length; i++) tail |= bytes[i] << (24 - (i - whole) * 8);
      sum = (sum + (tail >>> 0)) >>> 0;
    }
    return sum >>> 0;
  }

  function buildSfnt(tables) {
    const names = [...tables.keys()].sort();
    const count = names.length;
    let maxPow = 1;
    while (maxPow * 2 <= count) maxPow *= 2;
    const searchRange = maxPow * 16;

    const headerSize = 12 + count * 16;
    let total = headerSize;
    const padded = names.map((name) => {
      const data = tables.get(name);
      const pad = (4 - (data.length & 3)) & 3;
      total += data.length + pad;
      return { name, data, pad };
    });

    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, count);
    view.setUint16(6, searchRange);
    view.setUint16(8, Math.log2(maxPow));
    view.setUint16(10, count * 16 - searchRange);

    let offset = headerSize;
    padded.forEach((entry, i) => {
      const p = 12 + i * 16;
      view.setUint32(p, tag(entry.name));
      view.setUint32(p + 4, checksum(entry.data));
      view.setUint32(p + 8, offset);
      view.setUint32(p + 12, entry.data.length);
      out.set(entry.data, offset);
      offset += entry.data.length + entry.pad;
    });

    // head.checkSumAdjustment 依整份檔案算，所以只能最後補
    const headIndex = padded.findIndex((e) => e.name === 'head');
    if (headIndex >= 0) {
      let headOffset = headerSize;
      for (let i = 0; i < headIndex; i++) headOffset += padded[i].data.length + padded[i].pad;
      view.setUint32(headOffset + 8, 0);
      const adjust = (0xb1b0afba - checksum(out)) >>> 0;
      view.setUint32(headOffset + 8, adjust);
    }
    return out;
  }

  // ── 對外 ────────────────────────────────────────────────

  function parse(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = readTables(view);

    for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf']) {
      if (!tables.has(tag(t))) throw new Error(`字型缺少 ${t} 表，無法內嵌`);
    }

    const head = tables.get(tag('head'));
    const hhea = tables.get(tag('hhea'));
    const maxp = tables.get(tag('maxp'));
    const glyf = tables.get(tag('glyf'));

    const unitsPerEm = view.getUint16(head.offset + 18);
    const longLoca = view.getInt16(head.offset + 50) === 1;
    const numGlyphs = view.getUint16(maxp.offset + 4);
    const numHMetrics = view.getUint16(hhea.offset + 34);

    const loca = readLoca(view, tables.get(tag('loca')), numGlyphs, longLoca);
    const { adv, lsb } = readHmtx(view, tables.get(tag('hmtx')), numGlyphs, numHMetrics);
    // 子集化後的字型不需要 cmap（PDF 用 Identity-H 直接指定字符編號），
    // 所以這裡容許沒有 —— 只是那份字型就查不到「某個字對應哪個字符」。
    const cmapTable = tables.get(tag('cmap'));
    const cmap = cmapTable ? readCmap(view, cmapTable.offset) : new Map();

    const scale = 1000 / unitsPerEm;
    const bbox = [
      Math.round(view.getInt16(head.offset + 36) * scale),
      Math.round(view.getInt16(head.offset + 38) * scale),
      Math.round(view.getInt16(head.offset + 40) * scale),
      Math.round(view.getInt16(head.offset + 42) * scale),
    ];

    let ascent = view.getInt16(hhea.offset + 4);
    let descent = view.getInt16(hhea.offset + 6);
    let capHeight = Math.round(0.7 * unitsPerEm);
    let weight = 400;
    const os2 = tables.get(tag('OS/2'));
    if (os2) {
      weight = view.getUint16(os2.offset + 4);
      const typoAsc = view.getInt16(os2.offset + 68);
      const typoDesc = view.getInt16(os2.offset + 70);
      if (typoAsc) { ascent = typoAsc; descent = typoDesc; }
      if (view.getUint16(os2.offset) >= 2 && os2.length >= 90) {
        capHeight = view.getInt16(os2.offset + 88) || capHeight;
      }
    }
    let italicAngle = 0;
    const post = tables.get(tag('post'));
    if (post) italicAngle = view.getInt32(post.offset + 4) / 65536;

    /** 依字重粗估直筆畫寬度；PDF 的 FontDescriptor 需要，但不影響顯示。 */
    const stemV = Math.round(10 + (weight - 50) / 8);

    function subset(gidSet) {
      const gids = new Set(gidSet);
      gids.add(0); // .notdef 一定要在，而且必須是第一個
      closeOver(gids, view, loca, glyf.offset, numGlyphs);

      const order = [...gids].filter((g) => g < numGlyphs).sort((a, b) => a - b);
      const remap = new Map();
      order.forEach((old, i) => remap.set(old, i));

      const n = order.length;
      const newLoca = new Uint32Array(n + 1);
      const pieces = [];
      let cursor = 0;
      order.forEach((old, i) => {
        newLoca[i] = cursor;
        const from = glyf.offset + loca[old];
        const len = loca[old + 1] - loca[old];
        if (len <= 0) return;
        const data = bytes.slice(from, from + len);
        if (new DataView(data.buffer).getInt16(0) < 0) {
          // 複合字符：把參照的字符編號換成新編號（都是 uint16，長度不變）
          const dv = new DataView(data.buffer);
          let p = 10;
          for (;;) {
            const flags = dv.getUint16(p);
            const ref = dv.getUint16(p + 2);
            dv.setUint16(p + 2, remap.get(ref) ?? 0);
            p += 4;
            p += flags & ARG_1_AND_2_ARE_WORDS ? 4 : 2;
            if (flags & WE_HAVE_A_SCALE) p += 2;
            else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) p += 4;
            else if (flags & WE_HAVE_A_TWO_BY_TWO) p += 8;
            if (!(flags & MORE_COMPONENTS)) break;
          }
        }
        const pad = (4 - (data.length & 3)) & 3;
        pieces.push(data);
        if (pad) pieces.push(new Uint8Array(pad));
        cursor += data.length + pad;
      });
      newLoca[n] = cursor;

      const newGlyf = new Uint8Array(cursor);
      let at = 0;
      for (const piece of pieces) { newGlyf.set(piece, at); at += piece.length; }

      const locaBytes = new Uint8Array((n + 1) * 4);
      const locaView = new DataView(locaBytes.buffer);
      for (let i = 0; i <= n; i++) locaView.setUint32(i * 4, newLoca[i]);

      const hmtxBytes = new Uint8Array(n * 4);
      const hmtxView = new DataView(hmtxBytes.buffer);
      order.forEach((old, i) => {
        hmtxView.setUint16(i * 4, adv[old]);
        hmtxView.setInt16(i * 4 + 2, lsb[old]);
      });

      const headBytes = bytes.slice(head.offset, head.offset + head.length);
      new DataView(headBytes.buffer).setInt16(50, 1); // 改用 long loca

      const hheaBytes = bytes.slice(hhea.offset, hhea.offset + hhea.length);
      new DataView(hheaBytes.buffer).setUint16(34, n);

      const maxpBytes = bytes.slice(maxp.offset, maxp.offset + maxp.length);
      new DataView(maxpBytes.buffer).setUint16(4, n);

      const out = new Map([
        ['head', headBytes], ['hhea', hheaBytes], ['maxp', maxpBytes],
        ['hmtx', hmtxBytes], ['loca', locaBytes], ['glyf', newGlyf],
      ]);
      for (const name of ['cvt ', 'fpgm', 'prep']) {
        const t = tables.get(tag(name));
        if (t) out.set(name, bytes.slice(t.offset, t.offset + t.length));
      }
      return { data: buildSfnt(out), remap, count: n };
    }

    return {
      unitsPerEm, numGlyphs, bbox, hasCmap: cmap.size > 0, italicAngle, stemV, weight,
      ascent: Math.round(ascent * scale),
      descent: Math.round(descent * scale),
      capHeight: Math.round(capHeight * scale),
      /** 字元 → 字符編號；沒有這個字回傳 0 */
      gidFor: (cp) => cmap.get(cp) || 0,
      has: (cp) => cmap.has(cp),
      /** 字符寬度，換算成 PDF 慣用的 1/1000 em */
      advance: (gid) => Math.round((adv[gid] || 0) * scale),
      subset,
    };
  }

  window.SMTTF = { parse };
})();
