/**
 * Background Service Worker (Manifest V3)
 * Coordinates tabs, relays messages between website dashboard (Cloud/Local) and Google AI Studio tab.
 * Automatically ensures content scripts and dock are active in AI Studio tabs.
 * Supports multi-client workspace partitioning.
 */

let backendUrl = 'http://localhost:3000';
let sessionToken = null;
let clientId = 'default';
let downloadSubfolder = '';
let activeAiStudioTabId = null;
let currentProcessingFilename = null;
let currentProcessingJobId = null;
let latestCapturedDownload = null;
let latestCapturedBufferBase64 = null;
let latestCapturedBufferName = null;
let latestCapturedBufferSize = 0;
const extensionDownloadTargets = new Map();
let activeExtensionDownloadUrl = null;
let activeExtensionDownloadPath = null;
let folderPickerOpenedOnce = false;
let automationDownloadGuardUntil = 0;
let automationDownloadGuardTabId = null;

let sidepanelState = {
  jobFilename: 'Siap menerima perintah dari website',
  jobText: 'Menunggu tugas antrean adegan...',
  jobStatus: 'MENUNGGU',
  stepIndex: 0,
  updatedAt: Date.now(),
};
let sidepanelLogs = [];

function isAiStudioTtsUrlForTab(rawUrl) {
  return isAiStudioTtsUrl(rawUrl);
}

async function syncSidePanelForTab(tabId, rawUrl) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    const allowed = isAiStudioTtsUrlForTab(rawUrl);
    if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setOptions) {
      if (allowed) {
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'sidepanel.html',
          enabled: true,
        }).catch(() => {});
      } else {
        await chrome.sidePanel.setOptions({
          tabId,
          enabled: false,
        }).catch(() => {});
      }
    }
    if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setTitle) {
      chrome.action.setTitle({
        tabId,
        title: allowed
          ? 'Pasang / Buka FahVoiceForge Side Panel di Google AI Studio'
          : 'FahVoiceForge Side Panel hanya aktif pada tab Google AI Studio',
      }).catch(() => {});
    }
  } catch (e) {}
}

async function syncAllTabsSidePanel() {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return;
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t && typeof t.id === 'number') {
        syncSidePanelForTab(t.id, t.url || t.pendingUrl || '');
      }
    }
  } catch (e) {}
}

function configureNativeSidePanel() {
  try {
    if (typeof chrome !== 'undefined' && chrome.sidePanel) {
      if (chrome.sidePanel.setOptions) {
        // Nonaktifkan Side Panel secara global agar tidak ikut terbuka/terpasang di tab lain
        chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
      }
      if (chrome.sidePanel.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
      }
    }
  } catch (e) {}
}

configureNativeSidePanel();
syncAllTabsSidePanel();

if (typeof chrome !== 'undefined' && chrome.runtime) {
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
      configureNativeSidePanel();
      syncAllTabsSidePanel();
    });
  }
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      configureNativeSidePanel();
      syncAllTabsSidePanel();
    });
  }
}

function isAutomationDownloadGuardActive(item) {
  if (Date.now() > automationDownloadGuardUntil) return false;
  const rawUrl = String(item?.url || item?.finalUrl || '');
  const rawRef = String(item?.referrer || '');
  const rawFile = String(item?.filename || '');
  return (
    rawUrl.startsWith('blob:') ||
    rawUrl.includes('aistudio.google.com') ||
    rawRef.includes('aistudio.google.com') ||
    /generated\s*audio/i.test(rawFile) ||
    item?.mime === 'audio/wav'
  );
}

const FS_DB_NAME = 'ai_tts_ext_folder_db';
const FS_STORE_NAME = 'handles';
const FS_HANDLE_KEY = 'unduhan_dir_handle';

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

const WINDOWS_RESERVED_NAMES_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const cancelledDuplicateIds = new Set();

function sanitizeDownloadFilename(name) {
  let safe = String(name || 'audio')
    .replace(/\.(wav|mp3)$/i, '')
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_')
    .replace(/^[.\s_]+|[.\s_]+$/g, '')
    .trim();
  if (!safe) safe = 'audio';
  if (WINDOWS_RESERVED_NAMES_RE.test(safe)) {
    safe = `${safe}_audio`;
  }
  safe = safe.slice(0, 80).replace(/[.\s]+$/g, '') || 'audio';
  return `${safe}.wav`;
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FS_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
        db.createObjectStore(FS_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB error'));
  });
}

async function getLinkedDirectoryHandleStatus() {
  try {
    const db = await openHandleDb();
    const handle = await new Promise((resolve) => {
      const tx = db.transaction(FS_STORE_NAME, 'readonly');
      const req = tx.objectStore(FS_STORE_NAME).get(FS_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (!handle) return { handle: null, granted: false };
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    return { handle, granted: perm === 'granted', permission: perm };
  } catch (e) {
    return { handle: null, granted: false };
  }
}

function dataUrlToUint8Array(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToWavDataUrl(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const STRICT_BLOCKED_EXTS = new Set([
  '.htm', '.html', '.xhtml', '.mhtml',
  '.crdownload', '.tmp', '.temp', '.part', '.partial', '.download',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
  '.txt', '.json', '.js', '.css', '.md', '.xml', '.csv', '.log',
  '.zip', '.rar', '.pdf', '.exe', '.bat',
]);

function isBlockedExtensionAudioName(filename) {
  const name = String(filename || '').trim().toLowerCase();
  if (!name || name.startsWith('.') || name.startsWith('~$')) return true;
  if (name === 'readme.txt' || name === 'desktop.ini' || name === 'thumbs.db') return true;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (STRICT_BLOCKED_EXTS.has(ext)) return true;
  return ext !== '.wav';
}

function validateStrictRiffWaveBytes(bytes) {
  if (!bytes || bytes.length < 44) {
    return { valid: false, duration: 0, reason: 'Buffer WAV terlalu pendek (< 44 byte).' };
  }
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return { valid: false, duration: 0, reason: `Header bukan RIFF/WAVE sah (${riff}/${wave}).` };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

  if (!fmtFound || !dataFound || channels < 1 || sampleRate < 4000 || dataSize <= 0) {
    return { valid: false, duration: 0, reason: 'Chunk fmt/data WAV kosong atau rusak.' };
  }

  const effectiveByteRate =
    byteRate > 0 ? byteRate : Math.max(1, sampleRate * channels * Math.max(1, Math.floor(bitsPerSample / 8)));
  const duration = Math.round((dataSize / effectiveByteRate) * 100) / 100;
  if (!Number.isFinite(duration) || duration <= 0.1) {
    return { valid: false, duration, reason: `Durasi WAV terlalu singkat (${duration.toFixed(2)}d <= 0.1d).` };
  }

  return { valid: true, duration };
}

async function tryWriteToLinkedExtensionFolder(cleanName, dataUrl) {
  const { handle, granted } = await getLinkedDirectoryHandleStatus();
  if (!handle || !granted) {
    return { written: false, reason: handle ? 'permission_needed' : 'no_handle' };
  }

  try {
    const bytes = dataUrlToUint8Array(dataUrl);
    const check = validateStrictRiffWaveBytes(bytes);
    if (!check.valid) {
      return { written: false, invalidAudio: true, reason: check.reason };
    }

    let targetDir = handle;
    if ((handle.name || '').toLowerCase() !== 'unduhan') {
      // Strictly require EXISTING 'unduhan' folder inside extension folder (NEVER create a new one)
      targetDir = await handle.getDirectoryHandle('unduhan', { create: false });
    }

    const fileHandle = await targetDir.getFileHandle(cleanName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    const meta = await new Promise((r) =>
      chrome.storage.local.get(['linkedFolderName'], (res) => {
        if (chrome.runtime.lastError) return r({});
        r(res || {});
      })
    );
    const folderLabel = meta?.linkedFolderName || targetDir.name || 'extension/unduhan';
    return { written: true, path: `${folderLabel}/${cleanName}`, duration: check.duration };
  } catch (err) {
    console.log('[AI TTS Background] Direct FS handle write note:', err?.message || err);
    return { written: false, reason: err?.message || 'fs_write_failed' };
  }
}

async function detectExtensionFolderInDownloads() {
  if (!chrome.downloads || !chrome.downloads.search) return null;
  try {
    const items = await new Promise((resolve) => {
      chrome.downloads.search(
        { query: ['AI_TTS_Chrome_Extension'], state: 'complete', orderBy: ['-startTime'] },
        (res) => {
          if (chrome.runtime.lastError) return resolve([]);
          resolve(Array.isArray(res) ? res : []);
        }
      );
    });

    const zipItems = items.filter((it) => it.filename && /\.zip$/i.test(it.filename));
    if (zipItems.length === 0) return null;

    // Prefer ZIP matching active clientId if available
    const preferred =
      (clientId && clientId !== 'default'
        ? zipItems.find((it) => it.filename.includes(`AI_TTS_Chrome_Extension_${clientId}`))
        : null) || zipItems[0];

    const normalized = preferred.filename.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const baseZip = parts[parts.length - 1] || '';
    // Keep exact extracted folder stem (including Chrome duplicate suffixes like " (1)"!)
    // so AI_TTS_Chrome_Extension_... (1).zip resolves directly to AI_TTS_Chrome_Extension_... (1)/unduhan!
    const stem = baseZip.replace(/\.zip$/i, '').trim();
    if (!stem) return null;

    chrome.storage.local.set({ detectedExtFolder: stem }, () => {
      void chrome.runtime.lastError;
    });
    return stem;
  } catch (e) {
    return null;
  }
}

async function openOrFocusFolderPickerTab() {
  const pickerUrl = chrome.runtime.getURL('folder-picker.html');
  try {
    const existing = await chrome.tabs.query({ url: pickerUrl });
    if (existing.length > 0 && existing[0].id) {
      await chrome.tabs.update(existing[0].id, { active: true });
      return existing[0].id;
    }
    const created = await chrome.tabs.create({ url: pickerUrl, active: true });
    return created?.id || null;
  } catch (e) {
    return null;
  }
}

function getManualExtensionSubfolder() {
  const cleaned = String(downloadSubfolder || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  // Ignore bare legacy 'unduhan' so we NEVER create a stray Downloads\unduhan\ folder outside extension!
  if (!cleaned || cleaned.toLowerCase() === 'unduhan') return null;
  return cleaned.toLowerCase().endsWith('/unduhan') ? cleaned : `${cleaned}/unduhan`;
}

function isExtensionOwnedDownload(item) {
  if (!item) return false;
  if (extensionDownloadTargets.has(item.id)) return true;
  if (typeof chrome !== 'undefined' && chrome.runtime?.id && item.byExtensionId === chrome.runtime.id) {
    return true;
  }
  if (activeExtensionDownloadUrl && item.url && item.url === activeExtensionDownloadUrl) {
    return true;
  }
  return false;
}

function safeCancelAndEraseDownload(downloadId) {
  if (typeof downloadId !== 'number') return;
  if (cancelledDuplicateIds.has(downloadId)) return;
  cancelledDuplicateIds.add(downloadId);
  if (cancelledDuplicateIds.size > 500) {
    const first = cancelledDuplicateIds.values().next().value;
    if (first !== undefined) cancelledDuplicateIds.delete(first);
  }

  const eraseSafe = () => {
    try {
      chrome.downloads.erase({ id: downloadId }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  };

  try {
    chrome.downloads.search({ id: downloadId }, (items) => {
      if (chrome.runtime.lastError) return;
      const found = Array.isArray(items) ? items[0] : null;
      if (!found) return;
      if (found.state === 'in_progress') {
        try {
          chrome.downloads.cancel(downloadId, () => {
            void chrome.runtime.lastError;
            eraseSafe();
          });
        } catch (e) {
          eraseSafe();
        }
      } else {
        eraseSafe();
      }
    });
  } catch (e) {}
}

// Listen ONLY to extension-initiated downloads (never hijack user's manual downloads from Google AI Studio!)
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener((item) => {
    if (!isExtensionOwnedDownload(item)) {
      if (isAutomationDownloadGuardActive(item)) {
        console.log('[AI TTS Background] Blocking duplicate native AI Studio download:', item.id, item.filename || item.url);
        safeCancelAndEraseDownload(item.id);
      }
      return;
    }

    console.log('[AI TTS Background] Extension download item created:', item.id, item.filename);
    latestCapturedDownload = {
      id: item.id,
      url: item.url,
      filename: currentProcessingFilename || item.filename || 'audio.wav',
      mime: item.mime,
      timestamp: Date.now(),
    };
  });
}

// Strict isolation: ONLY direct extension-initiated TTS WAV downloads into the "unduhan" subfolder.
// Any manual/normal download on Google AI Studio or other sites is untouched unless active Step 4 guard is armed.
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (!isExtensionOwnedDownload(item)) {
      if (isAutomationDownloadGuardActive(item)) {
        safeCancelAndEraseDownload(item.id);
        return;
      }
      suggest();
      return;
    }

    const exactPath =
      extensionDownloadTargets.get(item.id) ||
      activeExtensionDownloadPath;

    if (!exactPath) {
      suggest();
      return;
    }

    console.log('[AI TTS Background] Confirming isolated extension WAV path:', exactPath);
    suggest({ filename: exactPath, conflictAction: 'overwrite' });
    return true;
  });
}

// Initialize state from persistent storage
chrome.storage.local.get(['backendUrl', 'sessionToken', 'clientId', 'downloadSubfolder', 'sidepanelState', 'sidepanelLogs'], (res) => {
  if (chrome.runtime.lastError || !res) return;
  if (res.backendUrl) {
    backendUrl = res.backendUrl.replace(/\/$/, '');
  }
  if (res.sessionToken) {
    sessionToken = res.sessionToken;
  }
  if (res.clientId) {
    clientId = res.clientId;
  }
  if (typeof res.downloadSubfolder === 'string') {
    downloadSubfolder = res.downloadSubfolder;
  }
  if (res.sidepanelState && typeof res.sidepanelState === 'object') {
    sidepanelState = { ...sidepanelState, ...res.sidepanelState };
  }
  if (Array.isArray(res.sidepanelLogs)) {
    sidepanelLogs = res.sidepanelLogs.slice(-100);
  }
  detectExtensionFolderInDownloads();
  sendHeartbeat();
});

// Find active or open Google AI Studio TTS/Playground tab (strictly excluding /apps/ Build IDE)
async function findAiStudioTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*' });
    const validTabs = tabs.filter((t) => isAiStudioTtsUrl(t.url));
    if (validTabs.length === 0) {
      activeAiStudioTabId = null;
      return null;
    }

    validTabs.sort((a, b) => {
      const score = (t) => {
        const u = (t.url || '').toLowerCase();
        if (u.includes('/generate-speech')) return 4;
        if (u.includes('/prompts')) return 3;
        if (t.active) return 2;
        return 1;
      };
      return score(b) - score(a);
    });

    activeAiStudioTabId = validTabs[0].id;
    return validTabs[0];
  } catch (e) {
    console.log('Tab query note:', e?.message || e);
  }
  return null;
}

function sendTabMessageWithTimeout(tabId, message, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(err ? null : (response || null));
        }
      });
    } catch (e) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

// Automatically ensure interceptor.js (MAIN world), selectors.js, and content.js are injected in Google AI Studio tab
async function ensureContentScriptInjected(tabId) {
  try {
    const pong = await sendTabMessageWithTimeout(tabId, { action: 'PING' }, 1500);

    if (!pong) {
      console.log('[AI TTS Background] Injecting scripts into tab', tabId);
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        files: ['interceptor.js'],
      }).catch(() => {});
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['selectors.js', 'content.js'],
      });
    }
    return true;
  } catch (err) {
    console.log('[AI TTS Background] Injection note:', err?.message || err);
    return false;
  }
}

// Send heartbeat to backend & keep active queues alive even across background tab throttling
async function sendHeartbeat() {
  try {
    const tab = await findAiStudioTab();
    if (tab && tab.id) {
      await ensureContentScriptInjected(tab.id).catch(() => {});
      const st = await new Promise((r) =>
        chrome.storage.local.get(['queueActive', 'activeQueue', 'runSessionId'], (res) => {
          if (chrome.runtime.lastError) return r({});
          r(res || {});
        })
      );
      if (st?.queueActive) {
        const remaining = Array.isArray(st.activeQueue)
          ? st.activeQueue.filter((j) => j && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED')
          : [];
        if (remaining.length > 0) {
          const runner = await sendTabMessageWithTimeout(tab.id, { action: 'GET_RUNNER_STATE' }, 1500);
          const cooldownStalled = !!runner?.isCooldownWaiting && Number(runner?.cooldownElapsedMs || 0) >= 3500;
          const pickingStalled = !!runner?.isPickingJob && Number(runner?.pickingElapsedMs || 0) >= 12000;
          if (!runner || (!runner.isExecuting && !runner.isPickingJob) || cooldownStalled || pickingStalled) {
            chrome.tabs.sendMessage(tab.id, {
              action: 'START_QUEUE',
              jobs: remaining,
              clientId,
              runSessionId: st.runSessionId || null,
              resumeOnly: true,
            }).catch(() => {});
          }
        }
      }
    }

    if (!backendUrl) return;
    const cleanUrl = backendUrl.replace(/\/$/, '');
    const res = await fetch(`${cleanUrl}/api/extension/heartbeat?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': sessionToken || clientId,
        'X-Client-Id': clientId,
      },
      body: JSON.stringify({
        aiStudioConnected: !!tab,
        tabId: tab ? tab.id : null,
        activeUrl: tab ? tab.url : null,
        version: '1.2.0',
        clientId,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      chrome.storage.local.set({ backendQueueState: data.queueState || 'IDLE' }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch (err) {
    // Backend may be starting
  }
}

// Keep Side Panel strictly scoped to Google AI Studio TTS tabs & auto-inject scripts when ready
if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onCreated?.addListener((tab) => {
    if (tab && typeof tab.id === 'number') {
      syncSidePanelForTab(tab.id, tab.url || tab.pendingUrl || '');
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const candidateUrl = changeInfo.url || tab?.url || tab?.pendingUrl || '';
    if (changeInfo.url || changeInfo.status === 'loading' || changeInfo.status === 'complete') {
      syncSidePanelForTab(tabId, candidateUrl);
    }
    if (changeInfo.status === 'complete' && tab?.url && isAiStudioTtsUrl(tab.url)) {
      activeAiStudioTabId = tabId;
      ensureContentScriptInjected(tabId).then(() => {
        chrome.storage.local.get(['queueActive', 'activeQueue', 'runSessionId'], (st) => {
          if (chrome.runtime.lastError || !st?.queueActive) return;
          const remaining = Array.isArray(st.activeQueue)
            ? st.activeQueue.filter((j) => j && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED')
            : [];
          if (remaining.length > 0) {
            chrome.tabs.sendMessage(tabId, {
              action: 'START_QUEUE',
              jobs: remaining,
              clientId,
              runSessionId: st.runSessionId || null,
              resumeOnly: true,
            }).catch(() => {});
          }
        });
      });
      sendHeartbeat();
    }
  });

  chrome.tabs.onActivated?.addListener((activeInfo) => {
    if (activeInfo && typeof activeInfo.tabId === 'number') {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        syncSidePanelForTab(tab.id, tab.url || tab.pendingUrl || '');
      });
    }
  });

  chrome.tabs.onReplaced?.addListener((addedTabId) => {
    chrome.tabs.get(addedTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      syncSidePanelForTab(tab.id, tab.url || tab.pendingUrl || '');
    });
  });
}

setInterval(sendHeartbeat, 4000);

// Listen to messages from content scripts, bridge, and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  if (type === 'AI_STUDIO_TAB_READY') {
    if (sender.tab && isAiStudioTtsUrl(sender.tab.url || message.url)) {
      activeAiStudioTabId = sender.tab.id;
    }
    sendHeartbeat();
    sendResponse({ received: true });
    return true;
  }

  if (type === 'OPEN_FOLDER_PICKER') {
    openOrFocusFolderPickerTab().then((tabId) => {
      sendResponse({ success: !!tabId, tabId });
    });
    return true;
  }

  if (type === 'EXTENSION_FOLDER_LINKED') {
    folderPickerOpenedOnce = false;
    sendResponse({ success: true });
    return true;
  }

  if (type === 'DISCONNECT') {
    sessionToken = null;
    chrome.storage.local.remove(['sessionToken', 'activeQueue', 'queueActive'], () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (type === 'SIDEPANEL_STATE_UPDATE') {
    if (payload && typeof payload === 'object') {
      sidepanelState = { ...sidepanelState, ...payload, updatedAt: Date.now() };
      chrome.storage.local.set({ sidepanelState }, () => {
        void chrome.runtime.lastError;
      });
      try {
        const p = chrome.runtime.sendMessage({ type: 'SIDEPANEL_STATE_SYNC', payload: sidepanelState });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }
    sendResponse({ success: true });
    return true;
  }

  if (type === 'SIDEPANEL_LOG') {
    if (payload && payload.message) {
      const entry = {
        time: payload.time || new Date().toLocaleTimeString(),
        message: String(payload.message),
        kind: payload.kind || 'default',
      };
      sidepanelLogs.push(entry);
      if (sidepanelLogs.length > 100) {
        sidepanelLogs = sidepanelLogs.slice(-100);
      }
      chrome.storage.local.set({ sidepanelLogs }, () => {
        void chrome.runtime.lastError;
      });
      try {
        const p = chrome.runtime.sendMessage({ type: 'SIDEPANEL_LOG_APPEND', payload: entry });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }
    sendResponse({ success: true });
    return true;
  }

  if (type === 'SIDEPANEL_CLEAR_LOGS') {
    sidepanelLogs = [];
    chrome.storage.local.set({ sidepanelLogs: [] }, () => {
      void chrome.runtime.lastError;
    });
    try {
      const p = chrome.runtime.sendMessage({ type: 'SIDEPANEL_LOGS_CLEARED' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {}
    sendResponse({ success: true });
    return true;
  }

  if (type === 'GET_SIDEPANEL_SNAPSHOT') {
    sendResponse({ success: true, state: sidepanelState, logs: sidepanelLogs });
    return true;
  }

  if (type === 'OPEN_AISTUDIO_TAB') {
    findAiStudioTab().then(async (existing) => {
      if (existing?.id) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId) {
          await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
        }
      } else {
        await chrome.tabs.create({ url: 'https://aistudio.google.com/generate-speech', active: true });
      }
      sendResponse({ success: true });
    }).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (type === 'OPEN_DASHBOARD') {
    const targetUrl = (payload?.backendUrl || backendUrl || 'http://localhost:3000').replace(/\/$/, '');
    chrome.tabs.query({}).then(async (tabs) => {
      const existing = tabs.find((t) => t.url && t.url.startsWith(targetUrl));
      if (existing?.id) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId) {
          await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
        }
      } else {
        await chrome.tabs.create({ url: targetUrl, active: true });
      }
      sendResponse({ success: true });
    }).catch(() => sendResponse({ success: false }));
    return true;
  }

  if (type === 'CONNECT' || type === 'HANDSHAKE' || type === 'SET_BACKEND_URL') {
    if (payload?.backendUrl) {
      backendUrl = payload.backendUrl.replace(/\/$/, '');
      chrome.storage.local.set({ backendUrl }, () => {
        void chrome.runtime.lastError;
      });
    }
    if (payload?.clientId) {
      clientId = payload.clientId;
      chrome.storage.local.set({ clientId }, () => {
        void chrome.runtime.lastError;
      });
    }

    const cleanUrl = backendUrl.replace(/\/$/, '');
    const startTime = Date.now();

    fetch(`${cleanUrl}/api/extension/handshake?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId,
        'X-Session-Token': sessionToken || clientId,
      },
      body: JSON.stringify({ client: 'AI TTS Extension V1.0', version: '1.2.0', clientId }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        const latency = Date.now() - startTime;
        if (data.success) {
          sessionToken = data.token;
          chrome.storage.local.set({ sessionToken }, () => {
            void chrome.runtime.lastError;
          });
          const tab = await findAiStudioTab();
          if (tab && tab.id) {
            await ensureContentScriptInjected(tab.id);
          }
          sendResponse({
            success: true,
            backendConnected: true,
            backendUrl: cleanUrl,
            clientId,
            latency,
            aiStudioConnected: !!tab,
            tabId: tab?.id,
            sessionToken,
          });
        } else {
          sendResponse({ success: false, error: 'Handshake ditolak oleh server backend.' });
        }
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: `Gagal menghubungi server (${cleanUrl}): ${err.message}.`,
        });
      });
    return true;
  }

  if (type === 'PING_BACKEND') {
    const targetUrl = (payload?.backendUrl || backendUrl).replace(/\/$/, '');
    const startTime = Date.now();
    fetch(`${targetUrl}/api/health`)
      .then((r) => r.json())
      .then((data) => {
        const latency = Date.now() - startTime;
        sendResponse({ success: true, latency, data, targetUrl });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message, targetUrl });
      });
    return true;
  }

  if (type === 'RUN_DIAGNOSTICS') {
    findAiStudioTab().then(async (tab) => {
      if (!tab || !tab.id) {
        sendResponse({
          success: false,
          error: 'Tab Google AI Studio tidak ditemukan. Harap buka https://aistudio.google.com/ di Chrome.',
        });
        return;
      }
      await ensureContentScriptInjected(tab.id);
      chrome.tabs.sendMessage(tab.id, { action: 'RUN_DIAGNOSTICS' }, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res);
        }
      });
    });
    return true;
  }

  if (type === 'GET_STATUS') {
    Promise.all([
      findAiStudioTab(),
      getLinkedDirectoryHandleStatus(),
      detectExtensionFolderInDownloads(),
      new Promise((r) =>
        chrome.storage.local.get(['linkedFolderName', 'downloadSubfolder'], (res) => {
          if (chrome.runtime.lastError) return r({});
          r(res || {});
        })
      ),
    ]).then(([tab, fsStatus, detectedExtFolder, st]) => {
      if (tab && tab.id) {
        ensureContentScriptInjected(tab.id).catch(() => {});
      }
      if (typeof st?.downloadSubfolder === 'string') {
        downloadSubfolder = st.downloadSubfolder;
      }
      const manualSub = getManualExtensionSubfolder();
      let effectiveTargetLabel = '';
      if (fsStatus.granted && st?.linkedFolderName) {
        effectiveTargetLabel = `${st.linkedFolderName} (Langsung)`;
      } else if (manualSub) {
        effectiveTargetLabel = `Downloads/${manualSub}`;
      } else if (detectedExtFolder) {
        effectiveTargetLabel = `Downloads/${detectedExtFolder}/unduhan`;
      } else {
        effectiveTargetLabel = 'Belum Terhubung — Klik Pilih Folder Ekstensi';
      }

      sendResponse({
        success: true,
        backendUrl,
        clientId,
        downloadSubfolder: manualSub || (detectedExtFolder ? `${detectedExtFolder}/unduhan` : ''),
        linkedFolderName: st?.linkedFolderName || null,
        linkedFolderGranted: !!fsStatus.granted,
        linkedFolderNeedsRegrant: !!fsStatus.handle && !fsStatus.granted,
        detectedExtFolder: detectedExtFolder || null,
        effectiveTargetLabel,
        aiStudioConnected: !!tab,
        tabId: tab ? tab.id : null,
        sessionToken,
      });
    });
    return true;
  }

  if (type === 'SET_DOWNLOAD_SUBFOLDER') {
    const raw = (payload?.subfolder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    downloadSubfolder = raw.toLowerCase() === 'unduhan' ? '' : raw;
    chrome.storage.local.set({ downloadSubfolder }, () => {
      void chrome.runtime.lastError;
      sendResponse({ success: true, downloadSubfolder: getManualExtensionSubfolder() || '' });
    });
    return true;
  }

  if (type === 'START_QUEUE' || type === 'START_QUEUE_DIRECT') {
    const rawJobs = Array.isArray(payload?.jobs) ? [...payload.jobs] : [];
    const jobs = rawJobs.sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.order)) && Number(a?.order) > 0 ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.order)) && Number(b?.order) > 0 ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
    });
    const resumeOnly = !!payload?.resumeOnly;
    const runSessionId = payload?.runSessionId || null;
    const targetClientId = payload?.clientId || clientId;
    const completedIds = Array.isArray(payload?.completedIds) ? payload.completedIds : [];
    const completedFilenames = Array.isArray(payload?.completedFilenames) ? payload.completedFilenames : [];

    (async () => {
      try {
        await new Promise((r) =>
          chrome.storage.local.set(
            runSessionId
              ? { activeQueue: jobs, queueActive: true, runSessionId, completedIds, completedFilenames }
              : { activeQueue: jobs, queueActive: true, completedIds, completedFilenames },
            () => {
              void chrome.runtime.lastError;
              r();
            }
          )
        );
        const tab = await findAiStudioTab();
        if (!tab || !tab.id) {
          sendResponse({
            success: false,
            error: 'Tab Google AI Studio belum terbuka. Buka aistudio.google.com terlebih dahulu.',
            count: jobs.length,
          });
          return;
        }
        await ensureContentScriptInjected(tab.id);
        const msgPayload = {
          action: 'START_QUEUE',
          jobs,
          completedIds,
          completedFilenames,
          clientId: targetClientId,
          runSessionId,
          resumeOnly,
        };
        try {
          await chrome.tabs.sendMessage(tab.id, msgPayload);
        } catch (firstErr) {
          await new Promise((r) => setTimeout(r, 250));
          await ensureContentScriptInjected(tab.id);
          await chrome.tabs.sendMessage(tab.id, msgPayload);
        }
        sendResponse({ success: true, count: jobs.length, tabId: tab.id });
      } catch (err) {
        sendResponse({
          success: false,
          error: err?.message || 'Gagal mengirim antrean ke tab Google AI Studio.',
          count: jobs.length,
        });
      }
    })();
    return true;
  }

  if (type === 'PULL_DASHBOARD_QUEUE') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const cleanBackendOrigin = (() => {
          try {
            return new URL(backendUrl).origin;
          } catch {
            return '';
          }
        })();

        const candidates = tabs
          .filter((t) => {
            if (!t.id || t.id === activeAiStudioTabId) return false;
            const u = String(t.url || '');
            if (!u || (!u.startsWith('http://') && !u.startsWith('https://'))) return false;
            if (u.includes('aistudio.google.com')) return false;
            return true;
          })
          .sort((a, b) => {
            const aMatch = cleanBackendOrigin && String(a.url || '').startsWith(cleanBackendOrigin) ? 1 : 0;
            const bMatch = cleanBackendOrigin && String(b.url || '').startsWith(cleanBackendOrigin) ? 1 : 0;
            return bMatch - aMatch;
          });

        const results = await Promise.all(
          candidates.map(
            (t) =>
              new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 2400);
                try {
                  chrome.tabs.sendMessage(
                    t.id,
                    { source: 'AI_TTS_BACKGROUND', type: 'REQUEST_QUEUE_SNAPSHOT' },
                    (resp) => {
                      clearTimeout(timer);
                      if (chrome.runtime.lastError || !resp || resp.notDashboard) return resolve(null);
                      resolve(resp);
                    }
                  );
                } catch {
                  clearTimeout(timer);
                  resolve(null);
                }
              })
          )
        );

        const activeSnap = results.find((s) => s && s.queueActive && Array.isArray(s.jobs) && s.jobs.length > 0);
        if (activeSnap) {
          await new Promise((r) =>
            chrome.storage.local.set(
              activeSnap.runSessionId
                ? {
                    activeQueue: activeSnap.jobs,
                    queueActive: true,
                    runSessionId: activeSnap.runSessionId,
                    completedIds: Array.isArray(activeSnap.completedIds) ? activeSnap.completedIds : [],
                    completedFilenames: Array.isArray(activeSnap.completedFilenames) ? activeSnap.completedFilenames : [],
                  }
                : {
                    activeQueue: activeSnap.jobs,
                    queueActive: true,
                    completedIds: Array.isArray(activeSnap.completedIds) ? activeSnap.completedIds : [],
                    completedFilenames: Array.isArray(activeSnap.completedFilenames) ? activeSnap.completedFilenames : [],
                  },
              () => {
                void chrome.runtime.lastError;
                r();
              }
            )
          );
          sendResponse({
            success: true,
            reachedDashboard: true,
            queueActive: true,
            jobs: activeSnap.jobs,
            completedIds: Array.isArray(activeSnap.completedIds) ? activeSnap.completedIds : [],
            completedFilenames: Array.isArray(activeSnap.completedFilenames) ? activeSnap.completedFilenames : [],
            runSessionId: activeSnap.runSessionId || null,
          });
          return;
        }

        const anyDashboard = results.find((s) => s && s.reachedDashboard);
        sendResponse({
          success: !!anyDashboard,
          reachedDashboard: !!anyDashboard,
          queueActive: !!(anyDashboard && anyDashboard.queueActive),
          jobs: anyDashboard && Array.isArray(anyDashboard.jobs) ? anyDashboard.jobs : [],
          completedIds: anyDashboard && Array.isArray(anyDashboard.completedIds) ? anyDashboard.completedIds : [],
          completedFilenames: anyDashboard && Array.isArray(anyDashboard.completedFilenames) ? anyDashboard.completedFilenames : [],
        });
      } catch (err) {
        sendResponse({ success: false, reachedDashboard: false, queueActive: false, jobs: [] });
      }
    })();
    return true;
  }

  if (type === 'APPEND_QUEUE_JOBS') {
    const incomingRaw = Array.isArray(payload?.jobs) ? [...payload.jobs] : [];
    const targetClientId = payload?.clientId || clientId;
    (async () => {
      try {
        const st = await new Promise((r) =>
          chrome.storage.local.get(['activeQueue', 'queueActive'], (res) => {
            if (chrome.runtime.lastError) return r({});
            r(res || {});
          })
        );
        const existing = Array.isArray(st?.activeQueue) ? st.activeQueue : [];
        const mergedMap = new Map();
        for (const j of existing) {
          if (j && j.status !== 'COMPLETED' && j.status !== 'CANCELLED') {
            mergedMap.set(j.id || j.filename, j);
          }
        }
        for (const nj of incomingRaw) {
          if (nj && nj.status !== 'COMPLETED' && nj.status !== 'CANCELLED') {
            mergedMap.set(nj.id || nj.filename, nj);
          }
        }
        const merged = Array.from(mergedMap.values()).sort((a, b) => {
          const orderA = Number.isFinite(Number(a?.order)) && Number(a?.order) > 0 ? Number(a.order) : Number.MAX_SAFE_INTEGER;
          const orderB = Number.isFinite(Number(b?.order)) && Number(b?.order) > 0 ? Number(b.order) : Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) return orderA - orderB;
          return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
        });

        await new Promise((r) =>
          chrome.storage.local.set({ activeQueue: merged, queueActive: true }, () => {
            void chrome.runtime.lastError;
            r();
          })
        );

        const tab = await findAiStudioTab();
        if (tab && tab.id) {
          await ensureContentScriptInjected(tab.id);
          await chrome.tabs.sendMessage(tab.id, {
            action: 'APPEND_QUEUE_JOBS',
            jobs: incomingRaw,
            clientId: targetClientId,
          }).catch(() => {});
        }
        sendResponse({ success: true, count: merged.length });
      } catch (err) {
        sendResponse({ success: false, error: err?.message || 'Gagal menambah antrean ke ekstensi.' });
      }
    })();
    return true;
  }

  if (type === 'GET_RUNNER_STATE') {
    (async () => {
      try {
        const st = await new Promise((r) =>
          chrome.storage.local.get(['queueActive', 'activeQueue'], (res) => {
            if (chrome.runtime.lastError) return r({});
            r(res || {});
          })
        );
        const tab = await findAiStudioTab();
        if (!tab || !tab.id) {
          sendResponse({
            success: true,
            aiStudioTabFound: false,
            isExecuting: false,
            isQueueActive: !!st?.queueActive,
            pendingCount: Array.isArray(st?.activeQueue) ? st.activeQueue.length : 0,
          });
          return;
        }
        await ensureContentScriptInjected(tab.id);
        const resp = await sendTabMessageWithTimeout(tab.id, { action: 'GET_RUNNER_STATE' }, 1800);
        if (!resp) {
          sendResponse({
            success: true,
            aiStudioTabFound: true,
            isExecuting: false,
            isQueueActive: !!st?.queueActive,
            pendingCount: Array.isArray(st?.activeQueue) ? st.activeQueue.length : 0,
          });
        } else {
          sendResponse({ success: true, aiStudioTabFound: true, ...resp });
        }
      } catch (err) {
        sendResponse({ success: false, isExecuting: false, error: err?.message });
      }
    })();
    return true;
  }

  if (type === 'STOP_QUEUE' || type === 'PAUSE_QUEUE') {
    chrome.storage.local.set({ activeQueue: [], queueActive: false }, () => {
      void chrome.runtime.lastError;
    });
    findAiStudioTab().then((tab) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: type === 'PAUSE_QUEUE' ? 'PAUSE_QUEUE' : 'STOP_QUEUE' }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (type === 'JOB_COMPLETED_NOTIFY') {
    // Broadcast job completion to all open dashboard tabs via bridge
    chrome.tabs.query({}).then((tabs) => {
      for (const t of tabs) {
        if (t.id && t.id !== activeAiStudioTabId && !String(t.url || '').includes('aistudio.google.com')) {
          chrome.tabs.sendMessage(t.id, {
            source: 'AI_TTS_BACKGROUND',
            type: 'JOB_COMPLETED',
            payload,
          }).catch(() => {});
        }
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (type === 'JOB_PROGRESS_NOTIFY') {
    // Relay live job step/retry/status progress directly to dashboard tabs (works on stateless Vercel too!)
    chrome.tabs.query({}).then((tabs) => {
      for (const t of tabs) {
        if (t.id && t.id !== activeAiStudioTabId && !String(t.url || '').includes('aistudio.google.com')) {
          chrome.tabs.sendMessage(t.id, {
            source: 'AI_TTS_BACKGROUND',
            type: 'JOB_PROGRESS',
            payload,
          }).catch(() => {});
        }
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (type === 'JOB_AUDIO_RECEIVED') {
    const receivedJobId = payload?.jobId;
    const receivedFilename = payload?.filename;
    const remainingJobs = Array.isArray(payload?.remainingJobs) ? payload.remainingJobs : [];
    const runSessionId = payload?.runSessionId || null;
    const allCompleted = !!payload?.allCompleted;

    if (remainingJobs.length > 0) {
      chrome.storage.local.set(
        runSessionId
          ? { activeQueue: remainingJobs, queueActive: true, runSessionId }
          : { activeQueue: remainingJobs, queueActive: true },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } else if (allCompleted) {
      chrome.storage.local.set({ activeQueue: [], queueActive: false }, () => {
        void chrome.runtime.lastError;
      });
    }

    findAiStudioTab().then(async (tab) => {
      if (tab && tab.id) {
        await ensureContentScriptInjected(tab.id).catch(() => {});
        chrome.tabs.sendMessage(tab.id, {
          action: 'AUDIO_CONFIRMED_ON_WEBSITE',
          jobId: receivedJobId,
          filename: receivedFilename,
          remainingJobs,
          runSessionId,
          queueActive: remainingJobs.length > 0,
          allCompleted,
        }).catch(() => {});
      }
    }).catch(() => {});
    sendResponse({ success: true, jobId: receivedJobId, remainingCount: remainingJobs.length });
    return true;
  }

  if (type === 'SET_CURRENT_DOWNLOAD_NAME') {
    currentProcessingFilename = payload?.filename || null;
    currentProcessingJobId = payload?.jobId || payload?.id || null;
    latestCapturedBufferBase64 = null;
    latestCapturedBufferSize = 0;
    sendResponse({ success: true, filename: currentProcessingFilename, jobId: currentProcessingJobId });
    return true;
  }

  if (type === 'SET_AUTOMATION_DOWNLOAD_GUARD') {
    const active = !!payload?.active;
    const ttlMs = Math.min(20000, Math.max(1000, Number(payload?.ttlMs) || 10000));
    automationDownloadGuardUntil = active ? Date.now() + ttlMs : 0;
    automationDownloadGuardTabId = active ? (sender?.tab?.id || activeAiStudioTabId) : null;
    if (active && sender?.tab?.id) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, allFrames: true },
        world: 'MAIN',
        files: ['interceptor.js'],
      }).catch(() => {});
    }
    sendResponse({ success: true, active });
    return true;
  }

  if (type === 'GET_LATEST_CAPTURED_AUDIO') {
    sendResponse({
      success: true,
      hasAudio: !!latestCapturedBufferBase64,
      base64Data: latestCapturedBufferBase64,
      filename: latestCapturedBufferName,
      size: latestCapturedBufferSize,
      downloadUrl: latestCapturedDownload?.url || null,
    });
    return true;
  }

  function normalizeAudioLookupKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\.(wav|mp3|ogg|m4a|flac|webm)$/i, '')
      .replace(/[\s_]+/g, '_');
  }

  // Helper to queue & broadcast completed extension WAV to Website Dashboard & extension unduhan folder cache
  async function publishWavToWebsiteAndPending(cleanName, dataUrl, fullPath, jobId = '', duration = 0) {
    const bytes = dataUrlToUint8Array(dataUrl);
    const riffCheck = validateStrictRiffWaveBytes(bytes);
    if (!riffCheck.valid) {
      console.log('[AI TTS Background] Menolak publikasi WAV tidak valid ke website:', cleanName, riffCheck.reason);
      return;
    }

    const baseName = cleanName.replace(/\.wav$/i, '');
    const actualSize = bytes.byteLength;
    const actualDuration = duration || riffCheck.duration || 0;
    const nowTs = Date.now();
    const wavEntry = {
      pendingId: `wav_${nowTs}_${Math.random().toString(36).slice(2, 7)}`,
      jobId: jobId || currentProcessingJobId || '',
      filename: cleanName,
      baseName,
      dataUrl,
      size: actualSize,
      duration: actualDuration,
      lastModified: nowTs,
      path: fullPath,
      createdAt: nowTs,
    };

    try {
      const st = await new Promise((r) =>
        chrome.storage.local.get(['pendingExtensionWavs', 'recentExtensionWavs'], (res) => {
          if (chrome.runtime.lastError) return r({});
          r(res || {});
        })
      );
      const existingPending = Array.isArray(st?.pendingExtensionWavs) ? st.pendingExtensionWavs : [];
      const nextPending = [...existingPending.filter((it) => it.baseName !== baseName), wavEntry].slice(-30);

      // Keep rolling verified cache so Website can always read real WAV bytes even after pending ACK or in AUTO-EKSTENSI mode
      const existingRecent = Array.isArray(st?.recentExtensionWavs) ? st.recentExtensionWavs : [];
      const nextRecent = [...existingRecent.filter((it) => normalizeAudioLookupKey(it.baseName) !== normalizeAudioLookupKey(baseName)), wavEntry].slice(-30);

      await new Promise((r) =>
        chrome.storage.local.set({ pendingExtensionWavs: nextPending, recentExtensionWavs: nextRecent }, () => {
          void chrome.runtime.lastError;
          r();
        })
      );
    } catch (e) {}

    try {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        if (t.id && t.id !== activeAiStudioTabId && !String(t.url || '').includes('aistudio.google.com')) {
          chrome.tabs.sendMessage(t.id, {
            source: 'AI_TTS_BACKGROUND',
            type: 'NEW_WAV_FROM_EXTENSION',
            payload: wavEntry,
          }).catch(() => {});
        }
      }
    } catch (e) {}
  }

  if (type === 'GET_PENDING_EXTENSION_WAVS') {
    chrome.storage.local.get(['pendingExtensionWavs'], (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: true, items: [] });
        return;
      }
      sendResponse({
        success: true,
        items: Array.isArray(res?.pendingExtensionWavs) ? res.pendingExtensionWavs : [],
      });
    });
    return true;
  }

  if (type === 'GET_EXTENSION_WAV_BY_NAME') {
    const requestedName = String(payload?.baseName || payload?.filename || '').trim();
    const targetKey = normalizeAudioLookupKey(requestedName);
    if (!targetKey) {
      sendResponse({ success: false, item: null, error: 'Nama file kosong.' });
      return true;
    }

    (async () => {
      // 1. Prioritas: baca langsung dari folder unduhan terhubung (File System Handle)
      try {
        const { handle, granted } = await getLinkedDirectoryHandleStatus();
        if (handle && granted) {
          let targetDir = handle;
          if ((handle.name || '').toLowerCase() !== 'unduhan') {
            targetDir = await handle.getDirectoryHandle('unduhan', { create: false });
          }

          for await (const [name, entryHandle] of targetDir.entries()) {
            if (entryHandle.kind !== 'file' || isBlockedExtensionAudioName(name)) continue;
            if (normalizeAudioLookupKey(name) !== targetKey) continue;

            const file = await entryHandle.getFile();
            if (file.size <= 25 * 1024 * 1024) {
              const buf = await file.arrayBuffer();
              const bytes = new Uint8Array(buf);
              const check = validateStrictRiffWaveBytes(bytes);
              if (check.valid) {
                sendResponse({
                  success: true,
                  item: {
                    filename: name,
                    baseName: name.replace(/\.wav$/i, ''),
                    size: file.size,
                    lastModified: file.lastModified,
                    duration: check.duration,
                    dataUrl: uint8ArrayToWavDataUrl(bytes),
                  },
                });
                return;
              }
            }
          }
        }
      } catch (e) {}

      // 2. Cadangan: baca dari cache RIFF/WAVE tervalidasi ekstensi (AUTO-EKSTENSI / pending)
      try {
        const st = await new Promise((r) =>
          chrome.storage.local.get(['recentExtensionWavs', 'pendingExtensionWavs'], (res) => {
            if (chrome.runtime.lastError) return r({});
            r(res || {});
          })
        );
        const candidates = [
          ...(Array.isArray(st?.recentExtensionWavs) ? st.recentExtensionWavs : []),
          ...(Array.isArray(st?.pendingExtensionWavs) ? st.pendingExtensionWavs : []),
        ];
        const matched = candidates.find(
          (it) => it?.dataUrl && normalizeAudioLookupKey(it.baseName || it.filename) === targetKey
        );
        if (matched) {
          const bytes = dataUrlToUint8Array(matched.dataUrl);
          const check = validateStrictRiffWaveBytes(bytes);
          if (check.valid) {
            sendResponse({
              success: true,
              item: {
                filename: matched.filename,
                baseName: matched.baseName || matched.filename.replace(/\.wav$/i, ''),
                size: bytes.byteLength,
                lastModified: matched.lastModified || matched.createdAt || Date.now(),
                duration: matched.duration || check.duration,
                dataUrl: matched.dataUrl,
              },
            });
            return;
          }
        }
      } catch (e) {}

      sendResponse({ success: false, item: null });
    })();
    return true;
  }

  if (type === 'ACK_EXTENSION_WAVS') {
    const ackIds = new Set(Array.isArray(payload?.ids) ? payload.ids : []);
    chrome.storage.local.get(['pendingExtensionWavs'], (res) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: true, remainingCount: 0 });
        return;
      }
      const existing = Array.isArray(res?.pendingExtensionWavs) ? res.pendingExtensionWavs : [];
      const remaining = ackIds.size > 0 ? existing.filter((it) => !ackIds.has(it.pendingId)) : [];
      chrome.storage.local.set({ pendingExtensionWavs: remaining }, () => {
        void chrome.runtime.lastError;
        sendResponse({ success: true, remainingCount: remaining.length });
      });
    });
    return true;
  }

  if (type === 'SCAN_LINKED_UNDUHAN_FOLDER') {
    const knownSignatures = (payload && typeof payload.knownSignatures === 'object' && payload.knownSignatures) || {};
    (async () => {
      const { handle, granted } = await getLinkedDirectoryHandleStatus();

      // Mode AUTO-EKSTENSI fallback: bila handle FS langsung belum ditautkan, kirim cache RIFF/WAVE tervalidasi milik ekstensi
      if (!handle || !granted) {
        try {
          const st = await new Promise((r) =>
            chrome.storage.local.get(['recentExtensionWavs', 'pendingExtensionWavs', 'detectedExtFolder'], (res) => {
              if (chrome.runtime.lastError) return r({});
              r(res || {});
            })
          );
          const rawPool = [
            ...(Array.isArray(st?.recentExtensionWavs) ? st.recentExtensionWavs : []),
            ...(Array.isArray(st?.pendingExtensionWavs) ? st.pendingExtensionWavs : []),
          ];
          const dedup = new Map();
          for (const entry of rawPool) {
            if (!entry?.dataUrl || !entry?.filename) continue;
            dedup.set(entry.filename.toLowerCase(), entry);
          }

          const items = [];
          let accepted = 0;
          for (const entry of dedup.values()) {
            try {
              const bytes = dataUrlToUint8Array(entry.dataUrl);
              const check = validateStrictRiffWaveBytes(bytes);
              if (!check.valid) continue;
              accepted++;
              const lm = entry.lastModified || entry.createdAt || 0;
              const sig = `${bytes.byteLength}::${lm}`;
              if (knownSignatures[entry.filename.toLowerCase()] === sig) continue;
              items.push({
                filename: entry.filename,
                baseName: entry.baseName || entry.filename.replace(/\.wav$/i, ''),
                size: bytes.byteLength,
                lastModified: lm || Date.now(),
                duration: entry.duration || check.duration,
                dataUrl: entry.dataUrl,
              });
            } catch {}
          }

          sendResponse({
            success: true,
            folderLinked: accepted > 0,
            folderMode: 'auto_cache',
            folderName: st?.detectedExtFolder ? `${st.detectedExtFolder}/unduhan` : 'unduhan (Cache Ekstensi)',
            items,
            accepted,
            rejected: 0,
            rejectedFiles: [],
          });
        } catch {
          sendResponse({ success: true, folderLinked: false, items: [], accepted: 0, rejected: 0, rejectedFiles: [] });
        }
        return;
      }

      try {
        let targetDir = handle;
        if ((handle.name || '').toLowerCase() !== 'unduhan') {
          targetDir = await handle.getDirectoryHandle('unduhan', { create: false });
        }

        const meta = await new Promise((r) =>
          chrome.storage.local.get(['linkedFolderName'], (res) => {
            if (chrome.runtime.lastError) return r({});
            r(res || {});
          })
        );
        const items = [];
        const rejectedFiles = [];
        let accepted = 0;

        for await (const [name, entryHandle] of targetDir.entries()) {
          if (entryHandle.kind !== 'file') continue;
          const lower = name.toLowerCase();

          if (isBlockedExtensionAudioName(name)) {
            if (lower !== 'readme.txt') {
              rejectedFiles.push({ filename: name, reason: 'Ditolak aturan ketat folder audio (non-WAV/.htm/.crdownload/.tmp/gambar).' });
            }
            continue;
          }

          try {
            const file = await entryHandle.getFile();
            if (file.size > 15 * 1024 * 1024) {
              rejectedFiles.push({ filename: name, reason: 'Ukuran melebihi batas bridge (15 MB).' });
              continue;
            }
            const buf = await file.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const check = validateStrictRiffWaveBytes(bytes);
            if (!check.valid) {
              rejectedFiles.push({ filename: name, reason: check.reason || 'Header RIFF/WAVE tidak valid atau durasi <= 0.1d.' });
              continue;
            }

            accepted++;
            const sig = `${file.size}::${file.lastModified}`;
            if (knownSignatures[lower] === sig) {
              continue;
            }

            items.push({
              filename: name,
              baseName: name.replace(/\.wav$/i, ''),
              size: file.size,
              lastModified: file.lastModified,
              duration: check.duration,
              dataUrl: uint8ArrayToWavDataUrl(bytes),
            });
          } catch (fileErr) {
            rejectedFiles.push({ filename: name, reason: fileErr?.message || 'Gagal membaca file.' });
          }
        }

        sendResponse({
          success: true,
          folderLinked: true,
          folderMode: 'fs_handle',
          folderName: meta?.linkedFolderName || targetDir.name || 'unduhan',
          accepted,
          rejected: rejectedFiles.length,
          rejectedFiles,
          items,
        });
      } catch (err) {
        sendResponse({
          success: false,
          folderLinked: false,
          items: [],
          accepted: 0,
          rejected: 0,
          rejectedFiles: [],
          error: err?.message || 'Gagal memindai folder unduhan.',
        });
      }
    })();
    return true;
  }

  // Strict direct WAV save ONLY into the extension's own `unduhan` folder (NEVER creates a stray Downloads\unduhan\ folder!)
  if (type === 'SAVE_WAV_TO_FOLDER') {
    const { dataUrl, filename, jobId } = payload || {};
    if (!dataUrl) {
      sendResponse({ success: false, error: 'Data audio tidak valid.' });
      return true;
    }

    const cleanName = sanitizeDownloadFilename(filename || currentProcessingFilename || 'audio');
    let strictCheck = { valid: false, duration: 0, reason: 'Data WAV gagal didekode.' };
    try {
      const rawBytes = dataUrlToUint8Array(dataUrl);
      strictCheck = validateStrictRiffWaveBytes(rawBytes);
    } catch (e) {}

    if (!strictCheck.valid) {
      sendResponse({
        success: false,
        error: `Ditolak aturan ketat audio WAV: ${strictCheck.reason}`,
      });
      return true;
    }

    (async () => {
      // Tier 1: Direct write into user-linked FileSystemDirectoryHandle (`extension/unduhan/` or custom folder anywhere on disk)
      const fsWrite = await tryWriteToLinkedExtensionFolder(cleanName, dataUrl);
      if (fsWrite.written) {
        await publishWavToWebsiteAndPending(cleanName, dataUrl, fsWrite.path, jobId);
        sendResponse({ success: true, mode: 'fs_handle', path: fsWrite.path, duration: fsWrite.duration });
        return;
      }
      if (fsWrite.invalidAudio) {
        sendResponse({ success: false, error: `Ditolak aturan ketat audio WAV: ${fsWrite.reason}` });
        return;
      }

      // Tier 2: Check explicitly configured extension folder inside Downloads OR auto-detected `AI_TTS_Chrome_Extension_...` zip stem
      const st = await new Promise((r) =>
        chrome.storage.local.get(['downloadSubfolder', 'detectedExtFolder'], (res) => {
          if (chrome.runtime.lastError) return r({});
          r(res || {});
        })
      );
      if (typeof st?.downloadSubfolder === 'string') {
        downloadSubfolder = st.downloadSubfolder;
      }

      const manualSub = getManualExtensionSubfolder();
      const detectedStem = await detectExtensionFolderInDownloads();
      const extFolderPrefix = manualSub || (detectedStem ? `${detectedStem}/unduhan` : (st?.detectedExtFolder ? `${st.detectedExtFolder}/unduhan` : null));

      if (!extFolderPrefix) {
        // Strictly refuse creating a stray `Downloads\unduhan` folder! Ask user once to link extension folder.
        if (!folderPickerOpenedOnce) {
          folderPickerOpenedOnce = true;
          openOrFocusFolderPickerTab();
        }
        sendResponse({
          success: false,
          needsFolderPick: true,
          error: 'Folder "unduhan" di dalam ekstensi belum terhubung (ekstensi menolak membuat folder baru di Downloads). Pilih folder ekstensi / "unduhan" di tab Sambungkan Folder yang terbuka.',
        });
        return;
      }

      if (!chrome.downloads) {
        sendResponse({ success: false, error: 'API unduhan Chrome tidak tersedia.' });
        return;
      }

      const fullPath = `${extFolderPrefix}/${cleanName}`;
      activeExtensionDownloadUrl = dataUrl;
      activeExtensionDownloadPath = fullPath;

      chrome.downloads.download(
        {
          url: dataUrl,
          filename: fullPath,
          saveAs: false,
          conflictAction: 'overwrite',
        },
        (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            activeExtensionDownloadUrl = null;
            activeExtensionDownloadPath = null;
            sendResponse({
              success: false,
              error: chrome.runtime.lastError?.message || 'Gagal memulai unduhan silent Chrome.',
            });
            return;
          }

          extensionDownloadTargets.set(downloadId, fullPath);

          let settled = false;
          const finishSuccess = async (timedOut = false) => {
            if (settled) return;
            settled = true;
            chrome.downloads.onChanged.removeListener(onChanged);
            extensionDownloadTargets.delete(downloadId);
            activeExtensionDownloadUrl = null;
            activeExtensionDownloadPath = null;
            await publishWavToWebsiteAndPending(cleanName, dataUrl, fullPath, jobId);
            sendResponse({ success: true, mode: 'downloads_ext_folder', downloadId, path: fullPath, timedOut });
          };

          const timeoutId = setTimeout(() => finishSuccess(true), 15000);

          const onChanged = (delta) => {
            if (delta.id !== downloadId) return;
            if (delta.state?.current === 'complete') {
              clearTimeout(timeoutId);
              finishSuccess(false);
            } else if (delta.state?.current === 'interrupted') {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              chrome.downloads.onChanged.removeListener(onChanged);
              extensionDownloadTargets.delete(downloadId);
              activeExtensionDownloadUrl = null;
              activeExtensionDownloadPath = null;
              sendResponse({
                success: false,
                error: delta.error?.current || 'Unduhan terinterupsi oleh browser.',
              });
            }
          };

          chrome.downloads.onChanged.addListener(onChanged);
        }
      );
    })();

    return true;
  }

  // Trigger automated download with exact job filename into verified extension unduhan folder
  if (type === 'DOWNLOAD_FILE') {
    const { url, filename } = payload || {};
    if (chrome.downloads && url) {
      currentProcessingFilename = filename;
      const cleanName = sanitizeDownloadFilename(filename);
      detectExtensionFolderInDownloads().then((detectedStem) => {
        const prefix = getManualExtensionSubfolder() || (detectedStem ? `${detectedStem}/unduhan` : null);
        if (!prefix) {
          sendResponse({ success: false, needsFolderPick: true, error: 'Folder unduhan ekstensi belum terhubung.' });
          return;
        }
        const fullPath = `${prefix}/${cleanName}`;
        activeExtensionDownloadUrl = url;
        activeExtensionDownloadPath = fullPath;
        chrome.downloads.download(
          {
            url,
            filename: fullPath,
            saveAs: false,
            conflictAction: 'overwrite',
          },
          (downloadId) => {
            const err = chrome.runtime.lastError;
            if (err || !downloadId) {
              activeExtensionDownloadUrl = null;
              activeExtensionDownloadPath = null;
              sendResponse({ success: false, error: err?.message || 'Gagal memulai unduhan.' });
              return;
            }
            extensionDownloadTargets.set(downloadId, fullPath);
            activeExtensionDownloadUrl = null;
            activeExtensionDownloadPath = null;
            sendResponse({ success: true, downloadId, path: fullPath });
          }
        );
      });
      return true;
    }
    sendResponse({ success: false });
    return true;
  }

  // Upload WAV blob to backend via background (bypasses any browser CORS)
  if (type === 'PROXY_UPLOAD_AUDIO') {
    const { jobId, filename, base64Data, targetUrl, targetClientId } = payload;
    const finalUrl = (targetUrl || backendUrl).replace(/\/$/, '');
    const activeClientId = targetClientId || clientId || 'default';
    const cleanName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;

    // Try Strategy 1: JSON Base64 (fastest, no boundary issues)
    fetch(`${finalUrl}/api/audio/upload-base64/${jobId}?clientId=${encodeURIComponent(activeClientId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': activeClientId,
        'X-Session-Token': sessionToken || activeClientId,
      },
      body: JSON.stringify({
        filename: cleanName,
        base64Audio: base64Data,
        clientId: activeClientId,
      }),
    })
      .then((r) => r.json())
      .then((resData) => {
        if (resData.success) {
          sendResponse({ success: true, data: resData });
        } else {
          uploadMultipartFallback();
        }
      })
      .catch(() => uploadMultipartFallback());

    function uploadMultipartFallback() {
      try {
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: 'audio/wav' });

        const formData = new FormData();
        formData.append('audio', blob, cleanName);

        fetch(`${finalUrl}/api/audio/upload/${jobId}?clientId=${encodeURIComponent(activeClientId)}`, {
          method: 'POST',
          headers: {
            'X-Client-Id': activeClientId,
            'X-Session-Token': sessionToken || activeClientId,
          },
          body: formData,
        })
          .then((r) => r.json())
          .then((resData) => sendResponse({ success: resData?.success || false, data: resData }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }

    return true;
  }

  sendResponse({ success: false, error: `Unknown message type: ${type}` });
  return false;
});
