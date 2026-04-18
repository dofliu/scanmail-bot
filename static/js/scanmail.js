// ==================== Constants ====================
const API_BASE = '/api';
const DOC_TYPES = {
    exam: { label: '試卷', icon: '📝', color: '#1D9E75' },
    official: { label: '公文', icon: '📋', color: '#534AB7' },
    receipt: { label: '收據', icon: '🧾', color: '#D85A30' },
    contract: { label: '合約', icon: '📄', color: '#185FA5' },
    report: { label: '報告', icon: '📊', color: '#993556' },
    letter: { label: '信件', icon: '✉️', color: '#3B6D11' },
    form: { label: '表單', icon: '📑', color: '#854F0B' },
    other: { label: '其他', icon: '📎', color: '#5F5E5A' }
};

// ==================== State ====================
let state = {
    currentStep: 1,
    uploadedFile: null,
    uploadedFileData: null,
    imageUploaded: false,
    scanProcessedUrl: null,
    selectedContact: null,
    selectedContacts: [],    // 批次寄送用：多選的聯絡人
    groups: [],              // 收件人群組列表
    analyzeResult: null,
    editingField: null,
    contacts: [],
    history: [],
    settings: {},
    // 裁切相關
    cropCorners: null,       // 四個角點 [[x,y], ...]（原圖座標）
    cropImageWidth: 0,       // 原圖寬度
    cropImageHeight: 0,      // 原圖高度
    cropDragging: -1,        // 正在拖曳的角點 index（-1=無）
    cropOriginalDataUrl: null, // 原圖 data URL（用於 canvas 繪製）
    // 多頁掃描
    pages: [],               // [{thumbnail: base64, index: number}, ...]
    multiPageMode: false     // 是否已進入多頁模式
};

// ==================== DOM Elements ====================
const elements = {
    // Steps
    steps: document.querySelectorAll('.step'),
    stepDots: document.querySelectorAll('.step-dot'),
    // Step 1
    cameraPreview: document.getElementById('cameraPreview'),
    cameraCanvas: document.getElementById('cameraCanvas'),
    cameraContainer: document.getElementById('cameraContainer'),
    captureBtn: document.getElementById('captureBtn'),
    uploadBtn: document.getElementById('uploadBtn'),
    fileInput: document.getElementById('fileInput'),
    thumbnailPreview: document.getElementById('thumbnailPreview'),
    thumbnailImage: document.getElementById('thumbnailImage'),
    retakeBtn: document.getElementById('retakeBtn'),
    retakeContainer: document.getElementById('retakeContainer'),
    nextStep1Btn: document.getElementById('nextStep1Btn'),
    // Scan Panel
    scanPanel: document.getElementById('scanPanel'),
    scanOriginal: document.getElementById('scanOriginal'),
    scanProcessed: document.getElementById('scanProcessed'),
    filterOptions: document.getElementById('filterOptions'),
    scanStatus: document.getElementById('scanStatus'),
    scanStatusText: document.getElementById('scanStatusText'),
    scanInfo: document.getElementById('scanInfo'),
    scanInfoText: document.getElementById('scanInfoText'),
    scanNextBtn: document.getElementById('scanNextBtn'),
    // Crop Editor
    cropEditorSection: document.getElementById('cropEditorSection'),
    scanResultSection: document.getElementById('scanResultSection'),
    cropCanvas: document.getElementById('cropCanvas'),
    cropCanvasWrapper: document.getElementById('cropCanvasWrapper'),
    cropAutoDetectBtn: document.getElementById('cropAutoDetectBtn'),
    cropResetBtn: document.getElementById('cropResetBtn'),
    cropApplyBtn: document.getElementById('cropApplyBtn'),
    cropHint: document.getElementById('cropHint'),
    cropEditAgainBtn: document.getElementById('cropEditAgainBtn'),
    // Rotation
    rotateCCWBtn: document.getElementById('rotateCCWBtn'),
    rotateCWBtn: document.getElementById('rotateCWBtn'),
    // Multi-page
    pagesStrip: document.getElementById('pagesStrip'),
    pagesCount: document.getElementById('pagesCount'),
    pagesList: document.getElementById('pagesList'),
    addPageBtn: document.getElementById('addPageBtn'),
    addMorePageBtn: document.getElementById('addMorePageBtn'),
    // Step 2
    addContactBtn: document.getElementById('addContactBtn'),
    addContactForm: document.getElementById('addContactForm'),
    contactName: document.getElementById('contactName'),
    contactEmail: document.getElementById('contactEmail'),
    contactDept: document.getElementById('contactDept'),
    contactTitle: document.getElementById('contactTitle'),
    cancelContactBtn: document.getElementById('cancelContactBtn'),
    saveContactBtn: document.getElementById('saveContactBtn'),
    contactsGrid: document.getElementById('contactsGrid'),
    noContactsMsg: document.getElementById('noContactsMsg'),
    // Step 3
    loadingState: document.getElementById('loadingState'),
    previewContent: document.getElementById('previewContent'),
    confidenceWarning: document.getElementById('confidenceWarning'),
    docTypeBadge: document.getElementById('docTypeBadge'),
    docTypeIcon: document.getElementById('docTypeIcon'),
    docTypeText: document.getElementById('docTypeText'),
    emailSubject: document.getElementById('emailSubject'),
    emailBody: document.getElementById('emailBody'),
    confidenceBadge: document.getElementById('confidenceBadge'),
    recipientDisplay: document.getElementById('recipientDisplay'),
    filenameDisplay: document.getElementById('filenameDisplay'),
    cancelBtn: document.getElementById('cancelBtn'),
    editBtn: document.getElementById('editBtn'),
    sendBtn: document.getElementById('sendBtn'),
    // Step 4
    successResult: document.getElementById('successResult'),
    errorResult: document.getElementById('errorResult'),
    resultSubject: document.getElementById('resultSubject'),
    resultRecipient: document.getElementById('resultRecipient'),
    resultFilename: document.getElementById('resultFilename'),
    restartBtn: document.getElementById('restartBtn'),
    retryBtn: document.getElementById('retryBtn'),
    backBtn: document.getElementById('backBtn'),
    errorMessage: document.getElementById('errorMessage'),
    // Side Panel
    hamburgerBtn: document.getElementById('hamburgerBtn'),
    sidePanel: document.getElementById('sidePanel'),
    panelCloseBtn: document.getElementById('panelCloseBtn'),
    overlay: document.getElementById('overlay'),
    panelTabs: document.querySelectorAll('.panel-tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    panelContactsList: document.getElementById('panelContactsList'),
    panelNoContacts: document.getElementById('panelNoContacts'),
    panelHistoryList: document.getElementById('panelHistoryList'),
    panelNoHistory: document.getElementById('panelNoHistory'),
    settingsForm: document.getElementById('settingsForm'),
    senderName: document.getElementById('senderName'),
    senderEmail: document.getElementById('senderEmail'),
    senderTitle: document.getElementById('senderTitle'),
    senderDept: document.getElementById('senderDept'),
    senderOrg: document.getElementById('senderOrg')
};

// Create file input for upload
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.id = 'fileInput';
fileInput.accept = 'image/*';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// ==================== Camera & Upload Functions ====================
async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' }
            },
            audio: false
        });
        elements.cameraPreview.srcObject = stream;
        elements.cameraPreview.play();
    } catch (error) {
        console.error('Camera error:', error);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false
            });
            elements.cameraPreview.srcObject = stream;
            elements.cameraPreview.play();
        } catch (fallbackError) {
            alert('無法啟用相機');
        }
    }
}

function capturePhoto() {
    const video = elements.cameraPreview;
    const canvas = elements.cameraCanvas;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
        state.uploadedFileData = blob;
        state.uploadedFile = 'captured_' + Date.now() + '.jpg';
        showThumbnail(canvas.toDataURL('image/jpeg'));
    }, 'image/jpeg', 0.95);
}

function showThumbnail(dataUrl) {
    elements.thumbnailImage.src = dataUrl;
    elements.thumbnailPreview.style.display = 'block';
    elements.cameraContainer.style.display = 'none';
    elements.retakeContainer.style.display = 'block';
    elements.captureBtn.style.display = 'none';
    elements.uploadBtn.style.display = 'none';
    elements.nextStep1Btn.style.display = 'none';
    // 自動啟動掃描處理
    startScanProcessing(dataUrl);
}

function hideThumbnail() {
    elements.thumbnailPreview.style.display = 'none';
    elements.cameraContainer.style.display = 'block';
    elements.retakeContainer.style.display = 'none';
    elements.captureBtn.style.display = 'flex';
    elements.uploadBtn.style.display = 'flex';
    elements.nextStep1Btn.style.display = 'none';
    // 隱藏掃描面板 & 重設裁切狀態
    elements.scanPanel.style.display = 'none';
    state.cropCorners = null;
    state.cropDragging = -1;
    state.cropOriginalDataUrl = null;
    _cropImage = null;
}

// ==================== 文件裁切與掃描處理 ====================

// ── 裁切 Canvas 繪製 ──

let _cropImage = null; // 快取的 Image 物件

function drawCropCanvas() {
    const canvas = elements.cropCanvas;
    const ctx = canvas.getContext('2d');
    if (!_cropImage || !_cropImage.complete) return;

    // 計算 canvas 顯示尺寸（適配容器寬度，最大高度 50vh）
    const wrapper = elements.cropCanvasWrapper;
    const maxW = wrapper.parentElement.clientWidth - 2;
    const maxH = window.innerHeight * 0.5;
    const imgW = _cropImage.naturalWidth;
    const imgH = _cropImage.naturalHeight;

    let dispW = imgW;
    let dispH = imgH;
    if (dispW > maxW) {
        dispH = dispH * (maxW / dispW);
        dispW = maxW;
    }
    if (dispH > maxH) {
        dispW = dispW * (maxH / dispH);
        dispH = maxH;
    }
    dispW = Math.round(dispW);
    dispH = Math.round(dispH);

    // 設定高解析度 canvas（支援 Retina）
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dispW * dpr;
    canvas.height = dispH * dpr;
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 繪製圖片
    ctx.drawImage(_cropImage, 0, 0, dispW, dispH);

    // 繪製半透明遮罩（裁切區域外變暗）
    if (state.cropCorners && state.cropCorners.length === 4) {
        const corners = state.cropCorners;
        const scaleX = dispW / state.cropImageWidth;
        const scaleY = dispH / state.cropImageHeight;

        // 畫暗色遮罩
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.rect(0, 0, dispW, dispH);
        // 挖出裁切區域
        ctx.moveTo(corners[0][0] * scaleX, corners[0][1] * scaleY);
        for (let i = 1; i < 4; i++) {
            ctx.lineTo(corners[i][0] * scaleX, corners[i][1] * scaleY);
        }
        ctx.closePath();
        ctx.fill('evenodd');
        ctx.restore();

        // 畫邊界線
        ctx.save();
        ctx.strokeStyle = '#0d9488';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(corners[0][0] * scaleX, corners[0][1] * scaleY);
        for (let i = 1; i < 4; i++) {
            ctx.lineTo(corners[i][0] * scaleX, corners[i][1] * scaleY);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // 畫角點拖曳把手
        const labels = ['TL', 'TR', 'BR', 'BL'];
        for (let i = 0; i < 4; i++) {
            const cx = corners[i][0] * scaleX;
            const cy = corners[i][1] * scaleY;
            const isActive = (state.cropDragging === i);

            // 外圈
            ctx.beginPath();
            ctx.arc(cx, cy, isActive ? 14 : 11, 0, Math.PI * 2);
            ctx.fillStyle = isActive ? 'rgba(13,148,136,0.9)' : 'rgba(13,148,136,0.7)';
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 內圈
            ctx.beginPath();
            ctx.arc(cx, cy, 4, 0, Math.PI * 2);
            ctx.fillStyle = 'white';
            ctx.fill();
        }
    }
}

function getCropCanvasScale() {
    const canvas = elements.cropCanvas;
    const dispW = parseInt(canvas.style.width);
    const dispH = parseInt(canvas.style.height);
    return {
        x: dispW / state.cropImageWidth,
        y: dispH / state.cropImageHeight,
        dispW, dispH
    };
}

function getCanvasPointerPos(e) {
    const canvas = elements.cropCanvas;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: clientX - rect.left,
        y: clientY - rect.top
    };
}

function findNearestCorner(pos, threshold) {
    if (!state.cropCorners) return -1;
    const scale = getCropCanvasScale();
    let minDist = Infinity;
    let minIdx = -1;
    for (let i = 0; i < 4; i++) {
        const cx = state.cropCorners[i][0] * scale.x;
        const cy = state.cropCorners[i][1] * scale.y;
        const dist = Math.hypot(pos.x - cx, pos.y - cy);
        if (dist < threshold && dist < minDist) {
            minDist = dist;
            minIdx = i;
        }
    }
    return minIdx;
}

// ── 拖曳事件 ──

function onCropPointerDown(e) {
    if (!state.cropCorners) return;
    const pos = getCanvasPointerPos(e);
    const idx = findNearestCorner(pos, 30);
    if (idx >= 0) {
        state.cropDragging = idx;
        drawCropCanvas();
        e.preventDefault();
    }
}

function onCropPointerMove(e) {
    if (state.cropDragging < 0) return;
    e.preventDefault();
    const pos = getCanvasPointerPos(e);
    const scale = getCropCanvasScale();
    let newX = Math.round(pos.x / scale.x);
    let newY = Math.round(pos.y / scale.y);
    newX = Math.max(0, Math.min(state.cropImageWidth, newX));
    newY = Math.max(0, Math.min(state.cropImageHeight, newY));
    state.cropCorners[state.cropDragging] = [newX, newY];
    drawCropCanvas();
    // 拖曳中也更新即時預覽（throttled）
    updateLivePreview();
}

function onCropPointerUp(e) {
    if (state.cropDragging >= 0) {
        state.cropDragging = -1;
        drawCropCanvas();
        // 拖曳結束後更新即時預覽
        updateLivePreview();
    }
}

function initCropCanvasEvents() {
    const canvas = elements.cropCanvas;
    // 滑鼠
    canvas.addEventListener('mousedown', onCropPointerDown);
    canvas.addEventListener('mousemove', onCropPointerMove);
    canvas.addEventListener('mouseup', onCropPointerUp);
    canvas.addEventListener('mouseleave', onCropPointerUp);
    // 觸控
    canvas.addEventListener('touchstart', onCropPointerDown, { passive: false });
    canvas.addEventListener('touchmove', onCropPointerMove, { passive: false });
    canvas.addEventListener('touchend', onCropPointerUp);
    canvas.addEventListener('touchcancel', onCropPointerUp);
}

function setDefaultCorners() {
    // 預設裁切範圍：圖片邊緣內縮 5%
    const m = 0.05;
    const w = state.cropImageWidth;
    const h = state.cropImageHeight;
    state.cropCorners = [
        [Math.round(w * m), Math.round(h * m)],             // 左上
        [Math.round(w * (1 - m)), Math.round(h * m)],       // 右上
        [Math.round(w * (1 - m)), Math.round(h * (1 - m))], // 右下
        [Math.round(w * m), Math.round(h * (1 - m))]        // 左下
    ];
}

// ── 即時預覽（客戶端透視校正）──

let _livePreviewTimer = null;

function updateLivePreview() {
    // debounce 150ms（拖曳中不要太頻繁更新）
    clearTimeout(_livePreviewTimer);
    _livePreviewTimer = setTimeout(_renderLivePreview, 150);
}

function _renderLivePreview() {
    const section = document.getElementById('livePreviewSection');
    const canvas = document.getElementById('livePreviewCanvas');
    if (!section || !canvas || !_cropImage || !state.cropCorners) return;

    const corners = state.cropCorners;
    if (corners.length !== 4) return;

    section.style.display = 'block';
    const ctx = canvas.getContext('2d');

    // 計算輸出尺寸（根據角點估算文件寬高）
    const [tl, tr, br, bl] = corners;
    const wTop = Math.hypot(tr[0]-tl[0], tr[1]-tl[1]);
    const wBot = Math.hypot(br[0]-bl[0], br[1]-bl[1]);
    const hLeft = Math.hypot(bl[0]-tl[0], bl[1]-tl[1]);
    const hRight = Math.hypot(br[0]-tr[0], br[1]-tr[1]);
    let outW = Math.round(Math.max(wTop, wBot));
    let outH = Math.round(Math.max(hLeft, hRight));

    // 限制預覽尺寸
    const maxDim = 400;
    if (outW > maxDim || outH > maxDim) {
        const ratio = maxDim / Math.max(outW, outH);
        outW = Math.round(outW * ratio);
        outH = Math.round(outH * ratio);
    }
    outW = Math.max(outW, 50);
    outH = Math.max(outH, 50);

    canvas.width = outW;
    canvas.height = outH;

    // 用三角形網格做透視變換
    // 把四邊形分成 N×N 個小格子，每個格子畫成兩個三角形
    const gridN = 12;
    for (let gy = 0; gy < gridN; gy++) {
        for (let gx = 0; gx < gridN; gx++) {
            // 來源四邊形中的小格子四個角（雙線性插值）
            const u0 = gx / gridN, u1 = (gx+1) / gridN;
            const v0 = gy / gridN, v1 = (gy+1) / gridN;

            const s00 = _bilerp(corners, u0, v0);
            const s10 = _bilerp(corners, u1, v0);
            const s01 = _bilerp(corners, u0, v1);
            const s11 = _bilerp(corners, u1, v1);

            // 目標矩形中的對應位置
            const d00 = [u0 * outW, v0 * outH];
            const d10 = [u1 * outW, v0 * outH];
            const d01 = [u0 * outW, v1 * outH];
            const d11 = [u1 * outW, v1 * outH];

            // 畫兩個三角形
            _drawTriangle(ctx, _cropImage, s00, s10, s01, d00, d10, d01);
            _drawTriangle(ctx, _cropImage, s10, s11, s01, d10, d11, d01);
        }
    }
}

function _bilerp(corners, u, v) {
    // 雙線性插值：(u,v) ∈ [0,1]×[0,1] → 四邊形內的座標
    const [tl, tr, br, bl] = corners;
    const x = (1-v) * ((1-u)*tl[0] + u*tr[0]) + v * ((1-u)*bl[0] + u*br[0]);
    const y = (1-v) * ((1-u)*tl[1] + u*tr[1]) + v * ((1-u)*bl[1] + u*br[1]);
    return [x, y];
}

function _drawTriangle(ctx, img, s0, s1, s2, d0, d1, d2) {
    // 用 canvas transform + clip 畫一個三角形的紋理映射
    ctx.save();

    // Clip 到目標三角形
    ctx.beginPath();
    ctx.moveTo(d0[0], d0[1]);
    ctx.lineTo(d1[0], d1[1]);
    ctx.lineTo(d2[0], d2[1]);
    ctx.closePath();
    ctx.clip();

    // 計算仿射變換矩陣：將 source 三角形映射到 dest 三角形
    // | d0x d1x d2x |   | s0x s1x s2x | ^-1
    // | d0y d1y d2y | = | s0y s1y s2y |
    // |  1   1   1  |   |  1   1   1  |

    const sx0 = s0[0], sy0 = s0[1];
    const sx1 = s1[0], sy1 = s1[1];
    const sx2 = s2[0], sy2 = s2[1];
    const dx0 = d0[0], dy0 = d0[1];
    const dx1 = d1[0], dy1 = d1[1];
    const dx2 = d2[0], dy2 = d2[1];

    // source 矩陣的逆
    const det = sx0*(sy1-sy2) + sx1*(sy2-sy0) + sx2*(sy0-sy1);
    if (Math.abs(det) < 0.001) { ctx.restore(); return; }
    const idet = 1 / det;

    const a = ((sy1-sy2)*dx0 + (sy2-sy0)*dx1 + (sy0-sy1)*dx2) * idet;
    const b = ((sx2-sx1)*dx0 + (sx0-sx2)*dx1 + (sx1-sx0)*dx2) * idet;
    const c = ((sx1*sy2-sx2*sy1)*dx0 + (sx2*sy0-sx0*sy2)*dx1 + (sx0*sy1-sx1*sy0)*dx2) * idet;
    const d = ((sy1-sy2)*dy0 + (sy2-sy0)*dy1 + (sy0-sy1)*dy2) * idet;
    const e = ((sx2-sx1)*dy0 + (sx0-sx2)*dy1 + (sx1-sx0)*dy2) * idet;
    const f = ((sx1*sy2-sx2*sy1)*dy0 + (sx2*sy0-sx0*sy2)*dy1 + (sx0*sy1-sx1*sy0)*dy2) * idet;

    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
}

// ── 主流程 ──

async function startScanProcessing(originalDataUrl) {
    // 顯示掃描面板，進入裁切模式
    elements.scanPanel.style.display = 'block';
    elements.cropEditorSection.style.display = 'block';
    elements.scanResultSection.style.display = 'none';
    elements.scanStatus.style.display = 'flex';
    elements.scanStatusText.textContent = '正在上傳並偵測文件邊界...';
    elements.scanInfo.style.display = 'none';
    elements.scanNextBtn.disabled = true;
    elements.cropHint.textContent = '正在自動偵測文件邊界...';
    const qa = document.getElementById('scanQuickActions');
    if (qa) qa.style.display = 'none';

    // 儲存原圖 data URL
    state.cropOriginalDataUrl = originalDataUrl;

    // 重設濾鏡選擇
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="auto"]').classList.add('active');

    try {
        // Step 1: 上傳圖片
        await uploadDocument();

        // Step 2: 偵測邊界（不套用濾鏡，只取得角點）
        elements.scanStatusText.textContent = '正在偵測文件邊界...';
        const detectRes = await fetch(`${API_BASE}/scan/detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!detectRes.ok) throw new Error('邊界偵測失敗');
        const detectResult = await detectRes.json();

        state.cropImageWidth = detectResult.image_width;
        state.cropImageHeight = detectResult.image_height;

        if (detectResult.detected && detectResult.corners) {
            state.cropCorners = detectResult.corners;
            elements.cropHint.textContent = '✅ 已自動偵測到文件邊界，可拖曳角點微調';
        } else {
            // 未偵測到邊界，設定預設裁切框
            setDefaultCorners();
            elements.cropHint.textContent = 'ℹ️ 未偵測到明確邊界，請手動拖曳角點選取文件範圍';
        }

        // 載入原圖到 canvas
        _cropImage = new Image();
        _cropImage.onload = () => {
            drawCropCanvas();
            initCropCanvasEvents();
            updateLivePreview();
        };
        _cropImage.src = originalDataUrl;

        elements.scanStatus.style.display = 'none';

    } catch (error) {
        console.error('Scan detect error:', error);
        elements.scanStatusText.textContent = '邊界偵測失敗';
        elements.cropHint.textContent = '偵測失敗，請手動選取或直接裁切處理';

        // 用預設值
        state.cropImageWidth = 1000;
        state.cropImageHeight = 1000;
        setDefaultCorners();

        _cropImage = new Image();
        _cropImage.onload = () => {
            state.cropImageWidth = _cropImage.naturalWidth;
            state.cropImageHeight = _cropImage.naturalHeight;
            setDefaultCorners();
            drawCropCanvas();
            initCropCanvasEvents();
        };
        _cropImage.src = originalDataUrl;

        elements.scanStatus.style.display = 'none';
    }
}

async function applyCropAndProcess() {
    if (!state.cropCorners) return;

    elements.scanStatus.style.display = 'flex';
    elements.scanStatusText.textContent = '正在裁切並處理文件...';
    elements.cropApplyBtn.disabled = true;

    try {
        // 取得目前選取的濾鏡
        const activeFilter = document.querySelector('.filter-btn.active');
        const filterName = activeFilter ? activeFilter.dataset.filter : 'auto';

        // 呼叫 process API，帶入手動角點（確保為整數）
        const intCorners = state.cropCorners.map(c => [Math.round(c[0]), Math.round(c[1])]);
        const response = await fetch(`${API_BASE}/scan/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                corners: intCorners,
                filter_name: filterName,
                auto_detect: false
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || '裁切處理失敗');
        }
        const result = await response.json();

        if (result.success && result.image_base64) {
            const processedUrl = 'data:image/jpeg;base64,' + result.image_base64;

            // 切換到結果預覽
            elements.cropEditorSection.style.display = 'none';
            elements.scanResultSection.style.display = 'block';
            elements.scanOriginal.src = state.cropOriginalDataUrl;
            elements.scanProcessed.src = processedUrl;
            state.scanProcessedUrl = processedUrl;
            const qa = document.getElementById('scanQuickActions');
            if (qa) qa.style.display = 'block';

            // 顯示資訊（含變形等級與品質提示）
            let infoText = '✅ 文件裁切完成';
            infoText += ` | 濾鏡: ${getFilterLabel(result.filter_applied)}`;
            if (result.processed_size) {
                infoText += ` | ${result.processed_size[0]}x${result.processed_size[1]}`;
            }
            if (result.distortion) {
                const d = result.distortion;
                const angle = Math.round(d.estimated_angle);
                if (d.level === 'extreme') {
                    infoText += ` | ⚠️ 傾斜角度過大(~${angle}°)，文字可能略有模糊，建議重新拍攝`;
                } else if (d.level === 'high') {
                    infoText += ` | ⚠️ 傾斜較大(~${angle}°)，已自動補償`;
                } else if (d.level === 'medium') {
                    infoText += ` | 傾斜 ~${angle}°，已校正`;
                }
            }
            elements.scanInfoText.textContent = infoText;
            elements.scanInfo.style.display = 'block';
            elements.scanNextBtn.disabled = false;
        }

        elements.scanStatus.style.display = 'none';
        elements.cropApplyBtn.disabled = false;

        // 顯示多頁面板（含「加入此頁」按鈕）
        elements.pagesStrip.style.display = 'block';
        // 如果已有頁面，載入顯示
        if (state.multiPageMode) {
            await loadPages();
        }

    } catch (error) {
        console.error('Crop process error:', error);
        elements.scanStatusText.textContent = '裁切處理失敗';
        elements.cropApplyBtn.disabled = false;
        setTimeout(() => elements.scanStatus.style.display = 'none', 2000);
    }
}

function showCropEditor() {
    elements.cropEditorSection.style.display = 'block';
    elements.scanResultSection.style.display = 'none';
    elements.scanNextBtn.disabled = true;
    const qa = document.getElementById('scanQuickActions');
    if (qa) qa.style.display = 'none';
    drawCropCanvas();
}

function getFilterLabel(filterName) {
    const labels = {
        'auto': '🪄 自動',
        'scan': '🖨️ 專業掃描',
        'color_doc': '🔴 彩色公文',
        'document': '📄 文件',
        'enhance': '🔆 增強',
        'bw': '◼️ 黑白',
        'original': '🖼️ 原圖'
    };
    return labels[filterName] || filterName;
}

async function switchFilter(filterName) {
    elements.scanStatus.style.display = 'flex';
    elements.scanStatusText.textContent = `正在套用${getFilterLabel(filterName)}濾鏡...`;
    elements.scanNextBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/scan/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filter_name: filterName })
        });

        if (!response.ok) throw new Error('濾鏡套用失敗');
        const result = await response.json();

        if (result.success && result.image_base64) {
            const processedUrl = 'data:image/jpeg;base64,' + result.image_base64;
            elements.scanProcessed.src = processedUrl;
            state.scanProcessedUrl = processedUrl;
        }

        elements.scanStatus.style.display = 'none';
        elements.scanNextBtn.disabled = false;

    } catch (error) {
        console.error('Filter error:', error);
        elements.scanStatusText.textContent = '濾鏡套用失敗';
        elements.scanNextBtn.disabled = false;
        setTimeout(() => {
            elements.scanStatus.style.display = 'none';
        }, 2000);
    }
}

// ==================== 圖片旋轉 ====================

async function rotateImage(angle) {
    elements.scanStatus.style.display = 'flex';
    elements.scanStatusText.textContent = `正在旋轉 ${angle > 0 ? '右' : '左'}轉 ${Math.abs(angle)}°...`;

    try {
        const response = await fetch(`${API_BASE}/scan/rotate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ angle })
        });

        if (!response.ok) throw new Error('旋轉失敗');
        const result = await response.json();

        if (result.success) {
            // 更新 crop canvas 的原圖
            const newDataUrl = 'data:image/jpeg;base64,' + result.image_base64;
            state.cropOriginalDataUrl = newDataUrl;
            state.cropImageWidth = result.image_width;
            state.cropImageHeight = result.image_height;
            state.cropCorners = null;
            state.cropDragging = -1;

            // 重新載入 canvas 圖片
            _cropImage = new Image();
            _cropImage.onload = () => {
                setDefaultCorners();
                drawCropCanvas();
                elements.cropHint.textContent = '已旋轉，請重新調整裁切範圍或自動偵測';
            };
            _cropImage.src = newDataUrl;

            // 同時更新縮圖
            elements.thumbnailImage.src = newDataUrl;
        }

        elements.scanStatus.style.display = 'none';
    } catch (error) {
        console.error('Rotate error:', error);
        elements.scanStatusText.textContent = '旋轉失敗';
        setTimeout(() => elements.scanStatus.style.display = 'none', 2000);
    }
}

// ==================== 多頁掃描 ====================

function renderPagesStrip() {
    if (state.pages.length === 0) {
        elements.pagesStrip.style.display = 'none';
        return;
    }

    elements.pagesStrip.style.display = 'block';
    elements.pagesCount.textContent = `${state.pages.length} 頁`;

    elements.pagesList.innerHTML = state.pages.map((page, i) => `
        <div class="page-thumb" draggable="true" data-page-index="${i}">
            <img src="data:image/jpeg;base64,${page.thumbnail}" alt="第 ${i + 1} 頁">
            <span class="page-number">${i + 1}</span>
            <button class="page-remove" data-remove-index="${i}">&times;</button>
        </div>
    `).join('');

    // 刪除按鈕事件
    elements.pagesList.querySelectorAll('.page-remove').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.removeIndex);
            await removePage(idx);
        });
    });

    // 拖曳排序事件
    setupPageDragAndDrop();
}

function setupPageDragAndDrop() {
    const thumbs = elements.pagesList.querySelectorAll('.page-thumb');
    let dragIdx = -1;

    thumbs.forEach(thumb => {
        thumb.addEventListener('dragstart', (e) => {
            dragIdx = parseInt(thumb.dataset.pageIndex);
            thumb.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        thumb.addEventListener('dragend', () => {
            thumb.classList.remove('dragging');
            thumbs.forEach(t => t.classList.remove('drag-over'));
        });

        thumb.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            thumb.classList.add('drag-over');
        });

        thumb.addEventListener('dragleave', () => {
            thumb.classList.remove('drag-over');
        });

        thumb.addEventListener('drop', async (e) => {
            e.preventDefault();
            thumb.classList.remove('drag-over');
            const dropIdx = parseInt(thumb.dataset.pageIndex);
            if (dragIdx >= 0 && dragIdx !== dropIdx) {
                await reorderPages(dragIdx, dropIdx);
            }
        });
    });
}

async function addCurrentPage() {
    elements.scanStatus.style.display = 'flex';
    elements.scanStatusText.textContent = '正在加入頁面...';

    try {
        const response = await fetch(`${API_BASE}/pages/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error('加入頁面失敗');
        const result = await response.json();

        if (result.success) {
            // 重新載入頁面列表
            await loadPages();
            state.multiPageMode = true;
            elements.scanStatus.style.display = 'none';
        }
    } catch (error) {
        console.error('Add page error:', error);
        elements.scanStatusText.textContent = '加入頁面失敗';
        setTimeout(() => elements.scanStatus.style.display = 'none', 2000);
    }
}

async function loadPages() {
    try {
        const response = await fetch(`${API_BASE}/pages`);
        if (!response.ok) throw new Error('載入頁面失敗');
        const result = await response.json();

        state.pages = result.pages || [];
        renderPagesStrip();
    } catch (error) {
        console.error('Load pages error:', error);
    }
}

async function removePage(index) {
    try {
        const response = await fetch(`${API_BASE}/pages/${index}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('刪除頁面失敗');
        await loadPages();
    } catch (error) {
        console.error('Remove page error:', error);
    }
}

async function reorderPages(fromIdx, toIdx) {
    // 建立新順序
    const order = state.pages.map((_, i) => i);
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);

    try {
        const response = await fetch(`${API_BASE}/pages/reorder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });
        if (!response.ok) throw new Error('排序失敗');
        await loadPages();
    } catch (error) {
        console.error('Reorder error:', error);
    }
}

function startNewPageScan() {
    // 重設 Step 1 狀態，準備掃描下一頁
    state.uploadedFile = null;
    state.uploadedFileData = null;
    state.imageUploaded = false;
    state.scanProcessedUrl = null;
    state.cropCorners = null;
    state.cropDragging = -1;
    state.cropOriginalDataUrl = null;
    _cropImage = null;

    // 重設 UI
    elements.thumbnailPreview.style.display = 'none';
    elements.cameraContainer.style.display = 'block';
    elements.retakeContainer.style.display = 'none';
    elements.captureBtn.style.display = 'flex';
    elements.uploadBtn.style.display = 'flex';
    elements.nextStep1Btn.style.display = 'none';
    elements.scanPanel.style.display = 'none';

    // 重新啟動相機
    initCamera();
}

// ==================== Step Navigation ====================
function goToStep(step) {
    if (step < 1 || step > 4) return;

    // Hide all steps
    elements.steps.forEach(s => s.classList.remove('active'));
    elements.stepDots.forEach(d => d.classList.remove('active', 'completed'));

    // Show current step
    document.querySelector(`.step[data-step="${step}"]`).classList.add('active');

    // Update step indicators
    for (let i = 1; i <= 4; i++) {
        const dot = document.querySelector(`.step-dot[data-step="${i}"]`);
        if (i < step) {
            dot.classList.add('completed');
        } else if (i === step) {
            dot.classList.add('active');
        }
    }

    state.currentStep = step;

    // Step-specific initialization
    if (step === 1) {
        initCamera();
    } else if (step === 2) {
        loadContacts();
        // 重置下一步按鈕（需重新選擇聯絡人才會顯示）
        const nextBtn = document.getElementById('nextToAnalyzeBtn');
        if (nextBtn) nextBtn.style.display = state.selectedContact ? 'block' : 'none';
    }

    window.scrollTo(0, 0);
}

// ==================== Contacts Management ====================
async function loadContacts() {
    try {
        const [contactsRes, groupsRes] = await Promise.all([
            fetch(`${API_BASE}/contacts`),
            fetch(`${API_BASE}/groups`),
        ]);
        state.contacts = contactsRes.ok ? await contactsRes.json() : [];
        state.groups = groupsRes.ok ? await groupsRes.json() : [];
        renderContacts();
    } catch (error) {
        console.error('Error loading contacts:', error);
        state.contacts = [];
        state.groups = [];
        renderContacts();
    }
}

function renderContacts() {
    if (state.contacts.length === 0 && state.groups.length === 0) {
        elements.contactsGrid.innerHTML = '';
        elements.noContactsMsg.style.display = 'block';
        return;
    }

    elements.noContactsMsg.style.display = 'none';
    let html = '';

    // 群組區塊
    if (state.groups.length > 0) {
        html += '<div style="grid-column:1/-1;margin-bottom:8px;">' +
            '<div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;">收件人群組</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            state.groups.map(g => `
                <button class="group-select-btn" data-group-id="${g.id}"
                        style="padding:8px 14px;border:2px solid var(--border-color);border-radius:20px;
                        background:white;cursor:pointer;font-size:13px;transition:var(--transition);">
                    👥 ${g.name} (${g.member_count || 0})
                </button>
            `).join('') +
            '</div></div>' +
            '<div style="grid-column:1/-1;border-bottom:1px solid var(--border-color);margin-bottom:8px;"></div>';
    }

    // 聯絡人卡片（支援多選）
    html += state.contacts.map((contact, index) => {
        const isSelected = state.selectedContacts.some(c => c.id === contact.id);
        return `
        <div class="contact-card ${isSelected ? 'selected' : ''}" data-id="${contact.id || index}">
            <div style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" class="contact-checkbox" data-contact-idx="${index}"
                       ${isSelected ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
                <div style="flex:1;">
                    <div class="contact-name">${contact.name}</div>
                    <div class="contact-email">${contact.email}</div>
                    <div class="contact-dept">${contact.department || ''}</div>
                </div>
            </div>
        </div>`;
    }).join('');

    elements.contactsGrid.innerHTML = html;

    // 聯絡人點擊/勾選
    document.querySelectorAll('.contact-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            const idx = parseInt(cb.dataset.contactIdx);
            toggleContactSelection(idx);
        });
    });
    document.querySelectorAll('.contact-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return;
            const idx = Array.from(elements.contactsGrid.querySelectorAll('.contact-card')).indexOf(card);
            if (idx >= 0 && idx < state.contacts.length) toggleContactSelection(idx);
        });
    });

    // 群組按鈕
    document.querySelectorAll('.group-select-btn').forEach(btn => {
        btn.addEventListener('click', () => selectGroup(parseInt(btn.dataset.groupId)));
    });

    updateNextButton();
}

function toggleContactSelection(index) {
    const contact = state.contacts[index];
    if (!contact) return;
    const existIdx = state.selectedContacts.findIndex(c => c.id === contact.id);
    if (existIdx >= 0) {
        state.selectedContacts.splice(existIdx, 1);
    } else {
        state.selectedContacts.push(contact);
    }
    // 向後相容：單選時也設定 selectedContact
    state.selectedContact = state.selectedContacts.length > 0 ? state.selectedContacts[0] : null;
    renderContacts();
}

async function selectGroup(groupId) {
    try {
        const res = await fetch(`${API_BASE}/groups/${groupId}`);
        if (!res.ok) return;
        const group = await res.json();
        // 將群組成員全部加入選擇
        state.selectedContacts = [];
        for (const member of (group.members || [])) {
            if (!state.selectedContacts.some(c => c.id === member.id)) {
                state.selectedContacts.push(member);
            }
        }
        state.selectedContact = state.selectedContacts[0] || null;
        renderContacts();
    } catch (e) {
        console.error('Select group error:', e);
    }
}

function updateNextButton() {
    const btn = document.getElementById('nextToAnalyzeBtn');
    if (!btn) return;
    const count = state.selectedContacts.length;
    if (count === 0) {
        btn.style.display = 'none';
    } else if (count === 1) {
        btn.style.display = 'block';
        btn.textContent = `🤖 開始 AI 辨識 →`;
    } else {
        btn.style.display = 'block';
        btn.textContent = `🤖 AI 辨識 → 批次寄送 ${count} 人`;
    }
}

async function addNewContact() {
    const name = elements.contactName.value.trim();
    const email = elements.contactEmail.value.trim();
    const dept = elements.contactDept.value.trim();
    const title = elements.contactTitle.value.trim();

    if (!name || !email) {
        alert('請填入姓名和 Email');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                email,
                department: dept,
                title
            })
        });

        if (!response.ok) throw new Error('Failed to add contact');

        // Clear form and reload
        elements.contactName.value = '';
        elements.contactEmail.value = '';
        elements.contactDept.value = '';
        elements.contactTitle.value = '';
        elements.addContactForm.style.display = 'none';
        loadContacts();
    } catch (error) {
        console.error('Error adding contact:', error);
        alert('新增聯絡人失敗');
    }
}

// ==================== Document Analysis ====================
async function analyzeDocument() {
    if (!state.selectedContact) {
        goToStep(2);
        return;
    }

    elements.loadingState.style.display = 'block';
    elements.previewContent.style.display = 'none';

    try {
        const response = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: state.selectedContact.id || 0
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `伺服器錯誤 (${response.status})`);
        }
        const data = await response.json();
        state.analyzeResult = data.result || data;

        renderPreview();
        elements.loadingState.style.display = 'none';
        elements.previewContent.style.display = 'block';
    } catch (error) {
        console.error('Analysis error:', error);
        elements.loadingState.style.display = 'none';
        alert('AI 辨識失敗：' + error.message + '\n\n請確認 .env 中已設定 ANTHROPIC_API_KEY');
        goToStep(2);
    }
}

function renderPreview() {
    const result = state.analyzeResult;
    const docType = result.doc_type || 'other';
    const typeInfo = DOC_TYPES[docType] || DOC_TYPES.other;
    const confidence = Math.round((result.confidence || 0) * 100);

    // Update header
    elements.docTypeIcon.textContent = typeInfo.icon;
    elements.docTypeText.textContent = typeInfo.label;
    elements.docTypeBadge.style.backgroundColor = typeInfo.color;

    // Update content
    elements.emailSubject.textContent = result.subject || '(未辨識主旨)';
    elements.emailBody.textContent = result.body || '(未辨識內容)';
    elements.confidenceBadge.textContent = `信心度: ${confidence}%`;
    // 顯示收件人（支援多人）
    if (state.selectedContacts.length > 1) {
        elements.recipientDisplay.textContent = state.selectedContacts.map(c => c.name).join('、') + ` (共 ${state.selectedContacts.length} 人)`;
    } else if (state.selectedContact) {
        elements.recipientDisplay.textContent = `${state.selectedContact.name} <${state.selectedContact.email}>`;
    }
    elements.filenameDisplay.textContent = result.filename || state.uploadedFile || 'document.pdf';

    // Show warning if confidence < 30%
    if (confidence < 30) {
        elements.confidenceWarning.style.display = 'flex';
    } else {
        elements.confidenceWarning.style.display = 'none';
    }

    // Reset contenteditable
    elements.emailSubject.contentEditable = 'false';
    elements.emailBody.contentEditable = 'false';
    elements.filenameDisplay.contentEditable = 'false';
    state.editingField = null;
}

function enableEditing() {
    elements.emailSubject.contentEditable = 'true';
    elements.emailBody.contentEditable = 'true';
    elements.filenameDisplay.contentEditable = 'true';

    elements.emailSubject.focus();
    elements.editBtn.style.display = 'none';

    // Add click handlers for editing
    elements.emailSubject.addEventListener('click', () => {
        elements.emailSubject.contentEditable = 'true';
        elements.emailSubject.focus();
    });
    elements.emailBody.addEventListener('click', () => {
        elements.emailBody.contentEditable = 'true';
        elements.emailBody.focus();
    });
    elements.filenameDisplay.addEventListener('click', () => {
        elements.filenameDisplay.contentEditable = 'true';
        elements.filenameDisplay.focus();
    });
}

// ==================== Upload & Send ====================
async function uploadDocument() {
    if (!state.uploadedFileData) {
        alert('請先拍照或上傳檔案');
        return;
    }

    const formData = new FormData();
    formData.append('file', state.uploadedFileData, state.uploadedFile);

    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Upload failed');
        state.imageUploaded = true;
        return await response.json();
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}

async function sendEmail() {
    try {
        const subject = elements.emailSubject.textContent.trim();
        const body = elements.emailBody.textContent.trim();
        const filename = elements.filenameDisplay.textContent.trim();

        let result;

        if (state.selectedContacts.length > 1) {
            // ── 批次寄送 ──
            const response = await fetch(`${API_BASE}/send/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contact_ids: state.selectedContacts.map(c => c.id),
                    subject, body, filename,
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || '批次寄送失敗');
            }
            result = await response.json();
            if (!result.success) throw new Error('全部寄送失敗');

            elements.resultSubject.textContent = subject;
            elements.resultRecipient.textContent = `${result.success_count}/${result.total} 人寄送成功`;
            elements.resultFilename.textContent = filename;

        } else {
            // ── 單人寄送 ──
            const response = await fetch(`${API_BASE}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contact_id: state.selectedContact.id,
                    subject, body, filename,
                })
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || '寄送失敗');
            }
            result = await response.json();
            if (!result.success) throw new Error(result.message || '寄送失敗，請檢查 SMTP 設定');

            elements.resultSubject.textContent = result.subject || subject;
            elements.resultRecipient.textContent = result.recipient_email || state.selectedContact.email;
            elements.resultFilename.textContent = result.filename || filename;
        }

        elements.successResult.style.display = 'block';
        elements.errorResult.style.display = 'none';
        goToStep(4);
    } catch (error) {
        console.error('Send error:', error);
        elements.errorMessage.textContent = error.message || '寄送失敗，請重試';
        elements.successResult.style.display = 'none';
        elements.errorResult.style.display = 'block';
        goToStep(4);
    }
}

// ==================== Side Panel ====================
function openPanel() {
    elements.sidePanel.classList.add('open');
    elements.overlay.classList.add('open');
}

function closePanel() {
    elements.sidePanel.classList.remove('open');
    elements.overlay.classList.remove('open');
}

async function loadHistory() {
    try {
        const response = await fetch(`${API_BASE}/history`);
        if (!response.ok) throw new Error('Failed to load history');
        state.history = await response.json();
        renderHistory();
    } catch (error) {
        console.error('Error loading history:', error);
        state.history = [];
        renderHistory();
    }
}

function renderHistory() {
    if (state.history.length === 0) {
        elements.panelHistoryList.innerHTML = '';
        elements.panelNoHistory.style.display = 'block';
        return;
    }

    elements.panelNoHistory.style.display = 'none';
    elements.panelHistoryList.innerHTML = state.history.map(item => {
        const typeInfo = DOC_TYPES[item.doc_type] || DOC_TYPES.other;
        const date = new Date(item.date).toLocaleDateString('zh-TW');
        return `
            <div class="history-item">
                <div class="history-header">
                    <div class="history-subject">${item.subject}</div>
                    <span class="doc-type-badge" style="background-color: ${typeInfo.color}; margin: 0;">
                        ${typeInfo.icon} ${typeInfo.label}
                    </span>
                </div>
                <div class="history-recipient">${item.recipient}</div>
                <div class="history-date">${date}</div>
            </div>
        `;
    }).join('');
}

async function loadSettings() {
    try {
        const response = await fetch(`${API_BASE}/settings`);
        if (!response.ok) throw new Error('Failed to load settings');
        state.settings = await response.json();

        elements.senderName.value = state.settings.name || '';
        elements.senderEmail.value = state.settings.email || '';
        elements.senderTitle.value = state.settings.title || '';
        elements.senderDept.value = state.settings.department || '';
        elements.senderOrg.value = state.settings.organization || '';
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function saveSettings(e) {
    e.preventDefault();

    const settings = {
        name: elements.senderName.value.trim(),
        email: elements.senderEmail.value.trim(),
        title: elements.senderTitle.value.trim(),
        department: elements.senderDept.value.trim(),
        organization: elements.senderOrg.value.trim()
    };

    try {
        const response = await fetch(`${API_BASE}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) throw new Error('Failed to save settings');
        alert('設定已儲存');
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('儲存失敗');
    }
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Camera and Upload
    elements.captureBtn.addEventListener('click', capturePhoto);
    elements.uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                state.uploadedFileData = file;
                state.uploadedFile = file.name;
                showThumbnail(event.target.result);
            };
            reader.readAsDataURL(file);
        }
    });
    elements.retakeBtn.addEventListener('click', hideThumbnail);
    elements.nextStep1Btn.addEventListener('click', () => goToStep(2));

    // Crop editor buttons
    elements.cropAutoDetectBtn.addEventListener('click', async () => {
        elements.cropHint.textContent = '正在重新偵測...';
        try {
            const res = await fetch(`${API_BASE}/scan/detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const r = await res.json();
            if (r.detected && r.corners) {
                state.cropCorners = r.corners;
                state.cropImageWidth = r.image_width;
                state.cropImageHeight = r.image_height;
                elements.cropHint.textContent = '✅ 已偵測到文件邊界';
            } else {
                elements.cropHint.textContent = 'ℹ️ 未偵測到邊界，請手動調整角點';
            }
            drawCropCanvas();
            updateLivePreview();
        } catch (err) {
            elements.cropHint.textContent = '偵測失敗';
        }
    });

    elements.cropResetBtn.addEventListener('click', () => {
        setDefaultCorners();
        elements.cropHint.textContent = '已重設為預設範圍';
        drawCropCanvas();
        updateLivePreview();
    });

    elements.cropApplyBtn.addEventListener('click', () => applyCropAndProcess());

    elements.cropEditAgainBtn.addEventListener('click', () => showCropEditor());

    // Rotation buttons
    elements.rotateCCWBtn.addEventListener('click', () => rotateImage(-90));
    elements.rotateCWBtn.addEventListener('click', () => rotateImage(90));

    // Multi-page buttons
    elements.addPageBtn.addEventListener('click', addCurrentPage);
    elements.addMorePageBtn.addEventListener('click', startNewPageScan);

    // Scan panel: filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            switchFilter(btn.dataset.filter);
        });
    });

    // Scan panel: next button — if multipage, auto-add current page first
    elements.scanNextBtn.addEventListener('click', async () => {
        // 如果尚未加入任何頁面，自動將目前圖片作為單頁
        // 如果已在多頁模式但目前頁面未加入，提示加入
        if (state.multiPageMode && state.scanProcessedUrl) {
            const addCurrent = confirm('是否將目前掃描結果加入為新頁面？\n\n點「確定」加入，點「取消」跳過');
            if (addCurrent) {
                await addCurrentPage();
            }
        }
        goToStep(2);
    });

    // Contacts
    elements.addContactBtn.addEventListener('click', () => {
        elements.addContactForm.style.display = 'block';
        elements.contactName.focus();
    });
    elements.cancelContactBtn.addEventListener('click', () => {
        elements.addContactForm.style.display = 'none';
    });
    elements.saveContactBtn.addEventListener('click', addNewContact);

    // Step 2 → Step 3: 選好收件人後 → AI 分析（圖片已在掃描階段上傳+處理）
    document.getElementById('nextToAnalyzeBtn').addEventListener('click', async () => {
        if (!state.selectedContact) {
            alert('請先選擇一位收件人');
            return;
        }
        goToStep(3);
        try {
            // 圖片已在 Step 1 掃描階段上傳到伺服器
            // 如果沒有經過掃描面板（理論上不應發生），補上傳
            if (!state.imageUploaded) {
                await uploadDocument();
            }
            // 觸發 AI 分析
            await analyzeDocument();
        } catch (error) {
            console.error('Analyze error:', error);
            elements.loadingState.style.display = 'none';
            alert('處理失敗：' + (error.message || '請重試'));
            goToStep(2);
        }
    });

    // Preview
    elements.editBtn.addEventListener('click', enableEditing);
    elements.cancelBtn.addEventListener('click', () => goToStep(2));
    elements.sendBtn.addEventListener('click', sendEmail);

    // Results
    elements.restartBtn.addEventListener('click', async () => {
        state.uploadedFile = null;
        state.uploadedFileData = null;
        state.imageUploaded = false;
        state.scanProcessedUrl = null;
        state.selectedContact = null;
        state.selectedContacts = [];
        state.analyzeResult = null;
        state.pages = [];
        state.multiPageMode = false;
        // 清除伺服器端的頁面
        try { await fetch(`${API_BASE}/pages/clear`, { method: 'POST' }); } catch(e) {}
        hideThumbnail();
        goToStep(1);
    });
    elements.retryBtn.addEventListener('click', () => goToStep(3));
    elements.backBtn.addEventListener('click', () => goToStep(3));

    // Side Panel
    elements.hamburgerBtn.addEventListener('click', openPanel);
    elements.panelCloseBtn.addEventListener('click', closePanel);
    elements.overlay.addEventListener('click', closePanel);

    elements.panelTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            // Update active tab
            elements.panelTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            elements.tabContents.forEach(content => {
                content.classList.remove('active');
            });
            document.querySelector(`.tab-content[data-content="${tabName}"]`)?.classList.add('active');

            // Load data
            if (tabName === 'contacts') loadPanelGroups();
            if (tabName === 'history') loadHistory();
            if (tabName === 'settings') loadSettings();
        });
    });

    elements.settingsForm.addEventListener('submit', saveSettings);

    // ==================== v4: 跨工具快速動作 ====================
    setupQuickActions();
}

async function getScanResultAsFile(suggestedName) {
    if (!state.scanProcessedUrl || !window.ToolBridge) return null;
    const baseName = (state.uploadedFile || `scan_${Date.now()}`).replace(/\.[^.]+$/, '');
    const filename = suggestedName || `${baseName}_scanned.jpg`;
    return await window.ToolBridge.dataUrlToFile(state.scanProcessedUrl, filename, 'image/jpeg');
}

function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function setupQuickActions() {
    // 掃描完成後的快速動作（Step 1 結尾）
    document.querySelectorAll('[data-scan-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.scanAction;

            if (action === 'send-email') {
                elements.scanNextBtn.click();
                return;
            }

            if (action === 'download') {
                const file = await getScanResultAsFile();
                if (!file) {
                    window.Toast?.show('沒有可下載的掃描結果', { type: 'error' });
                    return;
                }
                downloadFile(file);
                window.Toast?.show('已下載掃描檔案', { type: 'success' });
                return;
            }

            const file = await getScanResultAsFile();
            if (!file) {
                window.Toast?.show('請先完成掃描處理', { type: 'error' });
                return;
            }

            const map = {
                'image-tools': { tool: 'image-tools' },
                'watermark':   { tool: 'image-tools', opts: { action: 'watermark' } },
                'gif':         { tool: 'gif-tools' },
                'rename':      { tool: 'batch-rename' },
            };
            const cfg = map[action];
            if (!cfg || !window.ToolBridge) return;
            window.ToolBridge.sendFilesToTool(cfg.tool, [file], { ...(cfg.opts || {}), sourceLabel: '掃描結果' });
        });
    });

    // 寄送成功後的快速動作（Step 4）
    document.querySelectorAll('[data-success-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.successAction;

            if (action === 'pdf') {
                window.AppNav?.switchTool('pdf-tools');
                window.Toast?.show('已切換到 PDF 工具', { type: 'info' });
                return;
            }

            const file = await getScanResultAsFile();
            if (!file) {
                // 已被 restartBtn 清除 — 直接導航
                window.AppNav?.switchTool(action === 'watermark' ? 'image-tools' : action);
                return;
            }
            const map = {
                'image-tools': { tool: 'image-tools' },
                'watermark':   { tool: 'image-tools', opts: { action: 'watermark' } },
            };
            const cfg = map[action];
            if (!cfg || !window.ToolBridge) return;
            window.ToolBridge.sendFilesToTool(cfg.tool, [file], { ...(cfg.opts || {}), sourceLabel: '已寄送的掃描檔' });
        });
    });
}

// ==================== Initialize ====================
// ==================== 群組管理（側邊欄）====================
async function loadPanelGroups() {
    try {
        const res = await fetch(`${API_BASE}/groups`);
        const groups = res.ok ? await res.json() : [];
        const list = document.getElementById('panelGroupsList');
        if (!list) return;
        if (groups.length === 0) {
            list.innerHTML = '<div style="font-size:13px;color:var(--text-secondary);">尚無群組</div>';
            return;
        }
        list.innerHTML = groups.map(g => `
            <div class="contact-item">
                <div class="contact-info">
                    <div class="contact-name-small">👥 ${g.name}</div>
                    <div class="contact-email-small">${g.member_count || 0} 位成員</div>
                </div>
                <button class="btn-icon" style="background:#d32f2f;color:white;font-size:12px;width:24px;height:24px;"
                        onclick="deleteGroup(${g.id})">✕</button>
            </div>
        `).join('');
    } catch(e) {}
}

async function deleteGroup(groupId) {
    if (!confirm('確定刪除此群組？')) return;
    await fetch(`${API_BASE}/groups/${groupId}`, {method:'DELETE'});
    loadPanelGroups();
    loadContacts(); // 重新整理主頁群組列表
}

function setupGroupUI() {
    const addBtn = document.getElementById('addGroupBtn');
    const form = document.getElementById('addGroupForm');
    const cancelBtn = document.getElementById('cancelGroupBtn');
    const saveBtn = document.getElementById('saveGroupBtn');
    if (!addBtn) return;

    addBtn.addEventListener('click', () => {
        form.style.display = 'block';
        // 載入聯絡人勾選列表
        const sel = document.getElementById('groupMemberSelect');
        sel.innerHTML = state.contacts.map((c, i) => `
            <label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;cursor:pointer;">
                <input type="checkbox" class="group-member-cb" data-cid="${c.id}" style="width:16px;height:16px;">
                ${c.name} (${c.email})
            </label>
        `).join('');
    });

    cancelBtn.addEventListener('click', () => { form.style.display = 'none'; });

    saveBtn.addEventListener('click', async () => {
        const name = document.getElementById('groupName').value.trim();
        if (!name) { alert('請輸入群組名稱'); return; }
        const cids = [];
        document.querySelectorAll('.group-member-cb:checked').forEach(cb => {
            cids.push(parseInt(cb.dataset.cid));
        });
        if (cids.length === 0) { alert('請至少選擇一位成員'); return; }
        try {
            await fetch(`${API_BASE}/groups`, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({name, contact_ids:cids})
            });
            form.style.display = 'none';
            document.getElementById('groupName').value = '';
            loadPanelGroups();
            loadContacts();
        } catch(e) { alert('建立群組失敗'); }
    });
}

// 把 deleteGroup 暴露到全域（onclick 需要）
window.deleteGroup = deleteGroup;

function init() {
    setupEventListeners();
    setupGroupUI();
    loadContacts();
    goToStep(1);
}

// Start app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
