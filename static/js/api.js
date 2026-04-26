/**
 * ScanMail+ API Layer
 * Centralized fetch wrapper for all backend endpoints
 */
const ScanMailAPI = (() => {
  const BASE = '/api';

  async function request(url, opts = {}) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      return res;   // return raw Response for binary downloads
    } catch (e) {
      console.error(`[API] ${opts.method || 'GET'} ${url} failed:`, e);
      throw e;
    }
  }

  function json(url, data, method = 'POST') {
    return request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  function formData(url, fd) {
    return request(url, { method: 'POST', body: fd });
  }

  // ══════════════════════════════════════════════
  //  Scan flow
  // ══════════════════════════════════════════════

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    return formData(`${BASE}/upload`, fd);
  }

  function detectEdges() {
    return json(`${BASE}/scan/detect`, {});
  }

  function processScan(corners, filterName = 'auto', autoDetect = true) {
    return json(`${BASE}/scan/process`, {
      corners, filter_name: filterName, auto_detect: autoDetect,
    });
  }

  function applyFilter(filterName) {
    return json(`${BASE}/scan/filter`, { filter_name: filterName });
  }

  function rotateImage(angle) {
    return json(`${BASE}/scan/rotate`, { angle });
  }

  // Pages
  function addPage() { return json(`${BASE}/pages/add`, {}); }
  function listPages() { return request(`${BASE}/pages`); }
  function removePage(idx) { return request(`${BASE}/pages/${idx}`, { method: 'DELETE' }); }
  function clearPages() { return json(`${BASE}/pages/clear`, {}); }

  // AI
  function analyze(contactId) {
    return json(`${BASE}/analyze`, { contact_id: contactId });
  }

  // Send
  function sendEmail(contactId, subject, body, filename) {
    return json(`${BASE}/send`, { contact_id: contactId, subject, body, filename });
  }

  function batchSend(contactIds, subject, body, filename) {
    return json(`${BASE}/send/batch`, { contact_ids: contactIds, subject, body, filename });
  }

  // ══════════════════════════════════════════════
  //  Contacts
  // ══════════════════════════════════════════════

  function listContacts() { return request(`${BASE}/contacts`); }

  function createContact(name, email, department, title) {
    return json(`${BASE}/contacts`, { name, email, department, title });
  }

  function deleteContact(id) {
    return request(`${BASE}/contacts/${id}`, { method: 'DELETE' });
  }

  // ══════════════════════════════════════════════
  //  Groups
  // ══════════════════════════════════════════════

  function listGroups() { return request(`${BASE}/groups`); }
  function createGroup(name, description, contactIds) {
    return json(`${BASE}/groups`, { name, description, contact_ids: contactIds });
  }
  function getGroup(id) { return request(`${BASE}/groups/${id}`); }
  function deleteGroup(id) { return request(`${BASE}/groups/${id}`, { method: 'DELETE' }); }

  // ══════════════════════════════════════════════
  //  History / Stats
  // ══════════════════════════════════════════════

  function getHistory() { return request(`${BASE}/history`); }
  function getStats() { return request(`${BASE}/stats`); }

  // ══════════════════════════════════════════════
  //  Settings (Sender Profile)
  // ══════════════════════════════════════════════

  function getSettings() { return request(`${BASE}/settings`); }
  function saveSettings(data) {
    return json(`${BASE}/settings`, data);
  }

  // ══════════════════════════════════════════════
  //  Image tools    prefix: /api/tools/image
  // ══════════════════════════════════════════════

  const imgBase = `${BASE}/tools/image`;

  function imgResize(file, width, height, mode, fmt, quality) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('width', width); fd.append('height', height);
    fd.append('mode', mode); fd.append('output_format', fmt); fd.append('quality', quality);
    return request(`${imgBase}/resize`, { method: 'POST', body: fd });
  }

  function imgConvert(file, targetFmt, quality) {
    const fd = new FormData();
    fd.append('file', file); fd.append('target_format', targetFmt); fd.append('quality', quality);
    return request(`${imgBase}/convert`, { method: 'POST', body: fd });
  }

  function imgCompress(file, quality, maxDim) {
    const fd = new FormData();
    fd.append('file', file); fd.append('quality', quality); fd.append('max_dimension', maxDim || 0);
    return request(`${imgBase}/compress`, { method: 'POST', body: fd });
  }

  function imgWatermark(file, text, fontSize, opacity, position, color) {
    const fd = new FormData();
    fd.append('file', file); fd.append('text', text);
    fd.append('font_size', fontSize); fd.append('opacity', opacity);
    fd.append('position', position); fd.append('color', color);
    return request(`${imgBase}/watermark`, { method: 'POST', body: fd });
  }

  function imgBatchResize(files, width, height, mode, fmt, quality) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('width', width); fd.append('height', height);
    fd.append('mode', mode); fd.append('output_format', fmt); fd.append('quality', quality);
    return formData(`${imgBase}/batch/resize`, fd);
  }

  function imgBatchConvert(files, fmt, quality) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('target_format', fmt); fd.append('quality', quality);
    return formData(`${imgBase}/batch/convert`, fd);
  }

  function imgBatchCompress(files, quality, maxDim) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('quality', quality); fd.append('max_dimension', maxDim || 0);
    return formData(`${imgBase}/batch/compress`, fd);
  }

  function imgBatchWatermark(files, text, fontSize, opacity, position, color) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('text', text); fd.append('font_size', fontSize);
    fd.append('opacity', opacity); fd.append('position', position); fd.append('color', color);
    return formData(`${imgBase}/batch/watermark`, fd);
  }

  function imgMerge(files, opts = {}) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('direction', opts.direction || 'vertical');
    fd.append('gap', opts.gap ?? 0);
    fd.append('bg_color', opts.bg_color || '#ffffff');
    fd.append('align', opts.align || 'center');
    fd.append('output_format', opts.output_format || 'JPEG');
    fd.append('quality', opts.quality ?? 90);
    fd.append('columns', opts.columns ?? 0);
    fd.append('normalize', opts.normalize === false ? 'false' : 'true');
    return formData(`${imgBase}/merge`, fd);
  }

  function imgMergeDownload(taskId, format = 'jpeg') {
    const f = (format || 'jpeg').toLowerCase();
    return `${imgBase}/merge/result/${taskId}?format=${encodeURIComponent(f)}`;
  }

  function imgTaskProgress(taskId) { return `${imgBase}/task/${taskId}/progress`; }
  function imgTaskDownload(taskId) { return `${imgBase}/task/${taskId}/download`; }

  // ══════════════════════════════════════════════
  //  PDF tools    prefix: /api/tools/pdf
  // ══════════════════════════════════════════════

  const pdfBase = `${BASE}/tools/pdf`;

  function pdfMerge(files, addToc = false) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('add_toc', addToc);
    return formData(`${pdfBase}/merge`, fd);
  }

  function pdfTextWatermark(file, text, fontSize, opacity, rotation, r, g, b) {
    const fd = new FormData();
    fd.append('file', file); fd.append('text', text);
    fd.append('font_size', fontSize); fd.append('opacity', opacity);
    fd.append('rotation', rotation);
    fd.append('color_r', r); fd.append('color_g', g); fd.append('color_b', b);
    return request(`${pdfBase}/watermark/text`, { method: 'POST', body: fd });
  }

  function pdfProtect(file, password) {
    const fd = new FormData();
    fd.append('file', file); fd.append('password', password);
    return request(`${pdfBase}/protect`, { method: 'POST', body: fd });
  }

  function pdfTaskProgress(taskId) { return `${pdfBase}/task/${taskId}/progress`; }
  function pdfTaskDownload(taskId) { return `${pdfBase}/task/${taskId}/download`; }

  // ══════════════════════════════════════════════
  //  Doc convert    prefix: /api/tools/convert
  // ══════════════════════════════════════════════

  const cvtBase = `${BASE}/tools/convert`;

  function docConvert(file, direction) {
    const fd = new FormData();
    fd.append('file', file);
    const endpoints = {
      'word-pdf': 'word-to-pdf', 'pdf-word': 'pdf-to-word',
      'md-pdf': 'md-to-pdf', 'md-word': 'md-to-word', 'word-md': 'word-to-md',
    };
    const ep = endpoints[direction];
    if (!ep) throw new Error('不支援的轉換方向: ' + direction);
    return request(`${cvtBase}/${ep}`, { method: 'POST', body: fd });
  }

  // ══════════════════════════════════════════════
  //  GIF tools    prefix: /api/tools/gif
  // ══════════════════════════════════════════════

  const gifBase = `${BASE}/tools/gif`;

  function gifCreate(files, durationMs, loop, resizeW, resizeH) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('duration_ms', durationMs); fd.append('loop', loop || 0);
    fd.append('resize_width', resizeW || 0); fd.append('resize_height', resizeH || 0);
    return formData(`${gifBase}/create`, fd);
  }

  function gifTaskProgress(taskId) { return `${gifBase}/task/${taskId}/progress`; }
  function gifTaskDownload(taskId) { return `${gifBase}/task/${taskId}/download`; }

  // ══════════════════════════════════════════════
  //  Video tools    prefix: /api/tools/video
  // ══════════════════════════════════════════════

  const vidBase = `${BASE}/tools/video`;

  function vidMerge(files, fmt) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('output_format', fmt || 'mp4');
    return formData(`${vidBase}/merge`, fd);
  }

  function vidToGif(file, fps, width, startTime, endTime) {
    const fd = new FormData();
    fd.append('file', file); fd.append('fps', fps || 10);
    fd.append('width', width || 0);
    fd.append('start_time', startTime || 0); fd.append('end_time', endTime || 0);
    return formData(`${vidBase}/to-gif`, fd);
  }

  function vidCompress(file, resolution, crf) {
    const fd = new FormData();
    fd.append('file', file); fd.append('resolution', resolution || '');
    fd.append('crf', crf || 28);
    return formData(`${vidBase}/compress`, fd);
  }

  function vidTaskProgress(taskId) { return `${vidBase}/task/${taskId}/progress`; }
  function vidTaskDownload(taskId) { return `${vidBase}/task/${taskId}/download`; }

  // ══════════════════════════════════════════════
  //  Batch rename    prefix: /api/tools/rename
  // ══════════════════════════════════════════════

  const renBase = `${BASE}/tools/rename`;

  function renamePreview(filenames, opts) {
    return json(`${renBase}/preview`, { filenames, ...opts });
  }

  function renameApply(files, opts) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    Object.entries(opts).forEach(([k, v]) => fd.append(k, String(v)));
    return formData(`${renBase}/apply`, fd);
  }

  function renTaskProgress(taskId) { return `${renBase}/task/${taskId}/progress`; }
  function renTaskDownload(taskId) { return `${renBase}/task/${taskId}/download`; }

  function aiRenameScan(directory, onlyExts) {
    return json(`${renBase}/ai/scan`, { directory, only_exts: onlyExts || '' });
  }

  function aiRenameApply(items) {
    return json(`${renBase}/ai/rename`, { items });
  }

  // ══════════════════════════════════════════════
  //  Task progress helper (SSE)
  // ══════════════════════════════════════════════

  function watchTask(progressUrl, onProgress) {
    return new Promise((resolve, reject) => {
      const es = new EventSource(progressUrl);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (onProgress) onProgress(data);
          if (data.status === 'completed') { es.close(); resolve(data); }
          else if (data.status === 'failed') { es.close(); reject(new Error(data.error || '處理失敗')); }
        } catch (e) { /* ignore parse errors */ }
      };
      es.onerror = () => { es.close(); reject(new Error('連線中斷')); };
    });
  }

  async function downloadBlob(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('下載失敗');
    return res.blob();
  }

  // ══════════════════════════════════════════════
  //  Utilities
  // ══════════════════════════════════════════════

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  return {
    // Scan
    uploadImage, detectEdges, processScan, applyFilter, rotateImage,
    addPage, listPages, removePage, clearPages,
    analyze, sendEmail, batchSend,
    // Contacts
    listContacts, createContact, deleteContact,
    // Groups
    listGroups, createGroup, getGroup, deleteGroup,
    // History
    getHistory, getStats,
    // Settings
    getSettings, saveSettings,
    // Image tools
    imgResize, imgConvert, imgCompress, imgWatermark,
    imgBatchResize, imgBatchConvert, imgBatchCompress, imgBatchWatermark,
    imgMerge, imgMergeDownload,
    imgTaskProgress, imgTaskDownload,
    // PDF tools
    pdfMerge, pdfTextWatermark, pdfProtect,
    pdfTaskProgress, pdfTaskDownload,
    // Doc convert
    docConvert,
    // GIF
    gifCreate, gifTaskProgress, gifTaskDownload,
    // Video
    vidMerge, vidToGif, vidCompress, vidTaskProgress, vidTaskDownload,
    // Rename
    renamePreview, renameApply, renTaskProgress, renTaskDownload,
    aiRenameScan, aiRenameApply,
    // Helpers
    watchTask, downloadBlob, formatBytes, triggerDownload,
  };
})();

window.API = ScanMailAPI;
