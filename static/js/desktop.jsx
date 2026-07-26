/* Desktop shell — productivity workspace view — connected to APIs */
const { useState: dUseState, useRef: dUseRef, useCallback: dUseCallback } = React;

function DesktopShell(){
  const [state, store] = window.useStore();

  if (state.auth?.enabled && state.authLoading) {
    return (
      <div className="desktop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <window.LoadingSpinner text="正在載入驗證狀態..." />
      </div>
    );
  }

  if (state.auth?.enabled && !state.auth?.authenticated) {
    return (
      <div className="desktop">
        <window.AuthScreen />
        <window.Toasts toasts={state.toasts}/>
      </div>
    );
  }

  const view = state.dView;

  const renderView = () => {
    switch(view){
      case 'dashboard': return <DDashboard/>;
      case 'scan': return <DScan/>;
      case 'contacts': return <DContacts/>;
      case 'history': return <DHistory/>;
      case 'tools': return <DTools/>;
      case 'settings': return <DSettings/>;
      default: return <DDashboard/>;
    }
  };

  return (
    <div className="desktop">
      <DSidebar view={view} onChange={store.dSetView}/>
      <div className="d-main">
        <DTopbar/>
        <div className="d-content">
          {renderView()}
        </div>
      </div>
      <Toasts toasts={state.toasts}/>
    </div>
  );
}

function DSidebar({ view, onChange }){
  const [state] = window.useStore();
  const s = state.settings || {};
  const items = [
    {id:'dashboard', ic:'⌂', label:'儀表板'},
    {id:'scan', ic:'📷', label:'掃描郵寄', primary:true},
    {id:'contacts', ic:'👥', label:'聯絡人'},
    {id:'history', ic:'🕒', label:'寄件歷史'},
    {id:'tools', ic:'🛠', label:'工具箱'},
    {id:'settings', ic:'⚙', label:'設定'},
  ];
  return (
    <aside className="d-sidebar">
      <div style={{padding:'18px 22px 14px', borderBottom:'1.25px solid var(--line-soft)'}}>
        <div className="hand" style={{fontSize:'22px', fontWeight:700, lineHeight:1, color:'var(--ink)'}}>
          ScanMail<span style={{color:'var(--mint-3)'}}>+</span>
        </div>
        <div style={{fontSize:'10px', color:'var(--ink-3)', marginTop:'2px', letterSpacing:'0.1em', fontFamily:'var(--font-label)'}}>DESKTOP · v2.0</div>
      </div>

      <nav style={{padding:'14px 10px', flex:1}}>
        <div className="label" style={{padding:'0 12px 6px'}}>工作流</div>
        {items.map(it => (
          <div key={it.id} onClick={() => onChange(it.id)} className={`d-navitem ${view===it.id?'on':''}`}>
            <span style={{fontSize:'16px', width:'22px'}}>{it.ic}</span>
            <span>{it.label}</span>
            {it.primary && <span style={{marginLeft:'auto', width:'6px', height:'6px', background:'var(--mint-3)', borderRadius:'50%'}}/>}
          </div>
        ))}
      </nav>

      <div style={{padding:'12px 16px', borderTop:'1.25px solid var(--line-soft)'}}>
        <div className="row">
          <div style={{width:'32px', height:'32px', borderRadius:'50%', background:'var(--mint-3)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-hand)', fontWeight:700}}>
            {(s.name || '?').slice(-1)}
          </div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:'12px', fontWeight:600}}>{s.name || '未設定'}</div>
            <div style={{fontSize:'10px', color:'var(--ink-3)', overflow:'hidden', textOverflow:'ellipsis'}}>{s.email || ''}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function DTopbar(){
  const [state, store] = window.useStore();
  const titles = {dashboard:'儀表板',scan:'新增掃描',contacts:'聯絡人',history:'寄件歷史',tools:'工具箱',settings:'設定'};
  return (
    <div className="d-topbar">
      <div>
        <div className="label">工作區</div>
        <h1 className="hand" style={{fontSize:'22px', fontWeight:700, lineHeight:1, marginTop:'2px'}}>{titles[state.dView]}</h1>
      </div>
      <div className="row" style={{marginLeft:'auto', gap:'8px'}}>
        {state.auth?.enabled && state.auth?.authenticated && (
          <div style={{ marginRight: '16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--ink-3)' }}>👤 {state.auth.username}</span>
            <button className="pill" style={{ fontSize: '11px', padding: '2px 8px', cursor: 'pointer' }} onClick={() => store.logout()}>登出</button>
          </div>
        )}
        <button className="pill primary" style={{fontSize:'12px'}} onClick={() => {store.startScan(); store.dSetView('scan');}}>＋ 新掃描</button>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────
function DDashboard(){
  const [state, store] = window.useStore();
  const apiStats = state.stats || {};
  const stats = [
    {label:'已寄送', v: apiStats.total_sent || state.history.length || 0, sub:'總計', color:'var(--mint-4)'},
    {label:'聯絡人', v:state.contacts.length, sub:`${state.groups.length} 個群組`, color:'var(--ink)'},
    {label:'歷史紀錄', v:state.history.length, sub:'筆', color:'var(--ink-2)'},
  ];

  return (
    <>
      <div className="d-grid-2" style={{marginBottom:'20px'}}>
        <div className="card ink" style={{padding:'24px', gridColumn:'1 / span 2'}}>
          <div className="row between">
            <div>
              <div className="label" style={{color:'rgba(255,255,255,0.5)'}}>快速開始</div>
              <div className="hand" style={{fontSize:'30px', fontWeight:700, marginTop:'6px', lineHeight:1.1}}>準備好寄送下一份文件了嗎？</div>
              <div className="row" style={{gap:'8px', marginTop:'18px'}}>
                <button className="pill primary" onClick={() => {store.startScan(); store.dSetView('scan');}} style={{background:'var(--mint-3)', color:'#fff', borderColor:'var(--mint-3)'}}>📷 開始掃描</button>
              </div>
            </div>
            <div style={{fontSize:'90px', opacity:0.2, lineHeight:1}}>📬</div>
          </div>
        </div>

        {stats.map(s => (
          <div key={s.label} className="card" style={{padding:'16px'}}>
            <div className="label">{s.label}</div>
            <div className="hand" style={{fontSize:'34px', fontWeight:700, lineHeight:1, color:s.color, marginTop:'4px'}}>{s.v}</div>
            <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'4px'}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="d-grid-split">
        <div>
          <div className="row between" style={{marginBottom:'10px'}}>
            <div className="hand" style={{fontSize:'20px', fontWeight:700}}>最近寄送</div>
            <span onClick={() => store.dSetView('history')} style={{fontSize:'11px', color:'var(--mint-3)', cursor:'pointer'}}>全部 ›</span>
          </div>
          {state.history.length === 0 ? (
            <div style={{textAlign:'center', padding:'30px', color:'var(--ink-3)', fontSize:'13px'}}>尚無寄件紀錄</div>
          ) : (
            <div className="col" style={{gap:'6px'}}>
              {state.history.slice(0,5).map(h => (
                <div key={h.id} className="card" style={{padding:'12px 14px'}}>
                  <div className="row between" style={{marginBottom:'4px'}}>
                    <DocTypeBadge type={h.docType} confidence={h.confidence}/>
                    <span style={{fontSize:'10px', color:'var(--ink-3)'}}>{h.sentAt}</span>
                  </div>
                  <div style={{fontSize:'13px', fontWeight:500, marginTop:'4px'}}>{h.subject}</div>
                  <div className="row between" style={{marginTop:'4px'}}>
                    <span style={{fontSize:'11px', color:'var(--ink-3)'}}>→ {h.recipient}</span>
                    <span style={{fontSize:'10px', fontFamily:'var(--font-mono)', color:'var(--ink-3)'}}>{h.size}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="hand" style={{fontSize:'20px', fontWeight:700, marginTop:'0', marginBottom:'10px'}}>常用收件人</div>
          <div className="col" style={{gap:'4px'}}>
            {state.contacts.slice(0,5).map(c => (
              <ContactTile key={c.id} contact={c} onClick={() => {}} compact/>
            ))}
            {state.contacts.length === 0 && <div style={{fontSize:'12px', color:'var(--ink-3)'}}>尚無聯絡人</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── 桌面相機彈窗 — 複用 CameraView ────────────────────
function DCameraModal({ open, onClose, onCapture }){
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:1000,
      background:'rgba(15,22,18,0.78)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:'24px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width:'min(760px, 100%)', height:'min(580px, 90vh)',
        background:'#111', borderRadius:'16px', overflow:'hidden',
        position:'relative', border:'1.5px solid var(--mint-3)',
        boxShadow:'0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <CameraView onCapture={onCapture}/>
        <button onClick={onClose} title="關閉" style={{
          position:'absolute', top:'12px', right:'12px', zIndex:5,
          width:'34px', height:'34px', borderRadius:'50%',
          background:'rgba(0,0,0,0.55)', color:'#fff', fontSize:'18px', lineHeight:1,
          border:'1px solid rgba(255,255,255,0.25)',
        }}>×</button>
        <div style={{
          position:'absolute', top:'12px', left:'50%', transform:'translateX(-50%)',
          zIndex:5, background:'rgba(0,0,0,0.55)', color:'#fff',
          border:'1px solid rgba(255,255,255,0.25)', borderRadius:'999px',
          fontSize:'11px', padding:'4px 12px', letterSpacing:'0.06em',
        }}>📷 即時拍攝</div>
      </div>
    </div>
  );
}

// ─── SCAN VIEW (desktop 3-column) — with real API ──────────
function DScan(){
  const [state, store] = window.useStore();
  const fileRef = dUseRef(null);
  const [processing, setProcessing] = dUseState(false);
  const [sending, setSending] = dUseState(false);
  const [showCamera, setShowCamera] = dUseState(false);
  // 裁切確認畫面 — 上傳/拍照後先讓使用者看到自動偵測的邊界並可拖曳微調，
  // 確認後才送出裁切+透視校正。與 mobile 版 MScanCrop 用同一套 CropEditor，
  // 修正先前「偵測到角點就直接強制套用透視校正」略過確認、且會蓋掉後端
  // 信心門檻判斷的問題。
  const [cropping, setCropping] = dUseState(false);
  const [processedUrl, setProcessedUrl] = dUseState(null);
  const subjectRef = dUseRef(null);
  const bodyRef = dUseRef(null);

  const runPostUpload = async () => {
    setProcessedUrl(null);
    await store.detectEdges().catch(() => {});
    setCropping(true);
  };

  const handleUpload = async (files) => {
    if (!files?.length) return;
    setProcessing(true);
    try {
      await store.uploadFile(files[0]);
      await runPostUpload();
    } catch(e) { /* toast handled */ }
    setProcessing(false);
  };

  const handleCapture = async (blob) => {
    setShowCamera(false);
    setProcessing(true);
    try {
      await store.captureAndUpload(blob);
      await runPostUpload();
    } catch(e) { /* toast handled */ }
    setProcessing(false);
  };

  const applyCrop = async () => {
    setProcessing(true);
    try {
      const result = await store.processScan(state.detectedCorners, state.selectedFilter, !state.detectedCorners);
      if (result?.image_base64) setProcessedUrl('data:image/jpeg;base64,' + result.image_base64);
      await store.addPageAPI();
      setCropping(false);
    } catch(e) { /* toast handled */ }
    setProcessing(false);
  };

  const handleGoToFormFill = async () => {
    setProcessing(true);
    try {
      const r = await window.API.formDetectFromScan();
      const s = await window.API.formSuggest(r.result.fields);
      const enrichedResult = { ...r.result, fields: s.fields || r.result.fields };
      
      store.set({
        dView: 'tools',
        dSubTool: 'form',
        formSession: {
          token: r.session_token,
          result: enrichedResult,
          values: s.values || {},
          filename: r.filename,
          matchedTemplateId: r.matched_template?.id || ''
        }
      });
      
      store.toast('✓ 成功載入掃描表單！', 'ok');
    } catch (e) {
      store.toast('載入表單失敗: ' + e.message, 'err');
    } finally {
      setProcessing(false);
    }
  };

  const doSend = async () => {
    setSending(true);
    try {
      const subject = subjectRef.current?.value || state.aiResult?.subject;
      const body = bodyRef.current?.value || state.aiResult?.body;
      await store.sendEmailAPI(subject, body, state.aiResult?.filename);
      setTimeout(() => { store.resetScan(); store.dSetView('history'); }, 800);
    } catch(e) { /* toast handled */ }
    setSending(false);
  };

  const imgSrc = processedUrl || (state.scanImageBase64 ? 'data:image/jpeg;base64,' + state.scanImageBase64 : state.scanOriginalDataUrl);
  const lowConfidence = state.detectionConfidence !== null && state.detectionConfidence !== undefined && state.detectionConfidence < 0.45;

  return (
    <div className="d-scan-layout">
      {/* LEFT: pages */}
      <div className="card" style={{padding:'14px', overflow:'auto'}}>
        <div className="row between" style={{marginBottom:'10px'}}>
          <div className="label">頁面 ({state.pages.length})</div>
          <div style={{display:'flex', gap:'4px'}}>
            <button className="chip on" onClick={() => setShowCamera(true)} title="使用相機拍照">📷 拍照</button>
            <button className="chip" onClick={() => fileRef.current?.click()} title="從電腦上傳">＋ 上傳</button>
          </div>
        </div>
        <div className="col" style={{gap:'8px'}}>
          {state.pages.length === 0 ? (
            <>
              <button onClick={() => setShowCamera(true)} className="card mint" style={{
                padding:'16px', textAlign:'center', cursor:'pointer',
                border:'1.5px dashed var(--mint-3)', background:'var(--mint-wash)',
              }}>
                <div style={{fontSize:'28px'}}>📷</div>
                <div style={{fontSize:'13px', fontWeight:600, color:'var(--mint-4)', marginTop:'4px'}}>開啟相機拍照</div>
                <div style={{fontSize:'10.5px', color:'var(--ink-3)', marginTop:'2px'}}>使用筆電／外接 webcam</div>
              </button>
              <UploadDropzone accept="image/*" onFiles={handleUpload} icon="📁" label="或拖放 / 選擇圖片">
                <div style={{fontSize:'10.5px', color:'var(--ink-3)', marginTop:'3px'}}>JPG / PNG</div>
              </UploadDropzone>
            </>
          ) : (
            state.pages.map((p, i) => (
              <PageThumb key={p.id} page={p} idx={i}
                active={p.id === state.currentPageId}
                onClick={() => store.setCurrentPage(p.id)}
                onRemove={state.pages.length > 1 ? () => store.removePage(p.id) : null}/>
            ))
          )}
          {state.pages.length > 0 && (
            <div className="row" style={{gap:'6px'}}>
              <button className="card dash" style={{flex:1, padding:'10px', textAlign:'center', background:'transparent', cursor:'pointer', fontSize:'12px', color:'var(--mint-4)'}} onClick={() => setShowCamera(true)}>
                📷 拍一頁
              </button>
              <button className="card dash" style={{flex:1, padding:'10px', textAlign:'center', background:'transparent', cursor:'pointer', fontSize:'12px', color:'var(--ink-3)'}} onClick={() => fileRef.current?.click()}>
                ＋ 上傳
              </button>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={e => handleUpload(e.target.files)}/>
      </div>
      <DCameraModal open={showCamera} onClose={() => setShowCamera(false)} onCapture={handleCapture}/>

      {/* CENTER: editor */}
      <div style={{display:'flex', flexDirection:'column', gap:'12px', minHeight:0}}>
        <div style={{background:'var(--paper-2)', borderRadius:'14px', padding: cropping ? '0' : '24px', flex:1, display:'flex', alignItems:'center', justifyContent:'center', border:'1.25px solid var(--line-soft)', position:'relative', overflow:'hidden'}}>
          {processing && (
            <div style={{position:'absolute', inset:0, zIndex:10, background:'rgba(255,255,255,0.8)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <LoadingSpinner text="處理中..."/>
            </div>
          )}
          {cropping && state.scanOriginalDataUrl ? (
            <CropEditor
              imageSrc={state.scanOriginalDataUrl}
              corners={state.detectedCorners}
              imgW={state.imageWidth}
              imgH={state.imageHeight}
              onChange={(newCorners) => store.set({detectedCorners: newCorners})}
            />
          ) : state.pages.length === 0 && !processing ? (
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:'64px', opacity:0.3}}>📄</div>
              <div className="hand" style={{fontSize:'22px', marginTop:'10px', color:'var(--ink-3)'}}>尚未匯入文件</div>
              <div style={{fontSize:'12px', color:'var(--ink-3)', marginTop:'4px'}}>從左側拖放或點擊「新增」</div>
            </div>
          ) : imgSrc ? (
            <img src={imgSrc} style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain', borderRadius:'4px', boxShadow:'0 2px 12px rgba(0,0,0,0.12)'}}/>
          ) : state.pages.length > 0 ? (
            <div style={{position:'relative'}}>
              <PaperDoc w="340px"/>
            </div>
          ) : null}
        </div>

        <div className="card" style={{padding:'12px 16px'}}>
          {cropping ? (
            <div className="row between">
              <div style={{display:'flex', gap:'6px', alignItems:'center'}}>
                <button className="iconbtn" title="重新自動偵測" onClick={() => store.detectEdges()}>🔍</button>
                <button className="iconbtn" title="重設為預設範圍" onClick={() => store.set({detectedCorners:null})}>↩</button>
                {lowConfidence && (
                  <span style={{fontSize:'11px', color:'var(--warn, #b5772e)'}}>⚠️ 偵測信心較低，請拖曳角點確認邊界</span>
                )}
              </div>
              <button className="btn primary" disabled={processing} onClick={applyCrop}>
                {processing ? '處理中...' : '✂️ 套用裁切 →'}
              </button>
            </div>
          ) : (
            <div className="row">
              <div style={{display:'flex', gap:'6px'}}>
                <button className="iconbtn" title="左轉" onClick={() => { setProcessedUrl(null); store.rotateImageAPI(-90); }}>↺</button>
                <button className="iconbtn" title="右轉" onClick={() => { setProcessedUrl(null); store.rotateImageAPI(90); }}>↻</button>
              </div>
              <div style={{flex:1, marginLeft:'16px'}}>
                <FilterStrip
                  selected={state.selectedFilter}
                  onChange={async (f) => {
                    store.setFilter(f);
                    try {
                      const result = await store.applyFilterAPI(f);
                      if (result?.image_base64) setProcessedUrl('data:image/jpeg;base64,' + result.image_base64);
                    } catch(e) {}
                  }}/>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: actions */}
      <div className="col d-scan-right" style={{gap:'12px', overflow:'auto'}}>
        <div className="card" style={{padding:'14px'}}>
          <div className="label" style={{marginBottom:'8px'}}>收件人 ({state.selectedContactIds.length})</div>
          <DContactSelector/>
          <div className="stroke dash soft" style={{margin:'10px 0'}}/>
          <div className="label" style={{marginBottom:'6px'}}>或選群組</div>
          <div className="row wrap" style={{gap:'4px'}}>
            {state.groups.map(g => (
              <span key={g.id} className="chip" style={{cursor:'pointer'}} onClick={() => {store.selectGroup(g.id); store.toast(`已選 ${g.memberIds?.length || 0} 人`);}}>
                📋 {g.name}
              </span>
            ))}
            {state.groups.length === 0 && <span style={{fontSize:'12px', color:'var(--ink-3)'}}>無群組</span>}
          </div>
        </div>

        {!state.aiResult ? (
          <div className="card mint" style={{padding:'14px'}}>
            <div className="row between" style={{marginBottom:'4px'}}>
              <span style={{fontSize:'11px', fontWeight:600, color:'var(--mint-4)'}}>🤖 AI 智慧辨識</span>
              <span className="chip mint">GEMINI</span>
            </div>
            <div style={{fontSize:'11px', color:'var(--ink-3)', marginBottom:'10px', lineHeight:1.5}}>
              自動分析文件類型、擷取關鍵資訊、產生郵件主旨與正文
            </div>
            <button className="btn primary" style={{width:'100%'}}
              disabled={!state.pages.length || !state.selectedContactIds.length || state.aiLoading}
              onClick={() => store.runAI()}>
              {state.aiLoading ? '⏳ 辨識中...' : '✨ 開始 AI 辨識'}
            </button>
            {!state.pages.length && <div style={{fontSize:'10px', color:'var(--ink-3)', marginTop:'6px', textAlign:'center'}}>需先上傳頁面</div>}
            {state.pages.length > 0 && !state.selectedContactIds.length && <div style={{fontSize:'10px', color:'var(--ink-3)', marginTop:'6px', textAlign:'center'}}>需先選收件人</div>}
          </div>
        ) : (
          <div className="card" style={{padding:'14px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
              <DocTypeBadge type={state.aiResult.docType} confidence={state.aiResult.confidence}/>
              {state.aiResult.docType === 'form' && (
                <button className="chip on" style={{
                  background:'var(--mint-wash)', border:'1.5px solid var(--mint-3)',
                  color:'var(--mint-4)', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px', padding:'4px 10px', fontSize:'11px', borderRadius:'999px', fontWeight:600
                }} onClick={handleGoToFormFill}>
                  📝 自動填寫此表單 →
                </button>
              )}
            </div>
            <div className="label" style={{marginTop:'10px'}}>主旨</div>
            <input ref={subjectRef} className="input" defaultValue={state.aiResult.subject} style={{fontWeight:600, marginTop:'4px'}}/>
            <div className="label" style={{marginTop:'10px'}}>正文</div>
            <textarea ref={bodyRef} className="input" defaultValue={state.aiResult.body} rows={6} style={{marginTop:'4px', fontSize:'12px', lineHeight:1.6, resize:'vertical'}}/>
            <div className="label" style={{marginTop:'10px'}}>附件</div>
            <div className="row" style={{fontSize:'11px', fontFamily:'var(--font-mono)', marginTop:'4px'}}>
              <span>📎 {state.aiResult.filename}</span>
            </div>
            <div className="stroke dash soft" style={{margin:'10px 0'}}/>
            <button className="btn primary" style={{width:'100%'}} disabled={sending} onClick={doSend}>
              {sending ? '⏳ 寄送中...' : '📤 寄送 Email'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Desktop contact selector (inline) ────────────────────
function DContactSelector(){
  const [state, store] = window.useStore();
  const [q, setQ] = dUseState('');
  const [expanded, setExpanded] = dUseState(false);

  const filtered = state.contacts.filter(c =>
    !q || c.name.includes(q) || c.email.includes(q)
  ).slice(0, 8);

  return (
    <div>
      {state.selectedContactIds.length > 0 && (
        <div className="col" style={{gap:'4px', marginBottom:'8px'}}>
          {state.selectedContactIds.map(id => {
            const c = state.contacts.find(x => x.id === id);
            return c ? <ContactTile key={id} contact={c} selected onClick={() => store.toggleContact(id)} compact/> : null;
          })}
        </div>
      )}
      <div className="card" style={{padding:'6px 10px', display:'flex', gap:'6px', alignItems:'center', marginBottom:'6px'}}>
        <span>🔍</span>
        <input className="input" placeholder="搜尋聯絡人..." value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => setExpanded(true)}
          style={{border:'none', padding:0, background:'transparent', fontSize:'12px'}}/>
      </div>
      {expanded && (
        <div style={{maxHeight:'200px', overflow:'auto', border:'1px solid var(--line-soft)', borderRadius:'8px', background:'var(--paper)'}}>
          {filtered.map(c => (
            <ContactTile key={c.id} contact={c}
              selected={state.selectedContactIds.includes(c.id)}
              onClick={() => store.toggleContact(c.id)}
              compact/>
          ))}
          {filtered.length === 0 && <div style={{padding:'12px', textAlign:'center', fontSize:'12px', color:'var(--ink-3)'}}>沒有結果</div>}
          <div style={{padding:'6px', textAlign:'center'}}>
            <button className="chip" onClick={() => setExpanded(false)} style={{fontSize:'10px'}}>收起</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CONTACTS (desktop) ───────────────────────────────────
function DContacts(){
  const [state, store] = window.useStore();
  const [sel, setSel] = dUseState(null);
  const [q, setQ] = dUseState('');
  const [showAdd, setShowAdd] = dUseState(false);

  React.useEffect(() => {
    store.loadContacts();
    store.loadGroups();
  }, []);

  React.useEffect(() => {
    if (state.contacts.length && !sel) setSel(state.contacts[0]?.id);
  }, [state.contacts]);

  const filtered = state.contacts.filter(c => !q || c.name.includes(q) || c.email.toLowerCase().includes(q.toLowerCase()));
  const current = state.contacts.find(c => c.id === sel);

  return (
    <div className="d-two-col-layout">
      <div className="card" style={{padding:'12px', overflow:'auto'}}>
        <div className="row" style={{marginBottom:'10px'}}>
          <input className="input" placeholder="🔍 搜尋..." value={q} onChange={e => setQ(e.target.value)}/>
          <button className="pill primary" style={{fontSize:'12px', flexShrink:0, marginLeft:'6px'}} onClick={() => setShowAdd(!showAdd)}>＋</button>
        </div>
        {showAdd && (
          <DAddContactForm onSave={async (name,email,dept) => {
            await store.addContact({name,email,dept});
            setShowAdd(false);
          }} onCancel={() => setShowAdd(false)}/>
        )}
        {state.loadingContacts && <LoadingSpinner text="載入中..."/>}
        <div className="label" style={{padding:'0 2px 4px'}}>群組</div>
        <div className="row wrap" style={{gap:'4px', marginBottom:'10px'}}>
          {state.groups.map(g => <span key={g.id} className="chip">📋 {g.name} ({g.memberIds?.length || 0})</span>)}
          {state.groups.length === 0 && <span style={{fontSize:'11px', color:'var(--ink-3)'}}>尚無群組</span>}
        </div>
        <div className="stroke dash soft" style={{margin:'6px 0 10px'}}/>
        <div className="label" style={{padding:'0 2px 6px'}}>聯絡人 ({filtered.length})</div>
        <div className="col" style={{gap:'4px'}}>
          {filtered.map(c => (
            <ContactTile key={c.id} contact={c} selected={c.id === sel} onClick={() => setSel(c.id)} compact/>
          ))}
        </div>
      </div>

      <div style={{overflow:'auto'}}>
        {current ? (
          <>
            <div className="card" style={{padding:'22px', marginBottom:'14px'}}>
              <div className="row">
                <div style={{width:'64px', height:'64px', borderRadius:'50%', background:'var(--mint-wash)', color:'var(--mint-4)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-hand)', fontWeight:700, fontSize:'24px', border:'1.5px solid var(--mint-3)'}}>{current.name.slice(-2)}</div>
                <div style={{flex:1}}>
                  <h2 className="hand" style={{fontSize:'24px', fontWeight:700}}>{current.name}</h2>
                  <div style={{fontSize:'12px', color:'var(--ink-3)', marginTop:'2px'}}>{current.title} · {current.dept}</div>
                  <div style={{fontSize:'12px', color:'var(--mint-4)', fontFamily:'var(--font-mono)', marginTop:'2px'}}>{current.email}</div>
                </div>
                <div style={{display:'flex', gap:'6px'}}>
                  <button className="pill" onClick={() => store.removeContact(current.id)}>🗑 刪除</button>
                  <button className="pill primary" onClick={() => {store.toggleContact(current.id); store.startScan(); store.dSetView('scan');}}>📤 寄送</button>
                </div>
              </div>
              <div className="stroke dash soft" style={{margin:'14px 0'}}/>
              <div className="row" style={{gap:'20px'}}>
                <div><div className="label">寄送次數</div><div className="hand" style={{fontSize:'22px', fontWeight:700}}>{current.freq}</div></div>
                <div><div className="label">所屬群組</div><div style={{fontSize:'12px', marginTop:'2px'}}>{state.groups.filter(g => (g.memberIds||[]).includes(current.id)).map(g => g.name).join(', ') || '—'}</div></div>
              </div>
            </div>

            <div className="card" style={{padding:'18px'}}>
              <div className="hand" style={{fontSize:'18px', fontWeight:700, marginBottom:'10px'}}>相關寄件紀錄</div>
              {state.history.filter(h => h.recipient?.includes(current.name) || h.email === current.email).length === 0 ? (
                <div style={{fontSize:'12px', color:'var(--ink-3)', textAlign:'center', padding:'20px'}}>尚無紀錄</div>
              ) : (
                <div className="col" style={{gap:'6px'}}>
                  {state.history.filter(h => h.recipient?.includes(current.name) || h.email === current.email).slice(0,5).map(h => (
                    <div key={h.id} className="card" style={{padding:'10px 12px', boxShadow:'none'}}>
                      <div className="row between">
                        <DocTypeBadge type={h.docType}/>
                        <span style={{fontSize:'10px', color:'var(--ink-3)'}}>{h.sentAt}</span>
                      </div>
                      <div style={{fontSize:'12.5px', fontWeight:500, marginTop:'4px'}}>{h.subject}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : <div style={{color:'var(--ink-3)', padding:'40px', textAlign:'center'}}>選擇聯絡人檢視詳情</div>}
      </div>
    </div>
  );
}

function DAddContactForm({ onSave, onCancel }){
  const [name, setName] = dUseState('');
  const [email, setEmail] = dUseState('');
  const [dept, setDept] = dUseState('');
  return (
    <div className="card mint" style={{padding:'10px', marginBottom:'10px'}}>
      <div className="label" style={{marginBottom:'4px'}}>新增聯絡人</div>
      <input className="input" placeholder="姓名" value={name} onChange={e=>setName(e.target.value)} style={{marginBottom:'4px'}}/>
      <input className="input" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} style={{marginBottom:'4px'}}/>
      <input className="input" placeholder="部門" value={dept} onChange={e=>setDept(e.target.value)} style={{marginBottom:'6px'}}/>
      <div className="row" style={{gap:'6px'}}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn primary" disabled={!name||!email} onClick={()=>onSave(name,email,dept)}>儲存</button>
      </div>
    </div>
  );
}

// ─── HISTORY (desktop table) ───────────────────────────────
function DHistory(){
  const [state, store] = window.useStore();

  React.useEffect(() => { store.loadHistory(); }, []);

  return (
    <div className="card" style={{padding:'16px 18px'}}>
      <div className="row between" style={{marginBottom:'14px'}}>
        <div>
          <div className="label">已寄送</div>
          <div className="hand" style={{fontSize:'22px', fontWeight:700}}>{state.history.length} 筆紀錄</div>
        </div>
      </div>
      {state.loadingHistory && <LoadingSpinner text="載入歷史紀錄..."/>}
      {state.history.length === 0 && !state.loadingHistory && (
        <div style={{textAlign:'center', padding:'30px', color:'var(--ink-3)', fontSize:'13px'}}>尚無寄件紀錄</div>
      )}
      {state.history.length > 0 && (
        <table className="d-table">
          <thead>
            <tr>
              <th>主旨</th><th>類型</th><th>收件人</th><th>寄送時間</th><th>大小</th><th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {state.history.map(h => (
              <tr key={h.id}>
                <td style={{fontWeight:500}}>{h.subject}</td>
                <td><DocTypeBadge type={h.docType} confidence={h.confidence}/></td>
                <td><span style={{fontSize:'12px', color:'var(--ink-2)'}}>{h.recipient}</span></td>
                <td><span style={{fontSize:'11px', color:'var(--ink-3)', fontFamily:'var(--font-mono)'}}>{h.sentAt}</span></td>
                <td><span style={{fontSize:'11px', fontFamily:'var(--font-mono)'}}>{h.size}</span></td>
                <td><span className="chip mint">✓ 已送達</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── TOOLS (desktop) — all connected ──────────────────────
function DTools(){
  const [state, store] = window.useStore();
  const active = state.dSubTool;
  const setActive = (toolId) => {
    store.set({ dSubTool: toolId });
  };

  const tools = [
    {id:'image', ic:'🖼️', t:'圖片工具', desc:'縮放、轉檔、壓縮、浮水印', color:'var(--mint-wash)'},
    {id:'pdf', ic:'📕', t:'PDF 工具', desc:'合併、浮水印、加密保護', color:'#fef2d8'},
    {id:'convert', ic:'🔄', t:'文件轉檔', desc:'Word ↔ PDF ↔ Markdown', color:'#e8eef5'},
    {id:'gif', ic:'🎞️', t:'GIF 製作', desc:'圖片序列產生動畫', color:'#f5e4dc'},
    {id:'video', ic:'🎬', t:'影片工具', desc:'合併、轉 GIF、壓縮', color:'#e8e1ef'},
    {id:'rename', ic:'✏️', t:'批次改名', desc:'前後綴、取代、編號', color:'#e2efe7'},
    {id:'form', ic:'📝', t:'表單填寫', desc:'AcroForm + OCR + AI 偵測 (Beta)', color:'#fff4d6'},
  ];

  const renderTool = () => {
    switch(active){
      case 'image': return <DToolImage/>;
      case 'pdf': return <DToolPdf/>;
      case 'convert': return <DToolConvert/>;
      case 'gif': return <DToolGif/>;
      case 'video': return <DToolVideo/>;
      case 'rename': return <DToolRename/>;
      case 'form': return <DToolForm/>;
      default: return null;
    }
  };

  if (active) {
    const t = tools.find(x => x.id === active);
    return (
      <div>
        <div className="row" style={{marginBottom:'14px'}}>
          <button className="pill" onClick={() => setActive(null)}>← 返回</button>
          <span className="hand" style={{fontSize:'22px', fontWeight:700, marginLeft:'10px'}}>{t?.ic} {t?.t}</span>
        </div>
        {renderTool()}
      </div>
    );
  }

  return (
    <>
      <div className="hand" style={{fontSize:'26px', fontWeight:700, marginBottom:'14px'}}>所有工具</div>
      <div className="d-grid-3">
        {tools.map(t => (
          <div key={t.id} className="card" style={{padding:'20px', cursor:'pointer'}} onClick={() => setActive(t.id)}>
            <div style={{width:'50px', height:'50px', borderRadius:'12px', background:t.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'26px', marginBottom:'10px'}}>{t.ic}</div>
            <div className="hand" style={{fontSize:'20px', fontWeight:700, marginBottom:'4px'}}>{t.t}</div>
            <div style={{fontSize:'12px', color:'var(--ink-3)', marginBottom:'10px', lineHeight:1.5}}>{t.desc}</div>
            <button className="pill">開啟 →</button>
          </div>
        ))}
      </div>
    </>
  );
}

function DToolImage(){
  const [action, setAction] = dUseState('resize');
  const [files, setFiles] = dUseState([]);
  const [opts, setOpts] = dUseState({
    width:800, height:600, mode:'fit',
    format:'JPEG', quality:85,
    text:'CONFIDENTIAL',
    direction:'vertical', gap:0, bg_color:'#ffffff', columns:0, normalize:true,
    angle:90, flipAxis:'horizontal',
  });
  const actions = [
    {id:'resize',l:'📐 縮放'},
    {id:'convert',l:'🔄 轉檔'},
    {id:'compress',l:'📦 壓縮'},
    {id:'rotate',l:'🔁 旋轉'},
    {id:'flip',l:'↔️ 翻轉'},
    {id:'watermark',l:'💧 浮水印'},
    {id:'merge',l:'🧩 拼接'},
  ];

  const singleFn = action === 'merge' ? null : (f) => {
    if(action==='resize') return window.API.imgResize(f,opts.width,opts.height,opts.mode,opts.format,opts.quality);
    if(action==='convert') return window.API.imgConvert(f,opts.format,opts.quality);
    if(action==='compress') return window.API.imgCompress(f,opts.quality,0);
    if(action==='rotate') return window.API.imgRotate(f,opts.angle,'auto',opts.quality);
    if(action==='flip') return window.API.imgFlip(f,opts.flipAxis,'auto',opts.quality);
    return window.API.imgWatermark(f,opts.text,36,80,'center','#000');
  };
  const batchFn = (fs) => {
    if(action==='resize') return window.API.imgBatchResize(fs,opts.width,opts.height,opts.mode,opts.format,opts.quality);
    if(action==='convert') return window.API.imgBatchConvert(fs,opts.format,opts.quality);
    if(action==='compress') return window.API.imgBatchCompress(fs,opts.quality,0);
    if(action==='merge') return window.API.imgMerge(fs, {
      direction:opts.direction, gap:opts.gap, bg_color:opts.bg_color, align:'center',
      output_format:opts.format, quality:opts.quality,
      columns:opts.columns, normalize:opts.normalize,
    });
    // rotate / flip 為單檔處理，沒有 batch 版本（前端會走 single path）
    if(action==='rotate' || action==='flip') return null;
    return window.API.imgBatchWatermark(fs,opts.text,36,80,'center','#000');
  };

  const isMerge = action === 'merge';
  const downloadUrl = isMerge
    ? (tid) => window.API.imgMergeDownload(tid, opts.format)
    : window.API.imgTaskDownload;
  const resultFilename = isMerge
    ? `merged.${(opts.format || 'JPEG').toLowerCase() === 'jpeg' ? 'jpg' : opts.format.toLowerCase()}`
    : 'image_result';

  return (
    <div className="d-rev-two-col-layout">
      <div>
        <div className="row" style={{gap:'6px', marginBottom:'14px', flexWrap:'wrap'}}>
          {actions.map(a => (
            <button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={() => setAction(a.id)}>{a.l}</button>
          ))}
        </div>
        <UploadDropzone accept="image/*" multiple onFiles={f => setFiles([...files,...f])} icon="🖼️"
          label={isMerge ? '拖放至少 2 張要拼接的圖片' : '拖放圖片'}/>
        <FileList files={files} onRemove={i => setFiles(files.filter((_,j) => j !== i))}/>
        {isMerge && files.length < 2 && (
          <div style={{marginTop:'8px', fontSize:'11px', color:'var(--warn)'}}>
            ⚠ 拼接需要至少 2 張圖片（依清單順序排列）
          </div>
        )}
      </div>
      <div className="card" style={{padding:'16px'}}>
        <div className="label" style={{marginBottom:'10px'}}>設定</div>
        {action==='resize' && <>
          <div className="field-label">寬度</div>
          <input className="input" value={opts.width} onChange={e => setOpts({...opts, width:+e.target.value})} style={{marginBottom:'8px'}}/>
          <div className="field-label">高度</div>
          <input className="input" value={opts.height} onChange={e => setOpts({...opts, height:+e.target.value})}/>
        </>}
        {action==='convert' && <>
          <div className="field-label">格式</div>
          <div className="row" style={{gap:'4px'}}>
            {['PNG','JPG','WebP'].map(f => (
              <button key={f} className={`chip ${opts.format===f?'on':''}`} onClick={() => setOpts({...opts, format:f})}>{f}</button>
            ))}
          </div>
        </>}
        {action==='compress' && <>
          <div className="field-label">品質 {opts.quality}%</div>
          <input type="range" className="slider" min="10" max="100" value={opts.quality}
            onChange={e => setOpts({...opts, quality:+e.target.value})}/>
        </>}
        {action==='rotate' && <>
          <div className="field-label">角度</div>
          <div className="row" style={{gap:'4px', marginBottom:'10px', flexWrap:'wrap'}}>
            {[
              {v:90,  l:'↻ 90°'},
              {v:180, l:'⟳ 180°'},
              {v:270, l:'↺ 270°'},
            ].map(a => (
              <button key={a.v} className={`chip ${opts.angle===a.v?'on':''}`}
                onClick={()=>setOpts({...opts, angle:a.v})}>{a.l}</button>
            ))}
          </div>
          <div className="field-label">自訂角度（覆蓋上方按鈕）</div>
          <input className="input" type="number" min="-359" max="359" value={opts.angle}
            onChange={e=>setOpts({...opts, angle:+e.target.value})}/>
        </>}
        {action==='flip' && <>
          <div className="field-label">翻轉方向</div>
          <div className="row" style={{gap:'4px', marginBottom:'10px', flexWrap:'wrap'}}>
            {[
              {v:'horizontal', l:'⇆ 左右翻轉'},
              {v:'vertical',   l:'⇅ 上下翻轉'},
            ].map(a => (
              <button key={a.v} className={`chip ${opts.flipAxis===a.v?'on':''}`}
                onClick={()=>setOpts({...opts, flipAxis:a.v})}>{a.l}</button>
            ))}
          </div>
        </>}
        {action==='watermark' && <>
          <div className="field-label">文字</div>
          <input className="input" value={opts.text} onChange={e => setOpts({...opts, text:e.target.value})}/>
        </>}
        {action==='merge' && <>
          <div className="field-label">排列方向</div>
          <div className="row" style={{gap:'4px', marginBottom:'10px', flexWrap:'wrap'}}>
            {[
              {id:'vertical', l:'⬇ 直向'},
              {id:'horizontal', l:'➡ 橫向'},
              {id:'grid', l:'▦ 九宮格'},
            ].map(d => (
              <button key={d.id} className={`chip ${opts.direction===d.id?'on':''}`}
                onClick={() => setOpts({...opts, direction:d.id})}>{d.l}</button>
            ))}
          </div>
          {opts.direction === 'grid' && <>
            <div className="field-label">欄數（0 = 自動）</div>
            <input className="input" type="number" min="0" value={opts.columns}
              onChange={e => setOpts({...opts, columns:+e.target.value})} style={{marginBottom:'8px'}}/>
          </>}
          <div className="field-label">間距 {opts.gap}px</div>
          <input type="range" className="slider" min="0" max="60" value={opts.gap}
            onChange={e => setOpts({...opts, gap:+e.target.value})} style={{marginBottom:'10px'}}/>
          <div className="field-label">底色</div>
          <input type="color" value={opts.bg_color}
            onChange={e => setOpts({...opts, bg_color:e.target.value})}
            style={{width:'100%', height:'34px', padding:'2px', marginBottom:'10px',
                    border:'1.25px solid var(--line-soft)', borderRadius:'8px', background:'var(--paper)'}}/>
          <div className="field-label">輸出格式</div>
          <div className="row" style={{gap:'4px', marginBottom:'10px'}}>
            {['JPEG','PNG','WEBP'].map(f => (
              <button key={f} className={`chip ${opts.format===f?'on':''}`}
                onClick={() => setOpts({...opts, format:f})}>{f}</button>
            ))}
          </div>
          <div className="field-label">品質 {opts.quality}%</div>
          <input type="range" className="slider" min="40" max="100" value={opts.quality}
            onChange={e => setOpts({...opts, quality:+e.target.value})} style={{marginBottom:'10px'}}/>
          <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px'}}>
            <input type="checkbox" checked={opts.normalize}
              onChange={e => setOpts({...opts, normalize:e.target.checked})}/>
            等比縮放對齊（避免空隙）
          </label>
        </>}
        <div style={{marginTop:'16px'}}>
          <ToolProcessor files={files} single={singleFn} batch={batchFn}
            taskProgressUrl={window.API.imgTaskProgress}
            taskDownloadUrl={downloadUrl}
            resultFilename={resultFilename}/>
        </div>
      </div>
    </div>
  );
}

function DToolPdf(){
  const [action, setAction] = dUseState('merge');
  const [files, setFiles] = dUseState([]);
  const [opts, setOpts] = dUseState({
    text: 'CONFIDENTIAL', password: '',
    addToc: false, addPageNumbers: false,
    splitRanges: '', splitIndividual: false,
    compressLevel: 'basic', compressQuality: 60,
    imgFmt: 'png', imgDpi: 150,
  });

  const actions = [
    {id:'merge',     l:'📎 合併'},
    {id:'split',     l:'✂️ 分割'},
    {id:'compress',  l:'📦 壓縮'},
    {id:'to-images', l:'🖼️ 轉影像'},
    {id:'watermark', l:'💧 浮水印'},
    {id:'protect',   l:'🔒 加密'},
  ];

  const singleFn =
    action === 'watermark' ? (f) => window.API.pdfTextWatermark(f, opts.text, 48, 0.15, 45, 0, 0, 0) :
    action === 'protect'   ? (f) => window.API.pdfProtect(f, opts.password) :
    action === 'split'     ? (f) => window.API.pdfSplit(f, opts.splitRanges, opts.splitIndividual) :
    action === 'compress'  ? (f) => window.API.pdfCompress(f, opts.compressLevel, opts.compressQuality) :
    action === 'to-images' ? (f) => window.API.pdfToImages(f, opts.imgFmt, opts.imgDpi) :
    null;
  const batchFn = action === 'merge' ? (fs) => window.API.pdfMerge(fs, opts.addToc, opts.addPageNumbers) : null;

  // 結果檔名（split / to-images 是 ZIP）
  const resultFilename =
    action === 'split' || action === 'to-images' ? 'pdf_result.zip' : 'pdf_result.pdf';

  return (
    <div className="d-rev-two-col-layout">
      <div>
        <div className="row" style={{gap:'6px', marginBottom:'14px', flexWrap:'wrap'}}>
          {actions.map(a => (
            <button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={()=>{setAction(a.id); setFiles([]);}}>{a.l}</button>
          ))}
        </div>
        <UploadDropzone accept=".pdf" multiple={action==='merge'}
                        onFiles={f=>setFiles([...files,...f])}
                        icon="📕" label={action==='merge' ? '拖放多個 PDF' : '拖放 PDF'}/>
        <FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/>
      </div>

      <div className="card" style={{padding:'16px'}}>
        <div className="label" style={{marginBottom:'10px'}}>設定</div>

        {action==='merge' && <>
          <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px', marginBottom:'8px'}}>
            <input type="checkbox" checked={opts.addToc} onChange={e=>setOpts({...opts, addToc:e.target.checked})}/>
            加入書籤目錄（每份檔名為一節）
          </label>
          <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px'}}>
            <input type="checkbox" checked={opts.addPageNumbers} onChange={e=>setOpts({...opts, addPageNumbers:e.target.checked})}/>
            加上頁碼（n / N）
          </label>
        </>}

        {action==='split' && <>
          <div className="field-label">頁面範圍（空白＝整份）</div>
          <input className="input" value={opts.splitRanges}
                 onChange={e=>setOpts({...opts, splitRanges:e.target.value})}
                 placeholder="1-3,5,7-9" disabled={opts.splitIndividual}/>
          <label style={{fontSize:'12px', display:'flex', alignItems:'center', gap:'6px', marginTop:'8px'}}>
            <input type="checkbox" checked={opts.splitIndividual} onChange={e=>setOpts({...opts, splitIndividual:e.target.checked})}/>
            每頁拆成獨立檔
          </label>
        </>}

        {action==='compress' && <>
          <div className="field-label">壓縮強度</div>
          <select className="input" value={opts.compressLevel}
                  onChange={e=>setOpts({...opts, compressLevel:e.target.value})}>
            <option value="basic">basic — 無損（content streams）</option>
            <option value="images">images — 影像重新編碼</option>
            <option value="deep">deep — images + 縮放 + GC</option>
          </select>
          {opts.compressLevel !== 'basic' && <>
            <div className="field-label" style={{marginTop:'8px'}}>影像 JPEG 品質 ({opts.compressQuality})</div>
            <input type="range" className="slider" min="20" max="95"
                   value={opts.compressQuality}
                   onChange={e=>setOpts({...opts, compressQuality:+e.target.value})}/>
          </>}
        </>}

        {action==='to-images' && <>
          <div className="field-label">格式</div>
          <select className="input" value={opts.imgFmt}
                  onChange={e=>setOpts({...opts, imgFmt:e.target.value})}>
            <option value="png">PNG（無損）</option>
            <option value="jpg">JPG（較小）</option>
          </select>
          <div className="field-label" style={{marginTop:'8px'}}>DPI ({opts.imgDpi})</div>
          <input type="range" className="slider" min="72" max="300"
                 value={opts.imgDpi}
                 onChange={e=>setOpts({...opts, imgDpi:+e.target.value})}/>
        </>}

        {action==='watermark' && <>
          <div className="field-label">文字</div>
          <input className="input" value={opts.text}
                 onChange={e=>setOpts({...opts, text:e.target.value})}/>
        </>}

        {action==='protect' && <>
          <div className="field-label">密碼</div>
          <input className="input" type="password" value={opts.password}
                 onChange={e=>setOpts({...opts, password:e.target.value})}/>
        </>}

        <div style={{marginTop:'16px'}}>
          <ToolProcessor files={files} single={singleFn} batch={batchFn}
            taskProgressUrl={window.API.pdfTaskProgress}
            taskDownloadUrl={window.API.pdfTaskDownload}
            resultFilename={resultFilename}/>
        </div>
      </div>
    </div>
  );
}

function DToolConvert(){
  const convs = [{f:'Word',t:'PDF',dir:'word-pdf',accept:'.docx,.doc'},{f:'PDF',t:'Word',dir:'pdf-word',accept:'.pdf'},{f:'MD',t:'PDF',dir:'md-pdf',accept:'.md'},{f:'MD',t:'Word',dir:'md-word',accept:'.md'},{f:'Word',t:'MD',dir:'word-md',accept:'.docx,.doc'},{f:'PDF',t:'MD',dir:'pdf-md',accept:'.pdf'}];
  const [sel, setSel] = dUseState(0);
  const [files, setFiles] = dUseState([]);
  return (
    <div className="d-rev-two-col-layout">
      <div>
        <div className="row" style={{gap:'6px',marginBottom:'14px',flexWrap:'wrap'}}>{convs.map((c,i)=><button key={i} className={`chip ${sel===i?'on':''}`} onClick={()=>{setSel(i);setFiles([]);}}>{c.f}→{c.t}</button>)}</div>
        <UploadDropzone accept={convs[sel].accept} onFiles={f=>setFiles(f.slice(0,1))} icon="🔄" label={`上傳 ${convs[sel].f} 檔案`}/>
        <FileList files={files} onRemove={()=>setFiles([])}/>
      </div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>轉換方向</div><div className="hand" style={{fontSize:'24px',fontWeight:700,textAlign:'center',margin:'20px 0'}}>{convs[sel].f} → {convs[sel].t}</div><ToolProcessor files={files} single={f=>window.API.docConvert(f,convs[sel].dir)} resultFilename="converted"/></div>
    </div>
  );
}

function DToolGif(){
  const [files, setFiles] = dUseState([]);
  const [opts, setOpts] = dUseState({duration:500,width:0});
  return (
    <div className="d-rev-two-col-layout">
      <div><UploadDropzone accept="image/*" multiple onFiles={f=>setFiles([...files,...f])} icon="🎞️" label="拖放多張圖片"/><FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/></div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>設定</div><div className="field-label">每幀 ms</div><input className="input" value={opts.duration} onChange={e=>setOpts({...opts,duration:+e.target.value})} style={{marginBottom:'8px'}}/><div className="field-label">寬度 (0=auto)</div><input className="input" value={opts.width} onChange={e=>setOpts({...opts,width:+e.target.value})}/><div style={{marginTop:'16px'}}><ToolProcessor files={files} batch={fs=>window.API.gifCreate(fs,opts.duration,0,opts.width,0)} taskProgressUrl={window.API.gifTaskProgress} taskDownloadUrl={window.API.gifTaskDownload} resultFilename="animation.gif"/></div></div>
    </div>
  );
}

function DToolVideo(){
  const [action, setAction] = dUseState('merge');
  const [files, setFiles] = dUseState([]);
  const [opts, setOpts] = dUseState({fps:10,crf:28});
  const batchFn = action==='merge'?(fs)=>window.API.vidMerge(fs,'mp4'):null;
  const singleFn = action==='to-gif'?(f)=>window.API.vidToGif(f,opts.fps,0,0,0):action==='compress'?(f)=>window.API.vidCompress(f,'',opts.crf):null;
  return (
    <div className="d-rev-two-col-layout">
      <div><div className="row" style={{gap:'6px',marginBottom:'14px'}}>{[{id:'merge',l:'合併'},{id:'to-gif',l:'轉GIF'},{id:'compress',l:'壓縮'}].map(a=><button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={()=>{setAction(a.id);setFiles([]);}}>{a.l}</button>)}</div><UploadDropzone accept="video/*" multiple={action==='merge'} onFiles={f=>setFiles([...files,...f])} icon="🎬" label="拖放影片"/><FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/></div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>設定</div>{action==='compress'&&<><div className="field-label">CRF {opts.crf}</div><input type="range" className="slider" min="18" max="40" value={opts.crf} onChange={e=>setOpts({...opts,crf:+e.target.value})}/></>}{action==='to-gif'&&<><div className="field-label">FPS</div><input className="input" value={opts.fps} onChange={e=>setOpts({...opts,fps:+e.target.value})}/></>}<div style={{marginTop:'16px'}}><ToolProcessor files={files} single={singleFn} batch={batchFn} taskProgressUrl={window.API.vidTaskProgress} taskDownloadUrl={window.API.vidTaskDownload} resultFilename={action==='to-gif'?'result.gif':'result.mp4'}/></div></div>
    </div>
  );
}

function DToolRename(){
  const [files, setFiles] = dUseState([]);
  const [aiMode, setAiMode] = dUseState(false);
  const [aiDir, setAiDir] = dUseState('');
  const [onlyExts, setOnlyExts] = dUseState('');
  const [opts, setOpts] = dUseState({prefix:'',suffix:'',find:'',replace:'',numbering:false,numbering_start:1,numbering_digits:3});
  const [preview, setPreview] = dUseState(null);
  const [aiRows, setAiRows] = dUseState(null);  // AI 模式的掃描結果（每列可勾選）
  const [working, setWorking] = dUseState(false);
  const [aiMsg, setAiMsg] = dUseState('');

  const doPreview = async () => {
    if (aiMode) {
      if (!aiDir.trim()) { setAiMsg('請先輸入資料夾路徑'); return; }
      setWorking(true); setAiMsg('掃描中…（影像需 OCR、呼叫 Gemini）');
      try {
        const r = await window.API.aiRenameScan(aiDir.trim(), onlyExts);
        const rows = r.results.map(x => ({...x, selected: x.can_rename}));
        setAiRows(rows);
        const n = rows.filter(x => x.can_rename).length;
        setAiMsg(`掃描完成：${rows.length} 個檔案，${n} 個可改名`);
      } catch(e) { setAiMsg(`掃描失敗：${e.message}`); }
      setWorking(false);
    } else {
      if (!files.length) return;
      try {
        const r = await window.API.renamePreview(files.map(f=>f.name), opts);
        setPreview(r.results);
      } catch(e) { /* silent */ }
    }
  };

  const doAiApply = async () => {
    if (!aiRows) return;
    const items = aiRows
      .filter(r => r.selected && r.can_rename && r.renamed && r.renamed !== r.original)
      .map(r => ({src_path: r.src_path, dst_name: r.renamed}));
    if (!items.length) { setAiMsg('沒有勾選任何可改名項目'); return; }
    setWorking(true); setAiMsg(`套用 ${items.length} 個改名…`);
    try {
      const r = await window.API.aiRenameApply(items);
      setAiMsg(`完成：成功 ${r.renamed}，失敗 ${r.failed}`);
      // 把結果合併回列表（已改名的列更新顯示）
      const resMap = new Map(r.results.map(x => [x.original, x]));
      setAiRows(aiRows.map(row => {
        const res = resMap.get(row.original);
        if (!res) return row;
        if (res.result === 'renamed') {
          return {...row, original: res.renamed, renamed: res.renamed, changed: false, selected: false, reason: 'done', message: '已改名'};
        }
        return {...row, message: res.error || res.reason || ''};
      }));
    } catch(e) { setAiMsg(`失敗：${e.message}`); }
    setWorking(false);
  };

  const toggleRow = (i) => {
    setAiRows(aiRows.map((r,j) => j===i ? {...r, selected: !r.selected} : r));
  };
  const toggleAll = (v) => {
    setAiRows(aiRows.map(r => r.can_rename ? {...r, selected: v} : r));
  };

  return (
    <div className="d-rev-two-col-layout">
      <div>
        {!aiMode && (<>
          <UploadDropzone accept="*" multiple onFiles={f=>setFiles([...files,...f])} icon="📁" label="拖放任意檔案"/>
          <FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/>
          {preview && (
            <div className="card" style={{padding:'10px',marginTop:'10px',maxHeight:'240px',overflow:'auto'}}>
              {preview.map((r,i) => (
                <div key={i} style={{fontSize:'11px',padding:'4px 0',borderBottom:'1px dashed var(--line-soft)',opacity: r.changed?1:0.55}}>
                  <span style={{color:'var(--ink-3)'}}>{r.original}</span>
                  {' → '}
                  <span style={{fontWeight:500,color: r.changed?'var(--mint-4)':'var(--ink-3)'}}>{r.renamed}</span>
                </div>
              ))}
            </div>
          )}
        </>)}

        {aiMode && aiRows && (
          <div className="card" style={{padding:'12px'}}>
            <div className="row between" style={{marginBottom:'8px'}}>
              <div style={{fontSize:'12px',color:'var(--ink-3)'}}>{aiRows.length} 個檔案</div>
              <div className="row" style={{gap:'6px'}}>
                <button className="btn" style={{fontSize:'11px',padding:'4px 8px'}} onClick={()=>toggleAll(true)}>全選</button>
                <button className="btn" style={{fontSize:'11px',padding:'4px 8px'}} onClick={()=>toggleAll(false)}>全不選</button>
              </div>
            </div>
            <div style={{maxHeight:'420px',overflow:'auto'}}>
              {aiRows.map((r,i) => (
                <div key={i} style={{display:'grid',gridTemplateColumns:'24px 1fr',gap:'6px',padding:'6px 0',borderBottom:'1px dashed var(--line-soft)',opacity: r.can_rename?1:0.5}}>
                  <div>
                    {r.can_rename && <input type="checkbox" checked={!!r.selected} onChange={()=>toggleRow(i)}/>}
                  </div>
                  <div style={{fontSize:'11px',lineHeight:1.5}}>
                    <div style={{color:'var(--ink-3)',wordBreak:'break-all'}}>{r.original}</div>
                    {r.changed ? (
                      <div style={{color:'var(--mint-4)',fontWeight:500,wordBreak:'break-all'}}>→ {r.renamed}</div>
                    ) : (
                      <div style={{color:'var(--ink-3)',fontStyle:'italic'}}>略過 · {r.reason}{r.message?`：${r.message}`:''}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{padding:'16px'}}>
        <div className="label" style={{marginBottom:'10px'}}>模式</div>
        <label style={{fontSize:'12px',display:'flex',alignItems:'center',gap:'6px',marginBottom:'10px',padding:'8px',background:aiMode?'var(--mint-wash)':'transparent',borderRadius:'6px'}}>
          <input type="checkbox" checked={aiMode} onChange={e=>{setAiMode(e.target.checked); setPreview(null); setAiRows(null); setAiMsg('');}}/>
          🤖 AI 智慧改名（辨識內容直接改名）
        </label>

        {aiMode ? (
          <>
            <div style={{fontSize:'11px',color:'var(--ink-3)',marginBottom:'10px',lineHeight:1.5}}>
              本機路徑模式：直接在目標資料夾改名，<b>不需上傳</b>。
              僅處理低資訊檔名（IMG_1234、Scan 0001、Invoice-XXXX…），加民國日期前綴。
            </div>
            <div className="field-label">資料夾路徑（本機絕對路徑）</div>
            <input className="input" value={aiDir} onChange={e=>setAiDir(e.target.value)} placeholder="D:\發票\2026Q1" style={{marginBottom:'8px'}}/>
            <div className="field-label">僅處理副檔名（可留空）</div>
            <input className="input" value={onlyExts} onChange={e=>setOnlyExts(e.target.value)} placeholder="pdf,docx,png,jpg" style={{marginBottom:'8px'}}/>
          </>
        ) : (
          <>
            <div className="field-label">前綴</div>
            <input className="input" value={opts.prefix} onChange={e=>setOpts({...opts,prefix:e.target.value})} style={{marginBottom:'8px'}}/>
            <div className="field-label">尋找</div>
            <input className="input" value={opts.find} onChange={e=>setOpts({...opts,find:e.target.value})} style={{marginBottom:'8px'}}/>
            <div className="field-label">取代</div>
            <input className="input" value={opts.replace} onChange={e=>setOpts({...opts,replace:e.target.value})} style={{marginBottom:'8px'}}/>
            <label style={{fontSize:'12px'}}>
              <input type="checkbox" checked={opts.numbering} onChange={e=>setOpts({...opts,numbering:e.target.checked})}/> 流水編號
            </label>
          </>
        )}

        <div style={{marginTop:'16px'}}>
          <button className="btn" onClick={doPreview} style={{width:'100%',marginBottom:'8px'}} disabled={working || (!aiMode && !files.length)}>
            {working ? '處理中…' : (aiMode ? '🤖 AI 掃描預覽' : '👁 預覽')}
          </button>
          {aiMode ? (
            <>
              <button className="btn primary" onClick={doAiApply} style={{width:'100%',marginBottom:'8px'}} disabled={working || !aiRows || !aiRows.some(r=>r.selected && r.can_rename)}>
                ✓ 套用改名（直接改）
              </button>
              {aiMsg && <div style={{fontSize:'11px',color:'var(--ink-3)',marginTop:'6px'}}>{aiMsg}</div>}
            </>
          ) : (
            <ToolProcessor files={files} batch={fs=>window.API.renameApply(fs,opts)}
              taskProgressUrl={window.API.renTaskProgress}
              taskDownloadUrl={window.API.renTaskDownload}
              resultFilename="renamed.zip"/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── VISUAL FORM PREVIEW & INTERACTIVE BBOX (Sprint 4) ───
function BBoxOverlay({ field, pageSize, renderedSize, isActive, onSelect, onDragResize }) {
  const { bbox } = field;
  if (!bbox) return null;

  const pw = pageSize.w;
  const ph = pageSize.h;

  const left = (bbox[0] / pw) * 100;
  const top = ((ph - bbox[3]) / ph) * 100;
  const width = ((bbox[2] - bbox[0]) / pw) * 100;
  const height = ((bbox[3] - bbox[1]) / ph) * 100;

  const handleMouseDown = (e, action) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialBbox = [...bbox];

    const scaleX = pw / renderedSize.w;
    const scaleY = ph / renderedSize.h;

    const handleMouseMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) * scaleX;
      const dy = (moveEvent.clientY - startY) * scaleY;

      let newBbox = [...initialBbox];

      if (action === 'move') {
        newBbox[0] = initialBbox[0] + dx;
        newBbox[2] = initialBbox[2] + dx;
        newBbox[1] = initialBbox[1] - dy;
        newBbox[3] = initialBbox[3] - dy;
      } else if (action === 'tl') {
        newBbox[0] = Math.min(initialBbox[0] + dx, initialBbox[2] - 5);
        newBbox[3] = Math.max(initialBbox[3] - dy, initialBbox[1] + 5);
      } else if (action === 'tr') {
        newBbox[2] = Math.max(initialBbox[2] + dx, initialBbox[0] + 5);
        newBbox[3] = Math.max(initialBbox[3] - dy, initialBbox[1] + 5);
      } else if (action === 'bl') {
        newBbox[0] = Math.min(initialBbox[0] + dx, initialBbox[2] - 5);
        newBbox[1] = Math.min(initialBbox[1] - dy, initialBbox[3] - 5);
      } else if (action === 'br') {
        newBbox[2] = Math.max(initialBbox[2] + dx, initialBbox[0] + 5);
        newBbox[1] = Math.min(initialBbox[1] - dy, initialBbox[3] - 5);
      }

      // Constrain inside page bounds
      newBbox[0] = Math.max(0, Math.min(newBbox[0], pw));
      newBbox[2] = Math.max(0, Math.min(newBbox[2], pw));
      newBbox[1] = Math.max(0, Math.min(newBbox[1], ph));
      newBbox[3] = Math.max(0, Math.min(newBbox[3], ph));

      onDragResize(newBbox);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const isLowConf = field.confidence < 0.5;
  const color = isActive ? 'rgba(46, 130, 93, 0.25)' : (isLowConf ? 'rgba(200, 148, 0, 0.15)' : 'rgba(46, 130, 93, 0.12)');
  const borderColor = isActive ? '#2e825d' : (isLowConf ? '#c89400' : 'rgba(46, 130, 93, 0.6)');
  const borderStyle = isActive ? 'solid' : 'dashed';
  const borderWidth = isActive ? '2px' : '1.5px';

  return (
    <div
      style={{
        position: 'absolute',
        left: `${left}%`,
        top: `${top}%`,
        width: `${width}%`,
        height: `${height}%`,
        backgroundColor: color,
        border: `${borderWidth} ${borderStyle} ${borderColor}`,
        boxSizing: 'border-box',
        cursor: 'move',
        zIndex: isActive ? 5 : 2
      }}
      onMouseDown={(e) => handleMouseDown(e, 'move')}
    >
      {/* Label Badge */}
      <div
        style={{
          position: 'absolute',
          top: '-16px',
          left: '-1px',
          backgroundColor: borderColor,
          color: '#fff',
          padding: '1px 5px',
          fontSize: '9px',
          fontWeight: 600,
          borderRadius: '3px 3px 0 0',
          whiteSpace: 'nowrap',
          pointerEvents: 'none'
        }}
      >
        {field.label || field.name}
      </div>

      {/* Resize Handles (Only show when active) */}
      {isActive && (
        <>
          <div style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: '1.5px solid #2e825d', borderRadius: '50%', position: 'absolute', top: '-3px', left: '-3px', cursor: 'nwse-resize', zIndex: 10 }} onMouseDown={(e) => handleMouseDown(e, 'tl')} />
          <div style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: '1.5px solid #2e825d', borderRadius: '50%', position: 'absolute', top: '-3px', right: '-3px', cursor: 'nesw-resize', zIndex: 10 }} onMouseDown={(e) => handleMouseDown(e, 'tr')} />
          <div style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: '1.5px solid #2e825d', borderRadius: '50%', position: 'absolute', bottom: '-3px', left: '-3px', cursor: 'nesw-resize', zIndex: 10 }} onMouseDown={(e) => handleMouseDown(e, 'bl')} />
          <div style={{ width: '6px', height: '6px', backgroundColor: '#fff', border: '1.5px solid #2e825d', borderRadius: '50%', position: 'absolute', bottom: '-3px', right: '-3px', cursor: 'nwse-resize', zIndex: 10 }} onMouseDown={(e) => handleMouseDown(e, 'br')} />
        </>
      )}
    </div>
  );
}

function FormPagePreview({ pageNum, pdfDoc, imageUrl, imageSize, isPdf, fields, activeFieldId, setActiveFieldId, onFieldsUpdate, onPageSize }) {
  const canvasRef = dUseRef(null);
  const [renderedSize, setRenderedSize] = dUseState({ w: 0, h: 0 });
  const [pageSize, setPageSize] = dUseState({ w: 0, h: 0 });

  // 1. 取得 PDF 頁面大小與渲染比例
  React.useEffect(() => {
    if (!isPdf || !pdfDoc) return;

    pdfDoc.getPage(pageNum + 1).then((page) => {
      const unscaledViewport = page.getViewport({ scale: 1.0 });
      const pw = unscaledViewport.width;
      const ph = unscaledViewport.height;
      setPageSize({ w: pw, h: ph });
      onPageSize(pageNum, pw, ph);

      const scale = 500 / pw;
      const viewport = page.getViewport({ scale });
      setRenderedSize({ w: viewport.width, h: viewport.height });
    }).catch(err => {
      console.error("getPage size error:", err);
    });
  }, [pdfDoc, pageNum, isPdf]);

  // 2. 當 canvas 節點渲染後，執行實際繪製
  React.useEffect(() => {
    if (!isPdf || !pdfDoc || !canvasRef.current || pageSize.w === 0) return;

    pdfDoc.getPage(pageNum + 1).then((page) => {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      const scale = 500 / pageSize.w;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };
      page.render(renderContext);
    }).catch(err => {
      console.error("render page error:", err);
    });
  }, [pdfDoc, pageNum, isPdf, pageSize, renderedSize]);

  React.useEffect(() => {
    if (isPdf || !imageSize) return;
    setPageSize({ w: imageSize.w, h: imageSize.h });
    onPageSize(pageNum, imageSize.w, imageSize.h);
    const renderedW = Math.min(500, imageSize.w);
    const renderedH = (renderedW / imageSize.w) * imageSize.h;
    setRenderedSize({ w: renderedW, h: renderedH });
  }, [imageSize, isPdf]);

  if (pageSize.w === 0 || renderedSize.w === 0) {
    return <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: '12px' }}>載入頁面 {pageNum + 1}...</div>;
  }

  const pageFields = fields.filter((f) => f.page === pageNum);

  return (
    <div
      style={{
        position: 'relative',
        width: `${renderedSize.w}px`,
        height: `${renderedSize.h}px`,
        boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
        border: '1px solid var(--line-soft)',
        borderRadius: '6px',
        backgroundColor: '#fff',
        margin: '0 auto',
        userSelect: 'none'
      }}
    >
      {isPdf ? (
        <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '5px' }} />
      ) : (
        <img src={imageUrl} style={{ display: 'block', width: '100%', height: '100%', borderRadius: '5px', pointerEvents: 'none' }} alt="" />
      )}
      
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        {pageFields.map((field) => (
          <BBoxOverlay
            key={field.name}
            field={field}
            pageSize={pageSize}
            renderedSize={renderedSize}
            isActive={field.name === activeFieldId}
            onSelect={() => setActiveFieldId(field.name)}
            onDragResize={(newBbox) => {
              const updated = fields.map(f => f.name === field.name ? { ...f, bbox: newBbox } : f);
              onFieldsUpdate(updated);
            }}
          />
        ))}
      </div>
      
      <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(20,28,24,0.75)', color: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '9px', fontWeight: 600 }}>
        第 {pageNum + 1} 頁
      </div>
    </div>
  );
}

function FormVisualEditor({ file, fields, activeFieldId, setActiveFieldId, onFieldsUpdate }) {
  const [loading, setLoading] = dUseState(true);
  const [pdfDoc, setPdfDoc] = dUseState(null);
  const [numPages, setNumPages] = dUseState(0);
  const [pageSizes, setPageSizes] = dUseState({});
  const [imageUrl, setImageUrl] = dUseState(null);
  const [imageSize, setImageSize] = dUseState(null);
  const isPdf = file && file.type === 'application/pdf';

  React.useEffect(() => {
    setLoading(true);
    setPdfDoc(null);
    setPageSizes({});
    setImageUrl(null);
    setImageSize(null);
    setNumPages(0);

    if (!file) return;

    const fileUrl = URL.createObjectURL(file);

    if (isPdf) {
      if (!window.pdfjsLib) {
        setLoading(false);
        return;
      }
      window.pdfjsLib.getDocument(fileUrl).promise.then(
        (pdf) => {
          setPdfDoc(pdf);
          setNumPages(pdf.numPages);
          setLoading(false);
        },
        (err) => {
          console.error("PDF loading error:", err);
          setLoading(false);
        }
      );
    } else {
      setImageUrl(fileUrl);
      const img = new Image();
      img.src = fileUrl;
      img.onload = () => {
        setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
        setPageSizes({ 0: { w: img.naturalWidth, h: img.naturalHeight } });
        setNumPages(1);
        setLoading(false);
      };
      img.onerror = () => {
        setLoading(false);
      };
    }

    return () => {
      URL.revokeObjectURL(fileUrl);
    };
  }, [file]);

  if (loading) {
    return <LoadingSpinner text="載入檔案預覽中..." />;
  }

  const pagesArray = Array.from({ length: numPages }, (_, i) => i);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {pagesArray.map((pageNum) => (
        <FormPagePreview
          key={pageNum}
          pageNum={pageNum}
          pdfDoc={pdfDoc}
          imageUrl={imageUrl}
          imageSize={imageSize}
          isPdf={isPdf}
          fields={fields}
          activeFieldId={activeFieldId}
          setActiveFieldId={setActiveFieldId}
          onFieldsUpdate={onFieldsUpdate}
          onPageSize={(pNum, w, h) => {
            setPageSizes(prev => ({ ...prev, [pNum]: { w, h } }));
          }}
        />
      ))}
    </div>
  );
}

// ─── AUTO FORM FILL (Beta) ────────────────────────────────
function DToolForm(){
  const [state, store] = window.useStore();
  const [file, setFile] = dUseState(null);
  const [hint, setHint] = dUseState('');
  const [busy, setBusy] = dUseState(false);
  const [msg, setMsg] = dUseState('');
  const [session, setSession] = dUseState(null);   // {token, result}
  const [values, setValues] = dUseState({});       // {field_name: string}
  const [resultUrl, setResultUrl] = dUseState(null);
  const [activeFieldId, setActiveFieldId] = dUseState(null);

  // M7: Templates & Sending states
  const [templates, setTemplates] = dUseState([]);
  const [selectedTemplateId, setSelectedTemplateId] = dUseState('');
  const [templateName, setTemplateName] = dUseState('');
  const [showSaveTmpl, setShowSaveTmpl] = dUseState(false);
  
  const [filledTaskId, setFilledTaskId] = dUseState(null);
  const [emailSubject, setEmailSubject] = dUseState('');
  const [emailBody, setEmailBody] = dUseState('');
  const [emailFilename, setEmailFilename] = dUseState('');
  const [selectedContactIds, setSelectedContactIds] = dUseState([]);
  const [sendingEmail, setSendingEmail] = dUseState(false);
  const [sendMsg, setSendMsg] = dUseState('');
  const [qContact, setQContact] = dUseState('');
  const [contactDropdownOpen, setContactDropdownOpen] = dUseState(false);

  const loadTemplates = async () => {
    try {
      const r = await window.API.formListTemplates();
      setTemplates(r.templates || []);
    } catch (e) {
      console.error("載入表單模板失敗:", e);
    }
  };

  React.useEffect(() => {
    loadTemplates();
  }, []);

  React.useEffect(() => {
    if (state.formSession) {
      const fs = state.formSession;
      setSession({ token: fs.token, result: fs.result });
      setValues(fs.values || {});
      setFile({ name: fs.filename || 'scanned_form.pdf' });
      setSelectedTemplateId(fs.matchedTemplateId || '');
      if (fs.matchedTemplateId) {
        setMsg('已自動匹配並套用模板');
      } else {
        const autoFilledCount = Object.keys(fs.values || {}).length;
        if (autoFilledCount > 0) {
          setMsg(`已從掃描結果載入並填寫 ${autoFilledCount} 個欄位`);
        } else {
          setMsg('已成功載入掃描表單');
        }
      }
      store.set({ formSession: null });
    }
  }, [state.formSession]);

  const doDetect = async () => {
    if (!file) return;
    setBusy(true); setMsg('偵測欄位中…');
    setSession(null); setValues({}); setResultUrl(null); setActiveFieldId(null);
    setFilledTaskId(null); setSendMsg(''); setSelectedContactIds([]);
    try {
      const r = await window.API.formDetect(file, hint);
      setMsg(`使用 backend: ${r.result.backend_used} · 偵測到 ${r.result.fields.length} 個欄位`);
      if (r.matched_template) {
        setMsg(prev => `${prev}（已自動匹配並套用模板「${r.matched_template.name}」）`);
        setSelectedTemplateId(r.matched_template.id);
      } else {
        setSelectedTemplateId('');
      }
      const s = await window.API.formSuggest(r.result.fields);
      const enrichedResult = {...r.result, fields: s.fields || r.result.fields};
      setSession({token: r.session_token, result: enrichedResult});
      setValues(s.values || {});
      if (s.matched > 0 && !r.matched_template) setMsg(prev => `${prev}（已自動填 ${s.matched} 個）`);
    } catch(e) {
      setMsg(`偵測失敗：${e.message}`);
    }
    setBusy(false);
  };

  const handleTemplateChange = async (id) => {
    setSelectedTemplateId(id);
    if (!id || !session) return;
    setBusy(true); setMsg('正在套用模板...');
    try {
      const r = await window.API.formApplyTemplate(id, session.result.fields);
      setSession(prev => ({
        ...prev,
        result: { ...prev.result, fields: r.fields }
      }));
      setValues(r.values || {});
      setMsg(`已套用模板: ${r.template_name}`);
    } catch (e) {
      setMsg(`套用失敗：${e.message}`);
    }
    setBusy(false);
  };

  const handleSaveTemplate = async () => {
    if (!session || !templateName.trim()) return;
    setBusy(true); setMsg('正在儲存模板...');
    try {
      const r = await window.API.formSaveTemplate(templateName.trim(), session.result.fields, values);
      setMsg(`模板「${templateName.trim()}」儲存成功！`);
      setShowSaveTmpl(false);
      setTemplateName('');
      await loadTemplates();
      if (r.template_id) {
        setSelectedTemplateId(r.template_id);
      }
    } catch (e) {
      setMsg(`儲存失敗：${e.message}`);
    }
    setBusy(false);
  };

  const handleDeleteTemplate = async (id) => {
    if (!confirm("確定要刪除此模板嗎？")) return;
    setBusy(true); setMsg('正在刪除模板...');
    try {
      await window.API.formDeleteTemplate(id);
      setMsg('模板已刪除');
      setSelectedTemplateId('');
      await loadTemplates();
    } catch (e) {
      setMsg(`刪除失敗：${e.message}`);
    }
    setBusy(false);
  };

  const doFill = async () => {
    if (!session) return;
    setBusy(true); setMsg('產生填寫後的 PDF…');
    setFilledTaskId(null); setSendMsg('');
    try {
      const r = await window.API.formFill(session.token, session.result.fields, values);
      await window.API.watchTask(window.API.formTaskProgress(r.task_id), p => {
        if (p.message) setMsg(p.message);
      });
      setResultUrl(window.API.formTaskDownload(r.task_id));
      setFilledTaskId(r.task_id);
      setMsg('完成！可下載填寫後的 PDF 或在下方直接寄送。');
      
      // Auto-populate email details
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      setEmailSubject(`【表單】${baseName} (已填寫)`);
      setEmailFilename(`filled_${baseName}.pdf`);
      setEmailBody("您好，\n\n附件為自動填寫之表單，請查收。\n\n謝謝。");
    } catch(e) {
      setMsg(`填寫失敗：${e.message}`);
    }
    setBusy(false);
  };

  const handleSendEmail = async () => {
    if (!filledTaskId || selectedContactIds.length === 0) return;
    setSendingEmail(true); setSendMsg('正在發送郵件...');
    try {
      const r = await window.API.formSendEmail(filledTaskId, selectedContactIds, emailSubject, emailBody, emailFilename);
      if (r.success) {
        setSendMsg(`寄送成功！共成功 ${r.success_count} 人，失敗 ${r.fail_count} 人。`);
        store.loadContacts();
        store.loadHistory();
      } else {
        setSendMsg(`寄送失敗：${r.results?.[0]?.message || '請檢查 SMTP 設定'}`);
      }
    } catch (e) {
      setSendMsg(`寄送失敗：${e.message}`);
    }
    setSendingEmail(false);
  };

  const fields = session?.result?.fields || [];

  return (
    <div className="d-rev-two-col-layout-380">
      <div>
        {!file && (
          <UploadDropzone accept=".pdf,image/*" onFiles={f=>setFile(f[0] || null)} icon="📝"
                          label="拖放表單（PDF 或圖檔）"/>
        )}

        {file && (
          <div className="card" style={{padding:'16px', display:'flex', flexDirection:'column', background:'var(--paper)', minHeight:'520px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
              <div className="hand" style={{fontWeight:700, fontSize:'16px'}}>表單影像與視覺微調</div>
              <button className="btn text" style={{padding:'2px 8px', color:'#d32f2f', minWidth:'auto'}} onClick={() => { setFile(null); setSession(null); setValues({}); setResultUrl(null); setActiveFieldId(null); setFilledTaskId(null); setSendMsg(''); }}>
                🗑️ 清除表單
              </button>
            </div>
            
            <div style={{flex:1, display:'flex', justifyContent:'center', overflowY:'auto', maxHeight:'650px', background:'var(--paper-2)', borderRadius:'8px', padding:'16px', border:'1px solid var(--line-soft)'}}>
              <FormVisualEditor
                file={file}
                fields={fields}
                activeFieldId={activeFieldId}
                setActiveFieldId={setActiveFieldId}
                onFieldsUpdate={(updatedFields) => {
                  setSession(prev => ({
                    ...prev,
                    result: {
                      ...prev.result,
                      fields: updatedFields
                    }
                  }));
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:'12px'}}>
        <div className="card" style={{padding:'16px'}}>
          <div className="label" style={{marginBottom:'10px'}}>動作與模板</div>
          
          {/* M7: Template selection UI */}
          <div style={{marginBottom:'10px'}}>
            <div className="field-label" style={{marginTop:0}}>套用表單模板</div>
            <div style={{display:'flex', gap:'8px'}}>
              <select className="input" value={selectedTemplateId} onChange={e => handleTemplateChange(e.target.value)} style={{flex:1, fontSize:'13px'}} disabled={!session}>
                <option value="">-- 選擇已儲存之模板 --</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {selectedTemplateId && (
                <button className="btn text" style={{color:'#d32f2f', padding:'0 8px', minWidth:'auto'}} onClick={() => handleDeleteTemplate(selectedTemplateId)}>
                  🗑️
                </button>
              )}
            </div>
          </div>

          {/* Contact Selector */}
          <div style={{marginBottom:'10px'}}>
            <div className="field-label" style={{marginTop:0}}>收件聯絡人 (用於建議填寫與信件傳送)</div>
            <div style={{position:'relative'}}>
              <div style={{display:'flex', flexWrap:'wrap', gap:'4px', padding:'6px', border:'1px solid var(--line-soft)', borderRadius:'6px', background:'var(--paper)', minHeight:'36px', alignItems:'center', cursor:'text'}} onClick={() => setContactDropdownOpen(true)}>
                {selectedContactIds.map(cid => {
                  const c = state.contacts.find(x => x.id === cid);
                  return c ? (
                    <span key={cid} className="chip on" style={{margin:0, fontSize:'11px', display:'flex', alignItems:'center', gap:'4px', padding:'2px 6px', background:'var(--mint-wash)', border:'1px solid var(--primary)', color:'var(--primary)'}}>
                      {c.name}
                      <span style={{cursor:'pointer', fontWeight:'bold', fontSize:'12px'}} onClick={(e) => { e.stopPropagation(); setSelectedContactIds(selectedContactIds.filter(x => x !== cid)); }}>×</span>
                    </span>
                  ) : null;
                })}
                <input className="input" placeholder={selectedContactIds.length === 0 ? "搜尋並選擇聯絡人..." : ""} value={qContact} onChange={e => { setQContact(e.target.value); setContactDropdownOpen(true); }} style={{border:'none', flex:1, padding:0, background:'transparent', fontSize:'12px', minWidth:'80px', outline:'none'}}/>
              </div>
              
              {contactDropdownOpen && (
                <div style={{position:'absolute', top:'100%', left:0, right:0, maxHeight:'180px', overflowY:'auto', border:'1px solid var(--line-soft)', borderRadius:'6px', background:'var(--paper)', zIndex:20, boxShadow:'0 4px 12px rgba(0,0,0,0.15)'}}>
                  {state.contacts.filter(c => !qContact || c.name.includes(qContact) || c.email.toLowerCase().includes(qContact.toLowerCase())).map(c => {
                    const isSel = selectedContactIds.includes(c.id);
                    return (
                      <div key={c.id} style={{padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', fontSize:'12px', borderBottom:'1px solid var(--line-very-soft)', background: isSel ? 'var(--mint-wash)' : 'transparent'}} onClick={async () => {
                        let newIds;
                        if (isSel) {
                          newIds = selectedContactIds.filter(x => x !== c.id);
                        } else {
                          newIds = [...selectedContactIds, c.id];
                        }
                        setSelectedContactIds(newIds);
                        setQContact('');
                        
                        // Automatically suggest/fill contact info if we have a session
                        if (newIds.length > 0 && session) {
                          try {
                            setBusy(true);
                            setMsg('正在依新選聯絡人產生填充建議...');
                            const s = await window.API.formSuggest(session.result.fields, 'default', newIds[0]);
                            setValues(prev => ({ ...prev, ...s.values }));
                            setMsg(`已套用聯絡人「${c.name}」的填寫建議`);
                          } catch (e) {
                            console.error(e);
                          } finally {
                            setBusy(false);
                          }
                        }
                      }}>
                        <div>
                          <div style={{fontWeight:600}}>{c.name}</div>
                          <div style={{fontSize:'10px', color:'var(--ink-3)'}}>{c.email}</div>
                        </div>
                        {isSel && <span style={{color:'var(--primary)'}}>✓</span>}
                      </div>
                    );
                  })}
                  {state.contacts.length === 0 && <div style={{padding:'12px', textAlign:'center', fontSize:'12px', color:'var(--ink-3)'}}>無聯絡人资料</div>}
                  <div style={{padding:'6px', textAlign:'center', borderTop:'1px solid var(--line-very-soft)', background:'var(--paper-2)'}}>
                    <button className="chip" style={{fontSize:'10px'}} onClick={() => setContactDropdownOpen(false)}>關閉</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="field-label">表單提示（選填，給 AI 用）</div>
          <input className="input" value={hint} onChange={e=>setHint(e.target.value)}
                 placeholder="例：差旅費報銷單" style={{marginBottom:'10px'}}/>

          <button className="btn" onClick={doDetect} disabled={busy || !file}
                  style={{width:'100%', marginBottom:'8px'}}>
            {busy ? '處理中…' : '🔍 偵測欄位'}
          </button>
          <button className="btn primary" onClick={doFill} disabled={busy || !session}
                  style={{width:'100%', marginBottom:'8px'}}>
            ✍️ 填寫並產生 PDF
          </button>

          {/* M7: Save template UI */}
          {session && (
            <div style={{marginTop:'4px', marginBottom:'8px'}}>
              {!showSaveTmpl ? (
                <button className="btn" style={{width:'100%', background:'var(--line-very-soft)', border:'1px solid var(--line-soft)', color:'var(--ink)'}} onClick={() => setShowSaveTmpl(true)}>
                  💾 儲存此配置為模板
                </button>
              ) : (
                <div style={{padding:'10px', background:'var(--line-very-soft)', borderRadius:'6px', border:'1px solid var(--line-soft)'}}>
                  <div className="field-label" style={{marginTop:0, fontSize:'11px'}}>模板名稱</div>
                  <input className="input" value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="例：勤益請假表" style={{marginBottom:'8px', fontSize:'12px', padding:'4px 8px'}}/>
                  <div style={{display:'flex', gap:'6px'}}>
                    <button className="btn primary" style={{flex:1, fontSize:'11px', padding:'4px'}} onClick={handleSaveTemplate} disabled={!templateName.trim()}>
                      儲存
                    </button>
                    <button className="btn" style={{flex:1, fontSize:'11px', padding:'4px'}} onClick={() => { setShowSaveTmpl(false); setTemplateName(''); }}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {resultUrl && (
            <button className="btn" onClick={() => window.API.saveFromUrl(resultUrl, 'filled.pdf').catch(() => {})}
                    style={{display:'block', width:'100%', textAlign:'center', marginBottom:'8px', background:'rgba(46,130,93,0.1)', border:'1.5px solid var(--primary)', color:'var(--primary)'}}>
              ⬇ 下載填寫後的 PDF
            </button>
          )}

          {msg && <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'10px', lineHeight:1.5}}>{msg}</div>}

          <div style={{fontSize:'10px', color:'var(--ink-3)', marginTop:'12px', lineHeight:1.5, padding:'10px', background:'var(--line-very-soft)', borderRadius:'6px'}}>
            <b>說明：</b>自動依輸入型態選擇最佳解析方式。點選、拖曳或縮放左側框線，可精準微調。
          </div>
        </div>

        {/* M7: Email Send Panel */}
        {filledTaskId && (
          <div className="card mint" style={{padding:'14px', border:'1px solid var(--mint-soft)'}}>
            <div style={{fontWeight:700, fontSize:'14px', marginBottom:'8px', color:'var(--mint-4)', display:'flex', alignItems:'center', gap:'4px'}}>
              📤 寄送表單電子郵件
            </div>
            
            {/* The contact selector is now located in the upper actions card */}

            <div className="field-label">郵件主旨</div>
            <input className="input" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="主旨" style={{marginBottom:'8px', fontSize:'12px'}}/>

            <div className="field-label">附件名稱</div>
            <input className="input" value={emailFilename} onChange={e => setEmailFilename(e.target.value)} placeholder="檔名" style={{marginBottom:'8px', fontSize:'12px'}}/>

            <div className="field-label">說明文字</div>
            <textarea className="input" value={emailBody} onChange={e => setEmailBody(e.target.value)} rows={3} placeholder="請輸入郵件內文..." style={{fontSize:'12px', lineHeight:1.5, resize:'vertical', marginBottom:'10px'}}/>

            <button className="btn primary" style={{width:'100%'}} disabled={sendingEmail || selectedContactIds.length === 0} onClick={handleSendEmail}>
              {sendingEmail ? '⏳ 寄送中...' : '📤 寄送表單 PDF'}
            </button>

            {sendMsg && <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'6px', lineHeight:1.4}}>{sendMsg}</div>}
          </div>
        )}

        {fields.length > 0 && !filledTaskId && (
          <div className="card" style={{padding:'14px', flex:1, display:'flex', flexDirection:'column', maxHeight:'450px'}}>
            <div className="label" style={{marginBottom:'10px'}}>
              欄位資料填寫（{fields.length}）
            </div>
            <div style={{overflowY:'auto', flex:1, display:'flex', flexDirection:'column', gap:'6px', paddingRight:'4px'}}>
              {fields.map(f => {
                const isActive = f.name === activeFieldId;
                return (
                  <div
                    key={f.name}
                    style={{
                      display:'flex',
                      flexDirection:'column',
                      gap:'4px',
                      padding:'8px',
                      borderRadius:'6px',
                      border:`1px solid ${isActive ? 'var(--primary)' : 'var(--line-very-soft)'}`,
                      backgroundColor: isActive ? 'var(--line-very-soft)' : 'transparent',
                      transition:'all 0.15s'
                    }}
                    onClick={() => setActiveFieldId(f.name)}
                  >
                    <div style={{display:'flex', justifyContent:'between', alignItems:'center'}}>
                      <span style={{fontSize:'12px', fontWeight:600}}>{f.label || f.name}</span>
                      <span style={{fontSize:'9px', color:'var(--ink-3)', marginLeft:'auto'}}>
                        p{f.page+1} · {f.field_type} · {(f.confidence*100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      className="input"
                      value={values[f.name] || ''}
                      onChange={e=>setValues({...values, [f.name]: e.target.value})}
                      onFocus={() => setActiveFieldId(f.name)}
                      placeholder={f.suggested_value || ''}
                      style={{fontSize:'13px', padding:'4px 8px'}}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────
function DSettings(){
  const [state, store] = window.useStore();
  const [form, setForm] = dUseState(null);

  React.useEffect(() => {
    store.loadSettings().then(() => {
      setForm({...state.settings});
    });
  }, []);

  const save = async () => {
    if (!form) return;
    await store.saveSettings(form);
  };

  if (!form) return <LoadingSpinner text="載入設定..."/>;

  return (
    <div className="d-settings-layout">
      <div className="card" style={{padding:'20px', gridColumn:'1 / span 2'}}>
        <div className="hand" style={{fontSize:'20px', fontWeight:700, marginBottom:'14px'}}>系統設定</div>
        <div style={{display:'flex', alignItems:'center', gap:'16px'}}>
          <span style={{fontSize:'14px', fontWeight:500}}>深色主題</span>
          <button className="pill" onClick={() => store.toggleTheme()} style={{padding:'6px 16px', fontSize:'13px'}}>
            {state.theme === 'dark' ? '🌙 深色模式已啟用' : '☀️ 淺色模式已啟用'}
          </button>
        </div>
      </div>
      <div style={{gridColumn:'1 / span 2'}}><ServerSetting/></div>
      <div className="card" style={{padding:'20px'}}>
        <div className="hand" style={{fontSize:'20px', fontWeight:700, marginBottom:'14px'}}>寄件人資料</div>
        <div className="field-label">姓名</div>
        <input className="input" value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">職稱</div>
        <input className="input" value={form.title||''} onChange={e=>setForm({...form,title:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">Email</div>
        <input className="input" value={form.email||''} onChange={e=>setForm({...form,email:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">單位</div>
        <input className="input" value={form.department||''} onChange={e=>setForm({...form,department:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">組織</div>
        <input className="input" value={form.organization||''} onChange={e=>setForm({...form,organization:e.target.value})} style={{marginBottom:'10px'}}/>
        <button className="btn primary" style={{marginTop:'6px'}} onClick={save}>💾 儲存寄件人資料</button>
      </div>
      <div className="card" style={{padding:'20px'}}>
        <div className="hand" style={{fontSize:'20px', fontWeight:700, marginBottom:'14px'}}>SMTP 設定</div>
        <div className="field-label">SMTP Host</div>
        <input className="input" value={form.smtp_host||''} onChange={e=>setForm({...form,smtp_host:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">Port</div>
        <input className="input" value={form.smtp_port||''} onChange={e=>setForm({...form,smtp_port:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">帳號</div>
        <input className="input" value={form.smtp_user||''} onChange={e=>setForm({...form,smtp_user:e.target.value})} style={{marginBottom:'10px'}}/>
        <div className="field-label">密碼</div>
        <input className="input" type="password" value={form.smtp_pass||''} onChange={e=>setForm({...form,smtp_pass:e.target.value})} style={{marginBottom:'10px'}}/>
        <button className="btn primary" style={{marginTop:'6px'}} onClick={save}>💾 儲存 SMTP</button>
      </div>
    </div>
  );
}

Object.assign(window, { DesktopShell, FormVisualEditor });
