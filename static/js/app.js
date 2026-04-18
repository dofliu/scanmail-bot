/**
 * ScanMail+ v4 — App Shell
 *
 * 嶄新 UI：分組導航 + 工具總覽面板 + 跨工具檔案傳遞
 * - CategoryNav  — 第一層分類 pills（智慧寄件 / 媒體工具 / 文件工具）
 * - ToolSubnav   — 第二層工具 chips（依分類動態顯示）
 * - Palette      — ⌘ / ⌘K 啟動器（搜尋＋鍵盤導覽）
 * - ToolBridge   — 跨工具檔案傳遞（掃描完成 → 圖片工具 / PDF / GIF…）
 * - Toast        — 全域通知系統
 */

const TOOLS = [
    { id: 'scanmail',     label: '掃描寄件',  icon: '📨', cat: 'scan',  desc: '拍照→AI 辨識→自動寫信寄出' },
    { id: 'image-tools',  label: '圖片工具',  icon: '🖼️', cat: 'media', desc: '縮放、轉檔、壓縮、浮水印' },
    { id: 'gif-tools',    label: 'GIF 製作',  icon: '🎞️', cat: 'media', desc: '從多張圖製作動畫 GIF' },
    { id: 'video-tools',  label: '影片工具',  icon: '🎬', cat: 'media', desc: '合併、轉 GIF、壓縮' },
    { id: 'pdf-tools',    label: 'PDF 工具',  icon: '📕', cat: 'doc',   desc: '合併、浮水印、密碼保護' },
    { id: 'doc-convert',  label: '文件轉檔',  icon: '🔄', cat: 'doc',   desc: 'Word / PDF / Markdown 互轉' },
    { id: 'batch-rename', label: '批次改名',  icon: '✏️', cat: 'doc',   desc: '前後綴、編號、搜尋取代' },
];

const CATEGORIES = [
    { id: 'scan',  label: '智慧寄件', icon: '📨' },
    { id: 'media', label: '媒體工具', icon: '🎨' },
    { id: 'doc',   label: '文件工具', icon: '📑' },
];

let currentTool = 'scanmail';
let currentCategory = 'scan';

// ════════════════════════════════════════════════════════════════
// 分組導航
// ════════════════════════════════════════════════════════════════

function renderCategoryNav() {
    const nav = document.getElementById('categoryNav');
    if (!nav) return;
    nav.innerHTML = CATEGORIES.map(c => `
        <button class="category-pill${c.id === currentCategory ? ' active' : ''}"
                data-cat="${c.id}" type="button">
            <span class="cp-icon">${c.icon}</span>
            <span>${c.label}</span>
        </button>
    `).join('');
    nav.querySelectorAll('.category-pill').forEach(p => {
        p.addEventListener('click', () => switchCategory(p.dataset.cat));
    });
}

function renderToolSubnav() {
    const sub = document.getElementById('toolSubnav');
    if (!sub) return;
    const tools = TOOLS.filter(t => t.cat === currentCategory);
    sub.innerHTML = tools.map(t => `
        <button class="tool-chip${t.id === currentTool ? ' active' : ''}"
                data-tool="${t.id}" type="button">
            <span class="tc-icon">${t.icon}</span>
            <span>${t.label}</span>
        </button>
    `).join('');
    sub.querySelectorAll('.tool-chip').forEach(c => {
        c.addEventListener('click', () => switchTool(c.dataset.tool));
    });
}

function switchCategory(catId) {
    currentCategory = catId;
    document.querySelectorAll('.category-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.cat === catId);
    });
    // 自動切到該分類第一個工具
    const tools = TOOLS.filter(t => t.cat === catId);
    if (tools.length && !tools.some(t => t.id === currentTool)) {
        switchTool(tools[0].id);
    } else {
        renderToolSubnav();
    }
}

function switchTool(toolId, opts = {}) {
    if (toolId === currentTool && !opts.force) return;
    const tool = TOOLS.find(t => t.id === toolId);
    if (!tool) return;

    currentTool = toolId;
    currentCategory = tool.cat;

    // 同步分類
    document.querySelectorAll('.category-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.cat === tool.cat);
    });
    renderToolSubnav();

    // 切換頁面
    document.querySelectorAll('.tool-page').forEach(page => {
        page.classList.toggle('active', page.dataset.tool === toolId);
    });

    // 滾動到頂端
    if (!opts.noScroll) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ════════════════════════════════════════════════════════════════
// 工具總覽面板（Palette）
// ════════════════════════════════════════════════════════════════

const Palette = (() => {
    let highlightIndex = 0;
    let visibleTools = TOOLS.slice();

    function open() {
        const overlay = document.getElementById('paletteOverlay');
        const search = document.getElementById('paletteSearch');
        if (!overlay) return;
        overlay.classList.add('open');
        search.value = '';
        highlightIndex = 0;
        visibleTools = TOOLS.slice();
        render();
        setTimeout(() => search.focus(), 50);
    }

    function close() {
        const overlay = document.getElementById('paletteOverlay');
        if (overlay) overlay.classList.remove('open');
    }

    function render() {
        const list = document.getElementById('paletteList');
        if (!list) return;

        if (visibleTools.length === 0) {
            list.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-secondary);font-size:14px;">沒有符合的工具</div>`;
            return;
        }

        // 依分類分組
        const byCat = {};
        visibleTools.forEach(t => {
            if (!byCat[t.cat]) byCat[t.cat] = [];
            byCat[t.cat].push(t);
        });

        let html = '';
        let runningIdx = 0;
        CATEGORIES.forEach(cat => {
            const items = byCat[cat.id];
            if (!items || !items.length) return;
            html += `<div class="palette-group-label">${cat.icon} ${cat.label}</div>`;
            items.forEach(t => {
                const active = runningIdx === highlightIndex ? ' highlighted' : '';
                html += `
                    <button class="palette-item${active}" data-tool="${t.id}" data-idx="${runningIdx}" type="button">
                        <div class="palette-icon">${t.icon}</div>
                        <div class="palette-meta">
                            <div class="palette-name">${t.label}</div>
                            <div class="palette-desc">${t.desc}</div>
                        </div>
                        <span class="palette-kbd">↵</span>
                    </button>
                `;
                runningIdx++;
            });
        });
        list.innerHTML = html;

        list.querySelectorAll('.palette-item').forEach(item => {
            item.addEventListener('click', () => {
                switchTool(item.dataset.tool);
                close();
            });
            item.addEventListener('mouseenter', () => {
                highlightIndex = parseInt(item.dataset.idx);
                list.querySelectorAll('.palette-item').forEach(i => i.classList.remove('highlighted'));
                item.classList.add('highlighted');
            });
        });
    }

    function filter(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) {
            visibleTools = TOOLS.slice();
        } else {
            visibleTools = TOOLS.filter(t =>
                t.label.toLowerCase().includes(q) ||
                t.desc.toLowerCase().includes(q) ||
                t.id.toLowerCase().includes(q)
            );
        }
        highlightIndex = 0;
        render();
    }

    function moveHighlight(delta) {
        if (!visibleTools.length) return;
        highlightIndex = (highlightIndex + delta + visibleTools.length) % visibleTools.length;
        render();
        const list = document.getElementById('paletteList');
        const target = list.querySelector('.palette-item.highlighted');
        if (target) target.scrollIntoView({ block: 'nearest' });
    }

    function activate() {
        const tool = visibleTools[highlightIndex];
        if (!tool) return;
        switchTool(tool.id);
        close();
    }

    function init() {
        const overlay = document.getElementById('paletteOverlay');
        const search = document.getElementById('paletteSearch');
        const fab = document.getElementById('quickSwitchFab');
        const headerBtn = document.getElementById('paletteBtn');

        if (fab) fab.addEventListener('click', open);
        if (headerBtn) headerBtn.addEventListener('click', open);

        if (overlay) {
            overlay.addEventListener('click', e => {
                if (e.target === overlay) close();
            });
        }
        if (search) {
            search.addEventListener('input', e => filter(e.target.value));
            search.addEventListener('keydown', e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); moveHighlight(1); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); moveHighlight(-1); }
                else if (e.key === 'Enter') { e.preventDefault(); activate(); }
                else if (e.key === 'Escape') { e.preventDefault(); close(); }
            });
        }

        // 全域快捷鍵：/ 開啟，Esc 關閉
        document.addEventListener('keydown', e => {
            const tag = (e.target && e.target.tagName) || '';
            const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable;
            if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && !editing) {
                e.preventDefault();
                open();
            } else if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) {
                close();
            }
        });
    }

    return { open, close, init };
})();

// ════════════════════════════════════════════════════════════════
// Toast 通知
// ════════════════════════════════════════════════════════════════

const Toast = (() => {
    function show(message, opts = {}) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const type = opts.type || 'info';
        const icon = opts.icon || ({ success: '✅', error: '❌', info: 'ℹ️' }[type] || 'ℹ️');
        const duration = opts.duration || 3200;

        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="t-icon">${icon}</span><span class="t-msg"></span>`;
        el.querySelector('.t-msg').textContent = message;
        container.appendChild(el);

        if (opts.action) {
            const btn = document.createElement('button');
            btn.textContent = opts.action.label;
            btn.style.cssText = 'background:rgba(255,255,255,0.22);border:none;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-left:auto;';
            btn.addEventListener('click', () => {
                opts.action.onClick();
                dismiss(el);
            });
            el.appendChild(btn);
        }

        setTimeout(() => dismiss(el), duration);
        return el;
    }

    function dismiss(el) {
        if (!el || !el.parentNode) return;
        el.classList.add('removing');
        setTimeout(() => el.remove(), 250);
    }

    return { show };
})();

// ════════════════════════════════════════════════════════════════
// ToolBridge — 跨工具檔案傳遞
// ════════════════════════════════════════════════════════════════
//
// 用法：
//   ToolBridge.sendFilesToTool('image-tools', [file], { action: 'watermark' });
//
// 機制：
//   1) 把檔案放入暫存
//   2) 切到目標工具
//   3) 找到目標工具的 file input、設定 files、觸發 change 事件
//   4) 顯示 incoming-banner 提示
//
const ToolBridge = (() => {
    // 各工具的接收口設定
    const TARGETS = {
        'image-tools': { fileInputId: 'imgFileInput', dropzoneId: 'imgDropzone', actionTabSel: '.img-action-tab' },
        'pdf-tools':   { fileInputId: 'pdfFileInput', dropzoneId: 'pdfDropzone', actionTabSel: '.pdf-action-tab' },
        'gif-tools':   { fileInputId: 'gifFileInput', dropzoneId: 'gifDropzone' },
        'video-tools': { fileInputId: 'vidFileInput', dropzoneId: 'vidDropzone', actionTabSel: '.vid-action-tab' },
        'doc-convert': { fileInputId: 'docFileInput' },
        'batch-rename':{ fileInputId: 'renFileInput', dropzoneId: 'renDropzone' },
    };

    function sendFilesToTool(toolId, files, opts = {}) {
        const target = TARGETS[toolId];
        if (!target) {
            Toast.show(`無法傳送到 ${toolId}`, { type: 'error' });
            return false;
        }
        if (!files || !files.length) {
            Toast.show('沒有可傳送的檔案', { type: 'error' });
            return false;
        }

        // 切到目標工具
        switchTool(toolId);

        // 等待頁面渲染再注入檔案
        setTimeout(() => {
            const input = document.getElementById(target.fileInputId);
            if (!input) {
                Toast.show('目標工具尚未準備好', { type: 'error' });
                return;
            }

            // 切換到指定 action（如果有）
            if (opts.action && target.actionTabSel) {
                const tab = document.querySelector(`${target.actionTabSel}[data-action="${opts.action}"]`);
                if (tab) tab.click();
            }

            // 透過 DataTransfer 將 File 注入到 input
            try {
                const dt = new DataTransfer();
                files.forEach(f => dt.items.add(f));
                input.files = dt.files;
                // 觸發 change，讓工具的 handleFiles 接手
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
                console.error('檔案注入失敗', e);
                Toast.show('瀏覽器不支援自動帶入，請手動上傳', { type: 'error' });
                return;
            }

            // 顯示 incoming-banner（暫時性提示）
            showIncomingBanner(toolId, files, opts);
            Toast.show(`已將 ${files.length} 個檔案送到「${getLabel(toolId)}」`, { type: 'success' });

            // 滾到工具的上傳區
            const dz = target.dropzoneId && document.getElementById(target.dropzoneId);
            if (dz) dz.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);

        return true;
    }

    function showIncomingBanner(toolId, files, opts) {
        const page = document.querySelector(`[data-tool="${toolId}"]`);
        if (!page) return;
        // 移除既有橫幅
        page.querySelectorAll('.incoming-banner').forEach(b => b.remove());

        const banner = document.createElement('div');
        banner.className = 'incoming-banner';
        const sourceLabel = opts.sourceLabel || '掃描結果';
        const actionLabel = opts.action ? `（已切到「${opts.action}」模式）` : '';
        banner.innerHTML = `
            <span class="ib-icon">📥</span>
            <div>
                <strong>${sourceLabel}</strong>已自動載入 ${files.length} 個檔案${actionLabel}，可直接設定參數開始處理。
            </div>
            <button class="ib-close" type="button" aria-label="關閉">&times;</button>
        `;
        banner.querySelector('.ib-close').addEventListener('click', () => banner.remove());

        // 插到頁面最上方
        const firstCard = page.querySelector('.card');
        if (firstCard) {
            firstCard.parentNode.insertBefore(banner, firstCard);
        } else {
            page.prepend(banner);
        }
    }

    function getLabel(toolId) {
        const t = TOOLS.find(t => t.id === toolId);
        return t ? t.label : toolId;
    }

    // 工具：把 dataURL 轉成 File（給 scanmail 等使用 base64 的場景）
    async function dataUrlToFile(dataUrl, filename, mime) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: mime || blob.type || 'image/jpeg' });
    }

    return { sendFilesToTool, dataUrlToFile, getLabel };
})();

// 暴露為全域，供 scanmail.js 等模組使用
window.ToolBridge = ToolBridge;
window.Toast = Toast;
window.AppNav = { switchTool, switchCategory };

// ════════════════════════════════════════════════════════════════
// 啟動
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    renderCategoryNav();
    renderToolSubnav();
    Palette.init();
});
