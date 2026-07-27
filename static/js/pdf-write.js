/**
 * 產生 PDF —— 純前端，不連後端。
 *
 * 只做這個 App 需要的那一小塊：文字、線、色塊、連結。真正麻煩的是中文，
 * 因為 PDF 的內建字型沒有漢字，一定要把字型嵌進檔案。做法是：
 *
 *   Type0（Identity-H）→ CIDFontType2 → FontFile2（TTF 子集）
 *
 * Identity-H 表示內文直接寫「字符編號」而不是字元編碼，所以還要附一份
 * ToUnicode 對照表，收到 PDF 的人才能複製、搜尋文字。
 *
 * 座標一律用「左上角為原點、y 往下」—— 跟排版程式的思路一致；
 * 寫進檔案前才翻成 PDF 慣用的左下原點。
 */
(function () {
  'use strict';

  const enc = new TextEncoder();
  const PT_PER_MM = 72 / 25.4;
  const PAGE_SIZES = {
    A4: [210 * PT_PER_MM, 297 * PT_PER_MM],
    A5: [148 * PT_PER_MM, 210 * PT_PER_MM],
    LETTER: [612, 792],
  };

  const fmt = (n) => (Math.round(n * 100) / 100).toString();

  function rgb(color) {
    const hex = (color || '#000000').replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const v = parseInt(full, 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

  /** PDF 的文字字串：ASCII 直接寫，含中文就用 UTF-16BE 的十六進位形式。 */
  function pdfString(s) {
    if (/^[\x20-\x7e]*$/.test(s)) {
      return `(${s.replace(/[\\()]/g, (c) => '\\' + c)})`;
    }
    let out = '<FEFF';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        out += hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
      } else {
        out += hex4(cp);
      }
    }
    return out + '>';
  }

  async function flate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const out = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  // ── 文件 ────────────────────────────────────────────────

  function create(opts = {}) {
    const size = PAGE_SIZES[(opts.size || 'A4').toUpperCase()] || PAGE_SIZES.A4;
    const landscape = !!opts.landscape;
    const width = opts.width || (landscape ? size[1] : size[0]);
    const height = opts.height || (landscape ? size[0] : size[1]);

    const pages = [];
    let page = null;
    /** 每個字型一份「用過的字符」，最後才依這份清單裁字型 */
    const fonts = [];

    function useFont(ttf, name) {
      const ref = {
        ttf,
        name: name || `F${fonts.length + 1}`,
        used: new Map(), // 原字符編號 → 代表字元（給 ToUnicode 用）
        missing: new Set(), // 這份字型沒有的字，讓上層可以提醒使用者
        gidFor(cp) {
          const gid = ttf.gidFor(cp);
          if (gid) {
            if (!this.used.has(gid)) this.used.set(gid, cp);
          } else if (cp !== 0x20 && cp !== 0x0a) {
            this.missing.add(cp);
          }
          return gid;
        },
        widthOf(cp, size) {
          return (ttf.advance(ttf.gidFor(cp)) / 1000) * size;
        },
      };
      fonts.push(ref);
      return ref;
    }

    function addPage() {
      page = { ops: [], links: [] };
      pages.push(page);
      return page;
    }

    function need() {
      if (!page) addPage();
      return page;
    }

    /**
     * 畫一行文字。x/y 是左上角座標系裡的「基線起點」。
     * bold 用描邊模擬 —— 為了少帶一份粗體字型（省 4 MB）。
     */
    function text(str, x, y, o = {}) {
      const font = o.font || fonts[0];
      if (!font || !str) return;
      const gids = [];
      for (const ch of str) gids.push(font.gidFor(ch.codePointAt(0)));
      need().ops.push({
        t: 'text', gids, x, y,
        size: o.size || 12,
        color: o.color || '#111111',
        bold: !!o.bold,
        font,
      });
    }

    function rect(x, y, w, h, o = {}) {
      need().ops.push({ t: 'rect', x, y, w, h, fill: o.fill || null, stroke: o.stroke || null, width: o.width || 1 });
    }

    function line(x1, y1, x2, y2, o = {}) {
      need().ops.push({ t: 'line', x1, y1, x2, y2, color: o.color || '#999999', width: o.width || 1 });
    }

    function link(x, y, w, h, url) {
      need().links.push({ x, y, w, h, url });
    }

    /** 量一段文字的寬度（pt），排版時用 */
    function measure(str, font, size) {
      let total = 0;
      for (const ch of str) total += font.ttf.advance(font.ttf.gidFor(ch.codePointAt(0)));
      return (total / 1000) * size;
    }

    function serialize(p) {
      for (const f of fonts) {
        if (f.used.size && !f.remap) throw new Error('內部錯誤：字型還沒子集化就要輸出內容');
      }
      const out = [];
      for (const op of p.ops) {
        if (op.t === 'text') {
          const [r, g, b] = rgb(op.color);
          // 內文寫的是「子集後」的字符編號 —— 裁字型會重新編號，
          // 這裡沒換算的話字會全部對錯，所以 serialize 一定要在裁完之後跑。
          const remap = op.font.remap;
          const hex = op.gids.map((g2) => hex4(remap ? (remap.get(g2) ?? 0) : g2)).join('');
          out.push('BT');
          out.push(`/${op.font.name} ${fmt(op.size)} Tf`);
          out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
          if (op.bold) {
            out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`);
            out.push(`${fmt(op.size * 0.035)} w 2 Tr`);
          }
          out.push(`1 0 0 1 ${fmt(op.x)} ${fmt(height - op.y)} Tm`);
          out.push(`<${hex}> Tj`);
          if (op.bold) out.push('0 Tr');
          out.push('ET');
        } else if (op.t === 'rect') {
          const box = `${fmt(op.x)} ${fmt(height - op.y - op.h)} ${fmt(op.w)} ${fmt(op.h)} re`;
          if (op.fill) {
            const [r, g, b] = rgb(op.fill);
            out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
          }
          if (op.stroke) {
            const [r, g, b] = rgb(op.stroke);
            out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(op.width)} w`);
          }
          out.push(box);
          out.push(op.fill && op.stroke ? 'B' : op.fill ? 'f' : 'S');
        } else if (op.t === 'line') {
          const [r, g, b] = rgb(op.color);
          out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(op.width)} w`);
          out.push(`${fmt(op.x1)} ${fmt(height - op.y1)} m ${fmt(op.x2)} ${fmt(height - op.y2)} l S`);
        }
      }
      return out.join('\n');
    }

    /** ToUnicode CMap —— 沒有它，PDF 裡的中文複製出來會變亂碼 */
    function toUnicode(remap, used) {
      const entries = [...used.entries()]
        .filter(([oldGid]) => remap.has(oldGid))
        .map(([oldGid, cp]) => {
          let dst = '';
          if (cp > 0xffff) {
            const v = cp - 0x10000;
            dst = hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
          } else {
            dst = hex4(cp);
          }
          return `<${hex4(remap.get(oldGid))}> <${dst}>`;
        });

      const chunks = [];
      for (let i = 0; i < entries.length; i += 100) {
        const part = entries.slice(i, i + 100);
        chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);
      }
      return [
        '/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
        '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
        '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
        '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange',
        ...chunks,
        'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end',
      ].join('\n');
    }

    /** /W 陣列：連續的 CID 可以合成一段，字型只留用到的字所以會很短 */
    function widthArray(ttf, remap) {
      const byNew = [];
      for (const [oldGid, newGid] of remap) byNew[newGid] = ttf.advance(oldGid);
      const parts = [];
      let i = 1;
      while (i < byNew.length) {
        if (byNew[i] === undefined) { i++; continue; }
        const run = [];
        let j = i;
        while (j < byNew.length && byNew[j] !== undefined) { run.push(byNew[j]); j++; }
        parts.push(`${i} [${run.join(' ')}]`);
        i = j;
      }
      return `[${parts.join(' ')}]`;
    }

    async function toBlob(meta = {}) {
      if (!pages.length) addPage();

      const objects = [];   // 1-based：objects[0] 就是物件 1
      const add = (body) => { objects.push(body); return objects.length; };
      // 先佔位，之後再填 —— 目錄與頁面樹要互相參照
      const catalogId = add(null);
      const pagesId = add(null);

      const fontRes = [];
      for (const font of fonts) {
        if (!font.used.size) { fontRes.push(null); continue; }
        const { data, remap } = font.ttf.subset(new Set(font.used.keys()));
        font.remap = remap;
        const compressed = await flate(data);
        const fileId = add({
          dict: compressed
            ? `<< /Length ${compressed.length} /Length1 ${data.length} /Filter /FlateDecode >>`
            : `<< /Length ${data.length} /Length1 ${data.length} >>`,
          stream: compressed || data,
        });
        const descId = add(
          `<< /Type /FontDescriptor /FontName /SMDoc /Flags 4 ` +
          `/FontBBox [${font.ttf.bbox.join(' ')}] /ItalicAngle ${font.ttf.italicAngle} ` +
          `/Ascent ${font.ttf.ascent} /Descent ${font.ttf.descent} ` +
          `/CapHeight ${font.ttf.capHeight} /StemV ${font.ttf.stemV} /FontFile2 ${fileId} 0 R >>`
        );
        const cidId = add(
          `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SMDoc ` +
          `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${descId} 0 R /DW 1000 /W ${widthArray(font.ttf, remap)} ` +
          `/CIDToGIDMap /Identity >>`
        );
        const cmapBytes = enc.encode(toUnicode(remap, font.used));
        const cmapZip = await flate(cmapBytes);
        const cmapId = add({
          dict: cmapZip
            ? `<< /Length ${cmapZip.length} /Filter /FlateDecode >>`
            : `<< /Length ${cmapBytes.length} >>`,
          stream: cmapZip || cmapBytes,
        });
        const fontId = add(
          `<< /Type /Font /Subtype /Type0 /BaseFont /SMDoc /Encoding /Identity-H ` +
          `/DescendantFonts [${cidId} 0 R] /ToUnicode ${cmapId} 0 R >>`
        );
        fontRes.push(`/${font.name} ${fontId} 0 R`);
      }

      const resources = `<< /Font << ${fontRes.filter(Boolean).join(' ')} >> >>`;
      const pageIds = [];
      for (const p of pages) {
        const content = enc.encode(serialize(p));
        const zipped = await flate(content);
        const contentId = add({
          dict: zipped
            ? `<< /Length ${zipped.length} /Filter /FlateDecode >>`
            : `<< /Length ${content.length} >>`,
          stream: zipped || content,
        });
        const annots = p.links.map((l) => add(
          `<< /Type /Annot /Subtype /Link /Border [0 0 0] ` +
          `/Rect [${fmt(l.x)} ${fmt(height - l.y - l.h)} ${fmt(l.x + l.w)} ${fmt(height - l.y)}] ` +
          `/A << /S /URI /URI ${pdfString(l.url)} >> >>`
        ));
        pageIds.push(add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(width)} ${fmt(height)}] ` +
          `/Resources ${resources} /Contents ${contentId} 0 R` +
          (annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(' ')}]` : '') +
          ` >>`
        ));
      }

      objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} ` +
        `/Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
      objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

      const infoId = add(
        `<< /Producer ${pdfString('ScanMail+')} ` +
        (meta.title ? `/Title ${pdfString(meta.title)} ` : '') +
        `/CreationDate ${pdfString(pdfDate(meta.now))} >>`
      );

      // ── 組檔 ──
      const parts = [];
      let length = 0;
      const push = (chunk) => {
        const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
        parts.push(bytes);
        length += bytes.length;
      };

      push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
      const offsets = [];
      objects.forEach((body, i) => {
        offsets[i] = length;
        push(`${i + 1} 0 obj\n`);
        if (body && body.stream) {
          push(`${body.dict}\nstream\n`);
          push(body.stream);
          push('\nendstream\nendobj\n');
        } else {
          push(`${body}\nendobj\n`);
        }
      });

      const xrefAt = length;
      let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
      push(xref);
      push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`);
      push(`startxref\n${xrefAt}\n%%EOF\n`);

      return new Blob(parts, { type: 'application/pdf' });
    }

    return {
      width, height, useFont, addPage, text, rect, line, link, measure, toBlob,
      get pageCount() { return pages.length; },
    };
  }

  function pdfDate(now) {
    const d = now || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  window.SMPDFWriter = { create, PAGE_SIZES, PT_PER_MM };
})();
