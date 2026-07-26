/**
 * Capacitor 設定 — ScanMail+ Android App
 *
 * 這份設定同時服務兩種情境：
 *
 *  1. 【開發】設定 CAP_SERVER_URL 後，App 直接載入電腦上的 FastAPI dev server，
 *     所以「電腦瀏覽器」和「手機 App」看到的是同一份即時的前端，改完存檔重整就好，
 *     不必重新打包 APK。
 *       CAP_SERVER_URL=http://192.168.1.50:8000 npm run sync
 *
 *  2. 【發佈】不設 CAP_SERVER_URL 時，前端由 www/（build_mobile.py 從 ../static 產生）
 *     打包進 APK，App 只用 HTTP 呼叫後端 API；API 位址由使用者在 App 內設定，
 *     或用 SM_API_BASE 在打包時預先填入。
 */
const config = {
  appId: 'tw.edu.ncut.doflab.scanmail',
  appName: 'ScanMail+',
  webDir: 'www',

  android: {
    // WebView 來源是 https://localhost，若後端跑在區網 http://192.168.x.x:8000，
    // 屬於 mixed content，預設會被擋掉。開發與校內部署都需要放行。
    allowMixedContent: true,
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: '#141c18',
    },
  },
};

// 開發模式：把 WebView 指到電腦上的 dev server
if (process.env.CAP_SERVER_URL) {
  const url = process.env.CAP_SERVER_URL.replace(/\/+$/, '');
  config.server = {
    url,
    cleartext: url.startsWith('http://'),
  };
}

module.exports = config;
