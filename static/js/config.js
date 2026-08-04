/**
 * ScanMail+ 執行環境設定
 *
 * 必須在 api.js 之前載入。
 *
 * 同一份前端會在兩種情境下執行：
 *
 *  1. 【網頁版】由 FastAPI 直接提供（http://localhost:8000）。
 *     前端與 API 同源，apiBase 是空字串，所有請求維持 `/api/...` 相對路徑。
 *
 *  2. 【Android App】前端被打包進 APK，WebView 的來源是 https://localhost，
 *     和後端不同源，因此必須知道後端的絕對位址（例如 http://192.168.1.50:8000）。
 *     位址來源依序為：使用者在 App 內設定的值 → 打包時用 SM_API_BASE 預先填入的值。
 *
 * 判斷依據是 window.SM_NATIVE — 只有 scripts/build_mobile.py 在打包 APK 用的
 * index.html 才會注入這個旗標。用「前端從哪裡載入」而不是「是否為 Capacitor」來判斷，
 * 是因為開發時 App 也可能直接載入電腦上的 dev server（CAP_SERVER_URL），
 * 那種情況下前端與 API 仍然同源，不需要、也不該套用另一組位址。
 *
 * ── 位址存在哪裡 ────────────────────────────────────────────
 *
 * App 內的 localStorage 不是儲存、是快取：Android 的「清除快取」、系統回收空間、
 * 部分 ROM 的省電清理都會把它清掉。使用者只是清了一次快取，App 就忘記伺服器位址、
 * 跳回設定畫面要人重打一次 IP —— 跟簽名庫在 v3.17.0 修掉的是同一個問題。
 * 所以位址改以 Capacitor Preferences 為準（window.SMNative.store，見 native.js）。
 *
 * 麻煩的是**載入順序**：這支檔案排在 native.js 之前，而 Preferences 是非同步的，
 * 載入的當下問不到。因此分成兩段：
 *
 *   開機（同步）  —— 照舊讀 localStorage。App 內它是原生儲存的鏡像，絕大多數時候
 *                   兩邊一樣，所以 apiBase 一載入就有值，api.js 那些模組不受影響。
 *   ready()（非同步）—— native.js 啟動時 await 它，跟原生儲存對一次答案：鏡像被清掉了
 *                   就把位址救回來、原生儲存還沒有就把舊位址搬過去。
 *
 * 位址因此有可能在 ready() 之後才改變（就是「清快取後救回來」那一次），
 * 載入時抄走 apiBase 的模組要用 onApiBaseChange() 跟著更新，不能當它是常數。
 */
(function () {
  const STORAGE_KEY = 'sm_api_base';

  /** 補上 scheme、去掉結尾斜線；空字串代表「未設定」 */
  function normalize(raw) {
    let url = String(raw == null ? '' : raw).trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url.replace(/\/+$/, '');
  }

  function readLocal() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';   // 隱私模式下 localStorage 可能不可用
    }
  }

  function writeLocal(url) {
    try {
      if (url) localStorage.setItem(STORAGE_KEY, url);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /** 有接上原生儲存（真的在 App 裡跑）就回傳它，其餘情況回 null */
  function durable() {
    const n = window.SMNative;
    return n && n.store && n.store.isDurable() ? n.store : null;
  }

  function boot() {
    // 前端來自 APK 內建檔案 → 需要另外指定後端位址
    const bundled = window.SM_NATIVE === true;

    // 精簡離線版（build_mobile.py --offline）：只保留在裝置上就能做完的功能，
    // 完全不需要後端，因此也不會出現伺服器設定畫面。
    const offlineOnly = window.SM_OFFLINE === true;

    let apiBase = offlineOnly
      ? ''
      : (bundled ? normalize(readLocal() || window.SM_DEFAULT_API_BASE || '') : '');

    let hydrating = null;          // ready() 的記憶化 promise
    const listeners = [];

    function setBase(url) {
      if (url === apiBase) return false;
      apiBase = url;
      cfg.apiBase = url;
      cfg.isConfigured = offlineOnly || !bundled || !!url;
      for (const fn of listeners.slice()) {
        try { fn(url); } catch (e) { /* 一個訂閱者壞掉不該拖垮其他人 */ }
      }
      return true;
    }

    async function hydrate_() {
      // 網頁版與離線版沒有「要連到哪一台」的問題，不必碰儲存
      if (!bundled || offlineOnly) return;
      const store = durable();
      if (!store) return;

      let raw;
      try {
        raw = await store.get(STORAGE_KEY);
      } catch (e) {
        return;   // 外掛壞了 —— 開機時讀到的 localStorage 值就是現在最好的答案
      }

      if (raw !== null && raw !== undefined) {
        // 原生儲存說了算。清過快取的話 localStorage 是空的，位址就是在這裡救回來的。
        const url = normalize(raw);
        writeLocal(url);
        setBase(url);
        return;
      }

      // 原生儲存沒有這個 key = 升級到會用 Preferences 的版本之後第一次執行，
      // 把舊版本留在 localStorage 的位址搬過去（只會發生一次）。
      // native.js 的 get() 在 App 內只問 Preferences、不偷偷退回 localStorage，
      // 「沒有這個 key」正是要不要搬家的判斷依據 —— 退回去讀就永遠搬不成。
      if (apiBase) {
        try { await store.set(STORAGE_KEY, apiBase); } catch (e) { /* 下次存檔會再試 */ }
      }
    }

    /**
     * 跟原生儲存對一次答案。App 內由 native.js 在啟動時 await；
     * 網頁版與離線版沒事可做，直接 resolve。呼叫幾次都只做一次。
     *
     * @returns {Promise<string>} 對完之後的 apiBase
     */
    function ready() {
      if (!hydrating) hydrating = hydrate_();
      return hydrating.then(() => apiBase);
    }

    /**
     * 訂閱位址變化。載入時抄走 apiBase 的模組要接這個 —— 位址可能在 ready()
     * 把它從原生儲存救回來時才出現。回傳取消訂閱的函式。
     */
    function onApiBaseChange(fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    /**
     * 儲存新的後端位址。
     * App：寫進 Preferences（native.js 會順手同步一份 localStorage 鏡像）。
     * 其他：只有 localStorage。
     * 原生寫入失敗時退回 localStorage —— 存得不夠久，但至少這次設定沒有白費。
     *
     * @returns {Promise<string>} 正規化後的位址
     */
    async function save(raw) {
      const url = normalize(raw);
      const store = durable();
      if (store) {
        try {
          if (url) await store.set(STORAGE_KEY, url);
          else await store.remove(STORAGE_KEY);
        } catch (e) {
          writeLocal(url);
        }
      } else {
        writeLocal(url);
      }
      setBase(url);
      return url;
    }

    function clear() {
      return save('');
    }

    const cfg = {
      /** API 位址前綴。網頁版恆為 ''（同源） */
      apiBase: apiBase,

      /** 前端是否來自 APK 內建檔案 */
      bundled: bundled,

      /** 精簡離線版：所有功能都在裝置上完成，沒有後端 */
      offlineOnly: offlineOnly,

      /** 是否已經有可用的後端位址。App 內要 ready() 之後才是最終答案 */
      isConfigured: offlineOnly || !bundled || !!apiBase,

      normalize: normalize,

      /** 組出完整 URL，例如 url('/api/upload') */
      url: function (path) {
        return apiBase + path;
      },

      ready: ready,
      onApiBaseChange: onApiBaseChange,
      save: save,
      clear: clear,

      // 測試用：換一組 window.SMCap 或旗標之後重新開機
      _internals: { KEY: STORAGE_KEY, boot: boot },
    };

    window.SM_CONFIG = cfg;
    return cfg;
  }

  boot();
})();
