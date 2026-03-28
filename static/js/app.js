/**
 * ScanMail+ — App Shell 導航管理
 *
 * 管理頂層工具頁面之間的切換。
 * 各工具的邏輯放在各自的 JS 檔案中。
 */

const TOOLS = [
    { id: 'scanmail',    label: '掃描郵寄', icon: '📨' },
    { id: 'image-tools', label: '圖片工具', icon: '🖼️' },
    { id: 'gif-tools',   label: 'GIF',      icon: '🎞️' },
    { id: 'video-tools', label: '影片工具', icon: '🎬' },
    { id: 'pdf-tools',   label: 'PDF 工具', icon: '📕' },
    { id: 'doc-convert', label: '文件轉檔', icon: '🔄' },
    { id: 'batch-rename',label: '批次改名', icon: '✏️' },
];

let currentTool = 'scanmail';

function initNavigation() {
    const nav = document.getElementById('toolNav');
    if (!nav) return;

    // 產生 tab 按鈕
    nav.innerHTML = TOOLS.map(t => `
        <button class="tool-tab${t.id === currentTool ? ' active' : ''}"
                data-tool="${t.id}">
            <span>${t.icon}</span>
            <span>${t.label}</span>
        </button>
    `).join('');

    // 綁定切換事件
    nav.querySelectorAll('.tool-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTool(tab.dataset.tool));
    });
}

function switchTool(toolId) {
    if (toolId === currentTool) return;
    currentTool = toolId;

    // 更新 tab 樣式
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tool === toolId);
    });

    // 切換頁面
    document.querySelectorAll('.tool-page').forEach(page => {
        page.classList.toggle('active', page.dataset.tool === toolId);
    });
}

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
});
