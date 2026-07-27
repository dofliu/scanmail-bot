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

const STUDIO_CROPS = [
  { id: 0,      label: '原始' },
  { id: 1,      label: '1:1' },
  { id: 4 / 3,  label: '4:3' },
  { id: 3 / 4,  label: '3:4' },
  { id: 16 / 9, label: '16:9' },
  { id: 9 / 16, label: '9:16' },
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

// ─── 編輯 / 拼接 ───────────────────────────────────────────────
function StudioEditor() {
  const [items, setItems] = stUseState([]);
  const [sel, setSel] = stUseState(-1);        // -1 = 沒選圖，工具列停在拼貼模式
  const [sheet, setSheet] = stUseState(null);  // layout | frame | gap | size | crop | export
  const [busy, setBusy] = stUseState('');
  const [layout, setLayout] = stUseState({
    preset: 'vertical', direction: 'vertical', columns: 0, fill: 'contain',
    gap: 0, bgColor: '#ffffff', normalize: true,
  });
  const [frame, setFrame] = stUseState({ id: 'none', style: 'none', color: '#ffffff', width: 0, radius: 0 });
  const [out, setOut] = stUseState({ format: 'JPG', quality: 92 });

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
  }, [items, layout, frame, sel]);

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

  const rotate = (delta) => patch({ rotate: (((current.rotate + delta) % 360) + 360) % 360 });
  const flip = (axis) => patch(axis === 'h' ? { flipH: !current.flipH } : { flipV: !current.flipV });

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
      const res = await window.SMImageLocal.composeToBlob(items, { ...composeOpts, ...out });
      await window.API.triggerDownload(res.blob, res.filename);
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

    crop: current && (
      <StudioSheet title="裁切比例" onClose={() => setSheet(null)}>
        <div className="row" style={{ gap: '6px', flexWrap: 'wrap' }}>
          {STUDIO_CROPS.map((c) => (
            <button key={c.label} className={`chip ${(current.crop || 0) === c.id ? 'on' : ''}`}
              onClick={() => patch({ crop: c.id })}>{c.label}</button>
          ))}
        </div>
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
        <div className="row" style={{ gap: '6px', marginBottom: '12px' }}>
          {STUDIO_FORMATS.map((f) => (
            <button key={f} className={`chip ${out.format === f ? 'on' : ''}`}
              onClick={() => setOut({ ...out, format: f })}>{f}</button>
          ))}
        </div>
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
              <BarBtn ic="⛶" label="裁切" on={sheet === 'crop'}
                onClick={() => setSheet(sheet === 'crop' ? null : 'crop')}/>
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
    format: 'auto', quality: 85,
  });
  const [results, setResults] = stUseState(null);
  const [progress, setProgress] = stUseState(null);

  const run = stUseCallback(async () => {
    if (!files.length) return;
    setResults(null);
    setProgress({ percent: 0, message: '開始處理...' });
    try {
      const out = await window.SMImageLocal.batch('transform', files, {
        maxDimension: opts.limitSize ? opts.maxDimension : 0,
        format: opts.format,
        quality: opts.quality,
      }, (percent, message) => setProgress({ percent, message }));
      setResults(out);
    } catch (e) {
      window.SMStore?.toast('處理失敗：' + e.message, 'err');
    }
    setProgress(null);
  }, [files, opts]);

  const originalSize = files.reduce((a, f) => a + f.size, 0);
  const resultSize = (results || []).reduce((a, r) => a + r.blob.size, 0);

  return (
    <div className="m-body">
      <UploadDropzone accept="image/*" multiple
        onFiles={(f) => { setFiles([...files, ...f]); setResults(null); }}
        icon="🔄" label="選擇要轉換的圖片">
        <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginTop: '4px' }}>
          縮小、壓縮、換格式一次做完，只重新編碼一次
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
        </div>
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
          </div>
          <DownloadResults items={results}/>
          <button className="btn" style={{ width: '100%', marginTop: '8px' }} onClick={() => setResults(null)}>
            重新處理
          </button>
        </>
      ) : (
        <button className="btn primary" style={{ width: '100%' }} onClick={run}
          disabled={!files.length || !!progress}>
          ▶ 開始轉換（{files.length} 個檔案）
        </button>
      )}
    </div>
  );
}

// ─── 外殼 ──────────────────────────────────────────────────────
// 分頁切換放在標題列，把整條底部留給工具列 —— 兩條 bar 疊在一起太吃畫面。
function Studio() {
  const [state, store] = window.useStore();
  const [tab, setTab] = stUseState('edit');

  return (
    <div className="phone">
      <div className="phone-inner">
        <div className="m-screen">
          <div className="m-header" style={{ flexShrink: 0 }}>
            <div className="row" style={{ gap: '4px', alignItems: 'center' }}>
              {[{ id: 'edit', l: '🎨 編輯' }, { id: 'convert', l: '🔄 轉換' }].map((t) => (
                <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`}
                  onClick={() => setTab(t.id)} style={{ fontSize: '12px' }}>{t.l}</button>
              ))}
            </div>
            <div className="acts">
              <button className="iconbtn" onClick={() => store.toggleTheme()}>◐</button>
            </div>
          </div>
          {tab === 'edit' ? <StudioEditor/> : <StudioConvert/>}
        </div>
        <Toasts toasts={state.toasts || []}/>
      </div>
    </div>
  );
}

Object.assign(window, {
  Studio, StudioEditor, StudioConvert, StudioSheet, BarBtn, LayoutIcon, ColorRow,
  STUDIO_LAYOUTS, STUDIO_FRAMES, STUDIO_CROPS,
});
