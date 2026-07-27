/* 離線精簡版的介面 —— 手機上的媒體處理工具，完全不連後端。
 *
 * 版面原則：畫布優先。
 *   所有選項都收在最下方的工具列，工具列依情境自動切換 ——
 *   沒選圖時是「版面 / 圖框 / 間距 / 加圖 / 製作」，
 *   點了某一張圖就換成「旋轉 / 翻轉 / 裁切 / 大小 / 刪除 / 完成」。
 *   需要細調的項目才從下方推出面板，關掉後畫布立刻復原成滿版。
 *
 *   這樣一次只露出當下用得到的東西，圖片能佔掉絕大部分螢幕。
 */
const { useState: stUseState, useRef: stUseRef, useEffect: stUseEffect, useCallback: stUseCallback } = React;

const STUDIO_FORMATS = ['JPG', 'PNG', 'WebP'];

// 版面預設。cols 有值就是格狀；fill:'cover' 代表每格大小一致、圖片裁切填滿，
// 這才是一般人講「2×3 拼貼」時期待的樣子。
const STUDIO_LAYOUTS = [
  { id: 'vertical',   label: '直式',   direction: 'vertical' },
  { id: 'horizontal', label: '橫式',   direction: 'horizontal' },
  { id: 'auto',       label: '自動',   direction: 'grid', columns: 0 },
  { id: '2x2', label: '2×2', direction: 'grid', columns: 2, rows: 2, fill: 'cover' },
  { id: '2x3', label: '2×3', direction: 'grid', columns: 2, rows: 3, fill: 'cover' },
  { id: '3x2', label: '3×2', direction: 'grid', columns: 3, rows: 2, fill: 'cover' },
  { id: '3x3', label: '3×3', direction: 'grid', columns: 3, rows: 3, fill: 'cover' },
  { id: '4x4', label: '4×4', direction: 'grid', columns: 4, rows: 4, fill: 'cover' },
];

const STUDIO_FRAMES = [
  { id: 'none',     label: '無',     style: 'none',     width: 0,  radius: 0 },
  { id: 'rounded',  label: '圓角',   style: 'none',     width: 0,  radius: 6 },
  { id: 'line',     label: '細邊',   style: 'line',     width: 2,  radius: 0 },
  { id: 'card',     label: '白框',   style: 'card',     width: 4,  radius: 0 },
  { id: 'shadow',   label: '陰影',   style: 'shadow',   width: 4,  radius: 2 },
  { id: 'polaroid', label: '拍立得', style: 'polaroid', width: 5,  radius: 0 },
];

// 0 = 自由拖拉，其餘會把裁切框鎖在該比例
const STUDIO_CROPS = [
  { id: 0,      label: '自由' },
  { id: 1,      label: '1:1' },
  { id: 4 / 3,  label: '4:3' },
  { id: 3 / 4,  label: '3:4' },
  { id: 16 / 9, label: '16:9' },
  { id: 9 / 16, label: '9:16' },
];

// 圖片轉 PDF 的紙張。'fit' 代表頁面直接貼合照片比例，不留白邊
const STUDIO_PDF_PAGES = [
  { id: 'fit',    label: '貼合圖片' },
  { id: 'A4',     label: 'A4' },
  { id: 'A5',     label: 'A5' },
  { id: 'LETTER', label: 'Letter' },
];

const STUDIO_SWATCHES = ['#ffffff', '#000000', '#f6f4ec', '#2d6b52', '#b25a4a', '#41729f'];

function studioBytes(n) {
  return window.API ? window.API.formatBytes(n) : `${n} B`;
}

// ─── 共用小元件 ────────────────────────────────────────────────

/** 底部工具列的按鈕 */
function BarBtn({ ic, label, onClick, on, accent, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        flex: '1 0 auto', minWidth: '46px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
        padding: '6px 2px', borderRadius: '10px', border: 'none',
        background: on ? 'var(--mint-wash)' : 'transparent',
        color: accent ? 'var(--mint-4)' : on ? 'var(--mint-4)' : 'var(--ink-2)',
        fontWeight: accent ? 700 : 500,
        opacity: disabled ? 0.4 : 1,
      }}>
      <span style={{ fontSize: '17px', lineHeight: 1 }}>{ic}</span>
      <span style={{ fontSize: '10px', letterSpacing: '0.02em' }}>{label}</span>
    </button>
  );
}

/** 從下方推出的設定面板 */
function StudioSheet({ title, onClose, children }) {
  return (
    <div style={{
      borderTop: '1.25px solid var(--line-soft)', background: 'var(--paper)',
      padding: '12px 16px 10px', maxHeight: '44vh', overflowY: 'auto', flexShrink: 0,
    }}>
      <div className="row between" style={{ alignItems: 'center', marginBottom: '10px' }}>
        <div className="label">{title}</div>
        <button className="pill" onClick={onClose} style={{ fontSize: '12px', padding: '5px 12px' }}>完成</button>
      </div>
      {children}
    </div>
  );
}

/** 版面預設的縮圖示意 */
function LayoutIcon({ preset }) {
  const cells = preset.direction === 'vertical' ? { c: 1, r: 3 }
    : preset.direction === 'horizontal' ? { c: 3, r: 1 }
    : preset.columns ? { c: preset.columns, r: preset.rows || preset.columns }
    : { c: 2, r: 2 };
  return (
    <div style={{
      display: 'grid', gap: '2px', width: '30px', height: '30px',
      gridTemplateColumns: `repeat(${cells.c}, 1fr)`,
      gridTemplateRows: `repeat(${cells.r}, 1fr)`,
    }}>
      {Array.from({ length: cells.c * cells.r }).map((_, i) => (
        <div key={i} style={{ background: 'currentColor', opacity: 0.55, borderRadius: '1px' }}/>
      ))}
    </div>
  );
}

function ColorRow({ value, onChange }) {
  return (
    <div className="row" style={{ gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      {STUDIO_SWATCHES.map((c) => (
        <button key={c} onClick={() => onChange(c)}
          style={{
            width: '28px', height: '28px', borderRadius: '50%', background: c,
            border: value === c ? '2.5px solid var(--mint-3)' : '1px solid var(--line-soft)',
          }}/>
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          width: '34px', height: '28px', padding: '2px', background: 'var(--paper)',
          border: '1px solid var(--line-soft)', borderRadius: '6px',
        }}/>
    </div>
  );
}

/**
 * 自由裁切。
 *
 * 畫的是「已經轉正但還沒裁」的樣子 —— 使用者拉的框就是他看到的東西，
 * 所以 cropRect 存的也是轉正後的相對座標（renderItem 先轉再裁）。
 *
 * 裁切框用 HTML 疊在畫布上，不畫進 canvas：把手要好按（44px 熱區），
 * 用 DOM 讓瀏覽器處理縮放比較準，也不必每次拖曳都重畫整張圖。
 */
function StudioCropper({ item, onApply, onCancel }) {
  const canvasRef = stUseRef(null);
  const dragRef = stUseRef(null);
  const [rect, setRect] = stUseState(() => item.cropRect || { x: 0, y: 0, w: 1, h: 1 });
  const [ratio, setRatio] = stUseState(0);
  const [aspect, setAspect] = stUseState(1);

  stUseEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const shown = window.SMImageLocal.renderItem({ ...item, cropRect: null }, { usePreview: true });
    canvas.width = shown.width;
    canvas.height = shown.height;
    canvas.getContext('2d').drawImage(shown, 0, 0);
    setAspect(shown.width / shown.height);
  }, [item]);

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const MIN = 0.06;

  /**
   * 鎖比例時，相對座標的長寬比 ≠ 畫面上的長寬比（相對座標把圖壓成正方形），
   * 所以要拿圖片本身的比例換算回去。
   */
  const fitRatio = (r, anchorRight, anchorBottom) => {
    if (!ratio) return r;
    const out = { ...r };
    out.h = Math.min(1, (out.w * aspect) / ratio);
    if (out.h < MIN) { out.h = MIN; out.w = Math.min(1, (out.h * ratio) / aspect); }
    if (anchorBottom) out.y = r.y + r.h - out.h;
    if (anchorRight) out.x = r.x + r.w - out.w;
    out.x = clamp(Math.min(out.x, 1 - out.w));
    out.y = clamp(Math.min(out.y, 1 - out.h));
    return out;
  };

  const posOf = (e) => {
    const box = canvasRef.current.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / box.width),
      y: clamp((e.clientY - box.top) / box.height),
      tx: 26 / box.width,
      ty: 26 / box.height,
    };
  };

  const onDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = posOf(e);
    const near = (a, b, t) => Math.abs(a - b) <= t;
    const left = near(p.x, rect.x, p.tx);
    const right = near(p.x, rect.x + rect.w, p.tx);
    const top = near(p.y, rect.y, p.ty);
    const bottom = near(p.y, rect.y + rect.h, p.ty);

    let mode = null;
    if ((left || right) && (top || bottom)) mode = `${top ? 'n' : 's'}${left ? 'w' : 'e'}`;
    else if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) mode = 'move';
    else mode = 'new';

    dragRef.current = { mode, start: p, origin: rect };
    if (mode === 'new') setRect({ x: p.x, y: p.y, w: MIN, h: MIN });
  };

  const onMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const p = posOf(e);
    const o = drag.origin;

    if (drag.mode === 'move') {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      setRect({
        ...o,
        x: clamp(Math.min(o.x + dx, 1 - o.w)),
        y: clamp(Math.min(o.y + dy, 1 - o.h)),
      });
      return;
    }

    if (drag.mode === 'new') {
      const x = Math.min(drag.start.x, p.x);
      const y = Math.min(drag.start.y, p.y);
      setRect(fitRatio({
        x, y,
        w: Math.max(MIN, Math.abs(p.x - drag.start.x)),
        h: Math.max(MIN, Math.abs(p.y - drag.start.y)),
      }));
      return;
    }

    const west = drag.mode.includes('w');
    const north = drag.mode.includes('n');
    const right = o.x + o.w;
    const bottom = o.y + o.h;
    let next;
    if (west) next = { x: Math.min(p.x, right - MIN), w: right - Math.min(p.x, right - MIN) };
    else next = { x: o.x, w: Math.max(MIN, p.x - o.x) };
    if (north) next = { ...next, y: Math.min(p.y, bottom - MIN), h: bottom - Math.min(p.y, bottom - MIN) };
    else next = { ...next, y: o.y, h: Math.max(MIN, p.y - o.y) };
    setRect(fitRatio(next, west, north));
  };

  const onUp = () => { dragRef.current = null; };

  const pickRatio = (r) => {
    setRatio(r);
    if (!r) return;
    setRect(window.SMImageLocal.centeredRect(aspect, 1, r) || { x: 0, y: 0, w: 1, h: 1 });
  };

  const handle = (cx, cy) => ({
    position: 'absolute', left: `${cx * 100}%`, top: `${cy * 100}%`,
    width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px',
    border: '2.5px solid #fff', borderRadius: '3px',
    background: 'rgba(0,0,0,0.25)', boxSizing: 'border-box', pointerEvents: 'none',
  });

  const full = rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '14px', background: 'var(--paper-2)', overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', touchAction: 'none' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <canvas ref={canvasRef}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', userSelect: 'none' }}/>
          <div style={{
            position: 'absolute',
            left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
            border: '1.5px solid #fff', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
            pointerEvents: 'none', boxSizing: 'border-box',
          }}>
            {[33.333, 66.667].map((v) => (
              <React.Fragment key={v}>
                <div style={{ position: 'absolute', left: `${v}%`, top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.4)' }}/>
                <div style={{ position: 'absolute', top: `${v}%`, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.4)' }}/>
              </React.Fragment>
            ))}
          </div>
          {[[rect.x, rect.y], [rect.x + rect.w, rect.y],
            [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].map((c, i) => (
            <div key={i} style={handle(c[0], c[1])}/>
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--line-soft)', padding: '8px 12px 4px', flexShrink: 0 }}>
        <div className="row" style={{ gap: '6px', overflowX: 'auto' }}>
          {STUDIO_CROPS.map((c) => (
            <button key={c.label} className={`chip ${ratio === c.id ? 'on' : ''}`}
              style={{ flexShrink: 0 }} onClick={() => pickRatio(c.id)}>{c.label}</button>
          ))}
        </div>
      </div>

      <div className="row" style={{
        borderTop: '1.25px solid var(--line-soft)', background: 'var(--paper)',
        padding: '4px 4px 10px', alignItems: 'stretch', flexShrink: 0,
      }}>
        <div className="row" style={{ flex: 1, minWidth: 0, gap: '2px' }}>
          <BarBtn ic="✕" label="取消" onClick={onCancel}/>
          <BarBtn ic="⟲" label="重設" disabled={full && !ratio}
            onClick={() => { setRatio(0); setRect({ x: 0, y: 0, w: 1, h: 1 }); }}/>
        </div>
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          borderLeft: '1px solid var(--line-soft)', paddingLeft: '4px', marginLeft: '2px',
        }}>
          <BarBtn ic="✓" label="套用" accent onClick={() => onApply(full ? null : rect)}/>
        </div>
      </div>
    </div>
  );
}

// ─── 編輯 / 拼接 ───────────────────────────────────────────────
function StudioEditor() {
  const [items, setItems] = stUseState([]);
  const [sel, setSel] = stUseState(-1);        // -1 = 沒選圖，工具列停在拼貼模式
  const [sheet, setSheet] = stUseState(null);  // layout | frame | gap | size | crop | export
  const [busy, setBusy] = stUseState('');
  const [cropping, setCropping] = stUseState(false);
  const [layout, setLayout] = stUseState({
    preset: 'vertical', direction: 'vertical', columns: 0, fill: 'contain',
    gap: 0, bgColor: '#ffffff', normalize: true,
  });
  const [frame, setFrame] = stUseState({ id: 'none', style: 'none', color: '#ffffff', width: 0, radius: 0 });
  const [out, setOut] = stUseState({ format: 'JPG', quality: 92, pageSize: 'fit' });

  const canvasRef = stUseRef(null);
  const addRef = stUseRef(null);
  const boxesRef = stUseRef([]);

  const multi = items.length > 1;
  const current = sel >= 0 ? items[sel] : null;
  const composeOpts = { ...layout, frame };

  // 任何狀態變動就重畫預覽。用縮圖算，所以按一下就看得到，不會卡。
  stUseEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !items.length) return;
    try {
      const info = window.SMImageLocal.previewInto(canvas, items, composeOpts, 1400);
      boxesRef.current = info.boxes;

      // 標出正在編輯的那一張
      if (sel >= 0 && info.boxes[sel]) {
        const b = info.boxes[sel];
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.strokeStyle = '#2d6b52';
        ctx.lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.008));
        ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }
    } catch (e) {
      console.error('[Studio] 預覽失敗', e);
    }
    // cropping 也要列進來 —— 離開裁切模式後 canvas 是新的 DOM 元素，
    // 不重畫就會停在瀏覽器給的預設 300×150 空白畫布。
  }, [items, layout, frame, sel, cropping]);

  const addFiles = async (files) => {
    if (!files || !files.length) return;
    setBusy(`讀取 ${files.length} 張圖片...`);
    const loaded = [];
    for (const f of files) {
      try {
        const item = await window.SMImageLocal.loadItem(f);
        item.url = URL.createObjectURL(f);
        item.crop = 0;
        loaded.push(item);
      } catch (e) {
        window.SMStore?.toast(`${f.name} 讀取失敗`, 'err');
      }
    }
    setItems((prev) => [...prev, ...loaded]);
    setBusy('');
  };

  /** 只改選中那一張，其餘不動 */
  const patch = (changes) => {
    setItems((prev) => prev.map((it, i) => (i === sel ? { ...it, ...changes } : it)));
  };

  const rotate = (delta) => patch({
    rotate: (((current.rotate + delta) % 360) + 360) % 360,
    // 裁切框跟著轉，不然轉一下就會裁到別的地方
    cropRect: window.SMImageLocal.rotateRect(current.cropRect, delta),
  });
  const flip = (axis) => patch(axis === 'h'
    ? { flipH: !current.flipH, cropRect: window.SMImageLocal.flipRect(current.cropRect, 'h') }
    : { flipV: !current.flipV, cropRect: window.SMImageLocal.flipRect(current.cropRect, 'v') });

  const remove = () => {
    const i = sel;
    setItems((prev) => {
      if (prev[i]?.url) URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, j) => j !== i);
    });
    setSel(-1);
    setSheet(null);
  };

  const clear = () => {
    items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    setItems([]);
    setSel(-1);
    setSheet(null);
  };

  /** 點畫布選圖 —— 直接點你要改的那張，比在清單裡找快 */
  const pickOnCanvas = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hit = boxesRef.current.findIndex(
      (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    );
    setSel(hit >= 0 ? hit : -1);
    if (hit < 0) setSheet(null);
  };

  const applyLayout = (preset) => {
    setLayout((prev) => ({
      ...prev,
      preset: preset.id,
      direction: preset.direction,
      columns: preset.columns || 0,
      fill: preset.fill || 'contain',
    }));
  };

  const save = async () => {
    setBusy('產生檔案中...');
    try {
      // 匯出用原圖重算一次，預覽用的縮圖不會影響輸出品質
      const stem = (items[0]?.name || 'image').replace(/\.[^.]+$/, '');
      if (out.format === 'PDF') {
        const canvas = window.SMImageLocal.composeToCanvas(items, composeOpts);
        const { blob } = await window.SMImageLocal.imagesToPdf([canvas], {
          pageSize: out.pageSize, quality: out.quality,
        });
        await window.API.triggerDownload(blob, `${stem}.pdf`);
      } else {
        const res = await window.SMImageLocal.composeToBlob(items, { ...composeOpts, ...out });
        await window.API.triggerDownload(res.blob, res.filename);
      }
      setSheet(null);
    } catch (e) {
      window.SMStore?.toast('儲存失敗：' + e.message, 'err');
    }
    setBusy('');
  };

  // ── 還沒選圖 ──
  if (!items.length) {
    return (
      <div className="m-body">
        <UploadDropzone accept="image/*" multiple onFiles={addFiles} icon="🖼️" label="選擇圖片開始">
          <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '4px' }}>
            單張 = 編輯 · 多張 = 拼貼，都是即時預覽
          </div>
        </UploadDropzone>
        {busy && <div style={{ fontSize: '12px', color: 'var(--ink-3)', marginTop: '10px' }}>{busy}</div>}
      </div>
    );
  }

  const sheets = {
    layout: (
      <StudioSheet title="版面" onClose={() => setSheet(null)}>
        <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
          {STUDIO_LAYOUTS.map((p) => (
            <button key={p.id} onClick={() => applyLayout(p)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px',
                padding: '8px 10px', borderRadius: '10px',
                border: layout.preset === p.id ? '1.5px solid var(--mint-3)' : '1.25px solid var(--line-soft)',
                background: layout.preset === p.id ? 'var(--mint-wash)' : 'transparent',
                color: 'var(--ink-2)',
              }}>
              <LayoutIcon preset={p}/>
              <span style={{ fontSize: '11px' }}>{p.label}</span>
            </button>
          ))}
        </div>
      </StudioSheet>
    ),

    frame: (
      <StudioSheet title="圖框" onClose={() => setSheet(null)}>
        <div className="row" style={{ gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {STUDIO_FRAMES.map((f) => (
            <button key={f.id} className={`chip ${frame.id === f.id ? 'on' : ''}`}
              onClick={() => setFrame({ ...frame, id: f.id, style: f.style, width: f.width, radius: f.radius })}>
              {f.label}
            </button>
          ))}
        </div>
        {frame.id !== 'none' && (
          <>
            <div className="field-label">邊框顏色</div>
            <div style={{ marginBottom: '12px' }}>
              <ColorRow value={frame.color} onChange={(c) => setFrame({ ...frame, color: c })}/>
            </div>
            <div className="field-label">粗細 {frame.width}%</div>
            <input type="range" className="slider" min="0" max="12" value={frame.width}
              onChange={(e) => setFrame({ ...frame, width: +e.target.value })}
              style={{ marginBottom: '10px' }}/>
            <div className="field-label">圓角 {frame.radius}%</div>
            <input type="range" className="slider" min="0" max="30" value={frame.radius}
              onChange={(e) => setFrame({ ...frame, radius: +e.target.value })}/>
          </>
        )}
      </StudioSheet>
    ),

    gap: (
      <StudioSheet title="間距與底色" onClose={() => setSheet(null)}>
        <div className="field-label">間距 {layout.gap}px</div>
        <input type="range" className="slider" min="0" max="120" value={layout.gap}
          onChange={(e) => setLayout({ ...layout, gap: +e.target.value })}
          style={{ marginBottom: '12px' }}/>
        <div className="field-label">底色</div>
        <div style={{ marginBottom: '12px' }}>
          <ColorRow value={layout.bgColor} onChange={(c) => setLayout({ ...layout, bgColor: c })}/>
        </div>
        {layout.fill !== 'cover' && (
          <label className="row" style={{ alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input type="checkbox" checked={layout.normalize}
              onChange={(e) => setLayout({ ...layout, normalize: e.target.checked })}/>
            等比對齊（避免大小不一產生空隙）
          </label>
        )}
      </StudioSheet>
    ),

    size: current && (
      <StudioSheet title="大小" onClose={() => setSheet(null)}>
        <div className="field-label">{Math.round(current.scale * 100)}%</div>
        <input type="range" className="slider" min="20" max="200"
          value={Math.round(current.scale * 100)}
          onChange={(e) => patch({ scale: +e.target.value / 100 })}/>
      </StudioSheet>
    ),

    export: (
      <StudioSheet title="輸出" onClose={() => setSheet(null)}>
        <div className="row" style={{ gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {[...STUDIO_FORMATS, 'PDF'].map((f) => (
            <button key={f} className={`chip ${out.format === f ? 'on' : ''}`}
              onClick={() => setOut({ ...out, format: f })}>{f}</button>
          ))}
        </div>
        {out.format === 'PDF' && (
          <>
            <div className="field-label">紙張</div>
            <div className="row" style={{ gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {STUDIO_PDF_PAGES.map((s) => (
                <button key={s.id} className={`chip ${out.pageSize === s.id ? 'on' : ''}`}
                  onClick={() => setOut({ ...out, pageSize: s.id })}>{s.label}</button>
              ))}
            </div>
          </>
        )}
        {out.format !== 'PNG' && (
          <>
            <div className="field-label">品質 {out.quality}%</div>
            <input type="range" className="slider" min="40" max="100" value={out.quality}
              onChange={(e) => setOut({ ...out, quality: +e.target.value })}
              style={{ marginBottom: '12px' }}/>
          </>
        )}
        <button className="btn primary" style={{ width: '100%' }} onClick={save} disabled={!!busy}>
          {busy || '💾 儲存 / 分享'}
        </button>
      </StudioSheet>
    ),
  };

  if (cropping && current) {
    return (
      <StudioCropper item={current}
        onCancel={() => setCropping(false)}
        onApply={(rect) => { patch({ cropRect: rect }); setCropping(false); }}/>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 畫布 —— 吃掉所有剩下的空間 */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '10px', background: 'var(--paper-2)',
      }}>
        <canvas ref={canvasRef} onClick={pickOnCanvas}
          style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', cursor: 'pointer' }}/>
      </div>

      {/* 縮圖列 —— 多張時才需要 */}
      {multi && (
        <div className="row" style={{
          gap: '6px', overflowX: 'auto', padding: '6px 10px', flexShrink: 0,
          borderTop: '1px solid var(--line-soft)',
        }}>
          {items.map((it, i) => (
            <img key={i} src={it.url} alt="" onClick={() => setSel(i === sel ? -1 : i)}
              style={{
                width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0,
                border: i === sel ? '2px solid var(--mint-3)' : '2px solid transparent',
                opacity: i === sel ? 1 : 0.6,
              }}/>
          ))}
        </div>
      )}

      {sheet && sheets[sheet]}

      {/* 工具列 —— 依有沒有選圖切換。
          主要動作（完成 / 製作）釘在右邊不隨捲動，否則工具一多就會被擠出畫面。 */}
      <div className="row" style={{
        borderTop: '1.25px solid var(--line-soft)', background: 'var(--paper)',
        padding: '4px 4px 10px', flexShrink: 0, alignItems: 'stretch',
      }}>
        <div className="row" style={{ flex: 1, minWidth: 0, gap: '2px', overflowX: 'auto' }}>
          {current ? (
            <>
              <BarBtn ic="↺" label="左轉" onClick={() => rotate(-90)}/>
              <BarBtn ic="↻" label="右轉" onClick={() => rotate(90)}/>
              <BarBtn ic="⇋" label="水平" on={current.flipH} onClick={() => flip('h')}/>
              <BarBtn ic="⇅" label="垂直" on={current.flipV} onClick={() => flip('v')}/>
              <BarBtn ic="⛶" label="裁切" onClick={() => { setSheet(null); setCropping(true); }}/>
              <BarBtn ic="⤢" label="大小" on={sheet === 'size'}
                onClick={() => setSheet(sheet === 'size' ? null : 'size')}/>
              <BarBtn ic="🗑" label="刪除" onClick={remove}/>
            </>
          ) : (
            <>
              <BarBtn ic="▦" label="版面" on={sheet === 'layout'} disabled={!multi}
                onClick={() => setSheet(sheet === 'layout' ? null : 'layout')}/>
              <BarBtn ic="⬚" label="圖框" on={sheet === 'frame'}
                onClick={() => setSheet(sheet === 'frame' ? null : 'frame')}/>
              <BarBtn ic="↔" label="間距" on={sheet === 'gap'}
                onClick={() => setSheet(sheet === 'gap' ? null : 'gap')}/>
              <input ref={addRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; }}/>
              <BarBtn ic="＋" label="加圖" onClick={() => addRef.current?.click()}/>
              <BarBtn ic="✕" label="清空" onClick={clear}/>
            </>
          )}
        </div>
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          borderLeft: '1px solid var(--line-soft)', paddingLeft: '4px', marginLeft: '2px',
        }}>
          {current ? (
            <BarBtn ic="✓" label="完成" accent onClick={() => { setSel(-1); setSheet(null); }}/>
          ) : (
            <BarBtn ic="💾" label="製作" accent on={sheet === 'export'}
              onClick={() => setSheet(sheet === 'export' ? null : 'export')}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 轉換（縮放 + 壓縮 + 轉檔一次做完）──────────────────────────
function StudioConvert() {
  const [files, setFiles] = stUseState([]);
  const [opts, setOpts] = stUseState({
    limitSize: false, maxDimension: 1600,
    format: 'auto', quality: 85, pageSize: 'A4',
  });
  const [results, setResults] = stUseState(null);
  const [progress, setProgress] = stUseState(null);

  const toPdf = opts.format === 'PDF';

  const run = stUseCallback(async () => {
    if (!files.length) return;
    setResults(null);
    setProgress({ percent: 0, message: '開始處理...' });
    try {
      if (toPdf) {
        const stem = files[0].name.replace(/\.[^.]+$/, '');
        const { blob, reused } = await window.SMImageLocal.imagesToPdf(files, {
          pageSize: opts.pageSize,
          quality: opts.quality,
          maxDimension: opts.limitSize ? opts.maxDimension : 0,
        }, (percent, message) => setProgress({ percent, message }));
        setResults([{ blob, filename: `${stem}.pdf`, reused }]);
      } else {
        const out = await window.SMImageLocal.batch('transform', files, {
          maxDimension: opts.limitSize ? opts.maxDimension : 0,
          format: opts.format,
          quality: opts.quality,
        }, (percent, message) => setProgress({ percent, message }));
        setResults(out);
      }
    } catch (e) {
      window.SMStore?.toast('處理失敗：' + e.message, 'err');
    }
    setProgress(null);
  }, [files, opts, toPdf]);

  const originalSize = files.reduce((a, f) => a + f.size, 0);
  const resultSize = (results || []).reduce((a, r) => a + r.blob.size, 0);

  return (
    <div className="m-body">
      <UploadDropzone accept="image/*" multiple
        onFiles={(f) => { setFiles([...files, ...f]); setResults(null); }}
        icon="🔄" label="選擇要轉換的圖片">
        <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '4px' }}>
          縮小、壓縮、換格式一次做完，只重新編碼一次；也可以直接合併成一份 PDF
        </div>
      </UploadDropzone>
      <FileList files={files} onRemove={(i) => { setFiles(files.filter((_, j) => j !== i)); setResults(null); }}/>

      <div className="label" style={{ margin: '12px 0 6px' }}>尺寸</div>
      <div className="card" style={{ padding: '10px', marginBottom: '12px' }}>
        <label className="row" style={{ alignItems: 'center', gap: '8px', fontSize: '13px' }}>
          <input type="checkbox" checked={opts.limitSize}
            onChange={(e) => setOpts({ ...opts, limitSize: e.target.checked })}/>
          限制長邊（只縮小，不放大）
        </label>
        {opts.limitSize && (
          <>
            <div className="field-label" style={{ marginTop: '10px' }}>最長邊 {opts.maxDimension}px</div>
            <input type="range" className="slider" min="400" max="4000" step="100" value={opts.maxDimension}
              onChange={(e) => setOpts({ ...opts, maxDimension: +e.target.value })}/>
          </>
        )}
      </div>

      <div className="label" style={{ marginBottom: '6px' }}>格式與品質</div>
      <div className="card" style={{ padding: '10px', marginBottom: '12px' }}>
        <div className="row" style={{ gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <button className={`chip ${opts.format === 'auto' ? 'on' : ''}`}
            onClick={() => setOpts({ ...opts, format: 'auto' })}>維持原格式</button>
          {STUDIO_FORMATS.map((f) => (
            <button key={f} className={`chip ${opts.format === f ? 'on' : ''}`}
              onClick={() => setOpts({ ...opts, format: f })}>{f}</button>
          ))}
          <button className={`chip ${toPdf ? 'on' : ''}`}
            onClick={() => setOpts({ ...opts, format: 'PDF' })}>📕 合併成 PDF</button>
        </div>
        {toPdf && (
          <>
            <div className="field-label">紙張</div>
            <div className="row" style={{ gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
              {STUDIO_PDF_PAGES.map((s) => (
                <button key={s.id} className={`chip ${opts.pageSize === s.id ? 'on' : ''}`}
                  onClick={() => setOpts({ ...opts, pageSize: s.id })}>{s.label}</button>
              ))}
            </div>
          </>
        )}
        {opts.format !== 'PNG' && (
          <>
            <div className="field-label">品質 {opts.quality}%（越低檔案越小）</div>
            <input type="range" className="slider" min="30" max="100" value={opts.quality}
              onChange={(e) => setOpts({ ...opts, quality: +e.target.value })}/>
          </>
        )}
      </div>

      {progress && <ProgressBar percent={progress.percent} message={progress.message}/>}

      {results ? (
        <>
          <div style={{ fontSize: '12px', color: 'var(--ink-3)', margin: '0 0 8px' }}>
            {studioBytes(originalSize)} → {studioBytes(resultSize)}
            {originalSize > 0 && resultSize < originalSize &&
              `（省下 ${Math.round((1 - resultSize / originalSize) * 100)}%）`}
            {toPdf && results[0]?.reused > 0 &&
              ` · ${results[0].reused}/${files.length} 張原樣嵌入，畫質沒有損失`}
          </div>
          <DownloadResults items={results}/>
          <button className="btn" style={{ width: '100%', marginTop: '8px' }} onClick={() => setResults(null)}>
            重新處理
          </button>
        </>
      ) : (
        <button className="btn primary" style={{ width: '100%' }} onClick={run}
          disabled={!files.length || !!progress}>
          ▶ {toPdf ? `合併成 PDF（${files.length} 頁）` : `開始轉換（${files.length} 個檔案）`}
        </button>
      )}
    </div>
  );
}

// ─── 文件（PDF / Word / Markdown 互轉）────────────────────────

const DOC_TARGETS = [
  { id: 'pdf',  ic: '📕', label: 'PDF' },
  { id: 'docx', ic: '📄', label: 'Word' },
  { id: 'md',   ic: '📝', label: 'Markdown' },
  { id: 'txt',  ic: '📃', label: '純文字' },
  { id: 'html', ic: '🌐', label: '網頁' },
  // 整頁繪製成圖，只有 PDF 進得來（其他格式沒有「頁」這個概念）
  { id: 'images', ic: '🖼️', label: '圖片', only: 'pdf' },
];
const DOC_PAGES = ['A4', 'A5', 'LETTER'];
const DOC_DPI = [{ v: 100, l: '省空間' }, { v: 150, l: '一般' }, { v: 300, l: '列印' }];

/** 解析結果直接畫出來 —— 轉檔前就看得到有沒有讀歪，比事後開檔案才發現好。 */
function DocPreview({ doc }) {
  const inline = (spans, key) => (spans || []).map((s, i) => {
    const style = {
      fontWeight: s.bold ? 700 : undefined,
      fontStyle: s.italic ? 'italic' : undefined,
      color: s.link ? 'var(--mint-4)' : undefined,
      textDecoration: s.link ? 'underline' : undefined,
      background: s.code ? 'var(--line-soft)' : undefined,
      fontFamily: s.code ? 'var(--mono, monospace)' : undefined,
      padding: s.code ? '0 3px' : undefined,
      borderRadius: s.code ? '3px' : undefined,
    };
    return <span key={`${key}-${i}`} style={style}>{s.text}</span>;
  });

  const heads = ['19px', '16px', '15px', '14px', '13.5px', '13px'];
  return (
    <div style={{ fontSize: '13.5px', lineHeight: 1.8, color: 'var(--ink-1)' }}>
      {doc.blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <div key={i} style={{
              fontSize: heads[Math.min(5, b.level - 1)], fontWeight: 700,
              margin: `${b.level === 1 ? 4 : 16}px 0 6px`, lineHeight: 1.4,
            }}>{inline(b.spans, i)}</div>
          );
        }
        if (b.type === 'para') return <p key={i} style={{ margin: '0 0 10px' }}>{inline(b.spans, i)}</p>;
        if (b.type === 'quote') {
          return (
            <div key={i} style={{
              borderLeft: '3px solid var(--line-soft)', paddingLeft: '10px',
              margin: '0 0 10px', color: 'var(--ink-3)',
            }}>{inline(b.spans, i)}</div>
          );
        }
        if (b.type === 'hr') return <div key={i} className="stroke soft" style={{ margin: '14px 0' }}/>;
        if (b.type === 'code') {
          return (
            <pre key={i} style={{
              background: 'var(--line-soft)', borderRadius: '6px', padding: '8px 10px',
              margin: '0 0 10px', overflowX: 'auto', fontSize: '12px', lineHeight: 1.6,
            }}>{b.text}</pre>
          );
        }
        if (b.type === 'list') {
          return (
            <div key={i} style={{ margin: '0 0 10px' }}>
              {b.items.map((it, j) => (
                <div key={j} className="row" style={{
                  gap: '6px', alignItems: 'flex-start',
                  paddingLeft: `${(it.level || 0) * 14}px`, marginBottom: '2px',
                }}>
                  <span style={{ color: 'var(--ink-3)', flexShrink: 0 }}>{b.ordered ? `${j + 1}.` : '•'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{inline(it.spans, `${i}-${j}`)}</span>
                </div>
              ))}
            </div>
          );
        }
        if (b.type === 'table') {
          return (
            <div key={i} style={{ overflowX: 'auto', margin: '0 0 12px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <tbody>
                  {b.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td key={c} style={{
                          border: '1px solid var(--line-soft)', padding: '4px 8px',
                          fontWeight: r === 0 && b.header ? 600 : 400,
                          background: r === 0 && b.header ? 'var(--line-soft)' : undefined,
                          whiteSpace: 'nowrap',
                        }}>{inline(cell, `${i}-${r}-${c}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function StudioDocs() {
  const [source, setSource] = stUseState(null);   // { file, kind, doc }
  const [sheet, setSheet] = stUseState(null);     // null | 'target' | 'page'
  const [target, setTarget] = stUseState('pdf');
  const [page, setPage] = stUseState({ size: 'A4', landscape: false, dpi: 150 });
  const [busy, setBusy] = stUseState(null);
  const [result, setResult] = stUseState(null);
  const pickRef = stUseRef(null);

  const load = stUseCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    setResult(null);
    setSource(null);
    setBusy({ percent: 5, message: '讀取文件…' });
    try {
      const { doc, kind } = await window.SMDocLocal.parse(file,
        (percent, message) => setBusy({ percent, message }));
      setSource({ file, doc, kind });
      // 預設轉成「不是原本格式」的那個，少按一次
      setTarget(kind === 'pdf' ? 'docx' : 'pdf');
    } catch (e) {
      window.SMStore?.toast(e.message, 'err');
    }
    setBusy(null);
  }, []);

  const run = stUseCallback(async () => {
    if (!source) return;
    setBusy({ percent: 10, message: '轉換中…' });
    const base = source.file.name.replace(/\.[^.]+$/, '');
    try {
      if (target === 'images') {
        // 這條路不經過文件模型 —— 整頁照原樣繪製，掃描件與圖表才不會掉東西
        const pages = await window.SMDocLocal.pdfToImages(
          await source.file.arrayBuffer(), { dpi: page.dpi },
          (percent, message) => setBusy({ percent, message }));
        setResult({
          items: pages.map((p) => ({ blob: p.blob, filename: `${base}-${String(p.page).padStart(2, '0')}.${p.ext}` })),
        });
      } else {
        const out = await window.SMDocLocal.render(source.doc, target, {
          pageSize: page.size, landscape: page.landscape, title: source.doc.title,
        });
        setResult({ ...out, name: `${base}.${window.SMDocLocal.FORMATS[target].ext}` });
        if (out.missing && out.missing.length) {
          window.SMStore?.toast(`有 ${out.missing.length} 個字不在內建字型裡：${out.missing.slice(0, 6).join('')}`, 'warn');
        }
      }
    } catch (e) {
      window.SMStore?.toast('轉換失敗：' + e.message, 'err');
    }
    setBusy(null);
  }, [source, target, page]);

  const targetInfo = DOC_TARGETS.find((t) => t.id === target) || DOC_TARGETS[0];

  if (!source) {
    return (
      <div className="m-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <UploadDropzone accept=".md,.markdown,.txt,.docx,.pdf" onFiles={load}
          icon="📑" label="選擇文件開始">
          <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '4px' }}>
            PDF、Word、Markdown、純文字 —— 都在手機上處理，不會上傳
          </div>
        </UploadDropzone>
        {busy && <ProgressBar percent={busy.percent} message={busy.message}/>}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <input ref={pickRef} type="file" accept=".md,.markdown,.txt,.docx,.pdf" style={{ display: 'none' }}
        onChange={(e) => { load(Array.from(e.target.files)); e.target.value = ''; }}/>
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px',
        background: 'var(--doc-bg, var(--paper))',
      }}>
        <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginBottom: '10px' }}>
          {source.file.name} → {targetInfo.label}
          {source.doc.pages ? `（原始 ${source.doc.pages} 頁）` : ''}
        </div>
        <DocPreview doc={source.doc}/>
      </div>

      {busy && <div style={{ padding: '0 16px' }}><ProgressBar percent={busy.percent} message={busy.message}/></div>}

      {result && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-soft)', maxHeight: '38vh', overflowY: 'auto' }}>
          {result.items ? (
            <DownloadResults items={result.items}/>
          ) : (
            <div className="row between" style={{ alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ✅ {result.name}<span style={{ color: 'var(--ink-3)' }}> · {studioBytes(result.blob.size)}</span>
              </div>
              <button className="btn primary" style={{ flexShrink: 0 }}
                onClick={() => window.API.triggerDownload(result.blob, result.name).catch(() => {})}>
                ⬇ 儲存
              </button>
            </div>
          )}
        </div>
      )}

      {sheet === 'target' && (
        <StudioSheet title="轉成什麼格式" onClose={() => setSheet(null)}>
          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
            {DOC_TARGETS.filter((t) => !t.only || t.only === source.kind).map((t) => (
              <button key={t.id} className={`chip ${target === t.id ? 'on' : ''}`}
                onClick={() => { setTarget(t.id); setResult(null); setSheet(null); }}>
                {t.ic} {t.label}
              </button>
            ))}
          </div>
        </StudioSheet>
      )}

      {sheet === 'page' && target === 'images' && (
        <StudioSheet title="輸出解析度" onClose={() => setSheet(null)}>
          <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
            {DOC_DPI.map((d) => (
              <button key={d.v} className={`chip ${page.dpi === d.v ? 'on' : ''}`}
                onClick={() => { setPage({ ...page, dpi: d.v }); setResult(null); }}>
                {d.l}（{d.v} dpi）
              </button>
            ))}
          </div>
        </StudioSheet>
      )}

      {sheet === 'page' && target === 'pdf' && (
        <StudioSheet title="紙張設定" onClose={() => setSheet(null)}>
          <div className="field-label">紙張</div>
          <div className="row" style={{ gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {DOC_PAGES.map((s) => (
              <button key={s} className={`chip ${page.size === s ? 'on' : ''}`}
                onClick={() => { setPage({ ...page, size: s }); setResult(null); }}>{s}</button>
            ))}
          </div>
          <div className="field-label">方向</div>
          <div className="row" style={{ gap: '6px' }}>
            {[{ v: false, l: '直式' }, { v: true, l: '橫式' }].map((o) => (
              <button key={o.l} className={`chip ${page.landscape === o.v ? 'on' : ''}`}
                onClick={() => { setPage({ ...page, landscape: o.v }); setResult(null); }}>{o.l}</button>
            ))}
          </div>
        </StudioSheet>
      )}

      <div className="row" style={{
        borderTop: '1.25px solid var(--line-soft)', background: 'var(--paper)',
        padding: '4px 4px 10px', alignItems: 'stretch', flexShrink: 0,
      }}>
        <div className="row" style={{ flex: 1, minWidth: 0, gap: '2px', overflowX: 'auto' }}>
          <BarBtn ic={targetInfo.ic} label={targetInfo.label} on={sheet === 'target'}
            onClick={() => setSheet(sheet === 'target' ? null : 'target')}/>
          {(target === 'pdf' || target === 'images') && (
            <BarBtn ic="📐" label={target === 'images' ? '畫質' : '紙張'} on={sheet === 'page'}
              onClick={() => setSheet(sheet === 'page' ? null : 'page')}/>
          )}
          <BarBtn ic="📂" label="換檔" onClick={() => pickRef.current?.click()}/>
          <BarBtn ic="🗑" label="清空" onClick={() => { setSource(null); setResult(null); setSheet(null); }}/>
        </div>
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          borderLeft: '1px solid var(--line-soft)', paddingLeft: '4px', marginLeft: '2px',
        }}>
          <BarBtn ic="⚙" label="轉換" accent disabled={!!busy} onClick={run}/>
        </div>
      </div>
    </div>
  );
}

// ─── 頁面（合併 / 刪頁 / 抽頁 / 重排 / 轉向）──────────────────

/**
 * 這一頁做的都是「無損」的操作 —— 頁面連同它參照到的東西整包搬過去，
 * 內容串流原封不動，所以文字還是文字、圖還是原本那張圖。
 * 細節在 static/js/pdf-lite.js。
 */
function StudioPages() {
  const [sources, setSources] = stUseState([]);   // { name, doc }
  const [pages, setPages] = stUseState([]);       // { src, page, rotate }
  const [thumbs, setThumbs] = stUseState({});     // 'src:page' → dataURL
  const [sel, setSel] = stUseState(-1);
  const [busy, setBusy] = stUseState(null);
  const [result, setResult] = stUseState(null);
  const pickRef = stUseRef(null);

  const add = stUseCallback(async (files) => {
    const list = Array.from(files || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!list.length) return;
    setResult(null);
    setBusy({ percent: 5, message: '讀取 PDF…' });
    try {
      for (const file of list) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // 一份給頁面操作、一份給縮圖 —— pdf.js 會把傳進去的緩衝區接管掉
        const doc = await window.SMPDFLite.open(bytes.slice());
        const src = sources.length + list.indexOf(file);
        setSources((prev) => [...prev, { name: file.name, doc }]);
        setPages((prev) => [
          ...prev,
          ...doc.pages.map((_, i) => ({ src, page: i, rotate: 0 })),
        ]);
        setBusy({ percent: 40, message: `產生 ${file.name} 的縮圖…` });
        await window.SMDocLocal.pdfThumbnails(bytes.slice(), { maxWidth: 200 }, (i, url, total) => {
          setThumbs((prev) => ({ ...prev, [`${src}:${i}`]: url }));
          setBusy({ percent: 40 + Math.round((i / total) * 55), message: `縮圖 ${i + 1}/${total}` });
        });
      }
    } catch (e) {
      window.SMStore?.toast(e.message, 'err');
    }
    setBusy(null);
  }, [sources]);

  const patch = (changes) => {
    setPages((prev) => prev.map((p, i) => (i === sel ? { ...p, ...changes } : p)));
    setResult(null);
  };

  const move = (delta) => {
    const to = sel + delta;
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    [next[sel], next[to]] = [next[to], next[sel]];
    setPages(next);
    setSel(to);
    setResult(null);
  };

  const remove = () => {
    setPages((prev) => prev.filter((_, i) => i !== sel));
    setSel(-1);
    setResult(null);
  };

  const save = stUseCallback(async () => {
    if (!pages.length) return;
    setBusy({ percent: 20, message: '組合 PDF…' });
    try {
      const blob = await window.SMPDFLite.compose(
        pages.map((p) => ({ doc: sources[p.src].doc, page: p.page, rotate: p.rotate })));
      const stem = (sources[0]?.name || '文件').replace(/\.[^.]+$/, '');
      setResult({ blob, name: `${stem}-編輯後.pdf` });
    } catch (e) {
      window.SMStore?.toast('組合失敗：' + e.message, 'err');
    }
    setBusy(null);
  }, [pages, sources]);

  if (!pages.length && !busy) {
    return (
      <div className="m-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <UploadDropzone accept=".pdf,application/pdf" multiple onFiles={add}
          icon="📚" label="選擇 PDF 開始">
          <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '4px' }}>
            合併、刪頁、抽頁、重排、轉向 —— 內容原封不動，文字不會變成圖
          </div>
        </UploadDropzone>
      </div>
    );
  }

  const current = sel >= 0 ? pages[sel] : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <input ref={pickRef} type="file" accept=".pdf,application/pdf" multiple style={{ display: 'none' }}
        onChange={(e) => { add(e.target.files); e.target.value = ''; }}/>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px', background: 'var(--paper-2)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '8px' }}>
          {pages.map((p, i) => {
            const on = i === sel;
            const url = thumbs[`${p.src}:${p.page}`];
            const quarter = ((p.rotate % 360) + 360) % 360;
            return (
              <button key={i} className="pagecell" onClick={() => setSel(on ? -1 : i)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                  padding: '5px', borderRadius: '8px', background: on ? 'var(--mint-wash)' : 'transparent',
                  border: on ? '1.5px solid var(--mint-3)' : '1.25px solid var(--line-soft)',
                }}>
                <div style={{
                  width: '100%', aspectRatio: '3 / 4', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  background: 'var(--paper)',
                }}>
                  {url ? (
                    <img src={url} alt="" style={{
                      maxWidth: quarter % 180 ? '75%' : '100%',
                      maxHeight: quarter % 180 ? '75%' : '100%',
                      transform: quarter ? `rotate(${quarter}deg)` : undefined,
                    }}/>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--ink-3)' }}>…</span>
                  )}
                </div>
                <span style={{ fontSize: '10px', color: on ? 'var(--mint-4)' : 'var(--ink-3)' }}>
                  {i + 1}{sources.length > 1 ? ` · ${String.fromCharCode(65 + p.src)}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {busy && <div style={{ padding: '0 16px' }}><ProgressBar percent={busy.percent} message={busy.message}/></div>}

      <div style={{
        padding: '6px 14px', fontSize: '11px', color: 'var(--ink-3)', flexShrink: 0,
        borderTop: '1px solid var(--line-soft)',
      }}>
        共 {pages.length} 頁
        {sources.length > 1 && ` · 來自 ${sources.length} 個檔案（${sources.map((s, i) => String.fromCharCode(65 + i)).join(' ')}）`}
      </div>

      {result && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <div className="row between" style={{ alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '12px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ✅ {result.name}<span style={{ color: 'var(--ink-3)' }}> · {studioBytes(result.blob.size)}</span>
            </div>
            <button className="btn primary" style={{ flexShrink: 0 }}
              onClick={() => window.API.triggerDownload(result.blob, result.name).catch(() => {})}>
              ⬇ 儲存
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{
        borderTop: '1.25px solid var(--line-soft)', background: 'var(--paper)',
        padding: '4px 4px 10px', alignItems: 'stretch', flexShrink: 0,
      }}>
        <div className="row" style={{ flex: 1, minWidth: 0, gap: '2px', overflowX: 'auto' }}>
          {current ? (
            <>
              <BarBtn ic="↺" label="左轉" onClick={() => patch({ rotate: current.rotate - 90 })}/>
              <BarBtn ic="↻" label="右轉" onClick={() => patch({ rotate: current.rotate + 90 })}/>
              <BarBtn ic="←" label="前移" disabled={sel === 0} onClick={() => move(-1)}/>
              <BarBtn ic="→" label="後移" disabled={sel === pages.length - 1} onClick={() => move(1)}/>
              <BarBtn ic="🗑" label="刪除" onClick={remove}/>
            </>
          ) : (
            <>
              <BarBtn ic="➕" label="加檔" onClick={() => pickRef.current?.click()}/>
              <BarBtn ic="🗑" label="清空"
                onClick={() => { setSources([]); setPages([]); setThumbs({}); setSel(-1); setResult(null); }}/>
            </>
          )}
        </div>
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center',
          borderLeft: '1px solid var(--line-soft)', paddingLeft: '4px', marginLeft: '2px',
        }}>
          {current ? (
            <BarBtn ic="✓" label="完成" accent onClick={() => setSel(-1)}/>
          ) : (
            <BarBtn ic="💾" label="輸出" accent disabled={!!busy || !pages.length} onClick={save}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 外殼 ──────────────────────────────────────────────────────
// 分頁切換放在標題列，把整條底部留給工具列 —— 兩條 bar 疊在一起太吃畫面。
const STUDIO_TABS = [
  { id: 'edit', l: '🎨 編輯' },
  { id: 'convert', l: '🔄 圖片' },
  { id: 'docs', l: '📑 文件' },
  { id: 'pages', l: '📚 頁面' },
];

function Studio() {
  const [state, store] = window.useStore();
  const [tab, setTab] = stUseState('edit');

  return (
    <div className="phone">
      <div className="phone-inner">
        <div className="m-screen">
          <div className="m-header" style={{ flexShrink: 0 }}>
            <div className="row" style={{ gap: '3px', alignItems: 'center', minWidth: 0, overflowX: 'auto' }}>
              {STUDIO_TABS.map((t) => (
                <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`}
                  onClick={() => setTab(t.id)}
                  style={{ fontSize: '11.5px', padding: '5px 8px', flexShrink: 0 }}>{t.l}</button>
              ))}
            </div>
            <div className="acts">
              <button className="iconbtn" onClick={() => store.toggleTheme()}>◐</button>
            </div>
          </div>
          {tab === 'edit' ? <StudioEditor/>
            : tab === 'convert' ? <StudioConvert/>
            : tab === 'docs' ? <StudioDocs/>
            : <StudioPages/>}
        </div>
        <Toasts toasts={state.toasts || []}/>
      </div>
    </div>
  );
}

Object.assign(window, {
  Studio, StudioEditor, StudioConvert, StudioDocs, StudioPages, StudioCropper, DocPreview,
  StudioSheet, BarBtn, LayoutIcon, ColorRow,
  STUDIO_LAYOUTS, STUDIO_FRAMES, STUDIO_CROPS, STUDIO_PDF_PAGES, STUDIO_TABS, DOC_TARGETS,
});
