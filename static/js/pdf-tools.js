/**
 * PDF 工具 — 合併、浮水印、密碼保護
 */
(function() {
    const API = '/api/tools/pdf';
    let currentAction = 'merge';
    let uploadedFiles = [];

    function el(id) { return document.getElementById(id); }

    function init() {
        const page = document.querySelector('[data-tool="pdf-tools"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        // 動作切換
        document.querySelectorAll('.pdf-action-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.pdf-action-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentAction = tab.dataset.action;
                showPanel(currentAction);
                uploadedFiles = [];
                renderFileList();
                hideResult('pdf');
            });
        });

        // 拖放
        const dropzone = el('pdfDropzone');
        if (dropzone) {
            dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
            dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
            dropzone.addEventListener('click', () => el('pdfFileInput').click());
        }
        const fi = el('pdfFileInput');
        if (fi) fi.addEventListener('change', e => handleFiles(e.target.files));

        // 處理按鈕
        const btn = el('pdfProcessBtn');
        if (btn) btn.addEventListener('click', process);

        const clr = el('pdfClearBtn');
        if (clr) clr.addEventListener('click', () => { uploadedFiles = []; renderFileList(); hideResult('pdf'); });
    }

    function handleFiles(fileList) {
        const accept = currentAction === 'merge' ? ['pdf'] : currentAction === 'watermark' ? ['pdf'] : ['pdf'];
        for (const f of fileList) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (accept.includes(ext)) uploadedFiles.push(f);
        }
        renderFileList();
    }

    function renderFileList() {
        const list = el('pdfFileList');
        const btn = el('pdfProcessBtn');
        const clr = el('pdfClearBtn');
        if (!list) return;
        if (uploadedFiles.length === 0) {
            list.innerHTML = ''; list.style.display = 'none';
            if (btn) btn.style.display = 'none';
            if (clr) clr.style.display = 'none';
            return;
        }
        list.style.display = 'block';
        if (btn) btn.style.display = 'block';
        if (clr) clr.style.display = 'inline-flex';
        list.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${uploadedFiles.length} 個檔案</div>` +
            uploadedFiles.map((f, i) => `<div class="img-file-item"><span>${f.name}</span><span style="color:var(--text-secondary)">${fmtBytes(f.size)}</span><button class="img-file-remove" data-idx="${i}">&times;</button></div>`).join('');
        list.querySelectorAll('.img-file-remove').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); uploadedFiles.splice(parseInt(b.dataset.idx), 1); renderFileList(); }));
    }

    function showPanel(action) {
        document.querySelectorAll('.pdf-options-panel').forEach(p => p.style.display = 'none');
        const p = el(`pdfOpts_${action}`);
        if (p) p.style.display = 'block';
        // 更新 dropzone 提示
        const hint = el('pdfDropHint');
        if (hint) {
            const hints = { merge: '拖放多個 PDF 檔案到此處', watermark: '拖放一個 PDF 檔案', protect: '拖放一個 PDF 檔案' };
            hint.textContent = hints[action] || '拖放 PDF 檔案';
        }
    }

    async function process() {
        if (uploadedFiles.length === 0) return;
        const btn = el('pdfProcessBtn');
        btn.disabled = true;
        updateProgress('pdf', 10, '處理中...');

        try {
            if (currentAction === 'merge') {
                await doMerge();
            } else if (currentAction === 'watermark') {
                await doWatermark();
            } else if (currentAction === 'protect') {
                await doProtect();
            }
        } catch (err) {
            updateProgress('pdf', 0, `失敗: ${err.message}`);
        } finally {
            btn.disabled = false;
        }
    }

    async function doMerge() {
        if (uploadedFiles.length < 2) throw new Error('至少需要 2 個 PDF');
        const fd = new FormData();
        uploadedFiles.forEach(f => fd.append('files', f));
        fd.append('add_toc', el('pdfMergeToc')?.checked ? 'true' : 'false');

        updateProgress('pdf', 20, '上傳中...');
        const res = await fetch(`${API}/merge`, { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || '合併失敗'); }
        const { task_id } = await res.json();

        // SSE 進度
        await new Promise((resolve, reject) => {
            const es = new EventSource(`${API}/task/${task_id}/progress`);
            es.onmessage = ev => {
                const d = JSON.parse(ev.data);
                updateProgress('pdf', d.progress, d.message);
                if (d.status === 'completed') { es.close(); downloadTask(task_id); resolve(); }
                else if (d.status === 'failed') { es.close(); reject(new Error(d.error)); }
            };
            es.onerror = () => { es.close(); reject(new Error('連線中斷')); };
        });
    }

    async function downloadTask(taskId) {
        const res = await fetch(`${API}/task/${taskId}/download`);
        if (!res.ok) throw new Error('下載失敗');
        const blob = await res.blob();
        showDownload('pdf', blob, 'merged.pdf');
    }

    async function doWatermark() {
        if (uploadedFiles.length < 1) throw new Error('請上傳 PDF');
        const fd = new FormData();
        fd.append('file', uploadedFiles[0]);
        fd.append('text', el('pdfWmText')?.value || 'CONFIDENTIAL');
        fd.append('font_size', el('pdfWmSize')?.value || '48');
        fd.append('opacity', (parseInt(el('pdfWmOpacity')?.value || '15') / 100).toString());
        fd.append('rotation', el('pdfWmRotation')?.value || '45');

        updateProgress('pdf', 50, '加浮水印中...');
        const res = await fetch(`${API}/watermark/text`, { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || '失敗'); }
        const blob = await res.blob();
        updateProgress('pdf', 100, '完成！');
        showDownload('pdf', blob, 'watermarked.pdf');
    }

    async function doProtect() {
        if (uploadedFiles.length < 1) throw new Error('請上傳 PDF');
        const pw = el('pdfPassword')?.value;
        if (!pw) throw new Error('請輸入密碼');
        const fd = new FormData();
        fd.append('file', uploadedFiles[0]);
        fd.append('password', pw);

        updateProgress('pdf', 50, '加密中...');
        const res = await fetch(`${API}/protect`, { method: 'POST', body: fd });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || '失敗'); }
        const blob = await res.blob();
        updateProgress('pdf', 100, '完成！');
        showDownload('pdf', blob, 'protected.pdf');
    }

    function updateProgress(prefix, pct, msg) {
        const p = el(`${prefix}Progress`);
        if (!p) return;
        p.style.display = 'block';
        p.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--gradient);transition:width 0.3s;"></div></div><span style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${pct}%</span></div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg}</div>`;
    }

    function showDownload(prefix, blob, filename) {
        const r = el(`${prefix}Result`);
        if (!r) return;
        const url = URL.createObjectURL(blob);
        r.style.display = 'block';
        r.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f0faf7;border-radius:8px;"><span style="font-size:24px;">✅</span><div style="flex:1;"><div style="font-weight:600;font-size:14px;">處理完成</div><div style="font-size:12px;color:var(--text-secondary);">${filename} (${fmtBytes(blob.size)})</div></div><a href="${url}" download="${filename}" class="btn btn-primary btn-small" style="flex:none;">⬇ 下載</a></div>`;
    }

    function hideResult(prefix) {
        const r = el(`${prefix}Result`); if (r) r.style.display = 'none';
        const p = el(`${prefix}Progress`); if (p) p.style.display = 'none';
    }

    function fmtBytes(b) { return b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }

    // 觀察頁面切換
    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="pdf-tools"]');
        if (page && page.classList.contains('active')) init();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="pdf-tools"]');
        if (page) { observer.observe(page, { attributes: true, attributeFilter: ['class'] }); if (page.classList.contains('active')) init(); }
    });
})();
