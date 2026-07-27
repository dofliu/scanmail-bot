/**
 * 文件轉檔 —— 全部在裝置上跑，不連後端。
 *
 * 中間隔一層共用的文件模型，所以格式之間是「任意組合」而不是寫死的
 * 每一對轉換：
 *
 *      MD ┐                    ┌ MD
 *    DOCX ┼→ 文件模型（blocks）→┼ DOCX
 *     PDF ┤                    ├ PDF
 *     TXT ┘                    ├ TXT
 *                              └ HTML
 *
 * 三個比較硬的地方：
 *   - DOCX 是一包 zip 裝 XML → zip-lite.js
 *   - PDF 要嵌中文字型 → ttf-lite.js（裁字型）+ pdf-write.js（產檔）
 *   - PDF 讀取用 pdf.js 抽文字，再靠字級與間距把段落、標題還原回來
 */
(function () {
  'use strict';

  const FONT_URL = window.SM_DOC_FONT_URL || 'vendor/fonts/NotoSansTC-Subset.ttf';

  const FORMATS = {
    md:   { label: 'Markdown', ext: 'md',   mime: 'text/markdown', accept: '.md,.markdown,.txt' },
    docx: { label: 'Word',     ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', accept: '.docx' },
    pdf:  { label: 'PDF',      ext: 'pdf',  mime: 'application/pdf', accept: '.pdf' },
    txt:  { label: '純文字',    ext: 'txt',  mime: 'text/plain', accept: '.txt' },
    html: { label: '網頁',      ext: 'html', mime: 'text/html', accept: '.html,.htm' },
    images: { label: '圖片',    ext: 'jpg',  mime: 'image/jpeg', accept: '.pdf' },
  };
  const INPUTS = ['md', 'docx', 'pdf', 'txt'];
  const OUTPUTS = ['md', 'docx', 'pdf', 'txt', 'html'];
  /** 只有 PDF 進得來的輸出：整頁繪製成圖，走的路徑跟文字轉檔完全不同 */
  const PAGE_OUTPUTS = ['images'];

  // ── 文字工具 ────────────────────────────────────────────

  const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
  // 不能出現在行首的字（避頭尾）
  const NO_LINE_START = '）〕］｝〉》」』】、。，．：；？！ー～…‧·)]}>,.:;?!%’”';
  // 不能出現在行尾的字
  const NO_LINE_END = '（〔［｛〈《「『【([{<‘“';

  const isCJK = (ch) => CJK.test(ch);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  /** 接兩段文字：中文之間不補空格，英文之間才補。 */
  function joinText(a, b) {
    if (!a) return b;
    if (!b) return a;
    const left = a[a.length - 1];
    const right = b[0];
    if (/\s/.test(left) || /\s/.test(right)) return a + b;
    if (isCJK(left) || isCJK(right)) return a + b;
    return `${a} ${b}`;
  }

  const span = (text, style) => Object.assign({ text }, style || {});
  const plain = (spans) => spans.map((s) => s.text).join('');

  // ── Markdown → 文件模型 ─────────────────────────────────

  /** 行內語法：**粗體**、*斜體*、`程式碼`、[文字](網址) */
  function parseInline(text) {
    const out = [];
    const re = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|(\*\*|__)(.+?)\3|(\*|_)(.+?)\5|`([^`]+)`|\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(span(text.slice(last, m.index)));
      if (m[2] !== undefined) out.push(span(m[1] ? `［圖片：${m[1]}］` : '［圖片］'));
      else if (m[4] !== undefined) out.push(...parseInline(m[4]).map((s) => ({ ...s, bold: true })));
      else if (m[6] !== undefined) out.push(...parseInline(m[6]).map((s) => ({ ...s, italic: true })));
      else if (m[7] !== undefined) out.push(span(m[7], { code: true }));
      else if (m[9] !== undefined) out.push(...parseInline(m[8] || m[9]).map((s) => ({ ...s, link: m[9] })));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(span(text.slice(last)));
    return out.length ? out : [span(text)];
  }

  function fromMarkdown(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let para = [];
    let list = null;
    let quote = [];

    const flushPara = () => {
      if (para.length) blocks.push({ type: 'para', spans: parseInline(para.reduce(joinText, '')) });
      para = [];
    };
    const flushList = () => { if (list) blocks.push(list); list = null; };
    const flushQuote = () => {
      if (quote.length) blocks.push({ type: 'quote', spans: parseInline(quote.reduce(joinText, '')) });
      quote = [];
    };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      if (/^```/.test(line)) {
        flushAll();
        const lang = line.slice(3).trim();
        const body = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i]), i++;
        blocks.push({ type: 'code', lang, text: body.join('\n') });
        continue;
      }

      if (!line) { flushAll(); continue; }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushAll(); blocks.push({ type: 'hr' }); continue; }

      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        flushAll();
        blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2].trim()) });
        continue;
      }

      // 表格：| a | b | 後面接 | --- | --- |
      if (line.startsWith('|') && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
        flushAll();
        const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim()));
        const rows = [cells(line)];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i++; }
        i--;
        blocks.push({ type: 'table', header: true, rows });
        continue;
      }

      const quoted = /^>\s?(.*)$/.exec(line);
      if (quoted) { flushPara(); flushList(); quote.push(quoted[1]); continue; }

      const bullet = /^([-*+])\s+(.*)$/.exec(line);
      const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        flushPara(); flushQuote();
        const indent = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length;
        const ordered = !!numbered;
        if (!list || list.ordered !== ordered) { flushList(); list = { type: 'list', ordered, items: [] }; }
        list.items.push({ level: Math.floor(indent / 2), spans: parseInline((bullet || numbered)[2]) });
        continue;
      }

      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();

    const first = blocks.find((b) => b.type === 'heading');
    return { title: first ? plain(first.spans) : '', blocks };
  }

  // ── 文件模型 → Markdown ─────────────────────────────────

  function inlineToMd(spans) {
    return spans.map((s) => {
      let t = s.text;
      if (s.code) return `\`${t}\``;
      if (s.bold) t = `**${t}**`;
      if (s.italic) t = `*${t}*`;
      if (s.link) t = `[${t}](${s.link})`;
      return t;
    }).join('');
  }

  function toMarkdown(doc) {
    const out = [];
    for (const b of doc.blocks) {
      if (b.type === 'heading') out.push(`${'#'.repeat(b.level)} ${inlineToMd(b.spans)}`, '');
      else if (b.type === 'para') out.push(inlineToMd(b.spans), '');
      else if (b.type === 'quote') out.push(`> ${inlineToMd(b.spans)}`, '');
      else if (b.type === 'hr') out.push('---', '');
      else if (b.type === 'code') out.push('```' + (b.lang || ''), b.text, '```', '');
      else if (b.type === 'list') {
        b.items.forEach((it, i) => {
          const pad = '  '.repeat(it.level || 0);
          out.push(`${pad}${b.ordered ? `${i + 1}.` : '-'} ${inlineToMd(it.spans)}`);
        });
        out.push('');
      } else if (b.type === 'table') {
        b.rows.forEach((row, i) => {
          out.push(`| ${row.map(inlineToMd).join(' | ')} |`);
          if (i === 0 && b.header) out.push(`|${row.map(() => ' --- ').join('|')}|`);
        });
        out.push('');
      }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function toText(doc) {
    const out = [];
    for (const b of doc.blocks) {
      if (b.type === 'hr') out.push('─'.repeat(20), '');
      else if (b.type === 'code') out.push(b.text, '');
      else if (b.type === 'list') {
        b.items.forEach((it, i) => out.push(`${'  '.repeat(it.level || 0)}${b.ordered ? `${i + 1}. ` : '• '}${plain(it.spans)}`));
        out.push('');
      } else if (b.type === 'table') {
        b.rows.forEach((row) => out.push(row.map(plain).join('\t')));
        out.push('');
      } else out.push(plain(b.spans), '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function toHtml(doc) {
    const inline = (spans) => spans.map((s) => {
      let t = escapeHtml(s.text);
      if (s.code) t = `<code>${t}</code>`;
      if (s.bold) t = `<strong>${t}</strong>`;
      if (s.italic) t = `<em>${t}</em>`;
      if (s.link) t = `<a href="${escapeHtml(s.link)}">${t}</a>`;
      return t;
    }).join('');

    const body = [];
    for (const b of doc.blocks) {
      if (b.type === 'heading') body.push(`<h${b.level}>${inline(b.spans)}</h${b.level}>`);
      else if (b.type === 'para') body.push(`<p>${inline(b.spans)}</p>`);
      else if (b.type === 'quote') body.push(`<blockquote>${inline(b.spans)}</blockquote>`);
      else if (b.type === 'hr') body.push('<hr/>');
      else if (b.type === 'code') body.push(`<pre><code>${escapeHtml(b.text)}</code></pre>`);
      else if (b.type === 'list') {
        const t = b.ordered ? 'ol' : 'ul';
        body.push(`<${t}>${b.items.map((it) => `<li>${inline(it.spans)}</li>`).join('')}</${t}>`);
      } else if (b.type === 'table') {
        const rows = b.rows.map((row, i) => {
          const cell = b.header && i === 0 ? 'th' : 'td';
          return `<tr>${row.map((c) => `<${cell}>${inline(c)}</${cell}>`).join('')}</tr>`;
        }).join('');
        body.push(`<table>${rows}</table>`);
      }
    }

    return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(doc.title || '文件')}</title>
<style>
body{max-width:46em;margin:2rem auto;padding:0 1.2rem;line-height:1.8;
 font-family:-apple-system,"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#222}
h1,h2,h3,h4,h5,h6{line-height:1.4;margin:1.6em 0 .6em}
code{background:#f2f2f2;padding:.1em .35em;border-radius:3px;font-size:.92em}
pre{background:#f6f6f6;padding:1em;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid #ccc;color:#555}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:.5em .7em;text-align:left}
th{background:#f6f6f6}
</style></head>
<body>
${body.join('\n')}
</body></html>
`;
  }

  // ── DOCX 讀取 ───────────────────────────────────────────

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  const kids = (node, name) =>
    Array.from(node.childNodes).filter((n) => n.nodeType === 1 && n.localName === name);
  const kid = (node, name) => kids(node, name)[0] || null;
  const attr = (node, name) => (node ? node.getAttributeNS(W_NS, name) ?? node.getAttribute(`w:${name}`) : null);

  function parseXml(text, what) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${what} 內容損壞，無法解析`);
    return doc;
  }

  /** numbering.xml：判斷某個清單是項目符號還是編號 */
  function readNumbering(xml) {
    const map = new Map();
    if (!xml) return map;
    const doc = parseXml(xml, 'numbering.xml');
    const abstract = new Map();
    for (const a of Array.from(doc.getElementsByTagNameNS(W_NS, 'abstractNum'))) {
      const id = attr(a, 'abstractNumId');
      const fmt = attr(kid(kids(a, 'lvl')[0] || a, 'numFmt'), 'val');
      abstract.set(id, fmt || 'bullet');
    }
    for (const n of Array.from(doc.getElementsByTagNameNS(W_NS, 'num'))) {
      const ref = attr(kid(n, 'abstractNumId'), 'val');
      map.set(attr(n, 'numId'), abstract.get(ref) || 'bullet');
    }
    return map;
  }

  function runSpans(node, rels) {
    const out = [];
    const walk = (parent, link) => {
      for (const child of Array.from(parent.childNodes)) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 'hyperlink') {
          const id = child.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
          walk(child, rels.get(id) || link);
        } else if (child.localName === 'r') {
          const props = kid(child, 'rPr');
          const style = {};
          if (props) {
            if (kid(props, 'b')) style.bold = attr(kid(props, 'b'), 'val') !== '0';
            if (kid(props, 'i')) style.italic = attr(kid(props, 'i'), 'val') !== '0';
            const fonts = kid(props, 'rFonts');
            const face = fonts ? (attr(fonts, 'ascii') || '') : '';
            if (/mono|consol|courier|code/i.test(face)) style.code = true;
          }
          if (link) style.link = link;
          let text = '';
          for (const bit of Array.from(child.childNodes)) {
            if (bit.nodeType !== 1) continue;
            if (bit.localName === 't') text += bit.textContent;
            else if (bit.localName === 'tab') text += '\t';
            else if (bit.localName === 'br') text += '\n';
          }
          if (text) out.push(span(text, style));
        }
      }
    };
    walk(node, null);
    return out.length ? out : [span('')];
  }

  /**
   * styles.xml：段落樣式本身就可能帶清單設定。
   * Word 的「清單段落」與 python-docx 的 List Bullet 都是這樣做的 ——
   * 段落上找不到 w:numPr，得往它套用的樣式（以及樣式的 basedOn）去找。
   */
  function readStyles(xml) {
    const styles = new Map();
    if (!xml) return styles;
    const doc = parseXml(xml, 'styles.xml');
    for (const st of Array.from(doc.getElementsByTagNameNS(W_NS, 'style'))) {
      const id = attr(st, 'styleId');
      if (!id) continue;
      const pPr = kid(st, 'pPr');
      const numPr = pPr ? kid(pPr, 'numPr') : null;
      styles.set(id, {
        name: attr(kid(st, 'name'), 'val') || '',
        basedOn: attr(kid(st, 'basedOn'), 'val') || '',
        numId: numPr ? attr(kid(numPr, 'numId'), 'val') : null,
        level: numPr ? +(attr(kid(numPr, 'ilvl'), 'val') || 0) : null,
        outline: pPr && kid(pPr, 'outlineLvl') ? +attr(kid(pPr, 'outlineLvl'), 'val') : null,
      });
    }
    return styles;
  }

  /** 沿著 basedOn 往上找，補齊這個樣式沒寫明的部分。 */
  function resolveStyle(styles, id) {
    const out = { id: id || '', name: '', numId: null, level: null, outline: null };
    let cursor = id;
    for (let hops = 0; cursor && hops < 10; hops++) {
      const st = styles.get(cursor);
      if (!st) break;
      if (!out.name) out.name = st.name;
      if (out.numId === null) { out.numId = st.numId; out.level = st.level; }
      if (out.outline === null) out.outline = st.outline;
      cursor = st.basedOn;
    }
    return out;
  }

  function paragraphInfo(p, styles) {
    const props = kid(p, 'pPr');
    const id = props ? attr(kid(props, 'pStyle'), 'val') || '' : '';
    const numPr = props ? kid(props, 'numPr') : null;
    const st = resolveStyle(styles, id);
    const label = `${id} ${st.name}`;

    // 標題可能寫成 styleId（Heading2）、樣式名稱（heading 2）或大綱階層
    const byId = /^Heading(\d)$/i.exec(id);
    const byName = /^heading\s*(\d)$/i.exec(st.name);
    let heading = byId ? +byId[1] : byName ? +byName[1] : 0;
    if (!heading && /^Title$/i.test(id)) heading = 1;
    if (!heading && st.outline !== null && st.outline < 6 && !/List/i.test(label)) heading = st.outline + 1;

    const ownNum = numPr ? attr(kid(numPr, 'numId'), 'val') : null;
    return {
      style: id,
      heading,
      quote: /quote/i.test(label),
      code: /^(Code|HTMLPreformatted|SourceCode)$/i.test(id) || /preformatted/i.test(st.name),
      numId: ownNum !== null ? ownNum : st.numId,
      level: numPr ? +(attr(kid(numPr, 'ilvl'), 'val') || 0) : (st.level || 0),
      // 樣式名稱是最後的線索：List Number 是編號、List Bullet 是項目符號
      styleOrdered: /number/i.test(st.name) ? true : /bullet/i.test(st.name) ? false : null,
    };
  }

  async function fromDocx(buffer) {
    if (!window.SMZip) throw new Error('缺少 zip 模組');
    const files = await window.SMZip.read(buffer);
    const main = window.SMZip.textOf(files, 'word/document.xml');
    if (!main) throw new Error('這不是有效的 Word 檔（找不到 word/document.xml）');

    const rels = new Map();
    const relsXml = window.SMZip.textOf(files, 'word/_rels/document.xml.rels');
    if (relsXml) {
      for (const r of Array.from(parseXml(relsXml, 'document.xml.rels').getElementsByTagName('Relationship'))) {
        if ((r.getAttribute('Type') || '').endsWith('/hyperlink')) {
          rels.set(r.getAttribute('Id'), r.getAttribute('Target'));
        }
      }
    }
    const numbering = readNumbering(window.SMZip.textOf(files, 'word/numbering.xml'));
    const styles = readStyles(window.SMZip.textOf(files, 'word/styles.xml'));

    const doc = parseXml(main, 'document.xml');
    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!body) throw new Error('Word 檔沒有內容');

    const blocks = [];
    let list = null;
    const flushList = () => { if (list) blocks.push(list); list = null; };

    for (const node of Array.from(body.childNodes)) {
      if (node.nodeType !== 1) continue;

      if (node.localName === 'tbl') {
        flushList();
        const rows = kids(node, 'tr').map((tr) =>
          kids(tr, 'tc').map((tc) => kids(tc, 'p').flatMap((p) => runSpans(p, rels))));
        if (rows.length) blocks.push({ type: 'table', header: true, rows });
        continue;
      }
      if (node.localName !== 'p') continue;

      const info = paragraphInfo(node, styles);
      const spans = runSpans(node, rels);
      const text = plain(spans);

      if (info.numId) {
        const fmt = numbering.get(info.numId);
        const ordered = fmt ? fmt !== 'bullet' : (info.styleOrdered ?? false);
        if (!list || list.ordered !== ordered) { flushList(); list = { type: 'list', ordered, items: [] }; }
        list.items.push({ level: info.level, spans });
        continue;
      }
      flushList();

      if (!text.trim()) continue;
      if (info.heading) blocks.push({ type: 'heading', level: Math.min(6, info.heading), spans });
      else if (info.code) blocks.push({ type: 'code', lang: '', text });
      else if (info.quote) blocks.push({ type: 'quote', spans });
      else blocks.push({ type: 'para', spans });
    }
    flushList();

    const first = blocks.find((b) => b.type === 'heading');
    return { title: first ? plain(first.spans) : '', blocks };
  }

  // ── DOCX 產生 ───────────────────────────────────────────

  const DOCX_CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const DOCX_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  function docxStyles() {
    const heads = [32, 26, 22, 20, 18, 16].map((half, i) => `
<w:style w:type="paragraph" w:styleId="Heading${i + 1}">
<w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/>
<w:pPr><w:keepNext/><w:spacing w:before="${280 - i * 30}" w:after="${140 - i * 10}"/><w:outlineLvl w:val="${i}"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr></w:style>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft JhengHei" w:cs="Calibri"/>
<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heads}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>
<w:pPr><w:ind w:left="480"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/>
<w:pPr><w:shd w:val="clear" w:fill="F4F4F4"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="240"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
</w:styles>`;
  }

  function docxNumbering() {
    const levels = (fmt, text) => Array.from({ length: 9 }, (_, i) => `
<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>
<w:lvlText w:val="${fmt === 'bullet' ? text : `%${i + 1}.`}"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="${480 + i * 420}" w:hanging="420"/></w:pPr>
${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>' : ''}</w:lvl>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NS}">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels('bullet', '•')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels('decimal', '')}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
  }

  function docxRun(s, rels) {
    const props = [];
    if (s.bold) props.push('<w:b/>');
    if (s.italic) props.push('<w:i/>');
    if (s.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F0F0F0"/>');
    if (s.link) props.push('<w:color w:val="1155CC"/><w:u w:val="single"/>');
    const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
    // 換行要拆成多個 run，中間插 <w:br/>
    const body = String(s.text).split('\n').map((part, i) =>
      (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('');
    const run = `<w:r>${rPr}${body}</w:r>`;
    if (!s.link) return run;
    const id = rels.add(s.link);
    return `<w:hyperlink r:id="${id}">${run}</w:hyperlink>`;
  }

  function docxParagraph(spans, opts, rels) {
    const pPr = [];
    if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
    if (opts.numId) pPr.push(`<w:numPr><w:ilvl w:val="${opts.level || 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
    if (opts.border) pPr.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CCCCCC"/></w:pBdr>');
    const head = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
    return `<w:p>${head}${spans.map((s) => docxRun(s, rels)).join('')}</w:p>`;
  }

  async function toDocx(doc) {
    if (!window.SMZip) throw new Error('缺少 zip 模組');
    const links = [];
    const rels = { add: (url) => { links.push(url); return `rIdL${links.length}`; } };

    const parts = [];
    for (const b of doc.blocks) {
      if (b.type === 'heading') parts.push(docxParagraph(b.spans, { style: `Heading${Math.min(6, b.level)}` }, rels));
      else if (b.type === 'para') parts.push(docxParagraph(b.spans, {}, rels));
      else if (b.type === 'quote') parts.push(docxParagraph(b.spans, { style: 'Quote' }, rels));
      else if (b.type === 'hr') parts.push(docxParagraph([span('')], { border: true }, rels));
      else if (b.type === 'code') {
        for (const line of b.text.split('\n')) parts.push(docxParagraph([span(line || ' ')], { style: 'Code' }, rels));
      } else if (b.type === 'list') {
        for (const it of b.items) {
          parts.push(docxParagraph(it.spans, {
            style: 'ListParagraph', numId: b.ordered ? 2 : 1, level: Math.min(8, it.level || 0),
          }, rels));
        }
      } else if (b.type === 'table') {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const width = Math.floor(9360 / cols);
        // w:tblGrid 是 OOXML 的必要元素 —— Word 少了它還開得起來，
        // 但嚴謹一點的解析器（例如 python-docx）會直接判定檔案無效
        const grid = `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(cols)}</w:tblGrid>`;
        const rows = b.rows.map((row, r) => {
          const cells = row.map((cell) => {
            const spans = r === 0 && b.header ? cell.map((s) => ({ ...s, bold: true })) : cell;
            const shade = r === 0 && b.header ? '<w:shd w:val="clear" w:fill="F2F2F2"/>' : '';
            return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>` +
              `${docxParagraph(spans.length ? spans : [span('')], {}, rels)}</w:tc>`;
          }).join('');
          return `<w:tr>${cells}</w:tr>`;
        }).join('');
        parts.push(
          '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
          '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
            .map((s) => `<w:${s} w:val="single" w:sz="4" w:color="BFBFBF"/>`).join('') +
          '</w:tblBorders></w:tblPr>' + grid + rows + '</w:tbl>' +
          '<w:p/>'
        );
      }
    }

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${links.map((url, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(url)}" TargetMode="External"/>`).join('\n')}
</Relationships>`;

    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

    return window.SMZip.write([
      { name: '[Content_Types].xml', data: DOCX_CT },
      { name: '_rels/.rels', data: DOCX_RELS },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: docxStyles() },
      { name: 'word/numbering.xml', data: docxNumbering() },
      { name: 'word/_rels/document.xml.rels', data: relsXml },
    ]);
  }

  // ── PDF 讀取 ────────────────────────────────────────────

  /**
   * pdf.js 會把傳進去的緩衝區「接管」（detach），原本那份就不能再用了。
   * 同一份 PDF 想先抽文字、再轉成圖片就會炸掉，所以一律先複製一份給它。
   */
  function pdfBytes(input) {
    const view = input instanceof Uint8Array ? input : new Uint8Array(input);
    return view.slice();
  }

  /**
   * PDF 裡沒有「段落」這種東西，只有一堆帶座標的文字片段。
   * 這裡靠三件事還原結構：字級（比內文大就是標題）、
   * 行距（跳太多行就是新段落）、行首符號（項目符號 / 編號）。
   */
  async function fromPdf(buffer, onProgress) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('缺少 pdf.js，無法讀取 PDF');
    const pdf = await pdfjs.getDocument({ data: pdfBytes(buffer) }).promise;

    const lines = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (onProgress) onProgress(Math.round((n - 1) / pdf.numPages * 60), `讀取第 ${n}/${pdf.numPages} 頁`);
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const buckets = [];
      for (const item of content.items) {
        if (!item.str) continue;
        const [a, b, , d, x, y] = item.transform;
        const size = Math.abs(d) || Math.hypot(b, d) || Math.hypot(a, b) || 10;
        const found = buckets.find((l) => Math.abs(l.y - y) < Math.max(1.5, size * 0.4));
        if (found) {
          found.parts.push({ x, str: item.str });
          found.size = Math.max(found.size, size);
        } else {
          buckets.push({ y, size, parts: [{ x, str: item.str }] });
        }
      }
      buckets.sort((p, q) => q.y - p.y);
      for (const b of buckets) {
        b.parts.sort((p, q) => p.x - q.x);
        const text = b.parts.reduce((acc, p) => joinText(acc, p.str), '').trim();
        if (text) lines.push({ text, size: b.size, y: b.y, page: n, x: Math.min(...b.parts.map((p) => p.x)) });
      }
      lines.push(null); // 換頁
    }

    const real = lines.filter(Boolean);
    if (!real.length) {
      throw new Error('這份 PDF 抽不到文字 —— 可能是掃描的圖片檔，需要 OCR 才讀得出來');
    }

    // 內文字級 = 出現最多的字級（四捨五入到 0.5pt）
    const tally = new Map();
    for (const l of real) {
      const key = Math.round(l.size * 2) / 2;
      tally.set(key, (tally.get(key) || 0) + l.text.length);
    }
    const bodySize = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const leftEdge = Math.min(...real.map((l) => l.x));

    const blocks = [];
    let para = null;
    let list = null;
    const flushPara = () => { if (para) blocks.push({ type: 'para', spans: [span(para)] }); para = null; };
    const flushList = () => { if (list) blocks.push(list); list = null; };

    let prev = null;
    for (const line of lines) {
      if (!line) { prev = null; continue; }
      const { text, size } = line;

      const bullet = /^[•·‧∙▪◦●○\-–—*]\s*(.+)$/.exec(text);
      const numbered = /^(\d+)[.)、]\s*(.+)$/.exec(text);
      if (bullet || numbered) {
        flushPara();
        const ordered = !!numbered;
        if (!list || list.ordered !== ordered) { flushList(); list = { type: 'list', ordered, items: [] }; }
        list.items.push({ level: Math.max(0, Math.round((line.x - leftEdge) / 24)), spans: [span((bullet || numbered)[bullet ? 1 : 2])] });
        prev = line;
        continue;
      }
      flushList();

      if (size > bodySize * 1.12) {
        flushPara();
        const ratio = size / bodySize;
        const level = ratio > 1.7 ? 1 : ratio > 1.4 ? 2 : ratio > 1.2 ? 3 : 4;
        blocks.push({ type: 'heading', level, spans: [span(text)] });
        prev = line;
        continue;
      }

      // 行距明顯變大、或上一行以句號收尾 → 視為新段落
      const gap = prev && prev.page === line.page ? prev.y - line.y : Infinity;
      const newPara = !prev || gap > size * 1.9 || /[。！？；.!?]$/.test(prev.text);
      if (newPara) { flushPara(); para = text; } else { para = joinText(para, text); }
      prev = line;
    }
    flushPara();
    flushList();

    const first = blocks.find((b) => b.type === 'heading');
    return { title: first ? plain(first.spans) : '', blocks, pages: pdf.numPages };
  }

  // ── PDF 產生 ────────────────────────────────────────────

  let fontPromise = null;
  /** 中文字型只載一次，之後放著重複用 —— 4.5 MB 不該每次轉檔都重讀 */
  function loadFont(url) {
    if (!fontPromise) {
      fontPromise = fetch(url || FONT_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`載入中文字型失敗（HTTP ${r.status}）`);
          return r.arrayBuffer();
        })
        .then((buf) => {
          const font = window.SMTTF.parse(buf);
          if (!font.has(0x4e2d)) throw new Error('中文字型檔不完整，無法輸出 PDF');
          return font;
        })
        .catch((e) => { fontPromise = null; throw e; });
    }
    return fontPromise;
  }

  /**
   * 把一段文字切成可斷行的最小單位：
   * 中日韓每個字都能斷，英數則整個字不能拆開。
   */
  function tokenize(text) {
    const units = [];
    let buf = '';
    for (const ch of text) {
      if (ch === ' ' || ch === '\t') {
        if (buf) { units.push(buf); buf = ''; }
        units.push(' ');
      } else if (isCJK(ch)) {
        if (buf) { units.push(buf); buf = ''; }
        units.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) units.push(buf);
    return units;
  }

  /** 貪婪斷行，順便處理避頭尾。回傳每行的 span 陣列。 */
  function wrapSpans(spans, maxWidth, font, sizeOf) {
    const lines = [];
    let line = [];
    let width = 0;

    const push = () => {
      while (line.length && line[line.length - 1].text === ' ') line.pop();
      lines.push(line);
      line = [];
      width = 0;
    };

    for (const s of spans) {
      const size = sizeOf(s);
      const segments = String(s.text).split('\n');
      segments.forEach((segment, si) => {
        if (si > 0) push();
        for (const unit of splitLong(tokenize(segment), maxWidth, font, size)) {
          const w = measureWith(font, unit, size);
          if (width + w > maxWidth && line.length) {
            // 避頭尾：這個單位不該出現在行首，就把前一個單位一起帶下來
            if (NO_LINE_START.includes(unit[0]) && line.length > 1) {
              const moved = line.pop();
              width -= moved.w;
              push();
              line.push(moved);
              width = moved.w;
            } else if (line.length && NO_LINE_END.includes(line[line.length - 1].text)) {
              const moved = line.pop();
              width -= moved.w;
              push();
              line.push(moved);
              width = moved.w;
            } else {
              push();
            }
            if (unit === ' ') continue;
          }
          line.push({ text: unit, style: s, size, w });
          width += w;
        }
      });
    }
    if (line.length) push();
    return lines.length ? lines : [[]];
  }

  /** 單一個單位就比整行還寬（超長網址之類）時，只好逐字拆開。 */
  function splitLong(units, maxWidth, font, size) {
    const out = [];
    for (const unit of units) {
      if (unit.length < 2 || measureWith(font, unit, size) <= maxWidth) { out.push(unit); continue; }
      let buf = '';
      for (const ch of unit) {
        if (buf && measureWith(font, buf + ch, size) > maxWidth) { out.push(buf); buf = ''; }
        buf += ch;
      }
      if (buf) out.push(buf);
    }
    return out;
  }

  function measureWith(font, text, size) {
    let total = 0;
    for (const ch of text) total += font.ttf.advance(font.ttf.gidFor(ch.codePointAt(0)));
    return (total / 1000) * size;
  }

  const PDF_THEME = {
    margin: 56,
    body: 11,
    lineHeight: 1.75,
    heading: [21, 17.5, 15, 13.5, 12.5, 11.5],
    color: '#1a1a1a',
    muted: '#5c5c5c',
    rule: '#d5d5d5',
    codeBg: '#f4f4f2',
  };

  async function toPdf(doc, opts = {}) {
    const ttf = await loadFont(opts.fontUrl);
    const theme = { ...PDF_THEME, ...(opts.theme || {}) };
    const pdf = window.SMPDFWriter.create({
      size: opts.pageSize || 'A4',
      landscape: !!opts.landscape,
    });
    const font = pdf.useFont(ttf, 'F1');
    const margin = theme.margin;
    const right = pdf.width - margin;
    const bottom = pdf.height - margin;
    const contentWidth = right - margin;

    let y = margin;
    pdf.addPage();

    const room = (h) => {
      if (y + h <= bottom) return;
      pdf.addPage();
      y = margin;
    };

    const drawLines = (lines, x, o = {}) => {
      const lead = (o.size || theme.body) * (o.lineHeight || theme.lineHeight);
      for (const line of lines) {
        room(lead);
        let cursor = x;
        for (const piece of line) {
          const style = piece.style || {};
          const color = o.color || (style.link ? '#1155cc' : theme.color);
          pdf.text(piece.text, cursor, y + (o.size || theme.body) * 0.82, {
            font, size: piece.size, color,
            bold: !!style.bold || !!o.bold,
          });
          if (style.link) {
            pdf.link(cursor, y, piece.w, lead, style.link);
            pdf.line(cursor, y + (o.size || theme.body) * 0.98, cursor + piece.w,
              y + (o.size || theme.body) * 0.98, { color, width: 0.5 });
          }
          cursor += piece.w;
        }
        y += lead;
      }
    };

    const para = (spans, x, maxWidth, o = {}) => {
      const size = o.size || theme.body;
      const lines = wrapSpans(spans, maxWidth, font, (s) => (s.code ? size * 0.94 : size));
      drawLines(lines, x, { ...o, size });
    };

    for (const b of doc.blocks) {
      if (b.type === 'heading') {
        const size = theme.heading[Math.min(5, b.level - 1)];
        y += size * 0.7;
        room(size * 2);
        para(b.spans, margin, contentWidth, { size, bold: true, lineHeight: 1.35 });
        y += size * 0.25;
      } else if (b.type === 'para') {
        para(b.spans, margin, contentWidth);
        y += theme.body * 0.45;
      } else if (b.type === 'quote') {
        const top = y;
        para(b.spans, margin + 16, contentWidth - 16, { color: theme.muted });
        pdf.rect(margin, top, 3, Math.max(4, y - top - 2), { fill: theme.rule });
        y += theme.body * 0.45;
      } else if (b.type === 'hr') {
        room(14);
        y += 6;
        pdf.line(margin, y, right, y, { color: theme.rule, width: 0.8 });
        y += 10;
      } else if (b.type === 'code') {
        const size = theme.body * 0.92;
        const lead = size * 1.5;
        const wrapped = b.text.split('\n').flatMap((row) =>
          wrapSpans([span(row || ' ')], contentWidth - 20, font, () => size));
        // 底色得先畫，後畫會蓋掉文字。整塊放不下就換頁；換頁還放不下（超長程式碼）
        // 就只畫文字讓它自然跨頁，不硬塞一塊對不上的底色。
        const boxHeight = wrapped.length * lead + 16;
        if (y + boxHeight > bottom && boxHeight <= bottom - margin) { pdf.addPage(); y = margin; }
        const shaded = y + boxHeight <= bottom;
        if (shaded) pdf.rect(margin, y, contentWidth, boxHeight, { fill: theme.codeBg });
        y += 8;
        drawLines(wrapped, margin + 10, { size, lineHeight: 1.5, color: '#2a2a2a' });
        y += 8 + 6;
      } else if (b.type === 'list') {
        for (let i = 0; i < b.items.length; i++) {
          const it = b.items[i];
          const indent = 14 + (it.level || 0) * 16;
          const marker = b.ordered ? `${i + 1}.` : '•';
          const markerWidth = measureWith(font, marker + ' ', theme.body);
          room(theme.body * theme.lineHeight);
          pdf.text(marker, margin + indent, y + theme.body * 0.82, { font, size: theme.body, color: theme.color });
          para(it.spans, margin + indent + markerWidth, contentWidth - indent - markerWidth, { lineHeight: 1.6 });
        }
        y += theme.body * 0.45;
      } else if (b.type === 'table') {
        const cols = Math.max(1, ...b.rows.map((r) => r.length));
        const colWidth = contentWidth / cols;
        for (let r = 0; r < b.rows.length; r++) {
          const row = b.rows[r];
          const header = r === 0 && b.header;
          const cellLines = row.map((cell) =>
            wrapSpans(header ? cell.map((s) => ({ ...s, bold: true })) : cell,
              colWidth - 12, font, () => theme.body * 0.95));
          const height = Math.max(...cellLines.map((l) => l.length)) * theme.body * 1.5 + 8;
          room(height);
          const top = y;
          if (header) pdf.rect(margin, top, contentWidth, height, { fill: '#f2f2f0' });
          for (let c = 0; c < row.length; c++) {
            const x = margin + c * colWidth;
            pdf.rect(x, top, colWidth, height, { stroke: theme.rule, width: 0.6 });
            y = top + 4;
            drawLines(cellLines[c], x + 6, { size: theme.body * 0.95, lineHeight: 1.5 });
          }
          y = top + height;
        }
        y += theme.body * 0.6;
      }
    }

    const blob = await pdf.toBlob({ title: doc.title || opts.title || '' });
    return { blob, missing: [...font.missing].map((cp) => String.fromCodePoint(cp)) };
  }

  // ── PDF → 圖片 ──────────────────────────────────────────

  /**
   * 每頁算成一張圖。走的是 pdf.js 的完整繪製（不是只抽文字），
   * 所以掃描件、表格、圖表都能原樣存成圖片。
   *
   * @param {{dpi, format, quality}} opts dpi 預設 150 —— 螢幕看清楚、檔案又不會太大
   */
  async function pdfToImages(buffer, opts = {}, onProgress) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('缺少 pdf.js，無法讀取 PDF');
    const dpi = Math.max(72, Math.min(600, opts.dpi || 150));
    const format = (opts.format || 'JPG').toUpperCase();
    const pdf = await pdfjs.getDocument({ data: pdfBytes(buffer) }).promise;

    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      if (onProgress) onProgress(Math.round((n - 1) / pdf.numPages * 95), `繪製第 ${n}/${pdf.numPages} 頁`);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      // PDF 的頁面背景是「沒有顏色」，直接存成 JPG 會變黑底
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('圖片編碼失敗'))),
        format === 'PNG' ? 'image/png' : 'image/jpeg',
        Math.min(1, Math.max(0.01, (opts.quality == null ? 88 : opts.quality) / 100))
      ));
      out.push({ blob, page: n, ext: format === 'PNG' ? 'png' : 'jpg' });
    }
    return out;
  }

  /**
   * 頁面縮圖。逐頁回呼 —— 一份 30 頁的 PDF 全部畫完要好幾秒，
   * 畫好一張就先顯示一張，使用者不用對著空白畫面等。
   */
  async function pdfThumbnails(buffer, opts = {}, onPage) {
    const pdfjs = window.pdfjsLib;
    if (!pdfjs) throw new Error('缺少 pdf.js，無法讀取 PDF');
    const maxWidth = opts.maxWidth || 160;
    const pdf = await pdfjs.getDocument({ data: pdfBytes(buffer) }).promise;

    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, maxWidth / base.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const url = canvas.toDataURL('image/jpeg', 0.7);
      out.push(url);
      if (onPage) onPage(n - 1, url, pdf.numPages);
    }
    return out;
  }

  // ── 對外 ────────────────────────────────────────────────

  function detect(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
    if (name.endsWith('.txt')) return 'txt';
    if (file.type === 'application/pdf') return 'pdf';
    if ((file.type || '').includes('wordprocessingml')) return 'docx';
    return 'md';
  }

  async function parse(file, onProgress) {
    const kind = detect(file);
    if (kind === 'docx') return { doc: await fromDocx(await file.arrayBuffer()), kind };
    if (kind === 'pdf') return { doc: await fromPdf(await file.arrayBuffer(), onProgress), kind };
    const text = await file.text();
    return { doc: kind === 'txt' ? fromMarkdown(text) : fromMarkdown(text), kind };
  }

  async function render(doc, target, opts = {}) {
    if (target === 'md') return { blob: new Blob([toMarkdown(doc)], { type: 'text/markdown' }) };
    if (target === 'txt') return { blob: new Blob([toText(doc)], { type: 'text/plain' }) };
    if (target === 'html') return { blob: new Blob([toHtml(doc)], { type: 'text/html' }) };
    if (target === 'docx') return { blob: await toDocx(doc) };
    if (target === 'pdf') return toPdf(doc, opts);
    throw new Error(`不支援輸出成 ${target}`);
  }

  /** 一步到位：檔案 → 目標格式的 Blob。 */
  async function convert(file, target, opts = {}, onProgress) {
    const step = onProgress || (() => {});
    step(5, '讀取檔案');
    const { doc } = await parse(file, step);
    step(70, '產生' + (FORMATS[target] ? FORMATS[target].label : target));
    const result = await render(doc, target, opts);
    step(100, '完成');
    const base = (file.name || '文件').replace(/\.[^.]+$/, '');
    return { ...result, doc, name: `${base}.${FORMATS[target].ext}` };
  }

  window.SMDocLocal = {
    get available() {
      return !!(window.SMZip && window.SMZip.available && window.SMTTF && window.SMPDFWriter);
    },
    FORMATS, INPUTS, OUTPUTS, PAGE_OUTPUTS,
    detect, parse, render, convert, loadFont, pdfToImages, pdfThumbnails,
    fromMarkdown, toMarkdown, fromDocx, toDocx, fromPdf, toPdf, toHtml, toText,
    // 測試用
    _internals: { parseInline, wrapSpans, tokenize, joinText },
  };
})();
