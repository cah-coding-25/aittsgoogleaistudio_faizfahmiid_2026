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
import { clearAllAudioBlobs, deleteAudioBlob, saveAudioBlob, getAudioBlob } from './services/localAudioStorage';
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
  const [queueState, setQueueState] = useState<QueueState>('IDLE');
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

  // Full System Restart & Purge of Extensions and Temporary Storage
  const handleFullSystemReset = async () => {
    setIsResetting(true);
    try {
      // 1. Stop active queue
      await api.stopQueue().catch(() => {});
      // 2. Clear all queue jobs on server
      await api.clearAllJobs().catch(() => {});
      // 3. Clear all temporary audio files on server and IndexedDB for this client
      await api.clearAllAudio().catch(() => {});
      await clearAllAudioBlobs(clientId).catch(() => {});
      // 3b. Clear temporary WAV audio files in local connected folder (leaves folder & extension safe)
      await folderSyncService.clearTemporaryWavFiles().catch(() => {});
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
      localHistory.clearAll();
      const newWsId = resetWorkspace();
      setClientId(newWsId);
      setClientName(getClientName());
      // 7. Reset all active React states
      setJobs([]);
      setAudioItems([]);
      setLogs([]);
      setQueueState('IDLE');
      setCurrentJob(null);

      setIsResetModalOpen(false);
      showToast('Seluruh koneksi ekstensi dan penyimpanan sementara berhasil di-restart!', 'success');
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

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const pendingAddSyncRef = useRef<Promise<void> | null>(null);

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

      setJobs((prev) => {
        const merged = localHistory.mergeJobs(jobsData);
        return areJobsEqual(prev, merged) ? prev : merged;
      });

      setAudioItems((prev) => {
        const merged = localHistory.mergeAudioItems(audioData);
        return areAudioItemsEqual(prev, merged) ? prev : merged;
      });

      if (queueData) {
        setQueueState((prev) => (prev === queueData.state ? prev : queueData.state));
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
            return areJobsEqual(prev, merged) ? prev : merged;
          });
        }
        if (data.queueState) setQueueState((prev) => (prev === data.queueState ? prev : data.queueState));
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
            next = [...prev];
            next[idx] = updated;
          } else {
            next = [...prev, updated];
          }
          if (areJobsEqual(prev, next)) return prev;
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

        setQueueState((prev) => (prev === data.state ? prev : data.state));
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
        setQueueState((prev) => (prev === q.state ? prev : q.state));
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
              return areJobsEqual(prev, merged) ? prev : merged;
            });
          }
        }).catch(() => {});
      }
    }, 6000);

    // Track ingested pending WAV IDs & extension unduhan signatures to avoid duplicate writes
    const processedPendingIds = new Set<string>();
    const extensionUnduhanSignatures = new Map<string, string>();
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
      if (payload.pendingId && processedPendingIds.has(payload.pendingId)) return;
      if (payload.pendingId) processedPendingIds.add(payload.pendingId);

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
          extensionUnduhanSignatures.set(payload.filename.toLowerCase(), `${payload.size}::${payload.lastModified}`);
        }

        // Sync matching job status to COMPLETED in browser state & localStorage immediately
        setJobs((prev) => {
          const next = prev.map((j) =>
            j.id === payload.jobId || j.filename === cleanBase
              ? { ...j, status: 'COMPLETED' as const, wavSize: wavBlob.size, duration: updatedItem.duration, completedAt: Date.now(), error: undefined }
              : j
          );
          if (!areJobsEqual(prev, next)) {
            localHistory.saveJobs(next);
            return next;
          }
          return prev;
        });

        extensionClient.notifyJobAudioReceived(payload.jobId || cleanBase, cleanBase).catch(() => {});

        if (payload.pendingId) {
          extensionClient.ackExtensionWavs([payload.pendingId]).catch(() => {});
        }
      } catch (err) {
        console.warn('[App] Gagal memproses WAV dari ekstensi:', err);
      }
    };

    const syncPendingWavsFromExtension = async () => {
      const pending = await extensionClient.getPendingExtensionWavs();
      for (const item of pending) {
        await ingestExtensionWav(item);
      }

      // Periodically scan Extension's own linked `unduhan` folder (catches manual File Manager additions too)
      const now = Date.now();
      if (now - lastExtensionScanAt >= 7500) {
        lastExtensionScanAt = now;
        const knownObj: Record<string, string> = {};
        extensionUnduhanSignatures.forEach((sig, key) => {
          knownObj[key] = sig;
        });
        const scanned = await extensionClient.scanExtensionUnduhanFolder(knownObj);
        if (scanned.success && scanned.folderLinked && scanned.items.length > 0) {
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
      if (event.type === 'JOB_COMPLETED') {
        const completedId = event.payload?.id;
        const completedFilename = event.payload?.filename;
        if (completedId || completedFilename) {
          setJobs((prev) => {
            const next = prev.map((j) =>
              j.id === completedId || j.filename === completedFilename
                ? { ...j, status: 'COMPLETED' as const, completedAt: Date.now(), error: undefined }
                : j
            );
            localHistory.saveJobs(next);
            const hasMore = next.some((j) =>
              ['PENDING', 'DRAFT', 'RETRYING', 'PREPARING', 'SENDING_TEXT', 'GENERATING', 'WAITING_AUDIO', 'DOWNLOADING', 'UPLOADING'].includes(j.status)
            );
            if (!hasMore) {
              setQueueState('IDLE');
              setCurrentJob(null);
            }
            return next;
          });
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
  }, [loadData]);



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

    folderSyncService.startWatching(async ({ baseName, file, duration, format }) => {
      try {
        const activeClientId = getClientId();
        const storageFormat = format === 'mp3' ? 'mp3' : 'wav';
        await saveAudioBlob(activeClientId, baseName, storageFormat, file);

        const existing = localHistory.getAudioItems().find((it) => it.baseName === baseName);
        const isDirectMp3 = storageFormat === 'mp3';
        const newAudioItem: AudioItem = {
          filename: isDirectMp3 || existing?.hasMp3 ? `${baseName}.mp3` : `${baseName}.wav`,
          baseName,
          hasWav: !isDirectMp3 || existing?.hasWav || false,
          hasMp3: isDirectMp3 || existing?.hasMp3 || false,
          wavSize: isDirectMp3 ? (existing?.wavSize || 0) : file.size,
          mp3Size: isDirectMp3 ? file.size : (existing?.mp3Size || 0),
          duration: duration || existing?.duration || 0,
          createdAt: file.lastModified || existing?.createdAt || Date.now(),
          wavPath: `/api/audio/wav/${encodeURIComponent(baseName)}`,
          mp3Path: `/api/audio/mp3/${encodeURIComponent(baseName)}`,
          clientId: activeClientId,
        };

        const updatedAudio = localHistory.addOrUpdateAudioItem(newAudioItem);
        setAudioItems(updatedAudio);

        setJobs((prev) => {
          const next = prev.map((j) =>
            j.filename === baseName && j.status !== 'COMPLETED'
              ? { ...j, status: 'COMPLETED' as const, wavSize: newAudioItem.wavSize, duration: newAudioItem.duration, completedAt: Date.now(), error: undefined }
              : j
          );
          if (!areJobsEqual(prev, next)) {
            localHistory.saveJobs(next);
            return next;
          }
          return prev;
        });
      } catch (err) {
        console.warn('[App] Gagal mengunggah otomatis Audio Adegan dari folder unduhan:', err);
      }
    });

    return () => {
      folderSyncService.stopWatching();
    };
  }, [isFolderSyncConnected, clientId]);

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
            let wavBlob = await getAudioBlob(clientId, it.baseName, 'wav');

            // If not in IndexedDB, search in the connected local folder
            if (!wavBlob && folderSyncService.getState().isConnected) {
              const found = await folderSyncService.findAndReadWavFile(it.baseName);
              if (found) {
                wavBlob = found.file;
                await saveAudioBlob(clientId, it.baseName, 'wav', found.file).catch(() => {});
              }
            }

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

  const handleStartQueue = async () => {
    try {
      if (pendingAddSyncRef.current) {
        await pendingAddSyncRef.current.catch(() => {});
      }

      const sortedAll = sortJobsStrictAscending(jobsRef.current).map((j, idx) => ({
        ...j,
        order: idx + 1,
      }));

      // Reset any stale interrupted non-final jobs back to PENDING so #1 ALWAYS executes first
      const cleanJobs: TTSJob[] = sortedAll.map((j) =>
        j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'CANCELLED'
          ? j
          : { ...j, status: 'PENDING' }
      );

      const unfinishedJobs = cleanJobs.filter(
        (j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING'
      );
      const queueToRun =
        unfinishedJobs.length > 0
          ? unfinishedJobs
          : cleanJobs.map((j) => ({ ...j, status: 'PENDING' as const }));

      if (queueToRun.length === 0) {
        showToast('Belum ada teks di antrean. Tambahkan teks terlebih dahulu.', 'error');
        return;
      }

      setJobs(cleanJobs);
      jobsRef.current = cleanJobs;
      localHistory.saveJobs(cleanJobs);

      // Keep server order aligned before starting queue
      await api.reorderJobs(cleanJobs.map((j) => j.id)).catch(() => {});

      // Broadcast sorted #1 -> last (unlimited) directly to extension bridge
      extensionClient.sendCommand('START_QUEUE', { jobs: queueToRun, clientId, queueState: 'RUNNING' }).catch(() => {});
      setQueueState('RUNNING');

      const res = await api.startQueue();
      if (!res.success) {
        showToast(res.message, 'info');
      } else {
        showToast(`Antrean pemrosesan TTS dimulai urut #1 s/d #${queueToRun.length} (${queueToRun.length} pekerjaan).`, 'success');
      }
    } catch (err: any) {
      showToast(`Gagal memulai antrean: ${err.message}`, 'error');
    }
  };

  const handlePauseQueue = async () => {
    extensionClient.sendCommand('PAUSE_QUEUE', { clientId }).catch(() => {});
    await api.pauseQueue().catch(() => {});
    setQueueState('PAUSED');
  };

  const handleResumeQueue = async () => {
    const pendingJobs = sortJobsStrictAscending(jobsRef.current).filter(
      (j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING'
    );
    extensionClient.sendCommand('START_QUEUE', { jobs: pendingJobs, clientId, queueState: 'RUNNING' }).catch(() => {});
    await api.resumeQueue().catch(() => {});
    setQueueState('RUNNING');
  };

  const handleStopQueue = async () => {
    extensionClient.sendCommand('STOP_QUEUE', { clientId }).catch(() => {});
    await api.stopQueue().catch(() => {});
    setQueueState('STOPPED');
    setCurrentJob(null);
  };

  // Handlers for Jobs (0ms instant optimistic insertion — no refresh or network wait required!)
  const handleAddJobs = async (items: Array<{ filename: string; text: string }>): Promise<boolean> => {
    if (!items || items.length === 0) return false;
    const now = Date.now();
    const currentJobs = jobsRef.current;
    const existingNames = new Set(currentJobs.map((j) => j.filename.toLowerCase()));
    let nextOrder = currentJobs.reduce((max, j) => Math.max(max, Number(j.order) || 0), 0);

    const itemsWithOrder: Array<{ filename: string; text: string; order: number }> = [];
    const optimisticJobs: TTSJob[] = [];
    const tempIdSet = new Set<string>();

    items.forEach((item, idx) => {
      const trimmedText = (item.text || '').trim();
      if (!trimmedText) return;

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

    if (optimisticJobs.length === 0) return false;

    // Immediately show in UI & persist locally with 0ms delay
    setJobs((prev) => {
      const next = [...prev, ...optimisticJobs];
      jobsRef.current = next;
      localHistory.saveJobs(next);
      return next;
    });

    showToast(`${optimisticJobs.length} teks langsung ditambahkan ke antrean.`, 'success');

    // Sync to backend in background & replace temp IDs without blocking UI or extra fetchJobs round-trip
    const prevSync = pendingAddSyncRef.current || Promise.resolve();
    const syncTask = prevSync
      .catch(() => {})
      .then(async () => {
        const res = await api.createJobs(itemsWithOrder);
        if (res.success && Array.isArray(res.jobs) && res.jobs.length > 0) {
          setJobs((prev) => {
            const serverIds = new Set(res.jobs.map((sj) => sj.id));
            const withoutTemp = prev.filter((j) => !tempIdSet.has(j.id) && !serverIds.has(j.id));
            const next = [...withoutTemp, ...res.jobs].sort(
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
    setJobs(updated);
    showToast('Pekerjaan teks berhasil dihapus.', 'info');
    return true;
  };

  const handleClearAllJobs = async (): Promise<boolean> => {
    extensionClient.sendCommand('STOP_QUEUE', { clientId }).catch(() => {});
    try {
      await api.clearAllJobs();
    } catch {}
    const empty = localHistory.clearAllJobs();
    setJobs(empty);
    setQueueState('IDLE');
    setCurrentJob(null);
    showToast('Seluruh teks dan antrean PC ini berhasil dikosongkan.', 'success');
    return true;
  };

  const handleDuplicateJob = async (job: TTSJob): Promise<boolean> => {
    return await handleAddJobs([
      {
        filename: `${job.filename}_copy`,
        text: job.text,
      },
    ]);
  };

  const handleReorderJobs = async (jobIds: string[]): Promise<boolean> => {
    const res = await api.reorderJobs(jobIds);
    if (res.success) {
      localHistory.saveJobs(res.jobs);
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
    setJobs(filtered);
    showToast('Pekerjaan yang telah selesai berhasil dibersihkan.', 'info');
    return true;
  };

  const handleRetryJob = async (id: string): Promise<boolean> => {
    const res = await api.retryJob(id);
    if (res.success) {
      const updatedJobs = await api.fetchJobs();
      setJobs((prev) => {
        const merged = localHistory.mergeJobs(updatedJobs);
        return areJobsEqual(prev, merged) ? prev : merged;
      });
      return true;
    }
    return false;
  };

  const handleRetryAllFailed = async (): Promise<boolean> => {
    const res = await api.retryAllFailed();
    if (res.success) {
      const updatedJobs = await api.fetchJobs();
      setJobs((prev) => {
        const merged = localHistory.mergeJobs(updatedJobs);
        return areJobsEqual(prev, merged) ? prev : merged;
      });
      return true;
    }
    return false;
  };

  // Audio Handlers
  const handleDeleteAudio = async (baseName: string): Promise<boolean> => {
    try {
      await api.deleteAudio(baseName);
    } catch {}
    deleteAudioBlob(clientId, baseName).catch(() => {});
    const updated = localHistory.deleteAudio(baseName);
    setAudioItems(updated);
    showToast(`File audio "${baseName}" berhasil dihapus.`, 'info');
    return true;
  };

  const handleClearAllAudio = async (): Promise<boolean> => {
    try {
      await api.clearAllAudio();
    } catch {}
    clearAllAudioBlobs(clientId).catch(() => {});
    const empty = localHistory.clearAllAudio();
    setAudioItems(empty);
    showToast('Seluruh file audio di Audio Library PC ini berhasil dihapus.', 'success');
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
