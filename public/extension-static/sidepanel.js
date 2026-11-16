const DEFAULT_BACKEND_URL = 'http://localhost:3000';
let currentBackendUrl = 'http://localhost:3000';
let clientId = 'default';

document.addEventListener('DOMContentLoaded', () => {
  const onlinePill = document.getElementById('sp-online-pill');
  const latencyChip = document.getElementById('sp-latency-chip');
  const tabConnPill = document.getElementById('sp-tab-conn-pill');
  const aiStudioVal = document.getElementById('sp-aistudio-val');
  const serverVal = document.getElementById('sp-server-val');

  const inputBackendUrl = document.getElementById('sp-backend-url');
  const btnSaveUrl = document.getElementById('sp-btn-save-url');
  const btnUseTab = document.getElementById('sp-btn-use-tab');
  const btnOpenAiStudio = document.getElementById('sp-btn-open-aistudio');

  const folderBadge = document.getElementById('sp-folder-badge');
  const folderBox = document.getElementById('sp-folder-box');
  const btnPickFolder = document.getElementById('sp-btn-pick-folder');

  const jobStatusPill = document.getElementById('sp-job-status-pill');
  const jobFilenameEl = document.getElementById('sp-job-filename');
  const jobTextEl = document.getElementById('sp-job-text');
  const stepCounterEl = document.getElementById('sp-step-counter');

  const consoleBox = document.getElementById('sp-console-box');
  const btnClearLog = document.getElementById('sp-btn-clear-log');
  const btnDiag = document.getElementById('sp-btn-diag');
  const diagBox = document.getElementById('sp-diag-box');
  const diagPre = document.getElementById('sp-diag-pre');
  const btnCloseDiag = document.getElementById('sp-btn-close-diag');

  const noticeEl = document.getElementById('sp-notice');
  const btnSync = document.getElementById('sp-btn-sync');
  const btnWebsite = document.getElementById('sp-btn-website');

  let noticeTimer = null;

  function showNotice(text, kind = 'info') {
    if (!noticeEl) return;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeEl.classList.remove('hidden');
    noticeEl.textContent = text;
    if (kind === 'error') {
      noticeEl.style.background = 'rgba(239, 68, 68, 0.14)';
      noticeEl.style.border = '1px solid rgba(239, 68, 68, 0.4)';
      noticeEl.style.color = '#fca5a5';
    } else if (kind === 'success') {
      noticeEl.style.background = 'rgba(16, 185, 129, 0.14)';
      noticeEl.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      noticeEl.style.color = '#6ee7b7';
    } else {
      noticeEl.style.background = 'rgba(56, 189, 248, 0.12)';
      noticeEl.style.border = '1px solid rgba(56, 189, 248, 0.35)';
      noticeEl.style.color = '#7dd3fc';
    }
    noticeTimer = setTimeout(() => {
      noticeEl.classList.add('hidden');
    }, 4500);
  }

  function applyStep(stepIndex) {
    const idx = Math.max(0, Math.min(5, Number(stepIndex) || 0));
    if (stepCounterEl) stepCounterEl.textContent = `${idx}/5`;
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`sp-step-${i}`);
      if (!el) continue;
      el.classList.remove('active', 'done');
      if (idx > 0) {
        if (i < idx) el.classList.add('done');
        else if (i === idx) el.classList.add('active');
      }
    }
  }

  function applyRunnerState(st) {
    if (!st || typeof st !== 'object') return;
    if (jobFilenameEl && typeof st.jobFilename === 'string') {
      jobFilenameEl.textContent = st.jobFilename;
    }
    if (jobTextEl && typeof st.jobText === 'string') {
      jobTextEl.textContent = st.jobText;
    }
    if (jobStatusPill && typeof st.jobStatus === 'string') {
      const s = st.jobStatus.toUpperCase();
      jobStatusPill.textContent = s;
      jobStatusPill.className = 'sp-pill';
      if (s.includes('SELESAI') || s.includes('COMPLETED')) {
        jobStatusPill.classList.add('sp-pill-ok');
      } else if (s.includes('GAGAL') || s.includes('FAILED') || s.includes('HENTI')) {
        jobStatusPill.classList.add('sp-pill-err');
      } else if (s.includes('ULANG') || s.includes('LOADING') || s.includes('MENGUNDUH') || s.includes('DIPROSES')) {
        jobStatusPill.classList.add('sp-pill-wait');
      } else {
        jobStatusPill.classList.add('sp-pill-info');
      }
    }
    if (typeof st.stepIndex === 'number') {
      applyStep(st.stepIndex);
    }
  }

  function appendConsoleLine(entry) {
    if (!consoleBox || !entry || !entry.message) return;
    const line = document.createElement('div');
    const kind = entry.kind || 'default';
    line.className = `sp-log-line ${
      kind === 'success'
        ? 'sp-log-success'
        : kind === 'error'
        ? 'sp-log-error'
        : kind === 'warn'
        ? 'sp-log-warn'
        : kind === 'info'
        ? 'sp-log-info'
        : ''
    }`;
    const timeStr = entry.time || new Date().toLocaleTimeString();
    line.textContent = `[${timeStr}] ${entry.message}`;
    consoleBox.appendChild(line);
    while (consoleBox.children.length > 150) {
      consoleBox.removeChild(consoleBox.firstElementChild);
    }
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  function hydrateSnapshot() {
    chrome.runtime.sendMessage({ type: 'GET_SIDEPANEL_SNAPSHOT' }, (res) => {
      if (chrome.runtime.lastError || !res?.success) return;
      if (res.state) applyRunnerState(res.state);
      if (Array.isArray(res.logs) && res.logs.length > 0 && consoleBox) {
        consoleBox.innerHTML = '';
        res.logs.forEach((entry) => appendConsoleLine(entry));
      }
    });
  }

  function checkBackendHealth(url) {
    const clean = (url || currentBackendUrl || DEFAULT_BACKEND_URL).replace(/\/$/, '');
    const t0 = Date.now();
    fetch(`${clean}/api/health`)
      .then((r) => r.json())
      .then(() => {
        const ms = Date.now() - t0;
        if (onlinePill) {
          onlinePill.textContent = 'ONLINE';
          onlinePill.className = 'sp-pill sp-pill-ok';
        }
        if (latencyChip) latencyChip.textContent = `${ms} ms`;
        if (serverVal) {
          serverVal.textContent = 'Terhubung';
          serverVal.className = 'sp-conn-val sp-val-ok';
        }
      })
      .catch(() => {
        if (onlinePill) {
          onlinePill.textContent = 'OFFLINE';
          onlinePill.className = 'sp-pill sp-pill-err';
        }
        if (latencyChip) latencyChip.textContent = 'Err';
        if (serverVal) {
          serverVal.textContent = 'Tidak Terjangkau';
          serverVal.className = 'sp-conn-val sp-val-err';
        }
      });
  }

  function refreshStatus(withHealth = false) {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        if (onlinePill) {
          onlinePill.textContent = 'OFFLINE';
          onlinePill.className = 'sp-pill sp-pill-err';
        }
        return;
      }

      if (res.backendUrl) {
        currentBackendUrl = res.backendUrl;
        if (inputBackendUrl && document.activeElement !== inputBackendUrl) {
          inputBackendUrl.value = res.backendUrl;
        }
      }
      if (res.clientId) clientId = res.clientId;

      if (res.aiStudioConnected) {
        if (aiStudioVal) {
          aiStudioVal.textContent = `Siap (Tab #${res.tabId || '-'})`;
          aiStudioVal.className = 'sp-conn-val sp-val-ok';
        }
      } else {
        if (aiStudioVal) {
          aiStudioVal.textContent = 'Belum Terbuka';
          aiStudioVal.className = 'sp-conn-val sp-val-warn';
        }
      }

      if (tabConnPill) {
        if (res.aiStudioConnected && res.sessionToken) {
          tabConnPill.textContent = 'Terhubung';
          tabConnPill.className = 'sp-pill sp-pill-ok';
        } else if (res.aiStudioConnected) {
          tabConnPill.textContent = 'AI Studio Siap';
          tabConnPill.className = 'sp-pill sp-pill-info';
        } else {
          tabConnPill.textContent = 'Menunggu Tab';
          tabConnPill.className = 'sp-pill sp-pill-wait';
        }
      }

      if (folderBox && folderBadge) {
        folderBox.textContent = res.effectiveTargetLabel || 'Belum Terhubung — Klik tombol di atas';
        if (res.linkedFolderGranted) {
          folderBadge.textContent = 'TERHUBUNG';
          folderBadge.className = 'sp-tag sp-tag-ok';
        } else if (res.detectedExtFolder) {
          folderBadge.textContent = 'AUTO-EKSTENSI';
          folderBadge.className = 'sp-tag sp-tag-info';
        } else {
          folderBadge.textContent = 'PERLU SAMBUNG';
          folderBadge.className = 'sp-tag sp-tag-warn';
        }
      }

      if (withHealth) {
        checkBackendHealth(currentBackendUrl);
      }
    });
  }

  // Listen for live updates from background / content script
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === 'SIDEPANEL_STATE_SYNC' && message.payload) {
      applyRunnerState(message.payload);
    } else if (message.type === 'SIDEPANEL_LOG_APPEND' && message.payload) {
      appendConsoleLine(message.payload);
    } else if (message.type === 'SIDEPANEL_LOGS_CLEARED') {
      if (consoleBox) consoleBox.innerHTML = '';
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.linkedFolderName || changes.linkedFolderMode || changes.detectedExtFolder || changes.downloadSubfolder) {
      refreshStatus(false);
    }
    if (changes.backendUrl?.newValue) {
      currentBackendUrl = changes.backendUrl.newValue;
      if (inputBackendUrl && document.activeElement !== inputBackendUrl) {
        inputBackendUrl.value = currentBackendUrl;
      }
      checkBackendHealth(currentBackendUrl);
    }
  });

  // Save Backend URL
  btnSaveUrl?.addEventListener('click', () => {
    const raw = (inputBackendUrl?.value || '').trim();
    if (!raw) return;
    let target = raw.replace(/\/$/, '');
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
      if (inputBackendUrl) inputBackendUrl.value = target;
    }

    btnSaveUrl.textContent = '...';
    chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', payload: { backendUrl: target } }, (res) => {
      btnSaveUrl.textContent = 'Simpan';
      if (chrome.runtime.lastError) {
        showNotice('Gagal menghubungi service worker ekstensi.', 'error');
        return;
      }
      if (res?.success) {
        currentBackendUrl = target;
        showNotice(`Server terhubung ke ${target} (${res.latency} ms)`, 'success');
      } else {
        showNotice(res?.error || 'URL disimpan, namun server belum merespons.', 'error');
      }
      refreshStatus(true);
    });
  });

  // Use active tab URL as Dashboard backendUrl
  btnUseTab?.addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeUrl = tabs[0]?.url;
      if (!activeUrl) return;
      const u = new URL(activeUrl);
      if (!u.hostname.includes('aistudio.google.com') && (u.protocol === 'https:' || u.protocol === 'http:')) {
        if (inputBackendUrl) inputBackendUrl.value = u.origin;
        btnSaveUrl?.click();
      } else {
        showNotice('Buka tab website Dashboard lalu klik "Tab Ini".', 'error');
      }
    } catch (e) {
      showNotice('Gagal membaca URL tab aktif.', 'error');
    }
  });

  // Open Google AI Studio TTS Playground
  btnOpenAiStudio?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_AISTUDIO_TAB' }, () => {
      void chrome.runtime.lastError;
      setTimeout(() => refreshStatus(false), 600);
    });
  });

  // Link extension `unduhan` folder
  btnPickFolder?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_FOLDER_PICKER' }, () => {
      void chrome.runtime.lastError;
      appendConsoleLine({ message: 'Tab penyambung folder "unduhan" dibuka.', kind: 'info' });
    });
  });

  // Clear console
  btnClearLog?.addEventListener('click', () => {
    if (consoleBox) consoleBox.innerHTML = '';
    chrome.runtime.sendMessage({ type: 'SIDEPANEL_CLEAR_LOGS' }, () => {
      void chrome.runtime.lastError;
    });
  });

  // Run DOM Diagnostics on Google AI Studio
  btnDiag?.addEventListener('click', () => {
    btnDiag.textContent = 'Cek...';
    chrome.runtime.sendMessage({ type: 'RUN_DIAGNOSTICS' }, (res) => {
      btnDiag.textContent = '🔍 Tes DOM';
      diagBox?.classList.remove('hidden');
      if (!chrome.runtime.lastError && res?.success && res.diagnostics) {
        if (diagPre) diagPre.textContent = JSON.stringify(res.diagnostics, null, 2);
        appendConsoleLine({
          message: `Diagnostik DOM: Input=${res.diagnostics.textInputFound}, Run=${res.diagnostics.runButtonFound}, Audio=${res.diagnostics.audioOutputFound}`,
          kind: res.diagnostics.textInputFound && res.diagnostics.runButtonFound ? 'success' : 'warn',
        });
      } else {
        const msg = chrome.runtime.lastError?.message || res?.error || 'Tab Google AI Studio belum terbuka.';
        if (diagPre) diagPre.textContent = msg;
        showNotice(msg, 'error');
      }
    });
  });

  btnCloseDiag?.addEventListener('click', () => {
    diagBox?.classList.add('hidden');
  });

  // Footer Left: Sync Status + Handshake
  btnSync?.addEventListener('click', () => {
    btnSync.textContent = '⏳ Menyinkronkan...';
    const targetUrl = (inputBackendUrl?.value || currentBackendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/$/, '');
    chrome.runtime.sendMessage({ type: 'CONNECT', payload: { backendUrl: targetUrl } }, (res) => {
      btnSync.textContent = '🔍 Sinkron Status';
      if (!chrome.runtime.lastError && res?.success) {
        showNotice(`Sinkronisasi & Handshake OK (${res.latency} ms)`, 'success');
        appendConsoleLine({ message: `Sinkronisasi berhasil (${res.latency} ms).`, kind: 'success' });
      } else {
        showNotice(res?.error || 'Server belum merespons. Periksa URL Dashboard.', 'error');
      }
      refreshStatus(true);
    });
  });

  // Footer Right: Open/Focus Website Dashboard
  btnWebsite?.addEventListener('click', () => {
    const targetUrl = (inputBackendUrl?.value || currentBackendUrl || DEFAULT_BACKEND_URL).trim().replace(/\/$/, '');
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', payload: { backendUrl: targetUrl } }, () => {
      void chrome.runtime.lastError;
    });
  });

  function isAiStudioTtsTabUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const u = new URL(rawUrl);
      if (u.hostname !== 'aistudio.google.com') return false;
      const p = (u.pathname || '/').toLowerCase();
      return !(
        p.startsWith('/apps') ||
        p.startsWith('/apikey') ||
        p.startsWith('/settings') ||
        p.startsWith('/usage') ||
        p.startsWith('/billing') ||
        p.startsWith('/docs')
      );
    } catch {
      return false;
    }
  }

  async function enforceAiStudioTabScope() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const active = tabs[0];
      if (active && typeof active.id === 'number' && active.url && !isAiStudioTtsTabUrl(active.url)) {
        if (chrome.sidePanel?.setOptions) {
          await chrome.sidePanel.setOptions({ tabId: active.id, enabled: false }).catch(() => {});
        }
        try {
          window.close();
        } catch {}
      }
    } catch {}
  }

  if (chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(() => {
      enforceAiStudioTabScope();
    });
  }

  // Initial load
  enforceAiStudioTabScope();
  chrome.storage.local.get(['backendUrl', 'clientId'], (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.backendUrl) {
      currentBackendUrl = res.backendUrl;
      if (inputBackendUrl) inputBackendUrl.value = res.backendUrl;
    } else if (inputBackendUrl) {
      inputBackendUrl.value = DEFAULT_BACKEND_URL;
    }
    if (res?.clientId) clientId = res.clientId;
    hydrateSnapshot();
    refreshStatus(true);
  });

  setInterval(() => refreshStatus(false), 3000);
  setInterval(() => checkBackendHealth(currentBackendUrl), 6000);
});
