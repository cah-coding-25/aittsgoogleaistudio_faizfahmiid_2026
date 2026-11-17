document.addEventListener('DOMContentLoaded', () => {
  const backendBadge = document.getElementById('backend-status-badge');
  const aistudioStatus = document.getElementById('aistudio-status');
  const serverStatusVal = document.getElementById('server-status-val');
  const latencyVal = document.getElementById('latency-val');
  const sessionBadge = document.getElementById('session-badge');

  const btnToggleDock = document.getElementById('btn-toggle-dock');
  const dockToggleLabel = document.getElementById('dock-toggle-label');

  const inputServerUrl = document.getElementById('input-server-url');
  const btnSaveUrl = document.getElementById('btn-save-url');
  const btnUseCurrentTab = document.getElementById('btn-use-current-tab');
  const presetLocalhost = document.getElementById('preset-localhost');
  const presetDev = document.getElementById('preset-dev');

  const extFolderBadge = document.getElementById('ext-folder-badge');
  const extFolderPath = document.getElementById('ext-folder-path');
  const btnPickExtFolder = document.getElementById('btn-pick-ext-folder');

  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');
  const btnOpenAiStudio = document.getElementById('btn-open-aistudio');
  const btnDiagnostics = document.getElementById('btn-diagnostics');
  const diagBox = document.getElementById('diag-results');
  const diagOutput = document.getElementById('diag-output');
  const btnCloseDiag = document.getElementById('btn-close-diag');
  const popupNotice = document.getElementById('popup-notice');

  const DEFAULT_BACKEND_URL = 'http://localhost:3000';
  let currentBackendUrl = 'http://localhost:3000';
  let isDockVisible = true;
  let noticeTimer = null;

  function showNotice(text, kind = 'info') {
    if (!popupNotice) return;
    if (noticeTimer) clearTimeout(noticeTimer);
    popupNotice.classList.remove('hidden');
    popupNotice.textContent = text;
    if (kind === 'error') {
      popupNotice.style.background = 'rgba(239, 68, 68, 0.15)';
      popupNotice.style.border = '1px solid rgba(239, 68, 68, 0.45)';
      popupNotice.style.color = '#fca5a5';
    } else if (kind === 'success') {
      popupNotice.style.background = 'rgba(16, 185, 129, 0.15)';
      popupNotice.style.border = '1px solid rgba(16, 185, 129, 0.45)';
      popupNotice.style.color = '#6ee7b7';
    } else {
      popupNotice.style.background = 'rgba(14, 165, 233, 0.15)';
      popupNotice.style.border = '1px solid rgba(56, 189, 248, 0.45)';
      popupNotice.style.color = '#7dd3fc';
    }
    noticeTimer = setTimeout(() => {
      popupNotice.classList.add('hidden');
    }, 4500);
  }

  // Load saved backend URL and dock visibility state
  chrome.storage.local.get(['backendUrl', 'dockVisible'], (res) => {
    if (res.backendUrl) {
      currentBackendUrl = res.backendUrl;
      inputServerUrl.value = res.backendUrl;
    } else {
      inputServerUrl.value = currentBackendUrl;
    }
    isDockVisible = res.dockVisible !== false;
    updateDockToggleUI(isDockVisible);
    updateStatus();
  });

  function updateDockToggleUI(visible) {
    if (visible) {
      if (btnToggleDock) {
        btnToggleDock.innerText = '🟢 MATIKAN';
        btnToggleDock.style.background = '#0284c7';
      }
      if (dockToggleLabel) {
        dockToggleLabel.innerText = 'HIDUP (Muncul di layar)';
        dockToggleLabel.style.color = '#38bdf8';
      }
    } else {
      if (btnToggleDock) {
        btnToggleDock.innerText = '🔴 HIDUPKAN';
        btnToggleDock.style.background = '#e11d48';
      }
      if (dockToggleLabel) {
        dockToggleLabel.innerText = 'MATI (Sidebar disembunyikan)';
        dockToggleLabel.style.color = '#f43f5e';
      }
    }
  }

  // Master Switch: Hidupkan / Matikan Sidebar Google AI Studio
  if (btnToggleDock) {
    btnToggleDock.addEventListener('click', () => {
      isDockVisible = !isDockVisible;
      updateDockToggleUI(isDockVisible);
      chrome.storage.local.set({ dockVisible: isDockVisible });

      // Notify all Google AI Studio tabs immediately
      chrome.tabs.query({ url: '*://aistudio.google.com/*' }, (tabs) => {
        tabs.forEach((t) => {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { action: 'SET_DOCK_VISIBILITY', visible: isDockVisible }).catch(() => {});
          }
        });
      });
    });
  }

  function updateStatus() {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        backendBadge.className = 'badge badge-offline';
        backendBadge.innerText = 'Offline';
        serverStatusVal.innerText = 'Extension Tidak Siap';
        serverStatusVal.className = 'val text-muted';
        return;
      }

      if (res.backendUrl) {
        currentBackendUrl = res.backendUrl;
        if (!inputServerUrl.value || inputServerUrl.value === 'http://localhost:3000') {
          inputServerUrl.value = res.backendUrl;
        }
      }

      if (res.sessionToken) {
        backendBadge.className = 'badge badge-online';
        backendBadge.innerText = 'Online';
        serverStatusVal.innerText = 'Terhubung ke Server';
        serverStatusVal.className = 'val val-connected';
        sessionBadge.innerText = 'Terotentikasi (' + res.sessionToken.substring(0, 6) + '...)';
        sessionBadge.className = 'val val-connected';
      } else {
        backendBadge.className = 'badge badge-offline';
        backendBadge.innerText = 'Offline';
        serverStatusVal.innerText = 'Belum Handshake';
        serverStatusVal.className = 'val val-waiting';
        sessionBadge.innerText = 'Menunggu Handshake';
        sessionBadge.className = 'val text-muted';
      }

      if (res.aiStudioConnected) {
        aistudioStatus.innerText = 'Tab Terdeteksi (#' + (res.tabId || '') + ')';
        aistudioStatus.className = 'val val-connected';
      } else {
        aistudioStatus.innerText = 'Tab TTS Belum Terbuka';
        aistudioStatus.className = 'val val-waiting';
      }

      if (extFolderPath && extFolderBadge) {
        extFolderPath.innerText = res.effectiveTargetLabel || 'Belum Terhubung';
        if (res.linkedFolderGranted) {
          extFolderBadge.innerText = 'TERHUBUNG LANGSUNG';
          extFolderBadge.style.color = '#34d399';
        } else if (res.detectedExtFolder) {
          extFolderBadge.innerText = 'AUTO-EKSTENSI';
          extFolderBadge.style.color = '#38bdf8';
        } else {
          extFolderBadge.innerText = 'PERLU SAMBUNG';
          extFolderBadge.style.color = '#fbbf24';
        }
      }
    });
  }

  // Save custom backend URL
  btnSaveUrl.addEventListener('click', () => {
    const rawVal = inputServerUrl.value.trim();
    if (!rawVal) return;

    let targetUrl = rawVal.replace(/\/$/, '');
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
      inputServerUrl.value = targetUrl;
    }

    btnSaveUrl.innerText = 'Menyimpan...';
    chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', payload: { backendUrl: targetUrl } }, (res) => {
      if (chrome.runtime.lastError) {
        btnSaveUrl.innerText = 'Simpan';
        showNotice('Gagal menghubungi background worker ekstensi.', 'error');
        return;
      }
      btnSaveUrl.innerText = 'Tersimpan!';
      setTimeout(() => (btnSaveUrl.innerText = 'Simpan'), 1200);

      if (res && res.success) {
        currentBackendUrl = targetUrl;
        latencyVal.innerText = `${res.latency} ms`;
        latencyVal.className = 'val val-connected';
        showNotice(`Server terhubung ke ${targetUrl} (${res.latency} ms)`, 'success');
      } else {
        latencyVal.innerText = 'Gagal';
        latencyVal.className = 'val text-muted';
        showNotice(res?.error || 'URL disimpan, namun server belum merespons handshake.', 'error');
      }
      updateStatus();
    });
  });

  // Open extension folder picker page
  if (btnPickExtFolder) {
    btnPickExtFolder.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_FOLDER_PICKER' }, () => {
        window.close();
      });
    });
  }

  // Use current tab URL
  btnUseCurrentTab.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.url) {
        const u = new URL(tabs[0].url);
        if (!u.hostname.includes('aistudio.google.com') && !u.protocol.startsWith('chrome')) {
          inputServerUrl.value = u.origin;
          btnSaveUrl.click();
        } else {
          showNotice('Tab aktif bukan halaman Dashboard website. Buka tab AI TTS Studio Anda lalu klik "Tab Ini".', 'error');
        }
      }
    } catch (e) {
      showNotice('Gagal mendeteksi tab saat ini: ' + e.message, 'error');
    }
  });

  // Presets
  presetLocalhost.addEventListener('click', () => {
    inputServerUrl.value = 'http://localhost:3000';
    btnSaveUrl.click();
  });

  presetDev.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const dashTab = tabs.find((t) => {
        if (!t.url) return false;
        try {
          const u = new URL(t.url);
          return (u.protocol === 'https:' || u.protocol === 'http:') && !u.hostname.includes('aistudio.google.com');
        } catch {
          return false;
        }
      });
      if (dashTab?.url) {
        inputServerUrl.value = new URL(dashTab.url).origin;
      } else {
        inputServerUrl.value = (currentBackendUrl && !currentBackendUrl.startsWith('chrome-extension:'))
          ? currentBackendUrl
          : DEFAULT_BACKEND_URL;
      }
      btnSaveUrl.click();
    } catch (e) {
      inputServerUrl.value = DEFAULT_BACKEND_URL;
      btnSaveUrl.click();
    }
  });

  // Test connection & Handshake
  btnTestConnection.addEventListener('click', () => {
    btnTestConnection.innerText = 'Menguji Koneksi...';
    const targetUrl = (inputServerUrl.value || currentBackendUrl).trim().replace(/\/$/, '');

    chrome.runtime.sendMessage({ type: 'CONNECT', payload: { backendUrl: targetUrl } }, (res) => {
      btnTestConnection.innerText = '⚡ Uji Koneksi & Handshake';
      if (!chrome.runtime.lastError && res && res.success) {
        latencyVal.innerText = `${res.latency} ms`;
        latencyVal.className = 'val val-connected';
        showNotice(`Handshake berhasil (${res.latency} ms)`, 'success');
      } else {
        latencyVal.innerText = 'Error';
        latencyVal.className = 'val text-muted';
        showNotice(chrome.runtime.lastError?.message || res?.error || 'Koneksi ke server gagal. Pastikan website sudah online.', 'error');
      }
      updateStatus();
    });
  });

  // Open Web Dashboard in browser
  btnOpenDashboard.addEventListener('click', () => {
    const url = inputServerUrl.value.trim() || currentBackendUrl || 'http://localhost:3000';
    chrome.tabs.create({ url });
  });

  // Open Google AI Studio TTS Playground in browser
  btnOpenAiStudio.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/generate-speech' });
  });

  // Diagnostics DOM
  btnDiagnostics.addEventListener('click', () => {
    btnDiagnostics.innerText = 'Memeriksa DOM AI Studio...';
    chrome.runtime.sendMessage({ type: 'RUN_DIAGNOSTICS' }, (res) => {
      btnDiagnostics.innerText = '🔍 Uji Selektor DOM AI Studio';
      diagBox.classList.remove('hidden');
      if (!chrome.runtime.lastError && res && res.success && res.diagnostics) {
        diagOutput.innerText = JSON.stringify(res.diagnostics, null, 2);
      } else {
        diagOutput.innerText = chrome.runtime.lastError?.message || res?.error || 'Gagal menjalankan diagnostik. Pastikan tab https://aistudio.google.com/ terbuka.';
      }
    });
  });

  if (btnCloseDiag) {
    btnCloseDiag.addEventListener('click', () => {
      diagBox.classList.add('hidden');
    });
  }

  updateStatus();
  setInterval(updateStatus, 3000);
});
