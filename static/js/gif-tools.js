/**
 * GIF 製作 — 圖片序列轉動畫 GIF
 */
(function() {
    const API = '/api/tools/gif';
    let uploadedFiles = [];

    function el(id) { return document.getElementById(id); }

    function init() {
        const page = document.querySelector('[data-tool="gif-tools"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        const dz = el('gifDropzone');
        if (dz) {
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
            dz.addEventListener('click', () => el('gifFileInput')?.click());
        }
        const fi = el('gifFileInput');
        if (fi) fi.addEventListener('change', e => handleFiles(e.target.files));

        el('gifProcessBtn')?.addEventListener('click', process);
        el('gifClearBtn')?.addEventListener('click', () => { uploadedFiles = []; renderList(); hideUI(); });
    }

    function handleFiles(fileList) {
        for (const f of fileList) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (['jpg','jpeg','png','webp','bmp','gif'].includes(ext)) uploadedFiles.push(f);
        }
        renderList();
    }

    function renderList() {
        const list = el('gifFileList');
        const btn = el('gifProcessBtn');
        const clr = el('gifClearBtn');
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

        list.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">${uploadedFiles.length} 張圖片（依排列順序產生動畫）</div>` +
            uploadedFiles.map((f, i) => `<div class="img-file-item"><span>${i+1}. ${f.name}</span><button class="img-file-remove" data-idx="${i}">&times;</button></div>`).join('');
        list.querySelectorAll('.img-file-remove').forEach(b => {
            b.addEventListener('click', e => { e.stopPropagation(); uploadedFiles.splice(parseInt(b.dataset.idx), 1); renderList(); });
        });
    }

    async function process() {
        if (uploadedFiles.length < 2) { alert('至少需要 2 張圖片'); return; }
        const btn = el('gifProcessBtn');
        btn.disabled = true;
        showProgress(5, '上傳中...');

        try {
            const fd = new FormData();
            uploadedFiles.forEach(f => fd.append('files', f));
            fd.append('duration_ms', el('gifDuration')?.value || '500');
            fd.append('resize_width', el('gifWidth')?.value || '0');
            fd.append('resize_height', el('gifHeight')?.value || '0');
            fd.append('resize_mode', el('gifResizeMode')?.value || 'fit');

            const res = await fetch(`${API}/create`, { method: 'POST', body: fd });
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

    async function downloadResult(taskId) {
        const res = await fetch(`${API}/task/${taskId}/download`);
        const blob = await res.blob();
        showDownload(blob, 'animation.gif');
    }

    function showProgress(pct, msg) {
        const p = el('gifProgress');
        if (!p) return;
        p.style.display = 'block';
        p.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--gradient);transition:width 0.3s;"></div></div><span style="font-size:12px;color:var(--text-secondary);">${pct}%</span></div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg}</div>`;
    }

    function showDownload(blob, filename) {
        const r = el('gifResult');
        if (!r) return;
        const url = URL.createObjectURL(blob);
        const size = blob.size < 1048576 ? (blob.size/1024).toFixed(1)+' KB' : (blob.size/1048576).toFixed(1)+' MB';
        r.style.display = 'block';
        r.innerHTML = `<div style="text-align:center;margin-bottom:12px;"><img src="${url}" style="max-width:100%;max-height:300px;border-radius:8px;border:1px solid var(--border-color);"></div><div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f0faf7;border-radius:8px;"><span style="font-size:24px;">✅</span><div style="flex:1;"><div style="font-weight:600;font-size:14px;">GIF 製作完成</div><div style="font-size:12px;color:var(--text-secondary);">${filename} (${size})</div></div><a href="${url}" download="${filename}" class="btn btn-primary btn-small" style="flex:none;">⬇ 下載</a></div>`;
    }

    function hideUI() {
        const r = el('gifResult'); if (r) r.style.display = 'none';
        const p = el('gifProgress'); if (p) p.style.display = 'none';
    }

    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="gif-tools"]');
        if (page && page.classList.contains('active')) init();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="gif-tools"]');
        if (page) { observer.observe(page, { attributes: true, attributeFilter: ['class'] }); if (page.classList.contains('active')) init(); }
    });
})();
