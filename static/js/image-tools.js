/**
 * 圖片工具 — 縮放、格式轉換、壓縮、浮水印
 */
(function() {
    const API = '/api/tools/image';

    // ── 狀態 ──
    let uploadedFiles = [];
    let currentAction = 'resize'; // resize | convert | compress | watermark

    // ── DOM 快取 ──
    function el(id) { return document.getElementById(id); }

    // ── 初始化（在 tool page 顯示時呼叫）──
    function init() {
        const page = document.querySelector('[data-tool="image-tools"]');
        if (!page || page.dataset.initialized) return;
        page.dataset.initialized = 'true';

        setupEventListeners();
    }

    function setupEventListeners() {
        // 動作切換
        document.querySelectorAll('.img-action-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.img-action-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentAction = tab.dataset.action;
                showActionPanel(currentAction);
            });
        });

        // 拖放上傳區
        const dropzone = el('imgDropzone');
        if (dropzone) {
            dropzone.addEventListener('dragover', e => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
            dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
            dropzone.addEventListener('drop', e => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
                handleFiles(e.dataTransfer.files);
            });
            dropzone.addEventListener('click', () => el('imgFileInput').click());
        }

        const fileInput = el('imgFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', e => handleFiles(e.target.files));
        }

        // 處理按鈕
        const processBtn = el('imgProcessBtn');
        if (processBtn) {
            processBtn.addEventListener('click', processImages);
        }

        // 清除按鈕
        const clearBtn = el('imgClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                uploadedFiles = [];
                renderFileList();
                hideResult();
            });
        }
    }

    function handleFiles(fileList) {
        const validExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
        for (const file of fileList) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (validExts.includes(ext) && file.size <= 20 * 1024 * 1024) {
                uploadedFiles.push(file);
            }
        }
        renderFileList();
    }

    function renderFileList() {
        const list = el('imgFileList');
        const processBtn = el('imgProcessBtn');
        const clearBtn = el('imgClearBtn');
        if (!list) return;

        if (uploadedFiles.length === 0) {
            list.innerHTML = '';
            list.style.display = 'none';
            if (processBtn) processBtn.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        list.style.display = 'block';
        if (processBtn) processBtn.style.display = 'block';
        if (clearBtn) clearBtn.style.display = 'inline-flex';

        const totalSize = uploadedFiles.reduce((s, f) => s + f.size, 0);
        list.innerHTML = `
            <div style="font-size:13px; color:var(--text-secondary); margin-bottom:8px;">
                ${uploadedFiles.length} 個檔案，共 ${formatBytes(totalSize)}
            </div>
            ${uploadedFiles.map((f, i) => `
                <div class="img-file-item">
                    <span>${f.name}</span>
                    <span style="color:var(--text-secondary)">${formatBytes(f.size)}</span>
                    <button class="img-file-remove" data-idx="${i}">&times;</button>
                </div>
            `).join('')}
        `;

        list.querySelectorAll('.img-file-remove').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                uploadedFiles.splice(parseInt(btn.dataset.idx), 1);
                renderFileList();
            });
        });
    }

    function showActionPanel(action) {
        document.querySelectorAll('.img-options-panel').forEach(p => p.style.display = 'none');
        const panel = el(`imgOpts_${action}`);
        if (panel) panel.style.display = 'block';
    }

    // ── 處理 ──
    async function processImages() {
        if (uploadedFiles.length === 0) return;

        const progressEl = el('imgProgress');
        const resultEl = el('imgResult');
        const processBtn = el('imgProcessBtn');
        processBtn.disabled = true;
        progressEl.style.display = 'block';
        resultEl.style.display = 'none';

        try {
            if (uploadedFiles.length === 1) {
                await processSingle();
            } else {
                await processBatch();
            }
        } catch (err) {
            progressEl.innerHTML = `<div style="color:#d32f2f">處理失敗: ${err.message}</div>`;
        } finally {
            processBtn.disabled = false;
        }
    }

    async function processSingle() {
        const formData = new FormData();
        formData.append('file', uploadedFiles[0]);
        appendOptions(formData);

        const endpoint = `${API}/${currentAction}`;
        updateProgress(50, '處理中...');

        const response = await fetch(endpoint, { method: 'POST', body: formData });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || '處理失敗');
        }

        const blob = await response.blob();
        updateProgress(100, '完成！');
        showDownload(blob, `${currentAction}_result`);
    }

    async function processBatch() {
        const formData = new FormData();
        uploadedFiles.forEach(f => formData.append('files', f));
        appendOptions(formData);

        const endpoint = `${API}/batch/${currentAction}`;
        updateProgress(5, '上傳中...');

        const response = await fetch(endpoint, { method: 'POST', body: formData });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || '處理失敗');
        }

        const { task_id } = await response.json();
        await watchTaskProgress(task_id);
    }

    function appendOptions(formData) {
        if (currentAction === 'resize') {
            formData.append('width', el('imgResizeW')?.value || '800');
            formData.append('height', el('imgResizeH')?.value || '600');
            formData.append('mode', el('imgResizeMode')?.value || 'fit');
            formData.append('output_format', el('imgResizeFmt')?.value || 'JPEG');
            formData.append('quality', el('imgResizeQ')?.value || '85');
        } else if (currentAction === 'convert') {
            formData.append('target_format', el('imgConvertFmt')?.value || 'PNG');
            formData.append('quality', el('imgConvertQ')?.value || '85');
        } else if (currentAction === 'compress') {
            formData.append('quality', el('imgCompressQ')?.value || '70');
            formData.append('max_dimension', el('imgCompressMax')?.value || '0');
        } else if (currentAction === 'watermark') {
            formData.append('text', el('imgWmText')?.value || 'CONFIDENTIAL');
            formData.append('font_size', el('imgWmSize')?.value || '36');
            formData.append('opacity', el('imgWmOpacity')?.value || '80');
            formData.append('position', el('imgWmPos')?.value || 'center');
            formData.append('color', el('imgWmColor')?.value || '#000000');
        }
    }

    async function watchTaskProgress(taskId) {
        return new Promise((resolve, reject) => {
            const es = new EventSource(`${API}/task/${taskId}/progress`);
            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    updateProgress(data.progress, data.message);

                    if (data.status === 'completed') {
                        es.close();
                        downloadTaskResult(taskId);
                        resolve();
                    } else if (data.status === 'failed') {
                        es.close();
                        reject(new Error(data.error || '處理失敗'));
                    }
                } catch (e) {
                    // ignore parse errors
                }
            };
            es.onerror = () => {
                es.close();
                reject(new Error('連線中斷'));
            };
        });
    }

    async function downloadTaskResult(taskId) {
        const response = await fetch(`${API}/task/${taskId}/download`);
        if (!response.ok) throw new Error('下載失敗');
        const blob = await response.blob();
        showDownload(blob, `batch_${currentAction}_result`, 'zip');
    }

    // ── UI 更新 ──
    function updateProgress(percent, message) {
        const progressEl = el('imgProgress');
        if (!progressEl) return;
        progressEl.style.display = 'block';
        progressEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="flex:1; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden;">
                    <div style="width:${percent}%; height:100%; background:var(--gradient); transition:width 0.3s;"></div>
                </div>
                <span style="font-size:12px; color:var(--text-secondary); white-space:nowrap;">${percent}%</span>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${message}</div>
        `;
    }

    function showDownload(blob, filename, ext) {
        const resultEl = el('imgResult');
        if (!resultEl) return;

        const url = URL.createObjectURL(blob);
        const actualExt = ext || (blob.type.includes('zip') ? 'zip' : blob.type.split('/')[1] || 'jpg');
        const fullName = `${filename}.${actualExt}`;

        resultEl.style.display = 'block';
        resultEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; padding:12px; background:#f0faf7; border-radius:8px;">
                <span style="font-size:24px;">✅</span>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:14px;">處理完成</div>
                    <div style="font-size:12px; color:var(--text-secondary);">${fullName} (${formatBytes(blob.size)})</div>
                </div>
                <a href="${url}" download="${fullName}" class="btn btn-primary btn-small" style="flex:none;">
                    ⬇ 下載
                </a>
            </div>
        `;
    }

    function hideResult() {
        const r = el('imgResult');
        const p = el('imgProgress');
        if (r) r.style.display = 'none';
        if (p) p.style.display = 'none';
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ── 觀察 tool-page 切換 ──
    const observer = new MutationObserver(() => {
        const page = document.querySelector('[data-tool="image-tools"]');
        if (page && page.classList.contains('active')) {
            init();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.querySelector('[data-tool="image-tools"]');
        if (page) {
            observer.observe(page, { attributes: true, attributeFilter: ['class'] });
            // 如果已經 active 就直接 init
            if (page.classList.contains('active')) init();
        }
    });
})();
