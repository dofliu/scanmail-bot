/**
 * 文件轉檔 — Word⟷PDF、Markdown⟷PDF/Word
 */
(function() {
    const API = '/api/tools/convert';

    const CONVERSIONS = {
        'word-to-pdf':  { label: 'Word → PDF',     accept: '.docx', icon: '📄→📕' },
        'pdf-to-word':  { label: 'PDF → Word',     accept: '.pdf',  icon: '📕→📄' },
        'md-to-pdf':    { label: 'Markdown → PDF',  accept: '.md,.txt', icon: '📝→📕' },
        'md-to-word':   { label: 'Markdown → Word', accept: '.md,.txt', icon: '📝→📄' },
        'word-to-md':   { label: 'Word → Markdown', accept: '.docx', icon: '📄→📝' },
    };

    let currentConversion = 'word-to-pdf';
    let uploadedFile = null;

    function el(id) { return document.getElementById(id); }

    function init() {
        const page = document.querySelector('[data-tool="doc-convert"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        // 轉換類型切換
        document.querySelectorAll('.doc-conv-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.doc-conv-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentConversion = tab.dataset.conv;
                uploadedFile = null;
                updateUI();
            });
        });

        // 拖放
        const dz = el('docDropzone');
        if (dz) {
            dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
            dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
            dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) { uploadedFile = e.dataTransfer.files[0]; updateUI(); }});
            dz.addEventListener('click', () => el('docFileInput')?.click());
        }

        const fi = el('docFileInput');
        if (fi) fi.addEventListener('change', e => { if (e.target.files[0]) { uploadedFile = e.target.files[0]; updateUI(); } });

        const btn = el('docConvertBtn');
        if (btn) btn.addEventListener('click', convert);
    }

    function updateUI() {
        const info = CONVERSIONS[currentConversion];
        const hint = el('docDropHint');
        if (hint) hint.textContent = uploadedFile ? `✅ ${uploadedFile.name}` : `拖放${info.accept}檔案到此處`;

        const fi = el('docFileInput');
        if (fi) fi.accept = info.accept;

        const btn = el('docConvertBtn');
        if (btn) {
            btn.style.display = uploadedFile ? 'block' : 'none';
            btn.textContent = `⚡ ${info.label}`;
        }

        const r = el('docResult');
        if (r) r.style.display = 'none';
        const p = el('docProgress');
        if (p) p.style.display = 'none';
    }

    async function convert() {
        if (!uploadedFile) return;
        const btn = el('docConvertBtn');
        btn.disabled = true;
        showProgress(30, '轉換中...');

        try {
            const fd = new FormData();
            fd.append('file', uploadedFile);

            const res = await fetch(`${API}/${currentConversion}`, { method: 'POST', body: fd });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.detail || '轉換失敗');
            }

            showProgress(100, '完成！');
            const blob = await res.blob();
            const ext = currentConversion.includes('pdf') && !currentConversion.startsWith('pdf') ? 'pdf'
                      : currentConversion.includes('word') && !currentConversion.startsWith('word') ? 'docx'
                      : currentConversion.endsWith('md') ? 'md' : 'pdf';
            const filename = `converted.${ext}`;
            showDownload(blob, filename);
        } catch (err) {
            showProgress(0, `失敗: ${err.message}`);
        } finally {
            btn.disabled = false;
        }
    }

    function showProgress(pct, msg) {
        const p = el('docProgress');
        if (!p) return;
        p.style.display = 'block';
        p.innerHTML = `<div style="display:flex;align-items:center;gap:10px;"><div style="flex:1;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--gradient);transition:width 0.3s;"></div></div><span style="font-size:12px;color:var(--text-secondary);">${pct}%</span></div><div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">${msg}</div>`;
    }

    function showDownload(blob, filename) {
        const r = el('docResult');
        if (!r) return;
        const url = URL.createObjectURL(blob);
        const size = blob.size < 1048576 ? (blob.size/1024).toFixed(1)+' KB' : (blob.size/1048576).toFixed(1)+' MB';
        r.style.display = 'block';
        r.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f0faf7;border-radius:8px;"><span style="font-size:24px;">✅</span><div style="flex:1;"><div style="font-weight:600;font-size:14px;">轉換完成</div><div style="font-size:12px;color:var(--text-secondary);">${filename} (${size})</div></div><a href="${url}" download="${filename}" class="btn btn-primary btn-small" style="flex:none;">⬇ 下載</a></div>`;
    }

    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="doc-convert"]');
        if (page && page.classList.contains('active')) init();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="doc-convert"]');
        if (page) { observer.observe(page, { attributes: true, attributeFilter: ['class'] }); if (page.classList.contains('active')) init(); }
    });
})();
