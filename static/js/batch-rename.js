/**
 * 批次改名 — 前綴/後綴/編號/搜尋取代 + 即時預覽
 */
(function() {
    const API = '/api/tools/rename';
    let uploadedFiles = [];

    function el(id) { return document.getElementById(id); }

    function init() {
        const page = document.querySelector('[data-tool="batch-rename"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        // 拖放
        const dz = el('renDropzone');
        if (dz) {
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
            dz.addEventListener('click', () => el('renFileInput')?.click());
        }
        const fi = el('renFileInput');
        if (fi) fi.addEventListener('change', e => handleFiles(e.target.files));

        // 規則變更 → 即時預覽
        ['renPrefix','renSuffix','renFind','renReplace','renNumStart','renNumDigits','renNumPos'].forEach(id => {
            const input = el(id);
            if (input) input.addEventListener('input', debounce(updatePreview, 300));
        });
        const numCb = el('renNumbering');
        if (numCb) numCb.addEventListener('change', () => { toggleNumberingOpts(); updatePreview(); });

        el('renApplyBtn')?.addEventListener('click', applyRename);
        el('renClearBtn')?.addEventListener('click', () => { uploadedFiles = []; renderAll(); });
    }

    function handleFiles(fileList) {
        for (const f of fileList) uploadedFiles.push(f);
        renderAll();
    }

    function renderAll() {
        renderFileCount();
        updatePreview();
        const apply = el('renApplyBtn');
        const clr = el('renClearBtn');
        if (apply) apply.style.display = uploadedFiles.length > 0 ? 'block' : 'none';
        if (clr) clr.style.display = uploadedFiles.length > 0 ? 'inline-flex' : 'none';
        const r = el('renResult'); if (r) r.style.display = 'none';
        const p = el('renProgress'); if (p) p.style.display = 'none';
    }

    function renderFileCount() {
        const info = el('renFileInfo');
        if (!info) return;
        if (uploadedFiles.length === 0) { info.innerHTML = ''; return; }
        const total = uploadedFiles.reduce((s, f) => s + f.size, 0);
        info.innerHTML = `<span style="font-size:13px;color:var(--text-secondary);">${uploadedFiles.length} 個檔案，共 ${fmtBytes(total)}</span>`;
    }

    function getOptions() {
        return {
            prefix: el('renPrefix')?.value || '',
            suffix: el('renSuffix')?.value || '',
            find: el('renFind')?.value || '',
            replace: el('renReplace')?.value || '',
            numbering: el('renNumbering')?.checked || false,
            numbering_start: parseInt(el('renNumStart')?.value || '1'),
            numbering_digits: parseInt(el('renNumDigits')?.value || '3'),
            numbering_position: el('renNumPos')?.value || 'prefix',
        };
    }

    async function updatePreview() {
        const preview = el('renPreview');
        if (!preview || uploadedFiles.length === 0) {
            if (preview) preview.innerHTML = '';
            return;
        }

        const opts = getOptions();
        const filenames = uploadedFiles.map(f => f.name);

        try {
            const res = await fetch(`${API}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames, ...opts }),
            });
            if (!res.ok) return;
            const data = await res.json();

            preview.innerHTML = data.results.map(r => `
                <div class="img-file-item" style="${r.changed ? '' : 'opacity:0.5'}">
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.original}</span>
                    <span style="color:var(--text-secondary);flex-shrink:0;">→</span>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${r.changed ? 'var(--secondary-color)' : 'var(--text-secondary)'}; font-weight:${r.changed ? '600' : '400'};">${r.renamed}</span>
                </div>
            `).join('');
        } catch (e) {
            // silent
        }
    }

    function toggleNumberingOpts() {
        const show = el('renNumbering')?.checked;
        const opts = el('renNumOpts');
        if (opts) opts.style.display = show ? 'grid' : 'none';
    }

    async function applyRename() {
        if (uploadedFiles.length === 0) return;
        const btn = el('renApplyBtn');
        btn.disabled = true;
        showProgress(10, '上傳中...');

        try {
            const fd = new FormData();
            uploadedFiles.forEach(f => fd.append('files', f));
            const opts = getOptions();
            Object.entries(opts).forEach(([k, v]) => fd.append(k, String(v)));

            const res = await fetch(`${API}/apply`, { method: 'POST', body: fd });
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
        showDownload(blob, 'renamed_files.zip');
    }

    function showProgress(pct, msg) {
        const p = el('renProgress');
        if (!p) return;
        p.style.display = 'block';
        p.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--gradient);transition:width 0.3s;"></div></div><span style="font-size:12px;color:var(--text-secondary);">${pct}%</span></div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg}</div>`;
    }

    function showDownload(blob, filename) {
        const r = el('renResult');
        if (!r) return;
        const url = URL.createObjectURL(blob);
        r.style.display = 'block';
        r.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f0faf7;border-radius:8px;"><span style="font-size:24px;">✅</span><div style="flex:1;"><div style="font-weight:600;font-size:14px;">改名完成</div><div style="font-size:12px;color:var(--text-secondary);">${filename} (${fmtBytes(blob.size)})</div></div><a href="${url}" download="${filename}" class="btn btn-primary btn-small" style="flex:none;">⬇ 下載 ZIP</a></div>`;
    }

    function fmtBytes(b) { return b < 1024 ? b+' B' : b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }
    function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="batch-rename"]');
        if (page && page.classList.contains('active')) init();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="batch-rename"]');
        if (page) { observer.observe(page, { attributes: true, attributeFilter: ['class'] }); if (page.classList.contains('active')) init(); }
    });
})();
