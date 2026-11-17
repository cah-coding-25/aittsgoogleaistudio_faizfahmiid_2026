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
  let isPickingJob = false;
  let isCooldownWaiting = false;
  let cooldownStartedAt = 0;
  let pickingStartedAt = 0;
  let executingStartedAt = 0;
  let currentJob = null;
  let pollingTimer = null;
  let heartbeatTimer = null;
  let directQueue = [];
  let isQueueActive = false;
  const sessionCompletedJobIds = new Set();
  const sessionCompletedFilenames = new Set();
  const knownCompletedJobIds = new Set();
  const knownCompletedFilenames = new Set();
  const jobRetryAttempts = new Map();

  // Calm, deterministic pacing for 100-1000+ scene stability on Google AI Studio
  const INTER_SCENE_COOLDOWN_MS = 2200;
  const AFTER_PASTE_SETTLE_MS = 450;
  const MAX_AUTO_RECOVERY_ATTEMPTS = 12;
  let hasProcessedSceneInSession = false;
  let activeRunSessionId = null;

  function syncKnownCompletedFromSource(source, incomingPendingList) {
    if (!source) return;
    const explicitCompletedIds = new Set(
      Array.isArray(source.completedIds) ? source.completedIds.filter(Boolean) : []
    );
    const explicitCompletedNames = new Set(
      Array.isArray(source.completedFilenames)
        ? source.completedFilenames.map((fn) => normalizeJobKey(fn)).filter(Boolean)
        : []
    );

    explicitCompletedIds.forEach((id) => knownCompletedJobIds.add(id));
    explicitCompletedNames.forEach((k) => knownCompletedFilenames.add(k));

    // If caller explicitly supplied runnable non-COMPLETED jobs (e.g. manual Retry / Duplicate), allow those specific ones
    if (Array.isArray(incomingPendingList)) {
      for (const pj of incomingPendingList) {
        if (!pj || pj.status === 'COMPLETED') continue;
        if (pj.id && !explicitCompletedIds.has(pj.id)) {
          knownCompletedJobIds.delete(pj.id);
        }
        const pk = normalizeJobKey(pj.filename);
        if (pk && !explicitCompletedNames.has(pk)) {
          knownCompletedFilenames.delete(pk);
        }
      }
    }
  }

  function storageGetSafe(keys, timeoutMs = 1500) {
    if (!hasExtensionContext()) return Promise.resolve({});
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({});
        }
      }, timeoutMs);
      try {
        chrome.storage.local.get(keys, (data) => {
          const err = chrome.runtime.lastError;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(err ? {} : (data || {}));
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({});
        }
      }
    });
  }

  function storageSetSafe(obj, timeoutMs = 1500) {
    if (!hasExtensionContext()) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);
      try {
        chrome.storage.local.set(obj, () => {
          void chrome.runtime.lastError;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(true);
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      }
    });
  }

  function sendRuntimeMessageSafe(message, timeoutMs = 4000, fallbackValue = null) {
    if (!hasExtensionContext()) return Promise.resolve(fallbackValue);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(fallbackValue);
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          const err = chrome.runtime.lastError;
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(err || !resp ? fallbackValue : resp);
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallbackValue);
        }
      }
    });
  }

  function resetStaleRunnerLocksIfNeeded() {
    const now = Date.now();
    // Chrome aggressively throttles setTimeout in background tabs: release cooldown by wall-clock time!
    if (isCooldownWaiting && cooldownStartedAt > 0 && now - cooldownStartedAt >= INTER_SCENE_COOLDOWN_MS + 350) {
      isCooldownWaiting = false;
      cooldownStartedAt = 0;
    }
    // Safety release if pickAndExecuteNextJob somehow stalled > 12s
    if (isPickingJob && pickingStartedAt > 0 && now - pickingStartedAt >= 12000) {
      isPickingJob = false;
      pickingStartedAt = 0;
    }
    // Safety release only if execution truly stalled > 30 minutes without generating
    if (isExecuting && executingStartedAt > 0 && now - executingStartedAt >= 1800000 && !isGeneratingActive()) {
      isExecuting = false;
      executingStartedAt = 0;
      currentJob = null;
      isCooldownWaiting = false;
      cooldownStartedAt = 0;
    }
  }

  function normalizeJobKey(name) {
    return String(name || '').trim().toLowerCase().replace(/\.(wav|mp3)$/i, '');
  }

  function trimRemainingQueueForStorage(list) {
    return sortJobsAscending(list).filter(
      (j) => j && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED'
    );
  }

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

  // Retrieve saved backendUrl, clientId, and explicit queueActive state
  (async () => {
    try {
      if (hasExtensionContext()) {
        const res = await storageGetSafe(['backendUrl', 'clientId', 'queueActive'], 1500);
        if (res?.backendUrl) {
          backendUrl = res.backendUrl.replace(/\/$/, '');
        }
        if (res?.clientId) {
          clientId = res.clientId;
        }
        isQueueActive = res?.queueActive === true;
        if (isAiStudioTtsUrl(window.location.href)) {
          startAutoRunner();
        }
      }
    } catch (e) {
      if (isAiStudioTtsUrl(window.location.href)) {
        startAutoRunner();
      }
    }
  })();

  try {
    if (hasExtensionContext()) {

      if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes.queueActive) {
            isQueueActive = changes.queueActive.newValue === true;
            if (!isQueueActive) {
              directQueue = [];
            }
          }
          if (changes.backendUrl?.newValue) {
            backendUrl = changes.backendUrl.newValue.replace(/\/$/, '');
          }
          if (changes.clientId?.newValue) {
            clientId = changes.clientId.newValue;
          }
        });
      }
    }
  } catch (e) {
    if (isAiStudioTtsUrl(window.location.href)) {
      startAutoRunner();
    }
  }

  // Remove any legacy floating DOM dock so Google AI Studio stays 100% unobstructed (Side Panel handles UI)
  function removeLegacyFloatingDock() {
    try {
      document.getElementById('ai-tts-automation-dock')?.remove();
      document.getElementById('ai-tts-dock-styles')?.remove();
    } catch (e) {}
  }

  function emitSidePanelState(patch) {
    if (!hasExtensionContext() || !patch) return;
    try {
      chrome.runtime.sendMessage({ type: 'SIDEPANEL_STATE_UPDATE', payload: patch }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  function dockLog(message, type = 'default') {
    const time = new Date().toLocaleTimeString();
    console.log(`[FahVoiceForge${type === 'error' ? ' Notice' : ''}] ${message}`);
    if (!hasExtensionContext()) return;
    try {
      chrome.runtime.sendMessage(
        {
          type: 'SIDEPANEL_LOG',
          payload: { time, message, kind: type },
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (e) {}
  }

  function setStep(stepIndex) {
    emitSidePanelState({ stepIndex });
  }

  function refreshDockFolderStatus() {
    // Handled natively in Chrome Side Panel (sidepanel.js)
  }

  let consecutiveEmptyQueueChecks = 0;

  async function hydrateQueueFromBackendJobs(activeClient) {
    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 3500) : null;
      const res = await fetch(`${backendUrl}/api/jobs?clientId=${encodeURIComponent(activeClient)}`, {
        headers: { 'X-Client-Id': activeClient },
        signal: ctrl ? ctrl.signal : undefined,
      }).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (!res.ok) return [];
      const data = await res.json();
      const raw = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
      return trimRemainingQueueForStorage(raw);
    } catch {
      return [];
    }
  }

  // --- AUTOMATION ENGINE (REAL-TIME AUTO RUNNER) ---
  async function pickAndExecuteNextJob() {
    resetStaleRunnerLocksIfNeeded();
    if (isExecuting || isPickingJob || isCooldownWaiting) return;
    if (!hasExtensionContext()) return;
    if (!isAiStudioTtsUrl(window.location.href)) return;

    isPickingJob = true;
    pickingStartedAt = Date.now();
    try {
      const isPendingJob = (j) =>
        j &&
        !sessionCompletedJobIds.has(j.id) &&
        !sessionCompletedFilenames.has(normalizeJobKey(j.filename)) &&
        !knownCompletedJobIds.has(j.id) &&
        !knownCompletedFilenames.has(normalizeJobKey(j.filename)) &&
        j.status !== 'COMPLETED' &&
        j.status !== 'FAILED' &&
        j.status !== 'CANCELLED' &&
        (j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING' || j.status === 'SENDING_TEXT' || !j.status);

      // Sync explicit queueActive state from storage (strictly timeout-guarded!)
      try {
        const stateRes = await storageGetSafe(['activeQueue', 'queueActive', 'completedIds', 'completedFilenames'], 1500);
        syncKnownCompletedFromSource(stateRes, Array.isArray(stateRes.activeQueue) ? stateRes.activeQueue : null);

        if (typeof stateRes.queueActive === 'boolean') {
          if (stateRes.queueActive === true) {
            isQueueActive = true;
          } else if (jobRetryAttempts.size === 0 && directQueue.length === 0) {
            isQueueActive = false;
          }
        }

        if (isQueueActive) {
          // Merge storage activeQueue into directQueue so newly appended/retried jobs are never missed
          if (Array.isArray(stateRes.activeQueue) && stateRes.activeQueue.length > 0) {
            const mergedMap = new Map();
            for (const j of directQueue) {
              if (j && isPendingJob(j)) mergedMap.set(j.id || j.filename, j);
            }
            for (const sj of stateRes.activeQueue) {
              if (sj && isPendingJob(sj)) {
                const key = sj.id || sj.filename;
                if (!mergedMap.has(key)) mergedMap.set(key, sj);
              }
            }
            directQueue = sortJobsAscending(Array.from(mergedMap.values()));
          }

          // 1. First Priority: In-memory direct queue sorted strictly #1 -> last (unlimited)
          if (directQueue && directQueue.length > 0) {
            directQueue = trimRemainingQueueForStorage(directQueue).filter(isPendingJob);
            const nextPending = directQueue.find(isPendingJob);
            if (nextPending) {
              consecutiveEmptyQueueChecks = 0;
              nextPending.status = 'SENDING_TEXT';
              storageSetSafe({ activeQueue: directQueue, queueActive: true });
              isPickingJob = false;
              pickingStartedAt = 0;
              await executeTTSJob(nextPending);
              return;
            }
          }
        }
      } catch (e) {}

      // Helper: Pull directly from open Website Dashboard tab (authoritative source of completed badges & active queue!)
      const tryPullDashboardQueue = async () => {
        try {
          const dashSnap = await sendRuntimeMessageSafe({ type: 'PULL_DASHBOARD_QUEUE' }, 3600, null);
          if (dashSnap && dashSnap.reachedDashboard) {
            syncKnownCompletedFromSource(dashSnap, dashSnap.jobs);
          }
          if (dashSnap && Array.isArray(dashSnap.jobs) && dashSnap.jobs.length > 0 && (dashSnap.queueActive || isQueueActive)) {
            if (dashSnap.runSessionId && dashSnap.runSessionId !== activeRunSessionId) {
              activeRunSessionId = dashSnap.runSessionId;
              sessionCompletedJobIds.clear();
              sessionCompletedFilenames.clear();
              jobRetryAttempts.clear();
            }
            const pulled = trimRemainingQueueForStorage(dashSnap.jobs).filter(isPendingJob);
            if (pulled.length > 0) {
              consecutiveEmptyQueueChecks = 0;
              isQueueActive = true;
              directQueue = pulled;
              const nextPulled = pulled[0];
              nextPulled.status = 'SENDING_TEXT';
              storageSetSafe({ activeQueue: directQueue, queueActive: true });
              isPickingJob = false;
              pickingStartedAt = 0;
              await executeTTSJob(nextPulled);
              return { dispatched: true, reachedDashboard: true, dashSnap };
            }
          }
          return { dispatched: false, reachedDashboard: !!(dashSnap && dashSnap.reachedDashboard), dashSnap };
        } catch {
          return { dispatched: false, reachedDashboard: false, dashSnap: null };
        }
      };

      // 2. Second Priority: Pull directly from open Website Dashboard tab BEFORE querying backend
      let pullResult = await tryPullDashboardQueue();
      if (pullResult.dispatched) return;

      // ONLY conclude SELESAI SEMUA from Dashboard if Dashboard IS explicitly reachable AND confirms 0 remaining jobs
      if (pullResult.reachedDashboard && pullResult.dashSnap) {
        const dashPending = trimRemainingQueueForStorage(pullResult.dashSnap.jobs || []).filter(isPendingJob);
        if ((!pullResult.dashSnap.queueActive || dashPending.length === 0) && isQueueActive) {
          const localPending = trimRemainingQueueForStorage(directQueue).filter(isPendingJob);
          if (localPending.length === 0) {
            if (hasProcessedSceneInSession) {
              await sleep(500);
              const secondPull = await tryPullDashboardQueue();
              if (secondPull.dispatched) return;
              const secondDashPending = trimRemainingQueueForStorage(secondPull.dashSnap?.jobs || []).filter(isPendingJob);
              if (secondPull.reachedDashboard && secondDashPending.length > 0) return;
            }
            consecutiveEmptyQueueChecks = 0;
            isQueueActive = false;
            hasProcessedSceneInSession = false;
            directQueue = [];
            jobRetryAttempts.clear();
            storageSetSafe({ activeQueue: [], queueActive: false });
            emitSidePanelState({ jobStatus: 'SELESAI SEMUA', stepIndex: 5 });
            dockLog('[ANTREAN] Seluruh antrean suara sampai scene terakhir telah selesai!', 'success');
          }
        }
        return;
      }

      // 3. Fallback Priority (when Dashboard tab is unreachable/throttled): Poll backend /api/extension/next-job
      let backendExplicitlyIdle = false;
      try {
        const activeClient = clientId || 'default';
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 3200) : null;
        const res = await fetch(`${backendUrl}/api/extension/next-job?clientId=${encodeURIComponent(activeClient)}`, {
          headers: { 'X-Client-Id': activeClient },
          signal: ctrl ? ctrl.signal : undefined,
        }).finally(() => {
          if (timer) clearTimeout(timer);
        });

        if (res.ok) {
          const data = await res.json();
          if (
            data.success &&
            data.hasJob &&
            data.job &&
            isPendingJob(data.job) &&
            (data.queueState === 'RUNNING' || isQueueActive)
          ) {
            consecutiveEmptyQueueChecks = 0;
            isQueueActive = true;
            // Hydrate full pending queue from /api/jobs too so multi-scene state persists across serverless hops
            const hydrated = (await hydrateQueueFromBackendJobs(activeClient)).filter(isPendingJob);
            const merged = new Map(hydrated.map((h) => [h.id || h.filename, h]));
            merged.set(data.job.id || data.job.filename, { ...data.job, status: 'SENDING_TEXT' });
            directQueue = sortJobsAscending(Array.from(merged.values()));
            storageSetSafe({ activeQueue: directQueue, queueActive: true });

            isPickingJob = false;
            pickingStartedAt = 0;
            await executeTTSJob(data.job);
            return;
          }
          if (data.success && !data.hasJob && data.queueState === 'IDLE') {
            backendExplicitlyIdle = true;
          }
        }
      } catch (err) {
        // Backend unreachable or serverless cold start
      }

      // 4. Never falsely declare SELESAI SEMUA if Dashboard was unreachable OR retries are still active!
      if (isQueueActive) {
        try {
          const freshStorage = await storageGetSafe(['activeQueue', 'queueActive', 'completedIds', 'completedFilenames'], 1500);
          syncKnownCompletedFromSource(freshStorage, Array.isArray(freshStorage.activeQueue) ? freshStorage.activeQueue : null);
          if (freshStorage.queueActive === false && jobRetryAttempts.size === 0) {
            isQueueActive = false;
            directQueue = [];
            return;
          }
          if (Array.isArray(freshStorage.activeQueue) && freshStorage.activeQueue.length > 0) {
            const recovered = trimRemainingQueueForStorage(freshStorage.activeQueue).filter(isPendingJob);
            if (recovered.length > 0) {
              consecutiveEmptyQueueChecks = 0;
              directQueue = recovered;
              const nextRecovered = recovered[0];
              nextRecovered.status = 'SENDING_TEXT';
              storageSetSafe({ activeQueue: directQueue, queueActive: true });
              isPickingJob = false;
              pickingStartedAt = 0;
              await executeTTSJob(nextRecovered);
              return;
            }
          }
        } catch {}

        // Wait calmly and re-verify Dashboard before concluding if Dashboard could not be reached
        if (hasProcessedSceneInSession && isQueueActive) {
          await sleep(750);
          pullResult = await tryPullDashboardQueue();
          if (pullResult.dispatched) return;
        }

        const remaining = trimRemainingQueueForStorage(directQueue).filter(isPendingJob);
        const hasPendingRetries = jobRetryAttempts.size > 0;
        const canTrustBackendDone = !pullResult.reachedDashboard && backendExplicitlyIdle && !hasPendingRetries;
        const dashboardConfirmedDone =
          pullResult.reachedDashboard &&
          pullResult.dashSnap &&
          (!pullResult.dashSnap.queueActive ||
            trimRemainingQueueForStorage(pullResult.dashSnap.jobs || []).filter(isPendingJob).length === 0);

        if (remaining.length === 0 && (dashboardConfirmedDone || canTrustBackendDone)) {
          consecutiveEmptyQueueChecks++;
          if (dashboardConfirmedDone || consecutiveEmptyQueueChecks >= 3) {
            consecutiveEmptyQueueChecks = 0;
            isQueueActive = false;
            hasProcessedSceneInSession = false;
            directQueue = [];
            jobRetryAttempts.clear();
            storageSetSafe({ activeQueue: [], queueActive: false });
            emitSidePanelState({ jobStatus: 'SELESAI SEMUA', stepIndex: 5 });
            dockLog('[ANTREAN] Seluruh antrean suara sampai scene terakhir telah selesai!', 'success');
          }
        }
      }
    } finally {
      isPickingJob = false;
      pickingStartedAt = 0;
    }
  }

  function startAutoRunner() {
    if (!isAiStudioTtsUrl(window.location.href)) return;
    removeLegacyFloatingDock();
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

    // Polling loop every 800ms for realtime responsiveness + wall-clock lock self-healing
    pollingTimer = setInterval(() => {
      if (!hasExtensionContext()) {
        clearInterval(pollingTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        return;
      }
      if (!isAiStudioTtsUrl(window.location.href)) {
        return;
      }
      resetStaleRunnerLocksIfNeeded();
      if (!isExecuting && !isCooldownWaiting && !isPickingJob) {
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

  function emitJobProgressToDashboard(job, status, extra = {}) {
    if (!hasExtensionContext() || !job) return;
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_PROGRESS_NOTIFY',
        payload: {
          jobId: job.id,
          filename: job.filename,
          order: job.order,
          status,
          ...extra,
        },
      }).catch(() => {});
    } catch (e) {}
  }

  async function waitUntilAiStudioIdle(timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isQueueActive) return;
      if (!isGeneratingActive()) {
        const rb = findEnabledRunButtonFast();
        if (rb) return;
      }
      await sleep(250);
    }
  }

  function findEnabledRunButtonFast() {
    if (!window.AI_STUDIO_SELECTORS) return null;
    for (const strat of window.AI_STUDIO_SELECTORS.runButton.strategies) {
      try {
        const el = strat();
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') return el;
      } catch (e) {}
    }
    return null;
  }

  async function performSoftDomRecovery() {
    try {
      // Dismiss any Angular snackbar / error toast blocking clicks
      const snackDismiss = document.querySelectorAll('.cdk-overlay-container mat-snack-bar-container button, simple-snack-bar button');
      snackDismiss.forEach((btn) => {
        if (!btn.closest('#ai-tts-automation-dock')) {
          try { btn.click(); } catch {}
        }
      });
      await sleep(300);
      // Clear active speaker box cleanly so next injection starts from blank state
      if (window.AI_STUDIO_SELECTORS?.textInput?.strategies) {
        for (const strat of window.AI_STUDIO_SELECTORS.textInput.strategies) {
          try {
            const el = strat();
            if (el) {
              injectTextIntoElement(el, '');
              break;
            }
          } catch {}
        }
      }
      await sleep(600);
    } catch {}
  }

  // Master job execution flow
  async function executeTTSJob(job) {
    if (isExecuting) return;
    if (!hasExtensionContext() || !isAiStudioTtsUrl(window.location.href)) return;
    isExecuting = true;
    executingStartedAt = Date.now();
    currentJob = job;

    const effectiveMaxRetries = Math.max(MAX_AUTO_RECOVERY_ATTEMPTS, Number(job.maxRetries) || 3);
    const currentAttempt = jobRetryAttempts.get(job.id) || 0;

    emitSidePanelState({
      jobFilename: `#${job.order} — ${job.filename}`,
      jobText: `"${job.text}"`,
      jobStatus: 'SEDANG DIPROSES',
      stepIndex: 0,
    });
    emitJobProgressToDashboard(job, 'SENDING_TEXT', {
      retryCount: currentAttempt,
      maxRetries: effectiveMaxRetries,
      error: undefined,
    });

    dockLog(`Mulai memproses scene #${job.order} (${job.filename}) secara tenang & berurutan...`, 'info');

    // Clear old audio state & sync target filename with background service worker
    activeRunEpoch = 0;
    capturedFreshDataUrl = null;
    interceptedDownloadDataUrl = null;
    lastCapturedBlob = null;
    lastCapturedBlobUrl = null;
    lastCapturedAudioBuffer = null;
    isWebsiteAudioConfirmed = false;

    try {
      chrome.runtime.sendMessage({
        type: 'SET_CURRENT_DOWNLOAD_NAME',
        payload: { filename: job.filename, jobId: job.id },
      }).catch(() => {});
    } catch (e) {}

    try {
      // Ensure AI Studio has completely settled from any previous scene before touching DOM
      if (hasProcessedSceneInSession) {
        await waitUntilAiStudioIdle(12000);
        await sleep(350);
      }

      if (!isQueueActive) {
        throw new Error('Antrean dihentikan oleh pengguna.');
      }

      // TAHAP 1: WAJIB Menempel & Verifikasi Teks ke Kolom Speaker (Hapus teks lama/template bawaan)
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
      }, 12000, 'Kolom dialog Speaker Google AI Studio');

      await setAndVerifySpeakerText(inputEl, job.text);
      await sleep(AFTER_PASTE_SETTLE_MS);

      notifyBackend(job.id, 'TEXT_INSERTED');
      dockLog(`[1/5] Teks "${job.text.substring(0, 30)}..." terverifikasi di Speaker!`, 'success');

      // TAHAP 2: WAJIB Menekan Tombol Run Ctrl Nyata
      setStep(2);
      dockLog(`[2/5] Mempersiapkan klik tombol Run Ctrl nyata...`, 'info');

      // Tunggu sampai tombol Run benar-benar tersedia (bukan Stop) dan aktif
      const runBtn = await waitForElement(() => findEnabledRunButtonFast(), 18000, 'Tombol Run Ctrl ↵');
      await sleep(180);

      // Snapshot state SEBELUM Run diklik (agar TIDAK pernah mengunduh file yang sudah ada!)
      const preExistingAudios = getAudioSources();
      const oldDownloadBtn = findDownloadButton();

      // Mulai epoch baru -> audio yang ditangkap hanya valid jika muncul SETELAH klik Run ini!
      activeRunEpoch = Date.now();
      capturedFreshDataUrl = null;
      interceptedDownloadDataUrl = null;
      sendInterceptorControl('NEW_EPOCH', false, activeRunEpoch);

      await triggerRunAction(runBtn, inputEl, oldDownloadBtn, preExistingAudios);
      notifyBackend(job.id, 'RUN_CLICKED');
      emitJobProgressToDashboard(job, 'GENERATING', { retryCount: currentAttempt, maxRetries: effectiveMaxRetries });
      dockLog(`[2/5] Tombol Run Ctrl nyata berhasil ditekan!`, 'success');

      // TAHAP 3: Masa Loading -> WAJIB Tunggu Sampai Selesai & Tombol Unduh Muncul
      setStep(3);
      emitSidePanelState({ jobStatus: 'MASA LOADING...' });
      dockLog(`[3/5] Masa loading: menunggu AI Studio selesai memproses suara hingga tombol unduh muncul...`, 'info');
      notifyBackend(job.id, 'GENERATION_STARTED');

      const downloadBtn = await waitForDownloadButtonAppearance(oldDownloadBtn, preExistingAudios);
      notifyBackend(job.id, 'GENERATION_COMPLETED');
      emitJobProgressToDashboard(job, 'DOWNLOADING', { retryCount: currentAttempt, maxRetries: effectiveMaxRetries });
      dockLog(`[3/5] Proses suara selesai! Audio siap diunduh.`, 'success');

      // TAHAP 4: WAJIB Unduh File WAV Asli ke Folder Pilihan (TANPA Popup Simpan!)
      setStep(4);
      emitSidePanelState({ jobStatus: 'MENGUNDUH WAV...' });
      dockLog(`[4/5] Mengunduh "${job.filename}.wav" & menyimpan langsung ke folder...`, 'info');

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
      hasProcessedSceneInSession = true;
      emitSidePanelState({ jobStatus: 'SELESAI (COMPLETED)' });
      dockLog(`[5/5] Berkas "${saveResult.path || job.filename + '.wav'}" tersimpan sempurna ke folder!`, 'success');

      sessionCompletedJobIds.add(job.id);
      sessionCompletedFilenames.add(normalizeJobKey(job.filename));
      knownCompletedJobIds.add(job.id);
      knownCompletedFilenames.add(normalizeJobKey(job.filename));

      // Safely remove ONLY this completed job from directQueue + chrome.storage.local.activeQueue (never wipe other remaining jobs!)
      const matchesThisJob = (j) =>
        j && (j.id === job.id || normalizeJobKey(j.filename) === normalizeJobKey(job.filename));
      try {
        if (hasExtensionContext()) {
          const st = await storageGetSafe(['activeQueue'], 1500);
          const mergedMap = new Map();
          for (const sj of Array.isArray(st?.activeQueue) ? st.activeQueue : []) {
            if (sj && !matchesThisJob(sj) && !sessionCompletedJobIds.has(sj.id) && !sessionCompletedFilenames.has(normalizeJobKey(sj.filename))) {
              mergedMap.set(sj.id || sj.filename, sj);
            }
          }
          for (const dj of Array.isArray(directQueue) ? directQueue : []) {
            if (dj && !matchesThisJob(dj) && !sessionCompletedJobIds.has(dj.id) && !sessionCompletedFilenames.has(normalizeJobKey(dj.filename))) {
              mergedMap.set(dj.id || dj.filename, dj);
            }
          }
          directQueue = trimRemainingQueueForStorage(Array.from(mergedMap.values()));
          await storageSetSafe({ activeQueue: directQueue }, 1500);
        } else if (directQueue && directQueue.length > 0) {
          directQueue = directQueue.filter((j) => !matchesThisJob(j));
        }
      } catch (e) {}

      // Upload WAV & laporkan completion secara paralel secara realtime
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

      // Wait briefly (exits immediately in 0ms once Website confirms WAV received!)
      const confirmStart = Date.now();
      while (!isWebsiteAudioConfirmed && Date.now() - confirmStart < 1200) {
        await sleep(80);
      }

      jobRetryAttempts.delete(job.id);
      dockLog(`[SELESAI] "${job.filename}.wav" selesai! Jeda santai ${Math.round(INTER_SCENE_COOLDOWN_MS / 1000)}d sebelum scene berikutnya...`, 'success');
    } catch (err) {
      hasProcessedSceneInSession = true;
      console.log('[AI TTS Content] Execution recovery notice:', err?.message || err);
      const attempt = (jobRetryAttempts.get(job.id) || 0) + 1;
      const canRetryInPlace = isQueueActive && attempt < effectiveMaxRetries;

      if (canRetryInPlace) {
        jobRetryAttempts.set(job.id, attempt);
        const isRateLimit = !!err?.isRateLimit || /quota|rate limit|too many|resource exhausted|429/i.test(err?.message || '');
        const normalDelays = [5000, 8000, 12000, 18000, 25000, 35000, 45000];
        const rateLimitDelays = [15000, 25000, 35000, 45000, 60000, 60000, 60000];
        const backoffTable = isRateLimit ? rateLimitDelays : normalDelays;
        const waitMs = backoffTable[Math.min(attempt - 1, backoffTable.length - 1)];

        dockLog(
          `[PEMULIHAN TENANG ${attempt}/${effectiveMaxRetries}] #${job.order} (${job.filename}) — ${err.message}. Menunggu ${Math.round(waitMs / 1000)}d lalu mengulang...`,
          'warn'
        );

        // Always keep job inside directQueue & chrome.storage.local so it can NEVER be lost on retry
        if (!Array.isArray(directQueue)) directQueue = [];
        const idx = directQueue.findIndex((j) => j && (j.id === job.id || j.filename === job.filename));
        if (idx !== -1) {
          directQueue[idx] = { ...directQueue[idx], status: 'PENDING' };
        } else {
          directQueue.unshift({ ...job, status: 'PENDING' });
          directQueue = trimRemainingQueueForStorage(directQueue);
        }
        await storageSetSafe({ activeQueue: directQueue, queueActive: true }, 1500);

        emitJobProgressToDashboard(job, 'RETRYING', {
          retryCount: attempt,
          maxRetries: effectiveMaxRetries,
          error: `Menunggu ${Math.round(waitMs / 1000)}d untuk pemulihan (${err.message})`,
        });

        await Promise.race([
          notifyBackend(job.id, 'JOB_FAILED', {
            error: err.message,
            retrying: true,
            retryCount: attempt,
            finalFailure: false,
          }),
          sleep(1500),
        ]);

        emitSidePanelState({ jobStatus: `JEDA PEMULIHAN (${attempt}/${effectiveMaxRetries})` });

        // Never wipe the speaker text box while Google AI Studio is still actively generating!
        if (isGeneratingActive() || !findEnabledRunButtonFast()) {
          dockLog('[PEMULIHAN] Menunggu AI Studio menyelesaikan proses yang sedang berjalan sebelum mengulang...', 'info');
          await waitUntilAiStudioIdle(120000);
        }
        if (attempt >= 2 && !isGeneratingActive()) {
          await performSoftDomRecovery();
        }
        await sleep(waitMs);
      } else {
        jobRetryAttempts.delete(job.id);
        dockLog(`GAGAL: #${job.order} (${job.filename}) setelah ${attempt} percobaan — ${err.message}`, 'error');
        sessionCompletedJobIds.add(job.id);
        sessionCompletedFilenames.add(normalizeJobKey(job.filename));
        if (directQueue && directQueue.length > 0) {
          directQueue = directQueue.filter(
            (j) => j && j.id !== job.id && normalizeJobKey(j.filename) !== normalizeJobKey(job.filename)
          );
          storageSetSafe({ activeQueue: trimRemainingQueueForStorage(directQueue) });
        }

        emitJobProgressToDashboard(job, 'FAILED', {
          retryCount: attempt,
          maxRetries: effectiveMaxRetries,
          error: err.message,
          finalFailure: true,
        });

        await Promise.race([
          notifyBackend(job.id, 'JOB_FAILED', {
            error: err.message,
            retrying: false,
            retryCount: attempt,
            finalFailure: true,
          }),
          sleep(2000),
        ]);
        emitSidePanelState({ jobStatus: 'GAGAL (FAILED)' });
        await sleep(600);
      }
    } finally {
      sendInterceptorControl('SUPPRESS', false, 0);
      setBackgroundDownloadGuard(false).catch(() => {});
      activeRunEpoch = 0;
      isCooldownWaiting = true;
      cooldownStartedAt = Date.now();
      isExecuting = false;
      executingStartedAt = 0;
      currentJob = null;

      // Always honor calm ~2s cooldown while queue is active so AI Studio settles between scenes
      const cooldownMs = isQueueActive ? INTER_SCENE_COOLDOWN_MS : 350;
      setTimeout(() => {
        isCooldownWaiting = false;
        cooldownStartedAt = 0;
        pickAndExecuteNextJob();
      }, cooldownMs);
    }
  }

  // --- DOM INTERACTION HELPERS ---

  function readElementTextClean(element) {
    if (!element) return '';
    const raw = (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')
      ? element.value
      : (element.innerText || element.textContent || '');
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function doesElementMatchText(element, expectedText) {
    const actual = readElementTextClean(element);
    const target = String(expectedText || '').replace(/\s+/g, ' ').trim();
    if (!target) return actual.length === 0;
    if (actual === target) return true;
    const head = target.slice(0, Math.min(24, target.length));
    const tail = target.slice(Math.max(0, target.length - Math.min(24, target.length)));
    return actual.includes(head) && actual.includes(tail) && actual.length >= Math.floor(target.length * 0.9);
  }

  async function setAndVerifySpeakerText(element, text) {
    const targetText = String(text || '');
    for (let attempt = 0; attempt < 3; attempt++) {
      injectTextIntoElement(element, targetText);
      await sleep(160);
      if (doesElementMatchText(element, targetText)) {
        return;
      }
      await sleep(220);
    }
  }

  function injectTextIntoElement(element, text) {
    element.focus();

    // Check if initial template text is present
    const existingContent = (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT')
      ? element.value
      : (element.innerText || element.textContent || '');

    if (text && existingContent && existingContent.trim().length > 0 && attemptShouldLogTemplate(existingContent)) {
      dockLog(`[1/5] Membersihkan teks lama ("${existingContent.trim().substring(0, 28)}...") sebelum menempel scene baru...`, 'info');
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
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
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

      if (text) {
        try {
          const ok = document.execCommand('insertText', false, text);
          if (!ok || !doesElementMatchText(element, text)) {
            element.innerText = text;
          }
        } catch (e) {
          element.innerText = text;
        }

        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        // Final safeguard if template text lingered
        const checkText = element.innerText || '';
        if (checkText.includes("Type '[' for tags") || checkText.includes('[amused]') || checkText.includes('Blackwood House')) {
          element.innerText = text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }

  function attemptShouldLogTemplate(existingContent) {
    const trimmed = existingContent.trim();
    return trimmed.length > 0 && trimmed.length < 400;
  }

  function isGeneratingActive() {
    if (window.AI_STUDIO_SELECTORS?.generatingIndicator) {
      for (const strat of window.AI_STUDIO_SELECTORS.generatingIndicator.strategies) {
        try {
          if (strat()) return true;
        } catch (e) {}
      }
    }
    // Check if Run button itself is disabled, busy, or shows spinner/stop
    const runBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
    return runBtns.some((b) => {
      if (b.closest('#ai-tts-automation-dock')) return false;
      const rect = b.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
      const isDisabled = b.disabled || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('aria-busy') === 'true';
      const isRunBtn = t === 'run' || t.startsWith('run ') || t.includes('run ctrl') || aria === 'run' || aria.startsWith('run ');
      return isRunBtn && (isDisabled || b.classList.contains('loading') || !!b.querySelector('mat-spinner, mat-progress-spinner, [role="progressbar"]'));
    });
  }

  function dispatchRealRunClick(btn) {
    if (!btn) return false;
    try {
      btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (e) {}
    try {
      btn.focus();
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      btn.click();
      return true;
    } catch (e) {
      try {
        btn.click();
        return true;
      } catch {
        return false;
      }
    }
  }

  async function triggerRunAction(runBtn, inputEl, oldDownloadBtn, preExistingAudios = []) {
    const prevAudioSet = new Set(preExistingAudios);
    // Dismiss only toast/snackbar alerts inside Angular CDK overlay so nothing interferes
    try {
      const snackDismiss = document.querySelectorAll('.cdk-overlay-container mat-snack-bar-container button, simple-snack-bar button');
      snackDismiss.forEach((btn) => {
        if (!btn.closest('#ai-tts-automation-dock')) btn.click();
      });
    } catch (e) {}

    // Click the real Run button cleanly once
    if (runBtn && !runBtn.disabled && runBtn.getAttribute('aria-disabled') !== 'true') {
      dispatchRealRunClick(runBtn);
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

    const hasRunResponded = () => {
      if (isGeneratingActive()) return true;
      if (capturedFreshDataUrl || interceptedDownloadDataUrl) return true;
      if (oldDownloadBtn && (!document.body.contains(oldDownloadBtn) || oldDownloadBtn.disabled)) return true;
      if (runBtn && (!document.body.contains(runBtn) || runBtn.disabled || runBtn.getAttribute('aria-disabled') === 'true')) return true;

      const curAudios = getAudioSources();
      if (curAudios.some((src) => !prevAudioSet.has(src))) return true;

      const curDlBtn = findDownloadButton();
      if (curDlBtn && (!oldDownloadBtn || curDlBtn !== oldDownloadBtn)) return true;
      return false;
    };

    // Wait up to 9 seconds calmly for AI Studio to transition or emit fresh audio
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if (hasRunResponded()) return;

      // Guarded single fallback ONLY if button stayed completely idle after 2.7s
      if (i === 18) {
        const currentRunBtn = findEnabledRunButtonFast();
        if (currentRunBtn && !isGeneratingActive() && !capturedFreshDataUrl) {
          dockLog('[2/5] Mengirim sinyal Run / Ctrl+Enter cadangan untuk memastikan generasi aktif...', 'info');
          dispatchRealRunClick(currentRunBtn);
          await sleep(120);
          if (!hasRunResponded() && inputEl) {
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
    }

    // Before failing, check if a valid download button is already present (e.g. instant/fast generation)
    const fallbackDl = findDownloadButton();
    if (fallbackDl && (capturedFreshDataUrl || !oldDownloadBtn || fallbackDl !== oldDownloadBtn)) {
      return;
    }

    const errBanner = detectAiStudioErrorBanner();
    if (errBanner) {
      const e = new Error(`AI Studio belum siap / limit sementara: ${errBanner.message}`);
      e.isRateLimit = errBanner.isRateLimit;
      throw e;
    }
    throw new Error('Tombol Run belum merespons setelah ditekan.');
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

  function detectAiStudioErrorBanner() {
    try {
      const snacks = document.querySelectorAll('.cdk-overlay-container mat-snack-bar-container, simple-snack-bar, [role="alert"], .error-message');
      for (const el of snacks) {
        const rawTxt = (el.innerText || el.textContent || '').trim();
        const txt = rawTxt.toLowerCase();
        if (!txt) continue;
        const isRateLimit =
          txt.includes('quota') ||
          txt.includes('rate limit') ||
          txt.includes('too many requests') ||
          txt.includes('resource exhausted') ||
          txt.includes('429') ||
          txt.includes('exceeded');
        if (
          isRateLimit ||
          txt.includes('failed to generate') ||
          txt.includes('an error occurred') ||
          txt.includes('something went wrong') ||
          txt.includes('internal error') ||
          txt.includes('unable to') ||
          txt.includes('try again') ||
          txt.includes('terjadi kesalahan')
        ) {
          return { message: rawTxt.slice(0, 120), isRateLimit };
        }
      }
    } catch {}
    return null;
  }

  async function waitForDownloadButtonAppearance(oldDownloadBtn, preExistingAudios = []) {
    const baseWaitMs = 900000; // 15 minutes patient base wait
    const absoluteMaxWaitMs = 1800000; // 30 minutes hard ceiling when actively generating
    let dynamicDeadline = Date.now() + baseWaitMs;
    const hardDeadline = Date.now() + absoluteMaxWaitMs;
    const prevAudioSet = new Set(preExistingAudios);
    let loadingLogTick = 0;
    let sawGeneratingState = isGeneratingActive();
    let generationStoppedAt = 0;

    // Give Angular calm moment to render Stop / loading state
    await sleep(350);
    if (isGeneratingActive()) sawGeneratingState = true;

    while (Date.now() < Math.min(dynamicDeadline, hardDeadline)) {
      if (!isQueueActive) {
        throw new Error('Antrean dihentikan oleh pengguna.');
      }

      await sleep(250);
      loadingLogTick++;

      const generating = isGeneratingActive();
      const runReady = !!findEnabledRunButtonFast();

      if (generating) {
        sawGeneratingState = true;
        generationStoppedAt = 0;
        // Extend patience whenever Google AI Studio is actively processing audio
        dynamicDeadline = Math.max(dynamicDeadline, Date.now() + 180000);
        if (loadingLogTick % 20 === 0) {
          dockLog('[3/5] Masa loading: AI Studio sedang memproses suara, bersabar menunggu tombol unduh muncul...', 'info');
        }
        continue;
      }

      // Check if an old download button vanished/re-rendered during generation
      if (oldDownloadBtn && (!document.body.contains(oldDownloadBtn) || oldDownloadBtn.disabled)) {
        sawGeneratingState = true;
      }

      const currentAudios = getAudioSources();
      const hasNewAudioSrc = currentAudios.some((src) => !prevAudioSet.has(src));
      const hasValidFreshCapture = !!(capturedFreshDataUrl && normalizeWavDataUrl(capturedFreshDataUrl));
      if (hasNewAudioSrc || hasValidFreshCapture) {
        sawGeneratingState = true;
      }

      const dlBtn = findDownloadButton();

      // If Stop/spinner indicator is gone AND Run is not yet enabled AND no download button yet,
      // AI Studio is still transitioning/loading -> keep waiting patiently without starting stop timer!
      if (!runReady && !dlBtn && !hasValidFreshCapture && !hasNewAudioSrc) {
        generationStoppedAt = 0;
        dynamicDeadline = Math.max(dynamicDeadline, Date.now() + 60000);
        if (loadingLogTick % 24 === 0) {
          dockLog('[3/5] AI Studio masih memuat hasil audio... tetap menunggu sampai tombol unduh muncul.', 'info');
        }
        continue;
      }

      // Only mark generationStoppedAt once BOTH !isGeneratingActive() AND Run returned enabled
      if (sawGeneratingState && !generating && runReady && generationStoppedAt === 0) {
        generationStoppedAt = Date.now();
      }

      // Detect visible AI Studio error banner only when truly idle and no fresh audio appeared
      if (!hasNewAudioSrc && !hasValidFreshCapture && !generating && Date.now() - (hardDeadline - absoluteMaxWaitMs) > 3000) {
        const errBanner = detectAiStudioErrorBanner();
        if (errBanner && (errBanner.isRateLimit || runReady)) {
          const e = new Error(`AI Studio menampilkan kendala sementara: ${errBanner.message}`);
          e.isRateLimit = errBanner.isRateLimit;
          throw e;
        }
      }

      // ONLY accept download button AFTER generation finished AND we have evidence of THIS run completing!
      const isFreshButton = dlBtn && (!oldDownloadBtn || dlBtn !== oldDownloadBtn);
      const generationConfirmed =
        sawGeneratingState ||
        isFreshButton ||
        hasValidFreshCapture ||
        hasNewAudioSrc ||
        (runReady && !!dlBtn && Date.now() - (hardDeadline - absoluteMaxWaitMs) > 3000);

      if (dlBtn && generationConfirmed) {
        // Calm settle check to verify AI Studio did NOT enter another loading phase
        await sleep(300);
        if (isGeneratingActive()) {
          sawGeneratingState = true;
          generationStoppedAt = 0;
          continue;
        }
        const verifiedBtn = findDownloadButton();
        if (verifiedBtn) {
          dockLog(`[3/5] Tombol unduh resmi terdeteksi & siap ditekan!`, 'success');
          return verifiedBtn;
        }
      }

      // If fresh valid WAV buffer was already captured via AudioContext/Blob in THIS epoch and AI Studio returned idle >3.5s ago, use it directly!
      if (
        hasValidFreshCapture &&
        generationStoppedAt > 0 &&
        Date.now() - generationStoppedAt > 3500 &&
        !dlBtn
      ) {
        dockLog('[3/5] Audio WAV asli sudah tertangkap langsung dari generator AI Studio.', 'success');
        return null;
      }

      // Only retry if Run actually returned enabled for >35s with zero Stop/spinner AND still no download button or fresh audio
      if (
        sawGeneratingState &&
        runReady &&
        generationStoppedAt > 0 &&
        Date.now() - generationStoppedAt > 35000 &&
        !dlBtn &&
        !hasValidFreshCapture &&
        !hasNewAudioSrc
      ) {
        throw new Error('AI Studio kembali ke tombol Run tanpa menghasilkan audio/tombol unduh.');
      }
    }

    throw new Error('Waktu tunggu generasi audio Google AI Studio melebihi batas maksimal.');
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

    let validWavDataUrl = null;
    if (btnToClick) {
      // Step 4A: Aktifkan penyegat sinkron di interceptor.js (MAIN world) & guard background SEBELUM klik!
      interceptedDownloadDataUrl = null;
      sendInterceptorControl('SUPPRESS', true, activeRunEpoch);
      await setBackgroundDownloadGuard(true, 10000);

      try {
        // Step 4B: Klik SATU KALI tombol unduh asli Google AI Studio
        dockLog('[4/5] Menekan tombol unduh asli Google AI Studio (tanpa popup Simpan)...', 'info');
        try {
          btnToClick.scrollIntoView({ block: 'center', behavior: 'instant' });
        } catch (e) {}
        btnToClick.click();

        // Step 4C: Tunggu data WAV dari hasil klik tombol unduh (polling cepat realtime 40ms)
        const captureStart = Date.now();
        while (Date.now() - captureStart < 5500) {
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
    } else if (capturedFreshDataUrl) {
      const norm = normalizeWavDataUrl(capturedFreshDataUrl);
      if (norm) {
        validWavDataUrl = norm;
        dockLog(`[4/5] Menggunakan audio WAV segar yang sudah tertangkap di sesi ini...`, 'info');
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

    // Step 4E: Kirim ke background service worker -> chrome.downloads.download({ saveAs: false }) & tunggu selesai (timeout-guarded!)
    dockLog(`[4/5] Menyimpan "${targetFilename}.wav" otomatis ke folder unduhan (tanpa popup)...`, 'info');
    const saveRes = await sendRuntimeMessageSafe(
      {
        type: 'SAVE_WAV_TO_FOLDER',
        payload: {
          dataUrl: validWavDataUrl,
          filename: targetFilename,
          jobId,
        },
      },
      22000,
      { success: false, error: 'Batas waktu penyimpanan background worker habis.' }
    );

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
        const proxyResp = await sendRuntimeMessageSafe(
          {
            type: 'PROXY_UPLOAD_AUDIO',
            payload: { jobId, filename: cleanFilename, base64Data, targetUrl: backendUrl, targetClientId: activeClient },
          },
          5000,
          null
        );
        if (proxyResp && proxyResp.success && proxyResp.data?.success) {
          return true;
        }
      } catch (e) {}
    }

    // Strategy 1: Direct JSON Base64 upload (cleanest, no multipart boundary issues)
    try {
      const ctrl1 = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t1 = ctrl1 ? setTimeout(() => ctrl1.abort(), 2500) : null;
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
        signal: ctrl1 ? ctrl1.signal : undefined,
      }).finally(() => {
        if (t1) clearTimeout(t1);
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) return true;
        console.log('[AI TTS Content] Direct JSON upload server message:', json.error);
      }
    } catch (jsonErr) {
      console.log('[AI TTS Content] Direct JSON upload note:', jsonErr.message);
    }

    // Strategy 2: Direct Multipart FormData upload
    try {
      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      const formData = new FormData();
      formData.append('audio', blob, cleanFilename);

      const ctrl2 = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t2 = ctrl2 ? setTimeout(() => ctrl2.abort(), 2500) : null;
      const res = await fetch(`${backendUrl}/api/audio/upload/${jobId}?clientId=${encodeURIComponent(activeClient)}`, {
        method: 'POST',
        headers: {
          'X-Client-Id': activeClient,
        },
        body: formData,
        signal: ctrl2 ? ctrl2.signal : undefined,
      }).finally(() => {
        if (t2) clearTimeout(t2);
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) return true;
        console.log('[AI TTS Content] Direct multipart upload server message:', json.error);
      }
    } catch (directErr) {
      console.log('[AI TTS Content] Direct multipart fetch note:', directErr.message);
    }

    // Strategy 3: Background service worker proxy fallback (bypasses browser CORS & page origin completely)
    try {
      const proxyResp = await sendRuntimeMessageSafe(
        {
          type: 'PROXY_UPLOAD_AUDIO',
          payload: { jobId, filename: cleanFilename, base64Data, targetUrl: backendUrl, targetClientId: activeClient },
        },
        5000,
        null
      );

      if (proxyResp && proxyResp.success && proxyResp.data?.success) {
        return true;
      }
      if (proxyResp?.data?.error) {
        console.log('[AI TTS Content] Background proxy upload server message:', proxyResp.data.error);
      }
    } catch (proxyErr) {
      console.log('[AI TTS Content] Background proxy upload note:', proxyErr?.message || proxyErr);
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

    if (action === 'SET_DOCK_VISIBILITY' || action === 'TOGGLE_DOCK') {
      removeLegacyFloatingDock();
      sendResponse({ success: true, sidePanelMode: true });
      return true;
    }

    if (action === 'START_QUEUE' || action === 'START_QUEUE_DIRECT') {
      const incomingJobs = sortJobsAscending(payload?.jobs || message.jobs || []);
      const resumeOnly = !!(payload?.resumeOnly || message.resumeOnly);
      const incomingSessionId = payload?.runSessionId || message.runSessionId || null;
      const isNewRunSession = !!incomingSessionId && incomingSessionId !== activeRunSessionId;

      if (!resumeOnly || isNewRunSession) {
        if (incomingSessionId) activeRunSessionId = incomingSessionId;
        sessionCompletedJobIds.clear();
        sessionCompletedFilenames.clear();
        jobRetryAttempts.clear();
      }

      syncKnownCompletedFromSource(payload || message, incomingJobs);

      // Strictly filter out already-COMPLETED / known-completed / CANCELLED jobs — NEVER resurrect COMPLETED back to PENDING!
      const list = incomingJobs
        .filter(
          (j) =>
            j &&
            !sessionCompletedJobIds.has(j.id) &&
            !sessionCompletedFilenames.has(normalizeJobKey(j.filename)) &&
            !knownCompletedJobIds.has(j.id) &&
            !knownCompletedFilenames.has(normalizeJobKey(j.filename)) &&
            j.status !== 'COMPLETED' &&
            j.status !== 'CANCELLED' &&
            j.status !== 'FAILED'
        )
        .map((j) => ({ ...j, status: 'PENDING' }));

      if (list.length === 0) {
        isQueueActive = false;
        directQueue = [];
        storageSetSafe({ activeQueue: [], queueActive: false });
        emitSidePanelState({ jobStatus: 'SELESAI SEMUA', stepIndex: 5 });
        dockLog('[ANTREAN] Semua pekerjaan sudah berstatus selesai (COMPLETED). Tidak ada scene baru untuk diproses.', 'info');
        sendResponse({ status: 'NO_PENDING_JOBS', count: 0 });
        return true;
      }

      isQueueActive = true;
      if (!resumeOnly || isNewRunSession) {
        const firstOrder = list[0].order || 1;
        const lastOrder = list[list.length - 1].order || list.length;
        dockLog(`[ANTREAN] Memulai ${list.length} pekerjaan belum selesai (urut #${firstOrder} -> #${lastOrder}).`, 'info');
      }

      if (resumeOnly && !isNewRunSession && directQueue.length > 0) {
        const mergedMap = new Map(directQueue.map((j) => [j.id || j.filename, j]));
        for (const item of list) {
          if (!mergedMap.has(item.id || item.filename)) mergedMap.set(item.id || item.filename, item);
        }
        directQueue = trimRemainingQueueForStorage(Array.from(mergedMap.values()));
      } else {
        directQueue = trimRemainingQueueForStorage(list);
      }

      storageSetSafe({ activeQueue: directQueue, queueActive: true });

      resetStaleRunnerLocksIfNeeded();
      if (!isExecuting && !isCooldownWaiting && !isPickingJob) {
        pickAndExecuteNextJob();
      }
      sendResponse({ status: 'ACCEPTED', count: directQueue.length });
      return true;
    }

    if (action === 'APPEND_QUEUE_JOBS') {
      const incomingJobs = sortJobsAscending(payload?.jobs || message.jobs || []);
      if (incomingJobs.length > 0) {
        syncKnownCompletedFromSource(payload || message, incomingJobs);
        isQueueActive = true;
        const mergedMap = new Map(directQueue.map((j) => [j.id || j.filename, j]));
        let addedCount = 0;
        for (const j of incomingJobs) {
          if (
            !j ||
            j.status === 'COMPLETED' ||
            j.status === 'CANCELLED' ||
            j.status === 'FAILED' ||
            sessionCompletedJobIds.has(j.id) ||
            sessionCompletedFilenames.has(normalizeJobKey(j.filename)) ||
            knownCompletedJobIds.has(j.id) ||
            knownCompletedFilenames.has(normalizeJobKey(j.filename))
          ) {
            continue;
          }
          const isRunningNow =
            currentJob && (j.id === currentJob.id || normalizeJobKey(j.filename) === normalizeJobKey(currentJob.filename));
          if (isRunningNow) continue;
          if (!mergedMap.has(j.id || j.filename)) addedCount++;
          mergedMap.set(j.id || j.filename, { ...j, status: 'PENDING' });
        }
        directQueue = trimRemainingQueueForStorage(Array.from(mergedMap.values()));
        storageSetSafe({ activeQueue: directQueue, queueActive: true });
        if (addedCount > 0) {
          dockLog(`[ANTREAN] +${addedCount} scene disinkronkan ke antrean aktif (${directQueue.length} menunggu).`, 'info');
        }
        resetStaleRunnerLocksIfNeeded();
        if (!isExecuting && !isCooldownWaiting && !isPickingJob) {
          pickAndExecuteNextJob();
        }
      }
      sendResponse({ status: 'APPENDED', count: directQueue.length });
      return true;
    }

    if (action === 'GET_RUNNER_STATE') {
      resetStaleRunnerLocksIfNeeded();
      const now = Date.now();
      const cooldownElapsedMs = isCooldownWaiting && cooldownStartedAt > 0 ? now - cooldownStartedAt : 0;
      const pickingElapsedMs = isPickingJob && pickingStartedAt > 0 ? now - pickingStartedAt : 0;
      const executingElapsedMs = isExecuting && executingStartedAt > 0 ? now - executingStartedAt : 0;

      // Foreground Website Watchdog wakes throttled background tab here -> immediately advance next scene if idle!
      if (isQueueActive && !isExecuting && !isCooldownWaiting && !isPickingJob && directQueue.length > 0) {
        pickAndExecuteNextJob();
      }

      sendResponse({
        isExecuting: isExecuting || isCooldownWaiting,
        isActivelyExecuting: isExecuting,
        isCooldownWaiting,
        isPickingJob,
        cooldownElapsedMs,
        pickingElapsedMs,
        executingElapsedMs,
        isQueueActive,
        currentJobId: currentJob?.id || null,
        currentFilename: currentJob?.filename || null,
        pendingCount: trimRemainingQueueForStorage(directQueue).length,
      });
      return true;
    }

    if (action === 'STOP_QUEUE' || action === 'PAUSE_QUEUE') {
      isQueueActive = false;
      isCooldownWaiting = false;
      cooldownStartedAt = 0;
      isPickingJob = false;
      pickingStartedAt = 0;
      hasProcessedSceneInSession = false;
      activeRunSessionId = null;
      directQueue = [];
      storageSetSafe({ activeQueue: [], queueActive: false });
      if (!isExecuting) {
        emitSidePanelState({ jobStatus: action === 'PAUSE_QUEUE' ? 'DIJEDA' : 'DIHENTIKAN', stepIndex: 0 });
      }
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
            console.log('[AI TTS Content] Fetch download URL note:', err);
          });
      } else if (url && url.startsWith('blob:null')) {
        dockLog(`[AI TTS] Chrome sedang mengunduh berkas "${filename || 'audio.wav'}" ke folder Downloads PC...`, 'info');
      }
      sendResponse({ received: true });
      return true;
    }

    if (action === 'AUDIO_CONFIRMED_ON_WEBSITE') {
      const {
        jobId: confJobId,
        filename: confFilename,
        remainingJobs,
        runSessionId: confRunSessionId,
        queueActive: confQueueActive,
        allCompleted: confAllCompleted,
      } = message;
      if (confJobId) {
        sessionCompletedJobIds.add(confJobId);
        knownCompletedJobIds.add(confJobId);
      }
      if (confFilename) {
        sessionCompletedFilenames.add(normalizeJobKey(confFilename));
        knownCompletedFilenames.add(normalizeJobKey(confFilename));
      }

      if (currentJob && (currentJob.id === confJobId || normalizeJobKey(currentJob.filename) === normalizeJobKey(confFilename))) {
        isWebsiteAudioConfirmed = true;
        dockLog(`[AI TTS] Sinyal dari website: Berkas "${confFilename || currentJob.filename}.wav" diterima & tersimpan!`, 'success');
      }

      if (confQueueActive && Array.isArray(remainingJobs) && remainingJobs.length > 0) {
        if (confRunSessionId && confRunSessionId !== activeRunSessionId) {
          activeRunSessionId = confRunSessionId;
        }
        isQueueActive = true;
        const mergedMap = new Map(directQueue.map((j) => [j.id || j.filename, j]));
        for (const rj of remainingJobs) {
          if (
            rj &&
            rj.status !== 'COMPLETED' &&
            rj.status !== 'CANCELLED' &&
            !sessionCompletedJobIds.has(rj.id) &&
            !sessionCompletedFilenames.has(normalizeJobKey(rj.filename)) &&
            !knownCompletedJobIds.has(rj.id) &&
            !knownCompletedFilenames.has(normalizeJobKey(rj.filename)) &&
            !(currentJob && (rj.id === currentJob.id || normalizeJobKey(rj.filename) === normalizeJobKey(currentJob.filename)))
          ) {
            if (!mergedMap.has(rj.id || rj.filename)) {
              mergedMap.set(rj.id || rj.filename, { ...rj, status: 'PENDING' });
            }
          }
        }
        directQueue = trimRemainingQueueForStorage(Array.from(mergedMap.values()));
        storageSetSafe({ activeQueue: directQueue, queueActive: true });
        resetStaleRunnerLocksIfNeeded();
        if (!isExecuting && !isCooldownWaiting && !isPickingJob && directQueue.length > 0) {
          pickAndExecuteNextJob();
        }
      } else if (confAllCompleted) {
        directQueue = [];
        isQueueActive = false;
        hasProcessedSceneInSession = false;
        storageSetSafe({ activeQueue: [], queueActive: false });
      }

      sendResponse({ confirmed: true, pendingCount: directQueue.length });
      return true;
    }

    if (action === 'RUN_DIAGNOSTICS') {
      const diag = window.AI_STUDIO_SELECTORS ? window.AI_STUDIO_SELECTORS.runDiagnostics() : null;
      sendResponse({ success: true, diagnostics: diag });
      return true;
    }
  });
})();
