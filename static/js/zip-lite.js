/**
 * 最小可用的 ZIP 讀寫 —— 只為了 DOCX。
 *
 * .docx 就是一包 zip，裡面放 XML。要在手機上不連後端做 Word 轉檔，
 * 就得自己拆包跟打包。這裡不引入 JSZip（60 KB），因為瀏覽器本身
 * 已經有 deflate 了：CompressionStream / DecompressionStream。
 *
 * 支援範圍刻意壓到最小：
 *   - 壓縮方式只認 stored(0) 與 deflate(8)，Office 產出的檔案就這兩種
 *   - 不支援 zip64、不支援加密、不支援分卷
 * 超出範圍會明確丟錯，不會安靜地給出壞資料。
 */
(function () {
  'use strict';

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;
  const U32_MAX = 0xffffffff;

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  // ── CRC32 ────────────────────────────────────────────────
  let CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c >>> 0;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    const table = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ── deflate / inflate ────────────────────────────────────
  const canDeflate = typeof CompressionStream !== 'undefined';
  const canInflate = typeof DecompressionStream !== 'undefined';

  async function through(bytes, stream) {
    const blob = new Blob([bytes]);
    const out = blob.stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }

  async function deflateRaw(bytes) {
    if (!canDeflate) return null;
    return through(bytes, new CompressionStream('deflate-raw'));
  }

  async function inflateRaw(bytes) {
    if (!canInflate) throw new Error('這個瀏覽器不支援解壓縮（DecompressionStream）');
    return through(bytes, new DecompressionStream('deflate-raw'));
  }

  // ── 讀 ───────────────────────────────────────────────────

  /** 找出 End Of Central Directory；註解最長 65535，所以只往回掃這麼多。 */
  function findEocd(view, len) {
    const from = Math.max(0, len - 65535 - 22);
    for (let i = len - 22; i >= from; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  /**
   * 解開 zip。
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {Promise<Map<string, Uint8Array>>} 路徑 → 內容
   */
  async function read(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(view, bytes.length);
    if (eocd < 0) throw new Error('不是有效的 zip 檔（找不到結尾標記）');

    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    if (ptr === U32_MAX) throw new Error('不支援 zip64 格式的檔案');

    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(ptr, true) !== SIG_CENTRAL) throw new Error('zip 目錄結構損壞');
      const method = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue; // 目錄項目沒有內容

      // local header 的 extra 欄位長度常跟 central 不同，一定要重讀
      if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`${name} 的區段標頭損壞`);
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + compressedSize);

      if (method === 0) files.set(name, raw.slice());
      else if (method === 8) files.set(name, await inflateRaw(raw));
      else throw new Error(`${name} 用了不支援的壓縮方式（${method}）`);
    }
    return files;
  }

  /** 讀出某個檔案並當成 UTF-8 文字。找不到回傳 null。 */
  function textOf(files, name) {
    const b = files.get(name);
    return b ? dec.decode(b) : null;
  }

  // ── 寫 ───────────────────────────────────────────────────

  function toBytes(data) {
    if (typeof data === 'string') return enc.encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new Error('zip 內容只接受字串、Uint8Array 或 ArrayBuffer');
  }

  /**
   * 打包成 zip。
   * @param {Array<{name:string, data:string|Uint8Array|ArrayBuffer, store?:boolean}>} entries
   * @returns {Promise<Blob>}
   */
  async function write(entries) {
    const parts = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const raw = toBytes(entry.data);
      const crc = crc32(raw);

      // 已經壓過的東西（例如 PNG）再 deflate 一次只會變大
      let body = entry.store ? null : await deflateRaw(raw);
      let method = 8;
      if (!body || body.length >= raw.length) {
        body = raw;
        method = 0;
      }
      if (raw.length > U32_MAX || body.length > U32_MAX) {
        throw new Error(`${entry.name} 太大，超出 zip 格式上限`);
      }

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, SIG_LOCAL, true);
      lv.setUint16(4, 20, true);          // 需要 2.0 才能解
      lv.setUint16(6, 0x0800, true);      // 檔名是 UTF-8
      lv.setUint16(8, method, true);
      lv.setUint16(10, 0, true);          // 時間 —— 固定值，讓輸出可重現
      lv.setUint16(12, 0x0021, true);     // 日期 1980-01-01
      lv.setUint32(14, crc, true);
      lv.setUint32(18, body.length, true);
      lv.setUint32(22, raw.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const dir = new Uint8Array(46 + nameBytes.length);
      const dv = new DataView(dir.buffer);
      dv.setUint32(0, SIG_CENTRAL, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, method, true);
      dv.setUint16(12, 0, true);
      dv.setUint16(14, 0x0021, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, body.length, true);
      dv.setUint32(24, raw.length, true);
      dv.setUint16(28, nameBytes.length, true);
      dv.setUint32(42, offset, true);
      dir.set(nameBytes, 46);

      parts.push(local, body);
      central.push(dir);
      offset += local.length + body.length;
    }

    const centralSize = central.reduce((a, d) => a + d.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, SIG_EOCD, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
  }

  window.SMZip = { read, write, textOf, crc32, available: canInflate && canDeflate };
})();
