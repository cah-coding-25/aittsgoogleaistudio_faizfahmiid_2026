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
import { localFolderSync } from './services/localFolderSync';
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
  const showToast = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
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
      await localFolderSync.clearTemporaryWavFiles().catch(() => {});
      // 4. Clear all logs
      await api.clearLogs().catch(() => {});
      // 5. Disconnect extension bridge & reset status
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

  // Track latest queueState inside poll interval without re-subscribing effect
  const queueStateRef = useRef(queueState);
  useEffect(() => {
    queueStateRef.current = queueState;
  }, [queueState]);

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
        api.fetchSettings().catch(() => settings),
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
  }, [settings]);

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

          // If user has chosen a custom folder, write the completed WAV into that folder directly
          if (updated.status === 'COMPLETED' && localFolderSync.getState().isConnected) {
            getAudioBlob(currentClientId, updated.filename, 'wav').then(async (blob) => {
              if (blob) {
                const buf = await blob.arrayBuffer();
                localFolderSync.saveWavFileToConnectedFolder(updated.filename, buf);
              } else {
                fetch(`/api/audio/payload/${encodeURIComponent(updated.filename)}?clientId=${encodeURIComponent(currentClientId)}`)
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.success && d.wavBase64) {
                      const binary = atob(d.wavBase64);
                      const bytes = new Uint8Array(binary.length);
                      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                      localFolderSync.saveWavFileToConnectedFolder(updated.filename, bytes.buffer);
                    }
                  })
                  .catch(() => {});
              }
            }).catch(() => {});
          }
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

    // Auto-detect & handshake with extension automatically & continuously
    const tryConnectExtension = () => {
      extensionClient.checkPresence().then((ready) => {
        if (ready) {
          extensionClient.connectHandshake(window.location.origin).then(() => {
            const folderState = localFolderSync.getState();
            const subfolder = folderState.folderName || 'unduhan';
            extensionClient.syncDownloadSubfolder(subfolder).catch(() => {});
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
    });

    const extAutoTimer = setInterval(tryConnectExtension, 2500);

    return () => {
      sse.close();
      clearInterval(pollTimer);
      clearInterval(extAutoTimer);
      unsubExt();
    };
  }, [loadData]);



  // Self-heal: ensure any existing audio library item with WAV but missing/zero MP3 is automatically converted to MP3
  useEffect(() => {
    let cancelled = false;
    const healMissingMp3 = async () => {
      const missingMp3Items = audioItems.filter((it) => it.hasWav && (!it.hasMp3 || !it.mp3Size || it.mp3Size === 0));
      if (missingMp3Items.length === 0) return;

      for (const it of missingMp3Items) {
        if (cancelled) break;
        try {
          let wavBlob = await getAudioBlob(clientId, it.baseName, 'wav');

          // If not in IndexedDB, search in the connected local folder
          if (!wavBlob && localFolderSync.getState().isConnected) {
            const found = await localFolderSync.findAndReadWavFile(it.baseName);
            if (found) {
              wavBlob = found.file;
              await saveAudioBlob(clientId, it.baseName, 'wav', found.file).catch(() => {});
            }
          }

          if (wavBlob && wavBlob.size > 0) {
            const conv = await convertWavToMp3Client(wavBlob, settings.mp3Bitrate || 192);
            if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0 && !cancelled) {
              await saveAudioBlob(clientId, it.baseName, 'mp3', conv.mp3Blob);
              const updatedItem: AudioItem = {
                ...it,
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
    };

    healMissingMp3();
    return () => {
      cancelled = true;
    };
  }, [audioItems, clientId, settings.mp3Bitrate]);

  // Folder Sync Watcher: Automatically ingests WAV files downloaded by Chrome Extension into the user's folder
  useEffect(() => {
    const unsub = localFolderSync.subscribe((fState) => {
      if (fState.isConnected && !fState.isWatching) {
        localFolderSync.startWatching(async ({ buffer, filename }) => {
          const cleanBase = filename.replace(/\.(wav|mp3)$/i, '');
          console.log(`[Folder Sync] Berkas WAV terdeteksi di folder: ${filename}`);

          // Save WAV blob to IndexedDB
          const blob = new Blob([buffer], { type: 'audio/wav' });
          await saveAudioBlob(clientId, cleanBase, 'wav', blob).catch(() => {});

          // Auto convert to MP3
          const conv = await convertWavToMp3Client(blob, settings.mp3Bitrate || 192);
          if (conv.success && conv.mp3Blob) {
            await saveAudioBlob(clientId, cleanBase, 'mp3', conv.mp3Blob).catch(() => {});
          }

          // Add or update AudioItem in library
          const newItem: AudioItem = {
            filename: `${cleanBase}.mp3`,
            baseName: cleanBase,
            hasWav: true,
            hasMp3: conv.success,
            wavSize: buffer.byteLength,
            mp3Size: conv.mp3Size || 0,
            duration: conv.duration || 0,
            createdAt: Date.now(),
            wavPath: `storage/workspaces/${clientId}/wav/${cleanBase}.wav`,
            mp3Path: `storage/workspaces/${clientId}/mp3/${cleanBase}.mp3`,
            clientId,
          };
          const updated = localHistory.addOrUpdateAudioItem(newItem);
          setAudioItems(updated);

          // Notify extension bridge that audio was confirmed on website
          extensionClient.notifyJobAudioReceived(cleanBase, cleanBase);
        });
      } else if (!fState.isConnected && fState.isWatching) {
        localFolderSync.stopWatching();
      }
    });

    return () => {
      unsub();
      localFolderSync.stopWatching();
    };
  }, [clientId, settings.mp3Bitrate]);

  // Handlers for Queue
  const handleStartQueue = async () => {
    try {
      const res = await api.startQueue();
      if (!res.success) {
        showToast(res.message, 'error');
      } else {
        setQueueState('RUNNING');
        showToast('Antrean pemrosesan TTS berhasil dimulai', 'success');
      }
    } catch (err: any) {
      showToast(`Gagal memulai antrean: ${err.message}`, 'error');
    }
  };

  const handlePauseQueue = async () => {
    await api.pauseQueue();
    setQueueState('PAUSED');
  };

  const handleResumeQueue = async () => {
    await api.resumeQueue();
    setQueueState('RUNNING');
  };

  const handleStopQueue = async () => {
    await api.stopQueue();
    setQueueState('STOPPED');
    setCurrentJob(null);
  };

  // Handlers for Jobs
  const handleAddJobs = async (items: Array<{ filename: string; text: string }>): Promise<boolean> => {
    const res = await api.createJobs(items);
    if (res.success) {
      const allJobs = await api.fetchJobs();
      setJobs((prev) => {
        const merged = localHistory.mergeJobs(allJobs);
        return areJobsEqual(prev, merged) ? prev : merged;
      });
      showToast(`${items.length} teks berhasil ditambahkan ke antrean PC ini.`, 'info');
      return true;
    }
    return false;
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
    try {
      await api.clearAllJobs();
    } catch {}
    const empty = localHistory.clearAllJobs();
    setJobs(empty);
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
      const items = await api.fetchAudioLibrary();
      setAudioItems((prev) => {
        const merged = localHistory.mergeAudioItems(items);
        return areAudioItemsEqual(prev, merged) ? prev : merged;
      });
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
          className={`flex-1 w-full max-w-full overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-6 bg-slate-950/40 pb-28 md:pb-8 ${
            isMenuOpen ? 'md:pl-20 lg:pl-22' : 'md:pl-6'
          }`}
        >
          <div className="mx-auto max-w-7xl w-full min-w-0">
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
