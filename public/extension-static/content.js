/**
 * Google AI Studio Real-time Content Script & Locked Sidebar Dock
 * Author: Faiz_Fahmi_ID
 * Automatically docks on the right side of Google AI Studio,
 * inserts text, triggers Run, detects and downloads generated audio,
 * uploads to dashboard, and auto-advances to the next job in real-time.
 */

(() => {
  if (window.__AI_TTS_CONTENT_INITIALIZED__) {
    console.log('[AI TTS Extension] Already initialized on this page.');
    return;
  }
  window.__AI_TTS_CONTENT_INITIALIZED__ = true;

  console.log('[AI TTS Extension] Initializing Real-time Automation Dock on Google AI Studio...');

  let backendUrl = 'http://localhost:3000';
  let clientId = 'default';
  let isExecuting = false;
  let currentJob = null;
  let pollingTimer = null;
  let isDockCollapsed = false;

  // Intercept and store audio blob when created by Google AI Studio
  let lastCapturedBlob = null;
  let lastCapturedBlobUrl = null;
  let lastCapturedAudioBuffer = null;
  let isWebsiteAudioConfirmed = false;

  // Listen to messages from MAIN world interceptor script
  window.addEventListener('message', async (ev) => {
    try {
      if (ev.data?.type === '__AI_TTS_BLOB_DATA_CAPTURED__' && ev.data.base64Data) {
        try {
          const byteChars = atob(ev.data.base64Data);
          const byteNumbers = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          if (byteNumbers.byteLength >= 400) {
            lastCapturedAudioBuffer = byteNumbers.buffer;
            lastCapturedBlob = new Blob([byteNumbers], { type: ev.data.mime || 'audio/wav' });
            if (ev.data.blobUrl) lastCapturedBlobUrl = ev.data.blobUrl;
            console.log('[AI TTS Content] Direct Base64 audio captured from main world:', byteNumbers.byteLength);
          }
        } catch (e) {}
      }

      if (ev.data?.type === '__AI_TTS_BLOB_CAPTURED__' && ev.data.blobUrl) {
        lastCapturedBlobUrl = ev.data.blobUrl;
        console.log('[AI TTS Content] Main world blob captured:', ev.data.blobUrl, ev.data.size);
        const resp = await fetch(ev.data.blobUrl);
        const b = await resp.blob();
        const buf = await b.arrayBuffer();
        if (buf.byteLength >= 400) {
          lastCapturedAudioBuffer = buf;
          lastCapturedBlob = b;
          console.log('[AI TTS Content] Cached WAV buffer from main world blob:', buf.byteLength);
        }
      }
      if (ev.data?.type === '__AI_TTS_ANCHOR_CLICKED__' && ev.data.blobUrl) {
        lastCapturedBlobUrl = ev.data.blobUrl;
        console.log('[AI TTS Content] Main world download anchor clicked:', ev.data.blobUrl);
        const resp = await fetch(ev.data.blobUrl);
        const b = await resp.blob();
        const buf = await b.arrayBuffer();
        if (buf.byteLength >= 400) {
          lastCapturedAudioBuffer = buf;
          lastCapturedBlob = b;
        }
      }
    } catch (err) {}
  });

  try {
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (obj) {
      const url = origCreateObjectURL.apply(this, arguments);
      if (obj instanceof Blob && (obj.type.includes('audio') || obj.type.includes('wav') || obj.size >= 400)) {
        if (!lastCapturedBlob || obj.size >= (lastCapturedBlob.size || 0)) {
          lastCapturedBlob = obj;
          lastCapturedBlobUrl = url;
          obj.arrayBuffer().then((buf) => {
            if (buf.byteLength >= 400) {
              lastCapturedAudioBuffer = buf;
            }
          }).catch(() => {});
          console.log('[AI TTS Automation] Genuine Audio Blob intercepted directly from URL.createObjectURL:', obj.size, obj.type, url);
        }
      }
      return url;
    };

    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href && (this.href.startsWith('blob:') || this.href.includes('.wav') || this.download)) {
        lastCapturedBlobUrl = this.href;
        fetch(this.href)
          .then((r) => r.blob())
          .then(async (b) => {
            const buf = await b.arrayBuffer();
            if (buf.byteLength >= 400) {
              lastCapturedAudioBuffer = buf;
              lastCapturedBlob = b;
            }
          })
          .catch(() => {});
        console.log('[AI TTS Automation] Download anchor clicked:', this.href, this.download);
      }
      return origAnchorClick.apply(this, arguments);
    };
  } catch (e) {
    console.warn('[AI TTS] Could not patch URL/Anchor prototype:', e);
  }

  // Retrieve saved backendUrl, clientId, and dockVisible state
  try {
    chrome.storage.local.get(['backendUrl', 'clientId', 'dockVisible'], (res) => {
      if (res?.backendUrl) {
        backendUrl = res.backendUrl.replace(/\/$/, '');
      }
      if (res?.clientId) {
        clientId = res.clientId;
      }
      if (res?.dockVisible === false) {
        setDockVisibility(false);
      }
      updateDockBackendUI();
      startAutoRunner();
    });
  } catch (e) {
    startAutoRunner();
  }

  const DOCK_WIDTH = 340;

  // Dynamically separate the Google AI Studio page from the extension dock so they NEVER overlap
  function updatePageSeparation(isOpen) {
    try {
      const html = document.documentElement;
      const body = document.body;
      if (isOpen) {
        html.style.setProperty('margin-right', `${DOCK_WIDTH}px`, 'important');
        html.style.setProperty('width', `calc(100vw - ${DOCK_WIDTH}px)`, 'important');
        html.style.setProperty('box-sizing', 'border-box', 'important');
        html.style.setProperty('transition', 'margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
        body.style.setProperty('margin-right', '0px', 'important');
        body.style.setProperty('max-width', '100%', 'important');
        body.style.setProperty('box-sizing', 'border-box', 'important');
      } else {
        html.style.setProperty('margin-right', '18px', 'important');
        html.style.setProperty('width', 'calc(100vw - 18px)', 'important');
        html.style.setProperty('box-sizing', 'border-box', 'important');
        body.style.removeProperty('margin-right');
        body.style.removeProperty('max-width');
      }
    } catch (e) {}
  }

  // Inject CSS Styles for Dock
  function injectDockStyles() {
    if (document.getElementById('ai-tts-dock-styles')) return;
    const style = document.createElement('style');
    style.id = 'ai-tts-dock-styles';
    style.textContent = `
      #ai-tts-automation-dock {
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        width: 340px !important;
        height: 100vh !important;
        background: #020617 !important;
        border-left: 1.5px solid #0284c7 !important;
        color: #f1f5f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        box-shadow: none !important;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }
      #ai-tts-automation-dock.dock-hidden {
        display: none !important;
      }
      #ai-tts-automation-dock.collapsed {
        transform: translateX(322px) !important;
      }
      #ai-tts-collapsed-strip {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 18px !important;
        height: 100vh !important;
        background: #090e1a !important;
        border-right: 1px solid #1e293b !important;
        display: none !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        color: #38bdf8 !important;
        font-size: 11px !important;
        font-weight: bold !important;
        user-select: none !important;
        transition: background 0.15s, color 0.15s !important;
      }
      #ai-tts-collapsed-strip:hover {
        background: #0f172a !important;
        color: #67e8f9 !important;
      }
      #ai-tts-automation-dock.collapsed #ai-tts-collapsed-strip {
        display: flex !important;
      }
      .ai-tts-header {
        padding: 12px 14px !important;
        background: #090e1a !important;
        border-bottom: 1px solid #1e293b !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .ai-tts-title {
        font-size: 13px !important;
        font-weight: 800 !important;
        color: #38bdf8 !important;
        letter-spacing: -0.2px !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      .ai-tts-author-badge {
        font-size: 9px !important;
        background: rgba(99, 102, 241, 0.2) !important;
        border: 1px solid rgba(99, 102, 241, 0.4) !important;
        color: #a5b4fc !important;
        padding: 1px 5px !important;
        border-radius: 4px !important;
        font-weight: 700 !important;
      }
      .ai-tts-body {
        flex: 1 !important;
        overflow-y: auto !important;
        padding: 12px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }
      .ai-tts-card {
        background: #090e1a !important;
        border: 1px solid #1e293b !important;
        border-radius: 8px !important;
        padding: 9px 11px !important;
      }
      .ai-tts-card-title {
        font-size: 10px !important;
        font-weight: 700 !important;
        color: #94a3b8 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        margin-bottom: 5px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
      }
      .ai-tts-status-badge {
        font-size: 9.5px !important;
        font-weight: 700 !important;
        padding: 2px 7px !important;
        border-radius: 9999px !important;
      }
      .ai-tts-badge-online { background: rgba(16, 185, 129, 0.15) !important; color: #34d399 !important; border: 1px solid rgba(16, 185, 129, 0.4) !important; }
      .ai-tts-badge-waiting { background: rgba(245, 158, 11, 0.15) !important; color: #fbbf24 !important; border: 1px solid rgba(245, 158, 11, 0.4) !important; }
      .ai-tts-badge-offline { background: rgba(239, 68, 68, 0.15) !important; color: #f87171 !important; border: 1px solid rgba(239, 68, 68, 0.4) !important; }
      .ai-tts-url-input {
        width: 100% !important;
        background: #020617 !important;
        border: 1px solid #334155 !important;
        border-radius: 6px !important;
        color: #f8fafc !important;
        font-size: 11px !important;
        font-family: monospace !important;
        padding: 5px 8px !important;
        box-sizing: border-box !important;
      }
      .ai-tts-url-input:focus {
        border-color: #0284c7 !important;
        outline: none !important;
      }
      .ai-tts-btn {
        background: #0284c7 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 5px 9px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
        transition: opacity 0.15s, background 0.15s !important;
      }
      .ai-tts-btn:hover { background: #0369a1 !important; }
      .ai-tts-btn-secondary { background: #1e293b !important; color: #cbd5e1 !important; border: 1px solid #334155 !important; }
      .ai-tts-btn-secondary:hover { background: #334155 !important; }
      .ai-tts-step-list {
        display: flex !important;
        flex-direction: column !important;
        gap: 5px !important;
        font-size: 10.5px !important;
      }
      .ai-tts-step-item {
        display: flex !important;
        align-items: center !important;
        gap: 7px !important;
        color: #64748b !important;
      }
      .ai-tts-step-item.active {
        color: #38bdf8 !important;
        font-weight: 700 !important;
      }
      .ai-tts-step-item.done {
        color: #34d399 !important;
        font-weight: 600 !important;
      }
      .ai-tts-step-dot {
        width: 7px !important;
        height: 7px !important;
        border-radius: 50% !important;
        background: #334155 !important;
        flex-shrink: 0 !important;
      }
      .ai-tts-step-item.active .ai-tts-step-dot {
        background: #38bdf8 !important;
        box-shadow: 0 0 6px #38bdf8 !important;
      }
      .ai-tts-step-item.done .ai-tts-step-dot {
        background: #34d399 !important;
      }
      .ai-tts-console {
        background: #020617 !important;
        border: 1px solid #1e293b !important;
        border-radius: 6px !important;
        padding: 7px !important;
        height: 110px !important;
        overflow-y: auto !important;
        font-family: monospace !important;
        font-size: 9.5px !important;
        color: #94a3b8 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 3px !important;
      }
      .ai-tts-console-line { word-break: break-all !important; }
      .ai-tts-console-success { color: #34d399 !important; font-weight: bold !important; }
      .ai-tts-console-error { color: #f87171 !important; font-weight: bold !important; }
      .ai-tts-console-info { color: #38bdf8 !important; }
    `;
    document.head.appendChild(style);
  }

  // Create and inject the Locked Sidebar Dock
  function createDock() {
    if (document.getElementById('ai-tts-automation-dock')) return;
    injectDockStyles();

    const dock = document.createElement('div');
    dock.id = 'ai-tts-automation-dock';
    dock.innerHTML = `
      <div id="ai-tts-collapsed-strip" title="Klik untuk membuka AI TTS Studio">
        <span>◀</span>
      </div>

      <div class="ai-tts-header">
        <div>
          <div class="ai-tts-title">
            <span>🔊 AI TTS STUDIO</span>
            <span class="ai-tts-author-badge">Faiz_Fahmi_ID</span>
          </div>
          <div style="font-size: 9.5px; color: #64748b; margin-top: 1px;">
            Google AI Studio Realtime Auto-Runner
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 5px;">
          <div id="ai-tts-conn-badge" class="ai-tts-status-badge ai-tts-badge-waiting">MEMERIKSA</div>
          <button id="ai-tts-btn-collapse" title="Sembunyikan panel ke tepi layar (Ciutkan)" style="background: #1e293b; border: 1px solid #334155; color: #cbd5e1; border-radius: 6px; padding: 3px 7px; font-size: 10px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 3px;">
            <span>▶</span> Sembunyi
          </button>
          <button id="ai-tts-btn-close-dock" title="Matikan / Tutup Sidebar ini" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; border-radius: 6px; padding: 3px 7px; font-size: 10px; cursor: pointer; font-weight: bold;">✕</button>
        </div>
      </div>

      <div class="ai-tts-body">
        <!-- Target Server URL Section -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Target Web Dashboard:</span>
            <span id="ai-tts-latency" style="color: #64748b; font-family: monospace;">- ms</span>
          </div>
          <div style="display: flex; gap: 5px;">
            <input type="text" id="ai-tts-dock-url" class="ai-tts-url-input" value="${backendUrl}" placeholder="https://app.vercel.app atau http://localhost:3000" spellcheck="false" />
            <button id="ai-tts-btn-save-url" class="ai-tts-btn" style="padding: 4px 8px; font-size: 10px;">Simpan</button>
          </div>
        </div>

        <!-- Download Folder Setting Section -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Folder Simpan WAV Asli:</span>
            <span style="color: #38bdf8; font-family: monospace;">Downloads\\<span id="ai-tts-subfolder-display">unduhan</span></span>
          </div>
          <div style="display: flex; gap: 5px;">
            <input type="text" id="ai-tts-dock-subfolder" class="ai-tts-url-input" value="unduhan" placeholder="Nama subfolder (misal: unduhan)" spellcheck="false" />
            <button id="ai-tts-btn-save-subfolder" class="ai-tts-btn" style="padding: 4px 8px; font-size: 10px;">Simpan</button>
          </div>
          <button id="ai-tts-btn-pick-folder" class="ai-tts-btn" style="width: 100%; margin-top: 6px; padding: 6px 8px; font-size: 10px; background: linear-gradient(135deg, #0284c7, #4f46e5); font-weight: bold; border-radius: 6px; cursor: pointer;">
            📂 Pilih Folder di Komputer Ini (Buka Dialog)
          </button>
          <div style="font-size: 9px; color: #94a3b8; margin-top: 4px; line-height: 1.3;">
            Semua file WAV yang diunduh dari Google AI Studio otomatis masuk ke folder ini secara real-time.
          </div>
        </div>

        <!-- Active Job Card -->
        <div class="ai-tts-card" id="ai-tts-job-card">
          <div class="ai-tts-card-title">
            <span>Pekerjaan Sedang Aktif</span>
            <span id="ai-tts-job-status" style="color: #38bdf8; font-weight: 700;">MENUNGGU ANTREAN</span>
          </div>
          <div id="ai-tts-job-info" style="font-size: 11px; color: #cbd5e1; line-height: 1.4;">
            <div style="font-weight: 700; color: #f8fafc;" id="ai-tts-job-filename">Belum ada pekerjaan aktif</div>
            <div style="font-style: italic; color: #94a3b8; margin-top: 2px; max-height: 38px; overflow: hidden; text-overflow: ellipsis;" id="ai-tts-job-text">
              Klik "Mulai Generate" di website dashboard untuk memulai otomatisasi antrean.
            </div>
          </div>
        </div>

        <!-- Real-time Step Checklist -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Alur Otomatisasi Realtime</span>
            <span id="ai-tts-step-counter" style="color: #38bdf8; font-weight: 700;">0/5</span>
          </div>
          <div class="ai-tts-step-list">
            <div class="ai-tts-step-item" id="ai-tts-step-1">
              <span class="ai-tts-step-dot"></span>
              <span>1. Menempel teks ke prompt AI Studio</span>
            </div>
            <div class="ai-tts-step-item" id="ai-tts-step-2">
              <span class="ai-tts-step-dot"></span>
              <span>2. Menekan tombol Run (Ctrl + Enter)</span>
            </div>
            <div class="ai-tts-step-item" id="ai-tts-step-3">
              <span class="ai-tts-step-dot"></span>
              <span>3. Menunggu tombol unduh muncul</span>
            </div>
            <div class="ai-tts-step-item" id="ai-tts-step-4">
              <span class="ai-tts-step-dot"></span>
              <span>4. Unduh audio WAV asli ke folder</span>
            </div>
            <div class="ai-tts-step-item" id="ai-tts-step-5">
              <span class="ai-tts-step-dot"></span>
              <span>5. Selesai -> Langsung antrean berikutnya</span>
            </div>
          </div>
        </div>

        <!-- Live Activity Log Console -->
        <div class="ai-tts-card" style="padding: 7px 9px;">
          <div class="ai-tts-card-title" style="margin-bottom: 3px;">
            <span>Log Konsol Realtime</span>
            <span style="font-size: 9px; cursor: pointer; color: #38bdf8;" id="ai-tts-clear-console">Clear</span>
          </div>
          <div class="ai-tts-console" id="ai-tts-console-box">
            <div class="ai-tts-console-line ai-tts-console-info">[DOCK] AI TTS Dock terpasang di samping Google AI Studio.</div>
          </div>
        </div>

        <!-- Action Controls -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
          <button id="ai-tts-btn-inspect" class="ai-tts-btn ai-tts-btn-secondary" style="font-size: 10px;">
            🔍 Tes Selektor DOM
          </button>
          <button id="ai-tts-btn-open-dash" class="ai-tts-btn" style="font-size: 10px;">
            🌐 Buka Dashboard
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(dock);

    // Apply layout separation so Google AI Studio content is never overlapped by dock
    updatePageSeparation(!isDockCollapsed);

    // Dock collapse & expand events
    const btnCollapse = document.getElementById('ai-tts-btn-collapse');
    const collapsedStrip = document.getElementById('ai-tts-collapsed-strip');

    function toggleCollapse(collapsed) {
      isDockCollapsed = collapsed;
      if (isDockCollapsed) {
        dock.classList.add('collapsed');
        updatePageSeparation(false);
      } else {
        dock.classList.remove('collapsed');
        updatePageSeparation(true);
      }
      try {
        chrome.storage.local.set({ dockCollapsed: isDockCollapsed });
      } catch (e) {}
    }

    btnCollapse?.addEventListener('click', () => toggleCollapse(true));
    collapsedStrip?.addEventListener('click', () => toggleCollapse(false));

    chrome.storage.local.get(['dockCollapsed'], (res) => {
      if (res?.dockCollapsed === true) {
        toggleCollapse(true);
      }
    });

    // Save Backend URL button
    document.getElementById('ai-tts-btn-save-url').addEventListener('click', () => {
      const input = document.getElementById('ai-tts-dock-url');
      if (input?.value) {
        backendUrl = input.value.trim().replace(/\/$/, '');
        try {
          chrome.storage.local.set({ backendUrl });
        } catch (e) {}
        dockLog(`Alamat server diperbarui ke: ${backendUrl}`, 'info');
        updateDockBackendUI();
      }
    });

    // Save Download Subfolder button
    const subfolderInput = document.getElementById('ai-tts-dock-subfolder');
    const subfolderDisplay = document.getElementById('ai-tts-subfolder-display');
    const btnSaveSubfolder = document.getElementById('ai-tts-btn-save-subfolder');

    chrome.storage.local.get(['downloadSubfolder'], (res) => {
      const folderVal = res?.downloadSubfolder || 'unduhan';
      if (subfolderInput) subfolderInput.value = folderVal;
      if (subfolderDisplay) subfolderDisplay.innerText = folderVal;
    });

    btnSaveSubfolder?.addEventListener('click', () => {
      if (subfolderInput?.value) {
        let val = subfolderInput.value.trim().replace(/[/\\]+$/, '');
        const segments = val.split(/[/\\]/);
        const cleanFolder = segments[segments.length - 1] || 'unduhan';
        subfolderInput.value = cleanFolder;
        if (subfolderDisplay) subfolderDisplay.innerText = cleanFolder;

        chrome.storage.local.set({ downloadSubfolder: cleanFolder });
        chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: cleanFolder } });
        dockLog(`Folder simpan WAV disetel ke: Downloads\\${cleanFolder}`, 'success');
      }
    });

    // Native Device Folder Picker Dialog
    const btnPickFolderDock = document.getElementById('ai-tts-btn-pick-folder');
    if (btnPickFolderDock) {
      btnPickFolderDock.addEventListener('click', async () => {
        try {
          if ('showDirectoryPicker' in window) {
            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (dirHandle && dirHandle.name) {
              const cleanFolder = dirHandle.name;
              if (subfolderInput) subfolderInput.value = cleanFolder;
              if (subfolderDisplay) subfolderDisplay.innerText = cleanFolder;
              chrome.storage.local.set({ downloadSubfolder: cleanFolder });
              chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: cleanFolder } });
              dockLog(`[FOLDER] Berhasil memilih folder perangkat: Downloads\\${cleanFolder}`, 'success');
            }
          } else {
            const prompted = prompt('Masukkan nama folder penyimpanan WAV di komputer Anda:', subfolderInput?.value || 'unduhan');
            if (prompted) {
              const clean = prompted.trim() || 'unduhan';
              if (subfolderInput) subfolderInput.value = clean;
              if (subfolderDisplay) subfolderDisplay.innerText = clean;
              chrome.storage.local.set({ downloadSubfolder: clean });
              chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: clean } });
              dockLog(`[FOLDER] Folder unduhan disetel ke: Downloads\\${clean}`, 'success');
            }
          }
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            dockLog(`[FOLDER] Dialog folder: ${err.message}`, 'error');
          }
        }
      });
    }

    // Inspect button
    document.getElementById('ai-tts-btn-inspect').addEventListener('click', () => {
      const diag = window.AI_STUDIO_SELECTORS ? window.AI_STUDIO_SELECTORS.runDiagnostics() : null;
      dockLog(`Diagnostik: Input=${diag?.textInputFound}, Run=${diag?.runButtonFound}, Audio=${diag?.audioOutputFound}`, diag?.textInputFound && diag?.runButtonFound ? 'success' : 'error');
    });

    // Open Dashboard button
    document.getElementById('ai-tts-btn-open-dash').addEventListener('click', () => {
      window.open(backendUrl, '_blank');
    });

    // Clear console
    document.getElementById('ai-tts-clear-console').addEventListener('click', () => {
      const box = document.getElementById('ai-tts-console-box');
      if (box) box.innerHTML = '';
    });

    // Close / Turn off Dock button
    document.getElementById('ai-tts-btn-close-dock')?.addEventListener('click', () => {
      setDockVisibility(false);
    });

    // Restore saved dock visibility
    chrome.storage.local.get(['dockVisible'], (res) => {
      if (res?.dockVisible === false) {
        setDockVisibility(false);
      }
    });
  }

  function setDockVisibility(visible) {
    const dock = document.getElementById('ai-tts-automation-dock');
    if (!dock) return;
    if (visible) {
      dock.style.setProperty('display', 'flex', 'important');
      dock.classList.remove('dock-hidden');
      updatePageSeparation(!isDockCollapsed);
    } else {
      dock.style.setProperty('display', 'none', 'important');
      dock.classList.add('dock-hidden');
      updatePageSeparation(false);
    }
    try {
      chrome.storage.local.set({ dockVisible: visible });
    } catch (e) {}
  }

  function dockLog(message, type = 'default') {
    const box = document.getElementById('ai-tts-console-box');
    if (!box) return;
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `ai-tts-console-line ${
      type === 'success' ? 'ai-tts-console-success' : type === 'error' ? 'ai-tts-console-error' : type === 'info' ? 'ai-tts-console-info' : ''
    }`;
    line.innerText = `[${time}] ${message}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function setStep(stepIndex) {
    const counter = document.getElementById('ai-tts-step-counter');
    if (counter) counter.innerText = `${stepIndex}/5`;

    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`ai-tts-step-${i}`);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (i < stepIndex) {
        el.classList.add('done');
      } else if (i === stepIndex) {
        el.classList.add('active');
      }
    }
  }

  function updateDockBackendUI() {
    const input = document.getElementById('ai-tts-dock-url');
    if (input && input.value !== backendUrl) input.value = backendUrl;

    // Check health
    const startTime = Date.now();
    fetch(`${backendUrl}/api/health`)
      .then((r) => r.json())
      .then(() => {
        const latency = Date.now() - startTime;
        const badge = document.getElementById('ai-tts-conn-badge');
        const latEl = document.getElementById('ai-tts-latency');
        if (badge) {
          badge.className = 'ai-tts-status-badge ai-tts-badge-online';
          badge.innerText = 'ONLINE';
        }
        if (latEl) latEl.innerText = `${latency} ms`;
      })
      .catch(() => {
        const badge = document.getElementById('ai-tts-conn-badge');
        const latEl = document.getElementById('ai-tts-latency');
        if (badge) {
          badge.className = 'ai-tts-status-badge ai-tts-badge-offline';
          badge.innerText = 'OFFLINE';
        }
        if (latEl) latEl.innerText = 'Err';
      });
  }

  // --- AUTOMATION ENGINE (REAL-TIME AUTO RUNNER) ---
  function startAutoRunner() {
    createDock();
    if (pollingTimer) clearInterval(pollingTimer);

    // Initial announce to background
    try {
      chrome.runtime.sendMessage({
        type: 'AI_STUDIO_TAB_READY',
        url: window.location.href,
      }).catch(() => {});
    } catch (e) {}

    // Polling loop every 1.5 seconds to pull pending jobs
    pollingTimer = setInterval(async () => {
      if (isExecuting) return;

      try {
        const activeClient = currentJob?.clientId || clientId || 'default';
        const res = await fetch(`${backendUrl}/api/extension/next-job?clientId=${encodeURIComponent(activeClient)}`, {
          headers: {
            'X-Client-Id': activeClient,
          },
        });
        if (!res.ok) return;
        const data = await res.json();

        if (data.success && data.hasJob && data.job) {
          executeTTSJob(data.job);
        }
      } catch (err) {
        // Backend temporarily unreachable
      }
    }, 1500);

    // Also send periodic heartbeat to backend
    setInterval(() => {
      try {
        const activeClient = clientId || 'default';
        fetch(`${backendUrl}/api/extension/heartbeat?clientId=${encodeURIComponent(activeClient)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': activeClient },
          body: JSON.stringify({
            aiStudioConnected: true,
            activeUrl: window.location.href,
            version: '1.1.0',
            clientId: activeClient,
          }),
        }).catch(() => {});
      } catch (e) {}
    }, 5000);

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.backendUrl && changes.backendUrl.newValue) {
            backendUrl = changes.backendUrl.newValue.replace(/\/$/, '');
            updateDockBackendUI();
          }
          if (changes.ai_tts_client_id && changes.ai_tts_client_id.newValue) {
            clientId = changes.ai_tts_client_id.newValue;
          }
        }
      });
    } catch (e) {}
  }

  // Master job execution flow
  async function executeTTSJob(job) {
    if (isExecuting) return;
    isExecuting = true;
    currentJob = job;

    const fnEl = document.getElementById('ai-tts-job-filename');
    const txEl = document.getElementById('ai-tts-job-text');
    const stEl = document.getElementById('ai-tts-job-status');

    if (fnEl) fnEl.innerText = `#${job.order} — ${job.filename}`;
    if (txEl) txEl.innerText = `"${job.text}"`;
    if (stEl) stEl.innerText = 'SEDANG DIPROSES';

    dockLog(`Mulai memproses pekerjaan #${job.order} (${job.filename})`, 'info');

    // Sync target filename with background service worker for automatic download naming
    try {
      chrome.runtime.sendMessage({
        type: 'SET_CURRENT_DOWNLOAD_NAME',
        payload: { filename: job.filename },
      }).catch(() => {});
    } catch (e) {}

    try {
      // TAHAP 1: Menempel Teks ke Kolom Speaker (Hapus Template Bawaan)
      setStep(1);
      dockLog(`[1/5] Mencari kolom dialog Speaker dan memeriksa template bawaan...`, 'info');

      const inputEl = await waitForElement(() => {
        if (!window.AI_STUDIO_SELECTORS) return null;
        for (const strat of window.AI_STUDIO_SELECTORS.textInput.strategies) {
          try {
            const el = strat();
            if (el) return el;
          } catch (e) {}
        }
        return null;
      }, 10000, 'Kolom dialog Speaker Google AI Studio');

      injectTextIntoElement(inputEl, job.text);
      await sleep(400);

      notifyBackend(job.id, 'TEXT_INSERTED');
      dockLog(`[1/5] Teks "${job.text.substring(0, 30)}..." berhasil ditempel ke Speaker!`, 'success');

      // TAHAP 2: Menekan Tombol Run
      setStep(2);
      await sleep(500);
      dockLog(`[2/5] Menekan tombol Run (Ctrl + Enter)...`, 'info');

      // Record pre-existing state to distinguish new generation
      const preExistingAudios = getAudioSources();
      const oldDownloadBtn = findDownloadButton();
      lastCapturedBlob = null;
      lastCapturedBlobUrl = null;
      lastCapturedAudioBuffer = null;

      const runBtn = await waitForElement(() => {
        if (!window.AI_STUDIO_SELECTORS) return null;
        for (const strat of window.AI_STUDIO_SELECTORS.runButton.strategies) {
          try {
            const el = strat();
            if (el) return el;
          } catch (e) {}
        }
        return null;
      }, 5000, 'Tombol Run Ctrl ↵');

      triggerRunAction(runBtn, inputEl);
      notifyBackend(job.id, 'RUN_CLICKED');
      dockLog(`[2/5] Tombol Run berhasil ditekan. Memasuki masa loading...`, 'success');

      // TAHAP 3: Masa Loading (Tombol Unduh Belum Ada) -> Selesai (Tombol Unduh Muncul)
      setStep(3);
      if (stEl) stEl.innerText = 'MASA LOADING...';
      dockLog(`[3/5] Masa loading: AI Studio sedang memproses suara (tombol unduh belum aktif)...`, 'info');
      notifyBackend(job.id, 'GENERATION_STARTED');

      // Wait strictly for loading completion and the appearance of the Download button
      const downloadBtn = await waitForDownloadButtonAppearance(oldDownloadBtn);
      notifyBackend(job.id, 'GENERATION_COMPLETED');
      dockLog(`[3/5] Loading selesai! Tombol unduh resmi muncul di Google AI Studio.`, 'success');

      // TAHAP 4: Unduh Secara Otomatis Berkas WAV Asli ke Folder Pilihan
      setStep(4);
      if (stEl) stEl.innerText = 'MENGUNDUH WAV...';
      dockLog(`[4/5] Menekan tombol unduh AI Studio untuk berkas "${job.filename}.wav"...`, 'info');

      // Pastikan background extension mengarahkan nama berkas & folder dengan benar
      try {
        chrome.runtime.sendMessage({
          type: 'SET_CURRENT_DOWNLOAD_NAME',
          payload: { filename: job.filename, jobId: job.id },
        });
      } catch (e) {}

      // Eksekusi unduh berkas WAV asli dari Google AI Studio
      const audioResult = await downloadAndExtractAudio(preExistingAudios, downloadBtn, job.filename);

      if (!audioResult || !audioResult.buffer || audioResult.size < 400) {
        throw new Error('Berkas WAV belum selesai diunduh dari Google AI Studio atau ukurannya tidak valid.');
      }

      // Pastikan berkas audio WAV dikirim ke website dashboard untuk diproses & dikonversi ke MP3
      dockLog(`[4/5] Berkas WAV terverifikasi (${(audioResult.size / 1024).toFixed(1)} KB), mengunggah ke Audio Library...`, 'info');
      await uploadWavToDashboard(job.id, job.filename, audioResult.buffer);

      // Jeda singkat agar file system selesai menulis file ke disk komputer
      await sleep(800);

      // TAHAP 5: Berkas WAV Selesai Diunduh -> Baru Lanjut ke Antrean Berikutnya!
      setStep(5);
      if (stEl) stEl.innerText = 'SELESAI (COMPLETED)';
      dockLog(`[5/5] Berkas "${job.filename}.wav" berhasil selesai diunduh ke folder! Melanjutkan antrean berikutnya...`, 'success');

      // Beritahu backend bahwa pekerjaan ini telah selesai
      notifyBackend(job.id, 'JOB_COMPLETED', {
        filename: job.filename,
        wavDownloaded: true,
      });

      // Melanjutkan ke antrean selanjutnya setelah unduhan selesai
      dockLog(`[SELESAI] Unduhan selesai & tersimpan di folder! Mengambil antrean berikutnya...`, 'success');
      await sleep(1000);
    } catch (err) {
      console.error('[AI TTS Content] Execution failed:', err);
      dockLog(`GAGAL: ${err.message}`, 'error');
      notifyBackend(job.id, 'JOB_FAILED', { error: err.message });
      if (stEl) stEl.innerText = 'GAGAL (FAILED)';
      await sleep(3000);
    } finally {
      isExecuting = false;
      currentJob = null;
      setTimeout(() => {
        if (!isExecuting) {
          const statusElem = document.getElementById('ai-tts-job-status');
          if (statusElem && (statusElem.innerText === 'SELESAI (COMPLETED)' || statusElem.innerText.includes('SELESAI'))) {
            statusElem.innerText = 'MENUNGGU ANTREAN';
          }
        }
      }, 2500);
    }
  }

  // --- DOM INTERACTION HELPERS ---

  function injectTextIntoElement(element, text) {
    element.focus();

    // Check if initial template text is present
    const existingContent = (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')
      ? element.value
      : (element.innerText || element.textContent || '');

    if (existingContent && existingContent.trim().length > 0) {
      dockLog(`[1/5] Template awal terdeteksi ("${existingContent.trim().substring(0, 30)}..."). Menghapus seluruh template sebelum menempel teks baru...`, 'info');
    }

    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      // 1. Clear
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      // 2. Insert new text
      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
    } else {
      // Contenteditable (Speech block dialogue container)
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('delete', false);
      } catch (e) {}

      element.innerHTML = '';
      element.innerText = '';
      element.textContent = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));

      try {
        const ok = document.execCommand('insertText', false, text);
        if (!ok || !element.innerText.includes(text.substring(0, Math.min(10, text.length)))) {
          element.innerText = text;
        }
      } catch (e) {
        element.innerText = text;
      }

      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      // Final check: if template text still lingers, force overwrite
      const checkText = element.innerText || '';
      if (checkText.includes("Type '[' for tags") || checkText.includes('[amused]') || checkText.includes('Blackwood House')) {
        element.innerText = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ', code: 'Space' }));
  }

  function triggerRunAction(runBtn, inputEl) {
    // Dismiss any previous error notifications or banners in AI Studio
    try {
      const dismissButtons = document.querySelectorAll(
        'button[aria-label="Close"], button[aria-label*="dismiss" i], .close-button, mat-icon[fonticon="close"]'
      );
      dismissButtons.forEach((btn) => {
        if (!btn.closest('#ai-tts-automation-dock')) {
          btn.click();
        }
      });
    } catch (e) {}

    // Only click the Run button once cleanly if it exists and is enabled
    // NEVER send both click and Ctrl+Enter simultaneously as duplicate requests trigger AI Studio 404 RPC errors!
    if (runBtn && !runBtn.disabled) {
      runBtn.click();
      return;
    }

    // Only fall back to Ctrl + Enter if the Run button is not directly clickable
    if (inputEl) {
      inputEl.focus();
      inputEl.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        ctrlKey: true
      }));
    }
  }

  function getAudioSources() {
    const list = [];
    document.querySelectorAll('audio').forEach((a) => {
      if (a.closest('#ai-tts-automation-dock')) return;
      if (a.src) list.push(a.src);
      const s = a.querySelector('source');
      if (s && s.src) list.push(s.src);
    });
    return list;
  }

  function findDownloadButton() {
    if (window.AI_STUDIO_SELECTORS?.downloadButton) {
      for (const strat of window.AI_STUDIO_SELECTORS.downloadButton.strategies) {
        try {
          const btn = strat();
          if (btn) return btn;
        } catch (e) {}
      }
    }
    // Fallback: check general audioOutput download strategy
    if (window.AI_STUDIO_SELECTORS?.audioOutput?.strategies?.[1]) {
      try {
        const btn = window.AI_STUDIO_SELECTORS.audioOutput.strategies[1]();
        if (btn) return btn;
      } catch (e) {}
    }
    return null;
  }

  async function waitForDownloadButtonAppearance(oldDownloadBtn) {
    const maxWaitMs = 120000; // 2 minutes max
    const startTime = Date.now();
    let loadingLogTick = 0;

    // Step 3A: Allow Google AI Studio to register click and enter loading state
    await sleep(1500);

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(500);
      loadingLogTick++;

      // Check if loading/generating indicator is active
      let isStillGenerating = false;
      if (window.AI_STUDIO_SELECTORS?.generatingIndicator) {
        for (const strat of window.AI_STUDIO_SELECTORS.generatingIndicator.strategies) {
          try {
            if (strat()) {
              isStillGenerating = true;
              break;
            }
          } catch (e) {}
        }
      }

      // Check if Run button is currently disabled or shows spinner
      const runBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
      const activeRunBtn = runBtns.find((b) => {
        const t = (b.innerText || '').toLowerCase();
        return t.includes('run') && (b.disabled || b.classList.contains('loading') || b.querySelector('mat-spinner'));
      });
      if (activeRunBtn) {
        isStillGenerating = true;
      }

      // While loading is active: "pada masa loading tidak ada tombol unduh"
      if (isStillGenerating) {
        if (loadingLogTick % 8 === 0) {
          dockLog('[3/5] Masa loading: AI Studio sedang memproses audio (tombol unduh belum muncul)...', 'info');
        }
        continue;
      }

      // Step 3B: Loading has finished! Look for the newly appeared Download button or populated audio
      const dlBtn = findDownloadButton();
      const audios = Array.from(document.querySelectorAll('audio')).filter(a => !a.closest('#ai-tts-automation-dock'));
      const readyAudio = audios.find((a) => (a.src || a.currentSrc) && (a.duration > 0.1 || a.readyState >= 2));

      // Check if playback duration display is populated (e.g. "0:02", not "0:00 / 0:00")
      const timeScrubbers = Array.from(document.querySelectorAll('footer, .bottom-bar, .playback-bar, .audio-player, ms-prompt-run-bar'));
      const hasTimeDisplay = timeScrubbers.some((bar) => {
        const text = bar.innerText || '';
        return /\b0:[0-5][0-9]\b/.test(text) && !text.includes('0:00 / 0:00');
      });

      if (dlBtn) {
        dockLog(`[3/5] Tombol unduh resmi terdeteksi di Google AI Studio!`, 'success');
        return dlBtn;
      }

      if ((readyAudio || hasTimeDisplay || lastCapturedAudioBuffer || lastCapturedBlob) && !isStillGenerating && (Date.now() - startTime > 1200)) {
        dockLog(`[3/5] Audio selesai digenerate (durasi audio terisi)!`, 'success');
        return dlBtn || null;
      }
    }

    throw new Error('Waktu tunggu generasi audio Google AI Studio melebihi batas (120s).');
  }

  function findAudioElementsEverywhere(root = document) {
    const audios = [];
    function traverse(node) {
      if (!node) return;
      if (node.tagName && node.tagName.toLowerCase() === 'audio') {
        if (!node.closest?.('#ai-tts-automation-dock')) {
          audios.push(node);
        }
      }
      if (node.shadowRoot) {
        traverse(node.shadowRoot);
      }
      if (node.children) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }
    traverse(root);
    return audios;
  }

  async function downloadAndExtractAudio(previousSources, downloadBtn, targetFilename = 'audio') {
    const prevSet = new Set(previousSources);
    let audioResult = null;
    const MIN_SPEECH_AUDIO_BYTES = 400; // Accept any genuine WAV audio (even short 1-2s speech)

    function triggerBufferDownload(res, name) {
      if (!res || !res.buffer) return;
      try {
        let binary = '';
        const bytes = new Uint8Array(res.buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const b64 = btoa(binary);
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_BUFFER_OR_BLOB',
          payload: {
            filename: name,
            base64Data: b64,
          },
        });
        dockLog(`[4/5] Mengunduh berkas "${name}.wav" ke folder unduhan komputer...`, 'info');
      } catch (e) {
        console.warn('[AI TTS Content] Direct buffer download message failed:', e);
      }
    }

    function clickElementProperly(btn) {
      if (!btn) return;
      try {
        btn.focus();
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        btn.click();
      } catch (e) {}
    }

    // Try clicking AI Studio's native download button immediately in real-time
    let btnToClick = downloadBtn || findDownloadButton();
    if (btnToClick) {
      dockLog(`[4/5] Menekan tombol unduh Google AI Studio secara real-time...`, 'info');
      clickElementProperly(btnToClick);
    }

    // Strategy 0: Direct captured audio buffer from Main World interceptor
    if (lastCapturedAudioBuffer && lastCapturedAudioBuffer.byteLength >= MIN_SPEECH_AUDIO_BYTES) {
      dockLog(`[4/5] Menggunakan audio WAV yang langsung ditangkap dari memori (${(lastCapturedAudioBuffer.byteLength / 1024).toFixed(1)} KB)...`, 'info');
      audioResult = {
        buffer: lastCapturedAudioBuffer,
        size: lastCapturedAudioBuffer.byteLength,
        mimeType: 'audio/wav',
      };
      triggerBufferDownload(audioResult, targetFilename);
      return audioResult;
    }

    // Strategy 1: Extract directly from HTML5 Audio elements (including Shadow DOM)
    const audios = findAudioElementsEverywhere(document);
    let targetSrc = null;

    for (const a of audios) {
      const src = a.src || a.currentSrc || a.querySelector('source')?.src;
      if (src && !prevSet.has(src)) {
        targetSrc = src;
        break;
      }
    }

    if (!targetSrc && audios.length > 0) {
      targetSrc = audios[audios.length - 1].src || audios[audios.length - 1].currentSrc || audios[audios.length - 1].querySelector('source')?.src;
    }

    if (targetSrc) {
      dockLog('[4/5] Mengambil audio WAV langsung dari player Google AI Studio...', 'info');
      try {
        const response = await fetch(targetSrc);
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength >= MIN_SPEECH_AUDIO_BYTES) {
          audioResult = {
            buffer: arrayBuffer,
            size: arrayBuffer.byteLength,
            mimeType: blob.type || 'audio/wav',
          };
          dockLog(`[4/5] Audio WAV resmi terambil dari player (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)!`, 'success');
          triggerBufferDownload(audioResult, targetFilename);
          return audioResult;
        }
      } catch (e) {
        console.warn('[AI TTS] Could not fetch audio src directly:', e);
      }
    }

    // Strategy 2: Check captured blob from URL.createObjectURL
    if (!audioResult && lastCapturedBlob && lastCapturedBlob.size >= MIN_SPEECH_AUDIO_BYTES) {
      dockLog(`[4/5] Audio WAV ditangkap dari memori browser (${(lastCapturedBlob.size / 1024).toFixed(1)} KB)...`, 'info');
      const arrayBuffer = await lastCapturedBlob.arrayBuffer();
      audioResult = {
        buffer: arrayBuffer,
        size: arrayBuffer.byteLength,
        mimeType: lastCapturedBlob.type || 'audio/wav',
      };
      triggerBufferDownload(audioResult, targetFilename);
      return audioResult;
    }

    // Strategy 3: Check captured blob URL from download anchor
    if (!audioResult && lastCapturedBlobUrl && !lastCapturedBlobUrl.startsWith('blob:null')) {
      try {
        const res = await fetch(lastCapturedBlobUrl);
        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const header = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
        if (arrayBuffer.byteLength >= MIN_SPEECH_AUDIO_BYTES && header === 'RIFF') {
          audioResult = {
            buffer: arrayBuffer,
            size: arrayBuffer.byteLength,
            mimeType: blob.type || 'audio/wav',
          };
          dockLog(`[4/5] Audio WAV terambil dari tautan unduh (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)!`, 'success');
          triggerBufferDownload(audioResult, targetFilename);
          return audioResult;
        }
      } catch (e) {}
    }

    // Strategy 4: Trigger official download button in Google AI Studio & coordinate with Background service worker
    btnToClick = downloadBtn || findDownloadButton();
    if (btnToClick) {
      try {
        dockLog('[4/5] Menekan tombol unduh Google AI Studio untuk mengambil berkas WAV asli...', 'info');
        clickElementProperly(btnToClick);

        // Wait up to 8 seconds for download capture or audio buffer
        for (let i = 0; i < 35; i++) {
          await sleep(200);

          if (lastCapturedAudioBuffer && lastCapturedAudioBuffer.byteLength >= MIN_SPEECH_AUDIO_BYTES) {
            audioResult = {
              buffer: lastCapturedAudioBuffer,
              size: lastCapturedAudioBuffer.byteLength,
              mimeType: 'audio/wav',
            };
            dockLog(`[4/5] Berkas WAV resmi tertangkap (${(audioResult.size / 1024).toFixed(1)} KB)!`, 'success');
            break;
          }

          if (lastCapturedBlob && lastCapturedBlob.size >= MIN_SPEECH_AUDIO_BYTES) {
            const arrayBuffer = await lastCapturedBlob.arrayBuffer();
            if (arrayBuffer.byteLength >= MIN_SPEECH_AUDIO_BYTES) {
              audioResult = {
                buffer: arrayBuffer,
                size: arrayBuffer.byteLength,
                mimeType: lastCapturedBlob.type || 'audio/wav',
              };
              dockLog(`[4/5] Berkas WAV resmi tertangkap (${(audioResult.size / 1024).toFixed(1)} KB)!`, 'success');
              break;
            }
          }

          if (lastCapturedBlobUrl && !lastCapturedBlobUrl.startsWith('blob:null')) {
            try {
              const r = await fetch(lastCapturedBlobUrl);
              const b = await r.blob();
              if (b.size >= MIN_SPEECH_AUDIO_BYTES) {
                const buf = await b.arrayBuffer();
                audioResult = { buffer: buf, size: buf.byteLength, mimeType: b.type || 'audio/wav' };
                dockLog(`[4/5] Berkas WAV terambil dari download URL (${(buf.byteLength / 1024).toFixed(1)} KB)!`, 'success');
                break;
              }
            } catch (e) {}
          }

          // Check with background service worker if Chrome's downloads API captured it
          if (i % 3 === 0) {
            try {
              const bgAudio = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'GET_LATEST_CAPTURED_AUDIO' }, (r) => resolve(r));
              });
              if (bgAudio && bgAudio.hasAudio && bgAudio.base64Data && bgAudio.size >= MIN_SPEECH_AUDIO_BYTES) {
                const byteCharacters = atob(bgAudio.base64Data);
                const byteArray = new Uint8Array(byteCharacters.length);
                for (let bIdx = 0; bIdx < byteCharacters.length; bIdx++) {
                  byteArray[bIdx] = byteCharacters.charCodeAt(bIdx);
                }
                audioResult = {
                  buffer: byteArray.buffer,
                  size: byteArray.byteLength,
                  mimeType: 'audio/wav',
                };
                dockLog(`[4/5] Berkas WAV berhasil disinkronkan dari Chrome Download Manager (${(audioResult.size / 1024).toFixed(1)} KB)!`, 'success');
                break;
              } else if (bgAudio?.downloadUrl && !bgAudio.downloadUrl.startsWith('blob:null')) {
                const r = await fetch(bgAudio.downloadUrl);
                const b = await r.blob();
                if (b.size >= MIN_SPEECH_AUDIO_BYTES) {
                  const buf = await b.arrayBuffer();
                  audioResult = { buffer: buf, size: buf.byteLength, mimeType: b.type || 'audio/wav' };
                  dockLog(`[4/5] Berkas WAV terambil dari Background URL (${(buf.byteLength / 1024).toFixed(1)} KB)!`, 'success');
                  break;
                }
              }
            } catch (e) {}

            // If not yet captured after several ticks, re-trigger click on download button
            if (!audioResult && i >= 6) {
              const refreshBtn = findDownloadButton();
              if (refreshBtn) clickElementProperly(refreshBtn);
            }
          }
        }
      } catch (e) {
        console.warn('[AI TTS] Could not click download button:', e);
      }
    }

    if (audioResult) {
      dockLog(`[4/5] Audio WAV siap ditransfer (${(audioResult.size / 1024).toFixed(1)} KB, 100% audio nyata).`, 'success');
    }

    return audioResult;
  }

  async function uploadWavToDashboard(jobId, filename, arrayBuffer) {
    const cleanFilename = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
    const activeClient = currentJob?.clientId || clientId || 'default';

    // Verify buffer is not an HTML/JSON error response
    const header = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
    if (header.includes('<') || header.startsWith('{"')) {
      dockLog(`[5/5] Buffer audio bukan format audio yang valid (${header}).`, 'warn');
      return false;
    }

    // Prepare base64 representation
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);

    // Strategy 1: Direct JSON Base64 upload (cleanest, no multipart boundary issues)
    try {
      const res = await fetch(`${backendUrl}/api/audio/upload-base64/${jobId}?clientId=${encodeURIComponent(activeClient)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': activeClient,
        },
        body: JSON.stringify({
          filename: cleanFilename,
          base64Audio: base64Data,
          clientId: activeClient,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) return true;
        console.warn('[AI TTS Content] Direct JSON upload server message:', json.error);
      }
    } catch (jsonErr) {
      console.warn('[AI TTS Content] Direct JSON upload failed:', jsonErr.message);
    }

    // Strategy 2: Direct Multipart FormData upload
    try {
      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('audio', blob, cleanFilename);

      const res = await fetch(`${backendUrl}/api/audio/upload/${jobId}?clientId=${encodeURIComponent(activeClient)}`, {
        method: 'POST',
        headers: {
          'X-Client-Id': activeClient,
        },
        body: formData,
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) return true;
        console.warn('[AI TTS Content] Direct multipart upload server message:', json.error);
      }
    } catch (directErr) {
      console.warn('[AI TTS Content] Direct multipart fetch error:', directErr.message);
    }

    // Strategy 3: Background service worker proxy fallback (bypasses browser CORS & page origin completely)
    try {
      const proxyResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'PROXY_UPLOAD_AUDIO',
            payload: { jobId, filename: cleanFilename, base64Data, targetUrl: backendUrl, targetClientId: activeClient },
          },
          (r) => resolve(r)
        );
      });

      if (proxyResp && proxyResp.success && proxyResp.data?.success) {
        return true;
      }
      if (proxyResp?.data?.error) {
        console.error('[AI TTS Content] Background proxy upload rejected by server:', proxyResp.data.error);
      }
    } catch (proxyErr) {
      console.error('[AI TTS Content] Background proxy upload error:', proxyErr);
    }

    return false;
  }

  function notifyBackend(jobId, step, payload = {}) {
    try {
      const activeClient = currentJob?.clientId || clientId || 'default';
      fetch(`${backendUrl}/api/extension/report?clientId=${encodeURIComponent(activeClient)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': activeClient },
        body: JSON.stringify({ jobId, step, payload, clientId: activeClient }),
      }).catch(() => {});
    } catch (e) {}
  }

  function waitForElement(selectorFn, timeoutMs = 8000, label = 'Elemen') {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        try {
          const el = selectorFn();
          if (el) return resolve(el);
        } catch (e) {}

        if (Date.now() - startTime > timeoutMs) {
          return reject(new Error(`${label} tidak ditemukan di halaman Google AI Studio.`));
        }
        setTimeout(check, 300);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Listener for direct messages from background/popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { action, payload, jobId } = message;

    if (action === 'PING') {
      const diag = window.AI_STUDIO_SELECTORS ? window.AI_STUDIO_SELECTORS.runDiagnostics() : null;
      sendResponse({ status: 'PONG', ready: true, diagnostics: diag, url: window.location.href });
      return true;
    }

    if (action === 'SET_DOCK_VISIBILITY') {
      const isVisible = message.visible !== false;
      setDockVisibility(isVisible);
      sendResponse({ success: true, dockVisible: isVisible });
      return true;
    }

    if (action === 'TOGGLE_DOCK') {
      const dock = document.getElementById('ai-tts-automation-dock');
      const isHidden = !dock || dock.classList.contains('dock-hidden') || dock.style.display === 'none';
      setDockVisibility(isHidden);
      sendResponse({ success: true, dockVisible: isHidden });
      return true;
    }

    if (action === 'TRIGGER_FOLDER_PICKER') {
      if ('showDirectoryPicker' in window) {
        window.showDirectoryPicker({ mode: 'readwrite' })
          .then((dirHandle) => {
            if (dirHandle && dirHandle.name) {
              const cleanFolder = dirHandle.name;
              const subfolderInput = document.getElementById('ai-tts-dock-subfolder');
              const subfolderDisplay = document.getElementById('ai-tts-subfolder-display');
              if (subfolderInput) subfolderInput.value = cleanFolder;
              if (subfolderDisplay) subfolderDisplay.innerText = cleanFolder;
              chrome.storage.local.set({ downloadSubfolder: cleanFolder });
              chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: cleanFolder } });
              dockLog(`[FOLDER] Berhasil memilih folder perangkat: Downloads\\${cleanFolder}`, 'success');
              sendResponse({ success: true, folderName: cleanFolder });
            }
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });
        return true;
      }
      sendResponse({ success: false, error: 'showDirectoryPicker not supported' });
      return true;
    }

    if (action === 'PROCESS_JOB') {
      executeTTSJob(payload || { id: jobId });
      sendResponse({ status: 'ACCEPTED' });
      return true;
    }

    if (action === 'CAPTURE_DOWNLOAD_ITEM') {
      const { url, filename } = message;
      if (url && !url.startsWith('blob:null') && (url.startsWith('blob:http') || url.startsWith('http'))) {
        lastCapturedBlobUrl = url;
        dockLog(`[AI TTS] Berkas unduhan (${filename || 'audio.wav'}) terdeteksi, mengambil audio WAV...`, 'info');
        fetch(url)
          .then((r) => r.blob())
          .then(async (b) => {
            const buf = await b.arrayBuffer();
            const header = String.fromCharCode(...new Uint8Array(buf.slice(0, 4)));
            if (buf.byteLength >= 3000 && header === 'RIFF') {
              lastCapturedAudioBuffer = buf;
              lastCapturedBlob = b;
              dockLog(`[AI TTS] Berkas WAV asli berhasil ditangkap (${(buf.byteLength / 1024).toFixed(1)} KB)!`, 'success');
            }
          })
          .catch((err) => {
            console.warn('[AI TTS Content] Fetch download URL error:', err);
          });
      } else if (url && url.startsWith('blob:null')) {
        dockLog(`[AI TTS] Chrome sedang mengunduh berkas "${filename || 'audio.wav'}" ke folder Downloads PC...`, 'info');
      }
      sendResponse({ received: true });
      return true;
    }

    if (action === 'AUDIO_CONFIRMED_ON_WEBSITE') {
      const { jobId: confJobId, filename: confFilename } = message;
      if (currentJob && (currentJob.id === confJobId || currentJob.filename === confFilename)) {
        isWebsiteAudioConfirmed = true;
        dockLog(`[AI TTS] Sinyal dari website: Berkas "${confFilename || currentJob.filename}" sudah diterima & masuk Audio Library!`, 'success');
      }
      sendResponse({ confirmed: true });
      return true;
    }

    if (action === 'RUN_DIAGNOSTICS') {
      const diag = window.AI_STUDIO_SELECTORS ? window.AI_STUDIO_SELECTORS.runDiagnostics() : null;
      sendResponse({ success: true, diagnostics: diag });
      return true;
    }
  });
})();
