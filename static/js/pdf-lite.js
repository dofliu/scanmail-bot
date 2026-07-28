/**
 * PDF 物件層 —— 拆得開、也組得回去。
 *
 * 合併、刪頁、抽頁、重排這些事，光靠 pdf.js 做不到：pdf.js 是「畫出來」的，
 * 把頁面畫成圖再組回去，文字就沒了。要無損就得直接動 PDF 的物件結構：
 *
 *   讀 xref → 解析物件 → 走頁面樹 → 挑出要的頁面 →
 *   連同它參照到的東西整包複製 → 重新編號 → 寫出新檔
 *
 * 關鍵在於「內容串流原封不動搬過去」—— 不解碼、不重新編碼，
 * 所以文字還是文字、圖還是原本那張圖，檔案大小也不會膨脹。
 *
 * 支援範圍刻意壓到頁面操作需要的部分：
 *   - 傳統 xref 表與 xref 串流（PDF 1.5 之後的寫法）都讀
 *   - 物件串流（ObjStm）會展開
 *   - xref 壞掉時退回全檔掃描 —— 真實世界的 PDF 常常有點壞
 *   - 加密的 PDF 直接拒絕，不會給出壞掉的輸出
 */
(function () {
  'use strict';

  // ── 值的表示法 ──────────────────────────────────────────
  // 字典用 Map（保留順序），其餘用小類別區分，免得跟原生字串 / 陣列混淆

  class PdfName {
    constructor(name) { this.name = name; }
  }
  class PdfRef {
    constructor(num, gen) { this.num = num; this.gen = gen || 0; }
  }
  class PdfString {
    constructor(bytes) { this.bytes = bytes; }
  }
  class PdfStream {
    constructor(dict, raw) { this.dict = dict; this.raw = raw; }
  }

  const isName = (v, n) => v instanceof PdfName && (n === undefined || v.name === n);
  const isDict = (v) => v instanceof Map;
  /** 給 `new Map(...)` 用：不是字典就當空的，省得每次都要三元判斷 */
  const asDict = (v) => (isDict(v) ? v : []);

  // ── 位元組層的小工具 ────────────────────────────────────

  const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
  const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
  const isWhite = (c) => WHITE.has(c);
  const isRegular = (c) => !WHITE.has(c) && !DELIM.has(c);

  const latin = new TextDecoder('latin1');
  const enc = new TextEncoder();

  function indexOfBytes(haystack, needle, from) {
    outer: for (let i = from; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  function lastIndexOfBytes(haystack, needle, from) {
    outer: for (let i = Math.min(from, haystack.length - needle.length); i >= 0; i--) {
      for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('這個瀏覽器不支援解壓縮，無法讀取這份 PDF');
    }
    // PDF 的 FlateDecode 是 zlib 格式，但少數產生器會寫成原始 deflate
    for (const format of ['deflate', 'deflate-raw']) {
      try {
        const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(out).arrayBuffer());
      } catch (e) { /* 換下一種 */ }
    }
    throw new Error('PDF 內部資料解壓縮失敗');
  }

  /**
   * PNG 預測子（xref 串流幾乎都會用）。每列開頭多一個位元組標示這一列用哪種預測，
   * 要把它還原回原始資料才讀得到 xref 表格。
   */
  function unpredict(data, colors, bitsPerComponent, columns) {
    const bpp = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
    const rowLen = Math.ceil((colors * bitsPerComponent * columns) / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);

    for (let r = 0; r < rows; r++) {
      const kind = data[r * (rowLen + 1)];
      const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const row = out.subarray(r * rowLen, (r + 1) * rowLen);
      row.set(src);
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        if (kind === 1) row[i] = (row[i] + a) & 255;
        else if (kind === 2) row[i] = (row[i] + b) & 255;
        else if (kind === 3) row[i] = (row[i] + ((a + b) >> 1)) & 255;
        else if (kind === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      prev = row;
    }
    return out;
  }

  // ── 解析器 ──────────────────────────────────────────────

  class Lexer {
    constructor(bytes, pos = 0) {
      this.bytes = bytes;
      this.pos = pos;
    }

    skipWs() {
      const b = this.bytes;
      while (this.pos < b.length) {
        if (isWhite(b[this.pos])) { this.pos++; continue; }
        if (b[this.pos] === 0x25) { // % 註解到行尾
          while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
          continue;
        }
        break;
      }
    }

    /** 讀一段「一般字元」，名稱與關鍵字都靠它 */
    readToken() {
      this.skipWs();
      const start = this.pos;
      while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) this.pos++;
      return latin.decode(this.bytes.subarray(start, this.pos));
    }

    peekKeyword(word) {
      const save = this.pos;
      const token = this.readToken();
      if (token === word) return true;
      this.pos = save;
      return false;
    }

    readName() {
      this.pos++; // 跳過 /
      const out = [];
      while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) {
        let c = this.bytes[this.pos++];
        if (c === 0x23 && this.pos + 1 < this.bytes.length) { // #xx 逃逸
          const hex = latin.decode(this.bytes.subarray(this.pos, this.pos + 2));
          if (/^[0-9a-fA-F]{2}$/.test(hex)) { c = parseInt(hex, 16); this.pos += 2; }
        }
        out.push(c);
      }
      return new PdfName(latin.decode(Uint8Array.from(out)));
    }

    readLiteralString() {
      this.pos++; // (
      const out = [];
      let depth = 1;
      while (this.pos < this.bytes.length) {
        let c = this.bytes[this.pos++];
        if (c === 0x5c) { // 反斜線
          const n = this.bytes[this.pos++];
          const map = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
          if (map[n] !== undefined) out.push(map[n]);
          else if (n >= 0x30 && n <= 0x37) { // 八進位
            let oct = String.fromCharCode(n);
            for (let i = 0; i < 2 && this.bytes[this.pos] >= 0x30 && this.bytes[this.pos] <= 0x37; i++) {
              oct += String.fromCharCode(this.bytes[this.pos++]);
            }
            out.push(parseInt(oct, 8) & 255);
          } else if (n === 0x0a) { /* 續行，什麼都不加 */ }
          else if (n === 0x0d) { if (this.bytes[this.pos] === 0x0a) this.pos++; }
          else out.push(n);
          continue;
        }
        if (c === 0x28) depth++;
        if (c === 0x29) { depth--; if (!depth) break; }
        out.push(c);
      }
      return new PdfString(Uint8Array.from(out));
    }

    readHexString() {
      this.pos++; // <
      const digits = [];
      while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x3e) {
        const c = this.bytes[this.pos++];
        if (!isWhite(c)) digits.push(String.fromCharCode(c));
      }
      this.pos++; // >
      if (digits.length % 2) digits.push('0');
      const out = new Uint8Array(digits.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(digits[i * 2] + digits[i * 2 + 1], 16) || 0;
      return new PdfString(out);
    }

    /**
     * 解析一個物件。
     * @param {(ref) => any} resolve 用來查 /Length 之類的間接參照（可省略）
     */
    parse(resolve) {
      this.skipWs();
      const c = this.bytes[this.pos];
      if (c === undefined) return null;

      if (c === 0x2f) return this.readName();
      if (c === 0x28) return this.readLiteralString();
      if (c === 0x5b) { // [
        this.pos++;
        const arr = [];
        for (;;) {
          this.skipWs();
          if (this.bytes[this.pos] === 0x5d) { this.pos++; break; }
          if (this.pos >= this.bytes.length) break;
          arr.push(this.parse(resolve));
        }
        return arr;
      }
      if (c === 0x3c) {
        if (this.bytes[this.pos + 1] !== 0x3c) return this.readHexString();
        this.pos += 2;
        const dict = new Map();
        for (;;) {
          this.skipWs();
          if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) { this.pos += 2; break; }
          if (this.pos >= this.bytes.length) break;
          const key = this.parse(resolve);
          if (!(key instanceof PdfName)) break; // 結構壞了，停在這裡
          dict.set(key.name, this.parse(resolve));
        }
        return this.maybeStream(dict, resolve);
      }

      if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
        return this.readNumberOrRef();
      }

      const token = this.readToken();
      if (token === 'true') return true;
      if (token === 'false') return false;
      if (token === 'null') return null;
      if (token === '') { this.pos++; return null; } // 遇到不認得的分隔符，往前挪一格避免卡住
      return null;
    }

    /** 「3 0 R」跟「3」「0」兩個數字長得一樣，只能往前試探 */
    readNumberOrRef() {
      const first = parseFloat(this.readToken());
      if (!Number.isInteger(first) || first < 0) return first;
      const save = this.pos;
      const second = this.readToken();
      if (/^\d+$/.test(second)) {
        const after = this.pos;
        if (this.readToken() === 'R') return new PdfRef(first, parseInt(second, 10));
        this.pos = after;
      }
      this.pos = save;
      return first;
    }

    maybeStream(dict, resolve) {
      const save = this.pos;
      this.skipWs();
      if (!this.peekKeyword('stream')) { this.pos = save; return dict; }
      // stream 關鍵字後面固定接 CRLF 或 LF
      if (this.bytes[this.pos] === 0x0d) this.pos++;
      if (this.bytes[this.pos] === 0x0a) this.pos++;
      const start = this.pos;

      let length = dict.get('Length');
      if (length instanceof PdfRef && resolve) length = resolve(length);

      let end = -1;
      if (typeof length === 'number' && length >= 0 && start + length <= this.bytes.length) {
        const probe = new Lexer(this.bytes, start + length);
        probe.skipWs();
        if (probe.peekKeyword('endstream')) end = start + length;
      }
      if (end < 0) {
        // /Length 不可信（常見於手工改過的檔案）—— 直接找 endstream
        end = indexOfBytes(this.bytes, enc.encode('endstream'), start);
        if (end < 0) end = this.bytes.length;
        let trim = end;
        while (trim > start && isWhite(this.bytes[trim - 1])) trim--;
        this.pos = end;
        return new PdfStream(dict, this.bytes.subarray(start, trim));
      }
      this.pos = end;
      this.skipWs();
      this.peekKeyword('endstream');
      return new PdfStream(dict, this.bytes.subarray(start, end));
    }
  }

  // ── 文件 ────────────────────────────────────────────────

  class PdfDoc {
    constructor(bytes) {
      this.bytes = bytes;
      this.objects = new Map();  // 物件編號 → 值
      this.trailer = new Map();
      this.pages = [];           // 依順序排好的頁面字典
    }

    resolve(value) {
      let v = value;
      for (let hops = 0; v instanceof PdfRef && hops < 32; hops++) {
        v = this.objects.has(v.num) ? this.objects.get(v.num) : null;
      }
      return v;
    }

    /** 取字典欄位並解參照 */
    get(dict, key) {
      const d = dict instanceof PdfStream ? dict.dict : dict;
      if (!isDict(d)) return null;
      return this.resolve(d.get(key));
    }

    pageInfo(i) {
      const page = this.pages[i];
      if (!page) return null;
      const box = this.get(page, 'MediaBox') || [0, 0, 612, 792];
      const nums = box.map((v) => this.resolve(v));
      const w = Math.abs(nums[2] - nums[0]);
      const h = Math.abs(nums[3] - nums[1]);
      const rotate = ((Math.round((this.get(page, 'Rotate') || 0) / 90) * 90) % 360 + 360) % 360;
      const swap = rotate === 90 || rotate === 270;
      return { width: swap ? h : w, height: swap ? w : h, rotate };
    }
  }

  /** 傳統 xref 表 */
  function readXrefTable(doc, lexer, entries) {
    for (;;) {
      lexer.skipWs();
      if (lexer.peekKeyword('trailer')) break;
      const start = lexer.readToken();
      const count = lexer.readToken();
      if (!/^\d+$/.test(start) || !/^\d+$/.test(count)) break;
      const from = parseInt(start, 10);
      const n = parseInt(count, 10);
      for (let i = 0; i < n; i++) {
        lexer.skipWs();
        const offset = parseInt(lexer.readToken(), 10);
        lexer.readToken(); // gen
        const kind = lexer.readToken();
        const num = from + i;
        if (kind === 'n' && !entries.has(num)) entries.set(num, { type: 1, offset });
      }
    }
    return lexer.parse(null); // trailer 字典
  }

  /** xref 串流（PDF 1.5 之後） */
  async function readXrefStream(doc, stream, entries) {
    const dict = stream.dict;
    let data = stream.raw;
    const filter = dict.get('Filter');
    const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
    if (filters.some((f) => isName(f, 'FlateDecode'))) data = await inflate(data);
    else if (filters.length) throw new Error('xref 串流用了不支援的壓縮方式');

    const parms = dict.get('DecodeParms');
    if (isDict(parms) && (parms.get('Predictor') || 1) > 1) {
      const predictor = parms.get('Predictor');
      if (predictor < 10) throw new Error('不支援 TIFF 預測子的 xref 串流');
      data = unpredict(data, parms.get('Colors') || 1, parms.get('BitsPerComponent') || 8,
        parms.get('Columns') || 1);
    }

    const w = (dict.get('W') || []).map(Number);
    const rowLen = w.reduce((a, v) => a + v, 0);
    const size = dict.get('Size') || 0;
    const index = dict.get('Index') || [0, size];

    let at = 0;
    const readField = (width, fallback) => {
      if (!width) return fallback;
      let v = 0;
      for (let i = 0; i < width; i++) v = v * 256 + data[at++];
      return v;
    };

    for (let s = 0; s + 1 < index.length; s += 2) {
      const from = Number(index[s]);
      const count = Number(index[s + 1]);
      for (let i = 0; i < count && at + rowLen <= data.length; i++) {
        const type = readField(w[0], 1);
        const f2 = readField(w[1], 0);
        const f3 = readField(w[2], 0);
        const num = from + i;
        if (entries.has(num)) continue;
        if (type === 1) entries.set(num, { type: 1, offset: f2 });
        else if (type === 2) entries.set(num, { type: 2, stm: f2, idx: f3 });
      }
    }
    return dict;
  }

  /** xref 讀不動時的退路：整份掃過去找「N G obj」 */
  function scanAllObjects(doc, entries) {
    const bytes = doc.bytes;
    const needle = enc.encode('obj');
    let at = 0;
    entries.clear();
    for (;;) {
      const found = indexOfBytes(bytes, needle, at);
      if (found < 0) break;
      at = found + 3;
      // 往回讀「編號 世代」
      let p = found - 1;
      while (p >= 0 && isWhite(bytes[p])) p--;
      const genEnd = p + 1;
      while (p >= 0 && bytes[p] >= 0x30 && bytes[p] <= 0x39) p--;
      const genStart = p + 1;
      if (genStart === genEnd) continue;
      while (p >= 0 && isWhite(bytes[p])) p--;
      const numEnd = p + 1;
      while (p >= 0 && bytes[p] >= 0x30 && bytes[p] <= 0x39) p--;
      const numStart = p + 1;
      if (numStart === numEnd) continue;
      const num = parseInt(latin.decode(bytes.subarray(numStart, numEnd)), 10);
      // 後面出現的覆蓋前面的 —— 增量更新的 PDF 就是這個規則
      entries.set(num, { type: 1, offset: numStart });
    }
  }

  function parseObjectAt(doc, offset) {
    const lexer = new Lexer(doc.bytes, offset);
    lexer.readToken(); // 編號
    lexer.readToken(); // 世代
    if (!lexer.peekKeyword('obj')) return null;
    return lexer.parse((ref) => doc.resolve(ref));
  }

  /** 展開物件串流：一包 zip 過的小物件，PDF 1.5 之後很常見 */
  async function expandObjectStream(doc, stream) {
    let data = stream.raw;
    const filter = stream.dict.get('Filter');
    const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
    if (filters.some((f) => isName(f, 'FlateDecode'))) data = await inflate(data);
    const n = doc.resolve(stream.dict.get('N')) || 0;
    const first = doc.resolve(stream.dict.get('First')) || 0;

    const head = new Lexer(data, 0);
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const num = parseInt(head.readToken(), 10);
      const at = parseInt(head.readToken(), 10);
      if (Number.isNaN(num) || Number.isNaN(at)) break;
      pairs.push([num, at]);
    }
    const out = new Map();
    for (const [num, at] of pairs) {
      const lexer = new Lexer(data, first + at);
      out.set(num, lexer.parse((ref) => doc.resolve(ref)));
    }
    return out;
  }

  /** 從頁面樹收集所有頁面，順便把繼承來的屬性補到每一頁上 */
  function collectPages(doc) {
    const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
    const root = doc.get(doc.trailer, 'Root');
    let tree = root ? doc.get(root, 'Pages') : null;

    const pages = [];
    const seen = new Set();

    const walk = (node, inherited, depth) => {
      if (!isDict(node) || depth > 64) return;
      const next = { ...inherited };
      for (const key of INHERITED) if (node.has(key)) next[key] = node.get(key);

      const kids = doc.get(node, 'Kids');
      if (Array.isArray(kids)) {
        for (const kidRef of kids) {
          const key = kidRef instanceof PdfRef ? kidRef.num : null;
          if (key !== null) {
            if (seen.has(key)) continue; // 樹壞掉繞回來時止血
            seen.add(key);
          }
          walk(doc.resolve(kidRef), next, depth + 1);
        }
        return;
      }
      if (isName(node.get('Type'), 'Pages')) return; // 沒有 Kids 的 Pages：空的
      for (const key of INHERITED) if (!node.has(key) && next[key] !== undefined) node.set(key, next[key]);
      pages.push(node);
    };

    walk(tree, {}, 0);

    if (!pages.length) {
      // 頁面樹壞掉時，退而求其次：整份找 /Type /Page 的物件
      const nums = [...doc.objects.keys()].sort((a, b) => a - b);
      for (const num of nums) {
        const v = doc.objects.get(num);
        if (isDict(v) && isName(v.get('Type'), 'Page')) pages.push(v);
      }
    }
    return pages;
  }

  /**
   * 開啟一份 PDF。
   * @param {ArrayBuffer|Uint8Array} input
   */
  async function open(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (indexOfBytes(bytes, enc.encode('%PDF-'), 0) < 0) throw new Error('不是 PDF 檔');

    const doc = new PdfDoc(bytes);
    const entries = new Map();
    const trailers = [];

    // ── xref 鏈 ──
    try {
      const tail = lastIndexOfBytes(bytes, enc.encode('startxref'), bytes.length);
      if (tail < 0) throw new Error('找不到 startxref');
      const lexer = new Lexer(bytes, tail + 9);
      let offset = parseInt(lexer.readToken(), 10);
      const visited = new Set();

      while (Number.isFinite(offset) && offset > 0 && offset < bytes.length && !visited.has(offset)) {
        visited.add(offset);
        const at = new Lexer(bytes, offset);
        at.skipWs();
        let trailer;
        if (at.peekKeyword('xref')) {
          trailer = readXrefTable(doc, at, entries);
        } else {
          const obj = parseObjectAt(doc, offset);
          if (!(obj instanceof PdfStream)) throw new Error('xref 位置不是有效的物件');
          trailer = await readXrefStream(doc, obj, entries);
        }
        if (!isDict(trailer)) break;
        trailers.push(trailer);
        // 混合式檔案：傳統表另外指到一份 xref 串流
        const hybrid = trailer.get('XRefStm');
        if (typeof hybrid === 'number' && !visited.has(hybrid)) {
          visited.add(hybrid);
          const obj = parseObjectAt(doc, hybrid);
          if (obj instanceof PdfStream) await readXrefStream(doc, obj, entries);
        }
        offset = trailer.get('Prev');
        offset = typeof offset === 'number' ? offset : -1;
      }
    } catch (e) {
      entries.clear();
    }

    if (!entries.size) scanAllObjects(doc, entries);

    // ── 載入物件 ──
    const inStreams = [];
    for (const [num, entry] of entries) {
      if (entry.type === 1) {
        try {
          const value = parseObjectAt(doc, entry.offset);
          if (value !== null) doc.objects.set(num, value);
        } catch (e) { /* 壞掉的物件跳過，其他還是讀得到 */ }
      } else {
        inStreams.push([num, entry]);
      }
    }
    const expanded = new Map();
    for (const [num, entry] of inStreams) {
      if (!expanded.has(entry.stm)) {
        const container = doc.objects.get(entry.stm);
        expanded.set(entry.stm, container instanceof PdfStream
          ? await expandObjectStream(doc, container) : new Map());
      }
      const found = expanded.get(entry.stm);
      if (found.has(num)) doc.objects.set(num, found.get(num));
    }

    // ── trailer ──
    for (const t of trailers) {
      for (const [k, v] of t) if (!doc.trailer.has(k)) doc.trailer.set(k, v);
    }
    if (!doc.trailer.has('Root')) {
      // 掃描模式或 trailer 壞掉：找 /Type /Catalog
      for (const [num, v] of doc.objects) {
        if (isDict(v) && isName(v.get('Type'), 'Catalog')) { doc.trailer.set('Root', new PdfRef(num, 0)); break; }
      }
    }
    if (doc.trailer.has('Encrypt')) {
      throw new Error('這份 PDF 有加密保護，無法直接編輯頁面');
    }

    doc.pages = collectPages(doc);
    if (!doc.pages.length) throw new Error('這份 PDF 讀不到任何頁面');
    return doc;
  }

  // ── 寫出 ────────────────────────────────────────────────

  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000));

  function escapeName(name) {
    return name.replace(/[^\x21-\x7e]|[#()<>\[\]{}/%]/g, (c) =>
      '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  }

  /** 序列化成位元組片段（字串與 Uint8Array 混用，最後一起組起來） */
  function serialize(value, out) {
    if (value === null || value === undefined) { out.push('null'); return; }
    if (typeof value === 'boolean') { out.push(value ? 'true' : 'false'); return; }
    if (typeof value === 'number') { out.push(fmtNum(value)); return; }
    if (value instanceof PdfName) { out.push('/' + escapeName(value.name)); return; }
    if (value instanceof PdfRef) { out.push(`${value.num} 0 R`); return; }
    if (value instanceof PdfString) {
      // 一律寫成十六進位 —— 不必處理跳脫，也不會被特殊字元咬到
      let hex = '<';
      for (const b of value.bytes) hex += b.toString(16).padStart(2, '0');
      out.push(hex + '>');
      return;
    }
    if (Array.isArray(value)) {
      out.push('[');
      value.forEach((v, i) => { if (i) out.push(' '); serialize(v, out); });
      out.push(']');
      return;
    }
    if (value instanceof PdfStream) {
      serialize(value.dict, out);
      out.push('\nstream\n');
      out.push(value.raw);
      out.push('\nendstream');
      return;
    }
    if (isDict(value)) {
      out.push('<<');
      for (const [k, v] of value) {
        out.push('/' + escapeName(k) + ' ');
        serialize(v, out);
        out.push(' ');
      }
      out.push('>>');
      return;
    }
    out.push('null');
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const out = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  /**
   * 把「畫面座標」換成「PDF 使用者座標」的變換矩陣。
   *
   * 畫面座標＝使用者在螢幕上看到的那一面：左上角原點、y 往下、已經轉過向。
   * PDF 使用者座標＝左下角原點、y 往上、而且是**沒轉向前**的那一面 ——
   * /Rotate 是交給檢視器轉的，內容串流裡的座標不會跟著轉。
   *
   * 所以蓋章的內容前面要先套這個矩陣，使用者在轉過向的縮圖上點哪裡就蓋在哪裡。
   *
   * @param {number} rotate  最終方向（0/90/180/270，已含使用者按的轉向）
   * @param {number} w  轉向前的頁寬（pt）
   * @param {number} h  轉向前的頁高（pt）
   * @param {number} mx MediaBox 的左下角 x（不一定是 0）
   * @param {number} my MediaBox 的左下角 y
   * @returns {{matrix: number[], width: number, height: number}}
   *          width/height 是轉向後、使用者看到的尺寸
   */
  function displayMatrix(rotate, w, h, mx = 0, my = 0) {
    const r = ((Math.round(rotate / 90) * 90) % 360 + 360) % 360;
    // [a b c d e f]：px = a·dx + c·dy + e，py = b·dx + d·dy + f
    const M = {
      0: [1, 0, 0, -1, 0, h],
      90: [0, 1, 1, 0, 0, 0],
      180: [-1, 0, 0, 1, w, 0],
      270: [0, -1, -1, 0, w, h],
    }[r];
    const swap = r === 90 || r === 270;
    return {
      matrix: [M[0], M[1], M[2], M[3], M[4] + mx, M[5] + my],
      width: swap ? h : w,
      height: swap ? w : h,
    };
  }

  /**
   * 把挑好的頁面組成一份新的 PDF。
   *
   * @param {Array<{doc: PdfDoc, page: number, rotate?: number, stamps?: Array}>} picks
   *        rotate 是相對角度（90 的倍數），會疊加到頁面原本的方向上。
   *        stamps 是蓋在這一頁上的簽名 / 印章：
   *          { sig, x, y, w, opacity?, rotate? }
   *        x/y/w 是相對值（0–1，相對於「使用者看到的那一面」的寬高），
   *        高度由 sig.aspect 推得 —— 簽名不該被拉扁。
   */
  async function compose(picks, meta = {}) {
    if (!picks || !picks.length) throw new Error('沒有選到任何頁面');

    const objects = [];                 // index 0 → 物件 1
    const add = (value) => { objects.push(value); return new PdfRef(objects.length, 0); };
    const catalogRef = add(null);
    const pagesRef = add(null);

    // 每份來源文件各自一張「舊編號 → 新參照」的對照表，共用的資源才不會被複製很多份
    const maps = new Map();
    const included = new Map();         // 來源文件 → 這次要收的頁面物件集合
    for (const pick of picks) {
      if (!included.has(pick.doc)) included.set(pick.doc, new Set());
      included.get(pick.doc).add(pick.doc.pages[pick.page]);
    }

    /** 深層複製一個值，遇到參照就連帶把目標也複製過來 */
    function copy(doc, value, depth = 0) {
      if (depth > 96) return null;
      if (value instanceof PdfRef) {
        const map = maps.get(doc);
        if (map.has(value.num)) return map.get(value.num);
        const target = doc.objects.has(value.num) ? doc.objects.get(value.num) : null;

        // 別把「沒被選到的頁面」拖進來 —— 註解的跳頁目的地常常指向別頁，
        // 照抄會把整份文件一路帶過來。
        const dict = target instanceof PdfStream ? target.dict : target;
        if (isDict(dict) && isName(dict.get('Type'), 'Page') && !included.get(doc).has(target)) {
          return null;
        }

        // 先佔位再複製內容，這樣互相參照（例如註解指回頁面）不會無限遞迴
        const ref = add(null);
        map.set(value.num, ref);
        objects[ref.num - 1] = copy(doc, target, depth + 1);
        return ref;
      }
      if (Array.isArray(value)) return value.map((v) => copy(doc, v, depth + 1));
      if (value instanceof PdfStream) return new PdfStream(copy(doc, value.dict, depth + 1), value.raw);
      if (isDict(value)) {
        const out = new Map();
        for (const [k, v] of value) {
          if (k === 'Parent') continue;       // 頁面樹由我們自己重建
          out.set(k, copy(doc, v, depth + 1));
        }
        return out;
      }
      return value;
    }

    const resolveNew = (v) => (v instanceof PdfRef ? objects[v.num - 1] : v);
    /** 同一份簽名蓋在很多頁上時，影像本體只存一份 */
    const imageCache = new Map();

    /** 建一個帶 alpha 的影像 XObject（RGB 本體 + SMask 灰階遮罩） */
    async function addAlphaImage(rgba, width, height) {
      const n = width * height;
      const rgb = new Uint8Array(n * 3);
      const alpha = new Uint8Array(n);
      for (let i = 0, j = 0; i < n; i++) {
        rgb[j++] = rgba[i * 4];
        rgb[j++] = rgba[i * 4 + 1];
        rgb[j++] = rgba[i * 4 + 2];
        alpha[i] = rgba[i * 4 + 3];
      }

      const stream = async (data, space) => {
        const packed = await deflate(data);
        const dict = new Map();
        dict.set('Type', new PdfName('XObject'));
        dict.set('Subtype', new PdfName('Image'));
        dict.set('Width', width);
        dict.set('Height', height);
        dict.set('ColorSpace', new PdfName(space));
        dict.set('BitsPerComponent', 8);
        if (packed) dict.set('Filter', new PdfName('FlateDecode'));
        const raw = packed || data;
        dict.set('Length', raw.length);
        return { dict, raw };
      };

      const mask = await stream(alpha, 'DeviceGray');
      const maskRef = add(new PdfStream(mask.dict, mask.raw));
      const body = await stream(rgb, 'DeviceRGB');
      body.dict.set('SMask', maskRef);
      return add(new PdfStream(body.dict, body.raw));
    }

    /** 把簽名蓋到已經複製好的頁面上 */
    async function applyStamps(copied, doc, page, rotate, stamps) {
      const sign = window.SMSignLite;
      if (!sign) throw new Error('缺少 sign-lite.js，無法蓋章');

      const box = (doc.get(page, 'MediaBox') || [0, 0, 612, 792]).map((v) => Number(doc.resolve(v)) || 0);
      const mx = Math.min(box[0], box[2]);
      const my = Math.min(box[1], box[3]);
      const pw = Math.abs(box[2] - box[0]) || 612;
      const ph = Math.abs(box[3] - box[1]) || 792;
      const view = displayMatrix(rotate, pw, ph, mx, my);

      // Resources 可能被好幾頁共用，所以一律複製一份再改，不然會改到別頁
      const res = new Map(asDict(resolveNew(copied.get('Resources'))));
      const xobjects = new Map(asDict(resolveNew(res.get('XObject'))));
      const gstates = new Map(asDict(resolveNew(res.get('ExtGState'))));

      let seq = 0;
      const unique = (prefix) => {
        let name;
        do { name = `${prefix}${seq++}`; } while (xobjects.has(name) || gstates.has(name));
        return name;
      };

      // 點陣簽名的影像先建好 —— 壓縮是非同步的，而 pdfOps 是同步的
      for (const stamp of stamps) {
        const sig = stamp.sig;
        if (!sig || sig.kind !== 'image') continue;
        const key = sig.id || sig;
        if (imageCache.has(key)) continue;
        await sign.hydrate(sig);
        const px = sign.pixels(sig);
        imageCache.set(key, await addAlphaImage(px.rgba, px.width, px.height));
      }

      const useImage = (sig) => {
        const ref = imageCache.get(sig.id || sig);
        if (!ref) throw new Error('內部錯誤：簽名影像還沒建立');
        const name = unique('SMsX');
        xobjects.set(name, ref);
        return name;
      };
      const useAlpha = (value) => {
        const gs = new Map();
        gs.set('Type', new PdfName('ExtGState'));
        gs.set('ca', Math.round(value * 1000) / 1000);
        gs.set('CA', Math.round(value * 1000) / 1000);
        const name = unique('SMsG');
        gstates.set(name, add(gs));
        return name;
      };

      const chunks = [];
      for (const stamp of stamps) {
        const sig = stamp.sig;
        if (!sig) continue;
        const w = Math.max(1e-4, stamp.w == null ? 0.25 : stamp.w) * view.width;
        const h = w / (sig.aspect || 1);
        const target = {
          x: (stamp.x == null ? 0.5 : stamp.x) * view.width - w / 2,
          y: (stamp.y == null ? 0.5 : stamp.y) * view.height - h / 2,
          w, h,
        };
        chunks.push(sign.pdfOps(sig, target, {
          opacity: stamp.opacity, rotate: stamp.rotate, color: stamp.color, useImage, useAlpha,
        }));
      }

      const body = chunks.filter(Boolean).join('\n');
      if (!body) return;

      if (xobjects.size) res.set('XObject', xobjects);
      if (gstates.size) res.set('ExtGState', gstates);
      copied.set('Resources', res);

      // 原本的內容包在 q…Q 裡 —— 它可能留下改過的座標系或顏色，
      // 不還原的話簽名會跑到奇怪的地方
      const m = view.matrix.map(fmtNum).join(' ');
      const before = streamOf('q\n');
      const after = streamOf(`Q\nq\n${m} cm\n${body}\nQ\n`);

      const contents = copied.get('Contents');
      const resolved = resolveNew(contents);
      const existing = Array.isArray(resolved) ? resolved : contents == null ? [] : [contents];
      copied.set('Contents', [add(before), ...existing, add(after)]);
    }

    function streamOf(text) {
      const raw = enc.encode(text);
      const dict = new Map();
      dict.set('Length', raw.length);
      return new PdfStream(dict, raw);
    }

    const kids = [];
    for (const pick of picks) {
      const doc = pick.doc;
      if (!maps.has(doc)) maps.set(doc, new Map());
      const page = doc.pages[pick.page];
      if (!isDict(page)) throw new Error(`第 ${pick.page + 1} 頁讀不到`);

      const copied = copy(doc, page);
      copied.set('Type', new PdfName('Page'));
      copied.set('Parent', pagesRef);

      const base = doc.get(page, 'Rotate') || 0;
      const rotate = (((Math.round((base + (pick.rotate || 0)) / 90) * 90) % 360) + 360) % 360;
      if (rotate) copied.set('Rotate', rotate);
      else copied.delete('Rotate');

      if (!copied.has('MediaBox')) copied.set('MediaBox', [0, 0, 612, 792]);
      if (pick.stamps && pick.stamps.length) {
        await applyStamps(copied, doc, page, rotate, pick.stamps);
      }
      kids.push(add(copied));
    }

    const pages = new Map();
    pages.set('Type', new PdfName('Pages'));
    pages.set('Count', kids.length);
    pages.set('Kids', kids);
    objects[pagesRef.num - 1] = pages;

    const catalog = new Map();
    catalog.set('Type', new PdfName('Catalog'));
    catalog.set('Pages', pagesRef);
    objects[catalogRef.num - 1] = catalog;

    const info = new Map();
    info.set('Producer', new PdfString(enc.encode('ScanMail+')));
    if (meta.title) info.set('Title', new PdfString(utf16be(meta.title)));
    const infoRef = add(info);

    // ── 組檔 ──
    const parts = [];
    let length = 0;
    const push = (chunk) => {
      const b = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
      parts.push(b);
      length += b.length;
    };

    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');
    const offsets = [];
    objects.forEach((value, i) => {
      offsets[i] = length;
      push(`${i + 1} 0 obj\n`);
      const chunks = [];
      serialize(value === undefined ? null : value, chunks);
      for (const c of chunks) push(c);
      push('\nendobj\n');
    });

    const xrefAt = length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef.num} 0 R ` +
      `/Info ${infoRef.num} 0 R >>\n`);
    push(`startxref\n${xrefAt}\n%%EOF\n`);

    return new Blob(parts, { type: 'application/pdf' });
  }

  function utf16be(text) {
    const out = [0xfe, 0xff];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        const hi = 0xd800 + (v >> 10);
        const lo = 0xdc00 + (v & 0x3ff);
        out.push(hi >> 8, hi & 255, lo >> 8, lo & 255);
      } else {
        out.push(cp >> 8, cp & 255);
      }
    }
    return Uint8Array.from(out);
  }

  window.SMPDFLite = {
    open,
    compose,
    PdfName, PdfRef, PdfString, PdfStream,
    // 測試用
    _internals: { Lexer, unpredict, inflate, displayMatrix },
  };
})();
