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
 */
(function () {
  const STORAGE_KEY = 'sm_api_base';

  // 前端來自 APK 內建檔案 → 需要另外指定後端位址
  const bundled = window.SM_NATIVE === true;

  /** 補上 scheme、去掉結尾斜線；空字串代表「未設定」 */
  function normalize(raw) {
    let url = String(raw == null ? '' : raw).trim();
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url.replace(/\/+$/, '');
  }

  function readStored() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';   // 隱私模式下 localStorage 可能不可用
    }
  }

  // apiBase 在載入時就固定下來（改設定會重新載入頁面），
  // 因此 api.js 等模組可以安全地在載入時用它組出常數字串。
  const apiBase = bundled ? normalize(readStored() || window.SM_DEFAULT_API_BASE || '') : '';

  window.SM_CONFIG = {
    /** API 位址前綴。網頁版恆為 ''（同源） */
    apiBase: apiBase,

    /** 前端是否來自 APK 內建檔案 */
    bundled: bundled,

    /** 是否已經有可用的後端位址 */
    isConfigured: !bundled || !!apiBase,

    normalize: normalize,

    /** 組出完整 URL，例如 url('/api/upload') */
    url: function (path) {
      return apiBase + path;
    },

    /** 儲存新的後端位址，回傳正規化後的結果 */
    save: function (raw) {
      const url = normalize(raw);
      try {
        if (url) localStorage.setItem(STORAGE_KEY, url);
        else localStorage.removeItem(STORAGE_KEY);
      } catch (e) { /* 忽略 */ }
      return url;
    },

    clear: function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
    },
  };
})();
