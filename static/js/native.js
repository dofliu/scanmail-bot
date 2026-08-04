/**
 * ScanMail+ 原生橋接層（Android App）
 *
 * 網頁版載入這支檔案時，window.SMCap 不存在，所有函式都會走瀏覽器原本的路徑，
 * 行為與加入這層之前完全相同。只有在 APK 內執行時才會用到 Capacitor 外掛。
 *
 * 提供四件事：
 *   1. saveFile()      — 統一的「把處理結果存起來」入口。
 *                        瀏覽器用 <a download>；App 內寫入檔案後叫出系統分享，
 *                        因為 WebView 不支援 blob: 的下載。
 *   2. store           — 統一的「要留著的小資料存哪裡」入口。
 *                        瀏覽器用 localStorage；App 內用 Capacitor Preferences，
 *                        因為 WebView 的 localStorage 會跟著系統清快取一起被清掉。
 *   3. 伺服器設定畫面   — App 內建前端，必須先知道後端位址才能運作。
 *   4. 啟動初始化      — 收起啟動畫面、設定狀態列配色。
 */
(function () {
  const CAP = () => window.SMCap || null;

  // window.SMCap 只代表「橋接檔案有載入」；在桌面瀏覽器開同一份打包結果時
  // 它一樣存在，但外掛都是不能用的 web stub，所以要問 Capacitor 本人。
  function isNative() {
    const cap = CAP();
    try {
      return !!(cap && cap.Capacitor && cap.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function toast(msg, kind) {
    if (window.SMStore && typeof window.SMStore.toast === 'function') {
      window.SMStore.toast(msg, kind || 'ok');
    } else {
      console.log('[SMNative]', msg);
    }
  }

  // ══════════════════════════════════════════════
  //  檔案儲存
  // ══════════════════════════════════════════════

  /** 去掉路徑分隔字元，避免 filename 影響寫入位置 */
  function safeName(filename) {
    return String(filename || 'scanmail-download')
      .replace(/[\\/]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 120);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('讀取檔案內容失敗'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  function anchorDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  /**
   * 儲存產生的檔案。
   * 瀏覽器：觸發下載。
   * App：寫進裝置後叫出系統分享面板（可另存到「檔案」、雲端硬碟或直接傳給別人）。
   */
  async function saveFile(blob, filename) {
    const name = safeName(filename);

    if (!isNative()) {
      anchorDownload(blob, name);
      return { method: 'browser', filename: name };
    }

    const { Filesystem, Directory, Share } = CAP();
    const data = await blobToBase64(blob);
    const path = 'ScanMail/' + name;

    // Documents 在部分 Android 版本 / 廠商 ROM 上不可寫，逐一退回到一定能寫的 Cache
    const candidates = [Directory.Documents, Directory.External, Directory.Cache];
    let uri = null;
    let lastError = null;
    for (const directory of candidates) {
      try {
        const res = await Filesystem.writeFile({ path, data, directory, recursive: true });
        uri = res && res.uri;
        if (uri) break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!uri) throw lastError || new Error('無法寫入檔案');

    try {
      await Share.share({ title: name, text: name, files: [uri] });
    } catch (e) {
      // 使用者按取消也會走到這裡；檔案已經寫好了，不算失敗
      toast('已儲存：' + name, 'ok');
    }
    return { method: 'native', filename: name, uri };
  }

  /**
   * 一次儲存多個檔案（批次處理的結果）。
   * App 內把全部寫到裝置後只叫一次系統分享 —— 逐檔跳分享面板會很煩。
   * 瀏覽器則維持逐檔下載。
   */
  async function saveFiles(items) {
    const list = (items || []).filter((it) => it && it.blob);
    if (!list.length) return { method: 'none', count: 0 };
    if (list.length === 1) return saveFile(list[0].blob, list[0].filename);

    if (!isNative()) {
      for (const it of list) {
        anchorDownload(it.blob, safeName(it.filename));
        // 連續觸發下載時瀏覽器會擋掉後面的，稍微錯開
        await new Promise((r) => setTimeout(r, 150));
      }
      return { method: 'browser', count: list.length };
    }

    const { Filesystem, Directory, Share } = CAP();
    const uris = [];
    for (const it of list) {
      const name = safeName(it.filename);
      const data = await blobToBase64(it.blob);
      const path = 'ScanMail/' + name;
      for (const directory of [Directory.Documents, Directory.External, Directory.Cache]) {
        try {
          const res = await Filesystem.writeFile({ path, data, directory, recursive: true });
          if (res && res.uri) { uris.push(res.uri); break; }
        } catch (e) { /* 換下一個目錄 */ }
      }
    }
    if (!uris.length) throw new Error('無法寫入檔案');

    try {
      await Share.share({ title: `${uris.length} 個檔案`, files: uris });
    } catch (e) {
      toast(`已儲存 ${uris.length} 個檔案`, 'ok');
    }
    return { method: 'native', count: uris.length };
  }

  // ══════════════════════════════════════════════
  //  持久化小資料（簽名庫這種「要留著」的東西）
  // ══════════════════════════════════════════════

  /**
   * localStorage 在 App 裡不是可靠的儲存 —— Android 的「清除快取」、
   * 系統回收儲存空間、甚至部分 ROM 的省電清理，都會把 WebView 的資料一起清掉。
   * 使用者手寫好的簽名就這樣不見了，而且沒有任何提示。
   *
   * Capacitor Preferences 寫的是原生 SharedPreferences，只有解除安裝才會消失，
   * 所以 App 內以它為準；瀏覽器沒有這個外掛，照舊用 localStorage。
   *
   * 讀取一律「先原生、讀不到再退回 localStorage」——
   * 這樣舊版本 App 存在 localStorage 的資料在升級後還找得到（呼叫端負責搬過去）。
   */

  function prefs() {
    const cap = CAP();
    return isNative() && cap && cap.Preferences ? cap.Preferences : null;
  }

  /** App 內有沒有真的接上原生儲存。false 代表 localStorage 就是唯一的家。 */
  function isDurable() {
    return !!prefs();
  }

  function localGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;   // 隱私模式下可能整個不可用
    }
  }

  /**
   * 讀一個值。
   *
   * App 內只問 Preferences —— **不會**因為它沒有就去翻 localStorage。
   * 這個分別很重要：「原生儲存沒有這個 key」是呼叫端判斷「要不要把舊資料搬過去」
   * 的依據，偷偷退回 localStorage 的話就永遠搬不成，資料也永遠留在會被清掉的地方。
   * 只有外掛整個壞掉（丟例外）才退回 localStorage，免得功能直接不能用。
   *
   * @returns {Promise<string|null>} 沒存過回 null（跟 localStorage.getItem 一致）
   */
  async function storeGet(key) {
    const p = prefs();
    if (p) {
      try {
        const res = await p.get({ key });
        const value = res && res.value;
        return value === undefined ? null : value;
      } catch (e) {
        return localGet(key);
      }
    }
    return localGet(key);
  }

  /**
   * 寫一個值。
   * App：寫進 Preferences（失敗就往外丟，呼叫端才知道沒存成功），
   *      localStorage 只當鏡像，寫不進去（配額）不影響結果。
   * 瀏覽器：只有 localStorage，配額例外照樣往外丟。
   */
  async function storeSet(key, value) {
    const p = prefs();
    if (p) {
      await p.set({ key, value });
      try { localStorage.setItem(key, value); } catch (e) { /* 鏡像失敗不影響 */ }
      return { durable: true };
    }
    localStorage.setItem(key, value);
    return { durable: false };
  }

  /** 刪掉一個值（兩邊都刪，免得退回讀取時又把舊的撿回來） */
  async function storeRemove(key) {
    const p = prefs();
    if (p) {
      try { await p.remove({ key }); } catch (e) { /* 忽略 */ }
    }
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }

  // ══════════════════════════════════════════════
  //  伺服器設定畫面
  // ══════════════════════════════════════════════

  const OVERLAY_ID = 'sm-server-setup';

  function closeSetup() {
    const el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  /**
   * 顯示後端位址設定畫面。
   * @param {string} message 可選的說明文字（例如連線失敗的原因）
   */
  function openServerSetup(message) {
    if (document.getElementById(OVERLAY_ID)) return;

    const cfg = window.SM_CONFIG;
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:rgba(12,18,15,0.82)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:20px', 'box-sizing:border-box',
      'font-family:"Noto Sans TC",system-ui,-apple-system,sans-serif',
    ].join(';'));

    const card = document.createElement('div');
    card.setAttribute('style', [
      'background:#f6f4ec', 'color:#1f2a24',
      'border-radius:14px', 'padding:20px',
      'width:100%', 'max-width:380px',
      'box-shadow:0 12px 40px rgba(0,0,0,0.35)',
      'max-height:90vh', 'overflow:auto', 'box-sizing:border-box',
    ].join(';'));

    const inputStyle = [
      'width:100%', 'box-sizing:border-box', 'margin-top:10px',
      'padding:11px 12px', 'font-size:15px',
      'border:1px solid #c4beae', 'border-radius:8px',
      'background:#fff', 'color:#1f2a24',
    ].join(';');

    const btnStyle = (primary) => [
      'flex:1', 'padding:11px 12px', 'font-size:14px', 'font-weight:600',
      'border-radius:8px', 'cursor:pointer', 'border:1px solid #2d6b52',
      primary ? 'background:#2d6b52;color:#fff' : 'background:transparent;color:#2d6b52',
    ].join(';');

    card.innerHTML = [
      '<div style="font-size:17px;font-weight:700;margin-bottom:6px">連線到 ScanMail+ 伺服器</div>',
      '<div style="font-size:13px;line-height:1.6;color:#3d4b42">',
      '  App 只負責畫面，掃描、AI 辨識與寄信都在後端執行。',
      '  請輸入執行 ScanMail+ 的電腦或伺服器位址。',
      '</div>',
      '<div style="font-size:12px;line-height:1.6;color:#6b766e;margin-top:8px">',
      '  同一個 Wi-Fi 下通常是 <code>http://電腦IP:8000</code>，',
      '  例如 <code>http://192.168.1.50:8000</code>。',
      '</div>',
      '<input id="sm-server-input" type="url" inputmode="url" autocapitalize="off" autocorrect="off"',
      '       placeholder="http://192.168.1.50:8000" style="' + inputStyle + '">',
      '<div id="sm-server-msg" style="font-size:12.5px;line-height:1.6;margin-top:10px;min-height:18px"></div>',
      '<div style="display:flex;gap:8px;margin-top:12px">',
      '  <button id="sm-server-cancel" type="button" style="' + btnStyle(false) + '">取消</button>',
      '  <button id="sm-server-save" type="button" style="' + btnStyle(true) + '">測試並儲存</button>',
      '</div>',
    ].join('');

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = card.querySelector('#sm-server-input');
    const msgEl = card.querySelector('#sm-server-msg');
    const saveBtn = card.querySelector('#sm-server-save');
    const cancelBtn = card.querySelector('#sm-server-cancel');

    input.value = cfg.apiBase || '';
    if (message) {
      msgEl.textContent = message;
      msgEl.style.color = '#b25a4a';
    }
    // 還沒設定過就不給取消 — 沒有位址的話 App 什麼也做不了
    if (!cfg.apiBase) cancelBtn.style.display = 'none';

    cancelBtn.addEventListener('click', closeSetup);

    saveBtn.addEventListener('click', async () => {
      const url = cfg.normalize(input.value);
      if (!url) {
        msgEl.style.color = '#b25a4a';
        msgEl.textContent = '請輸入伺服器位址';
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '測試中…';
      msgEl.style.color = '#3d4b42';
      msgEl.textContent = '正在連線 ' + url + ' …';
      try {
        const res = await fetch(url + '/health', { method: 'GET' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data || data.status !== 'ok') throw new Error('回應不是 ScanMail+ 伺服器');
        msgEl.style.color = '#2d6b52';
        msgEl.textContent = '✓ 連線成功（' + (data.service || 'ScanMail+') + ' ' + (data.version || '') + '），重新載入中…';
        // 寫進原生儲存是非同步的，要等它落地再重新載入 —— 沒等的話重整後
        // 讀到的可能還是舊值（見 js/config.js 的 save()）
        await cfg.save(url);
        setTimeout(() => window.location.reload(), 600);
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = '測試並儲存';
        msgEl.style.color = '#b25a4a';
        msgEl.textContent = '連線失敗：' + (e && e.message ? e.message : e) +
          '。請確認伺服器已啟動、手機與電腦在同一網路，且 uvicorn 是用 --host 0.0.0.0 啟動。';
      }
    });

    input.focus();
  }

  // ══════════════════════════════════════════════
  //  啟動初始化
  // ══════════════════════════════════════════════

  async function init() {
    const cap = CAP();
    if (cap) {
      try {
        await cap.StatusBar.setStyle({ style: cap.Style.Dark });
        await cap.StatusBar.setBackgroundColor({ color: '#141c18' });
      } catch (e) { /* 部分裝置不支援，忽略 */ }
      try {
        await cap.SplashScreen.hide();
      } catch (e) { /* 忽略 */ }
    }
    // 先跟原生儲存對一次位址 —— 系統清過快取的話 localStorage 是空的，
    // 沒問過就直接跳設定畫面，會要使用者重打一次明明還存著的 IP。
    if (window.SM_CONFIG && typeof window.SM_CONFIG.ready === 'function') {
      try { await window.SM_CONFIG.ready(); } catch (e) { /* 問不到就照開機值走 */ }
    }
    // 內建前端但還沒設定後端位址 → 直接請使用者填
    if (window.SM_CONFIG && !window.SM_CONFIG.isConfigured) {
      openServerSetup();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SMNative = {
    isNative: isNative,
    saveFile: saveFile,
    saveFiles: saveFiles,
    store: {
      isDurable: isDurable,
      get: storeGet,
      set: storeSet,
      remove: storeRemove,
    },
    openServerSetup: openServerSetup,
    closeServerSetup: closeSetup,
  };
})();
