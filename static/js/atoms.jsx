/* Shared UI atoms — used across mobile + desktop */
const { useState, useEffect, useRef, useCallback } = React;

// ─── Paper Doc Placeholder ─────────────────────────────────────
function PaperDoc({ w = '75%', tint = 'paper', lines = 8, rotate = 0, children }){
  const bg = tint === 'mint' ? 'var(--mint-wash)' :
             tint === 'dark' ? '#2a342d' : '#fff';
  const col = tint === 'dark' ? 'rgba(255,255,255,0.3)' : 'var(--line-soft)';
  return (
    <div style={{
      width:w, aspectRatio:'0.72', background:bg,
      boxShadow:'0 3px 10px rgba(31,42,36,0.12)',
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

// ─── Page thumbnail (real or mock) ──────────────────────────────
function PageThumb({ page, active, onClick, onRemove, idx }){
  const hasThumb = page.thumb && page.thumb !== 'mock';
  const map = {
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
        <div style={{aspectRatio:'0.72', background:m.bg, padding:'6px', border:'1px solid #e0dcc8', transform:`rotate(${page.rotation}deg)`, transition:'transform 0.2s'}}>
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
  const url = React.useMemo(() => URL.createObjectURL(blob), [blob]);
  return (
    <div style={{display:'flex', alignItems:'center', gap:'12px', padding:'12px', background:'var(--mint-wash)', borderRadius:'10px', border:'1px solid var(--mint-3)'}}>
      <span style={{fontSize:'24px'}}>✅</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:600, fontSize:'14px'}}>處理完成</div>
        <div style={{fontSize:'12px', color:'var(--ink-3)'}}>{filename} ({window.API?.formatBytes(blob.size)})</div>
      </div>
      <a href={url} download={filename} className="btn primary" style={{flexShrink:0, textDecoration:'none'}}>⬇ 下載</a>
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
        const blob = await res.blob();
        setResultBlob(blob);
        setProgress(100); setMessage('完成！');
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

// ─── Expose ───────────────────────────────────────────────────
Object.assign(window, {
  PaperDoc, CropCorners, PageThumb, FilterStrip, DocTypeBadge,
  ContactTile, CameraView, Toasts,
  UploadDropzone, LoadingSpinner, ProgressBar, FileList, DownloadResult, ToolProcessor,
});
