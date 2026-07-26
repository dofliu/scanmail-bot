/**
 * ScanMail+ API Layer
 * Centralized fetch wrapper for all backend endpoints
 */
const ScanMailAPI = (() => {
  // 網頁版是空字串（同源，維持 `/api/...`）；
  // Android App 內建前端時是後端的絕對位址（見 js/config.js）。
  const ROOT = (window.SM_CONFIG && window.SM_CONFIG.apiBase) || '';
  const BASE = `${ROOT}/api`;

  function authToken() {
    try { return localStorage.getItem('session_token'); } catch (e) { return null; }
  }

  async function request(url, opts = {}) {
    try {
      const token = authToken();
      if (token) {
        opts.headers = opts.headers || {};
        opts.headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(url, opts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        // FastAPI 422 驗證錯誤的 detail 是物件陣列（非字串），
        // 直接丟進 Error 會變成不可讀的 "[object Object]"
        let message = err.detail;
        if (Array.isArray(message)) {
          message = message.map(d => d.msg || JSON.stringify(d)).join('；');
        } else if (message && typeof message === 'object') {
          message = message.msg || JSON.stringify(message);
        }
        throw new Error(message || `HTTP ${res.status}`);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      return res;   // return raw Response for binary downloads
    } catch (e) {
      console.error(`[API] ${opts.method || 'GET'} ${url} failed:`, e);
      // App 內建前端連不到後端時，多半是位址填錯或伺服器沒開 —
      // 直接把設定畫面叫出來，比丟一個看不懂的 "Failed to fetch" 有用。
      if (e instanceof TypeError && window.SM_CONFIG && window.SM_CONFIG.bundled &&
          !window.SM_CONFIG.offlineOnly && window.SMNative) {
        window.SMNative.openServerSetup(`無法連線到 ${ROOT || '伺服器'}，請確認位址是否正確。`);
      }
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

  function imgRotate(file, angle = 90, outputFormat = 'auto', quality = 90) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('angle', angle);
    fd.append('output_format', outputFormat);
    fd.append('quality', quality);
    return formData(`${imgBase}/rotate`, fd);
  }

  function imgFlip(file, axis = 'horizontal', outputFormat = 'auto', quality = 90) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('axis', axis);
    fd.append('output_format', outputFormat);
    fd.append('quality', quality);
    return formData(`${imgBase}/flip`, fd);
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

  function pdfMerge(files, addToc = false, addPageNumbers = false) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    fd.append('add_toc', addToc);
    fd.append('add_page_numbers', addPageNumbers);
    return formData(`${pdfBase}/merge`, fd);
  }

  function pdfSplit(file, ranges = '', individual = false) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('ranges', ranges);
    fd.append('individual', individual);
    return formData(`${pdfBase}/split`, fd);
  }

  function pdfCompress(file, level = 'basic', imageQuality = 60) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('level', level);
    fd.append('image_quality', imageQuality);
    return formData(`${pdfBase}/compress`, fd);
  }

  function pdfToImages(file, fmt = 'png', dpi = 150) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fmt', fmt);
    fd.append('dpi', dpi);
    return formData(`${pdfBase}/to-images`, fd);
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
      'pdf-md': 'pdf-to-md',
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
  //  Auto Form Fill   prefix: /api/tools/form
  // ══════════════════════════════════════════════

  const formBase = `${BASE}/tools/form`;

  function formDetect(file, hint = '') {
    const fd = new FormData();
    fd.append('file', file);
    if (hint) fd.append('hint', hint);
    return formData(`${formBase}/detect`, fd);
  }

  function formDetectFromScan() {
    return json(`${formBase}/detect_from_scan`, {});
  }

  function formSuggest(fields, userId = 'default', contactId = null) {
    const payload = { fields, user_id: userId };
    if (contactId != null) payload.contact_id = contactId;
    return json(`${formBase}/suggest`, payload);
  }

  function formFill(sessionToken, fields, values) {
    return json(`${formBase}/fill`, {
      session_token: sessionToken,
      fields,
      values,
    });
  }

  function formTaskProgress(taskId) { return `${formBase}/task/${taskId}/progress`; }
  function formTaskDownload(taskId) { return `${formBase}/task/${taskId}/download`; }

  function formSendEmail(taskId, contactIds, subject = '', body = '', filename = '') {
    return json(`${formBase}/task/${taskId}/send`, {
      contact_ids: contactIds,
      subject,
      body,
      filename,
    });
  }

  function formListTemplates() {
    return request(`${formBase}/templates`);
  }

  function formSaveTemplate(name, fields, values) {
    return json(`${formBase}/templates`, { name, fields, values });
  }

  function formApplyTemplate(templateId, fields) {
    return json(`${formBase}/templates/${templateId}/apply`, { fields });
  }

  function formDeleteTemplate(templateId) {
    return request(`${formBase}/templates/${templateId}`, { method: 'DELETE' });
  }

  // ══════════════════════════════════════════════
  //  Authentication API
  // ══════════════════════════════════════════════

  function getAuthStatus() {
    return request(`${BASE}/auth/status`);
  }

  function login(username, password) {
    return json(`${BASE}/auth/login`, { username, password });
  }

  function register(username, password) {
    return json(`${BASE}/auth/register`, { username, password });
  }

  function logout() {
    return json(`${BASE}/auth/logout`, {});
  }

  // ══════════════════════════════════════════════
  //  Task progress helper (SSE)
  // ══════════════════════════════════════════════

  // EventSource 無法自訂 header，因此啟用認證時只能把 token 放在 query string。
  // 未啟用認證（預設）時不會附加任何東西。
  function withToken(url) {
    const token = authToken();
    if (!token) return url;
    return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  }

  // SSE watcher with auto-reconnect.
  //  - 任務未完成時連線中斷會重試（指數退避），不直接 reject
  //  - 已收到 completed/failed 事件後關閉，視為終態，不再重連
  //  - 連線重試上限 (default 3 次) 用盡後才 reject
  function watchTask(progressUrl, onProgress, { maxRetries = 3 } = {}) {
    progressUrl = withToken(progressUrl);
    return new Promise((resolve, reject) => {
      let es = null;
      let settled = false;
      let retries = 0;

      const cleanup = () => { if (es) { try { es.close(); } catch (_) {} es = null; } };
      const finish = (fn, val) => { if (!settled) { settled = true; cleanup(); fn(val); } };

      const connect = () => {
        if (settled) return;
        es = new EventSource(progressUrl);
        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (onProgress) onProgress(data);
            if (data.status === 'completed') return finish(resolve, data);
            if (data.status === 'failed') return finish(reject, new Error(data.error || '處理失敗'));
          } catch (e) { /* ignore parse errors */ }
        };
        es.onerror = () => {
          if (settled) return;
          cleanup();
          if (retries >= maxRetries) {
            return finish(reject, new Error(`連線中斷（重試 ${retries} 次後仍失敗）`));
          }
          const delay = Math.min(8000, 500 * Math.pow(2, retries));
          retries += 1;
          setTimeout(connect, delay);
        };
      };

      connect();
    });
  }

  async function downloadBlob(url) {
    // 走 request() 才會帶上 Authorization header（啟用認證時的下載會需要）
    const res = await request(url);
    if (!(res instanceof Response)) throw new Error('下載失敗：伺服器未回傳檔案');
    return res.blob();
  }

  /** 一次儲存多個結果檔（本地批次處理用） */
  function triggerDownloadAll(items) {
    if (window.SMNative) {
      return window.SMNative.saveFiles(items).catch((e) => {
        console.error('[API] 儲存檔案失敗:', e);
        if (window.SMStore) window.SMStore.toast('儲存失敗：' + e.message, 'err');
        throw e;
      });
    }
    return (items || []).reduce(
      (chain, it) => chain.then(() => triggerDownload(it.blob, it.filename)),
      Promise.resolve()
    );
  }

  /** 從後端 URL 取回檔案並存到裝置 — 瀏覽器與 App 都適用 */
  async function saveFromUrl(url, filename) {
    try {
      const blob = await downloadBlob(url);
      return await triggerDownload(blob, filename);
    } catch (e) {
      if (window.SMStore) window.SMStore.toast('下載失敗：' + e.message, 'err');
      throw e;
    }
  }

  // ══════════════════════════════════════════════
  //  Utilities
  // ══════════════════════════════════════════════

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // 儲存產生的檔案，一律回傳 Promise。
  // 有 native.js 時交給它決定：瀏覽器 <a download>，App 內 Capacitor 寫檔 + 系統分享
  // （WebView 不支援 blob: 下載，直接點 <a download> 不會有任何反應）。
  // 下面的 <a download> 只是 native.js 沒載入時的退路。
  function triggerDownload(blob, filename) {
    if (window.SMNative) {
      return window.SMNative.saveFile(blob, filename).catch((e) => {
        console.error('[API] 儲存檔案失敗:', e);
        if (window.SMStore) window.SMStore.toast('儲存失敗：' + e.message, 'err');
        throw e;
      });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    return Promise.resolve({ method: 'browser', filename });
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
    imgRotate, imgFlip,
    imgBatchResize, imgBatchConvert, imgBatchCompress, imgBatchWatermark,
    imgMerge, imgMergeDownload,
    imgTaskProgress, imgTaskDownload,
    // PDF tools
    pdfMerge, pdfTextWatermark, pdfProtect,
    pdfSplit, pdfCompress, pdfToImages,
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
    // Auto Form Fill
    formDetect, formDetectFromScan, formSuggest, formFill, formTaskProgress, formTaskDownload,
    formSendEmail, formListTemplates, formSaveTemplate, formApplyTemplate, formDeleteTemplate,
    // Auth
    getAuthStatus, login, register, logout,
    // Helpers
    watchTask, downloadBlob, saveFromUrl, formatBytes, triggerDownload, triggerDownloadAll,
  };
})();

window.API = ScanMailAPI;
