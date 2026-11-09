/**
 * Background Service Worker (Manifest V3)
 * Coordinates tabs, relays messages between website dashboard (Cloud/Local) and Google AI Studio tab.
 * Automatically ensures content scripts and dock are active in AI Studio tabs.
 * Supports multi-client workspace partitioning.
 */

let backendUrl = 'http://localhost:3000';
let sessionToken = null;
let clientId = 'default';
let downloadSubfolder = 'unduhan';
let activeAiStudioTabId = null;
let currentProcessingFilename = null;
let currentProcessingJobId = null;
let latestCapturedDownload = null;
let latestCapturedBufferBase64 = null;
let latestCapturedBufferName = null;
let latestCapturedBufferSize = 0;

// Listen to download creation to capture the exact blob URL and notify content script immediately
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    console.log('[AI TTS Background] Download item created:', item.id, item.url, item.filename);
    const isAudioDownload =
      (item.mime && (item.mime.includes('audio') || item.mime.includes('wav'))) ||
      (item.url && (item.url.startsWith('blob:') || item.url.includes('.wav'))) ||
      (item.filename && item.filename.toLowerCase().endsWith('.wav')) ||
      (currentProcessingFilename && currentProcessingFilename.length > 0);

    if (isAudioDownload) {
      latestCapturedDownload = {
        id: item.id,
        url: item.url,
        filename: currentProcessingFilename || item.filename || 'audio.wav',
        mime: item.mime,
        timestamp: Date.now(),
      };

      // Notify content script in AI Studio tab immediately with the blob URL
      const tab = await findAiStudioTab();
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'CAPTURE_DOWNLOAD_ITEM',
          url: item.url,
          filename: currentProcessingFilename || item.filename,
          downloadId: item.id,
        });
      }

      // Try fetching blob directly in service worker if context permits (avoid blob:null)
      if (item.url && item.url.startsWith('blob:http')) {
        try {
          const resp = await fetch(item.url);
          const blob = await resp.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const header = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
          if (arrayBuffer.byteLength >= 400) {
            let binary = '';
            const bytes = new Uint8Array(arrayBuffer);
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            latestCapturedBufferBase64 = btoa(binary);
            latestCapturedBufferName = currentProcessingFilename || item.filename || 'audio.wav';
            latestCapturedBufferSize = arrayBuffer.byteLength;
            console.log('[AI TTS Background] Cached audio buffer in SW directly:', latestCapturedBufferSize);
          }
        } catch (e) {
          // Content script in tab origin or local folder sync will handle
        }
      }
    }
  });
}

// Ensure Chrome downloads have the exact matching job filename instead of default assistant.wav
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const isWav =
      item.filename.toLowerCase().includes('assistant') ||
      item.filename.toLowerCase().endsWith('.wav') ||
      item.mime === 'audio/wav' ||
      item.mime === 'audio/x-wav' ||
      (item.url && item.url.startsWith('blob:'));

    if (isWav) {
      const targetName = currentProcessingFilename || item.filename || 'audio.wav';
      const cleanName = targetName.toLowerCase().endsWith('.wav') ? targetName : `${targetName}.wav`;
      const subPrefix = (downloadSubfolder || 'unduhan').trim().replace(/^\/+|\/+$/g, '') || 'unduhan';
      const fullPath = `${subPrefix}/${cleanName}`;
      console.log('[AI TTS Background] Directing download to', fullPath, 'URL:', item.url);

      // Also notify active tab of this download item URL if not already done
      findAiStudioTab().then((tab) => {
        if (tab && tab.id && item.url) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'CAPTURE_DOWNLOAD_ITEM',
            url: item.url,
            filename: cleanName,
            downloadId: item.id,
          });
        }
      });

      suggest({ filename: fullPath, conflictAction: 'overwrite' });
      return true;
    }
    suggest();
  });
}

// Initialize state from persistent storage
chrome.storage.local.get(['backendUrl', 'sessionToken', 'clientId', 'downloadSubfolder'], (res) => {
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
  sendHeartbeat();
});

// Find active or open Google AI Studio tab
async function findAiStudioTab() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*' });
    if (tabs.length > 0) {
      activeAiStudioTabId = tabs[0].id;
      return tabs[0];
    }
  } catch (e) {
    console.warn('Error querying tabs:', e);
  }
  return null;
}

// Automatically ensure selectors.js and content.js are injected in Google AI Studio tab
async function ensureContentScriptInjected(tabId) {
  try {
    const isAlive = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!isAlive) {
      console.log('[AI TTS Background] Injecting content scripts into tab', tabId);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['selectors.js', 'content.js'],
      });
    }
    return true;
  } catch (err) {
    console.warn('[AI TTS Background] Injection error:', err);
    return false;
  }
}

// Send heartbeat to backend
async function sendHeartbeat() {
  if (!backendUrl) return;
  try {
    const tab = await findAiStudioTab();
    if (tab && tab.id) {
      ensureContentScriptInjected(tab.id);
    }

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
        version: '1.1.0',
        clientId,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.currentJobId && tab) {
        checkAndProcessNextJob();
      }
    }
  } catch (err) {
    // Backend may be starting
  }
}

// Check and process next job from backend
async function checkAndProcessNextJob() {
  if (!backendUrl) return;
  try {
    const cleanUrl = backendUrl.replace(/\/$/, '');
    const res = await fetch(`${cleanUrl}/api/extension/next-job?clientId=${encodeURIComponent(clientId)}`, {
      headers: {
        'X-Session-Token': sessionToken || clientId,
        'X-Client-Id': clientId,
      },
    });
    if (!res.ok) return;
    const data = await res.json();

    if (data.hasJob && data.job && activeAiStudioTabId) {
      await ensureContentScriptInjected(activeAiStudioTabId);
      chrome.tabs.sendMessage(activeAiStudioTabId, {
        action: 'PROCESS_JOB',
        jobId: data.job.id,
        payload: {
          id: data.job.id,
          order: data.job.order,
          filename: data.job.filename,
          text: data.job.text,
          backendUrl: cleanUrl,
          clientId: clientId,
        },
      });
    }
  } catch (e) {}
}

// Auto-inject on tab navigation or tab completion
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('aistudio.google.com')) {
    activeAiStudioTabId = tabId;
    ensureContentScriptInjected(tabId);
    sendHeartbeat();
  }
});

setInterval(sendHeartbeat, 4000);

// Listen to messages from content scripts, bridge, and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  if (type === 'AI_STUDIO_TAB_READY') {
    if (sender.tab) {
      activeAiStudioTabId = sender.tab.id;
    }
    sendHeartbeat();
    sendResponse({ received: true });
    return true;
  }

  if (type === 'CONNECT' || type === 'HANDSHAKE' || type === 'SET_BACKEND_URL') {
    if (payload?.backendUrl) {
      backendUrl = payload.backendUrl.replace(/\/$/, '');
      chrome.storage.local.set({ backendUrl });
    }
    if (payload?.clientId) {
      clientId = payload.clientId;
      chrome.storage.local.set({ clientId });
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
      body: JSON.stringify({ client: 'AI TTS Extension V1.0', version: '1.1.0', clientId }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        const latency = Date.now() - startTime;
        if (data.success) {
          sessionToken = data.token;
          chrome.storage.local.set({ sessionToken });
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
    findAiStudioTab().then(async (tab) => {
      if (tab && tab.id) {
        ensureContentScriptInjected(tab.id);
      }
      sendResponse({
        success: true,
        backendUrl,
        clientId,
        downloadSubfolder,
        aiStudioConnected: !!tab,
        tabId: tab ? tab.id : null,
        sessionToken,
      });
    });
    return true;
  }

  if (type === 'SET_DOWNLOAD_SUBFOLDER') {
    downloadSubfolder = (payload?.subfolder || '').trim() || 'unduhan';
    chrome.storage.local.set({ downloadSubfolder }, () => {
      sendResponse({ success: true, downloadSubfolder });
    });
    return true;
  }

  if (type === 'SET_DOCK_VISIBILITY') {
    const isVisible = payload?.visible !== false;
    chrome.storage.local.set({ dockVisible: isVisible }, () => {
      findAiStudioTab().then((tab) => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'SET_DOCK_VISIBILITY', visible: isVisible });
        }
      });
      sendResponse({ success: true, dockVisible: isVisible });
    });
    return true;
  }

  if (type === 'TOGGLE_DOCK') {
    chrome.storage.local.get(['dockVisible'], (res) => {
      const current = res?.dockVisible !== false;
      const next = !current;
      chrome.storage.local.set({ dockVisible: next }, () => {
        findAiStudioTab().then((tab) => {
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'SET_DOCK_VISIBILITY', visible: next });
          }
        });
        sendResponse({ success: true, dockVisible: next });
      });
    });
    return true;
  }

  if (type === 'GET_DOCK_VISIBILITY') {
    chrome.storage.local.get(['dockVisible'], (res) => {
      sendResponse({ success: true, dockVisible: res?.dockVisible !== false });
    });
    return true;
  }

  if (type === 'JOB_AUDIO_RECEIVED') {
    const receivedJobId = payload?.jobId;
    const receivedFilename = payload?.filename;
    findAiStudioTab().then((tab) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'AUDIO_CONFIRMED_ON_WEBSITE',
          jobId: receivedJobId,
          filename: receivedFilename,
        });
      }
    });
    sendResponse({ success: true, jobId: receivedJobId });
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

  // Trigger automated download with exact job filename into unduhan or chosen folder
  if (type === 'DOWNLOAD_FILE') {
    const { url, filename } = payload;
    if (chrome.downloads && url) {
      currentProcessingFilename = filename;
      const subPrefix = (downloadSubfolder || 'unduhan').trim().replace(/^\/+|\/+$/g, '') || 'unduhan';
      const cleanName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
      const fullPath = `${subPrefix}/${cleanName}`;
      chrome.downloads.download(
        {
          url,
          filename: fullPath,
          saveAs: false,
          conflictAction: 'overwrite',
        },
        (downloadId) => {
          sendResponse({ success: !!downloadId, downloadId, fullPath });
        }
      );
      return true;
    }
    sendResponse({ success: false });
    return true;
  }

  // Directly download memory captured audio buffer (base64) into unduhan or chosen folder
  if (type === 'DOWNLOAD_BUFFER_OR_BLOB') {
    const { filename, base64Data } = payload;
    if (chrome.downloads && base64Data) {
      const subPrefix = (downloadSubfolder || 'unduhan').trim().replace(/^\/+|\/+$/g, '') || 'unduhan';
      const cleanName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
      const fullPath = `${subPrefix}/${cleanName}`;
      const dataUrl = `data:audio/wav;base64,${base64Data}`;
      currentProcessingFilename = cleanName;
      chrome.downloads.download(
        {
          url: dataUrl,
          filename: fullPath,
          saveAs: false,
          conflictAction: 'overwrite',
        },
        (downloadId) => {
          sendResponse({ success: !!downloadId, downloadId, fullPath });
        }
      );
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
});
