/* Desktop shell — productivity workspace view — connected to APIs */
const { useState: dUseState, useRef: dUseRef, useCallback: dUseCallback } = React;

function DesktopShell(){
  const [state, store] = window.useStore();
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
  const subjectRef = dUseRef(null);
  const bodyRef = dUseRef(null);

  const runPostUpload = async () => {
    await store.detectEdges().catch(() => {});
    await store.processScan(state.detectedCorners, state.selectedFilter, true);
    await store.addPageAPI();
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

  const imgSrc = state.scanImageBase64 ? 'data:image/jpeg;base64,' + state.scanImageBase64 : state.scanOriginalDataUrl;

  return (
    <div style={{display:'grid', gridTemplateColumns:'300px 1fr 340px', gap:'16px', height:'100%'}}>
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
        <div style={{background:'var(--paper-2)', borderRadius:'14px', padding:'24px', flex:1, display:'flex', alignItems:'center', justifyContent:'center', border:'1.25px solid var(--line-soft)', position:'relative', overflow:'hidden'}}>
          {processing && (
            <div style={{position:'absolute', inset:0, zIndex:10, background:'rgba(255,255,255,0.8)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <LoadingSpinner text="處理中..."/>
            </div>
          )}
          {state.pages.length === 0 && !processing ? (
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
          <div className="row">
            <div style={{display:'flex', gap:'6px'}}>
              <button className="iconbtn" title="左轉" onClick={() => store.rotateImageAPI(-90)}>↺</button>
              <button className="iconbtn" title="右轉" onClick={() => store.rotateImageAPI(90)}>↻</button>
              <button className="iconbtn" title="偵測" onClick={() => store.detectEdges()}>🔍</button>
            </div>
            <div style={{flex:1, marginLeft:'16px'}}>
              <FilterStrip
                selected={state.selectedFilter}
                onChange={async (f) => {
                  store.setFilter(f);
                  try { await store.applyFilterAPI(f); } catch(e) {}
                }}/>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: actions */}
      <div className="col" style={{gap:'12px', overflow:'auto'}}>
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
            <DocTypeBadge type={state.aiResult.docType} confidence={state.aiResult.confidence}/>
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
    <div style={{display:'grid', gridTemplateColumns:'320px 1fr', gap:'16px', height:'100%'}}>
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
  const [active, setActive] = dUseState(null);

  const tools = [
    {id:'image', ic:'🖼️', t:'圖片工具', desc:'縮放、轉檔、壓縮、浮水印', color:'var(--mint-wash)'},
    {id:'pdf', ic:'📕', t:'PDF 工具', desc:'合併、浮水印、加密保護', color:'#fef2d8'},
    {id:'convert', ic:'🔄', t:'文件轉檔', desc:'Word ↔ PDF ↔ Markdown', color:'#e8eef5'},
    {id:'gif', ic:'🎞️', t:'GIF 製作', desc:'圖片序列產生動畫', color:'#f5e4dc'},
    {id:'video', ic:'🎬', t:'影片工具', desc:'合併、轉 GIF、壓縮', color:'#e8e1ef'},
    {id:'rename', ic:'✏️', t:'批次改名', desc:'前後綴、取代、編號', color:'#e2efe7'},
  ];

  const renderTool = () => {
    switch(active){
      case 'image': return <DToolImage/>;
      case 'pdf': return <DToolPdf/>;
      case 'convert': return <DToolConvert/>;
      case 'gif': return <DToolGif/>;
      case 'video': return <DToolVideo/>;
      case 'rename': return <DToolRename/>;
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
  });
  const actions = [
    {id:'resize',l:'📐 縮放'},
    {id:'convert',l:'🔄 轉檔'},
    {id:'compress',l:'📦 壓縮'},
    {id:'watermark',l:'💧 浮水印'},
    {id:'merge',l:'🧩 拼接'},
  ];

  const singleFn = action === 'merge' ? null : (f) => {
    if(action==='resize') return window.API.imgResize(f,opts.width,opts.height,opts.mode,opts.format,opts.quality);
    if(action==='convert') return window.API.imgConvert(f,opts.format,opts.quality);
    if(action==='compress') return window.API.imgCompress(f,opts.quality,0);
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
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
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
  const [opts, setOpts] = dUseState({text:'CONFIDENTIAL', password:''});
  const singleFn = action==='watermark'?(f)=>window.API.pdfTextWatermark(f,opts.text,48,0.15,45,0,0,0):action==='protect'?(f)=>window.API.pdfProtect(f,opts.password):null;
  const batchFn = action==='merge'?(fs)=>window.API.pdfMerge(fs):null;
  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
      <div><div className="row" style={{gap:'6px',marginBottom:'14px'}}>{[{id:'merge',l:'📎 合併'},{id:'watermark',l:'💧 浮水印'},{id:'protect',l:'🔒 加密'}].map(a=><button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={()=>setAction(a.id)}>{a.l}</button>)}</div><UploadDropzone accept=".pdf" multiple={action==='merge'} onFiles={f=>setFiles([...files,...f])} icon="📕" label="拖放 PDF"/><FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/></div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>設定</div>{action==='watermark'&&<><div className="field-label">文字</div><input className="input" value={opts.text} onChange={e=>setOpts({...opts,text:e.target.value})}/></>}{action==='protect'&&<><div className="field-label">密碼</div><input className="input" type="password" value={opts.password} onChange={e=>setOpts({...opts,password:e.target.value})}/></>}<div style={{marginTop:'16px'}}><ToolProcessor files={files} single={singleFn} batch={batchFn} taskProgressUrl={window.API.pdfTaskProgress} taskDownloadUrl={window.API.pdfTaskDownload} resultFilename="pdf_result.pdf"/></div></div>
    </div>
  );
}

function DToolConvert(){
  const convs = [{f:'Word',t:'PDF',dir:'word-pdf',accept:'.docx,.doc'},{f:'PDF',t:'Word',dir:'pdf-word',accept:'.pdf'},{f:'MD',t:'PDF',dir:'md-pdf',accept:'.md'},{f:'MD',t:'Word',dir:'md-word',accept:'.md'},{f:'Word',t:'MD',dir:'word-md',accept:'.docx,.doc'}];
  const [sel, setSel] = dUseState(0);
  const [files, setFiles] = dUseState([]);
  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
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
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
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
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
      <div><div className="row" style={{gap:'6px',marginBottom:'14px'}}>{[{id:'merge',l:'合併'},{id:'to-gif',l:'轉GIF'},{id:'compress',l:'壓縮'}].map(a=><button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={()=>{setAction(a.id);setFiles([]);}}>{a.l}</button>)}</div><UploadDropzone accept="video/*" multiple={action==='merge'} onFiles={f=>setFiles([...files,...f])} icon="🎬" label="拖放影片"/><FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/></div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>設定</div>{action==='compress'&&<><div className="field-label">CRF {opts.crf}</div><input type="range" className="slider" min="18" max="40" value={opts.crf} onChange={e=>setOpts({...opts,crf:+e.target.value})}/></>}{action==='to-gif'&&<><div className="field-label">FPS</div><input className="input" value={opts.fps} onChange={e=>setOpts({...opts,fps:+e.target.value})}/></>}<div style={{marginTop:'16px'}}><ToolProcessor files={files} single={singleFn} batch={batchFn} taskProgressUrl={window.API.vidTaskProgress} taskDownloadUrl={window.API.vidTaskDownload} resultFilename={action==='to-gif'?'result.gif':'result.mp4'}/></div></div>
    </div>
  );
}

function DToolRename(){
  const [files, setFiles] = dUseState([]);
  const [opts, setOpts] = dUseState({prefix:'',suffix:'',find:'',replace:'',numbering:false,numbering_start:1,numbering_digits:3});
  const [preview, setPreview] = dUseState(null);
  const doPreview = async()=>{ if(!files.length) return; try{ const r = await window.API.renamePreview(files.map(f=>f.name),opts); setPreview(r.results); }catch(e){} };
  return (
    <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px'}}>
      <div><UploadDropzone accept="*" multiple onFiles={f=>setFiles([...files,...f])} icon="📁" label="拖放任意檔案"/><FileList files={files} onRemove={i=>setFiles(files.filter((_,j)=>j!==i))}/>{preview&&<div className="card" style={{padding:'10px',marginTop:'10px',maxHeight:'200px',overflow:'auto'}}>{preview.map((r,i)=><div key={i} style={{fontSize:'11px',padding:'4px 0',borderBottom:'1px dashed var(--line-soft)'}}><span style={{color:'var(--ink-3)'}}>{r.original}</span> → <span style={{fontWeight:500,color:'var(--mint-4)'}}>{r.new_name||r.renamed}</span></div>)}</div>}</div>
      <div className="card" style={{padding:'16px'}}><div className="label" style={{marginBottom:'10px'}}>設定</div><div className="field-label">前綴</div><input className="input" value={opts.prefix} onChange={e=>setOpts({...opts,prefix:e.target.value})} style={{marginBottom:'8px'}}/><div className="field-label">尋找</div><input className="input" value={opts.find} onChange={e=>setOpts({...opts,find:e.target.value})} style={{marginBottom:'8px'}}/><div className="field-label">取代</div><input className="input" value={opts.replace} onChange={e=>setOpts({...opts,replace:e.target.value})} style={{marginBottom:'8px'}}/><label style={{fontSize:'12px'}}><input type="checkbox" checked={opts.numbering} onChange={e=>setOpts({...opts,numbering:e.target.checked})}/> 流水編號</label><div style={{marginTop:'16px'}}><button className="btn" onClick={doPreview} style={{width:'100%',marginBottom:'8px'}} disabled={!files.length}>👁 預覽</button><ToolProcessor files={files} batch={fs=>window.API.renameApply(fs,opts)} taskProgressUrl={window.API.renTaskProgress} taskDownloadUrl={window.API.renTaskDownload} resultFilename="renamed.zip"/></div></div>
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
    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px'}}>
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

Object.assign(window, { DesktopShell });
