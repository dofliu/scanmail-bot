/* Global state + helpers — connected to real backend API */
(function(){
  const docTypes = {
    official: { label:'公文', icon:'📋', color:'#4ea07c' },
    receipt:  { label:'收據', icon:'🧾', color:'#c48a3a' },
    report:   { label:'報告', icon:'📊', color:'#6b8aa3' },
    contract: { label:'合約', icon:'📜', color:'#b25a4a' },
    letter:   { label:'信函', icon:'✉️', color:'#8aa377' },
    exam:     { label:'考卷', icon:'📝', color:'#a5828f' },
    form:     { label:'表單', icon:'📑', color:'#7d7a95' },
    other:    { label:'其他', icon:'📎', color:'#6b766e' },
  };

  const filters = [
    { id:'auto',      label:'自動',    icon:'🪄' },
    { id:'scan',      label:'專業掃描', icon:'🖨' },
    { id:'color_doc', label:'彩色公文', icon:'🔴' },
    { id:'document',  label:'文件',    icon:'📄' },
    { id:'enhance',   label:'增強',    icon:'🔆' },
    { id:'bw',        label:'黑白',    icon:'◼' },
    { id:'original',  label:'原圖',    icon:'🖼' },
  ];

  // Store
  const listeners = new Set();
  const state = {
    view: 'mobile',
    density: 'default',
    tweaksOpen: false,

    // Mobile nav
    mTab: 'home',
    mStack: [],
    // Desktop nav
    dTool: 'scanmail',
    dSubTool: null,
    dView: 'dashboard',

    // Scan flow
    scanStep: 0,
    pages: [],
    currentPageId: null,
    selectedFilter: 'auto',
    selectedContactIds: [],
    aiResult: null,
    aiLoading: false,
    editingPreview: false,
    // Real scan data
    uploadedFile: null,         // File object from input
    scanImageBase64: null,      // base64 of scanned/processed image
    scanOriginalDataUrl: null,  // data URL of original upload
    detectedCorners: null,      // from API edge detection
    imageWidth: 0,
    imageHeight: 0,

    // Data from API
    contacts: [],
    groups: [],
    history: [],
    settings: {},
    stats: {},

    // Loading states
    loadingContacts: false,
    loadingHistory: false,
    loadingSettings: false,
    apiError: null,

    // Batch tools
    imgFiles: [],
    pdfFiles: [],
    docFiles: [],

    toasts: [],
    docTypes, filters,
  };

  let nextId = 100;

  function notify() {
    listeners.forEach(fn => fn(state));
  }

  const store = {
    get: () => state,
    subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); },
    set(patch){
      Object.assign(state, patch);
      notify();
    },
    toast(msg, kind='ok'){
      const id = nextId++;
      state.toasts = [...state.toasts, { id, msg, kind }];
      notify();
      setTimeout(() => {
        state.toasts = state.toasts.filter(t => t.id !== id);
        notify();
      }, 2400);
    },

    // ═══════════════════════════════════════════
    //  Navigation
    // ═══════════════════════════════════════════
    mGoto(screen){
      state.mStack = [...state.mStack, screen];
      notify();
    },
    mBack(){
      state.mStack = state.mStack.slice(0, -1);
      notify();
    },
    mSetTab(tab){
      state.mTab = tab;
      state.mStack = [];
      notify();
    },
    dSetView(view){
      state.dView = view;
      notify();
    },
    setView(view){
      state.view = view;
      notify();
    },

    // ═══════════════════════════════════════════
    //  Scan flow — connected to real API
    // ═══════════════════════════════════════════
    startScan(){
      state.pages = [];
      state.currentPageId = null;
      state.scanStep = 1;
      state.selectedContactIds = [];
      state.aiResult = null;
      state.uploadedFile = null;
      state.scanImageBase64 = null;
      state.scanOriginalDataUrl = null;
      state.detectedCorners = null;
      notify();
    },

    // Upload a real file to the backend
    async uploadFile(file) {
      state.uploadedFile = file;
      state.apiError = null;
      notify();
      try {
        const result = await window.API.uploadImage(file);
        if (result.success) {
          // Create data URL for preview
          const reader = new FileReader();
          reader.onload = (e) => {
            state.scanOriginalDataUrl = e.target.result;
            notify();
          };
          reader.readAsDataURL(file);
          store.toast('📁 上傳成功', 'ok');
          return result;
        }
      } catch (e) {
        state.apiError = e.message;
        store.toast('上傳失敗: ' + e.message, 'err');
        notify();
        throw e;
      }
    },

    // Capture photo from canvas blob
    async captureAndUpload(blob) {
      const file = new File([blob], 'capture_' + Date.now() + '.jpg', { type: 'image/jpeg' });
      await store.uploadFile(file);
      return file;
    },

    // Detect document edges
    async detectEdges() {
      try {
        const result = await window.API.detectEdges();
        if (result.success) {
          state.detectedCorners = result.detected ? result.corners : null;
          state.imageWidth = result.image_width;
          state.imageHeight = result.image_height;
          notify();
        }
        return result;
      } catch (e) {
        store.toast('邊界偵測失敗: ' + e.message, 'err');
        throw e;
      }
    },

    // Process scan (crop + filter)
    async processScan(corners, filterName, autoDetect) {
      try {
        const result = await window.API.processScan(corners, filterName || state.selectedFilter, autoDetect);
        if (result.success && result.image_base64) {
          state.scanImageBase64 = result.image_base64;
          if (result.corners) state.detectedCorners = result.corners;
          notify();
        }
        return result;
      } catch (e) {
        store.toast('掃描處理失敗: ' + e.message, 'err');
        throw e;
      }
    },

    // Apply filter
    async applyFilterAPI(filterName) {
      state.selectedFilter = filterName;
      notify();
      try {
        const result = await window.API.applyFilter(filterName);
        if (result.success && result.image_base64) {
          state.scanImageBase64 = result.image_base64;
          notify();
        }
        return result;
      } catch (e) {
        store.toast('濾鏡套用失敗', 'err');
        throw e;
      }
    },

    // Add page to server-side session
    async addPageAPI() {
      try {
        const result = await window.API.addPage();
        if (result.success) {
          const page = {
            id: nextId++,
            index: result.page_index,
            filter: state.selectedFilter,
            rotation: 0,
            cropped: true,
            thumb: state.scanImageBase64 ? ('data:image/jpeg;base64,' + state.scanImageBase64) : 'mock',
          };
          state.pages = [...state.pages, page];
          state.currentPageId = page.id;
          notify();
          return page;
        }
      } catch (e) {
        store.toast('頁面新增失敗', 'err');
        throw e;
      }
    },

    // Rotate image
    async rotateImageAPI(angle) {
      try {
        const result = await window.API.rotateImage(angle);
        if (result.success) {
          state.scanImageBase64 = result.image_base64;
          state.scanOriginalDataUrl = 'data:image/jpeg;base64,' + result.image_base64;
          state.imageWidth = result.image_width;
          state.imageHeight = result.image_height;
          state.detectedCorners = null;
          notify();
          store.toast(`↺ 已旋轉 ${angle}°`, 'ok');
        }
        return result;
      } catch (e) {
        store.toast('旋轉失敗', 'err');
        throw e;
      }
    },

    // Fallback addPage (for simple UI actions)
    addPage(){
      const page = {
        id: nextId++,
        filter: 'auto',
        rotation: 0,
        cropped: true,
        thumb: 'mock',
      };
      state.pages = [...state.pages, page];
      state.currentPageId = page.id;
      notify();
      return page;
    },

    setFilter(filter){
      state.selectedFilter = filter;
      state.pages = state.pages.map(p => p.id === state.currentPageId ? {...p, filter} : p);
      notify();
    },
    applyFilterToAll(filter){
      state.selectedFilter = filter;
      state.pages = state.pages.map(p => ({...p, filter}));
      notify();
    },
    removePage(id){
      state.pages = state.pages.filter(p => p.id !== id);
      if(state.currentPageId === id){
        state.currentPageId = state.pages[0]?.id || null;
      }
      notify();
    },
    setCurrentPage(id){
      state.currentPageId = id;
      notify();
    },

    // ═══════════════════════════════════════════
    //  Contacts — from API
    // ═══════════════════════════════════════════

    toggleContact(id){
      const s = new Set(state.selectedContactIds);
      if(s.has(id)) s.delete(id); else s.add(id);
      state.selectedContactIds = [...s];
      notify();
    },
    selectGroup(groupId){
      const g = state.groups.find(g => g.id === groupId);
      if(!g) return;
      const memberIds = g.memberIds || g.member_ids || g.contact_ids || [];
      state.selectedContactIds = [...memberIds];
      notify();
    },

    async loadContacts() {
      state.loadingContacts = true;
      notify();
      try {
        const data = await window.API.listContacts();
        // API returns list of contacts
        state.contacts = (Array.isArray(data) ? data : []).map(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          dept: c.department || c.dept || '',
          title: c.title || '',
          freq: c.frequency || c.freq || 0,
          fav: c.is_favorite || c.fav || false,
        }));
      } catch (e) {
        console.error('Failed to load contacts:', e);
        // Keep existing data on error
      }
      state.loadingContacts = false;
      notify();
    },

    async addContact(c) {
      try {
        const result = await window.API.createContact(c.name, c.email, c.dept || c.department || '', c.title || '');
        if (result.id) {
          state.contacts = [...state.contacts, {
            id: result.id, name: c.name, email: c.email,
            dept: c.dept || c.department || '', title: c.title || '',
            freq: 0, fav: false
          }];
          notify();
          store.toast('✓ 聯絡人已新增', 'ok');
        }
        return result;
      } catch (e) {
        store.toast('新增失敗: ' + e.message, 'err');
        throw e;
      }
    },

    async removeContact(id) {
      try {
        await window.API.deleteContact(id);
        state.contacts = state.contacts.filter(c => c.id !== id);
        state.selectedContactIds = state.selectedContactIds.filter(x => x !== id);
        notify();
        store.toast('已刪除聯絡人', 'ok');
      } catch (e) {
        store.toast('刪除失敗', 'err');
      }
    },

    toggleFav(id){
      // Local toggle (no dedicated API endpoint for favorite)
      state.contacts = state.contacts.map(c => c.id === id ? {...c, fav:!c.fav} : c);
      notify();
    },

    async loadGroups() {
      try {
        const data = await window.API.listGroups();
        state.groups = (Array.isArray(data) ? data : []).map(g => ({
          id: g.id,
          name: g.name,
          memberIds: g.member_ids || g.memberIds || g.contact_ids || [],
        }));
        notify();
      } catch (e) {
        console.error('Failed to load groups:', e);
      }
    },

    // ═══════════════════════════════════════════
    //  AI — real API call
    // ═══════════════════════════════════════════

    async runAI() {
      if (!state.selectedContactIds.length) {
        store.toast('請先選擇收件人', 'err');
        return;
      }
      state.aiLoading = true;
      state.aiResult = null;
      notify();
      try {
        const contactId = state.selectedContactIds[0];
        const result = await window.API.analyze(contactId);
        if (result.success && result.result) {
          state.aiResult = {
            docType: result.result.doc_type || 'other',
            subject: result.result.subject || '',
            body: result.result.body || '',
            filename: result.result.filename || 'document.pdf',
            confidence: result.result.confidence || 0,
          };
        }
      } catch (e) {
        // Fallback to a basic result on error
        const contact = state.contacts.find(c => c.id === state.selectedContactIds[0]);
        state.aiResult = {
          docType: 'other',
          subject: '[文件] 掃描文件',
          body: `${contact?.name || '收件人'}您好，\n\n附件為掃描文件，請查收。\n\n謝謝`,
          filename: `文件_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.pdf`,
          confidence: 0,
          _error: e.message,
        };
        store.toast('AI 辨識發生錯誤，使用基本模板', 'err');
      }
      state.aiLoading = false;
      notify();
    },

    // ═══════════════════════════════════════════
    //  Send email — real API
    // ═══════════════════════════════════════════

    async sendEmailAPI(subject, body, filename) {
      try {
        const contactIds = state.selectedContactIds;
        const r = state.aiResult;
        const s = subject || r?.subject;
        const b = body || r?.body;
        const f = filename || r?.filename;

        let result;
        if (contactIds.length === 1) {
          result = await window.API.sendEmail(contactIds[0], s, b, f);
        } else {
          result = await window.API.batchSend(contactIds, s, b, f);
        }

        if (result.success) {
          state.scanStep = 7;
          // Add to local history
          const contact = state.contacts.find(c => c.id === contactIds[0]);
          const recip = contactIds.length > 1
            ? `${contact?.name || ''} + ${contactIds.length - 1} 人`
            : contact?.name || '';
          state.history = [{
            id: nextId++,
            recipient: recip,
            email: contact?.email || result.recipient_email || '',
            subject: s,
            docType: r?.docType || 'other',
            docLabel: docTypes[r?.docType]?.label || '其他',
            filename: f,
            size: '~420 KB',
            sentAt: '剛剛',
            confidence: r?.confidence || 0,
          }, ...state.history];
          notify();
          store.toast('✓ 寄送成功！', 'ok');
          return result;
        } else {
          store.toast('寄送失敗: ' + (result.message || '未知錯誤'), 'err');
        }
      } catch (e) {
        store.toast('寄送錯誤: ' + e.message, 'err');
        throw e;
      }
    },

    // Backward compatible sendEmail (for simple UI)
    sendEmail(){
      store.sendEmailAPI().catch(() => {});
    },

    resetScan(){
      state.pages = [];
      state.currentPageId = null;
      state.scanStep = 0;
      state.selectedContactIds = [];
      state.aiResult = null;
      state.selectedFilter = 'auto';
      state.uploadedFile = null;
      state.scanImageBase64 = null;
      state.scanOriginalDataUrl = null;
      state.detectedCorners = null;
      notify();
      // Also clear server session
      window.API.clearPages().catch(() => {});
    },

    // ═══════════════════════════════════════════
    //  History — from API
    // ═══════════════════════════════════════════

    async loadHistory() {
      state.loadingHistory = true;
      notify();
      try {
        const data = await window.API.getHistory();
        state.history = (Array.isArray(data) ? data : []).map(h => ({
          id: h.id,
          recipient: h.recipient_name || h.recipient || '',
          email: h.recipient_email || h.email || '',
          subject: h.subject || '',
          docType: h.doc_type || h.docType || 'other',
          docLabel: docTypes[h.doc_type || h.docType]?.label || '其他',
          filename: h.filename || '',
          size: h.file_size ? window.API.formatBytes(h.file_size) : '',
          sentAt: h.created_at || h.sentAt || '',
          confidence: h.ai_confidence || h.confidence || 0,
        }));
      } catch (e) {
        console.error('Failed to load history:', e);
      }
      state.loadingHistory = false;
      notify();
    },

    async loadStats() {
      try {
        state.stats = await window.API.getStats();
        notify();
      } catch (e) {
        console.error('Failed to load stats:', e);
      }
    },

    // ═══════════════════════════════════════════
    //  Settings — from API
    // ═══════════════════════════════════════════

    async loadSettings() {
      state.loadingSettings = true;
      notify();
      try {
        state.settings = await window.API.getSettings();
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
      state.loadingSettings = false;
      notify();
    },

    async saveSettings(data) {
      try {
        await window.API.saveSettings(data);
        state.settings = { ...state.settings, ...data };
        notify();
        store.toast('✓ 設定已儲存', 'ok');
      } catch (e) {
        store.toast('儲存失敗: ' + e.message, 'err');
      }
    },

    // ═══════════════════════════════════════════
    //  Init — load all data from API
    // ═══════════════════════════════════════════

    async init() {
      // Load all data in parallel
      await Promise.allSettled([
        store.loadContacts(),
        store.loadGroups(),
        store.loadHistory(),
        store.loadSettings(),
        store.loadStats(),
      ]);
    },
  };

  // useStore hook
  function useStore(){
    const [, force] = React.useReducer(x => x+1, 0);
    React.useEffect(() => store.subscribe(force), []);
    return [state, store];
  }

  window.SMStore = store;
  window.useStore = useStore;
  window.docTypes = docTypes;
  window.filterList = filters;

  // Auto-init when DOM is ready and API is available
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.API) store.init();
    });
  } else {
    setTimeout(() => { if (window.API) store.init(); }, 0);
  }
})();
