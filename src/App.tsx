import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar, TabId } from './components/Sidebar';
import { CapsuleMenu } from './components/CapsuleMenu';
import { ResetConfirmModal } from './components/ResetConfirmModal';
import { DashboardPage } from './pages/DashboardPage';
import { TextManagerPage } from './pages/TextManagerPage';
import { QueuePage } from './pages/QueuePage';
import { AudioLibraryPage } from './pages/AudioLibraryPage';
import { WavConverterPage } from './pages/WavConverterPage';
import { FailedJobsPage } from './pages/FailedJobsPage';
import { ExtensionPage } from './pages/ExtensionPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogsPage } from './pages/LogsPage';
import { AddTextModal } from './components/AddTextModal';
import { ImportModal } from './components/ImportModal';
import { GuideModal } from './components/GuideModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import {
  TTSJob,
  ActivityLog,
  AudioItem,
  QueueState,
  ExtensionStatus,
  AppSettings,
} from './types';
import * as api from './services/api';
import { extensionClient } from './services/extensionBridge';
import { downloadExtensionZipClient } from './services/extensionDownloader';
import { localHistory, areJobsEqual, areAudioItemsEqual } from './services/localHistory';
import { getClientId, getClientName, resetWorkspace } from './services/clientWorkspace';
import { clearAllAudioBlobs, deleteAudioBlob, saveAudioBlob, resolveValidAudioBlob } from './services/localAudioStorage';
import { folderSyncService, validateRiffWaveBuffer } from './services/folderSyncService';
import { convertWavToMp3Client } from './services/clientAudioConverter';

export default function App() {
  const [currentTab, setCurrentTab] = useState<TabId>('dashboard');

  // Client workspace identity per device/PC
  const [clientId, setClientId] = useState<string>(() => getClientId());
  const [clientName, setClientName] = useState<string>(() => getClientName());

  // Application Data States (initialized from browser localStorage for instant persistence across refresh)
  const [jobs, setJobs] = useState<TTSJob[]>(() => localHistory.getJobs());
  const [logs, setLogs] = useState<ActivityLog[]>(() => localHistory.getLogs());
  const [audioItems, setAudioItems] = useState<AudioItem[]>(() => localHistory.getAudioItems());
  const [queueState, setQueueState] = useState<QueueState>(() => {
    try {
      const cid = getClientId();
      const wasActive = typeof window !== 'undefined' && localStorage.getItem(`ai_tts_queue_active_${cid}`) === '1';
      if (wasActive && localHistory.getJobs().some((j) => j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED')) {
        return 'RUNNING';
      }
    } catch {}
    return 'IDLE';
  });
  const [currentJob, setCurrentJob] = useState<TTSJob | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>({
    connected: false,
    aiStudioConnected: false,
    lastPing: 0,
    version: '1.1.0',
  });
  const [settings, setSettings] = useState<AppSettings>(() => {
    const local = localHistory.getLocalSettings();
    return {
      aiStudioUrl: 'https://aistudio.google.com/',
      storagePath: 'storage',
      outputFormat: 'mp3',
      mp3Bitrate: 192,
      maxRetries: 3,
      retryDelays: [5000, 15000, 30000],
      autoStart: false,
      autoRetry: true,
      autoSave: true,
      autoContinue: true,
      stopWhenFailed: false,
      skipFailedJobs: true,
      preserveWavFiles: true,
      mockMode: false,
      conversionMode: 'lamejs',
      ...(local || {}),
    };
  });

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [importModalType, setImportModalType] = useState<'txt' | 'csv' | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

  // Capsule Menu & Full System Reset States
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Notification Toast State (avoids window.alert)
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Track ingested pending WAVs, extension signatures, and post-delete suppression across async loops
  const processedPendingIdsRef = useRef<Set<string>>(new Set());
  const extensionUnduhanSignaturesRef = useRef<Map<string, string>>(new Map());
  const clearAudioSuppressionUntilRef = useRef<number>(0);

  // Full System Restart & Purge of Extensions and Temporary Storage
  const handleFullSystemReset = async () => {
    setIsResetting(true);
    clearAudioSuppressionUntilRef.current = Date.now() + 4500;
    processedPendingIdsRef.current.clear();
    extensionUnduhanSignaturesRef.current.clear();
    try {
      // 1. Stop active queue
      await api.stopQueue().catch(() => {});
      // 2. Clear all queue jobs on server
      await api.clearAllJobs().catch(() => {});
      // 3. Clear all audio permanently (backend + entire IndexedDB store + connected unduhan folder + extension cache/disk WAVs)
      await api.clearAllAudio().catch(() => {});
      await clearAllAudioBlobs().catch(() => {});
      await folderSyncService.clearTemporaryWavFiles().catch(() => {});
      await extensionClient.clearAllExtensionWavs().catch(() => {});
      // 4. Clear all logs
      await api.clearLogs().catch(() => {});
      // 5. Stop any active extension runner, disconnect bridge & reset status
      await extensionClient.sendCommand('STOP_QUEUE', { clientId }).catch(() => {});
      extensionClient.disconnect();
      setExtensionStatus({
        connected: false,
        aiStudioConnected: false,
        lastPing: 0,
        version: '1.1.0',
      });
      // 6. Clear local browser cache & generate fresh clean workspace
      setUserQueueActive(false, clientId);
      localHistory.clearAll();
      const newWsId = resetWorkspace();
      setUserQueueActive(false, newWsId);
      setClientId(newWsId);
      setClientName(getClientName());
      // 7. Reset all active React states
      setJobs([]);
      setAudioItems([]);
      setLogs([]);
      setQueueState('IDLE');
      setCurrentJob(null);

      setIsResetModalOpen(false);
      showToast('Seluruh sistem, folder unduhan, ekstensi, dan data audio berhasil di-reset permanen!', 'success');
    } catch (err: any) {
      console.error('Reset error:', err);
      showToast('Terjadi kesalahan saat restart: ' + (err.message || 'Gagal'), 'error');
    } finally {
      setIsResetting(false);
    }
  };

  // Track latest queueState and settings inside callbacks without re-subscribing SSE/intervals
  const queueStateRef = useRef(queueState);
  useEffect(() => {
    queueStateRef.current = queueState;
  }, [queueState]);

  const getQueueActiveStorageKey = (cid: string) => `ai_tts_queue_active_${cid}`;
  const userQueueActiveRef = useRef<boolean>(queueState === 'RUNNING');
  const runSessionIdRef = useRef<string>('');

  const setUserQueueActive = useCallback((active: boolean, cid = getClientId()) => {
    userQueueActiveRef.current = active;
    try {
      if (active) {
        localStorage.setItem(getQueueActiveStorageKey(cid), '1');
      } else {
        localStorage.removeItem(getQueueActiveStorageKey(cid));
      }
    } catch {}
  }, []);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const pendingAddSyncRef = useRef<Promise<void> | null>(null);
  const continuityBusyRef = useRef<boolean>(false);
  const lastContinuityDispatchRef = useRef<number>(0);

  const normalizeFilenameKey = (name?: string) =>
    String(name || '').trim().replace(/\.(wav|mp3)$/i, '').toLowerCase();

  const normalizeTextKey = (text?: string) =>
    String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();

  const isJobUnfinished = (j: TTSJob | undefined | null) =>
    !!j && j.status !== 'COMPLETED' && j.status !== 'FAILED' && j.status !== 'CANCELLED';

  const slimJobsForExtension = (list: TTSJob[]) =>
    list.map((j) => ({
      id: j.id,
      order: j.order,
      filename: j.filename,
      text: j.text,
      status: j.status,
      retryCount: j.retryCount || 0,
      maxRetries: j.maxRetries || 3,
      createdAt: j.createdAt,
      clientId: j.clientId || getClientId(),
    }));

  const applyServerQueueStateSafely = useCallback((serverState: QueueState, latestJobs?: TTSJob[]) => {
    const activeJobs = latestJobs || jobsRef.current;
    const stillHasUnfinished = activeJobs.some(isJobUnfinished);
    if (serverState === 'IDLE' && userQueueActiveRef.current && stillHasUnfinished) {
      // Never let a stateless server / cold serverless lambda kill an active multi-scene browser queue!
      setQueueState((prev) => (prev === 'RUNNING' ? prev : 'RUNNING'));
      return;
    }
    if (serverState === 'RUNNING' && stillHasUnfinished) {
      setUserQueueActive(true);
    }
    if (serverState === 'IDLE' && !stillHasUnfinished) {
      setUserQueueActive(false);
    }
    setQueueState((prev) => (prev === serverState ? prev : serverState));
  }, [setUserQueueActive]);

  // Load all data with referential equality to guarantee anti-flicker stability
  const loadData = useCallback(async () => {
    try {
      const [jobsData, queueData, audioData, settingsData, logsData] = await Promise.all([
        api.fetchJobs().catch(() => []),
        api.getQueueStatus().catch(() => ({
          state: 'IDLE' as QueueState,
          currentJob: null,
          extensionStatus: { connected: false, aiStudioConnected: false, lastPing: 0, version: '1.1.0' } as ExtensionStatus,
          stats: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
        })),
        api.fetchAudioLibrary().catch(() => []),
        api.fetchSettings().catch(() => settingsRef.current),
        api.fetchLogs(100).catch(() => []),
      ]);

      let latestMergedJobs = jobsRef.current;
      setJobs((prev) => {
        const merged = localHistory.mergeJobs(jobsData);
        latestMergedJobs = areJobsEqual(prev, merged) ? prev : merged;
        jobsRef.current = latestMergedJobs;
        return latestMergedJobs;
      });

      setAudioItems((prev) => {
        const merged = localHistory.mergeAudioItems(audioData);
        return areAudioItemsEqual(prev, merged) ? prev : merged;
      });

      if (queueData) {
        applyServerQueueStateSafely(queueData.state, latestMergedJobs);
        setCurrentJob((prev) => {
          if (
            prev?.id === queueData.currentJob?.id &&
            prev?.status === queueData.currentJob?.status &&
            prev?.updatedAt === queueData.currentJob?.updatedAt
          ) {
            return prev;
          }
          return queueData.currentJob;
        });
        setExtensionStatus((prev) => {
          if (
            prev.connected === queueData.extensionStatus.connected &&
            prev.aiStudioConnected === queueData.extensionStatus.aiStudioConnected &&
            prev.tabId === queueData.extensionStatus.tabId
          ) {
            return prev;
          }
          return queueData.extensionStatus;
        });
      }

      if (settingsData) {
        setSettings((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(settingsData)) return prev;
          localHistory.saveLocalSettings(settingsData);
          return settingsData;
        });
      }

      if (logsData && logsData.length > 0) {
        setLogs((prev) => {
          if (prev.length === logsData.length && prev[prev.length - 1]?.id === logsData[logsData.length - 1]?.id) {
            return prev;
          }
          localHistory.saveLogs(logsData);
          return logsData;
        });
      }
    } catch (err) {
      console.warn('Initial data load warning:', err);
    }
  }, []);

  // Handle workspace reset or reload
  const handleWorkspaceReset = () => {
    setUserQueueActive(false, clientId);
    const newId = getClientId();
    const newName = getClientName();
    setClientId(newId);
    setClientName(newName);
    setJobs([]);
    setAudioItems([]);
    setLogs([]);
    setQueueState('IDLE');
    setCurrentJob(null);
  };

  const handleWorkspaceReload = () => {
    setClientId(getClientId());
    setClientName(getClientName());
    setJobs(localHistory.getJobs());
    setAudioItems(localHistory.getAudioItems());
    setLogs(localHistory.getLogs());
    loadData();
  };

  // Initialize and connect Server-Sent Events (SSE) scoped per clientId
  useEffect(() => {
    loadData();

    const currentClientId = getClientId();
    const sseUrl = `/api/logs/stream?clientId=${encodeURIComponent(currentClientId)}`;
    const sse = new EventSource(sseUrl);

    sse.addEventListener('sync', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId && data.clientId !== currentClientId) return;

        if (data.jobs && data.jobs.length > 0) {
          setJobs((prev) => {
            const merged = localHistory.mergeJobs(data.jobs);
            const next = areJobsEqual(prev, merged) ? prev : merged;
            jobsRef.current = next;
            return next;
          });
        }
        if (data.queueState) applyServerQueueStateSafely(data.queueState);
        if (data.currentJob !== undefined) {
          setCurrentJob((prev) => {
            if (prev?.id === data.currentJob?.id && prev?.status === data.currentJob?.status) return prev;
            return data.currentJob;
          });
        }
        if (data.extensionStatus) {
          setExtensionStatus((prev) => {
            if (
              prev.connected === data.extensionStatus.connected &&
              prev.aiStudioConnected === data.extensionStatus.aiStudioConnected
            ) {
              return prev;
            }
            return data.extensionStatus;
          });
        }
        if (data.logs) {
          setLogs(data.logs);
          localHistory.saveLogs(data.logs);
        }
      } catch {}
    });

    sse.addEventListener('job_update', (e) => {
      try {
        const updated = JSON.parse(e.data) as TTSJob;
        if (updated.clientId && updated.clientId !== currentClientId) return;

        setJobs((prev) => {
          const idx = prev.findIndex((j) => j.id === updated.id);
          let next: TTSJob[];
          if (idx >= 0) {
            if (prev[idx].status === 'COMPLETED' && updated.status !== 'COMPLETED') {
              return prev;
            }
            next = [...prev];
            next[idx] = updated;
          } else {
            next = [...prev, updated];
          }
          if (areJobsEqual(prev, next)) return prev;
          jobsRef.current = next;
          localHistory.saveJobs(next);
          return next;
        });

        if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
          api.fetchAudioLibrary().then((srv) => {
            if (srv && srv.length > 0) {
              setAudioItems((prev) => {
                const merged = localHistory.mergeAudioItems(srv);
                return areAudioItemsEqual(prev, merged) ? prev : merged;
              });
            }
          }).catch(() => {});
        }
      } catch {}
    });

    sse.addEventListener('queue_state', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.clientId && data.clientId !== currentClientId) return;

        applyServerQueueStateSafely(data.state);
        api.getQueueStatus().then((s) => {
          setCurrentJob((prev) => (prev?.id === s.currentJob?.id && prev?.status === s.currentJob?.status ? prev : s.currentJob));
          setExtensionStatus((prev) => (
            prev.connected === s.extensionStatus.connected &&
            prev.aiStudioConnected === s.extensionStatus.aiStudioConnected
              ? prev
              : s.extensionStatus
          ));
        }).catch(() => {});
      } catch {}
    });

    sse.addEventListener('extension_status', (e) => {
      try {
        const status = JSON.parse(e.data);
        if (status.clientId && status.clientId !== currentClientId) return;
        setExtensionStatus((prev) => (
          prev.connected === status.connected &&
          prev.aiStudioConnected === status.aiStudioConnected
            ? prev
            : status
        ));
      } catch {}
    });

    sse.addEventListener('log', (e) => {
      try {
        const logItem = JSON.parse(e.data) as ActivityLog;
        if (logItem.clientId && logItem.clientId !== currentClientId) return;

        setLogs((prev) => {
          const next = [...prev.slice(-300), logItem];
          localHistory.saveLogs(next);
          return next;
        });
      } catch {}
    });

    // Smart background poll with referential checks
    // Runs every 5s when queue is RUNNING, or every 8s when IDLE
    const pollTimer = setInterval(() => {
      api.getQueueStatus().then((q) => {
        applyServerQueueStateSafely(q.state);
        setCurrentJob((prev) => {
          if (prev?.id === q.currentJob?.id && prev?.status === q.currentJob?.status) return prev;
          return q.currentJob;
        });
        setExtensionStatus((prev) => {
          if (
            prev.connected === q.extensionStatus.connected &&
            prev.aiStudioConnected === q.extensionStatus.aiStudioConnected
          ) {
            return prev;
          }
          return q.extensionStatus;
        });
      }).catch(() => {});

      // Only re-fetch full jobs if queue is active to eliminate idle network churn
      if (queueStateRef.current === 'RUNNING') {
        api.fetchJobs().then((srv) => {
          if (srv && srv.length > 0) {
            setJobs((prev) => {
              const merged = localHistory.mergeJobs(srv);
              if (areJobsEqual(prev, merged)) return prev;
              jobsRef.current = merged;
              return merged;
            });
          }
        }).catch(() => {});
      }
    }, 6000);

    // Track ingested pending WAV IDs & extension unduhan signatures to avoid duplicate writes
    let lastExtensionScanAt = 0;

    const ingestExtensionWav = async (payload: {
      pendingId?: string;
      jobId?: string;
      filename?: string;
      baseName?: string;
      dataUrl?: string;
      size?: number;
      lastModified?: number;
      duration?: number;
      createdAt?: number;
    }) => {
      if (!payload?.dataUrl) return;
      if (Date.now() < clearAudioSuppressionUntilRef.current) return;
      if (payload.pendingId && processedPendingIdsRef.current.has(payload.pendingId)) return;
      if (payload.pendingId) processedPendingIdsRef.current.add(payload.pendingId);

      try {
        const commaIdx = payload.dataUrl.indexOf(',');
        const b64 = commaIdx !== -1 ? payload.dataUrl.slice(commaIdx + 1) : payload.dataUrl;
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }

        // Aturan Ketat Folder Audio: Tolak non-RIFF/WAVE atau audio <= 0.1 detik
        const riffCheck = validateRiffWaveBuffer(bytes.buffer);
        if (!riffCheck.valid) {
          console.warn('[App] Menolak berkas dari ekstensi (aturan ketat audio):', payload.filename, riffCheck.reason);
          return;
        }

        const wavBlob = new Blob([bytes], { type: 'audio/wav' });
        const rawName = payload.baseName || (payload.filename || 'audio').replace(/\.wav$/i, '');
        const cleanBase = rawName.trim() || 'audio';
        const activeClientId = getClientId();

        await saveAudioBlob(activeClientId, cleanBase, 'wav', wavBlob);
        if (folderSyncService.getState().isConnected) {
          await folderSyncService.writeWavFile(`${cleanBase}.wav`, bytes.buffer).catch(() => {});
        }

        const existing = localHistory.getAudioItems().find((it) => it.baseName === cleanBase);
        const updatedItem: AudioItem = {
          filename: existing?.hasMp3 ? `${cleanBase}.mp3` : `${cleanBase}.wav`,
          baseName: cleanBase,
          hasWav: true,
          hasMp3: existing?.hasMp3 || false,
          wavSize: wavBlob.size,
          mp3Size: existing?.mp3Size || 0,
          duration: payload.duration || riffCheck.duration || existing?.duration || 0,
          createdAt: payload.lastModified || payload.createdAt || existing?.createdAt || Date.now(),
          wavPath: `/api/audio/wav/${encodeURIComponent(cleanBase)}`,
          mp3Path: `/api/audio/mp3/${encodeURIComponent(cleanBase)}`,
          clientId: activeClientId,
        };
        const updatedList = localHistory.addOrUpdateAudioItem(updatedItem);
        setAudioItems(updatedList);

        if (payload.filename && payload.size && payload.lastModified) {
          extensionUnduhanSignaturesRef.current.set(payload.filename.toLowerCase(), `${payload.size}::${payload.lastModified}`);
        }

        // Sync matching job status to COMPLETED in browser state & localStorage synchronously (React 18 safe!)
        const normalizedClean = cleanBase.trim().toLowerCase();
        const currentList = jobsRef.current;
        const nextJobs = currentList.map((j) =>
          j.id === payload.jobId || j.filename.trim().toLowerCase() === normalizedClean
            ? { ...j, status: 'COMPLETED' as const, wavSize: wavBlob.size, duration: updatedItem.duration, completedAt: Date.now(), error: undefined }
            : j
        );
        const remainingAfter = sortJobsStrictAscending(nextJobs).filter(isJobUnfinished);
        const hasRemainingUnfinished = remainingAfter.length > 0;
        if (!areJobsEqual(currentList, nextJobs)) {
          jobsRef.current = nextJobs;
          localHistory.saveJobs(nextJobs);
          setJobs(nextJobs);
        }

        const isActiveQueue = userQueueActiveRef.current || queueStateRef.current === 'RUNNING';
        setCurrentJob((prev) => {
          if (!hasRemainingUnfinished) return null;
          if (!prev || prev.id === payload.jobId || prev.filename.trim().toLowerCase() === normalizedClean) {
            return remainingAfter[0] || null;
          }
          return prev;
        });

        extensionClient
          .notifyJobAudioReceived(
            payload.jobId || cleanBase,
            cleanBase,
            isActiveQueue ? slimJobsForExtension(remainingAfter) : [],
            runSessionIdRef.current,
            !hasRemainingUnfinished
          )
          .catch(() => {});

        if (payload.pendingId) {
          extensionClient.ackExtensionWavs([payload.pendingId]).catch(() => {});
        }

        if (isActiveQueue) {
          if (!hasRemainingUnfinished) {
            setUserQueueActive(false);
            setQueueState('IDLE');
            setCurrentJob(null);
          } else {
            setUserQueueActive(true);
            setTimeout(() => ensureQueueContinuityRef.current('audio_ingested'), 450);
          }
        }
      } catch (err) {
        console.warn('[App] Gagal memproses WAV dari ekstensi:', err);
      }
    };

    const syncPendingWavsFromExtension = async () => {
      if (Date.now() < clearAudioSuppressionUntilRef.current) return;
      const pending = await extensionClient.getPendingExtensionWavs();
      for (const item of pending) {
        await ingestExtensionWav(item);
      }

      // Periodically scan Extension's own linked `unduhan` folder (catches manual File Manager additions too)
      const now = Date.now();
      if (Date.now() >= clearAudioSuppressionUntilRef.current && now - lastExtensionScanAt >= 7500) {
        lastExtensionScanAt = now;
        const knownObj: Record<string, string> = {};
        extensionUnduhanSignaturesRef.current.forEach((sig, key) => {
          knownObj[key] = sig;
        });
        const scanned = await extensionClient.scanExtensionUnduhanFolder(knownObj);
        if (Date.now() >= clearAudioSuppressionUntilRef.current && scanned.success && scanned.folderLinked && scanned.items.length > 0) {
          for (const entry of scanned.items) {
            await ingestExtensionWav({
              filename: entry.filename,
              baseName: entry.baseName,
              dataUrl: entry.dataUrl,
              size: entry.size,
              lastModified: entry.lastModified,
              duration: entry.duration,
            });
          }
        }
      }
    };

    // Auto-detect & handshake with extension automatically & continuously
    const tryConnectExtension = () => {
      extensionClient.checkPresence().then((ready) => {
        if (ready) {
          extensionClient.connectHandshake(window.location.origin).then(() => {
            const folderState = folderSyncService.getState();
            if (
              folderState.isConnected &&
              folderState.folderName &&
              folderState.folderName.startsWith('AI_TTS_Chrome_Extension')
            ) {
              extensionClient.syncDownloadSubfolder(folderState.folderName).catch(() => {});
            }
            syncPendingWavsFromExtension().catch(() => {});
            api.getQueueStatus().then((q) => {
              setExtensionStatus((prev) => (
                prev.connected === q.extensionStatus.connected &&
                prev.aiStudioConnected === q.extensionStatus.aiStudioConnected
                  ? prev
                  : q.extensionStatus
              ));
            }).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    };

    tryConnectExtension();
    const unsubExt = extensionClient.subscribe((event) => {
      if (event.type === 'EXTENSION_READY') {
        tryConnectExtension();
      }
      if (event.type === 'NEW_WAV_FROM_EXTENSION' && event.payload) {
        ingestExtensionWav(event.payload).catch(() => {});
      }
      if (event.type === 'REQUEST_QUEUE_SNAPSHOT' && event.requestId) {
        const allSortedSnap = sortJobsStrictAscending(jobsRef.current);
        const remainingSnap = allSortedSnap.filter(isJobUnfinished);
        const completedSnap = allSortedSnap.filter((j) => j.status === 'COMPLETED');
        window.postMessage(
          {
            target: 'AI_TTS_EXTENSION',
            type: 'QUEUE_SNAPSHOT_RESPONSE',
            requestId: event.requestId,
            payload: {
              queueActive: userQueueActiveRef.current || queueStateRef.current === 'RUNNING',
              runSessionId: runSessionIdRef.current,
              jobs: slimJobsForExtension(remainingSnap),
              completedIds: completedSnap.map((j) => j.id),
              completedFilenames: completedSnap.map((j) => j.filename),
            },
          },
          '*'
        );
      }
      if (event.type === 'JOB_PROGRESS' && event.payload) {
        const p = event.payload;
        const pId = p.jobId || p.id;
        const pName = String(p.filename || '').trim().toLowerCase();
        const nextStatus = (p.status || 'SENDING_TEXT') as TTSJob['status'];
        if (pId || pName) {
          let activeMatched: TTSJob | null = null;
          const prevList = jobsRef.current;
          const next = prevList.map((j) => {
            if (j.status === 'COMPLETED' && nextStatus !== 'COMPLETED') return j;
            const matches = j.id === pId || (pName && j.filename.trim().toLowerCase() === pName);
            if (!matches) return j;
            const updatedJob: TTSJob = {
              ...j,
              status: nextStatus,
              retryCount: typeof p.retryCount === 'number' ? p.retryCount : j.retryCount,
              maxRetries: typeof p.maxRetries === 'number' ? p.maxRetries : j.maxRetries,
              error: p.error !== undefined ? p.error : nextStatus === 'SENDING_TEXT' ? undefined : j.error,
              updatedAt: Date.now(),
            };
            activeMatched = updatedJob;
            return updatedJob;
          });
          const stillHasUnfinished = next.some(isJobUnfinished);
          jobsRef.current = next;
          localHistory.saveJobs(next);
          setJobs(next);
          if (activeMatched) {
            if (nextStatus === 'FAILED') {
              if (!stillHasUnfinished && (userQueueActiveRef.current || queueStateRef.current === 'RUNNING')) {
                setUserQueueActive(false);
                setQueueState('IDLE');
                setCurrentJob(null);
              } else if (stillHasUnfinished && (userQueueActiveRef.current || queueStateRef.current === 'RUNNING')) {
                setTimeout(() => ensureQueueContinuityRef.current('job_failed_advance'), 600);
              }
            } else {
              setCurrentJob(activeMatched);
            }
          }
        }
      }
      if (event.type === 'JOB_COMPLETED') {
        const completedId = event.payload?.id;
        const completedFilename = event.payload?.filename;
        const normalizedCompletedName = String(completedFilename || '').trim().toLowerCase();
        if (completedId || completedFilename) {
          const prevList = jobsRef.current;
          const next = prevList.map((j) =>
            j.id === completedId || (normalizedCompletedName && j.filename.trim().toLowerCase() === normalizedCompletedName)
              ? { ...j, status: 'COMPLETED' as const, completedAt: Date.now(), error: undefined }
              : j
          );
          const remainingAfter = sortJobsStrictAscending(next).filter(isJobUnfinished);
          const morePending = remainingAfter.length > 0;
          jobsRef.current = next;
          localHistory.saveJobs(next);
          setJobs(next);

          setCurrentJob((prev) => {
            if (!morePending) return null;
            if (!prev || prev.id === completedId || (normalizedCompletedName && prev.filename.trim().toLowerCase() === normalizedCompletedName)) {
              return remainingAfter[0] || null;
            }
            return prev;
          });

          if (userQueueActiveRef.current || queueStateRef.current === 'RUNNING') {
            if (!morePending) {
              setUserQueueActive(false);
              setQueueState('IDLE');
              setCurrentJob(null);
            } else {
              setUserQueueActive(true);
              setTimeout(() => ensureQueueContinuityRef.current('job_completed_event'), 450);
            }
          }
        }
        loadData();
      }
    });

    const extAutoTimer = setInterval(tryConnectExtension, 2500);

    return () => {
      sse.close();
      clearInterval(pollTimer);
      clearInterval(extAutoTimer);
      unsubExt();
    };
  }, [loadData, applyServerQueueStateSafely, setUserQueueActive]);



  // Layanan Sinkronisasi Folder Lokal Ketat (folderSyncService): Real-time watcher ke IndexedDB
  const [isFolderSyncConnected, setIsFolderSyncConnected] = useState<boolean>(() => folderSyncService.getState().isConnected);

  useEffect(() => {
    const unsub = folderSyncService.subscribe((state) => {
      setIsFolderSyncConnected((prev) => (prev === state.isConnected ? prev : state.isConnected));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isFolderSyncConnected) {
      folderSyncService.stopWatching();
      return;
    }

    folderSyncService.startWatching(async ({ baseName, file, buffer, duration, format }) => {
      try {
        const activeClientId = getClientId();
        const storageFormat = format === 'mp3' ? 'mp3' : 'wav';
        const mimeType = storageFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav';
        const safeBlob = new Blob([buffer], { type: mimeType });
        await saveAudioBlob(activeClientId, baseName, storageFormat, safeBlob);

        const existing = localHistory.getAudioItems().find((it) => it.baseName === baseName);
        const isDirectMp3 = storageFormat === 'mp3';
        const newAudioItem: AudioItem = {
          filename: isDirectMp3 || existing?.hasMp3 ? `${baseName}.mp3` : `${baseName}.wav`,
          baseName,
          hasWav: !isDirectMp3 || existing?.hasWav || false,
          hasMp3: isDirectMp3 || existing?.hasMp3 || false,
          wavSize: isDirectMp3 ? (existing?.wavSize || 0) : safeBlob.size,
          mp3Size: isDirectMp3 ? safeBlob.size : (existing?.mp3Size || 0),
          duration: duration || existing?.duration || 0,
          createdAt: file.lastModified || existing?.createdAt || Date.now(),
          wavPath: `/api/audio/wav/${encodeURIComponent(baseName)}`,
          mp3Path: `/api/audio/mp3/${encodeURIComponent(baseName)}`,
          clientId: activeClientId,
        };

        const updatedAudio = localHistory.addOrUpdateAudioItem(newAudioItem);
        setAudioItems(updatedAudio);

        const normalizedBase = baseName.trim().toLowerCase();
        let matchedJobId = '';
        const prevList = jobsRef.current;
        const nextJobs = prevList.map((j) => {
          if (j.filename.trim().toLowerCase() === normalizedBase && j.status !== 'COMPLETED') {
            matchedJobId = j.id;
            return { ...j, status: 'COMPLETED' as const, wavSize: newAudioItem.wavSize, duration: newAudioItem.duration, completedAt: Date.now(), error: undefined };
          }
          return j;
        });
        const remainingAfter = sortJobsStrictAscending(nextJobs).filter(isJobUnfinished);
        const hasRemainingUnfinished = remainingAfter.length > 0;
        if (!areJobsEqual(prevList, nextJobs)) {
          jobsRef.current = nextJobs;
          localHistory.saveJobs(nextJobs);
          setJobs(nextJobs);
        }

        const isActiveQueue = userQueueActiveRef.current || queueStateRef.current === 'RUNNING';
        if (matchedJobId) {
          setCurrentJob((prev) => {
            if (!hasRemainingUnfinished) return null;
            if (!prev || prev.id === matchedJobId || prev.filename.trim().toLowerCase() === normalizedBase) {
              return remainingAfter[0] || null;
            }
            return prev;
          });
          extensionClient
            .notifyJobAudioReceived(
              matchedJobId,
              baseName,
              isActiveQueue ? slimJobsForExtension(remainingAfter) : [],
              runSessionIdRef.current,
              !hasRemainingUnfinished
            )
            .catch(() => {});
        }
        if (isActiveQueue) {
          if (!hasRemainingUnfinished) {
            setUserQueueActive(false);
            setQueueState('IDLE');
            setCurrentJob(null);
          } else {
            setUserQueueActive(true);
            setTimeout(() => ensureQueueContinuityRef.current('folder_wav_detected'), 450);
          }
        }
      } catch (err) {
        console.warn('[App] Gagal mengunggah otomatis Audio Adegan dari folder unduhan:', err);
      }
    });

    return () => {
      folderSyncService.stopWatching();
    };
  }, [isFolderSyncConnected, clientId, setUserQueueActive]);

  // Self-heal: ensure any existing audio library item with WAV but missing/zero MP3 is automatically converted to MP3
  const healingInProgressRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const healMissingMp3 = async () => {
      if (healingInProgressRef.current) return;
      const missingMp3Items = audioItems.filter((it) => it.hasWav && (!it.hasMp3 || !it.mp3Size || it.mp3Size === 0));
      if (missingMp3Items.length === 0) return;

      healingInProgressRef.current = true;
      try {
        for (const it of missingMp3Items) {
          if (cancelled) break;
          try {
            const wavBlob = await resolveValidAudioBlob(clientId, it.baseName, 'wav');

            if (wavBlob && wavBlob.size > 0) {
              const conv = await convertWavToMp3Client(wavBlob, settingsRef.current.mp3Bitrate || 192);
              if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0 && !cancelled) {
                await saveAudioBlob(clientId, it.baseName, 'mp3', conv.mp3Blob);
                const updatedItem: AudioItem = {
                  ...it,
                  filename: `${it.baseName}.mp3`,
                  hasMp3: true,
                  mp3Size: conv.mp3Size,
                  duration: conv.duration || it.duration,
                };
                const updated = localHistory.addOrUpdateAudioItem(updatedItem);
                setAudioItems(updated);
              }
            }
          } catch (e) {
            console.warn('[HealMp3] Could not convert missing mp3:', e);
          }
        }
      } finally {
        healingInProgressRef.current = false;
      }
    };

    healMissingMp3();
    return () => {
      cancelled = true;
    };
  }, [audioItems, clientId, settings.mp3Bitrate]);

  // Handlers for Queue
  const sortJobsStrictAscending = (list: TTSJob[]) =>
    [...list].sort((a, b) => {
      const orderA = Number.isFinite(Number(a.order)) && Number(a.order) > 0 ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b.order)) && Number(b.order) > 0 ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  const ensureQueueContinuity = useCallback(async (reason = 'watchdog') => {
    const isRunning = userQueueActiveRef.current || queueStateRef.current === 'RUNNING';
    if (!isRunning) return;
    if (continuityBusyRef.current) return;
    const now = Date.now();
    if (now - lastContinuityDispatchRef.current < 1200) return;

    const remaining = sortJobsStrictAscending(jobsRef.current).filter(isJobUnfinished);
    if (remaining.length === 0) {
      setUserQueueActive(false);
      setQueueState('IDLE');
      setCurrentJob(null);
      return;
    }

    if (!userQueueActiveRef.current && queueStateRef.current === 'RUNNING') {
      setUserQueueActive(true);
    }

    continuityBusyRef.current = true;
    try {
      const runner = await extensionClient.getRunnerState();
      if (!userQueueActiveRef.current && queueStateRef.current !== 'RUNNING') return;

      if (runner.success && runner.aiStudioTabFound) {
        const cooldownStalled = !!runner.isCooldownWaiting && Number(runner.cooldownElapsedMs || 0) >= 3500;
        const pickingStalled = !!runner.isPickingJob && Number(runner.pickingElapsedMs || 0) >= 12000;
        const queueDroppedPrematurely = !runner.isQueueActive && remaining.length > 0;
        if (!runner.isExecuting || queueDroppedPrematurely || cooldownStalled || pickingStalled) {
          lastContinuityDispatchRef.current = Date.now();
          const resetRemaining = remaining.map((j) => ({ ...j, status: 'PENDING' as const }));
          const completedAll = jobsRef.current.filter((j) => j.status === 'COMPLETED');
          const completedIds = completedAll.map((j) => j.id);
          const completedFilenames = completedAll.map((j) => j.filename);
          if (!runSessionIdRef.current) {
            runSessionIdRef.current = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          }
          await extensionClient
            .sendCommand('START_QUEUE', {
              jobs: slimJobsForExtension(resetRemaining),
              completedIds,
              completedFilenames,
              clientId,
              queueState: 'RUNNING',
              runSessionId: runSessionIdRef.current,
              resumeOnly: true,
              reason: cooldownStalled ? 'cooldown_stalled' : pickingStalled ? 'picking_stalled' : reason,
            })
            .catch(() => {});
          api.startQueue({
            completedIds,
            completedFilenames,
            jobs: slimJobsForExtension(jobsRef.current),
          }).catch(() => {});
        } else {
          // While running current scene (or in cooldown), guarantee ALL future scenes remain synced to extension!
          const futureScenes = remaining.filter(
            (j) => j.id !== runner.currentJobId && j.filename !== runner.currentFilename
          );
          if (futureScenes.length > 0 && Number(runner.pendingCount || 0) < futureScenes.length) {
            extensionClient.appendQueueJobs(slimJobsForExtension(futureScenes)).catch(() => {});
          }
        }
      }
    } finally {
      continuityBusyRef.current = false;
    }
  }, [clientId, setUserQueueActive]);

  const ensureQueueContinuityRef = useRef(ensureQueueContinuity);
  useEffect(() => {
    ensureQueueContinuityRef.current = ensureQueueContinuity;
  }, [ensureQueueContinuity]);

  // Real-time Queue Continuity Watchdog (guarantees unlimited 1..1000+ scenes never get stuck!)
  useEffect(() => {
    if (queueState !== 'RUNNING') return;
    const watchdog = setInterval(() => {
      ensureQueueContinuity('interval');
    }, 2500);
    return () => clearInterval(watchdog);
  }, [queueState, ensureQueueContinuity]);

  const handleStartQueue = async () => {
    try {
      if (pendingAddSyncRef.current) {
        await pendingAddSyncRef.current.catch(() => {});
      }

      const sortedAll = sortJobsStrictAscending(jobsRef.current).map((j, idx) => ({
        ...j,
        order: idx + 1,
      }));

      if (sortedAll.length === 0) {
        showToast('Belum ada teks di antrean. Tambahkan teks terlebih dahulu.', 'error');
        return;
      }

      // Strictly preserve COMPLETED (green checkmark "Tersimpan") jobs — NEVER reset them back to PENDING!
      let cleanJobs: TTSJob[] = sortedAll.map((j) =>
        j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'CANCELLED'
          ? j
          : { ...j, status: 'PENDING' }
      );

      let unfinishedJobs = cleanJobs.filter(
        (j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING'
      );

      // If no PENDING/DRAFT/RETRYING remain, check if there are non-COMPLETED interrupted/failed jobs (FAILED/CANCELLED)
      if (unfinishedJobs.length === 0) {
        const hasRetryableNonCompleted = cleanJobs.some(
          (j) => j.status === 'CANCELLED' || j.status === 'FAILED'
        );
        if (hasRetryableNonCompleted) {
          cleanJobs = cleanJobs.map((j) =>
            j.status === 'CANCELLED' || j.status === 'FAILED'
              ? { ...j, status: 'PENDING' as const, retryCount: 0, error: undefined }
              : j
          );
          unfinishedJobs = cleanJobs.filter((j) => j.status === 'PENDING');
        }
      }

      const completedJobs = cleanJobs.filter((j) => j.status === 'COMPLETED');
      const completedIds = completedJobs.map((j) => j.id);
      const completedFilenames = completedJobs.map((j) => j.filename);

      if (unfinishedJobs.length === 0) {
        setUserQueueActive(false);
        setQueueState('IDLE');
        setCurrentJob(null);
        showToast(
          `Semua ${completedJobs.length} pekerjaan di antrean sudah berstatus sukses (COMPLETED) sehingga diabaikan. Tambahkan teks baru untuk memproses lagi.`,
          'info'
        );
        return;
      }

      const queueToRun = unfinishedJobs;

      setJobs(cleanJobs);
      jobsRef.current = cleanJobs;
      localHistory.saveJobs(cleanJobs);

      // Keep server order aligned before starting queue
      await api.reorderJobs(cleanJobs.map((j) => j.id)).catch(() => {});

      const newRunSessionId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      runSessionIdRef.current = newRunSessionId;
      lastContinuityDispatchRef.current = Date.now();
      setUserQueueActive(true);
      setQueueState('RUNNING');
      setCurrentJob(queueToRun[0] || null);

      // Broadcast ONLY unfinished jobs (plus completed exclusions) directly to extension bridge
      const extDispatch = await extensionClient
        .sendCommand(
          'START_QUEUE',
          {
            jobs: slimJobsForExtension(queueToRun),
            completedIds,
            completedFilenames,
            clientId,
            queueState: 'RUNNING',
            runSessionId: newRunSessionId,
          },
          6000
        )
        .catch((err) => ({ success: false, error: err?.message }));

      const res = await api.startQueue({
        completedIds,
        completedFilenames,
        jobs: slimJobsForExtension(cleanJobs),
      });
      const firstOrder = queueToRun[0].order;
      const lastOrder = queueToRun[queueToRun.length - 1].order;

      if (extDispatch && extDispatch.success === false && extDispatch.error) {
        showToast(extDispatch.error, 'info');
      } else if (!res.success && (!extDispatch || !extDispatch.success)) {
        showToast(res.message, 'info');
      } else if (completedJobs.length > 0) {
        showToast(
          `Melanjutkan ${queueToRun.length} pekerjaan belum selesai (#${firstOrder} s/d #${lastOrder}) • ${completedJobs.length} sudah sukses dilewati otomatis.`,
          'success'
        );
      } else {
        showToast(
          `Antrean pemrosesan TTS dimulai urut #${firstOrder} s/d #${lastOrder} (${queueToRun.length} pekerjaan).`,
          'success'
        );
      }
    } catch (err: any) {
      showToast(`Gagal memulai antrean: ${err.message}`, 'error');
    }
  };

  const handlePauseQueue = async () => {
    setUserQueueActive(false);
    extensionClient.sendCommand('PAUSE_QUEUE', { clientId }).catch(() => {});
    await api.pauseQueue().catch(() => {});
    setQueueState('PAUSED');
  };

  const handleResumeQueue = async () => {
    const pendingJobs = sortJobsStrictAscending(jobsRef.current).filter(isJobUnfinished);
    if (pendingJobs.length === 0) {
      showToast('Tidak ada pekerjaan tersisa untuk dilanjutkan.', 'info');
      return;
    }
    if (!runSessionIdRef.current) {
      runSessionIdRef.current = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }
    lastContinuityDispatchRef.current = Date.now();
    setUserQueueActive(true);
    setQueueState('RUNNING');
    await extensionClient
      .sendCommand('START_QUEUE', { jobs: slimJobsForExtension(pendingJobs), clientId, queueState: 'RUNNING', runSessionId: runSessionIdRef.current, resumeOnly: true }, 6000)
      .catch(() => {});
    await api.resumeQueue().catch(() => {});
  };

  const handleStopQueue = async () => {
    setUserQueueActive(false);
    extensionClient.sendCommand('STOP_QUEUE', { clientId }).catch(() => {});
    await api.stopQueue().catch(() => {});
    setQueueState('STOPPED');
    setCurrentJob(null);
  };

  // Handlers for Jobs (0ms instant optimistic insertion — automatically skips already-COMPLETED exact texts!)
  const handleAddJobs = async (
    items: Array<{ filename: string; text: string }>,
    options?: { allowDuplicate?: boolean }
  ): Promise<boolean> => {
    if (!items || items.length === 0) return false;
    const now = Date.now();
    const currentJobs = jobsRef.current;
    const existingNames = new Set(currentJobs.map((j) => j.filename.toLowerCase()));
    const completedTextSet = !options?.allowDuplicate
      ? new Set(
          currentJobs
            .filter((j) => j.status === 'COMPLETED')
            .map((j) => normalizeTextKey(j.text))
            .filter(Boolean)
        )
      : new Set<string>();
    let nextOrder = currentJobs.reduce((max, j) => Math.max(max, Number(j.order) || 0), 0);

    const itemsWithOrder: Array<{ filename: string; text: string; order: number }> = [];
    const optimisticJobs: TTSJob[] = [];
    const tempIdSet = new Set<string>();
    let skippedCompletedCount = 0;

    items.forEach((item, idx) => {
      const trimmedText = (item.text || '').trim();
      if (!trimmedText) return;

      if (!options?.allowDuplicate && completedTextSet.has(normalizeTextKey(trimmedText))) {
        skippedCompletedCount += 1;
        return;
      }

      nextOrder += 1;
      let base = (item.filename || '')
        .trim()
        .replace(/\.(wav|mp3)$/i, '')
        .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^[.\s_]+|[.\s]+$/g, '') || `audio_${nextOrder}`;

      if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(base)) {
        base = `${base}_audio`;
      }
      base = base.slice(0, 80).replace(/[.\s]+$/g, '') || `audio_${nextOrder}`;

      if (existingNames.has(base.toLowerCase())) {
        let counter = 1;
        while (existingNames.has(`${base}_${counter}`.toLowerCase())) {
          counter++;
        }
        base = `${base}_${counter}`;
      }
      existingNames.add(base.toLowerCase());

      const tempId = `opt_${now}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      tempIdSet.add(tempId);

      itemsWithOrder.push({
        filename: base,
        text: trimmedText,
        order: nextOrder,
      });

      optimisticJobs.push({
        id: tempId,
        order: nextOrder,
        filename: base,
        text: trimmedText,
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now + idx,
        updatedAt: now + idx,
        clientId,
      });
    });

    if (optimisticJobs.length === 0) {
      if (skippedCompletedCount > 0) {
        showToast(
          `${skippedCompletedCount} teks sudah berstatus sukses (COMPLETED) sehingga diabaikan otomatis.`,
          'info'
        );
        return true;
      }
      return false;
    }

    // Immediately show in UI & persist locally with 0ms delay
    setJobs((prev) => {
      const next = [...prev, ...optimisticJobs];
      jobsRef.current = next;
      localHistory.saveJobs(next);
      return next;
    });

    // If queue is already actively running, immediately push the newly added scenes to the extension queue!
    if (userQueueActiveRef.current || queueStateRef.current === 'RUNNING') {
      extensionClient.appendQueueJobs(slimJobsForExtension(optimisticJobs)).catch(() => {});
    }

    if (skippedCompletedCount > 0) {
      showToast(
        `${optimisticJobs.length} teks baru ditambahkan (${skippedCompletedCount} teks yang sudah sukses dilewati otomatis).`,
        'success'
      );
    } else {
      showToast(`${optimisticJobs.length} teks langsung ditambahkan ke antrean.`, 'success');
    }

    // Sync to backend in background & replace temp IDs without blocking UI or extra fetchJobs round-trip
    const prevSync = pendingAddSyncRef.current || Promise.resolve();
    const syncTask = prevSync
      .catch(() => {})
      .then(async () => {
        const res = await api.createJobs(itemsWithOrder);
        if (res.success && Array.isArray(res.jobs) && res.jobs.length > 0) {
          setJobs((prev) => {
            const tempStatusByFilename = new Map<string, TTSJob>();
            prev.forEach((j) => {
              if (tempIdSet.has(j.id)) tempStatusByFilename.set(j.filename.toLowerCase(), j);
            });
            const serverIds = new Set(res.jobs.map((sj) => sj.id));
            const withoutTemp = prev.filter((j) => !tempIdSet.has(j.id) && !serverIds.has(j.id));
            const mergedServerJobs = res.jobs.map((sj) => {
              const prevTemp = tempStatusByFilename.get(sj.filename.toLowerCase());
              if (prevTemp && prevTemp.status === 'COMPLETED') {
                return { ...sj, status: 'COMPLETED' as const, wavSize: prevTemp.wavSize, duration: prevTemp.duration, completedAt: prevTemp.completedAt };
              }
              return sj;
            });
            const next = [...withoutTemp, ...mergedServerJobs].sort(
              (a, b) => (a.order - b.order) || (a.createdAt - b.createdAt)
            );
            jobsRef.current = next;
            localHistory.saveJobs(next);
            return next;
          });
        }
      })
      .catch((err) => {
        console.warn('[App] Background sync createJobs warning:', err);
      });

    pendingAddSyncRef.current = syncTask;
    return true;
  };

  const handleUpdateJob = async (id: string, updates: Partial<TTSJob>): Promise<boolean> => {
    const res = await api.updateJob(id, updates);
    if (res.success && res.job) {
      setJobs((prev) => {
        const next = prev.map((j) => (j.id === id ? res.job! : j));
        jobsRef.current = next;
        localHistory.saveJobs(next);
        return next;
      });
      return true;
    }
    return false;
  };

  const handleDeleteJob = async (id: string): Promise<boolean> => {
    try {
      await api.deleteJob(id);
    } catch {}
    const updated = localHistory.deleteJob(id);
    jobsRef.current = updated;
    setJobs(updated);
    showToast('Pekerjaan teks berhasil dihapus.', 'info');
    return true;
  };

  const handleClearAllJobs = async (): Promise<boolean> => {
    setUserQueueActive(false);
    extensionClient.sendCommand('STOP_QUEUE', { clientId }).catch(() => {});
    try {
      await api.clearAllJobs();
    } catch {}
    const empty = localHistory.clearAllJobs();
    jobsRef.current = empty;
    setJobs(empty);
    setQueueState('IDLE');
    setCurrentJob(null);
    showToast('Seluruh teks dan antrean PC ini berhasil dikosongkan.', 'success');
    return true;
  };

  const handleDuplicateJob = async (job: TTSJob): Promise<boolean> => {
    return await handleAddJobs(
      [
        {
          filename: `${job.filename}_copy`,
          text: job.text,
        },
      ],
      { allowDuplicate: true }
    );
  };

  const handleReorderJobs = async (jobIds: string[]): Promise<boolean> => {
    const res = await api.reorderJobs(jobIds);
    if (res.success) {
      localHistory.saveJobs(res.jobs);
      jobsRef.current = res.jobs;
      setJobs(res.jobs);
      return true;
    }
    return false;
  };

  const handleClearCompleted = async (): Promise<boolean> => {
    try {
      await api.clearCompletedJobs();
    } catch {}
    const filtered = localHistory.getJobs().filter((j) => j.status !== 'COMPLETED');
    localHistory.saveJobs(filtered);
    jobsRef.current = filtered;
    setJobs(filtered);
    showToast('Pekerjaan yang telah selesai berhasil dibersihkan.', 'info');
    return true;
  };

  const handleRetryJob = async (id: string): Promise<boolean> => {
    const res = await api.retryJob(id);
    if (res.success) {
      const updatedJobs = await api.fetchJobs();
      const merged = localHistory.mergeJobs(updatedJobs);
      jobsRef.current = merged;
      setJobs((prev) => (areJobsEqual(prev, merged) ? prev : merged));
      if (userQueueActiveRef.current || queueStateRef.current === 'RUNNING') {
        const retried = merged.filter((j) => j.id === id);
        if (retried.length > 0) {
          extensionClient.appendQueueJobs(slimJobsForExtension(retried)).catch(() => {});
        }
      }
      return true;
    }
    return false;
  };

  const handleRetryAllFailed = async (): Promise<boolean> => {
    const res = await api.retryAllFailed();
    if (res.success) {
      const updatedJobs = await api.fetchJobs();
      const merged = localHistory.mergeJobs(updatedJobs);
      jobsRef.current = merged;
      setJobs((prev) => (areJobsEqual(prev, merged) ? prev : merged));
      if (userQueueActiveRef.current || queueStateRef.current === 'RUNNING') {
        const pending = merged.filter(isJobUnfinished);
        if (pending.length > 0) {
          extensionClient.appendQueueJobs(slimJobsForExtension(pending)).catch(() => {});
        }
      }
      return true;
    }
    return false;
  };

  // Audio Handlers
  const handleDeleteAudio = async (baseName: string): Promise<boolean> => {
    clearAudioSuppressionUntilRef.current = Date.now() + 2000;
    const cleanTarget = baseName.trim().toLowerCase();
    for (const key of Array.from(extensionUnduhanSignaturesRef.current.keys())) {
      if (key.replace(/\.(wav|mp3)$/i, '') === cleanTarget) {
        extensionUnduhanSignaturesRef.current.delete(key);
      }
    }

    await Promise.all([
      api.deleteAudio(baseName).catch(() => {}),
      deleteAudioBlob(clientId, baseName).catch(() => {}),
      folderSyncService.deleteAudioFile(baseName).catch(() => {}),
      extensionClient.deleteExtensionWav(baseName).catch(() => {}),
    ]);
    const updated = localHistory.deleteAudio(baseName);
    setAudioItems(updated);
    showToast(`File audio "${baseName}" berhasil dihapus permanen.`, 'info');
    return true;
  };

  const handleClearAllAudio = async (): Promise<boolean> => {
    clearAudioSuppressionUntilRef.current = Date.now() + 4500;
    processedPendingIdsRef.current.clear();
    extensionUnduhanSignaturesRef.current.clear();

    await Promise.all([
      api.clearAllAudio().catch(() => {}),
      clearAllAudioBlobs().catch(() => {}),
      folderSyncService.clearTemporaryWavFiles().catch(() => {}),
      extensionClient.clearAllExtensionWavs().catch(() => {}),
    ]);

    const empty = localHistory.clearAllAudio();
    setAudioItems(empty);
    showToast('Seluruh file audio WAV/MP3 di folder unduhan, ekstensi, & website berhasil dihapus permanen.', 'success');
    return true;
  };

  const handleRenameAudio = async (oldBase: string, newBase: string): Promise<boolean> => {
    const res = await api.renameAudio(oldBase, newBase);
    if (res.success) {
      const srvItems = await api.fetchAudioLibrary().catch(() => []);
      const merged = localHistory.mergeAudioItems(srvItems);
      setAudioItems((prev) => (areAudioItemsEqual(prev, merged) ? prev : merged));
      showToast(`Audio "${oldBase}" berhasil diubah menjadi "${res.newBase || newBase}".`, 'success');
      return true;
    }
    return false;
  };

  // Settings Handlers
  const handleSaveSettings = async (newSettings: Partial<AppSettings>): Promise<boolean> => {
    try {
      const updated = await api.updateSettings(newSettings);
      setSettings(updated);
      localHistory.saveLocalSettings(updated);
      showToast('Pengaturan berhasil disimpan secara lokal untuk PC ini.', 'success');
      return true;
    } catch {
      return false;
    }
  };

  // Logs Handlers
  const handleClearLogs = async (): Promise<boolean> => {
    const res = await api.clearLogs();
    if (res.success) {
      setLogs([]);
      localHistory.saveLogs([]);
      return true;
    }
    return false;
  };

  // Extension connect trigger
  const handleConnectExtension = async () => {
    try {
      await extensionClient.connectHandshake();
      const st = await api.getQueueStatus();
      setExtensionStatus(st.extensionStatus);
      showToast(`Ekstensi Chrome berhasil disambungkan ke workspace ${clientName}`, 'success');
    } catch (e: any) {
      showToast(`Koneksi ekstensi: ${e.message}`, 'error');
    }
  };

  const pendingCount = jobs.filter((j) => j.status === 'PENDING' || j.status === 'DRAFT').length;
  const failedCount = jobs.filter((j) => j.status === 'FAILED').length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar (Cleaned up, uncluttered) */}
      <Navbar
        isMenuOpen={isMenuOpen}
        onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
        mockMode={settings.mockMode}
      />

      {/* Main Layout with Dynamic Capsule Navigation */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Floating Capsule Menu (Top-Left on Desktop, Bottom Capsule on Android) */}
        <CapsuleMenu
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          pendingCount={pendingCount}
          failedCount={failedCount}
          audioCount={audioItems.length}
          isMenuOpen={isMenuOpen}
          onToggleMenu={() => setIsMenuOpen((prev) => !prev)}
          onOpenResetModal={() => setIsResetModalOpen(true)}
          onOpenWorkspace={() => setIsWorkspaceModalOpen(true)}
          clientName={clientName}
        />

        {/* Content View Container */}
        <main
          className={`flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-950/40 transition-all duration-300 pb-24 md:pb-6 ${
            isMenuOpen ? 'md:pl-24 lg:pl-24' : 'md:pl-6 lg:pl-6'
          }`}
        >
          <div className="mx-auto max-w-7xl">
            {currentTab === 'dashboard' && (
              <DashboardPage
                jobs={jobs}
                logs={logs}
                audioItems={audioItems}
                queueState={queueState}
                currentJob={currentJob}
                extensionStatus={extensionStatus}
                mockMode={settings.mockMode}
                clientName={clientName}
                clientId={clientId}
                onNavigate={setCurrentTab}
                onStartQueue={handleStartQueue}
                onPauseQueue={handlePauseQueue}
                onResumeQueue={handleResumeQueue}
                onStopQueue={handleStopQueue}
                onOpenAddModal={() => setIsAddModalOpen(true)}
                onOpenImportModal={(type) => setImportModalType(type)}
                onConnectExtension={handleConnectExtension}
                onOpenGuide={() => setIsGuideOpen(true)}
                onOpenWorkspace={() => setIsWorkspaceModalOpen(true)}
                onOpenResetModal={() => setIsResetModalOpen(true)}
                onRetryFailed={handleRetryAllFailed}
              />
            )}

            {currentTab === 'text_manager' && (
              <TextManagerPage
                jobs={jobs}
                onAddTextModal={() => setIsAddModalOpen(true)}
                onImportModal={(type) => setImportModalType(type)}
                onUpdateJob={handleUpdateJob}
                onDeleteJob={handleDeleteJob}
                onDuplicateJob={handleDuplicateJob}
                onReorder={handleReorderJobs}
                onClearAllJobs={handleClearAllJobs}
              />
            )}

            {currentTab === 'queue' && (
              <QueuePage
                jobs={jobs}
                queueState={queueState}
                currentJob={currentJob}
                onStartQueue={handleStartQueue}
                onPauseQueue={handlePauseQueue}
                onResumeQueue={handleResumeQueue}
                onStopQueue={handleStopQueue}
                onRetryJob={handleRetryJob}
                onClearCompleted={handleClearCompleted}
                onClearAllJobs={handleClearAllJobs}
                onRefresh={loadData}
              />
            )}

            {currentTab === 'audio_library' && (
              <AudioLibraryPage
                audioItems={audioItems}
                onDeleteAudio={handleDeleteAudio}
                onClearAllAudio={handleClearAllAudio}
                onRenameAudio={handleRenameAudio}
                onRefresh={loadData}
              />
            )}

            {currentTab === 'converter' && (
              <WavConverterPage
                onAudioLibraryUpdated={loadData}
                onNavigateToLibrary={() => setCurrentTab('audio_library')}
              />
            )}

            {currentTab === 'failed_jobs' && (
              <FailedJobsPage
                jobs={jobs}
                onRetryJob={handleRetryJob}
                onRetryAllFailed={handleRetryAllFailed}
                onDeleteJob={handleDeleteJob}
                onRefresh={loadData}
              />
            )}

            {currentTab === 'extension' && (
              <ExtensionPage
                extensionStatus={extensionStatus}
                onRefresh={loadData}
              />
            )}

            {currentTab === 'settings' && (
              <SettingsPage
                settings={settings}
                onSaveSettings={handleSaveSettings}
              />
            )}

            {currentTab === 'logs' && (
              <LogsPage
                logs={logs}
                onClearLogs={handleClearLogs}
              />
            )}
          </div>
        </main>
      </div>

      {/* Add Text Modal */}
      <AddTextModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddJobs={handleAddJobs}
        existingJobs={jobs}
      />

      {/* Import Modal */}
      {importModalType && (
        <ImportModal
          isOpen={!!importModalType}
          onClose={() => setImportModalType(null)}
          onImport={handleAddJobs}
          type={importModalType}
        />
      )}

      {/* Guide & Workflow Modal */}
      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onOpenAddText={() => setIsAddModalOpen(true)}
        onDownloadExtension={async () => {
          showToast('Menyiapkan paket unduhan ekstensi Chrome untuk PC ini...', 'info');
          const ok = await downloadExtensionZipClient();
          if (ok) {
            showToast('Ekstensi Chrome berhasil diunduh dengan konfigurasi PC lokal ini!', 'success');
          } else {
            showToast('Gagal mengunduh ekstensi.', 'error');
          }
        }}
      />

      {/* Workspace Management Modal */}
      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        jobs={jobs}
        audioItems={audioItems}
        settings={settings}
        logs={logs}
        onWorkspaceReset={handleWorkspaceReset}
        onWorkspaceReload={handleWorkspaceReload}
        onShowToast={showToast}
      />

      {/* Full System Reset Confirmation Modal */}
      <ResetConfirmModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirmReset={handleFullSystemReset}
        isResetting={isResetting}
        clientName={clientName}
        clientId={clientId}
        jobsCount={jobs.length}
        audioCount={audioItems.length}
      />

      {/* Floating Non-Blocking Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 text-xs font-semibold bg-slate-900/95 border-slate-700 text-slate-100">
          <span
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
              toast.type === 'success'
                ? 'bg-emerald-400 animate-pulse'
                : toast.type === 'error'
                ? 'bg-rose-500'
                : 'bg-cyan-400'
            }`}
          />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
