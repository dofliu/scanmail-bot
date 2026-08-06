/**
 * 伺服器位址的儲存與救援（static/js/config.js + native.js + api.js）。
 *
 * 要驗的核心是一件使用者看得到的事：**App 內清一次快取，位址不該不見。**
 * localStorage 在 WebView 裡是快取不是儲存，Android 的「清除快取」會把它清掉；
 * 位址真正的家是 Capacitor Preferences（原生 SharedPreferences）。
 *
 * 難處在載入順序 —— config.js 排在 native.js 之前、而且載入當下是同步讀取的，
 * 所以 Preferences 只能等 ready() 非同步補回來。這代表 apiBase 有可能在開機之後才改變，
 * 而 api.js 是在載入時就把位址組成字串的。這支測試因此**每個情境都真的載入一次頁面**，
 * 用一段 prelude 在 config.js 之前佈置好旗標 / localStorage / 假的 window.SMCap，
 * 讓載入順序跟 App 裡一模一樣 —— 順序錯了測試就會紅，這正是最容易寫錯的地方。
 *
 * 真的 Capacitor 只在 APK 裡跑得起來，所以 Preferences 用假的外掛模擬；
 * 驗的是 ScanMail+ 這一側的行為：讀誰的、寫去哪、舊資料搬不搬得過去、
 * 外掛壞掉時會不會整個不能用。
 *
 * 執行：cd mobile && npm run test:config
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'static');
const PORT = 8941;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// prelude 必須排在 config.js 之前 —— 它模擬的正是「App 啟動時環境已經長這樣」。
// 參數走查詢字串，這樣每個情境都是一次乾淨的載入，不會互相污染。
const HARNESS = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
<title>config harness</title></head><body>
<script>
(function () {
  const p = new URLSearchParams(location.search);
  try { localStorage.clear(); } catch (e) { /* 忽略 */ }
  if (p.get('local')) localStorage.setItem('sm_api_base', p.get('local'));
  if (p.get('native') === '1') window.SM_NATIVE = true;
  if (p.get('offline') === '1') window.SM_OFFLINE = true;
  if (p.get('default')) window.SM_DEFAULT_API_BASE = p.get('default');
  if (p.has('cap')) {
    const mem = {};
    if (p.get('prefs')) mem['sm_api_base'] = p.get('prefs');
    window.__prefs = mem;
    window.__prefReads = 0;
    window.SMCap = {
      Capacitor: { isNativePlatform: () => p.get('cap') === 'native' },
      Preferences: {
        get: async ({ key }) => {
          window.__prefReads++;
          if (p.get('failRead') === '1') throw new Error('外掛壞了');
          return { value: Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null };
        },
        set: async ({ key, value }) => {
          if (p.get('failWrite') === '1') throw new Error('寫不進去');
          mem[key] = value;
        },
        remove: async ({ key }) => {
          if (p.get('failWrite') === '1') throw new Error('刪不掉');
          delete mem[key];
        },
      },
    };
  }
})();
<\/script>
<script src="/js/config.js"><\/script>
<script src="/js/native.js"><\/script>
<script src="/js/api.js"><\/script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '/__harness.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(HARNESS);
    return;
  }
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const file = path.join(STATIC, url);
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${pass ? '' : ` — ${detail}`}`);
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

/**
 * 載入一次情境，並等到啟動流程（native.js 的 init → SM_CONFIG.ready）跑完。
 * 之後才量得到「位址救回來了沒有」「設定畫面跳了沒有」。
 */
async function load(query) {
  await page.goto(`http://localhost:${PORT}/?${query}`, { waitUntil: 'load' });
  await page.evaluate(() => window.SM_CONFIG.ready());
  // init() 是另一條 .then，ready() resolve 之後才輪到它決定要不要開設定畫面
  await page.waitForTimeout(120);
}

/** 量測目前的狀態 */
function snapshot() {
  return page.evaluate(() => ({
    apiBase: window.SM_CONFIG.apiBase,
    isConfigured: window.SM_CONFIG.isConfigured,
    url: window.SM_CONFIG.url('/api/upload'),
    local: localStorage.getItem('sm_api_base'),
    prefs: window.__prefs ? (window.__prefs['sm_api_base'] ?? null) : null,
    prefReads: window.__prefReads ?? 0,
    setupOpen: !!document.getElementById('sm-server-setup'),
    apiRoot: window.API._internals.currentBase(),
    imgBase: window.API._internals.toolBases().imgBase,
  }));
}

const SERVER = 'http://192.168.1.50:8000';
const OTHER = 'http://192.168.1.7:8000';

// ── 1) 網頁版：同源，完全不該碰到原生儲存 ──────────────────────
await load('cap=native');
let s = await snapshot();
check('網頁版：apiBase 是空字串（同源）', s.apiBase === '' && s.url === '/api/upload', JSON.stringify(s));
check('網頁版：isConfigured 直接為真，不會跳設定畫面',
  s.isConfigured === true && s.setupOpen === false, JSON.stringify(s));
check('網頁版：不去問原生儲存（沒有「要連到哪一台」的問題）',
  s.prefReads === 0, `讀了 ${s.prefReads} 次`);

// ── 2) 精簡離線版：沒有後端可連 ────────────────────────────────
await load(`native=1&offline=1&cap=native&prefs=${encodeURIComponent(SERVER)}`);
s = await snapshot();
check('離線版：apiBase 恆為空字串，就算原生儲存裡有位址也不套用',
  s.apiBase === '' && s.isConfigured === true, JSON.stringify(s));
check('離線版：不去問原生儲存', s.prefReads === 0, `讀了 ${s.prefReads} 次`);

// ── 3) 升級：舊版本的位址留在 localStorage，Preferences 還是空的 ──
await load(`native=1&cap=native&local=${encodeURIComponent(SERVER)}`);
s = await snapshot();
check('升級到會用原生儲存的版本：localStorage 的舊位址自動搬進 Preferences',
  s.prefs === SERVER, JSON.stringify(s));
check('搬家時位址本身不變，使用者無感', s.apiBase === SERVER, JSON.stringify(s));

// ── 4) 這次修的問題本體：清過快取，localStorage 空了 ─────────────
await load(`native=1&cap=native&prefs=${encodeURIComponent(OTHER)}`);
s = await snapshot();
check('清掉 localStorage 之後，位址從原生儲存救得回來',
  s.apiBase === OTHER, JSON.stringify(s));
check('救回來之後不會再跳出伺服器設定畫面（原本會要人重打一次 IP）',
  s.setupOpen === false && s.isConfigured === true, JSON.stringify(s));
check('救回來的位址順手補回 localStorage 鏡像', s.local === OTHER, JSON.stringify(s));
check('api.js 的位址跟著換（載入時組好的字串不能停在空字串上）',
  s.apiRoot === `${OTHER}/api`, s.apiRoot);
check('api.js 各工具前綴也一起換（imgBase 這種載入時就先組好的）',
  s.imgBase === `${OTHER}/api/tools/image`, s.imgBase);

// ── 5) 真的沒設定過就該跳設定畫面 —— 救援不能把這個也吞掉 ────────
await load('native=1&cap=native');
s = await snapshot();
check('兩邊都沒有位址：照樣跳出伺服器設定畫面',
  s.setupOpen === true && s.isConfigured === false, JSON.stringify(s));

// ── 6) 打包時預先填的位址仍然有效 ──────────────────────────────
await load(`native=1&cap=native&default=${encodeURIComponent(SERVER)}`);
s = await snapshot();
check('打包時用 SM_API_BASE 填的預設位址仍然生效',
  s.apiBase === SERVER && s.setupOpen === false, JSON.stringify(s));

// ── 7) 存檔：寫進原生儲存，而且立刻生效 ────────────────────────
await load('native=1&cap=native');
const saved = await page.evaluate(async () => {
  const url = await window.SM_CONFIG.save('192.168.1.50:8000');   // 故意不寫 scheme
  return { url, apiBase: window.SM_CONFIG.apiBase };
});
s = await snapshot();
check('存檔會補上 scheme 並正規化', saved.url === SERVER, saved.url);
check('存檔寫進 Preferences', s.prefs === SERVER, JSON.stringify(s));
check('存檔同時留一份 localStorage 鏡像', s.local === SERVER, JSON.stringify(s));
check('存完立刻生效：url() 與 api.js 都用新位址',
  s.url === `${SERVER}/api/upload` && s.imgBase === `${SERVER}/api/tools/image`,
  JSON.stringify(s));

// ── 8) 清掉位址 ───────────────────────────────────────────────
const cleared = await page.evaluate(async () => {
  await window.SM_CONFIG.clear();
  return {
    apiBase: window.SM_CONFIG.apiBase,
    isConfigured: window.SM_CONFIG.isConfigured,
    local: localStorage.getItem('sm_api_base'),
    prefs: window.__prefs['sm_api_base'] ?? null,
  };
});
check('清掉位址：原生儲存與 localStorage 都不留',
  cleared.prefs === null && cleared.local === null, JSON.stringify(cleared));
check('清掉位址：isConfigured 變回 false', cleared.isConfigured === false, JSON.stringify(cleared));

// ── 9) 外掛壞掉時不能整個不能用 ────────────────────────────────
await load(`native=1&cap=native&failRead=1&local=${encodeURIComponent(SERVER)}`);
s = await snapshot();
check('原生儲存讀不到（外掛壞了）：ready() 不會炸，退回開機時讀到的位址',
  s.apiBase === SERVER && s.setupOpen === false, JSON.stringify(s));

await load('native=1&cap=native&failWrite=1');
const failWrite = await page.evaluate(async () => {
  const url = await window.SM_CONFIG.save( 'http://192.168.1.50:8000');
  return { url, apiBase: window.SM_CONFIG.apiBase, local: localStorage.getItem('sm_api_base') };
});
check('原生儲存寫不進去：存檔照樣完成，至少退回 localStorage',
  failWrite.url === SERVER && failWrite.apiBase === SERVER && failWrite.local === SERVER,
  JSON.stringify(failWrite));

// ── 10) 桌面瀏覽器開同一份打包結果（SMCap 在，但外掛都是 web stub）──
await load(`native=1&cap=web&local=${encodeURIComponent(SERVER)}`);
s = await snapshot();
check('桌面瀏覽器開打包前端：不碰原生儲存，localStorage 就是唯一的家',
  s.prefReads === 0 && s.apiBase === SERVER, JSON.stringify(s));
const webSave = await page.evaluate(async () => {
  await window.SM_CONFIG.save(' http://192.168.1.7:8000/ ');   // 前後空白與結尾斜線
  return { local: localStorage.getItem('sm_api_base'), prefs: window.__prefs['sm_api_base'] ?? null };
});
check('桌面瀏覽器存檔只寫 localStorage，且去掉空白與結尾斜線',
  webSave.local === OTHER && webSave.prefs === null, JSON.stringify(webSave));

// ── 收尾 ────────────────────────────────────────────────
check('過程中沒有 JS 例外', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
