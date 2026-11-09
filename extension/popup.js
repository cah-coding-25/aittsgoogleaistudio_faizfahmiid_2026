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

  const inputSubfolder = document.getElementById('input-subfolder');
  const btnSaveSubfolder = document.getElementById('btn-save-subfolder');

  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');
  const btnOpenAiStudio = document.getElementById('btn-open-aistudio');
  const btnDiagnostics = document.getElementById('btn-diagnostics');
  const diagBox = document.getElementById('diag-results');
  const diagOutput = document.getElementById('diag-output');
  const btnCloseDiag = document.getElementById('btn-close-diag');

  let currentBackendUrl = 'http://localhost:3000';
  let isDockVisible = true;

  // Load saved backend URL, download subfolder, and dock visibility state
  chrome.storage.local.get(['backendUrl', 'downloadSubfolder', 'dockVisible'], (res) => {
    if (res.backendUrl) {
      currentBackendUrl = res.backendUrl;
      inputServerUrl.value = res.backendUrl;
    } else {
      inputServerUrl.value = currentBackendUrl;
    }
    if (inputSubfolder) {
      inputSubfolder.value = res.downloadSubfolder !== undefined ? res.downloadSubfolder : 'unduhan';
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
      if (!res) {
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
        aistudioStatus.innerText = 'Tab Tidak Ditemukan';
        aistudioStatus.className = 'val val-waiting';
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
      btnSaveUrl.innerText = 'Tersimpan!';
      setTimeout(() => (btnSaveUrl.innerText = 'Simpan'), 1200);

      if (res && res.success) {
        latencyVal.innerText = `${res.latency} ms`;
        latencyVal.className = 'val val-connected';
      } else {
        latencyVal.innerText = 'Gagal';
        latencyVal.className = 'val text-muted';
      }
      updateStatus();
    });
  });

  // Save custom download subfolder (supports full path link like C:\Users\USER\Downloads\unduhan)
  if (btnSaveSubfolder && inputSubfolder) {
    btnSaveSubfolder.addEventListener('click', () => {
      let rawVal = inputSubfolder.value.trim().replace(/[/\\]+$/, '');
      const segments = rawVal.split(/[/\\]/);
      const cleanSubfolder = segments[segments.length - 1] || 'unduhan';
      inputSubfolder.value = cleanSubfolder;

      btnSaveSubfolder.innerText = 'Menyimpan...';
      chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: cleanSubfolder } }, (res) => {
        btnSaveSubfolder.innerText = 'Tersimpan!';
        setTimeout(() => (btnSaveSubfolder.innerText = 'Simpan'), 1200);
      });
    });

    const presetUnduhan = document.getElementById('folder-preset-unduhan');
    const presetTts = document.getElementById('folder-preset-tts');
    const presetAudio = document.getElementById('folder-preset-audio');

    const setAndSaveSubfolder = (name) => {
      inputSubfolder.value = name;
      chrome.runtime.sendMessage({ type: 'SET_DOWNLOAD_SUBFOLDER', payload: { subfolder: name } }, () => {
        btnSaveSubfolder.innerText = 'Tersimpan!';
        setTimeout(() => (btnSaveSubfolder.innerText = 'Simpan'), 1200);
      });
    };

    if (presetUnduhan) presetUnduhan.addEventListener('click', () => setAndSaveSubfolder('unduhan'));
    if (presetTts) presetTts.addEventListener('click', () => setAndSaveSubfolder('tts_wav'));
    if (presetAudio) presetAudio.addEventListener('click', () => setAndSaveSubfolder('audio_studio'));

    const btnPickFolderDevice = document.getElementById('btn-pick-folder-device');
    if (btnPickFolderDevice) {
      btnPickFolderDevice.addEventListener('click', async () => {
        try {
          if ('showDirectoryPicker' in window) {
            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            if (dirHandle && dirHandle.name) {
              setAndSaveSubfolder(dirHandle.name);
              return;
            }
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }

        // If popup environment restricts showDirectoryPicker, forward to active tab
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'TRIGGER_FOLDER_PICKER' }, (res) => {
              if (res && res.folderName) {
                setAndSaveSubfolder(res.folderName);
              }
            });
          }
        } catch (e) {}
      });
    }
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
          alert('Tab saat ini adalah Google AI Studio atau Chrome page. Buka tab dashboard website Anda terlebih dahulu.');
        }
      }
    } catch (e) {
      alert('Gagal mendeteksi tab saat ini: ' + e.message);
    }
  });

  // Presets
  presetLocalhost.addEventListener('click', () => {
    inputServerUrl.value = 'http://localhost:3000';
    btnSaveUrl.click();
  });

  presetDev.addEventListener('click', () => {
    inputServerUrl.value = window.location.origin.includes('localhost') ? 'http://localhost:3000' : window.location.origin;
    btnSaveUrl.click();
  });

  // Test connection & Handshake
  btnTestConnection.addEventListener('click', () => {
    btnTestConnection.innerText = 'Menguji Koneksi...';
    const targetUrl = (inputServerUrl.value || currentBackendUrl).trim().replace(/\/$/, '');

    chrome.runtime.sendMessage({ type: 'CONNECT', payload: { backendUrl: targetUrl } }, (res) => {
      btnTestConnection.innerText = '⚡ Uji Koneksi & Handshake';
      if (res && res.success) {
        latencyVal.innerText = `${res.latency} ms`;
        latencyVal.className = 'val val-connected';
      } else {
        latencyVal.innerText = 'Error';
        latencyVal.className = 'val text-muted';
        alert(res?.error || 'Koneksi ke server gagal. Pastikan website sudah online.');
      }
      updateStatus();
    });
  });

  // Open Web Dashboard in browser
  btnOpenDashboard.addEventListener('click', () => {
    const url = inputServerUrl.value.trim() || currentBackendUrl || 'http://localhost:3000';
    chrome.tabs.create({ url });
  });

  // Open Google AI Studio in browser
  btnOpenAiStudio.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/' });
  });

  // Diagnostics DOM
  btnDiagnostics.addEventListener('click', () => {
    btnDiagnostics.innerText = 'Memeriksa DOM AI Studio...';
    chrome.runtime.sendMessage({ type: 'RUN_DIAGNOSTICS' }, (res) => {
      btnDiagnostics.innerText = '🔍 Uji Selektor DOM AI Studio';
      diagBox.classList.remove('hidden');
      if (res && res.success && res.diagnostics) {
        diagOutput.innerText = JSON.stringify(res.diagnostics, null, 2);
      } else {
        diagOutput.innerText = res?.error || 'Gagal menjalankan diagnostik. Pastikan tab https://aistudio.google.com/ terbuka.';
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
