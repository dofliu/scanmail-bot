/* 離線精簡版的介面 —— 手機上的媒體處理工具，完全不連後端。
 *
 * 兩個分頁：
 *   編輯 — 選圖後直接看到結果。旋轉/翻轉/縮放都是即時反應，不用「送出→等候」。
 *          單張就是單張編輯，多張就變成拼接，還能單獨調整其中任何一張。
 *   轉換 — 縮放、壓縮、轉檔本來就是同一次重新編碼，合成一個流程一次做完。
 */
const { useState: stUseState, useRef: stUseRef, useEffect: stUseEffect, useCallback: stUseCallback } = React;

const STUDIO_FORMATS = ['JPG', 'PNG', 'WebP'];

function studioBytes(n) {
  return window.API ? window.API.formatBytes(n) : `${n} B`;
}

// ─── 編輯 / 拼接 ───────────────────────────────────────────────
function StudioEditor(){
  const [items, setItems] = stUseState([]);
  const [sel, setSel] = stUseState(0);
  const [busy, setBusy] = stUseState('');
  const [layout, setLayout] = stUseState({
    direction: 'vertical', gap: 0, bgColor: '#ffffff', columns: 0, normalize: true,
  });
  const [out, setOut] = stUseState({ format: 'JPG', quality: 92 });
  const canvasRef = stUseRef(null);
  const addRef = stUseRef(null);
  const boxesRef = stUseRef([]);

  const multi = items.length > 1;
  const current = items[sel];

  // 任何狀態變動就重畫預覽。用縮圖算，所以按一下就看得到，不會卡。
  stUseEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !items.length) return;
    try {
      const info = window.SMImageLocal.previewInto(canvas, items, layout, 1024);
      boxesRef.current = info.boxes;
    } catch (e) {
      console.error('[Studio] 預覽失敗', e);
    }
  }, [items, layout]);

  const addFiles = async (files) => {
    if (!files || !files.length) return;
    setBusy(`讀取 ${files.length} 張圖片...`);
    const loaded = [];
    for (const f of files) {
      try {
        const item = await window.SMImageLocal.loadItem(f);
        item.url = URL.createObjectURL(f);
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
  const reset = () => patch({ rotate: 0, flipH: false, flipV: false, scale: 1 });

  const remove = (i) => {
    setItems((prev) => {
      const it = prev[i];
      if (it?.url) URL.revokeObjectURL(it.url);
      return prev.filter((_, j) => j !== i);
    });
    setSel((s) => Math.max(0, s >= i ? s - 1 : s));
  };

  const clear = () => {
    items.forEach((it) => it.url && URL.revokeObjectURL(it.url));
    setItems([]);
    setSel(0);
  };

  /** 點畫布選圖 —— 比在縮圖列找快 */
  const pickOnCanvas = (e) => {
    if (!multi) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const hit = boxesRef.current.findIndex(
      (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    );
    if (hit >= 0) setSel(hit);
  };

  const save = async () => {
    setBusy('產生檔案中...');
    try {
      // 匯出用原圖重算一次，預覽用的縮圖不會影響輸出品質
      const res = await window.SMImageLocal.composeToBlob(items, { ...layout, ...out });
      await window.API.triggerDownload(res.blob, res.filename);
    } catch (e) {
      window.SMStore?.toast('儲存失敗：' + e.message, 'err');
    }
    setBusy('');
  };

  if (!items.length) {
    return (
      <div className="m-body">
        <UploadDropzone accept="image/*" multiple onFiles={addFiles} icon="🖼️"
          label="選擇圖片開始編輯">
          <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'4px'}}>
            單張 = 旋轉 / 翻轉 · 多張 = 拼接，都可以即時預覽
          </div>
        </UploadDropzone>
        {busy && <div style={{fontSize:'12px', color:'var(--ink-3)', marginTop:'10px'}}>{busy}</div>}
      </div>
    );
  }

  return (
    <div className="m-body">
      {/* 預覽 */}
      <div style={{background:'var(--paper-2)', borderRadius:'10px', padding:'8px',
                   border:'1px solid var(--line-soft)', marginBottom:'10px'}}>
        <canvas ref={canvasRef} onClick={pickOnCanvas}
          style={{width:'100%', height:'auto', maxHeight:'42vh', objectFit:'contain',
                  display:'block', cursor: multi ? 'pointer' : 'default'}}/>
      </div>

      {/* 縮圖列（多張時才有意義） */}
      {multi && (
        <div className="row" style={{gap:'6px', overflowX:'auto', paddingBottom:'6px', marginBottom:'10px'}}>
          {items.map((it, i) => (
            <div key={i} onClick={() => setSel(i)} style={{position:'relative', flexShrink:0}}>
              <img src={it.url} alt=""
                style={{width:'52px', height:'52px', objectFit:'cover', borderRadius:'6px',
                        border: i === sel ? '2px solid var(--mint-3)' : '2px solid transparent',
                        opacity: i === sel ? 1 : 0.65}}/>
              <button onClick={(e) => { e.stopPropagation(); remove(i); }}
                style={{position:'absolute', top:'-4px', right:'-4px', width:'18px', height:'18px',
                        borderRadius:'50%', background:'var(--ink)', color:'var(--paper)',
                        fontSize:'11px', lineHeight:'18px', textAlign:'center', border:'none'}}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* 編輯選中的那一張 */}
      <div className="label" style={{marginBottom:'6px'}}>
        {multi ? `編輯第 ${sel + 1} 張` : '編輯'}
      </div>
      <div className="card" style={{padding:'10px', marginBottom:'12px'}}>
        <div className="row" style={{gap:'6px', flexWrap:'wrap', marginBottom:'10px'}}>
          <button className="chip" onClick={() => rotate(-90)}>↺ 左轉</button>
          <button className="chip" onClick={() => rotate(90)}>↻ 右轉</button>
          <button className={`chip ${current.flipH ? 'on' : ''}`} onClick={() => flip('h')}>⇋ 水平翻</button>
          <button className={`chip ${current.flipV ? 'on' : ''}`} onClick={() => flip('v')}>⇅ 垂直翻</button>
          <button className="chip" onClick={reset}>⟲ 復原</button>
        </div>
        <div className="field-label">大小 {Math.round(current.scale * 100)}%</div>
        <input type="range" className="slider" min="20" max="200" value={Math.round(current.scale * 100)}
          onChange={(e) => patch({ scale: +e.target.value / 100 })}/>
      </div>

      {/* 拼接版面 */}
      {multi && (
        <>
          <div className="label" style={{marginBottom:'6px'}}>拼接方式</div>
          <div className="card" style={{padding:'10px', marginBottom:'12px'}}>
            <div className="row" style={{gap:'4px', flexWrap:'wrap', marginBottom:'10px'}}>
              {[{id:'vertical',l:'⬇ 直向'},{id:'horizontal',l:'➡ 橫向'},{id:'grid',l:'▦ 格狀'}].map(d => (
                <button key={d.id} className={`chip ${layout.direction===d.id?'on':''}`}
                  onClick={() => setLayout({...layout, direction:d.id})}>{d.l}</button>
              ))}
            </div>
            {layout.direction === 'grid' && (
              <>
                <div className="field-label">欄數（0 = 自動）</div>
                <input className="input" type="number" min="0" value={layout.columns}
                  onChange={(e) => setLayout({...layout, columns:+e.target.value})}
                  style={{marginBottom:'8px'}}/>
              </>
            )}
            <div className="field-label">間距 {layout.gap}px</div>
            <input type="range" className="slider" min="0" max="80" value={layout.gap}
              onChange={(e) => setLayout({...layout, gap:+e.target.value})}/>
            <div className="row between" style={{alignItems:'center', marginTop:'10px'}}>
              <span style={{fontSize:'13px'}}>底色</span>
              <input type="color" value={layout.bgColor}
                onChange={(e) => setLayout({...layout, bgColor:e.target.value})}
                style={{width:'52px', height:'30px', border:'1px solid var(--line-soft)',
                        borderRadius:'6px', background:'var(--paper)'}}/>
            </div>
            <label className="row" style={{alignItems:'center', gap:'8px', marginTop:'10px', fontSize:'13px'}}>
              <input type="checkbox" checked={layout.normalize}
                onChange={(e) => setLayout({...layout, normalize:e.target.checked})}/>
              等比對齊（避免大小不一產生空隙）
            </label>
          </div>
        </>
      )}

      {/* 輸出 */}
      <div className="label" style={{marginBottom:'6px'}}>輸出</div>
      <div className="card" style={{padding:'10px', marginBottom:'12px'}}>
        <div className="row" style={{gap:'4px', marginBottom:'10px'}}>
          {STUDIO_FORMATS.map(f => (
            <button key={f} className={`chip ${out.format===f?'on':''}`}
              onClick={() => setOut({...out, format:f})}>{f}</button>
          ))}
        </div>
        {out.format !== 'PNG' && (
          <>
            <div className="field-label">品質 {out.quality}%</div>
            <input type="range" className="slider" min="40" max="100" value={out.quality}
              onChange={(e) => setOut({...out, quality:+e.target.value})}/>
          </>
        )}
      </div>

      <div className="row" style={{gap:'8px'}}>
        <input ref={addRef} type="file" accept="image/*" multiple style={{display:'none'}}
          onChange={(e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; }}/>
        <button className="btn" style={{flex:1}} onClick={() => addRef.current?.click()}>＋ 加圖</button>
        <button className="btn" style={{flex:1}} onClick={clear}>清空</button>
        <button className="btn primary" style={{flex:2}} onClick={save} disabled={!!busy}>
          {busy || '💾 儲存 / 分享'}
        </button>
      </div>
    </div>
  );
}

// ─── 轉換（縮放 + 壓縮 + 轉檔一次做完）──────────────────────────
function StudioConvert(){
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
      <UploadDropzone accept="image/*" multiple onFiles={(f) => { setFiles([...files, ...f]); setResults(null); }}
        icon="🔄" label="選擇要轉換的圖片">
        <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'4px'}}>
          縮小、壓縮、換格式一次做完，只重新編碼一次
        </div>
      </UploadDropzone>
      <FileList files={files} onRemove={(i) => { setFiles(files.filter((_,j)=>j!==i)); setResults(null); }}/>

      <div className="label" style={{margin:'12px 0 6px'}}>尺寸</div>
      <div className="card" style={{padding:'10px', marginBottom:'12px'}}>
        <label className="row" style={{alignItems:'center', gap:'8px', fontSize:'13px'}}>
          <input type="checkbox" checked={opts.limitSize}
            onChange={(e) => setOpts({...opts, limitSize:e.target.checked})}/>
          限制長邊（只縮小，不放大）
        </label>
        {opts.limitSize && (
          <>
            <div className="field-label" style={{marginTop:'10px'}}>最長邊 {opts.maxDimension}px</div>
            <input type="range" className="slider" min="400" max="4000" step="100" value={opts.maxDimension}
              onChange={(e) => setOpts({...opts, maxDimension:+e.target.value})}/>
          </>
        )}
      </div>

      <div className="label" style={{marginBottom:'6px'}}>格式與品質</div>
      <div className="card" style={{padding:'10px', marginBottom:'12px'}}>
        <div className="row" style={{gap:'4px', flexWrap:'wrap', marginBottom:'10px'}}>
          <button className={`chip ${opts.format==='auto'?'on':''}`}
            onClick={() => setOpts({...opts, format:'auto'})}>維持原格式</button>
          {STUDIO_FORMATS.map(f => (
            <button key={f} className={`chip ${opts.format===f?'on':''}`}
              onClick={() => setOpts({...opts, format:f})}>{f}</button>
          ))}
        </div>
        {opts.format !== 'PNG' && (
          <>
            <div className="field-label">品質 {opts.quality}%（越低檔案越小）</div>
            <input type="range" className="slider" min="30" max="100" value={opts.quality}
              onChange={(e) => setOpts({...opts, quality:+e.target.value})}/>
          </>
        )}
      </div>

      {progress && <ProgressBar percent={progress.percent} message={progress.message}/>}

      {results ? (
        <>
          <div style={{fontSize:'12px', color:'var(--ink-3)', margin:'0 0 8px'}}>
            {studioBytes(originalSize)} → {studioBytes(resultSize)}
            {originalSize > 0 && resultSize < originalSize &&
              `（省下 ${Math.round((1 - resultSize / originalSize) * 100)}%）`}
          </div>
          <DownloadResults items={results}/>
          <button className="btn" style={{width:'100%', marginTop:'8px'}} onClick={() => setResults(null)}>
            重新處理
          </button>
        </>
      ) : (
        <button className="btn primary" style={{width:'100%'}} onClick={run}
          disabled={!files.length || !!progress}>
          ▶ 開始轉換（{files.length} 個檔案）
        </button>
      )}
    </div>
  );
}

// ─── 外殼 ──────────────────────────────────────────────────────
function Studio(){
  const [state, store] = window.useStore();
  const [tab, setTab] = stUseState('edit');

  const tabs = [
    { id: 'edit', ic: '🎨', label: '編輯' },
    { id: 'convert', ic: '🔄', label: '轉換' },
  ];

  return (
    <div className="phone">
      <div className="phone-inner">
        <div className="m-screen">
          <MHeader title="媒體工具" subt="全部在裝置上處理 · 不需要網路"
            actions={<button className="iconbtn" onClick={() => store.toggleTheme()}>◐</button>}/>
          {tab === 'edit' ? <StudioEditor/> : <StudioConvert/>}
        </div>
        <div className="m-tabbar">
          {tabs.map(t => (
            <button key={t.id} className={`m-tab ${tab===t.id?'on':''}`} onClick={() => setTab(t.id)}>
              <span className="ic">{t.ic}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <Toasts toasts={state.toasts || []}/>
      </div>
    </div>
  );
}

Object.assign(window, { Studio, StudioEditor, StudioConvert });
