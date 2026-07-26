/* Shared UI atoms — used across mobile + desktop */
const { useState, useEffect, useRef, useCallback } = React;

// ─── Paper Doc Placeholder ─────────────────────────────────────
function PaperDoc({ w = '75%', tint = 'paper', lines = 8, rotate = 0, children }){
  const bg = tint === 'mint' ? 'var(--mint-wash)' :
             tint === 'dark' ? 'var(--paper-3)' : 'var(--paper)';
  const col = 'var(--line-soft)';
  return (
    <div style={{
      width:w, aspectRatio:'0.72', background:bg,
      boxShadow:'var(--shadow-paper)',
      padding:'16px 14px', position:'relative',
      transform:`rotate(${rotate}deg)`,
      border:'1px solid var(--line-soft)',
    }}>
      {Array.from({length:lines}).map((_,i) => (
        <div key={i} style={{
          height:'6px', width: [95,80,65,90,85,60,92,75][i%8]+'%',
          background:col, opacity:0.5, borderRadius:'2px',
          marginBottom:'9px',
        }}/>
      ))}
      {children}
    </div>
  );
}

// ─── Cropping corners overlay ──────────────────────────────────
function CropCorners({ color = 'var(--mint-3)' }){
  const c = { position:'absolute', width:'14px', height:'14px', background:color,
    border:'2px solid #fff', borderRadius:'50%', cursor:'grab' };
  return (
    <>
      <span style={{...c, top:-7, left:-7}}/>
      <span style={{...c, top:-7, right:-7}}/>
      <span style={{...c, bottom:-7, left:-7}}/>
      <span style={{...c, bottom:-7, right:-7}}/>
      <div style={{position:'absolute', inset:0, border:`2px dashed ${color}`, pointerEvents:'none'}}/>
    </>
  );
}

// ─── Draggable Crop Canvas with Live Preview ───────────────────
function CropEditor({ imageSrc, corners: parentCorners, imgW, imgH, onChange }) {
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const imgRef = useRef(null);
  
  const [imgLoaded, setImgLoaded] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState(-1);
  const [naturalWidth, setNaturalWidth] = useState(imgW || 0);
  const [naturalHeight, setNaturalHeight] = useState(imgH || 0);

  const scratchCanvasRef = useRef(null);

  const getSnappedPosition = (cx, cy) => {
    if (!imgLoaded || !imgRef.current || !canvasRef.current) return [cx, cy];
    
    if (!scratchCanvasRef.current) {
      scratchCanvasRef.current = document.createElement('canvas');
    }
    
    const R = 8; // Search radius (17x17 window)
    const sigma = 4.0;
    const threshold = 15.0; // Gradient threshold to snap
    
    const patchSize = 2 * R + 3; // 19x19 patch (to have 17x17 Sobel output)
    const canvas = scratchCanvasRef.current;
    if (canvas.width !== patchSize) {
      canvas.width = patchSize;
      canvas.height = patchSize;
    }
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pad = R + 1; // 9
    
    // Clamp center coordinates so that the R+1 neighborhood is fully within image bounds
    const startX = Math.max(pad, Math.min(naturalWidth - pad, cx));
    const startY = Math.max(pad, Math.min(naturalHeight - pad, cy));
    
    const sx = startX - pad;
    const sy = startY - pad;
    
    try {
      ctx.drawImage(imgRef.current, sx, sy, patchSize, patchSize, 0, 0, patchSize, patchSize);
      const imgData = ctx.getImageData(0, 0, patchSize, patchSize);
      const pixels = imgData.data;
      
      // 1. Precompute grayscale values
      const grays = new Float32Array(patchSize * patchSize);
      for (let i = 0; i < patchSize * patchSize; i++) {
        grays[i] = 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2];
      }
      
      // 2. Find best edge within circular radius
      let maxScore = -1;
      let bestX = pad;
      let bestY = pad;
      let bestMag = 0;
      
      for (let y = 1; y < patchSize - 1; y++) {
        for (let x = 1; x < patchSize - 1; x++) {
          const dx = x - pad;
          const dy = y - pad;
          const distSq = dx * dx + dy * dy;
          if (distSq > R * R) continue;
          
          // Sobel kernels
          const gx = 
            -1 * grays[(y - 1) * patchSize + (x - 1)] + 1 * grays[(y - 1) * patchSize + (x + 1)] +
            -2 * grays[y * patchSize + (x - 1)]       + 2 * grays[y * patchSize + (x + 1)] +
            -1 * grays[(y + 1) * patchSize + (x - 1)] + 1 * grays[(y + 1) * patchSize + (x + 1)];
            
          const gy = 
            -1 * grays[(y - 1) * patchSize + (x - 1)] - 2 * grays[(y - 1) * patchSize + x] - 1 * grays[(y - 1) * patchSize + (x + 1)] +
            1 * grays[(y + 1) * patchSize + (x - 1)] + 2 * grays[(y + 1) * patchSize + x] + 1 * grays[(y + 1) * patchSize + (x + 1)];
            
          const mag = Math.sqrt(gx * gx + gy * gy);
          const weight = Math.exp(-distSq / (2 * sigma * sigma));
          const score = mag * weight;
          
          if (score > maxScore) {
            maxScore = score;
            bestX = x;
            bestY = y;
            bestMag = mag;
          }
        }
      }
      
      if (bestMag >= threshold) {
        const snapX = sx + bestX;
        const snapY = sy + bestY;
        return [snapX, snapY];
      }
    } catch (err) {
      console.warn("Snapping calculation failed: ", err);
    }
    
    return [cx, cy];
  };


  // Load image on src change
  useEffect(() => {
    if (!imageSrc) return;
    setImgLoaded(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setImgLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Compute effective corners
  const getEffectiveCorners = () => {
    if (parentCorners && parentCorners.length === 4) {
      return parentCorners;
    }
    const w = naturalWidth || 800;
    const h = naturalHeight || 600;
    const m = 0.05;
    return [
      [Math.round(w * m), Math.round(h * m)],
      [Math.round(w * (1 - m)), Math.round(h * m)],
      [Math.round(w * (1 - m)), Math.round(h * (1 - m))],
      [Math.round(w * m), Math.round(h * (1 - m))]
    ];
  };

  const corners = getEffectiveCorners();

  const getScale = () => {
    const canvas = canvasRef.current;
    if (!canvas || !naturalWidth || !naturalHeight) return { x: 1, y: 1, dispW: 0, dispH: 0 };
    const dispW = parseInt(canvas.style.width) || canvas.width;
    const dispH = parseInt(canvas.style.height) || canvas.height;
    return {
      x: dispW / naturalWidth,
      y: dispH / naturalHeight,
      dispW,
      dispH
    };
  };

  const drawCropCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imgLoaded || !imgRef.current) return;
    const ctx = canvas.getContext('2d');

    const wrapper = canvas.parentElement;
    const maxW = wrapper.clientWidth - 2;
    const maxH = window.innerHeight * 0.45;
    const imgW = naturalWidth;
    const imgH = naturalHeight;

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

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dispW * dpr;
    canvas.height = dispH * dpr;
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.drawImage(imgRef.current, 0, 0, dispW, dispH);

    const scaleX = dispW / imgW;
    const scaleY = dispH / imgH;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, dispW, dispH);
    ctx.moveTo(corners[0][0] * scaleX, corners[0][1] * scaleY);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(corners[i][0] * scaleX, corners[i][1] * scaleY);
    }
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'var(--mint-3, #4ea07c)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0][0] * scaleX, corners[0][1] * scaleY);
    for (let i = 1; i < 4; i++) {
      ctx.lineTo(corners[i][0] * scaleX, corners[i][1] * scaleY);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 4; i++) {
      const cx = corners[i][0] * scaleX;
      const cy = corners[i][1] * scaleY;
      const isActive = (draggingIdx === i);

      ctx.beginPath();
      ctx.arc(cx, cy, isActive ? 15 : 12, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? 'rgba(78, 160, 124, 0.95)' : 'rgba(78, 160, 124, 0.75)';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
    }
  };

  const drawLivePreview = () => {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas || !imgLoaded || !imgRef.current) return;
    const ctx = previewCanvas.getContext('2d');

    const [tl, tr, br, bl] = corners;
    const wTop = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
    const wBot = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
    const hLeft = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
    const hRight = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
    let outW = Math.round(Math.max(wTop, wBot));
    let outH = Math.round(Math.max(hLeft, hRight));

    const maxDim = 180;
    if (outW > maxDim || outH > maxDim) {
      const ratio = maxDim / Math.max(outW, outH);
      outW = Math.round(outW * ratio);
      outH = Math.round(outH * ratio);
    }
    outW = Math.max(outW, 40);
    outH = Math.max(outH, 40);

    previewCanvas.width = outW;
    previewCanvas.height = outH;

    const gridN = 10;
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const u0 = gx / gridN, u1 = (gx + 1) / gridN;
        const v0 = gy / gridN, v1 = (gy + 1) / gridN;

        const s00 = _bilerp(corners, u0, v0);
        const s10 = _bilerp(corners, u1, v0);
        const s01 = _bilerp(corners, u0, v1);
        const s11 = _bilerp(corners, u1, v1);

        const d00 = [u0 * outW, v0 * outH];
        const d10 = [u1 * outW, v0 * outH];
        const d01 = [u0 * outW, v1 * outH];
        const d11 = [u1 * outW, v1 * outH];

        _drawTriangle(ctx, imgRef.current, s00, s10, s01, d00, d10, d01);
        _drawTriangle(ctx, imgRef.current, s10, s11, s01, d10, d11, d01);
      }
    }
  };

  useEffect(() => {
    if (imgLoaded) {
      drawCropCanvas();
      drawLivePreview();
    }
  }, [imgLoaded, corners, draggingIdx, naturalWidth, naturalHeight]);

  const getPointerPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handlePointerDown = (e) => {
    const pos = getPointerPos(e);
    const scale = getScale();
    let minDist = Infinity;
    let minIdx = -1;
    const threshold = 35;

    for (let i = 0; i < 4; i++) {
      const cx = corners[i][0] * scale.x;
      const cy = corners[i][1] * scale.y;
      const dist = Math.hypot(pos.x - cx, pos.y - cy);
      if (dist < threshold && dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }

    if (minIdx >= 0) {
      setDraggingIdx(minIdx);
      e.preventDefault();
    }
  };

  const handlePointerMove = (e) => {
    if (draggingIdx < 0) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    const scale = getScale();
    
    let newX = Math.round(pos.x / scale.x);
    let newY = Math.round(pos.y / scale.y);
    newX = Math.max(0, Math.min(naturalWidth, newX));
    newY = Math.max(0, Math.min(naturalHeight, newY));

    // 套用前端磁性吸附邊緣演算法
    const [snapX, snapY] = getSnappedPosition(newX, newY);

    const nextCorners = [...corners];
    nextCorners[draggingIdx] = [snapX, snapY];
    onChange(nextCorners);
  };

  const handlePointerUp = () => {
    setDraggingIdx(-1);
  };

  const _bilerp = (corners, u, v) => {
    const [tl, tr, br, bl] = corners;
    const x = (1 - v) * ((1 - u) * tl[0] + u * tr[0]) + v * ((1 - u) * bl[0] + u * br[0]);
    const y = (1 - v) * ((1 - u) * tl[1] + u * tr[1]) + v * ((1 - u) * bl[1] + u * br[1]);
    return [x, y];
  };

  const _drawTriangle = (ctx, img, s0, s1, s2, d0, d1, d2) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0[0], d0[1]);
    ctx.lineTo(d1[0], d1[1]);
    ctx.lineTo(d2[0], d2[1]);
    ctx.closePath();
    ctx.clip();

    const sx0 = s0[0], sy0 = s0[1];
    const sx1 = s1[0], sy1 = s1[1];
    const sx2 = s2[0], sy2 = s2[1];
    const dx0 = d0[0], dy0 = d0[1];
    const dx1 = d1[0], dy1 = d1[1];
    const dx2 = d2[0], dy2 = d2[1];

    const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(det) < 0.001) { ctx.restore(); return; }
    const idet = 1 / det;

    const a = ((sy1 - sy2) * dx0 + (sy2 - sy0) * dx1 + (sy0 - sy1) * dx2) * idet;
    const b = ((sx2 - sx1) * dx0 + (sx0 - sx2) * dx1 + (sx1 - sx0) * dx2) * idet;
    const c = ((sx1 * sy2 - sx2 * sy1) * dx0 + (sx2 * sy0 - sx0 * sy2) * dx1 + (sx0 * sy1 - sx1 * sy0) * dx2) * idet;
    const d = ((sy1 - sy2) * dy0 + (sy2 - sy0) * dy1 + (sy0 - sy1) * dy2) * idet;
    const e = ((sx2 - sx1) * dy0 + (sx0 - sx2) * dy1 + (sx1 - sx0) * dy2) * idet;
    const fVal = ((sx1 * sy2 - sx2 * sy1) * dy0 + (sx2 * sy0 - sx0 * sy2) * dy1 + (sx0 * sy1 - sx1 * sy0) * dy2) * idet;

    ctx.setTransform(a, d, b, e, c, fVal);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden'
    }}>
      {!imgLoaded && <LoadingSpinner text="載入圖片中..." />}
      
      <div style={{ position: 'relative', display: imgLoaded ? 'block' : 'none' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={(e) => handlePointerDown(e)}
          onTouchMove={(e) => handlePointerMove(e)}
          onTouchEnd={handlePointerUp}
          onTouchCancel={handlePointerUp}
          style={{ display: 'block', borderRadius: '4px', boxShadow: '0 2px 12px rgba(0,0,0,0.15)', cursor: draggingIdx >= 0 ? 'grabbing' : 'crosshair' }}
        />
        
        {/* Floating Live Preview PiP */}
        <div style={{
          position: 'absolute',
          bottom: '12px',
          right: '12px',
          width: '110px',
          background: 'var(--paper)',
          border: '1.25px solid var(--line-soft)',
          borderRadius: '8px',
          padding: '6px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          pointerEvents: draggingIdx >= 0 ? 'none' : 'auto',
          opacity: draggingIdx >= 0 ? 0.35 : 0.95,
          transition: 'opacity 0.25s',
          zIndex: 10,
        }}>
          <div style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--ink-3)', letterSpacing: '0.04em' }}>即時裁切預覽</div>
          <div style={{
            width: '100%',
            aspectRatio: '0.72',
            background: 'var(--paper-2)',
            borderRadius: '4px',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(0,0,0,0.08)'
          }}>
            <canvas ref={previewCanvasRef} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page thumbnail (real or mock) ──────────────────────────────
function PageThumb({ page, active, onClick, onRemove, idx }){
  const hasThumb = page.thumb && page.thumb !== 'mock';
  const isDark = document.documentElement.dataset.theme === 'dark';
  const map = isDark ? {
    auto:{bg:'var(--paper-2)', tint:'var(--mint-3)'},
    scan:{bg:'var(--paper-3)', tint:'var(--ink-2)'},
    color_doc:{bg:'var(--paper-2)', tint:'var(--danger)'},
    document:{bg:'var(--paper)', tint:'var(--ink-3)'},
    enhance:{bg:'var(--paper-2)', tint:'var(--info)'},
    bw:{bg:'var(--paper-3)', tint:'var(--ink)'},
    original:{bg:'var(--paper)', tint:'var(--ink-2)'},
  } : {
    auto:{bg:'#fff', tint:'#4ea07c'},
    scan:{bg:'#f8f8f4', tint:'#2a2a2a'},
    color_doc:{bg:'#fff', tint:'#b25a4a'},
    document:{bg:'#f2f0ea', tint:'#3d4b42'},
    enhance:{bg:'#fff', tint:'#6b8aa3'},
    bw:{bg:'#f0f0f0', tint:'#1f2a24'},
    original:{bg:'#fdfbf2', tint:'#6b766e'},
  };
  const m = map[page.filter] || map.auto;
  return (
    <div onClick={onClick} style={{
      position:'relative', cursor:'pointer',
      border: active ? '2px solid var(--mint-3)' : '1.25px solid var(--line-soft)',
      borderRadius:'6px', padding:'4px',
      background: active ? 'var(--mint-wash)' : 'var(--paper)',
    }}>
      {hasThumb ? (
        <img src={page.thumb} style={{
          width:'100%', aspectRatio:'0.72', objectFit:'cover', borderRadius:'4px',
          transform:`rotate(${page.rotation||0}deg)`, transition:'transform 0.2s',
        }}/>
      ) : (
        <div style={{aspectRatio:'0.72', background:m.bg, padding:'6px', border:'1px solid var(--line-soft)', transform:`rotate(${page.rotation}deg)`, transition:'transform 0.2s'}}>
          {[90,70,60,85,75,50].map((w,i) => (
            <div key={i} style={{height:'3px', width:w+'%', background:m.tint, opacity:0.5, marginBottom:'4px', borderRadius:'1px'}}/>
          ))}
        </div>
      )}
      <div style={{fontSize:'10px', textAlign:'center', marginTop:'4px', fontFamily:'var(--font-label)', color: active ? 'var(--mint-4)' : 'var(--ink-3)'}}>頁 {idx + 1}</div>
      {onRemove && (
        <button onClick={(e) => {e.stopPropagation(); onRemove();}} style={{
          position:'absolute', top:'-6px', right:'-6px',
          width:'18px', height:'18px', borderRadius:'50%',
          background:'var(--danger)', color:'#fff', fontSize:'10px',
          border:'2px solid var(--paper)', lineHeight:1,
        }}>×</button>
      )}
    </div>
  );
}

// ─── Filter Scroller ──────────────────────────────────────────
function FilterStrip({ selected, onChange, inverted }){
  const filters = window.filterList;
  return (
    <div style={{display:'flex', gap:'8px', overflowX:'auto', padding:'4px 0', scrollbarWidth:'thin'}}>
      {filters.map(f => {
        const on = selected === f.id;
        return (
          <button key={f.id} onClick={() => onChange(f.id)} style={{
            flex:'0 0 auto', padding:'6px 12px', borderRadius:'8px',
            border: inverted ? '1px solid rgba(255,255,255,0.3)' : '1.25px solid var(--line)',
            background: on ? (inverted ? '#fff' : 'var(--mint-3)') : (inverted ? 'rgba(0,0,0,0.4)' : 'var(--paper)'),
            color: on ? (inverted ? '#000' : '#fff') : (inverted ? '#fff' : 'var(--ink)'),
            fontSize:'12px', display:'flex', alignItems:'center', gap:'4px',
          }}>
            <span>{f.icon}</span><span>{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Doc Type Badge ────────────────────────────────────────────
function DocTypeBadge({ type, confidence }){
  const t = window.docTypes[type] || window.docTypes.other;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'6px',
      padding:'4px 10px', borderRadius:'999px',
      background:`${t.color}20`, border:`1px solid ${t.color}`, color:t.color,
      fontSize:'11px', fontFamily:'var(--font-label)', letterSpacing:'0.04em',
    }}>
      <span>{t.icon}</span><span>{t.label}</span>
      {confidence != null && <span style={{opacity:0.7, fontSize:'10px'}}>{Math.round(confidence*100)}%</span>}
    </span>
  );
}

// ─── Contact Tile ──────────────────────────────────────────────
function ContactTile({ contact, selected, onClick, onFav, onDelete, compact }){
  const initials = contact.name.slice(-2);
  return (
    <div onClick={onClick} style={{
      position:'relative', cursor:'pointer',
      padding: compact ? '8px 10px' : '12px',
      borderRadius:'10px',
      background: selected ? 'var(--mint-wash)' : 'var(--paper)',
      border: selected ? '1.5px solid var(--mint-3)' : '1.25px solid var(--line-soft)',
      transition:'all 0.15s',
      display:'flex', alignItems:'center', gap:'10px',
    }}>
      <div style={{
        width: compact ? '32px':'38px', height: compact?'32px':'38px',
        borderRadius:'50%',
        background: selected ? 'var(--mint-3)' : 'var(--mint-wash)',
        color: selected ? '#fff' : 'var(--mint-4)',
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--font-hand)', fontWeight:700, fontSize: compact?'14px':'16px',
        flexShrink:0,
        border: selected ? '1.5px solid var(--mint-3)' : '1.25px solid var(--mint-3)',
      }}>{initials}</div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize: compact?'13px':'14px', fontWeight:500, color:'var(--ink)'}}>{contact.name}</div>
        <div style={{fontSize:'11px', color:'var(--ink-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
          {contact.dept ? `${contact.dept} · ` : ''}{contact.email || contact.title}
        </div>
      </div>
      {selected ? (
        <div style={{color:'var(--mint-3)', fontSize:'18px'}}>✓</div>
      ) : onDelete ? (
        <button onClick={(e) => {e.stopPropagation(); onDelete();}} style={{fontSize:'14px', color:'var(--danger)', opacity:0.6}}>🗑</button>
      ) : onFav ? (
        <button onClick={(e) => {e.stopPropagation(); onFav();}} style={{fontSize:'14px', opacity:contact.fav ? 1 : 0.3}}>
          {contact.fav ? '★' : '☆'}
        </button>
      ) : null}
    </div>
  );
}

// ─── Camera View (real camera) ─────────────────────────────────
function CameraView({ onCapture }){
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let stream = null;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          setStarted(true);
        }
      } catch (e) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            setStarted(true);
          }
        } catch (e2) {
          setErr('無法啟用相機：' + e2.message);
        }
      }
    }
    start();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (blob && onCapture) onCapture(blob, canvas.toDataURL('image/jpeg'));
    }, 'image/jpeg', 0.92);
  }, [onCapture]);

  return (
    <div style={{position:'relative', width:'100%', height:'100%', background:'#111', overflow:'hidden', borderRadius:'8px'}}>
      <video ref={videoRef} style={{width:'100%', height:'100%', objectFit:'cover'}} playsInline muted/>
      <canvas ref={canvasRef} style={{display:'none'}}/>
      {err && <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', padding:'20px', textAlign:'center', fontSize:'13px'}}>{err}</div>}
      {/* Grid overlay */}
      <div style={{position:'absolute', inset:0, pointerEvents:'none',
        backgroundImage:'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
        backgroundSize:'33.33% 33.33%', opacity:0.5,
      }}/>
      {/* Capture button at bottom */}
      {started && (
        <button onClick={capture} style={{
          position:'absolute', bottom:'20px', left:'50%', transform:'translateX(-50%)',
          width:'64px', height:'64px', borderRadius:'50%',
          border:'4px solid #fff', background:'var(--mint-3)', cursor:'pointer',
          boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
        }}/>
      )}
    </div>
  );
}

// ─── File Upload Dropzone ─────────────────────────────────────
function UploadDropzone({ accept, multiple, onFiles, label, icon, children }){
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback((fileList) => {
    if (!fileList || !fileList.length) return;
    onFiles(Array.from(fileList));
  }, [onFiles]);

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: dragging ? '2px solid var(--mint-3)' : '2px dashed var(--line-soft)',
        borderRadius:'12px', padding:'28px 20px', textAlign:'center', cursor:'pointer',
        background: dragging ? 'var(--mint-wash)' : 'var(--paper-2)',
        transition:'all 0.2s',
      }}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple}
        style={{display:'none'}} onChange={e => handleFiles(e.target.files)}/>
      <div style={{fontSize:'28px', marginBottom:'8px'}}>{icon || '📁'}</div>
      <div style={{fontSize:'13px', color:'var(--ink-2)', fontWeight:500}}>{label || '點擊或拖放檔案'}</div>
      {children}
    </div>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────
function LoadingSpinner({ text, size = 32 }){
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:'10px', padding:'20px'}}>
      <div style={{
        width:size, height:size, border:'3px solid var(--line-soft)',
        borderTopColor:'var(--mint-3)', borderRadius:'50%',
        animation:'spin 0.8s linear infinite',
      }}/>
      {text && <div style={{fontSize:'13px', color:'var(--ink-3)'}}>{text}</div>}
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────────────
function ProgressBar({ percent, message }){
  return (
    <div style={{padding:'8px 0'}}>
      <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
        <div style={{flex:1, height:'6px', background:'var(--line-soft)', borderRadius:'3px', overflow:'hidden'}}>
          <div style={{width:`${percent}%`, height:'100%', background:'var(--mint-3)', borderRadius:'3px', transition:'width 0.3s'}}/>
        </div>
        <span style={{fontSize:'12px', color:'var(--ink-3)', whiteSpace:'nowrap'}}>{percent}%</span>
      </div>
      {message && <div style={{fontSize:'12px', color:'var(--ink-3)', marginTop:'4px'}}>{message}</div>}
    </div>
  );
}

// ─── File List ─────────────────────────────────────────────────
function FileList({ files, onRemove }){
  if (!files || !files.length) return null;
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  return (
    <div style={{marginTop:'10px'}}>
      <div style={{fontSize:'12px', color:'var(--ink-3)', marginBottom:'6px'}}>
        {files.length} 個檔案，共 {window.API?.formatBytes(totalSize) || totalSize + ' B'}
      </div>
      {files.map((f, i) => (
        <div key={i} style={{display:'flex', alignItems:'center', gap:'8px', padding:'6px 8px', background:'var(--paper)', borderRadius:'6px', marginBottom:'4px', border:'1px solid var(--line-soft)'}}>
          <span style={{fontSize:'14px'}}>📄</span>
          <span style={{flex:1, fontSize:'12px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{f.name}</span>
          <span style={{fontSize:'11px', color:'var(--ink-3)'}}>{window.API?.formatBytes(f.size)}</span>
          {onRemove && <button onClick={() => onRemove(i)} style={{color:'var(--danger)', fontSize:'14px'}}>×</button>}
        </div>
      ))}
    </div>
  );
}

// ─── Download Result ──────────────────────────────────────────
function DownloadResult({ blob, filename }){
  if (!blob) return null;
  // 用 triggerDownload 而不是 <a download>：Android WebView 不支援 blob: 下載，
  // 點下去不會有任何反應。triggerDownload 在瀏覽器仍是同樣的 <a download> 行為。
  return (
    <div style={{display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'var(--mint-wash)', borderRadius:'10px', border:'1px solid var(--mint-3)'}}>
      <span style={{fontSize:'24px'}}>✅</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:600, fontSize:'14px'}}>處理完成</div>
        <div style={{fontSize:'12px', color:'var(--ink-3)'}}>{filename} ({window.API?.formatBytes(blob.size)})</div>
      </div>
      <button className="btn primary" style={{flexShrink:0}}
              onClick={() => window.API.triggerDownload(blob, filename).catch(() => {})}>⬇ 下載</button>
    </div>
  );
}

// ─── Tool Processor (handles file upload → single/batch process → download) ──
function ToolProcessor({ files, single, batch, getFormParams, taskProgressUrl, taskDownloadUrl, resultFilename }){
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [resultBlob, setResultBlob] = useState(null);
  const [error, setError] = useState(null);

  const process = useCallback(async () => {
    if (!files || !files.length) return;
    setProcessing(true); setError(null); setResultBlob(null);
    setProgress(10); setMessage('處理中...');

    try {
      if (files.length === 1 && single) {
        setProgress(50);
        const res = await single(files[0]);
        if (res && res.task_id) {
          const taskId = res.task_id;
          setProgress(5); setMessage('排程中...');
          const progressUrl = taskProgressUrl(taskId);
          await window.API.watchTask(progressUrl, (data) => {
            setProgress(data.progress || 0);
            setMessage(data.message || '');
          });
          const downloadUrl = taskDownloadUrl(taskId);
          const blob = await window.API.downloadBlob(downloadUrl);
          setResultBlob(blob);
          setProgress(100); setMessage('完成！');
        } else {
          const blob = await res.blob();
          setResultBlob(blob);
          setProgress(100); setMessage('完成！');
        }
      } else if (batch) {
        setProgress(5); setMessage('上傳中...');
        const res = await batch(files);
        const taskId = res.task_id;
        // Watch progress via SSE
        const progressUrl = taskProgressUrl(taskId);
        await window.API.watchTask(progressUrl, (data) => {
          setProgress(data.progress || 0);
          setMessage(data.message || '');
        });
        // Download result
        const downloadUrl = taskDownloadUrl(taskId);
        const blob = await window.API.downloadBlob(downloadUrl);
        setResultBlob(blob);
        setProgress(100); setMessage('完成！');
      }
    } catch (e) {
      setError(e.message);
    }
    setProcessing(false);
  }, [files, single, batch, taskProgressUrl, taskDownloadUrl]);

  return (
    <div>
      {processing && <ProgressBar percent={progress} message={message}/>}
      {error && <div style={{padding:'10px', background:'#fef2f2', borderRadius:'8px', color:'var(--danger)', fontSize:'13px', marginBottom:'10px'}}>❌ {error}</div>}
      {resultBlob && <DownloadResult blob={resultBlob} filename={resultFilename || 'result'}/>}
      {!processing && !resultBlob && (
        <button className="btn primary" onClick={process} disabled={!files?.length} style={{width:'100%', justifyContent:'center', marginTop:'10px'}}>
          ▶ 開始處理 ({files?.length || 0} 個檔案)
        </button>
      )}
      {resultBlob && (
        <button className="btn" onClick={() => setResultBlob(null)} style={{width:'100%', justifyContent:'center', marginTop:'8px'}}>
          重新處理
        </button>
      )}
    </div>
  );
}

// ─── Toasts ────────────────────────────────────────────────────
function Toasts({ toasts }){
  return (
    <div className="toast-host">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
      ))}
    </div>
  );
}

// ─── Authentication Screen ───────────────────────────────────
function AuthScreen() {
  const [state, store] = window.useStore();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      store.toast('請輸入帳號和密碼', 'err');
      return;
    }
    if (isRegister && password !== confirmPassword) {
      store.toast('密碼與確認密碼不符', 'err');
      return;
    }

    setLoading(true);
    if (isRegister) {
      const ok = await store.register(username, password);
      if (ok) {
        setIsRegister(false);
        setPassword('');
        setConfirmPassword('');
      }
    } else {
      await store.login(username, password);
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at center, rgba(31, 42, 36, 0.85) 0%, rgba(18, 28, 23, 0.98) 100%)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: 'var(--paper)',
        border: '1px solid var(--line-soft)',
        borderRadius: '16px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.3), var(--shadow-paper)',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Top Accent bar */}
        <div style={{
          height: '4px',
          background: 'linear-gradient(90deg, var(--mint) 0%, var(--mint-3) 100%)',
        }} />

        <div style={{ padding: '32px 24px' }}>
          {/* Logo / Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <span style={{ fontSize: '48px', display: 'inline-block', marginBottom: '8px' }}>📷</span>
            <h2 style={{
              margin: '0 0 6px 0',
              fontFamily: 'var(--font-body)',
              color: 'var(--ink)',
              fontSize: '24px',
              fontWeight: 700,
              letterSpacing: '1px',
            }}>
              ScanMail<span style={{ color: 'var(--mint-3)' }}>+</span>
            </h2>
            <p style={{
              margin: 0,
              color: 'var(--ink-3)',
              fontSize: '13px',
            }}>
              {isRegister ? '註冊 ScanMail+ 新帳號' : '登入您的 ScanMail+ 帳號'}
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--ink-2)',
                marginBottom: '6px',
              }}>
                使用者名稱 (Username)
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="請輸入使用者名稱"
                disabled={loading}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--paper-2)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--ink-2)',
                marginBottom: '6px',
              }}>
                密碼 (Password)
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="請輸入密碼"
                disabled={loading}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--paper-2)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
            </div>

            {isRegister && (
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--ink-2)',
                  marginBottom: '6px',
                }}>
                  確認密碼 (Confirm Password)
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次輸入密碼"
                  disabled={loading}
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--line-soft)',
                    background: 'var(--paper-2)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn primary"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                marginTop: '10px',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              {loading ? '處理中...' : (isRegister ? '註冊帳號' : '登入')}
            </button>
          </form>

          {/* Toggle Register/Login link */}
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={() => {
                setIsRegister(prev => !prev);
                setPassword('');
                setConfirmPassword('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--mint-3)',
                cursor: 'pointer',
                fontSize: '13px',
                textDecoration: 'underline',
              }}
            >
              {isRegister ? '已經有帳號？點此登入' : '沒有帳號？點此註冊新帳號'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Server Setting（僅 Android App 內建前端才有意義）─────────────
// 網頁版前端與後端同源，沒有「要連到哪一台」的問題，因此不顯示。
function ServerSetting(){
  const cfg = window.SM_CONFIG;
  if (!cfg || !cfg.bundled) return null;
  return (
    <div style={{marginBottom:'12px'}}>
      <div className="label" style={{marginBottom:'6px'}}>伺服器連線</div>
      <div className="card" style={{padding:'12px'}}>
        <div style={{fontSize:'12px', color:'var(--ink-3)', lineHeight:1.6, marginBottom:'8px'}}>
          掃描、AI 辨識與寄信都在後端執行，App 需要知道後端位址。
        </div>
        <div style={{fontSize:'13px', fontWeight:600, wordBreak:'break-all', marginBottom:'10px'}}>
          {cfg.apiBase || '尚未設定'}
        </div>
        <button className="btn" style={{width:'100%'}}
                onClick={() => window.SMNative && window.SMNative.openServerSetup()}>
          🔗 變更伺服器位址
        </button>
      </div>
    </div>
  );
}

// ─── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  PaperDoc, CropCorners, CropEditor, PageThumb, FilterStrip, DocTypeBadge,
  ContactTile, CameraView, Toasts, AuthScreen,
  UploadDropzone, LoadingSpinner, ProgressBar, FileList, DownloadResult, ToolProcessor,
  ServerSetting,
});
