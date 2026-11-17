/**
 * Bridge Script injected into the local website dashboard.
 * Provides two-way communication between the React app and Chrome Extension.
 */

(() => {
  console.log('[AI TTS Bridge] Initialized on dashboard page.');

  // Announce presence to page window
  function announceReady() {
    window.postMessage(
      {
        source: 'AI_TTS_EXTENSION',
        type: 'EXTENSION_READY',
        version: '1.0.0',
      },
      '*'
    );
  }

  announceReady();
  setTimeout(announceReady, 400);
  setTimeout(announceReady, 1000);
  setTimeout(announceReady, 2000);
  setTimeout(announceReady, 4000);

  function readDashboardLocalSnapshot() {
    try {
      const hasCid = !!window.localStorage.getItem('ai_tts_client_workspace_id_v1');
      let hasAnyJobsKey = false;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('ai_tts_jobs_')) {
          hasAnyJobsKey = true;
          break;
        }
      }
      if (!hasCid && !hasAnyJobsKey) {
        return { isDashboard: false };
      }

      const cid = window.localStorage.getItem('ai_tts_client_workspace_id_v1') || 'default';
      let rawJobs = window.localStorage.getItem(`ai_tts_jobs_${cid}`);
      if (!rawJobs) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith('ai_tts_jobs_')) {
            const candidateVal = window.localStorage.getItem(k);
            if (candidateVal && candidateVal !== '[]') {
              rawJobs = candidateVal;
              break;
            }
          }
        }
      }
      if (!rawJobs) {
        rawJobs = window.localStorage.getItem('ai_tts_jobs_persistent_v1');
      }
      let jobs = [];
      let completedIds = [];
      let completedFilenames = [];
      if (rawJobs) {
        const parsed = JSON.parse(rawJobs);
        if (Array.isArray(parsed)) {
          completedIds = parsed
            .filter((j) => j && j.status === 'COMPLETED' && j.id)
            .map((j) => j.id);
          completedFilenames = parsed
            .filter((j) => j && j.status === 'COMPLETED' && j.filename)
            .map((j) => j.filename);
          jobs = parsed
            .filter((j) => j && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED')
            .sort((a, b) => ((Number(a.order) || 999999) - (Number(b.order) || 999999)) || ((Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)))
            .map((j) => ({
              id: j.id,
              order: j.order,
              filename: j.filename,
              text: j.text,
              status: j.status,
              retryCount: j.retryCount || 0,
              maxRetries: j.maxRetries || 3,
              createdAt: j.createdAt,
              clientId: j.clientId || cid,
            }));
        }
      }

      const activeFlag = window.localStorage.getItem(`ai_tts_queue_active_${cid}`) === '1';
      let domRunning = false;
      try {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          const txt = (b.innerText || b.textContent || '').trim();
          if (txt === 'Hentikan' || txt.includes('Jeda (Pause)')) {
            domRunning = true;
            break;
          }
        }
      } catch {}

      return {
        isDashboard: true,
        queueActive: activeFlag || domRunning,
        jobs,
        completedIds,
        completedFilenames,
      };
    } catch {
      return { isDashboard: false };
    }
  }

  // Listen to messages from Website
  window.addEventListener('message', async (event) => {
    // Only process same-window messages destined for the extension
    if (event.source !== window || event.data?.target !== 'AI_TTS_EXTENSION') return;

    const { type, messageId, payload } = event.data;
    if (type === 'QUEUE_SNAPSHOT_RESPONSE') return;

    if (type === 'PING_BRIDGE') {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: 'PING_BRIDGE_RESPONSE',
          messageId,
          payload: { ready: true, version: '1.0.0' },
        },
        '*'
      );
      return;
    }

    if (!chrome.runtime?.id) {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: 'ERROR_REPORT',
          messageId,
          payload: { error: 'Ekstensi baru saja dimuat ulang. Harap refresh tab website (F5).' },
        },
        '*'
      );
      return;
    }

    try {
      // Forward request to background service worker
      const response = await chrome.runtime.sendMessage({
        type,
        messageId,
        payload,
      });

      // Send response back to webpage
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: `${type}_RESPONSE`,
          messageId,
          payload: response,
        },
        '*'
      );
    } catch (err) {
      window.postMessage(
        {
          source: 'AI_TTS_EXTENSION',
          type: 'ERROR_REPORT',
          messageId,
          payload: { error: err?.message || 'Koneksi ke background ekstensi terputus.' },
        },
        '*'
      );
    }
  });

  // Listen to messages from background service worker to forward to webpage
  try {
    if (chrome.runtime?.id && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.source === 'AI_TTS_BACKGROUND') {
          if (message.type === 'REQUEST_QUEUE_SNAPSHOT') {
            const localSnap = readDashboardLocalSnapshot();
            if (!localSnap.isDashboard) {
              sendResponse({ success: false, notDashboard: true });
              return false;
            }

            const reqId = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            let settled = false;
            const timer = setTimeout(() => {
              if (!settled) {
                settled = true;
                window.removeEventListener('message', onSnap);
                sendResponse({
                  success: true,
                  reachedDashboard: true,
                  queueActive: !!localSnap.queueActive,
                  jobs: Array.isArray(localSnap.jobs) ? localSnap.jobs : [],
                  completedIds: Array.isArray(localSnap.completedIds) ? localSnap.completedIds : [],
                  completedFilenames: Array.isArray(localSnap.completedFilenames) ? localSnap.completedFilenames : [],
                  fromLocalStorage: true,
                });
              }
            }, 350);

            const onSnap = (ev) => {
              if (
                ev.source === window &&
                ev.data?.target === 'AI_TTS_EXTENSION' &&
                ev.data.type === 'QUEUE_SNAPSHOT_RESPONSE' &&
                ev.data.requestId === reqId
              ) {
                if (!settled) {
                  settled = true;
                  clearTimeout(timer);
                  window.removeEventListener('message', onSnap);
                  const reactPayload = ev.data.payload || {};
                  const reactJobs = Array.isArray(reactPayload.jobs) ? reactPayload.jobs : [];
                  const mergedJobs = reactJobs.length > 0 ? reactJobs : (localSnap.jobs || []);
                  const completedIds = Array.from(
                    new Set([
                      ...(Array.isArray(localSnap.completedIds) ? localSnap.completedIds : []),
                      ...(Array.isArray(reactPayload.completedIds) ? reactPayload.completedIds : []),
                    ])
                  );
                  const completedFilenames = Array.from(
                    new Set([
                      ...(Array.isArray(localSnap.completedFilenames) ? localSnap.completedFilenames : []),
                      ...(Array.isArray(reactPayload.completedFilenames) ? reactPayload.completedFilenames : []),
                    ])
                  );
                  sendResponse({
                    success: true,
                    reachedDashboard: true,
                    queueActive: typeof reactPayload.queueActive === 'boolean' ? (reactPayload.queueActive || localSnap.queueActive) : !!localSnap.queueActive,
                    runSessionId: reactPayload.runSessionId || null,
                    jobs: mergedJobs,
                    completedIds,
                    completedFilenames,
                  });
                }
              }
            };
            window.addEventListener('message', onSnap);
            window.postMessage(
              {
                source: 'AI_TTS_EXTENSION',
                type: 'REQUEST_QUEUE_SNAPSHOT',
                requestId: reqId,
              },
              '*'
            );
            return true;
          }

          window.postMessage(
            {
              source: 'AI_TTS_EXTENSION',
              type: message.type,
              payload: message.payload,
            },
            '*'
          );
        }
      });
    }
  } catch (e) {}
})();
