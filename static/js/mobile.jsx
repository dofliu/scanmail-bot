/* Mobile screens — all routes — connected to actual backend APIs */
const { useState: mUseState, useRef: mUseRef, useCallback: mUseCallback } = React;

function MobileShell(){
  const [state, store] = window.useStore();
  const screen = state.mStack[state.mStack.length - 1] || state.mTab;

  const renderScreen = () => {
    switch(screen){
      case 'home': return <MHome/>;
      case 'scan': return <MScan/>;
      case 'tools': return <MTools/>;
      case 'history': return <MHistory/>;
      case 'more': return <MMore/>;
      case 'scan-capture': return <MScanCapture/>;
      case 'scan-crop': return <MScanCrop/>;
      case 'scan-contacts': return <MScanContacts/>;
      case 'scan-ai': return <MScanAI/>;
      case 'scan-preview': return <MScanPreview/>;
      case 'scan-success': return <MScanSuccess/>;
      case 'contacts': return <MContacts/>;
      case 'tool-image': return <MToolImage/>;
      case 'tool-pdf': return <MToolPdf/>;
      case 'tool-convert': return <MToolConvert/>;
      case 'tool-gif': return <MToolGif/>;
      case 'tool-video': return <MToolVideo/>;
      case 'tool-rename': return <MToolRename/>;
      case 'settings': return <MSettings/>;
      default: return <MHome/>;
    }
  };

  const hideTabBar = ['scan-capture','scan-crop'].includes(screen);

  return (
    <div className="phone">
      <div className="phone-inner">
        <div className="status-bar">
          <span>9:41</span>
          <span>●●● ▪ 100%</span>
        </div>
        <div className="m-screen">
          {renderScreen()}
        </div>
        {!hideTabBar && <MTabBar active={state.mTab} onChange={(t) => store.mSetTab(t)}/>}
        <Toasts toasts={state.toasts}/>
      </div>
    </div>
  );
}

function MTabBar({ active, onChange }){
  const tabs = [
    { id:'home', ic:'⌂', label:'首頁' },
    { id:'tools', ic:'🛠', label:'工具' },
    { id:'scan', ic:'📷', label:'掃描', accent:true },
    { id:'history', ic:'🕒', label:'歷史' },
    { id:'more', ic:'☰', label:'更多' },
  ];
  return (
    <div className="m-tabbar">
      {tabs.map(t => (
        <div key={t.id} className={`m-tab ${active === t.id ? 'on' : ''} ${t.accent ? 'accent':''}`} onClick={() => onChange(t.id)}>
          <div className="ic">{t.ic}</div>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function MHeader({ title, back, actions, subt }){
  const [, store] = window.useStore();
  return (
    <div className="m-header">
      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
        {back && <span className="m-back" onClick={() => store.mBack()}>‹</span>}
        <div>
          <h2>{title}</h2>
          {subt && <div className="subt">{subt}</div>}
        </div>
      </div>
      <div className="acts">{actions}</div>
    </div>
  );
}

// ─── HOME ──────────────────────────────────────────────────
function MHome(){
  const [state, store] = window.useStore();
  const recent = state.history.slice(0, 3);
  const stats = state.stats || {};
  const tools = [
    {id:'scan', ic:'📷', label:'掃描郵寄', primary:true, go:() => store.mSetTab('scan')},
    {id:'image', ic:'🖼️', label:'圖片工具', go:() => store.mGoto('tool-image')},
    {id:'pdf', ic:'📕', label:'PDF', go:() => store.mGoto('tool-pdf')},
    {id:'convert', ic:'🔄', label:'轉檔', go:() => store.mGoto('tool-convert')},
    {id:'gif', ic:'🎞️', label:'GIF', go:() => store.mGoto('tool-gif')},
    {id:'video', ic:'🎬', label:'影片', go:() => store.mGoto('tool-video')},
    {id:'rename', ic:'✏️', label:'改名', go:() => store.mGoto('tool-rename')},
    {id:'contacts', ic:'👥', label:'聯絡人', go:() => store.mGoto('contacts')},
  ];

  return (
    <>
      <div className="m-header">
        <div>
          <h2>ScanMail<span style={{color:'var(--mint-3)'}}>+</span></h2>
          <div className="subt">{state.settings?.name ? `你好，${state.settings.name}` : 'ScanMail+'}</div>
        </div>
        <div className="acts">
          <button className="iconbtn" onClick={() => store.mGoto('settings')}>⚙</button>
        </div>
      </div>
      <div className="m-body">
        <div className="card mint" style={{marginBottom:'14px'}}>
          <div className="row between">
            <div>
              <div className="mini" style={{color:'var(--mint-4)'}}>已寄送</div>
              <div className="hand" style={{fontSize:'28px', lineHeight:1, fontWeight:700, color:'var(--mint-4)'}}>{stats.total_sent || state.history.length || 0} 份</div>
              <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'2px'}}>聯絡人 {state.contacts.length} 位</div>
            </div>
            <div style={{fontSize:'42px', opacity:0.4}}>📬</div>
          </div>
        </div>

        <div className="label" style={{marginBottom:'8px'}}>所有工具</div>
        <div className="grid-3" style={{marginBottom:'16px'}}>
          {tools.map(t => (
            <div key={t.id} onClick={t.go} style={{
              padding:'14px 6px', borderRadius:'12px', textAlign:'center',
              background: t.primary ? 'var(--ink)' : 'var(--paper)',
              color: t.primary ? 'var(--paper)' : 'var(--ink)',
              border: t.primary ? '1.25px solid var(--ink)' : '1.25px solid var(--line-soft)',
              cursor:'pointer', position:'relative',
            }}>
              <div style={{fontSize:'26px', marginBottom:'4px'}}>{t.ic}</div>
              <div style={{fontSize:'11px', fontWeight:500}}>{t.label}</div>
              {t.primary && <div style={{position:'absolute', top:'6px', right:'6px', width:'6px', height:'6px', background:'var(--mint)', borderRadius:'50%'}}/>}
            </div>
          ))}
        </div>

        <div className="row between" style={{marginBottom:'8px'}}>
          <span className="label">最近寄送</span>
          <span onClick={() => store.mSetTab('history')} style={{fontSize:'11px', color:'var(--mint-3)', cursor:'pointer'}}>全部 ›</span>
        </div>
        {recent.length === 0 ? (
          <div style={{textAlign:'center', padding:'20px', color:'var(--ink-3)', fontSize:'13px'}}>尚無寄件紀錄</div>
        ) : (
          <div className="col" style={{gap:'6px'}}>
            {recent.map(h => (
              <div key={h.id} className="card" style={{padding:'10px 12px'}}>
                <div className="row">
                  <DocTypeBadge type={h.docType}/>
                  <span style={{fontSize:'10px', color:'var(--ink-3)', marginLeft:'auto'}}>{h.sentAt}</span>
                </div>
                <div style={{fontSize:'12.5px', marginTop:'6px', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{h.subject}</div>
                <div style={{fontSize:'11px', color:'var(--ink-3)'}}>→ {h.recipient}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── SCAN ENTRY ────────────────────────────────────────────
function MScan(){
  const [state, store] = window.useStore();
  const fileRef = mUseRef(null);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    store.startScan();
    try {
      await store.uploadFile(file);
      store.mGoto('scan-crop');
    } catch(err) {
      // Error toast already shown by store
    }
  };

  return (
    <>
      <MHeader title="掃描郵寄" subt="拍照 → AI → Email"/>
      <div className="m-body">
        <div className="card ink" style={{padding:'24px 20px', textAlign:'center', marginBottom:'14px'}}>
          <div style={{fontSize:'52px', lineHeight:1, marginBottom:'10px'}}>📷</div>
          <div className="hand" style={{fontSize:'30px', fontWeight:700, lineHeight:1}}>開始新掃描</div>
          <div style={{fontSize:'12px', opacity:0.7, margin:'6px 0 16px'}}>一分鐘搞定 · AI 自動撰寫</div>
          <button className="pill primary" style={{background:'var(--paper)', color:'var(--ink)', borderColor:'var(--paper)', fontSize:'14px', padding:'10px 22px'}}
            onClick={() => {store.startScan(); store.mGoto('scan-capture');}}>
            📸 拍照掃描 →
          </button>
        </div>

        <div className="grid-2">
          <div className="card" style={{padding:'14px', textAlign:'center', cursor:'pointer'}} onClick={() => fileRef.current?.click()}>
            <div style={{fontSize:'26px'}}>📁</div>
            <div style={{fontSize:'12.5px', fontWeight:500, marginTop:'4px'}}>上傳檔案</div>
            <div style={{fontSize:'10px', color:'var(--ink-3)'}}>JPG / PNG</div>
          </div>
          <div className="card" style={{padding:'14px', textAlign:'center', opacity:0.5}}>
            <div style={{fontSize:'26px'}}>🗂</div>
            <div style={{fontSize:'12.5px', fontWeight:500, marginTop:'4px'}}>草稿</div>
            <div style={{fontSize:'10px', color:'var(--ink-3)'}}>即將推出</div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleUpload}/>

        <div className="stroke soft dash" style={{margin:'18px 0'}}/>
        <div className="label" style={{marginBottom:'8px'}}>最近文件類型</div>
        <div className="row wrap" style={{gap:'6px'}}>
          {Object.entries(window.docTypes).slice(0,6).map(([k,t]) => (
            <span key={k} className="chip">{t.icon} {t.label}</span>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── SCAN: CAPTURE (real camera) ────────────────────────────
function MScanCapture(){
  const [state, store] = window.useStore();
  const [uploading, setUploading] = mUseState(false);
  const fileRef = mUseRef(null);

  const handleCapture = async (blob, dataUrl) => {
    setUploading(true);
    try {
      await store.captureAndUpload(blob);
      store.mGoto('scan-crop');
    } catch(e) {
      store.toast('拍照上傳失敗', 'err');
    }
    setUploading(false);
  };

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await store.uploadFile(file);
      store.mGoto('scan-crop');
    } catch(e) { /* toast handled */ }
    setUploading(false);
  };

  return (
    <>
      <div className="m-header" style={{background:'#141c18', borderColor:'rgba(255,255,255,0.08)'}}>
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <span className="m-back" style={{color:'#fff'}} onClick={() => store.mBack()}>‹</span>
          <h2 style={{color:'#fff'}}>掃描</h2>
        </div>
        <div className="acts">
          <button className="iconbtn" style={{background:'rgba(255,255,255,0.1)', color:'#fff', borderColor:'rgba(255,255,255,0.2)'}} onClick={() => fileRef.current?.click()}>📁</button>
        </div>
      </div>
      <div style={{flex:1, position:'relative', background:'#141c18', overflow:'hidden'}}>
        {uploading ? (
          <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <LoadingSpinner text="上傳中..." size={40}/>
          </div>
        ) : (
          <CameraView onCapture={handleCapture}/>
        )}
        <div style={{position:'absolute', top:'14px', left:'50%', transform:'translateX(-50%)', zIndex:2}}>
          <span className="pill" style={{background:'rgba(0,0,0,0.6)', color:'#fff', borderColor:'rgba(255,255,255,0.3)', fontSize:'11px'}}>
            📄 第 {state.pages.length + 1} 頁
          </span>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleFilePick}/>
    </>
  );
}

// ─── SCAN: CROP + FILTER ───────────────────────────────────
function MScanCrop(){
  const [state, store] = window.useStore();
  const [phase, setPhase] = mUseState('crop');
  const [processing, setProcessing] = mUseState(false);
  const [processedUrl, setProcessedUrl] = mUseState(null);

  // Auto-detect edges on mount
  React.useEffect(() => {
    if (state.scanOriginalDataUrl) {
      store.detectEdges().catch(() => {});
    }
  }, [state.scanOriginalDataUrl]);

  const applyCrop = async () => {
    setProcessing(true);
    try {
      const result = await store.processScan(state.detectedCorners, state.selectedFilter, !state.detectedCorners);
      if (result?.image_base64) {
        setProcessedUrl('data:image/jpeg;base64,' + result.image_base64);
      }
      setPhase('filter');
    } catch(e) { /* toast handled */ }
    setProcessing(false);
  };

  const changeFilter = async (f) => {
    store.setFilter(f);
    try {
      const result = await store.applyFilterAPI(f);
      if (result?.image_base64) {
        setProcessedUrl('data:image/jpeg;base64,' + result.image_base64);
      }
    } catch(e) { /* toast handled */ }
  };

  const addPageAndNext = async () => {
    try {
      await store.addPageAPI();
      store.mGoto('scan-contacts');
    } catch(e) { /* toast handled */ }
  };

  const rotate = async (angle) => {
    try {
      const result = await store.rotateImageAPI(angle);
      if (result?.image_base64) {
        setProcessedUrl('data:image/jpeg;base64,' + result.image_base64);
      }
    } catch(e) { /* toast handled */ }
  };

  const imgSrc = processedUrl || (state.scanImageBase64 ? 'data:image/jpeg;base64,' + state.scanImageBase64 : state.scanOriginalDataUrl);

  return (
    <>
      <div className="m-header">
        <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
          <span className="m-back" onClick={() => store.mBack()}>‹</span>
          <div>
            <h2>{phase === 'crop' ? '裁切文件' : '選擇濾鏡'}</h2>
            <div className="subt">{state.pages.length > 0 ? `共 ${state.pages.length} 頁` : '新文件'}</div>
          </div>
        </div>
        <div className="acts">
          <button className="pill primary" style={{fontSize:'12px', padding:'6px 14px'}} disabled={processing} onClick={() => {
            if(phase === 'crop') applyCrop();
            else addPageAndNext();
          }}>{processing ? '處理中...' : (phase === 'crop' ? '裁切 →' : '下一步 →')}</button>
        </div>
      </div>
      <div style={{flex:1, display:'flex', flexDirection:'column', minHeight:0}}>
        <div style={{flex:1, background:'var(--paper-2)', padding:'16px', display:'flex', alignItems:'center', justifyContent:'center', position:'relative', overflow:'hidden'}}>
          {imgSrc ? (
            <img src={imgSrc} style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain', borderRadius:'4px', boxShadow:'0 2px 12px rgba(0,0,0,0.12)'}}/>
          ) : (
            <LoadingSpinner text="載入中..."/>
          )}
          {processing && (
            <div style={{position:'absolute', inset:0, background:'rgba(255,255,255,0.7)', display:'flex', alignItems:'center', justifyContent:'center'}}>
              <LoadingSpinner text="掃描處理中..."/>
            </div>
          )}
        </div>

        <div style={{background:'var(--paper)', borderTop:'1.25px solid var(--line-soft)', borderRadius:'16px 16px 0 0', padding:'12px 16px 16px', boxShadow:'0 -4px 12px rgba(0,0,0,0.04)'}}>
          <div style={{width:'36px', height:'4px', background:'var(--line-soft)', borderRadius:'2px', margin:'0 auto 12px'}}/>

          {phase === 'crop' ? (
            <>
              <div style={{display:'flex', justifyContent:'space-around', marginBottom:'12px'}}>
                {[{ic:'↺', l:'左轉', fn:() => rotate(-90)},{ic:'↻', l:'右轉', fn:() => rotate(90)},{ic:'🔍', l:'自動偵測', fn:() => store.detectEdges()},{ic:'↩', l:'重設', fn:() => store.set({detectedCorners:null})}].map((a,i) => (
                  <button key={i} onClick={a.fn} style={{textAlign:'center', fontSize:'10px', color:'var(--ink-2)'}}>
                    <div style={{fontSize:'22px', marginBottom:'2px'}}>{a.ic}</div>{a.l}
                  </button>
                ))}
              </div>
              {state.detectedCorners && (
                <div style={{fontSize:'11px', color:'var(--mint-4)', textAlign:'center', marginBottom:'6px'}}>✅ 已偵測到文件邊界</div>
              )}
              {state.pages.length > 0 && (
                <>
                  <div className="stroke dash soft"/>
                  <div className="label" style={{marginTop:'10px', marginBottom:'6px'}}>已掃描頁面</div>
                  <div className="row" style={{gap:'6px', overflowX:'auto', paddingBottom:'4px'}}>
                    {state.pages.map((p, i) => (
                      <div key={p.id} style={{flex:'0 0 58px'}}>
                        <PageThumb page={p} active={p.id === state.currentPageId} idx={i} onClick={() => store.setCurrentPage(p.id)}/>
                      </div>
                    ))}
                    <div onClick={() => store.mBack()} style={{flex:'0 0 58px', aspectRatio:'0.72', border:'1.5px dashed var(--line-soft)', borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'22px', color:'var(--ink-3)', cursor:'pointer'}}>＋</div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="label" style={{marginBottom:'6px'}}>濾鏡</div>
              <FilterStrip selected={state.selectedFilter} onChange={changeFilter}/>
              <div className="stroke dash soft" style={{margin:'10px 0'}}/>
              <div className="row">
                <button className="pill" onClick={() => store.mGoto('scan-capture')} style={{fontSize:'12px'}}>＋ 加一頁</button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SCAN: CONTACTS ────────────────────────────────────────
function MScanContacts(){
  const [state, store] = window.useStore();
  const [tab, setTab] = mUseState('all');
  const [q, setQ] = mUseState('');
  const [showAdd, setShowAdd] = mUseState(false);

  // Reload contacts from API
  React.useEffect(() => { store.loadContacts(); }, []);

  const filtered = state.contacts.filter(c =>
    (tab === 'fav' ? c.fav : true) &&
    (!q || c.name.includes(q) || c.email.includes(q))
  ).sort((a,b) => b.freq - a.freq);

  const addNew = async (name, email, dept) => {
    await store.addContact({ name, email, dept });
    setShowAdd(false);
  };

  return (
    <>
      <MHeader title="選擇收件人" back subt={`${state.selectedContactIds.length} 人已選`}
        actions={
          <button className="pill primary" style={{fontSize:'12px', padding:'6px 14px'}}
            disabled={!state.selectedContactIds.length}
            onClick={() => {store.mGoto('scan-ai'); store.runAI();}}>
            AI 辨識 →
          </button>
        }/>
      <div className="m-body">
        <div className="card" style={{padding:'8px 12px', marginBottom:'12px', display:'flex', alignItems:'center', gap:'8px'}}>
          <span>🔍</span>
          <input className="input" placeholder="搜尋姓名、email..." value={q} onChange={e => setQ(e.target.value)}
            style={{border:'none', padding:0, background:'transparent'}}/>
          <button onClick={() => setShowAdd(!showAdd)} style={{color:'var(--mint-3)', fontSize:'16px', flexShrink:0}}>＋</button>
        </div>

        {showAdd && <AddContactForm onSave={addNew} onCancel={() => setShowAdd(false)}/>}

        {state.loadingContacts && <LoadingSpinner text="載入聯絡人..."/>}

        <div className="row" style={{gap:'6px', marginBottom:'12px', overflowX:'auto'}}>
          <button className={`chip ${tab==='all'?'on':''}`} onClick={() => setTab('all')}>全部 ({state.contacts.length})</button>
          <button className={`chip ${tab==='fav'?'on':''}`} onClick={() => setTab('fav')}>★ 常用</button>
          <button className={`chip ${tab==='groups'?'on':''}`} onClick={() => setTab('groups')}>群組</button>
        </div>

        {tab === 'groups' ? (
          <div className="col">
            {state.groups.length === 0 && <div style={{textAlign:'center', padding:'20px', color:'var(--ink-3)', fontSize:'13px'}}>尚無群組</div>}
            {state.groups.map(g => (
              <div key={g.id} className="card" style={{padding:'12px'}} onClick={() => {store.selectGroup(g.id); store.toast(`已選 ${g.memberIds.length} 人`, 'ok');}}>
                <div className="row between">
                  <div>
                    <div style={{fontWeight:600, fontSize:'14px'}}>📋 {g.name}</div>
                    <div style={{fontSize:'11px', color:'var(--ink-3)'}}>{g.memberIds.length} 位成員</div>
                  </div>
                  <span className="pill primary" style={{fontSize:'11px'}}>一鍵全選</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="col" style={{gap:'6px'}}>
            {filtered.length === 0 && !state.loadingContacts && (
              <div style={{textAlign:'center', padding:'20px', color:'var(--ink-3)', fontSize:'13px'}}>
                沒有聯絡人，請點 ＋ 新增
              </div>
            )}
            {filtered.map(c => (
              <ContactTile key={c.id} contact={c} selected={state.selectedContactIds.includes(c.id)}
                onClick={() => store.toggleContact(c.id)}
                onFav={() => store.toggleFav(c.id)}/>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Add Contact form ─────────────────────────────────────
function AddContactForm({ onSave, onCancel }){
  const [name, setName] = mUseState('');
  const [email, setEmail] = mUseState('');
  const [dept, setDept] = mUseState('');
  return (
    <div className="card mint" style={{padding:'12px', marginBottom:'12px'}}>
      <div className="label" style={{marginBottom:'6px'}}>新增聯絡人</div>
      <input className="input" placeholder="姓名" value={name} onChange={e => setName(e.target.value)} style={{marginBottom:'6px'}}/>
      <input className="input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{marginBottom:'6px'}}/>
      <input className="input" placeholder="部門 (選填)" value={dept} onChange={e => setDept(e.target.value)} style={{marginBottom:'8px'}}/>
      <div className="row" style={{gap:'6px'}}>
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn primary" disabled={!name || !email} onClick={() => onSave(name, email, dept)}>儲存</button>
      </div>
    </div>
  );
}

// ─── SCAN: AI LOADING ──────────────────────────────────────
function MScanAI(){
  const [state, store] = window.useStore();

  React.useEffect(() => {
    if(state.aiResult && !state.aiLoading){
      const t = setTimeout(() => store.mGoto('scan-preview'), 600);
      return () => clearTimeout(t);
    }
  }, [state.aiResult, state.aiLoading]);

  return (
    <>
      <MHeader title="AI 辨識中" back/>
      <div className="m-body" style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
        <div style={{position:'relative', width:'120px', height:'120px', marginBottom:'20px'}}>
          <div style={{position:'absolute', inset:0, borderRadius:'50%', border:'4px solid var(--mint-wash)', borderTopColor:'var(--mint-3)', animation:'spin 1.2s linear infinite'}}/>
          <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'42px'}}>🤖</div>
        </div>
        <div className="hand" style={{fontSize:'24px', fontWeight:700, marginBottom:'4px'}}>Gemini 正在閱讀...</div>
        <div style={{fontSize:'12px', color:'var(--ink-3)', textAlign:'center', maxWidth:'260px'}}>辨識文件類型 · 擷取關鍵資訊 · 產生主旨與正文</div>
        {state.aiResult?._error && (
          <div style={{marginTop:'12px', fontSize:'12px', color:'var(--danger)', textAlign:'center'}}>
            ⚠ AI 服務暫時不可用，使用基本模板
          </div>
        )}
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      </div>
    </>
  );
}

// ─── SCAN: PREVIEW ─────────────────────────────────────────
function MScanPreview(){
  const [state, store] = window.useStore();
  const [editing, setEditing] = mUseState(false);
  const [sending, setSending] = mUseState(false);
  const subjectRef = mUseRef(null);
  const bodyRef = mUseRef(null);
  const r = state.aiResult;
  if(!r) return null;

  const contacts = state.selectedContactIds.map(id => state.contacts.find(c => c.id === id)).filter(Boolean);

  const doSend = async () => {
    setSending(true);
    try {
      const subject = subjectRef.current?.value || r.subject;
      const body = bodyRef.current?.value || r.body;
      await store.sendEmailAPI(subject, body, r.filename);
      store.mGoto('scan-success');
    } catch(e) { /* toast handled */ }
    setSending(false);
  };

  return (
    <>
      <MHeader title="預覽確認" back subt="檢查無誤後寄出"
        actions={
          <button className="pill primary" style={{fontSize:'12px', padding:'6px 14px'}} disabled={sending} onClick={doSend}>
            {sending ? '寄送中...' : '寄出 ✓'}
          </button>
        }/>
      <div className="m-body">
        <div className="card" style={{padding:'14px', marginBottom:'12px'}}>
          <div className="row between" style={{marginBottom:'8px'}}>
            <DocTypeBadge type={r.docType} confidence={r.confidence}/>
            <button onClick={() => setEditing(!editing)} className="chip">{editing?'完成':'編輯'}</button>
          </div>
          <div style={{fontSize:'10px', color:'var(--ink-3)', marginBottom:'2px'}}>主旨</div>
          {editing ? (
            <input ref={subjectRef} className="input" defaultValue={r.subject} style={{fontSize:'14px', fontWeight:600, marginBottom:'10px'}}/>
          ) : (
            <div style={{fontSize:'14px', fontWeight:600, marginBottom:'10px', lineHeight:1.4}}>{r.subject}</div>
          )}
          <div className="stroke dash soft" style={{margin:'10px 0'}}/>
          <div style={{fontSize:'10px', color:'var(--ink-3)', marginBottom:'4px'}}>正文</div>
          {editing ? (
            <textarea ref={bodyRef} className="input" defaultValue={r.body} rows={8} style={{fontSize:'12.5px', lineHeight:1.6, resize:'vertical', fontFamily:'var(--font-body)'}}/>
          ) : (
            <div style={{fontSize:'12.5px', lineHeight:1.7, whiteSpace:'pre-line', color:'var(--ink-2)'}}>{r.body}</div>
          )}
        </div>

        <div className="card fill" style={{padding:'12px', marginBottom:'12px'}}>
          <div className="label" style={{marginBottom:'6px'}}>收件人 ({contacts.length})</div>
          <div className="row wrap" style={{gap:'4px'}}>
            {contacts.map(c => <span key={c.id} className="chip mint">{c.name}</span>)}
          </div>
        </div>

        <div className="card" style={{padding:'10px 14px'}}>
          <div className="row between">
            <div>
              <div className="label">附件檔名</div>
              <div style={{fontSize:'12px', fontFamily:'var(--font-mono)', marginTop:'2px'}}>{r.filename}</div>
            </div>
            <div style={{fontSize:'24px'}}>📎</div>
          </div>
          <div className="stroke dash soft" style={{margin:'8px 0'}}/>
          <div className="row between" style={{fontSize:'11px', color:'var(--ink-3)'}}>
            <span>{state.pages.length || 1} 頁 · PDF</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── SCAN: SUCCESS ─────────────────────────────────────────
function MScanSuccess(){
  const [state, store] = window.useStore();
  const contacts = state.selectedContactIds.map(id => state.contacts.find(c => c.id === id)).filter(Boolean);

  return (
    <>
      <MHeader title="完成" actions={
        <button className="pill" style={{fontSize:'12px'}} onClick={() => {store.resetScan(); store.mSetTab('home');}}>✕</button>
      }/>
      <div className="m-body" style={{textAlign:'center'}}>
        <div style={{padding:'30px 0 10px'}}>
          <div className="check-anim">✓</div>
        </div>
        <div className="hand" style={{fontSize:'32px', fontWeight:700}}>寄送成功！</div>
        <div style={{fontSize:'13px', color:'var(--ink-3)', marginBottom:'20px'}}>已送達 {contacts.length} 位收件人</div>

        <div className="card fill" style={{padding:'12px', textAlign:'left', marginBottom:'14px'}}>
          <div style={{fontSize:'12px', color:'var(--ink-3)'}}>主旨</div>
          <div style={{fontSize:'13px', fontWeight:500, marginBottom:'6px'}}>{state.aiResult?.subject}</div>
          <div className="stroke dash soft" style={{margin:'6px 0'}}/>
          <div style={{fontSize:'12px', color:'var(--ink-3)'}}>收件人</div>
          <div style={{fontSize:'12.5px'}}>{contacts.map(c => c.name).join(', ')}</div>
        </div>

        <div className="label" style={{marginBottom:'8px'}}>接著想做什麼？</div>
        <div className="grid-2" style={{marginBottom:'10px'}}>
          <button className="card" style={{padding:'14px', textAlign:'center', cursor:'pointer'}} onClick={() => {store.resetScan(); store.mSetTab('scan');}}>
            <div style={{fontSize:'26px'}}>📷</div>
            <div style={{fontSize:'12px', fontWeight:500, marginTop:'4px'}}>再掃一份</div>
          </button>
          <button className="card" style={{padding:'14px', textAlign:'center', cursor:'pointer'}} onClick={() => {store.resetScan(); store.mSetTab('history');}}>
            <div style={{fontSize:'26px'}}>🕒</div>
            <div style={{fontSize:'12px', fontWeight:500, marginTop:'4px'}}>看歷史</div>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── TOOLS LIST ────────────────────────────────────────────
function MTools(){
  const [, store] = window.useStore();
  const tools = [
    {id:'image', ic:'🖼️', label:'圖片工具', sub:'縮放 · 轉檔 · 壓縮 · 浮水印'},
    {id:'pdf', ic:'📕', label:'PDF 工具', sub:'合併 · 浮水印 · 加密'},
    {id:'convert', ic:'🔄', label:'文件轉檔', sub:'Word · PDF · Markdown'},
    {id:'gif', ic:'🎞️', label:'GIF 製作', sub:'圖片序列 → 動畫'},
    {id:'video', ic:'🎬', label:'影片工具', sub:'合併 · 轉 GIF · 壓縮'},
    {id:'rename', ic:'✏️', label:'批次改名', sub:'前後綴 · 取代 · 編號'},
  ];
  return (
    <>
      <MHeader title="工具箱" subt="輔助工具"/>
      <div className="m-body">
        <div className="col" style={{gap:'8px'}}>
          {tools.map(t => (
            <div key={t.id} className="card" style={{padding:'14px 16px', cursor:'pointer'}} onClick={() => store.mGoto('tool-' + t.id)}>
              <div className="row">
                <div style={{fontSize:'28px', width:'42px'}}>{t.ic}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:'14px', fontWeight:600}}>{t.label}</div>
                  <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'2px'}}>{t.sub}</div>
                </div>
                <div style={{fontSize:'18px', color:'var(--ink-4)'}}>›</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── HISTORY ──────────────────────────────────────────────
function MHistory(){
  const [state, store] = window.useStore();

  React.useEffect(() => { store.loadHistory(); }, []);

  return (
    <>
      <MHeader title="寄件歷史" subt={`${state.history.length} 筆紀錄`}/>
      <div className="m-body">
        {state.loadingHistory && <LoadingSpinner text="載入歷史紀錄..."/>}
        <div className="row" style={{gap:'6px', marginBottom:'12px', overflowX:'auto'}}>
          <span className="chip on">全部</span>
          {Object.entries(window.docTypes).slice(0,4).map(([k,t]) => (
            <span key={k} className="chip">{t.icon} {t.label}</span>
          ))}
        </div>
        {state.history.length === 0 && !state.loadingHistory && (
          <div style={{textAlign:'center', padding:'30px', color:'var(--ink-3)', fontSize:'13px'}}>尚無寄件紀錄</div>
        )}
        <div className="col" style={{gap:'8px'}}>
          {state.history.map(h => (
            <div key={h.id} className="card" style={{padding:'12px'}}>
              <div className="row between" style={{marginBottom:'6px'}}>
                <DocTypeBadge type={h.docType} confidence={h.confidence}/>
                <span style={{fontSize:'10px', color:'var(--ink-3)'}}>{h.sentAt}</span>
              </div>
              <div style={{fontSize:'13px', fontWeight:500, lineHeight:1.4}}>{h.subject}</div>
              <div className="row between" style={{marginTop:'6px'}}>
                <span style={{fontSize:'11px', color:'var(--ink-3)'}}>→ {h.recipient}</span>
                <span style={{fontSize:'10px', fontFamily:'var(--font-mono)', color:'var(--ink-3)'}}>{h.size}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── MORE / SETTINGS ──────────────────────────────────────
function MMore(){
  const [state, store] = window.useStore();
  const s = state.settings || {};
  const items = [
    {ic:'👥', label:'聯絡人', sub:'管理收件人與群組', go:'contacts'},
    {ic:'⚙', label:'設定', sub:'寄件人資料 · SMTP', go:'settings'},
    {ic:'📊', label:'統計', sub:'使用量與分析'},
    {ic:'❓', label:'說明'},
  ];
  return (
    <>
      <MHeader title="更多"/>
      <div className="m-body">
        <div className="card mint" style={{padding:'14px', marginBottom:'14px'}}>
          <div className="row">
            <div style={{width:'48px', height:'48px', borderRadius:'50%', background:'var(--mint-3)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-hand)', fontSize:'24px', fontWeight:700}}>
              {(s.name || '?').slice(-1)}
            </div>
            <div>
              <div style={{fontSize:'14px', fontWeight:600}}>{s.name || '未設定'}</div>
              <div style={{fontSize:'11px', color:'var(--ink-3)'}}>{s.title || ''} · {s.department || ''}</div>
              <div style={{fontSize:'10px', color:'var(--mint-4)', fontFamily:'var(--font-mono)'}}>{s.email || ''}</div>
            </div>
          </div>
        </div>
        <div className="col" style={{gap:'6px'}}>
          {items.map((x,i) => (
            <div key={i} className="card" style={{padding:'12px 14px', cursor: x.go ? 'pointer' : 'default'}} onClick={() => x.go && store.mGoto(x.go)}>
              <div className="row">
                <span style={{fontSize:'20px', width:'32px'}}>{x.ic}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:'13px', fontWeight:500}}>{x.label}</div>
                  {x.sub && <div style={{fontSize:'11px', color:'var(--ink-3)'}}>{x.sub}</div>}
                </div>
                <span style={{color:'var(--ink-4)'}}>›</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── CONTACTS ─────────────────────────────────────────────
function MContacts(){
  const [state, store] = window.useStore();
  const [showAdd, setShowAdd] = mUseState(false);

  React.useEffect(() => {
    store.loadContacts();
    store.loadGroups();
  }, []);

  const addNew = async (name, email, dept) => {
    await store.addContact({ name, email, dept });
    setShowAdd(false);
  };

  return (
    <>
      <MHeader title="聯絡人" back actions={<button className="pill primary" style={{fontSize:'12px'}} onClick={() => setShowAdd(!showAdd)}>＋ 新增</button>}/>
      <div className="m-body">
        {showAdd && <AddContactForm onSave={addNew} onCancel={() => setShowAdd(false)}/>}
        {state.loadingContacts && <LoadingSpinner text="載入中..."/>}
        <div className="label" style={{marginBottom:'6px'}}>群組 ({state.groups.length})</div>
        <div className="row" style={{gap:'6px', marginBottom:'14px', overflowX:'auto', paddingBottom:'4px'}}>
          {state.groups.map(g => (
            <div key={g.id} className="card" style={{flex:'0 0 auto', padding:'10px 12px'}}>
              <div style={{fontSize:'12px', fontWeight:600}}>📋 {g.name}</div>
              <div style={{fontSize:'10px', color:'var(--ink-3)'}}>{g.memberIds?.length || 0} 人</div>
            </div>
          ))}
          {state.groups.length === 0 && <div style={{fontSize:'12px', color:'var(--ink-3)'}}>尚無群組</div>}
        </div>
        <div className="label" style={{marginBottom:'6px'}}>所有聯絡人 ({state.contacts.length})</div>
        <div className="col" style={{gap:'6px'}}>
          {[...state.contacts].sort((a,b) => b.freq - a.freq).map(c => (
            <ContactTile key={c.id} contact={c} onClick={() => {}} onDelete={() => store.removeContact(c.id)} compact/>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────
function MSettings(){
  const [state, store] = window.useStore();
  const s = state.settings || {};
  const [form, setForm] = mUseState(null);

  React.useEffect(() => {
    store.loadSettings().then(() => {
      setForm({...state.settings});
    });
  }, []);

  const save = async () => {
    if (!form) return;
    await store.saveSettings(form);
  };

  if (!form) return (<><MHeader title="設定" back/><div className="m-body"><LoadingSpinner text="載入設定..."/></div></>);

  return (
    <>
      <MHeader title="設定" back/>
      <div className="m-body">
        <div className="label" style={{marginBottom:'6px'}}>寄件人資料</div>
        <div className="card" style={{padding:'12px', marginBottom:'12px'}}>
          <div className="field-label">姓名</div>
          <input className="input" value={form.name || ''} onChange={e => setForm({...form, name:e.target.value})} style={{marginBottom:'8px'}}/>
          <div className="field-label">職稱</div>
          <input className="input" value={form.title || ''} onChange={e => setForm({...form, title:e.target.value})} style={{marginBottom:'8px'}}/>
          <div className="field-label">Email</div>
          <input className="input" value={form.email || ''} onChange={e => setForm({...form, email:e.target.value})} style={{marginBottom:'8px'}}/>
          <div className="field-label">單位</div>
          <input className="input" value={form.department || ''} onChange={e => setForm({...form, department:e.target.value})} style={{marginBottom:'8px'}}/>
          <div className="field-label">組織</div>
          <input className="input" value={form.organization || ''} onChange={e => setForm({...form, organization:e.target.value})}/>
        </div>
        <button className="btn primary" style={{width:'100%'}} onClick={save}>💾 儲存設定</button>
      </div>
    </>
  );
}

// ─── TOOL: IMAGE ───────────────────────────────────────────
function MToolImage(){
  const [action, setAction] = mUseState('resize');
  const [files, setFiles] = mUseState([]);
  const [opts, setOpts] = mUseState({
    width:800, height:600, mode:'fit',
    format:'JPEG', quality:85,
    text:'CONFIDENTIAL', fontSize:36, opacity:80, position:'center', color:'#000000',
    direction:'vertical', gap:0, bg_color:'#ffffff', columns:0, normalize:true,
  });
  const actions = [
    {id:'resize',i:'📐',l:'縮放'},
    {id:'convert',i:'🔄',l:'轉檔'},
    {id:'compress',i:'📦',l:'壓縮'},
    {id:'watermark',i:'💧',l:'浮水印'},
    {id:'merge',i:'🧩',l:'拼接'},
  ];

  const singleFn = action === 'merge' ? null : (file) => {
    if(action==='resize') return window.API.imgResize(file, opts.width, opts.height, opts.mode, opts.format, opts.quality);
    if(action==='convert') return window.API.imgConvert(file, opts.format, opts.quality);
    if(action==='compress') return window.API.imgCompress(file, opts.quality, 0);
    if(action==='watermark') return window.API.imgWatermark(file, opts.text, opts.fontSize, opts.opacity, opts.position, opts.color);
  };
  const batchFn = (fs) => {
    if(action==='resize') return window.API.imgBatchResize(fs, opts.width, opts.height, opts.mode, opts.format, opts.quality);
    if(action==='convert') return window.API.imgBatchConvert(fs, opts.format, opts.quality);
    if(action==='compress') return window.API.imgBatchCompress(fs, opts.quality, 0);
    if(action==='watermark') return window.API.imgBatchWatermark(fs, opts.text, opts.fontSize, opts.opacity, opts.position, opts.color);
    if(action==='merge') return window.API.imgMerge(fs, {
      direction:opts.direction, gap:opts.gap, bg_color:opts.bg_color, align:'center',
      output_format:opts.format, quality:opts.quality,
      columns:opts.columns, normalize:opts.normalize,
    });
  };

  const isMerge = action === 'merge';
  const downloadUrl = isMerge
    ? (tid) => window.API.imgMergeDownload(tid, opts.format)
    : window.API.imgTaskDownload;
  const resultFilename = isMerge
    ? `merged.${(opts.format || 'JPEG').toLowerCase() === 'jpeg' ? 'jpg' : opts.format.toLowerCase()}`
    : `${action}_result`;

  return (
    <MToolShell title="圖片工具">
      <div className="row" style={{gap:'6px', marginBottom:'14px', overflowX:'auto', paddingBottom:'4px'}}>
        {actions.map(a => (
          <button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={() => setAction(a.id)} style={{flexShrink:0}}>{a.i} {a.l}</button>
        ))}
      </div>
      <UploadDropzone accept="image/*" multiple onFiles={(f) => setFiles([...files,...f])} icon="🖼️"
        label={isMerge ? '至少選 2 張要拼接的圖片' : '拖放或選擇圖片'}>
        <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'4px'}}>
          {isMerge ? '依清單順序排列 · JPG · PNG · WebP' : 'JPG · PNG · WebP · 最多 50 個'}
        </div>
      </UploadDropzone>
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_,j)=>j!==i))}/>
      {isMerge && files.length < 2 && (
        <div style={{marginTop:'8px', fontSize:'11px', color:'var(--warn)'}}>⚠ 拼接需要至少 2 張圖片</div>
      )}

      <div className="card fill" style={{padding:'14px', margin:'12px 0'}}>
        <div className="label" style={{marginBottom:'8px'}}>{actions.find(a=>a.id===action).l}設定</div>
        {action === 'resize' && (
          <div className="grid-2">
            <div><div className="field-label">寬度</div><input className="input" value={opts.width} onChange={e=>setOpts({...opts,width:+e.target.value})}/></div>
            <div><div className="field-label">高度</div><input className="input" value={opts.height} onChange={e=>setOpts({...opts,height:+e.target.value})}/></div>
          </div>
        )}
        {action === 'convert' && (<div><div className="field-label">輸出格式</div><div className="row" style={{gap:'4px'}}>{['PNG','JPG','WebP','BMP'].map(f=><button key={f} className={`chip ${opts.format===f?'on':''}`} onClick={()=>setOpts({...opts,format:f})}>{f}</button>)}</div></div>)}
        {action === 'compress' && (<div><div className="field-label">品質 {opts.quality}%</div><input type="range" className="slider" min="10" max="100" value={opts.quality} onChange={e=>setOpts({...opts,quality:+e.target.value})}/></div>)}
        {action === 'watermark' && (<><div className="field-label">文字</div><input className="input" value={opts.text} onChange={e=>setOpts({...opts,text:e.target.value})}/></>)}
        {action === 'merge' && (<>
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
            等比對齊（避免空隙）
          </label>
        </>)}
      </div>

      <ToolProcessor files={files} single={singleFn} batch={batchFn}
        taskProgressUrl={window.API.imgTaskProgress} taskDownloadUrl={downloadUrl}
        resultFilename={resultFilename}/>
    </MToolShell>
  );
}

function MToolShell({ title, children }){
  return (
    <>
      <MHeader title={title} back/>
      <div className="m-body">{children}</div>
    </>
  );
}

// ─── TOOL: PDF ─────────────────────────────────────────────
function MToolPdf(){
  const [action, setAction] = mUseState('merge');
  const [files, setFiles] = mUseState([]);
  const [opts, setOpts] = mUseState({text:'CONFIDENTIAL', password:''});
  const actions = [{id:'merge',i:'📎',l:'合併'},{id:'watermark',i:'💧',l:'浮水印'},{id:'protect',i:'🔒',l:'加密'}];

  const singleFn = action === 'watermark' ? (file) => window.API.pdfTextWatermark(file, opts.text, 48, 0.15, 45, 0, 0, 0)
    : action === 'protect' ? (file) => window.API.pdfProtect(file, opts.password)
    : null;
  const batchFn = action === 'merge' ? (fs) => window.API.pdfMerge(fs) : null;

  return (
    <MToolShell title="PDF 工具">
      <div className="row" style={{gap:'6px', marginBottom:'14px'}}>
        {actions.map(a => <button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={() => setAction(a.id)}>{a.i} {a.l}</button>)}
      </div>
      <UploadDropzone accept=".pdf" multiple={action==='merge'} onFiles={(f) => setFiles([...files,...f])} icon="📕" label="拖放 PDF 檔案"/>
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_,j)=>j!==i))}/>
      {action === 'watermark' && (<div style={{margin:'10px 0'}}><div className="field-label">浮水印文字</div><input className="input" value={opts.text} onChange={e=>setOpts({...opts,text:e.target.value})}/></div>)}
      {action === 'protect' && (<div style={{margin:'10px 0'}}><div className="field-label">密碼</div><input className="input" type="password" value={opts.password} onChange={e=>setOpts({...opts,password:e.target.value})}/></div>)}
      <ToolProcessor files={files} single={singleFn} batch={batchFn}
        taskProgressUrl={window.API.pdfTaskProgress} taskDownloadUrl={window.API.pdfTaskDownload}
        resultFilename={action==='merge'?'merged.pdf':action==='watermark'?'watermarked.pdf':'protected.pdf'}/>
    </MToolShell>
  );
}

// ─── TOOL: CONVERT ─────────────────────────────────────────
function MToolConvert(){
  const convs = [
    {f:'Word',t:'PDF',dir:'word-pdf',accept:'.docx,.doc'},
    {f:'PDF',t:'Word',dir:'pdf-word',accept:'.pdf'},
    {f:'MD',t:'PDF',dir:'md-pdf',accept:'.md,.markdown'},
    {f:'MD',t:'Word',dir:'md-word',accept:'.md,.markdown'},
    {f:'Word',t:'MD',dir:'word-md',accept:'.docx,.doc'},
  ];
  const [sel, setSel] = mUseState(0);
  const [files, setFiles] = mUseState([]);

  return (
    <MToolShell title="文件轉檔">
      <div className="label" style={{marginBottom:'6px'}}>選擇轉換方向</div>
      <div className="col" style={{gap:'6px', marginBottom:'14px'}}>
        {convs.map((c,i) => (
          <div key={i} onClick={() => {setSel(i); setFiles([]);}} className="card" style={{padding:'12px', cursor:'pointer', background:sel===i?'var(--mint-wash)':'var(--paper)', borderColor:sel===i?'var(--mint-3)':'var(--line-soft)'}}>
            <div className="row" style={{justifyContent:'center', gap:'14px'}}>
              <span className="hand" style={{fontSize:'22px', fontWeight:600}}>{c.f}</span>
              <span style={{color:'var(--mint-3)'}}>→</span>
              <span className="hand" style={{fontSize:'22px', fontWeight:600}}>{c.t}</span>
            </div>
          </div>
        ))}
      </div>
      <UploadDropzone accept={convs[sel].accept} onFiles={(f) => setFiles(f.slice(0,1))} icon="🔄" label={`上傳 ${convs[sel].f} 檔案`}/>
      <FileList files={files} onRemove={() => setFiles([])}/>
      <ToolProcessor files={files}
        single={(file) => window.API.docConvert(file, convs[sel].dir)}
        resultFilename={`converted`}/>
    </MToolShell>
  );
}

// ─── TOOL: GIF ─────────────────────────────────────────────
function MToolGif(){
  const [files, setFiles] = mUseState([]);
  const [opts, setOpts] = mUseState({duration:500, width:0});

  return (
    <MToolShell title="GIF 製作">
      <UploadDropzone accept="image/*" multiple onFiles={(f) => setFiles([...files,...f])} icon="🎞️" label="拖放多張圖片">
        <div style={{fontSize:'11px', color:'var(--ink-3)', marginTop:'4px'}}>依順序產生 GIF 動畫（至少 2 張）</div>
      </UploadDropzone>
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_,j)=>j!==i))}/>
      <div className="card fill" style={{padding:'14px', margin:'12px 0'}}>
        <div className="grid-2">
          <div><div className="field-label">每幀 ms</div><input className="input" value={opts.duration} onChange={e=>setOpts({...opts,duration:+e.target.value})}/></div>
          <div><div className="field-label">寬度 (0=auto)</div><input className="input" value={opts.width} onChange={e=>setOpts({...opts,width:+e.target.value})}/></div>
        </div>
      </div>
      <ToolProcessor files={files}
        batch={(fs) => window.API.gifCreate(fs, opts.duration, 0, opts.width, 0)}
        taskProgressUrl={window.API.gifTaskProgress} taskDownloadUrl={window.API.gifTaskDownload}
        resultFilename="animation.gif"/>
    </MToolShell>
  );
}

// ─── TOOL: VIDEO ───────────────────────────────────────────
function MToolVideo(){
  const [action, setAction] = mUseState('merge');
  const [files, setFiles] = mUseState([]);
  const [opts, setOpts] = mUseState({fps:10, crf:28});
  const actions = [{id:'merge',l:'合併'},{id:'to-gif',l:'轉GIF'},{id:'compress',l:'壓縮'}];

  const batchFn = action === 'merge' ? (fs) => window.API.vidMerge(fs, 'mp4') : null;
  const singleFn = action === 'to-gif' ? (f) => window.API.vidToGif(f, opts.fps, 0, 0, 0)
    : action === 'compress' ? (f) => window.API.vidCompress(f, '', opts.crf) : null;

  return (
    <MToolShell title="影片工具">
      <div className="row" style={{gap:'6px', marginBottom:'14px'}}>
        {actions.map(a => <button key={a.id} className={`chip ${action===a.id?'on':''}`} onClick={() => {setAction(a.id); setFiles([]);}}>{a.l}</button>)}
      </div>
      <UploadDropzone accept="video/*" multiple={action==='merge'} onFiles={(f) => setFiles([...files,...f])} icon="🎬" label="拖放影片檔案">
        <div style={{fontSize:'10px', color:'var(--ink-3)', marginTop:'2px'}}>MP4 · MOV · WebM (≤200MB)</div>
      </UploadDropzone>
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_,j)=>j!==i))}/>
      {action === 'compress' && (<div style={{margin:'10px 0'}}><div className="field-label">CRF (品質 {opts.crf})</div><input type="range" className="slider" min="18" max="40" value={opts.crf} onChange={e=>setOpts({...opts,crf:+e.target.value})}/></div>)}
      {action === 'to-gif' && (<div style={{margin:'10px 0'}}><div className="field-label">FPS</div><input className="input" value={opts.fps} onChange={e=>setOpts({...opts,fps:+e.target.value})}/></div>)}
      <ToolProcessor files={files} single={singleFn} batch={batchFn}
        taskProgressUrl={window.API.vidTaskProgress} taskDownloadUrl={window.API.vidTaskDownload}
        resultFilename={action==='to-gif'?'result.gif':'result.mp4'}/>
    </MToolShell>
  );
}

// ─── TOOL: RENAME ──────────────────────────────────────────
function MToolRename(){
  const [files, setFiles] = mUseState([]);
  const [opts, setOpts] = mUseState({prefix:'', suffix:'', find:'', replace:'', numbering:false, numbering_start:1, numbering_digits:3});
  const [preview, setPreview] = mUseState(null);

  const doPreview = async () => {
    if (!files.length) return;
    try {
      const r = await window.API.renamePreview(files.map(f=>f.name), opts);
      setPreview(r.results);
    } catch(e) { /* handled */ }
  };

  return (
    <MToolShell title="批次改名">
      <UploadDropzone accept="*" multiple onFiles={(f) => setFiles([...files,...f])} icon="📁" label="拖放任意檔案"/>
      <FileList files={files} onRemove={(i) => setFiles(files.filter((_,j)=>j!==i))}/>
      <div className="card fill" style={{padding:'14px', margin:'12px 0'}}>
        <div className="field-label">前綴</div>
        <input className="input" value={opts.prefix} onChange={e=>setOpts({...opts,prefix:e.target.value})} placeholder="例: 2026_" style={{marginBottom:'8px'}}/>
        <div className="field-label">尋找 → 取代</div>
        <div className="row" style={{gap:'6px', marginBottom:'8px'}}>
          <input className="input" value={opts.find} onChange={e=>setOpts({...opts,find:e.target.value})} placeholder="尋找" style={{flex:1}}/>
          <input className="input" value={opts.replace} onChange={e=>setOpts({...opts,replace:e.target.value})} placeholder="取代" style={{flex:1}}/>
        </div>
        <div className="row" style={{gap:'6px'}}>
          <label style={{fontSize:'12px'}}>
            <input type="checkbox" checked={opts.numbering} onChange={e=>setOpts({...opts,numbering:e.target.checked})}/> 流水編號
          </label>
        </div>
      </div>
      <button className="btn" onClick={doPreview} style={{width:'100%', marginBottom:'8px'}} disabled={!files.length}>👁 預覽改名結果</button>
      {preview && (
        <div className="card" style={{padding:'10px', marginBottom:'10px', maxHeight:'160px', overflow:'auto'}}>
          {preview.map((r,i) => (
            <div key={i} style={{fontSize:'11px', padding:'4px 0', borderBottom:'1px dashed var(--line-soft)'}}>
              <span style={{color:'var(--ink-3)'}}>{r.original}</span> → <span style={{fontWeight:500, color:'var(--mint-4)'}}>{r.new_name || r.renamed}</span>
            </div>
          ))}
        </div>
      )}
      <ToolProcessor files={files}
        batch={(fs) => window.API.renameApply(fs, opts)}
        taskProgressUrl={window.API.renTaskProgress} taskDownloadUrl={window.API.renTaskDownload}
        resultFilename="renamed.zip"/>
    </MToolShell>
  );
}

Object.assign(window, { MobileShell });
