/**
 * 即時取景 —— 相機預覽上疊一個會跟著文件走的邊框。
 *
 * 偵測本身 v3.14.0 就有了（scan-lite.js，單張 100–300ms），缺的一直是相機那一層：
 * 使用者得先拍一張、進編輯器、再按拉正，才知道剛剛那張到底歪不歪。
 * 這支把順序倒過來 —— **對準了才拍**。
 *
 * 三件事撐起這個模組：
 *
 *   1. **取流**：`getUserMedia` 要後鏡頭，拿不到就退回任何一顆（桌機 / 部分平板
 *      沒有 environment 鏡頭，整個開不起來比用前鏡頭更糟）；權限被拒則不重試。
 *   2. **偵測節流**：偵測是同步的、會擋住 UI 執行緒，所以**不是每幀都跑**。
 *      一次跑完才排下一次，兩次之間至少隔 INTERVAL —— 沒有這條，慢一點的手機會
 *      一路排隊到畫面卡死。取樣也先縮到 GRAB_WIDTH，不用 1080p 全解析度去掃。
 *   3. **平滑**：手持一定會抖，逐幀的框會跳。用 EMA 收斂，但**移動幅度大就直接跟上** ——
 *      平滑的代價是延遲，鏡頭真的移開時延遲比抖動更難看。
 *   4. **自動快門**：框連續幾次都沒怎麼動、而且信心夠，就自己按下去。
 *      量的是**平滑前**的 rawCorners —— 平滑後的角點本來就會趨近不動，
 *      拿它算穩定度等於在量自己的濾波器，不是在量手。
 *
 * 角點一律用**相對座標（0..1）**對外，跟取樣解析度、顯示尺寸都無關，
 * 呼叫端要畫在多大的畫面上都不必換算（studio.jsx 的疊框、拉正畫面都吃這個格式）。
 *
 * 離線版可用：完全在裝置上跑，不碰後端、不引外部資源。
 */
(function () {
  'use strict';

  const GRAB_WIDTH = 640;    // 偵測取樣寬度（detect 內部還會再縮到 480 工作解析度）
  const INTERVAL = 350;      // 兩次偵測之間至少間隔的毫秒數
  const SMOOTH = 0.45;       // EMA 係數：新的一次結果佔的比重
  const SNAP = 0.10;         // 角點平均位移超過畫面的 10% 就不平滑，直接跟上
  const READY_TIMEOUT = 4000;

  // ── 自動快門的兩個數字 ────────────────────────────────────
  // 手持的抖動疊上偵測本身的角點雜訊，兩者在這裡分不開，量到的是合起來的值。
  // 1.2% 是「一張 640 寬的取樣上，四個角平均動不到 8px」，
  // **這是估的，不是量出來的** —— 合成串流完全不會抖（位移恆為 0），
  // 在它上面調不出有意義的門檻。所以取景畫面會把當下的位移百分比顯示出來，
  // 拿真機手持看幾秒就知道實際範圍落在哪，再回來改這兩個數字。
  const STEADY_MOVE = 0.012;   // 角點平均位移低於畫面的這個比例，算「這一次沒動」
  const STEADY_HITS = 3;       // 連續這麼多次沒動才按快門（× INTERVAL ≈ 1 秒）

  /** 相機錯誤的原名對使用者沒有意義，換成「接下來能做什麼」 */
  const CAMERA_ERRORS = {
    NotAllowedError: '相機權限被拒絕 —— 請到系統設定裡允許這個 App 使用相機',
    PermissionDeniedError: '相機權限被拒絕 —— 請到系統設定裡允許這個 App 使用相機',
    SecurityError: '這個網頁沒有相機權限（需要 HTTPS 或 App 版）',
    NotFoundError: '這台裝置找不到相機 —— 請改用「加圖」選現成的照片',
    DevicesNotFoundError: '這台裝置找不到相機 —— 請改用「加圖」選現成的照片',
    NotReadableError: '相機被其他 App 佔用了 —— 關掉它再試一次',
    TrackStartError: '相機被其他 App 佔用了 —— 關掉它再試一次',
    OverconstrainedError: '這台相機不支援要求的規格 —— 請改用「加圖」選現成的照片',
    AbortError: '相機啟動被中斷 —— 請再試一次',
  };

  function cameraMessage(err) {
    const name = err && err.name;
    return CAMERA_ERRORS[name] || `相機開不起來：${(err && err.message) || err || '未知錯誤'}`;
  }

  /** 保留原始 name（呼叫端要分辨「被拒絕」跟「沒有相機」時用得到） */
  function friendly(err) {
    const wrapped = new Error(cameraMessage(err));
    wrapped.cameraError = (err && err.name) || 'UnknownError';
    return wrapped;
  }

  function isSupported() {
    return !!(typeof navigator !== 'undefined'
      && navigator.mediaDevices
      && navigator.mediaDevices.getUserMedia
      && window.SMScanLite);
  }

  async function openStream(opts = {}) {
    if (!isSupported()) throw friendly({ name: 'NotFoundError' });
    const facing = opts.facingMode || 'environment';
    const want = {
      video: {
        // ideal 而不是 exact —— exact 在沒有後鏡頭的裝置上直接失敗，
        // 而「用前鏡頭掃描」雖然難用，仍然好過完全開不起來
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    try {
      return await navigator.mediaDevices.getUserMedia(want);
    } catch (err) {
      // 權限是使用者的決定，換個條件再問一次只會再被拒一次
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        || err.name === 'SecurityError')) throw friendly(err);
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        throw friendly(err2);
      }
    }
  }

  /** 等到 video 真的有畫面可以讀；逾時就放行，讓偵測迴圈自己去等 */
  function waitForFrame(video, timeout = READY_TIMEOUT) {
    if (video.readyState >= 2 && video.videoWidth) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        video.removeEventListener('loadeddata', onData);
        clearTimeout(timer);
        resolve(ok);
      };
      const onData = () => finish(true);
      video.addEventListener('loadeddata', onData);
      const timer = setTimeout(() => finish(false), timeout);
    });
  }

  /**
   * 把 video 目前這一張畫到（重複使用的）canvas 上，等比縮到 width。
   * 每次都 new 一塊 canvas 的話，一秒三次的迴圈會一直讓 GC 有事做。
   */
  function grabFrame(video, canvas, width) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const w = Math.max(1, Math.min(width, vw));
    const h = Math.max(1, Math.round(w * vh / vw));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return { canvas, width: w, height: h, sourceWidth: vw, sourceHeight: vh };
  }

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /** 偵測結果（取樣畫面的像素座標）→ 相對座標 */
  function relCorners(corners, width, height) {
    return corners.map((p) => ({ x: clamp01(p.x / width), y: clamp01(p.y / height) }));
  }

  /**
   * 兩次偵測之間的收斂。
   *
   * @param snap 平均位移超過這個值（相對單位）就不平滑 —— 鏡頭是真的移開了，
   *             這時候慢慢跟過去只會看起來像框黏住了
   */
  function smoothCorners(prev, next, alpha = SMOOTH, snap = SNAP) {
    if (!prev || prev.length !== 4 || !next || next.length !== 4) return next;
    let moved = 0;
    for (let i = 0; i < 4; i++) moved += Math.hypot(next[i].x - prev[i].x, next[i].y - prev[i].y);
    if (moved / 4 > snap) return next;
    return next.map((p, i) => ({
      x: prev[i].x + (p.x - prev[i].x) * alpha,
      y: prev[i].y + (p.y - prev[i].y) * alpha,
    }));
  }

  /**
   * 兩次偵測之間的平均角點位移（相對單位）。自動快門就是看這個數字。
   *
   * 沒有上一次時回 `null` 而不是 0 —— 「還不知道」跟「完全沒動」是兩件事，
   * 回 0 的話第一次偵測就會被算成一次「穩定」，等於白白少數一拍。
   */
  function cornerMotion(prev, next) {
    if (!prev || prev.length !== 4 || !next || next.length !== 4) return null;
    let moved = 0;
    for (let i = 0; i < 4; i++) moved += Math.hypot(next[i].x - prev[i].x, next[i].y - prev[i].y);
    return moved / 4;
  }

  /** 對一張畫布跑偵測，回傳相對座標的結果 */
  function detectOn(source, width, height) {
    const res = window.SMScanLite.detect(source);
    return {
      corners: relCorners(res.corners, width, height),
      confidence: res.confidence,
      method: res.method,
      hints: res.hints || [],
      quality: res.quality || null,
      low: res.confidence < (window.SMScanLite.MIN_CONFIDENCE ?? 0.45),
    };
  }

  /**
   * 開始取景。
   *
   * @param {HTMLVideoElement} video 顯示用的 video 元素（呼叫端自己放進畫面）
   * @param {object} opts onResult / onError / interval / grabWidth / smooth /
   *                     facingMode / stream（測試用：直接給一條現成的串流）/
   *                     auto（自動快門，預設關）/ onAuto / steadyMove / steadyHits
   * @returns {Promise<object>} session：`stop()` / `capture()` / `latest()` / `setAuto()`
   */
  async function start(video, opts = {}) {
    if (!video) throw new Error('要有一個 <video> 元素才能取景');
    if (!window.SMScanLite) throw new Error('偵測引擎沒載入（缺 scan-lite.js）');

    const stream = opts.stream || await openStream(opts);
    const interval = opts.interval || INTERVAL;
    const grabWidth = opts.grabWidth || GRAB_WIDTH;
    const alpha = opts.smooth == null ? SMOOTH : opts.smooth;
    const onResult = typeof opts.onResult === 'function' ? opts.onResult : null;
    const onError = typeof opts.onError === 'function' ? opts.onError : null;
    const onAuto = typeof opts.onAuto === 'function' ? opts.onAuto : null;
    const steadyMove = opts.steadyMove == null ? STEADY_MOVE : opts.steadyMove;
    const steadyHits = Math.max(1, opts.steadyHits == null ? STEADY_HITS : opts.steadyHits);

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');   // iOS Safari 沒有這個屬性會強制全螢幕播放
    try {
      await video.play();
    } catch (e) {
      // 少數瀏覽器的自動播放限制要使用者手勢。串流仍在，畫面通常照樣更新，
      // 所以不當成失敗；真的沒畫面時偵測迴圈會自己跳過
    }
    await waitForFrame(video);

    const grab = document.createElement('canvas');
    let timer = null;
    let stopped = false;
    let latest = null;
    let smoothed = null;
    let prevRaw = null;
    let steady = 0;
    let frames = 0;
    let errors = 0;
    let auto = !!opts.auto;
    let firing = false;   // 自動快門正在跑，別再排第二張

    /**
     * 這一次偵測算不算「沒動」。
     *
     * 抓不準的時候一律歸零 —— 沒把握的框本來就會飄，
     * 它「連續三次都在同一個地方」多半是連續三次都抓錯同一個東西。
     */
    const updateSteady = (res, motion) => {
      if (res.low || motion == null || motion > steadyMove) steady = 0;
      else steady += 1;
    };

    /** 框穩了就自己按下去。拍完就解除，一次取景只會自動拍一張 */
    const maybeAutoShoot = () => {
      if (!auto || firing || stopped || steady < steadyHits) return;
      firing = true;
      auto = false;
      capture().then((shot) => {
        if (stopped) return;
        if (onAuto) onAuto({ ...shot, auto: true });
      }).catch((e) => {
        // 自動快門失敗就退回手動 —— 使用者還在取景畫面上，按鈕仍然按得到
        steady = 0;
        if (onError) onError(e);
      }).then(() => { firing = false; });
    };

    const tick = () => {
      timer = null;
      if (stopped) return;
      const t0 = Date.now();
      try {
        const shot = video.readyState >= 2 ? grabFrame(video, grab, grabWidth) : null;
        if (shot) {
          const res = detectOn(shot.canvas, shot.width, shot.height);
          const motion = cornerMotion(prevRaw, res.corners);
          prevRaw = res.corners;
          updateSteady(res, motion);
          smoothed = smoothCorners(smoothed, res.corners, alpha, SNAP);
          frames += 1;
          latest = {
            ...res,
            corners: smoothed,
            rawCorners: res.corners,
            frame: { width: shot.sourceWidth, height: shot.sourceHeight },
            motion,
            steady,
            steadyHits,
            stable: steady >= steadyHits,
            auto,
            ms: Date.now() - t0,
            at: t0,
          };
          if (onResult) onResult(latest);
          maybeAutoShoot();
        }
      } catch (e) {
        errors += 1;
        // 偵測失敗不該讓取景整個停掉 —— 下一幀很可能就好了。
        // 但也不能每 350ms 對呼叫端喊一次，所以只報第一次，其餘記在 errors 裡
        if (errors === 1 && onError) onError(e);
      }
      if (stopped) return;
      timer = setTimeout(tick, Math.max(0, interval - (Date.now() - t0)));
    };

    timer = setTimeout(tick, 0);

    /**
     * 按下快門：留下**全解析度**的這一張。
     *
     * 預設會對這張重新偵測一次。取景時的結果是「上一張」的，手持之下兩張不會一樣；
     * 多花一次 100–300ms 換來的是「拉正畫面看到的框，就是這張照片本身的框」，
     * 呼叫端不必去猜那個框還能不能信。
     */
    async function capture(o = {}) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) throw new Error('相機還沒送出畫面，請稍等一下再拍');
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      const ctx = full.getContext('2d');
      if (!ctx) throw new Error('這台裝置拿不到畫布，無法拍照');
      ctx.drawImage(video, 0, 0, w, h);

      let det = null;
      if (o.detect !== false) {
        try {
          det = detectOn(full, w, h);
        } catch (e) {
          det = null;   // 偵測失敗不影響照片本身，拉正畫面會自己重測一次
        }
      }

      const type = o.type || 'image/jpeg';
      const blob = await new Promise((resolve, reject) => {
        full.toBlob((b) => (b ? resolve(b) : reject(new Error('這台裝置無法輸出照片'))),
          type, o.quality == null ? 0.92 : o.quality);
      });
      const name = o.name || `scan-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.jpg`;
      const file = typeof File === 'function'
        ? new File([blob], name, { type })
        : Object.assign(blob, { name });
      return {
        canvas: full, blob, file, name, width: w, height: h,
        corners: det ? det.corners : null,
        confidence: det ? det.confidence : null,
        hints: det ? det.hints : [],
        low: det ? det.low : null,
      };
    }

    /** 開 / 關自動快門。關掉的同時把計數歸零，重開才不會沿用剛剛那幾次 */
    function setAuto(on) {
      auto = !!on;
      steady = 0;
      return auto;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      auto = false;
      if (timer) clearTimeout(timer);
      timer = null;
      // 不關掉軌道的話，相機燈會一直亮著、電也一直吃 —— session 接手了這條串流就要負責收
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* 已經停掉了 */ }
      try { video.srcObject = null; } catch (e) { /* 元素已經被移除 */ }
    }

    return {
      video,
      stream,
      capture,
      stop,
      setAuto,
      latest: () => latest,
      get running() { return !stopped; },
      get frames() { return frames; },
      get errors() { return errors; },
      get auto() { return auto; },
      get steady() { return steady; },
      get steadyHits() { return steadyHits; },
    };
  }

  window.SMScanLive = {
    GRAB_WIDTH, INTERVAL, SMOOTH, SNAP, STEADY_MOVE, STEADY_HITS, CAMERA_ERRORS,
    isSupported, start,
    // 測試用
    _internals: {
      openStream, waitForFrame, grabFrame, smoothCorners, cornerMotion,
      relCorners, detectOn, cameraMessage,
    },
  };
})();
