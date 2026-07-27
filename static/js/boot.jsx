/**
 * ScanMail+ 前端進入點
 *
 * 原本是 index.html 裡的 inline <script type="text/babel">，抽成獨立檔案有兩個原因：
 *   1. index.html 不再含 inline JSX，打包 Android App 時可以在建置階段用 esbuild
 *      把所有 .jsx 先轉成 JS，App 內就不必再載入 3MB 的 Babel standalone 即時編譯。
 *   2. Service Worker 可以快取它。
 *
 * 依賴 index.html 先設定好的 window.TWEAKS / window.APP_MODE。
 */
// 這些檔案都是全域 script，頂層 const 會互相衝突 —— 沿用 mobile.jsx / desktop.jsx
// 既有的做法，替 hook 取一個帶前綴的別名（atoms.jsx 已經用掉 useState/useEffect）。
const { useState: bUseState, useEffect: bUseEffect } = React;

function TweaksPanel({ open, onClose, tweaks, onChange }){
  if(!open) return null;
  return (
    <div className="tweakpanel" style={{width:'260px'}}>
      <div className="row between" style={{marginBottom:'6px'}}>
        <h4>Tweaks</h4>
        <button onClick={onClose} style={{fontSize:'16px', color:'var(--ink-3)'}}>×</button>
      </div>
      <div className="stroke dash soft" style={{marginBottom:'10px'}}/>

      <label>視圖
        <select value={tweaks.view} onChange={e => onChange({view: e.target.value})}>
          <option value="mobile">📱 僅手機</option>
          <option value="desktop">💻 僅桌面</option>
          <option value="both">📱💻 兩者並列</option>
        </select>
      </label>

      <label>主色
        <select value={tweaks.accent} onChange={e => onChange({accent: e.target.value})}>
          <option value="mint">薄荷綠 (預設)</option>
          <option value="sage">灰綠</option>
          <option value="teal">深青</option>
          <option value="terracotta">磚紅</option>
        </select>
      </label>

      <label>紙張底色
        <select value={tweaks.docBg} onChange={e => onChange({docBg: e.target.value})}>
          <option value="paper">米紙</option>
          <option value="warm">暖白</option>
          <option value="cool">冷白</option>
          <option value="gray">灰紙</option>
        </select>
      </label>

      <label>密度
        <select value={tweaks.density} onChange={e => onChange({density: e.target.value})}>
          <option value="tight">緊湊</option>
          <option value="default">預設</option>
          <option value="loose">寬鬆</option>
        </select>
      </label>

      <label>手寫標籤
        <input type="checkbox" checked={tweaks.showLabels} onChange={e => onChange({showLabels: e.target.checked})}/>
      </label>

      <div className="stroke dash soft" style={{margin:'10px 0'}}/>
      <div style={{fontSize:'10px', color:'var(--ink-3)', lineHeight:1.5}}>
        ScanMail+ v2.0 · Paper + Mint 設計系統 · Gemini AI · 繁中介面
      </div>
    </div>
  );
}

function applyTweaks(t){
  const root = document.documentElement;
  const isDark = root.dataset.theme === 'dark';

  // Ink & other dark-mode responsive properties
  if (isDark) {
    root.style.setProperty('--ink', '#f2f7f4');
    root.style.setProperty('--ink-2', '#d1ded7');
    root.style.setProperty('--ink-3', '#9fb0a6');
    root.style.setProperty('--ink-4', '#6b7e73');
    root.style.setProperty('--line', '#f2f7f4');
    root.style.setProperty('--line-soft', '#2d3d34');
    root.style.setProperty('--grid-color', 'rgba(255,255,255,0.015)');
    root.style.setProperty('--stage-top-bg', 'rgba(18,28,23,0.92)');
  } else {
    root.style.setProperty('--ink', '#1f2a24');
    root.style.setProperty('--ink-2', '#3d4b42');
    root.style.setProperty('--ink-3', '#6b766e');
    root.style.setProperty('--ink-4', '#9aa39b');
    root.style.setProperty('--line', '#1f2a24');
    root.style.setProperty('--line-soft', '#c4beae');
    root.style.setProperty('--grid-color', 'rgba(31,42,36,0.015)');
    root.style.setProperty('--stage-top-bg', 'rgba(246,244,236,0.92)');
  }

  // Accent colors
  const accentsLight = {
    mint:       { m:'#9fd5ba', m2:'#72c09a', m3:'#4ea07c', m4:'#2d6b52', wash:'#e6f2e9' },
    sage:       { m:'#b8c9a8', m2:'#8aa377', m3:'#6b8a5f', m4:'#3f5c3a', wash:'#edf1e5' },
    teal:       { m:'#8ecad0', m2:'#5ba9b2', m3:'#2d8590', m4:'#155862', wash:'#dcecee' },
    terracotta: { m:'#e6b8a4', m2:'#cf8e75', m3:'#b25a4a', m4:'#7d3a2e', wash:'#f4e3db' },
  };
  const accentsDark = {
    mint:       { m:'#2d6b52', m2:'#4ea07c', m3:'#72c09a', m4:'#9fd5ba', wash:'#1b3026' },
    sage:       { m:'#3d503f', m2:'#53634e', m3:'#8aa377', m4:'#b8c9a8', wash:'#1c271d' },
    teal:       { m:'#155862', m2:'#2d8590', m3:'#5ba9b2', m4:'#8ecad0', wash:'#172d31' },
    terracotta: { m:'#7d3a2e', m2:'#b25a4a', m3:'#cf8e75', m4:'#e6b8a4', wash:'#311e17' },
  };
  const a = (isDark ? accentsDark[t.accent] : accentsLight[t.accent]) || (isDark ? accentsDark.mint : accentsLight.mint);
  root.style.setProperty('--mint', a.m);
  root.style.setProperty('--mint-2', a.m2);
  root.style.setProperty('--mint-3', a.m3);
  root.style.setProperty('--mint-4', a.m4);
  root.style.setProperty('--mint-wash', a.wash);

  // Paper color
  const papersLight = {
    paper: ['#f6f4ec','#eeebdf'],
    warm:  ['#fdf9ee','#f6efdd'],
    cool:  ['#f2f4f1','#e6ebe6'],
    gray:  ['#eeece8','#e4e1d9'],
  };
  const papersDark = {
    paper: ['#121c17','#1b2620'],
    warm:  ['#1a1914','#24231b'],
    cool:  ['#111a1e','#192429'],
    gray:  ['#181a1b','#232527'],
  };
  const p = (isDark ? papersDark[t.docBg] : papersLight[t.docBg]) || (isDark ? papersDark.paper : papersLight.paper);
  root.style.setProperty('--paper', p[0]);
  root.style.setProperty('--paper-2', p[1]);

  root.dataset.density = t.density;
}
window.applyTweaks = applyTweaks;

// ── 原型/預覽模式 Stage（含切換 + Tweaks）─────────────
function PreviewStage(){
  const [tweaks, setTweaks] = bUseState(window.TWEAKS);
  const [tweaksOpen, setTweaksOpen] = bUseState(false);

  bUseEffect(() => { applyTweaks(tweaks); }, [tweaks]);

  bUseEffect(() => {
    const onMsg = (e) => {
      if(e.data?.type === '__activate_edit_mode') setTweaksOpen(true);
      if(e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', onMsg);
    try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch(e){}
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const update = (patch) => {
    const next = {...tweaks, ...patch};
    setTweaks(next);
    try { window.parent.postMessage({type:'__edit_mode_set_keys', edits: patch}, '*'); } catch(e){}
  };

  const view = tweaks.view;
  const showMobile = view === 'mobile' || view === 'both';
  const showDesktop = view === 'desktop' || view === 'both';

  return (
    <div className="stage-root">
      <div className="stage-top">
        <div className="stage-brand">
          <span className="mark">📷</span>
          <div>
            ScanMail<span style={{color:'var(--mint-3)'}}>+</span>
            <small>Hi-Fi 原型 · 掃描 → AI → 寄件</small>
          </div>
        </div>

        <div className="stage-seg" data-screen-label="view-switcher">
          <button className={view==='mobile'?'on':''} onClick={() => update({view:'mobile'})}>📱 手機</button>
          <button className={view==='desktop'?'on':''} onClick={() => update({view:'desktop'})}>💻 桌面</button>
          <button className={view==='both'?'on':''} onClick={() => update({view:'both'})}>📱💻 並列</button>
        </div>

        <div className="stage-tweaks">
          <button className="pill" onClick={() => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            localStorage.setItem('theme', next);
            if (window.SMStore) {
              window.SMStore.set({ theme: next });
            }
            applyTweaks(tweaks);
          }} style={{marginRight: '8px'}}>
            {document.documentElement.dataset.theme === 'dark' ? '☀️ 淺色' : '🌙 深色'}
          </button>
          <button className="pill" onClick={() => setTweaksOpen(o => !o)}>
            🎨 Tweaks {tweaksOpen ? '▴' : '▾'}
          </button>
        </div>
      </div>

      <div className="stage-body" style={{
        flexDirection: view === 'both' ? 'row' : 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: '24px',
        display:'flex',
        flexWrap:'wrap',
      }}>
        {showDesktop && <div data-screen-label="desktop"><window.DesktopShell/></div>}
        {showMobile && <div data-screen-label="mobile"><window.MobileShell/></div>}
      </div>

      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} tweaks={tweaks} onChange={update}/>
    </div>
  );
}

// ── Live 模式：依裝置直接渲染，並在視窗大小變化時重判 ──
// ── 離線精簡版：手機優先的媒體工具，不分桌面/手機兩套殼 ──
function OfflineApp(){
  bUseEffect(() => { applyTweaks(window.TWEAKS); }, []);
  return <window.Studio/>;
}

function LiveApp(){
  const [device, setDevice] = bUseState(window.APP_MODE.device);

  bUseEffect(() => { applyTweaks(window.TWEAKS); }, []);

  bUseEffect(() => {
    if (window.APP_MODE.forced) return; // forced 模式下不跟隨視窗改變
    const mq = window.matchMedia('(max-width: 980px)');
    const ua = navigator.userAgent || '';
    const mobileUA = /android|iphone|ipad|ipod|mobile|tablet|blackberry|iemobile|opera mini/i.test(ua);
    const onChange = () => setDevice((mobileUA || mq.matches) ? 'mobile' : 'desktop');
    // 新舊瀏覽器 API 兼容
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  return device === 'desktop' ? <window.DesktopShell/> : <window.MobileShell/>;
}

const Root = window.SM_CONFIG?.offlineOnly ? OfflineApp
  : window.APP_MODE.isPreview ? PreviewStage : LiveApp;
ReactDOM.createRoot(document.getElementById('root')).render(<Root/>);
