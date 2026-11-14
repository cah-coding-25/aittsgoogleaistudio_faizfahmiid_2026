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

  function isAiStudioTtsUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const u = new URL(rawUrl);
      if (u.hostname !== 'aistudio.google.com') return false;
      const p = (u.pathname || '/').toLowerCase();
      if (
        p.startsWith('/apps') ||
        p.startsWith('/apikey') ||
        p.startsWith('/settings') ||
        p.startsWith('/usage') ||
        p.startsWith('/billing') ||
        p.startsWith('/docs')
      ) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function hasExtensionContext() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  console.log('[AI TTS Extension] Initializing Real-time Automation Dock on Google AI Studio...');

  let backendUrl = 'http://localhost:3000';
  let clientId = 'default';
  let isExecuting = false;
  let currentJob = null;
  let pollingTimer = null;
  let heartbeatTimer = null;
  let isDockCollapsed = false;
  let directQueue = [];
  let isQueueActive = false;
  const sessionCompletedJobIds = new Set();
  const jobRetryAttempts = new Map();

  function sortJobsAscending(list) {
    return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.order)) && Number(a?.order) > 0 ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.order)) && Number(b?.order) > 0 ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
    });
  }

  function dataUrlToArrayBuffer(dataUrl) {
    try {
      const commaIdx = dataUrl.indexOf(',');
      const b64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      const binStr = atob(b64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (e) {
      return null;
    }
  }

  // Epoch-scoped fresh audio capture state (prevents EVER downloading stale/old audio!)
  let activeRunEpoch = 0;
  let capturedFreshDataUrl = null;
  let interceptedDownloadDataUrl = null;
  let lastCapturedBlob = null;
  let lastCapturedBlobUrl = null;
  let lastCapturedAudioBuffer = null;
  let isWebsiteAudioConfirmed = false;

  function sendInterceptorControl(type, active = false, epoch = 0) {
    try {
      window.dispatchEvent(new CustomEvent('__AI_TTS_SYNC_CONTROL__', {
        detail: { type, active, epoch },
      }));
    } catch (e) {}
    try {
      if (type === 'NEW_EPOCH') {
        window.postMessage({ type: '__AI_TTS_NEW_RUN_EPOCH__', epoch }, '*');
      } else if (type === 'SUPPRESS') {
        window.postMessage({ type: '__AI_TTS_SET_SUPPRESS_DOWNLOAD__', active, epoch }, '*');
      }
    } catch (e) {}
  }

  function setBackgroundDownloadGuard(active, ttlMs = 10000) {
    if (!hasExtensionContext()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 250);
      try {
        chrome.runtime.sendMessage(
          { type: 'SET_AUTOMATION_DOWNLOAD_GUARD', payload: { active, ttlMs } },
          () => {
            if (chrome.runtime.lastError) {}
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          }
        );
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      }
    });
  }

  // Listen to messages from MAIN world interceptor script
  window.addEventListener('message', async (ev) => {
    try {
      if (!ev.data) return;

      // 1. Intercepted <a download>.click() directly from clicking AI Studio's Download button
      if (ev.data.type === '__AI_TTS_INTERCEPTED_DOWNLOAD_DATAURL__' && ev.data.dataUrl) {
        if (activeRunEpoch > 0 && (!ev.data.epoch || ev.data.epoch === activeRunEpoch)) {
          interceptedDownloadDataUrl = ev.data.dataUrl;
          console.log('[AI TTS Content] Intercepted fresh Download button WAV:', ev.data.size, 'epoch:', activeRunEpoch);
        }
      }

      // 2. Fresh AudioContext / URL.createObjectURL captured strictly AFTER Run was clicked
      if (ev.data.type === '__AI_TTS_BLOB_DATA_CAPTURED__' && ev.data.dataUrl) {
        if (activeRunEpoch > 0 && ev.data.epoch === activeRunEpoch) {
          capturedFreshDataUrl = ev.data.dataUrl;
          console.log('[AI TTS Content] Fresh epoch WAV captured:', ev.data.size, ev.data.source);
        }
      }

      // Legacy fallback if base64Data is posted
      if (ev.data.type === '__AI_TTS_BLOB_DATA_CAPTURED__' && ev.data.base64Data) {
        if (activeRunEpoch > 0 && ev.data.epoch === activeRunEpoch) {
          capturedFreshDataUrl = `data:audio/wav;base64,${ev.data.base64Data}`;
        }
      }
    } catch (err) {}
  });

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca data audio blob.'));
      reader.readAsDataURL(blob);
    });
  }

  function normalizeWavDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const b64 = dataUrl.slice(commaIdx + 1);
    try {
      const buf = dataUrlToArrayBuffer(dataUrl);
      if (!buf || buf.byteLength < 44) return null;
      const bytes = new Uint8Array(buf);
      const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
      if (riff !== 'RIFF' || wave !== 'WAVE') return null;

      const view = new DataView(buf);
      let offset = 12;
      let fmtFound = false;
      let dataFound = false;
      let channels = 0;
      let sampleRate = 0;
      let byteRate = 0;
      let bitsPerSample = 0;
      let dataSize = 0;

      while (offset <= bytes.length - 8) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = view.getUint32(offset + 4, true);
        if (id === 'fmt ' && offset + 24 <= bytes.length) {
          channels = view.getUint16(offset + 10, true);
          sampleRate = view.getUint32(offset + 12, true);
          byteRate = view.getUint32(offset + 16, true);
          bitsPerSample = view.getUint16(offset + 22, true);
          fmtFound = true;
        } else if (id === 'data') {
          const remaining = Math.max(0, bytes.length - (offset + 8));
          dataSize = size > 0 ? Math.min(size, remaining) : remaining;
          dataFound = true;
          break;
        }
        const step = 8 + size + (size % 2);
        if (step <= 8) break;
        offset += step;
      }

      if (!fmtFound || !dataFound || channels < 1 || sampleRate < 4000 || dataSize <= 0) return null;
      const effectiveByteRate = byteRate > 0 ? byteRate : Math.max(1, sampleRate * channels * Math.max(1, Math.floor(bitsPerSample / 8)));
      const duration = dataSize / effectiveByteRate;
      if (!Number.isFinite(duration) || duration <= 0.1) return null;
    } catch (e) {
      return null;
    }
    return `data:audio/wav;base64,${b64}`;
  }

  // Retrieve saved backendUrl, clientId, dockVisible, and explicit queueActive state
  try {
    if (hasExtensionContext()) {
      chrome.storage.local.get(['backendUrl', 'clientId', 'dockVisible', 'queueActive'], (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.backendUrl) {
          backendUrl = res.backendUrl.replace(/\/$/, '');
        }
        if (res?.clientId) {
          clientId = res.clientId;
        }
        isQueueActive = res?.queueActive === true;
        if (isAiStudioTtsUrl(window.location.href)) {
          startAutoRunner();
          if (res?.dockVisible === false) {
            setDockVisibility(false);
          }
          updateDockBackendUI();
        }
      });

      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes.queueActive) {
            isQueueActive = changes.queueActive.newValue === true;
            if (!isQueueActive) {
              directQueue = [];
            }
          }
        });
      }
    }
  } catch (e) {
    if (isAiStudioTtsUrl(window.location.href)) {
      startAutoRunner();
    }
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
        background: #030712 !important;
        border-left: 1.5px solid #06b6d4 !important;
        color: #f1f5f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        box-shadow: none !important; /* HILANGKAN BINTIK / BAYANGAN HITAM KE GOOGLE AI STUDIO */
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }
      #ai-tts-automation-dock.dock-hidden {
        display: none !important;
      }
      #ai-tts-automation-dock.collapsed {
        transform: translateX(calc(100% - 22px)) !important;
      }
      /* Sleret tipis yang muncul HANYA saat dock disembunyikan / collapsed */
      #ai-tts-dock-collapsed-strip {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 22px !important;
        height: 100vh !important;
        background: #0b1120 !important;
        border-left: 2px solid #06b6d4 !important;
        cursor: pointer !important;
        display: none !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        z-index: 100 !important;
        box-sizing: border-box !important;
        user-select: none !important;
      }
      #ai-tts-dock-collapsed-strip:hover {
        background: #155e75 !important;
      }
      #ai-tts-automation-dock.collapsed #ai-tts-dock-collapsed-strip {
        display: flex !important;
      }
      /* Tombol kontrol di header - RAPI, SEJAJAR & TIDAK MENONJOL KE LUAR */
      .ai-tts-header-btn {
        background: rgba(30, 41, 59, 0.85) !important;
        border: 1px solid #334155 !important;
        color: #cbd5e1 !important;
        border-radius: 6px !important;
        padding: 3px 7px !important;
        font-size: 10px !important;
        line-height: 1.2 !important;
        cursor: pointer !important;
        font-weight: 600 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
        transition: all 0.15s !important;
      }
      .ai-tts-header-btn:hover {
        background: #334155 !important;
        color: #ffffff !important;
      }
      .ai-tts-close-btn {
        width: 22px !important;
        height: 22px !important;
        padding: 0 !important;
        background: rgba(239, 68, 68, 0.18) !important;
        border-color: rgba(239, 68, 68, 0.45) !important;
        color: #fca5a5 !important;
        font-size: 10.5px !important;
      }
      .ai-tts-close-btn:hover {
        background: rgba(239, 68, 68, 0.35) !important;
        color: #ffffff !important;
      }
      #ai-tts-dock-toggle {
        display: none !important; /* Hilangkan tombol kotak biru yang menonjol keluar */
      }
      .ai-tts-header {
        padding: 10px 12px !important;
        background: #0b1120 !important;
        border-bottom: 1px solid #1e293b !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 7px !important;
      }
      .ai-tts-header-top {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 6px !important;
        width: 100% !important;
      }
      .ai-tts-header-bottom {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 8px !important;
        width: 100% !important;
        padding-top: 6px !important;
        border-top: 1px solid rgba(30, 41, 59, 0.85) !important;
      }
      .ai-tts-title {
        font-size: 13px !important;
        font-weight: 800 !important;
        color: #38bdf8 !important;
        letter-spacing: -0.2px !important;
        display: flex !important;
        align-items: center !important;
        gap: 5px !important;
        min-width: 0 !important;
        white-space: nowrap !important;
      }
      .ai-tts-logo-img {
        width: 20px !important;
        height: 20px !important;
        border-radius: 5px !important;
        object-fit: cover !important;
        flex-shrink: 0 !important;
        border: 1px solid rgba(56, 189, 248, 0.35) !important;
      }
      .ai-tts-subtitle {
        font-size: 10px !important;
        color: #94a3b8 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        min-width: 0 !important;
      }
      .ai-tts-author-badge {
        font-size: 8.5px !important;
        background: rgba(99, 102, 241, 0.2) !important;
        border: 1px solid rgba(99, 102, 241, 0.4) !important;
        color: #a5b4fc !important;
        padding: 1.5px 5px !important;
        border-radius: 4px !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
        flex-shrink: 0 !important;
      }
      .ai-tts-body {
        flex: 1 !important;
        overflow-y: auto !important;
        padding: 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
      }
      .ai-tts-card {
        background: #0b1120 !important;
        border: 1px solid #1e293b !important;
        border-radius: 8px !important;
        padding: 10px 12px !important;
      }
      .ai-tts-card-title {
        font-size: 10px !important;
        font-weight: 700 !important;
        color: #94a3b8 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        margin-bottom: 6px !important;
        display: flex !important;
        justify-content: space-between !important;
      }
      .ai-tts-status-badge {
        font-size: 9.5px !important;
        font-weight: 700 !important;
        padding: 2px 8px !important;
        border-radius: 9999px !important;
      }
      .ai-tts-badge-online { background: rgba(16, 185, 129, 0.2) !important; color: #34d399 !important; border: 1px solid rgba(16, 185, 129, 0.4) !important; }
      .ai-tts-badge-waiting { background: rgba(245, 158, 11, 0.2) !important; color: #fbbf24 !important; border: 1px solid rgba(245, 158, 11, 0.4) !important; }
      .ai-tts-badge-offline { background: rgba(239, 68, 68, 0.2) !important; color: #f87171 !important; border: 1px solid rgba(239, 68, 68, 0.4) !important; }
      .ai-tts-url-input {
        width: 100% !important;
        background: #030712 !important;
        border: 1px solid #334155 !important;
        border-radius: 6px !important;
        color: #f8fafc !important;
        font-size: 11px !important;
        font-family: monospace !important;
        padding: 6px 8px !important;
        box-sizing: border-box !important;
      }
      .ai-tts-btn {
        background: #0284c7 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 6px 10px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
        transition: opacity 0.15s !important;
      }
      .ai-tts-btn:hover { opacity: 0.9 !important; }
      .ai-tts-btn-secondary { background: #1e293b !important; color: #cbd5e1 !important; border: 1px solid #334155 !important; }
      .ai-tts-step-list {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
        font-size: 11px !important;
      }
      .ai-tts-step-item {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
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
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        background: #334155 !important;
      }
      .ai-tts-step-item.active .ai-tts-step-dot {
        background: #38bdf8 !important;
        box-shadow: 0 0 8px #38bdf8 !important;
      }
      .ai-tts-step-item.done .ai-tts-step-dot {
        background: #34d399 !important;
      }
      .ai-tts-console {
        background: #020617 !important;
        border: 1px solid #1e293b !important;
        border-radius: 6px !important;
        padding: 8px !important;
        height: 120px !important;
        overflow-y: auto !important;
        font-family: monospace !important;
        font-size: 10px !important;
        color: #94a3b8 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
      }
      .ai-tts-console-line { word-break: break-all !important; }
      .ai-tts-console-success { color: #34d399 !important; font-weight: bold !important; }
      .ai-tts-console-warn { color: #fbbf24 !important; font-weight: bold !important; }
      .ai-tts-console-error { color: #f87171 !important; font-weight: bold !important; }
      .ai-tts-console-info { color: #38bdf8 !important; }
    `;
    document.head.appendChild(style);
  }

  // Create and inject the Locked Sidebar Dock
  function createDock() {
    if (document.getElementById('ai-tts-automation-dock')) return;
    injectDockStyles();

    const fallbackLogoDataUri = 'data:image/png;base64,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';
    let dockIconUrl = fallbackLogoDataUri;
    try {
      if (hasExtensionContext() && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        dockIconUrl = chrome.runtime.getURL('icons/icon48.png');
      }
    } catch {}

    const dock = document.createElement('div');
    dock.id = 'ai-tts-automation-dock';
    dock.innerHTML = `
      <!-- Sleret tipis yang muncul HANYA saat dock disembunyikan (collapsed) -->
      <div id="ai-tts-dock-collapsed-strip" title="Klik untuk menampilkan kembali FahVoiceForge">
        <span style="font-size: 13px; color: #38bdf8; font-weight: bold;">◀</span>
        <span style="writing-mode: vertical-rl; transform: rotate(180deg); font-size: 8.5px; letter-spacing: 1.5px; color: #94a3b8; font-weight: 700;">FORGE</span>
      </div>

      <div class="ai-tts-header">
        <div class="ai-tts-header-top">
          <div class="ai-tts-title">
            <img id="ai-tts-dock-logo" src="${dockIconUrl}" alt="FahVoiceForge" class="ai-tts-logo-img" />
            <span>FahVoiceForge</span>
            <span class="ai-tts-author-badge">Faiz_Fahmi_ID</span>
          </div>
          <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
            <button id="ai-tts-btn-collapse-header" class="ai-tts-header-btn" title="Sembunyikan dock ke samping kanan (jadi sleret tipis)">▶ Sembunyi</button>
            <button id="ai-tts-btn-close-dock" class="ai-tts-header-btn ai-tts-close-btn" title="Matikan sidebar ini">✕</button>
          </div>
        </div>
        <div class="ai-tts-header-bottom">
          <div class="ai-tts-subtitle">Google AI Studio Realtime Auto-Runner</div>
          <div id="ai-tts-conn-badge" class="ai-tts-status-badge ai-tts-badge-waiting" style="white-space: nowrap; flex-shrink: 0;">MEMERIKSA</div>
        </div>
      </div>

      <div class="ai-tts-body">
        <!-- Target Server URL Section -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Target Web Dashboard:</span>
            <span id="ai-tts-latency" style="color: #64748b; font-family: monospace;">- ms</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="ai-tts-dock-url" class="ai-tts-url-input" value="${backendUrl}" placeholder="https://app.vercel.app atau http://localhost:3000" spellcheck="false" />
            <button id="ai-tts-btn-save-url" class="ai-tts-btn" style="padding: 4px 8px; font-size: 10px;">Simpan</button>
          </div>
        </div>

        <!-- Download Folder Setting Section -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Folder Simpan WAV Ekstensi:</span>
            <span id="ai-tts-folder-badge" style="color: #38bdf8; font-family: monospace;">unduhan (Ekstensi)</span>
          </div>
          <div id="ai-tts-folder-status-display" style="font-size: 10.5px; color: #e2e8f0; background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 6px 8px; font-family: monospace; word-break: break-all; margin-bottom: 6px;">
            Memeriksa folder unduhan ekstensi...
          </div>
          <button id="ai-tts-btn-pick-ext-folder" class="ai-tts-btn" style="width: 100%; font-size: 10.5px;">
            📂 Pilih Folder Ekstensi / unduhan
          </button>
          <div style="font-size: 9.5px; color: #64748b; margin-top: 5px;">
            WAV otomatis masuk ke folder <code>unduhan</code> milik ekstensi (tidak membuat folder baru di Downloads). Unduhan manual di AI Studio tidak masuk ke sini.
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
            <div style="font-style: italic; color: #94a3b8; margin-top: 2px; max-height: 40px; overflow: hidden; text-overflow: ellipsis;" id="ai-tts-job-text">
              Klik "MULAI ANTREAN" di website dashboard untuk memulai otomatisasi.
            </div>
          </div>
        </div>

        <!-- Real-time Step Checklist -->
        <div class="ai-tts-card">
          <div class="ai-tts-card-title">
            <span>Alur Otomatisasi Realtime</span>
            <span id="ai-tts-step-counter" style="color: #38bdf8;">0/5</span>
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
        <div class="ai-tts-card" style="padding: 8px 10px;">
          <div class="ai-tts-card-title" style="margin-bottom: 4px;">
            <span>Log Konsol Realtime</span>
            <span style="font-size: 9px; cursor: pointer; color: #38bdf8;" id="ai-tts-clear-console">Clear</span>
          </div>
          <div class="ai-tts-console" id="ai-tts-console-box">
            <div class="ai-tts-console-line ai-tts-console-info">[DOCK] FahVoiceForge Dock terpasang di Google AI Studio.</div>
          </div>
        </div>

        <!-- Action Controls -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
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

    const dockLogoImg = document.getElementById('ai-tts-dock-logo');
    if (dockLogoImg) {
      dockLogoImg.addEventListener('error', () => {
        if (dockLogoImg.dataset.fallbackApplied) return;
        dockLogoImg.dataset.fallbackApplied = '1';
        dockLogoImg.src = fallbackLogoDataUri;
      });
    }

    // Dock collapse & expand events
    const collapseBtn = document.getElementById('ai-tts-btn-collapse-header');
    const stripBtn = document.getElementById('ai-tts-dock-collapsed-strip');

    const toggleCollapse = (collapse) => {
      isDockCollapsed = typeof collapse === 'boolean' ? collapse : !isDockCollapsed;
      if (isDockCollapsed) {
        dock.classList.add('collapsed');
      } else {
        dock.classList.remove('collapsed');
      }
    };

    collapseBtn?.addEventListener('click', () => toggleCollapse(true));
    stripBtn?.addEventListener('click', () => toggleCollapse(false));

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

    // Refresh & link extension `unduhan` folder button
    const btnPickExtFolder = document.getElementById('ai-tts-btn-pick-ext-folder');
    refreshDockFolderStatus();

    btnPickExtFolder?.addEventListener('click', () => {
      if (!hasExtensionContext()) return;
      chrome.runtime.sendMessage({ type: 'OPEN_FOLDER_PICKER' }, () => {
        if (chrome.runtime.lastError) return;
        dockLog('Tab Sambungkan Folder "unduhan" Ekstensi dibuka. Pilih folder ekstensi atau subfolder unduhan di dalamnya.', 'info');
      });
    });

    try {
      if (hasExtensionContext() && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes.linkedFolderName || changes.linkedFolderMode || changes.detectedExtFolder || changes.downloadSubfolder) {
            refreshDockFolderStatus();
          }
        });
      }
    } catch (e) {}

    // Inspect button
    document.getElementById('ai-tts-btn-inspect').addEventListener('click', () => {
      const diag = window.AI_STUDIO_SELECTORS ? window.AI_STUDIO_SELECTORS.runDiagnostics() : null;
      dockLog(`Diagnostik: Input=${diag?.textInputFound}, Run=${diag?.runButtonFound}, Audio=${diag?.audioOutputFound}`, diag?.textInputFound && diag?.runButtonFound ? 'success' : 'error');
    });

    // Open Dashboard button
    document.getElementById('ai-tts-btn-open-dash').addEventListener('click', () => {
      if (hasExtensionContext()) {
        chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', payload: { backendUrl } }).catch(() => {
          window.open(backendUrl, '_blank');
        });
      } else {
        window.open(backendUrl, '_blank');
      }
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
    try {
      if (hasExtensionContext()) {
        chrome.storage.local.get(['dockVisible'], (res) => {
          if (chrome.runtime.lastError) return;
          if (res?.dockVisible === false) {
            setDockVisibility(false);
          }
        });
      }
    } catch (e) {}
  }

  function setDockVisibility(visible) {
    const dock = document.getElementById('ai-tts-automation-dock');
    if (!dock) return;
    if (visible) {
      dock.style.setProperty('display', 'flex', 'important');
      dock.classList.remove('dock-hidden');
    } else {
      dock.style.setProperty('display', 'none', 'important');
      dock.classList.add('dock-hidden');
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
      type === 'success'
        ? 'ai-tts-console-success'
        : type === 'error'
        ? 'ai-tts-console-error'
        : type === 'warn'
        ? 'ai-tts-console-warn'
        : type === 'info'
        ? 'ai-tts-console-info'
        : ''
    }`;
    line.innerText = `[${time}] ${message}`;
    box.appendChild(line);
    while (box.children.length > 150) {
      box.removeChild(box.firstElementChild);
    }
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

  function refreshDockFolderStatus() {
    if (!hasExtensionContext()) return;
    const statusEl = document.getElementById('ai-tts-folder-status-display');
    const badgeEl = document.getElementById('ai-tts-folder-badge');
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (statusEl) {
          statusEl.innerText = res.effectiveTargetLabel || 'Belum Terhubung — Klik Pilih Folder Ekstensi';
          statusEl.style.color = res.linkedFolderGranted ? '#34d399' : res.detectedExtFolder ? '#38bdf8' : '#fbbf24';
        }
        if (badgeEl) {
          badgeEl.innerText = res.linkedFolderGranted
            ? 'TERHUBUNG LANGSUNG'
            : res.detectedExtFolder
            ? 'AUTO-EKSTENSI'
            : 'PERLU SAMBUNG';
          badgeEl.style.color = res.linkedFolderGranted ? '#34d399' : res.detectedExtFolder ? '#38bdf8' : '#fbbf24';
        }
      });
    } catch (e) {}
  }

  // --- AUTOMATION ENGINE (REAL-TIME AUTO RUNNER) ---
  async function pickAndExecuteNextJob() {
    if (isExecuting) return;
    if (!hasExtensionContext()) return;
    if (!isAiStudioTtsUrl(window.location.href)) return;

    // Sync explicit queueActive state from storage so stopped/unstarted queues NEVER auto-run
    try {
      const stateRes = await new Promise((resolve) => {
        chrome.storage.local.get(['activeQueue', 'queueActive'], (data) => {
          if (chrome.runtime.lastError) return resolve({});
          resolve(data || {});
        });
      });

      if (typeof stateRes.queueActive === 'boolean') {
        isQueueActive = stateRes.queueActive;
      }

      if (isQueueActive) {
        const isPendingJob = (j) =>
          j &&
          !sessionCompletedJobIds.has(j.id) &&
          j.status !== 'COMPLETED' &&
          j.status !== 'FAILED' &&
          j.status !== 'CANCELLED' &&
          (j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING' || !j.status);

        // 1. First Priority: In-memory direct queue sorted strictly #1 -> last (unlimited)
        if (directQueue && directQueue.length > 0) {
          directQueue = sortJobsAscending(directQueue);
          const nextPending = directQueue.find(isPendingJob);
          if (nextPending) {
            nextPending.status = 'SENDING_TEXT';
            try {
              chrome.storage.local.set({ activeQueue: directQueue, queueActive: true });
            } catch (e) {}
            await executeTTSJob(nextPending);
            return;
          }
        }

        // 2. Second Priority: chrome.storage.local activeQueue sorted strictly #1 -> last (unlimited)
        if (Array.isArray(stateRes.activeQueue) && stateRes.activeQueue.length > 0 && !isExecuting) {
          const sortedStorage = sortJobsAscending(stateRes.activeQueue);
          const nextFromStorage = sortedStorage.find(isPendingJob);
          if (nextFromStorage) {
            nextFromStorage.status = 'SENDING_TEXT';
            directQueue = sortedStorage;
            try {
              chrome.storage.local.set({ activeQueue: sortedStorage, queueActive: true });
            } catch (e) {}
            await executeTTSJob(nextFromStorage);
            return;
          }
        }
      }
    } catch (e) {}

    // 3. Third Priority: Poll backend /api/extension/next-job (STRICTLY runs only if queue is RUNNING!)
    try {
      const activeClient = clientId || 'default';
      const res = await fetch(`${backendUrl}/api/extension/next-job?clientId=${encodeURIComponent(activeClient)}`, {
        headers: {
          'X-Client-Id': activeClient,
        },
      });
      if (!res.ok) return;
      const data = await res.json();

      if (data.success && data.hasJob && data.job && !sessionCompletedJobIds.has(data.job.id)) {
        if (data.queueState === 'RUNNING' || isQueueActive) {
          // Enforce strict ascending order if directQueue still holds a lower-order unfinished item
          if (directQueue && directQueue.length > 0) {
            directQueue = sortJobsAscending(directQueue);
            const firstLocal = directQueue.find(
              (j) => j && !sessionCompletedJobIds.has(j.id) && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED'
            );
            const backendOrder = Number(data.job.order) || Number.MAX_SAFE_INTEGER;
            const localOrder = Number(firstLocal?.order) || Number.MAX_SAFE_INTEGER;
            if (firstLocal && firstLocal.id !== data.job.id && localOrder < backendOrder) {
              firstLocal.status = 'SENDING_TEXT';
              isQueueActive = true;
              await executeTTSJob(firstLocal);
              return;
            }
          }
          isQueueActive = true;
          await executeTTSJob(data.job);
          return;
        }
      } else if (isQueueActive && directQueue.length > 0) {
        const anyLeft = directQueue.some(
          (j) =>
            j &&
            !sessionCompletedJobIds.has(j.id) &&
            j.status !== 'COMPLETED' &&
            j.status !== 'FAILED' &&
            j.status !== 'CANCELLED'
        );
        if (!anyLeft) {
          isQueueActive = false;
          directQueue = [];
          try {
            chrome.storage.local.set({ activeQueue: [], queueActive: false });
          } catch (e) {}
          const stEl = document.getElementById('ai-tts-job-status');
          if (stEl) stEl.innerText = 'SEMUA ANTREAN SELESAI';
          dockLog('[ANTREAN] Seluruh antrean suara sampai scene terakhir telah selesai!', 'success');
        }
      }
    } catch (err) {
      // Backend temporarily unreachable
    }
  }

  function startAutoRunner() {
    if (!isAiStudioTtsUrl(window.location.href)) return;
    createDock();
    refreshDockFolderStatus();
    if (pollingTimer) clearInterval(pollingTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Initial announce to background
    try {
      if (hasExtensionContext()) {
        chrome.runtime.sendMessage({
          type: 'AI_STUDIO_TAB_READY',
          url: window.location.href,
        }).catch(() => {});
      }
    } catch (e) {}

    // Polling loop every 800ms for realtime responsiveness
    pollingTimer = setInterval(() => {
      if (!hasExtensionContext()) {
        clearInterval(pollingTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        return;
      }
      if (!isAiStudioTtsUrl(window.location.href)) {
        const dock = document.getElementById('ai-tts-automation-dock');
        if (dock) dock.style.setProperty('display', 'none', 'important');
        return;
      }
      if (!isExecuting) {
        pickAndExecuteNextJob();
      }
    }, 800);

    // Also send periodic heartbeat to backend
    heartbeatTimer = setInterval(() => {
      if (!hasExtensionContext()) {
        clearInterval(heartbeatTimer);
        return;
      }
      if (!isAiStudioTtsUrl(window.location.href)) return;
      try {
        const activeClient = clientId || 'default';
        fetch(`${backendUrl}/api/extension/heartbeat?clientId=${encodeURIComponent(activeClient)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': activeClient },
          body: JSON.stringify({
            aiStudioConnected: true,
            activeUrl: window.location.href,
            version: '1.2.0',
            clientId: activeClient,
          }),
        }).catch(() => {});
      } catch (e) {}
    }, 5000);
  }

  // Master job execution flow
  async function executeTTSJob(job) {
    if (isExecuting) return;
    if (!hasExtensionContext() || !isAiStudioTtsUrl(window.location.href)) return;
    isExecuting = true;
    currentJob = job;

    const fnEl = document.getElementById('ai-tts-job-filename');
    const txEl = document.getElementById('ai-tts-job-text');
    const stEl = document.getElementById('ai-tts-job-status');

    if (fnEl) fnEl.innerText = `#${job.order} — ${job.filename}`;
    if (txEl) txEl.innerText = `"${job.text}"`;
    if (stEl) stEl.innerText = 'SEDANG DIPROSES';

    dockLog(`Mulai memproses pekerjaan #${job.order} (${job.filename})`, 'info');

    // Clear old audio state & sync target filename with background service worker
    activeRunEpoch = 0;
    capturedFreshDataUrl = null;
    interceptedDownloadDataUrl = null;
    lastCapturedBlob = null;
    lastCapturedBlobUrl = null;
    lastCapturedAudioBuffer = null;

    try {
      chrome.runtime.sendMessage({
        type: 'SET_CURRENT_DOWNLOAD_NAME',
        payload: { filename: job.filename, jobId: job.id },
      }).catch(() => {});
    } catch (e) {}

    try {
      // TAHAP 1: WAJIB Menempel Teks ke Kolom Speaker (Hapus teks lama/template bawaan)
      setStep(1);
      dockLog(`[1/5] Mencari kolom dialog Speaker & membersihkan teks lama...`, 'info');

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
      await sleep(60);

      notifyBackend(job.id, 'TEXT_INSERTED');
      dockLog(`[1/5] Teks "${job.text.substring(0, 30)}..." berhasil ditempel ke Speaker!`, 'success');

      // TAHAP 2: WAJIB Menekan Tombol Run Ctrl Nyata
      setStep(2);
      await sleep(40);
      dockLog(`[2/5] Mempersiapkan klik tombol Run Ctrl nyata...`, 'info');

      // Snapshot state SEBELUM Run diklik (agar TIDAK pernah mengunduh file yang sudah ada!)
      const preExistingAudios = getAudioSources();
      const oldDownloadBtn = findDownloadButton();

      // Mulai epoch baru -> audio yang ditangkap hanya valid jika muncul SETELAH klik Run ini!
      activeRunEpoch = Date.now();
      capturedFreshDataUrl = null;
      interceptedDownloadDataUrl = null;
      sendInterceptorControl('NEW_EPOCH', false, activeRunEpoch);

      // Tunggu sampai tombol Run benar-benar tersedia (bukan Stop) dan aktif
      const runBtn = await waitForElement(() => {
        if (!window.AI_STUDIO_SELECTORS) return null;
        for (const strat of window.AI_STUDIO_SELECTORS.runButton.strategies) {
          try {
            const el = strat();
            if (el) return el;
          } catch (e) {}
        }
        return null;
      }, 15000, 'Tombol Run Ctrl ↵');

      await triggerRunAction(runBtn, inputEl, oldDownloadBtn);
      notifyBackend(job.id, 'RUN_CLICKED');
      dockLog(`[2/5] Tombol Run Ctrl nyata berhasil ditekan!`, 'success');

      // TAHAP 3: Masa Loading -> WAJIB Tunggu Sampai Selesai & Tombol Unduh Muncul
      setStep(3);
      if (stEl) stEl.innerText = 'MASA LOADING...';
      dockLog(`[3/5] Masa loading: menunggu AI Studio selesai memproses suara hingga tombol unduh muncul...`, 'info');
      notifyBackend(job.id, 'GENERATION_STARTED');

      const downloadBtn = await waitForDownloadButtonAppearance(oldDownloadBtn, preExistingAudios);
      notifyBackend(job.id, 'GENERATION_COMPLETED');
      dockLog(`[3/5] Proses suara selesai! Tombol unduh baru resmi muncul.`, 'success');

      // TAHAP 4: WAJIB Unduh File WAV Asli ke Folder Pilihan (TANPA Popup Simpan!)
      setStep(4);
      if (stEl) stEl.innerText = 'MENGUNDUH WAV...';
      dockLog(`[4/5] Menekan tombol unduh untuk "${job.filename}.wav" & menyimpan langsung ke folder...`, 'info');

      try {
        if (hasExtensionContext()) {
          chrome.runtime.sendMessage({
            type: 'SET_CURRENT_DOWNLOAD_NAME',
            payload: { filename: job.filename, jobId: job.id },
          }).catch(() => {});
        }
      } catch (e) {}

      const saveResult = await downloadAndSaveRealWav(preExistingAudios, downloadBtn, job.filename, job.id);
      if (!saveResult || !saveResult.success) {
        throw new Error(saveResult?.error || 'Gagal menyimpan file WAV ke folder unduhan.');
      }

      // TAHAP 5: Selesai Unduh Sempurna -> Kirim WAV ke Website & Lanjut Antrean Berikutnya!
      setStep(5);
      if (stEl) stEl.innerText = 'SELESAI (COMPLETED)';
      dockLog(`[5/5] Berkas "${saveResult.path || job.filename + '.wav'}" tersimpan sempurna ke folder!`, 'success');
      refreshDockFolderStatus();

      sessionCompletedJobIds.add(job.id);

      // Update local directQueue and chrome.storage.local activeQueue status to COMPLETED
      if (directQueue && directQueue.length > 0) {
        const idx = directQueue.findIndex((j) => j.id === job.id || j.filename === job.filename);
        if (idx !== -1) {
          directQueue[idx].status = 'COMPLETED';
        }
      }
      try {
        if (hasExtensionContext()) {
          const stData = await new Promise((resolve) => {
            chrome.storage.local.get(['activeQueue'], (d) => {
              if (chrome.runtime.lastError) return resolve({});
              resolve(d || {});
            });
          });
          const storedList = Array.isArray(stData?.activeQueue) ? stData.activeQueue : [];
          const updatedStored = storedList.map((j) =>
            j.id === job.id || j.filename === job.filename ? { ...j, status: 'COMPLETED' } : j
          );
          chrome.storage.local.set({ activeQueue: directQueue.length > 0 ? directQueue : updatedStored });
        }
      } catch (e) {}

      // Upload WAV & laporkan completion secara paralel secara realtime (tanpa delay buatan)
      const notifyPromise = Promise.race([
        notifyBackend(job.id, 'JOB_COMPLETED', {
          filename: job.filename,
          wavDownloaded: true,
        }),
        sleep(2500),
      ]);

      let uploadPromise = Promise.resolve(false);
      if (saveResult.dataUrl) {
        const wavBuf = dataUrlToArrayBuffer(saveResult.dataUrl);
        if (wavBuf && wavBuf.byteLength >= 1000 && wavBuf.byteLength <= 15 * 1024 * 1024) {
          dockLog(`[5/5] Mengirim "${job.filename}.wav" ke Website Dashboard...`, 'info');
          uploadPromise = Promise.race([
            uploadWavToDashboard(job.id, job.filename, wavBuf),
            sleep(2500),
          ]).catch(() => false);
        }
      }

      await Promise.all([uploadPromise, notifyPromise]);

      try {
        chrome.runtime.sendMessage({
          type: 'JOB_COMPLETED_NOTIFY',
          payload: { id: job.id, filename: job.filename },
        }).catch(() => {});
      } catch (e) {}

      jobRetryAttempts.delete(job.id);
      dockLog(`[SELESAI] "${job.filename}.wav" selesai & dikirim! Lanjut ke scene berikutnya...`, 'success');
    } catch (err) {
      console.warn('[AI TTS Content] Execution notice:', err?.message || err);
      const maxRetries = Math.max(1, Number(job.maxRetries) || 3);
      const attempt = (jobRetryAttempts.get(job.id) || 0) + 1;
      const canRetryInPlace = isQueueActive && attempt < maxRetries;

      if (canRetryInPlace) {
        jobRetryAttempts.set(job.id, attempt);
        dockLog(`[ULANG ${attempt}/${maxRetries}] #${job.order} (${job.filename}) terkendala (${err.message}). Mengulang scene #${job.order} sebelum lanjut...`, 'warn');
        if (directQueue && directQueue.length > 0) {
          const idx = directQueue.findIndex((j) => j.id === job.id || j.filename === job.filename);
          if (idx !== -1) {
            directQueue[idx].status = 'PENDING';
            try {
              chrome.storage.local.set({ activeQueue: directQueue, queueActive: true });
            } catch (e) {}
          }
        }
        await Promise.race([
          notifyBackend(job.id, 'JOB_FAILED', {
            error: err.message,
            retrying: true,
            retryCount: attempt,
            finalFailure: false,
          }),
          sleep(1500),
        ]);
        if (stEl) stEl.innerText = `MENGULANG (${attempt}/${maxRetries})`;
        await sleep(1500);
      } else {
        jobRetryAttempts.delete(job.id);
        dockLog(`GAGAL: #${job.order} (${job.filename}) — ${err.message}`, 'error');
        sessionCompletedJobIds.add(job.id);
        if (directQueue && directQueue.length > 0) {
          const idx = directQueue.findIndex((j) => j.id === job.id || j.filename === job.filename);
          if (idx !== -1) {
            directQueue[idx].status = 'FAILED';
            try {
              chrome.storage.local.set({ activeQueue: directQueue });
            } catch (e) {}
          }
        }
        await Promise.race([
          notifyBackend(job.id, 'JOB_FAILED', {
            error: err.message,
            retrying: false,
            retryCount: attempt,
            finalFailure: true,
          }),
          sleep(2000),
        ]);
        if (stEl) stEl.innerText = 'GAGAL (FAILED)';
        await sleep(400);
      }
    } finally {
      sendInterceptorControl('SUPPRESS', false, 0);
      setBackgroundDownloadGuard(false).catch(() => {});
      activeRunEpoch = 0;
      isExecuting = false;
      currentJob = null;
      setTimeout(() => {
        pickAndExecuteNextJob();
      }, 50);
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

  function isGeneratingActive() {
    if (window.AI_STUDIO_SELECTORS?.generatingIndicator) {
      for (const strat of window.AI_STUDIO_SELECTORS.generatingIndicator.strategies) {
        try {
          if (strat()) return true;
        } catch (e) {}
      }
    }
    // Check if Run button itself is disabled or shows spinner
    const runBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
    return runBtns.some((b) => {
      if (b.closest('#ai-tts-automation-dock')) return false;
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (b.innerText || '').toLowerCase();
      return (t === 'run' || t.startsWith('run ')) && (b.disabled || b.classList.contains('loading') || !!b.querySelector('mat-spinner, mat-progress-spinner'));
    });
  }

  async function triggerRunAction(runBtn, inputEl, oldDownloadBtn) {
    // Dismiss only toast/snackbar alerts inside Angular CDK overlay so nothing interferes
    try {
      const snackDismiss = document.querySelectorAll('.cdk-overlay-container mat-snack-bar-container button, simple-snack-bar button');
      snackDismiss.forEach((btn) => {
        if (!btn.closest('#ai-tts-automation-dock')) btn.click();
      });
    } catch (e) {}

    // Click the real Run button cleanly
    if (runBtn && !runBtn.disabled) {
      try {
        runBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
      } catch (e) {}
      runBtn.focus();
      runBtn.click();
    } else if (inputEl) {
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

    // Verify Run actually started generating (Stop button appears or Run disables or old download vanishes)
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      if (isGeneratingActive()) return;
      if (capturedFreshDataUrl) return;
      if (oldDownloadBtn && (!document.body.contains(oldDownloadBtn) || oldDownloadBtn.disabled)) return;
      if (runBtn && (!document.body.contains(runBtn) || runBtn.disabled)) return;

      // If after 1.0s still no sign of starting, press Ctrl+Enter on inputEl as backup
      if (i === 10 && inputEl) {
        dockLog('[2/5] Mengirim sinyal Ctrl+Enter cadangan untuk memastikan Run aktif...', 'info');
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
    if (window.AI_STUDIO_SELECTORS?.audioOutput?.strategies?.[1]) {
      try {
        const btn = window.AI_STUDIO_SELECTORS.audioOutput.strategies[1]();
        if (btn) return btn;
      } catch (e) {}
    }
    return null;
  }

  async function waitForDownloadButtonAppearance(oldDownloadBtn, preExistingAudios = []) {
    const maxWaitMs = 150000; // 2.5 minutes max
    const startTime = Date.now();
    const prevAudioSet = new Set(preExistingAudios);
    let loadingLogTick = 0;
    let sawGeneratingState = isGeneratingActive();

    // Give Angular short moment to render Stop / loading state
    await sleep(250);
    if (isGeneratingActive()) sawGeneratingState = true;

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(150);
      loadingLogTick++;

      const generating = isGeneratingActive();
      if (generating) {
        sawGeneratingState = true;
        if (loadingLogTick % 25 === 0) {
          dockLog('[3/5] Masa loading: AI Studio sedang memproses suara (Stop aktif, tombol unduh belum muncul)...', 'info');
        }
        continue;
      }

      // Check if an old download button vanished/re-rendered during generation
      if (oldDownloadBtn && (!document.body.contains(oldDownloadBtn) || oldDownloadBtn.disabled)) {
        sawGeneratingState = true;
      }

      const currentAudios = getAudioSources();
      const hasNewAudioSrc = currentAudios.some((src) => !prevAudioSet.has(src));
      if (hasNewAudioSrc || capturedFreshDataUrl) {
        sawGeneratingState = true;
      }

      const dlBtn = findDownloadButton();

      // ONLY accept download button AFTER generation finished AND we have evidence of THIS run completing!
      const isFreshButton = dlBtn && (!oldDownloadBtn || dlBtn !== oldDownloadBtn);
      const generationConfirmed = sawGeneratingState || isFreshButton || (Date.now() - startTime > 3000 && !oldDownloadBtn && !!dlBtn);

      if (dlBtn && generationConfirmed) {
        // Quick settle check to verify AI Studio did NOT enter another loading phase
        await sleep(150);
        if (isGeneratingActive()) {
          sawGeneratingState = true;
          continue;
        }
        const verifiedBtn = findDownloadButton();
        if (verifiedBtn) {
          dockLog(`[3/5] Tombol unduh resmi terdeteksi & siap ditekan!`, 'success');
          return verifiedBtn;
        }
      }
    }

    throw new Error('Waktu tunggu generasi audio Google AI Studio melebihi batas (150s).');
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
      if (node.shadowRoot) traverse(node.shadowRoot);
      if (node.children) {
        for (const child of node.children) traverse(child);
      }
    }
    traverse(root);
    return audios;
  }

  async function downloadAndSaveRealWav(previousSources, downloadBtn, targetFilename = 'audio', jobId = '') {
    const prevSet = new Set(previousSources);
    const btnToClick = downloadBtn || findDownloadButton();

    if (!btnToClick) {
      return { success: false, error: 'Tombol unduh Google AI Studio tidak ditemukan setelah loading selesai.' };
    }

    // Step 4A: Aktifkan penyegat sinkron di interceptor.js (MAIN world) & guard background SEBELUM klik!
    interceptedDownloadDataUrl = null;
    sendInterceptorControl('SUPPRESS', true, activeRunEpoch);
    await setBackgroundDownloadGuard(true, 10000);

    let validWavDataUrl = null;
    try {
      // Step 4B: Klik SATU KALI tombol unduh asli Google AI Studio
      dockLog('[4/5] Menekan tombol unduh asli Google AI Studio (tanpa popup Simpan)...', 'info');
      try {
        btnToClick.scrollIntoView({ block: 'center', behavior: 'instant' });
      } catch (e) {}
      btnToClick.click();

      // Step 4C: Tunggu data WAV dari hasil klik tombol unduh (polling cepat realtime 40ms)
      const captureStart = Date.now();
      while (Date.now() - captureStart < 4500) {
        if (interceptedDownloadDataUrl) {
          const norm = normalizeWavDataUrl(interceptedDownloadDataUrl);
          if (norm) {
            validWavDataUrl = norm;
            dockLog(`[4/5] Data WAV asli dari tombol unduh berhasil ditangkap!`, 'success');
            break;
          }
        }
        if (capturedFreshDataUrl && Date.now() - captureStart >= 900) {
          const normFresh = normalizeWavDataUrl(capturedFreshDataUrl);
          if (normFresh) {
            validWavDataUrl = normFresh;
            dockLog(`[4/5] Menggunakan audio WAV segar hasil generate terbaru...`, 'info');
            break;
          }
        }
        await sleep(40);
      }
    } finally {
      // Matikan mode penyegat setelah klik selesai diproses
      sendInterceptorControl('SUPPRESS', false, activeRunEpoch);
      if (interceptedDownloadDataUrl) {
        setBackgroundDownloadGuard(false).catch(() => {});
      } else {
        setTimeout(() => setBackgroundDownloadGuard(false).catch(() => {}), 350);
      }
    }

    // Step 4D: Cadangan jika tombol unduh AI Studio menggunakan <audio> baru atau buffer epoch ini
    if (!validWavDataUrl && capturedFreshDataUrl) {
      const norm = normalizeWavDataUrl(capturedFreshDataUrl);
      if (norm) {
        validWavDataUrl = norm;
        dockLog(`[4/5] Menggunakan audio WAV segar hasil generate terbaru...`, 'info');
      }
    }

    if (!validWavDataUrl) {
      const audios = findAudioElementsEverywhere(document);
      let newSrc = null;
      for (const a of audios) {
        const src = a.src || a.currentSrc || a.querySelector('source')?.src;
        if (src && !prevSet.has(src)) {
          newSrc = src;
          break;
        }
      }
      if (newSrc) {
        try {
          const resp = await fetch(newSrc);
          const blob = await resp.blob();
          if (blob.size >= 3000) {
            const rawUrl = await blobToDataUrl(blob);
            const norm = normalizeWavDataUrl(rawUrl);
            if (norm) validWavDataUrl = norm;
          }
        } catch (e) {}
      }
    }

    if (!validWavDataUrl) {
      return { success: false, error: 'Gagal menangkap berkas WAV asli dari tombol unduh AI Studio.' };
    }

    if (!hasExtensionContext()) {
      return { success: false, error: 'Konteks ekstensi Chrome tidak aktif. Harap muat ulang tab AI Studio.' };
    }

    // Step 4E: Kirim ke background service worker -> chrome.downloads.download({ saveAs: false }) & tunggu selesai!
    dockLog(`[4/5] Menyimpan "${targetFilename}.wav" otomatis ke folder unduhan (tanpa popup)...`, 'info');
    const saveRes = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'SAVE_WAV_TO_FOLDER',
            payload: {
              dataUrl: validWavDataUrl,
              filename: targetFilename,
              jobId,
            },
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(resp || { success: false, error: 'Tidak ada respons dari background worker.' });
            }
          }
        );
      } catch (e) {
        resolve({ success: false, error: e?.message || 'Gagal mengirim perintah simpan ke ekstensi.' });
      }
    });

    return { ...saveRes, dataUrl: validWavDataUrl };
  }

  async function uploadWavToDashboard(jobId, filename, arrayBuffer) {
    const cleanFilename = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
    const activeClient = currentJob?.clientId || clientId || 'default';

    // Verify strict RIFF/WAVE header to prevent sending non-audio (such as HTML error pages)
    const headBytes = new Uint8Array(arrayBuffer.slice(0, 12));
    const riffTag = headBytes.length >= 4 ? String.fromCharCode(headBytes[0], headBytes[1], headBytes[2], headBytes[3]) : '';
    const waveTag = headBytes.length >= 12 ? String.fromCharCode(headBytes[8], headBytes[9], headBytes[10], headBytes[11]) : '';
    if (riffTag !== 'RIFF' || waveTag !== 'WAVE') {
      dockLog(`[5/5] Buffer audio bukan format RIFF/WAVE yang valid (${riffTag}/${waveTag}).`, 'warn');
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

    let isSameOrigin = false;
    try {
      isSameOrigin = new URL(backendUrl).origin === window.location.origin;
    } catch (e) {}

    // Strategy 0: Fast cross-origin path directly via background service worker (zero CORS wait!)
    if (!isSameOrigin && hasExtensionContext()) {
      try {
        const proxyResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'PROXY_UPLOAD_AUDIO',
              payload: { jobId, filename: cleanFilename, base64Data, targetUrl: backendUrl, targetClientId: activeClient },
            },
            (r) => {
              if (chrome.runtime.lastError) return resolve(null);
              resolve(r);
            }
          );
        });
        if (proxyResp && proxyResp.success && proxyResp.data?.success) {
          return true;
        }
      } catch (e) {}
    }

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
          (r) => {
            if (chrome.runtime.lastError) return resolve(null);
            resolve(r);
          }
        );
      });

      if (proxyResp && proxyResp.success && proxyResp.data?.success) {
        return true;
      }
      if (proxyResp?.data?.error) {
        console.warn('[AI TTS Content] Background proxy upload rejected by server:', proxyResp.data.error);
      }
    } catch (proxyErr) {
      console.warn('[AI TTS Content] Background proxy upload error:', proxyErr?.message || proxyErr);
    }

    return false;
  }

  function notifyBackend(jobId, step, payload = {}) {
    try {
      const activeClient = currentJob?.clientId || clientId || 'default';
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
      return fetch(`${backendUrl}/api/extension/report?clientId=${encodeURIComponent(activeClient)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': activeClient },
        body: JSON.stringify({ jobId, step, payload, clientId: activeClient }),
        signal: ctrl ? ctrl.signal : undefined,
      })
        .catch(() => {})
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    } catch (e) {
      return Promise.resolve();
    }
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
        setTimeout(check, 100);
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

    if (action === 'START_QUEUE' || action === 'START_QUEUE_DIRECT') {
      const incomingJobs = sortJobsAscending(payload?.jobs || message.jobs || []);
      isQueueActive = true;
      sessionCompletedJobIds.clear();
      jobRetryAttempts.clear();
      dockLog(`[ANTREAN] Sinyal mulai antrean diterima (${incomingJobs.length} pekerjaan, urut #1 -> selesai).`, 'info');

      // Filter unfinished jobs sorted #1 -> last and normalize to PENDING so #1 ALWAYS executes first.
      let list = incomingJobs
        .filter((j) => j && j.status !== 'COMPLETED' && j.status !== 'CANCELLED')
        .map((j) => ({ ...j, status: 'PENDING' }));
      if (list.length === 0 && incomingJobs.length > 0) {
        list = incomingJobs.map((j) => ({ ...j, status: 'PENDING' }));
      }
      directQueue = sortJobsAscending(list);

      try {
        chrome.storage.local.set({ activeQueue: directQueue, queueActive: true });
      } catch (e) {}

      if (!isExecuting) {
        pickAndExecuteNextJob();
      }
      sendResponse({ status: 'ACCEPTED', count: directQueue.length });
      return true;
    }

    if (action === 'STOP_QUEUE' || action === 'PAUSE_QUEUE') {
      isQueueActive = false;
      directQueue = [];
      try {
        chrome.storage.local.set({ activeQueue: [], queueActive: false });
      } catch (e) {}
      const stEl = document.getElementById('ai-tts-job-status');
      if (stEl && !isExecuting) stEl.innerText = action === 'PAUSE_QUEUE' ? 'DIJEDA' : 'DIHENTIKAN';
      dockLog(action === 'PAUSE_QUEUE' ? '[ANTREAN] Antrean dijeda oleh pengguna.' : '[ANTREAN] Antrean dihentikan oleh pengguna.', 'info');
      sendResponse({ status: 'STOPPED' });
      return true;
    }

    if (action === 'PROCESS_JOB') {
      if (!isExecuting && payload && !sessionCompletedJobIds.has(payload.id)) {
        isQueueActive = true;
        executeTTSJob(payload || { id: jobId });
      }
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
