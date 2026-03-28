/**
 * 影片工具 — 合併、轉 GIF、壓縮
 */
(function() {
    const API = '/api/tools/video';
    let currentAction = 'merge';
    let uploadedFiles = [];

    function el(id) { return document.getElementById(id); }

    function init() {
        const page = document.querySelector('[data-tool="video-tools"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        document.querySelectorAll('.vid-action-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.vid-action-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentAction = tab.dataset.action;
                showPanel(currentAction);
                uploadedFiles = [];
                renderList();
                hideUI();
            });
        });

        const dz = el('vidDropzone');
        if (dz) {
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
            dz.addEventListener('click', () => el('vidFileInput')?.click());
        }
        const fi = el('vidFileInput');
        if (fi) fi.addEventListener('change', e => handleFiles(e.target.files));

        el('vidProcessBtn')?.addEventListener('click', process);
        el('vidClearBtn')?.addEventListener('click', () => { uploadedFiles = []; renderList(); hideUI(); });
    }

    function handleFiles(fileList) {
        const exts = ['mp4','avi','mov','mkv','webm','flv'];
        for (const f of fileList) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (exts.includes(ext) && f.size <= 200*1024*1024) uploadedFiles.push(f);
        }
        renderList();
    }

    function renderList() {
        const list = el('vidFileList');
        const btn = el('vidProcessBtn');
        const clr = el('vidClearBtn');
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
        const total = uploadedFiles.reduce((s, f) => s + f.size, 0);
        list.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${uploadedFiles.length} 個影片，共 ${fmtBytes(total)}</div>` +
            uploadedFiles.map((f, i) => `<div class="img-file-item"><span>${f.name}</span><span style="color:var(--text-secondary)">${fmtBytes(f.size)}</span><button class="img-file-remove" data-idx="${i}">&times;</button></div>`).join('');
        list.querySelectorAll('.img-file-remove').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); uploadedFiles.splice(parseInt(b.dataset.idx), 1); renderList(); }));
    }

    function showPanel(action) {
        document.querySelectorAll('.vid-options-panel').forEach(p => p.style.display = 'none');
        const p = el(`vidOpts_${action}`);
        if (p) p.style.display = 'block';
        const hint = el('vidDropHint');
        if (hint) {
            const h = { merge: '拖放多個影片檔案', 'to-gif': '拖放一個影片檔案', compress: '拖放一個影片檔案' };
            hint.textContent = h[action] || '拖放影片檔案';
        }
    }

    async function process() {
        if (uploadedFiles.length === 0) return;
        const btn = el('vidProcessBtn');
        btn.disabled = true;
        showProgress(5, '上傳中...');

        try {
            const fd = new FormData();
            if (currentAction === 'merge') {
                if (uploadedFiles.length < 2) throw new Error('至少需要 2 個影片');
                uploadedFiles.forEach(f => fd.append('files', f));
            } else {
                fd.append('file', uploadedFiles[0]);
            }
            appendOptions(fd);

            const endpoint = currentAction === 'merge' ? `${API}/merge`
                           : currentAction === 'to-gif' ? `${API}/to-gif`
                           : `${API}/compress`;

            const res = await fetch(endpoint, { method: 'POST', body: fd });
            if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || '失敗'); }
            const { task_id } = await res.json();

            await new Promise((resolve, reject) => {
                const es = new EventSource(`${API}/task/${task_id}/progress`);
                es.onmessage = ev => {
                    const d = JSON.parse(ev.data);
                    showProgress(d.progress, d.message);
                    if (d.status === 'completed') { es.close(); downloadResult(task_id); resolve(); }
                    else if (d.status === 'failed') { es.close(); reject(new Error(d.error)); }
                };
                es.onerror = () => { es.close(); reject(new Error('連線中斷')); };
            });
        } catch (err) {
            showProgress(0, `失敗: ${err.message}`);
        } finally {
            btn.disabled = false;
        }
    }

    function appendOptions(fd) {
        if (currentAction === 'to-gif') {
            fd.append('fps', el('vidGifFps')?.value || '10');
            fd.append('width', el('vidGifWidth')?.value || '0');
            fd.append('start_time', el('vidGifStart')?.value || '0');
            fd.append('end_time', el('vidGifEnd')?.value || '0');
        } else if (currentAction === 'compress') {
            fd.append('resolution', el('vidCompressRes')?.value || '');
            fd.append('crf', el('vidCompressCrf')?.value || '28');
        }
    }

    async function downloadResult(taskId) {
        const res = await fetch(`${API}/task/${taskId}/download`);
        const blob = await res.blob();
        const ext = blob.type.includes('gif') ? 'gif' : 'mp4';
        showDownload(blob, `result.${ext}`);
    }

    function showProgress(pct, msg) {
        const p = el('vidProgress');
        if (!p) return;
        p.style.display = 'block';
        p.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--gradient);transition:width 0.3s;"></div></div><span style="font-size:12px;color:var(--text-secondary);">${pct}%</span></div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg}</div>`;
    }

    function showDownload(blob, filename) {
        const r = el('vidResult');
        if (!r) return;
        const url = URL.createObjectURL(blob);
        r.style.display = 'block';
        r.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f0faf7;border-radius:8px;"><span style="font-size:24px;">✅</span><div style="flex:1;"><div style="font-weight:600;font-size:14px;">處理完成</div><div style="font-size:12px;color:var(--text-secondary);">${filename} (${fmtBytes(blob.size)})</div></div><a href="${url}" download="${filename}" class="btn btn-primary btn-small" style="flex:none;">⬇ 下載</a></div>`;
    }

    function hideUI() {
        const r = el('vidResult'); if (r) r.style.display = 'none';
        const p = el('vidProgress'); if (p) p.style.display = 'none';
    }

    function fmtBytes(b) { return b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }

    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="video-tools"]');
        if (page && page.classList.contains('active')) init();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="video-tools"]');
        if (page) { observer.observe(page, { attributes: true, attributeFilter: ['class'] }); if (page.classList.contains('active')) init(); }
    });
})();
