import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Music,
  Play,
  Pause,
  Download,
  Trash2,
  Edit2,
  Volume2,
  VolumeX,
  Search,
  FileAudio,
  Sparkles,
  Loader2,
  FolderOpen,
  AlertCircle,
  RefreshCw,
  FolderSync,
  Sliders,
  Unplug,
  Zap,
  Hand,
  Archive,
} from 'lucide-react';
import JSZip from 'jszip';
import { AudioItem } from '../types';
import { getClientId } from '../services/clientWorkspace';
import { triggerSafeAudioDownload, getAudioBlob, saveAudioBlob } from '../services/localAudioStorage';
import { localHistory } from '../services/localHistory';
import { convertWavToMp3Client } from '../services/clientAudioConverter';
import { localFolderSync } from '../services/localFolderSync';

interface AudioLibraryPageProps {
  audioItems: AudioItem[];
  onDeleteAudio: (baseName: string) => Promise<boolean>;
  onClearAllAudio: () => Promise<boolean>;
  onRenameAudio: (oldBase: string, newBase: string) => Promise<boolean>;
  onRefresh: () => void;
}

export const AudioLibraryPage: React.FC<AudioLibraryPageProps> = ({
  audioItems,
  onDeleteAudio,
  onClearAllAudio,
  onRenameAudio,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState<'all' | 'mp3' | 'wav'>('all');

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingItem, setPlayingItem] = useState<{ baseName: string; format: 'mp3' | 'wav' } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  // Rename modal state
  const [renamingItem, setRenamingItem] = useState<AudioItem | null>(null);
  const [newBaseName, setNewBaseName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete modal state
  const [deletingItem, setDeletingItem] = useState<AudioItem | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Download state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Folder Import & Batch Convert state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [convertingSingle, setConvertingSingle] = useState<string | null>(null);
  const [isZippingWav, setIsZippingWav] = useState<boolean>(false);
  const [isZippingMp3, setIsZippingMp3] = useState<boolean>(false);

  // Folder Watcher state
  const [connectedFolderName, setConnectedFolderName] = useState<string | null>(null);
  const [isFolderConnected, setIsFolderConnected] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [lastScannedTime, setLastScannedTime] = useState<number | null>(null);

  // Mode Konversi ke MP3: Otomatis vs Manual
  const [autoConvertMode, setAutoConvertMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ai_tts_audio_library_auto_convert');
      return saved !== 'false'; // default is true (Otomatis)
    } catch {
      return true;
    }
  });

  // Track processed WAV files to avoid repetitive conversion
  const processedWavCache = useRef<Set<string>>(new Set());

  // Sync folder connection state
  useEffect(() => {
    const unsub = localFolderSync.subscribe((state) => {
      setConnectedFolderName(state.folderName);
      setIsFolderConnected(state.isConnected);
    });
    const curr = localFolderSync.getState();
    setConnectedFolderName(curr.folderName);
    setIsFolderConnected(curr.isConnected);
    return unsub;
  }, []);

  const handleToggleAutoConvert = (enabled: boolean) => {
    setAutoConvertMode(enabled);
    try {
      localStorage.setItem('ai_tts_audio_library_auto_convert', String(enabled));
    } catch {}
    setImportFeedback({
      text: enabled
        ? 'Mode Konversi: Otomatis (Auto). Setiap file .wav baru akan langsung diubah ke MP3.'
        : 'Mode Konversi: Manual. File .wav baru akan diimpor dan siap diubah ke MP3 sesuai keinginan Anda.',
      type: 'info',
    });
  };

  // Core function to scan directory handle for .wav files
  const scanFolderForWavFiles = useCallback(async (isManualTrigger = false) => {
    const dirHandle = localFolderSync.getDirectoryHandle();
    if (!dirHandle) return;

    if (isManualTrigger) setIsScanning(true);
    const clientId = getClientId();
    let newWavCount = 0;
    let convertedCount = 0;

    try {
      const scanDir = async (dir: FileSystemDirectoryHandle, depth = 0) => {
        if (depth > 2) return;
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            const lowerName = name.toLowerCase();

            // Aturan Kunci: HANYA proses file .wav! Selain file .wav ya di biarkan!
            if (!lowerName.endsWith('.wav')) {
              continue; // Abaikan file selain .wav (.txt, .mp3, dll dibiarkan tanpa disentuh)
            }

            try {
              const file: File = await handle.getFile();
              if (file.size < 500) continue; // Skip partial/empty file

              const cleanBase = name.replace(/\.wav$/i, '');
              const cacheKey = `${name}:${file.size}:${file.lastModified}`;

              // Check if already processed in this session or in existing items
              const existingItem = audioItems.find((it) => it.baseName === cleanBase);
              const alreadyHasMp3 = Boolean(existingItem && existingItem.hasMp3 && (existingItem.mp3Size || 0) > 0);

              if (processedWavCache.current.has(cacheKey) && alreadyHasMp3) {
                continue;
              }

              // Verify RIFF WAV Header
              const buffer = await file.arrayBuffer();
              const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
              if (header !== 'RIFF') {
                continue; // Not a genuine WAV audio file
              }

              processedWavCache.current.add(cacheKey);

              // 1. Ingest WAV into IndexedDB
              await saveAudioBlob(clientId, cleanBase, 'wav', file);

              let itemUpdated: AudioItem = {
                filename: `${cleanBase}.wav`,
                baseName: cleanBase,
                hasWav: true,
                hasMp3: alreadyHasMp3,
                wavSize: file.size,
                mp3Size: existingItem?.mp3Size || 0,
                duration: existingItem?.duration || 0,
                createdAt: file.lastModified || Date.now(),
                wavPath: `/api/audio/wav/${encodeURIComponent(cleanBase)}`,
                mp3Path: `/api/audio/mp3/${encodeURIComponent(cleanBase)}`,
                clientId,
              };

              newWavCount++;

              // 2. Jika Mode Auto Convert aktif dan belum ada MP3, langsung rubah ke MP3!
              if (autoConvertMode && !alreadyHasMp3) {
                try {
                  const conv = await convertWavToMp3Client(file, 192);
                  if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
                    await saveAudioBlob(clientId, cleanBase, 'mp3', conv.mp3Blob);
                    itemUpdated = {
                      ...itemUpdated,
                      filename: `${cleanBase}.mp3`,
                      hasMp3: true,
                      mp3Size: conv.mp3Size,
                      duration: conv.duration || itemUpdated.duration || 0,
                    };
                    convertedCount++;
                  }
                } catch (convErr) {
                  console.warn('Auto convert error for:', name, convErr);
                }
              }

              localHistory.addOrUpdateAudioItem(itemUpdated);
            } catch (fileErr) {
              console.warn('Error reading file entry:', name, fileErr);
            }
          } else if (handle.kind === 'directory') {
            const lowerDir = name.toLowerCase();
            if (['unduhan', 'downloads', 'audio', 'tts', 'audio_studio', 'temp'].includes(lowerDir)) {
              await scanDir(handle, depth + 1);
            }
          }
        }
      };

      await scanDir(dirHandle);
      setLastScannedTime(Date.now());

      if (newWavCount > 0) {
        onRefresh();
        if (autoConvertMode && convertedCount > 0) {
          setImportFeedback({
            text: `🎵 Terdeteksi ${newWavCount} file WAV baru di folder! ${convertedCount} file telah otomatis diubah menjadi MP3.`,
            type: 'success',
          });
        } else {
          setImportFeedback({
            text: `🎵 Terdeteksi ${newWavCount} file WAV baru di folder. Siap dikonversi ke MP3.`,
            type: 'info',
          });
        }
      } else if (isManualTrigger) {
        setImportFeedback({
          text: `Folder "${dirHandle.name}" telah dipindai. Seluruh file WAV sudah mutakhir di Audio Library.`,
          type: 'info',
        });
      }
    } catch (scanErr) {
      console.warn('Folder scan error:', scanErr);
    } finally {
      if (isManualTrigger) setIsScanning(false);
    }
  }, [audioItems, autoConvertMode, onRefresh]);

  // Handle pick / connect folder for Audio Library (Tanpa auto-scan langsung, menunggu klik Pindai Folder)
  const handleConnectFolder = async () => {
    setIsImporting(true);
    setImportFeedback(null);
    try {
      const res = await localFolderSync.pickFolder();
      if (res.success && res.folderName) {
        setImportFeedback({
          text: `Folder "${res.folderName}" berhasil disambungkan! Klik tombol "🔍 Pindai Folder" untuk mulai memindai dan mengunggah berkas WAV ke Audio Library.`,
          type: 'success',
        });
      } else if (res.error) {
        setImportFeedback({ text: res.error, type: 'error' });
      }
    } catch (e: any) {
      setImportFeedback({ text: e.message || 'Gagal memilih folder.', type: 'error' });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDisconnectFolder = async () => {
    await localFolderSync.disconnectFolder();
    setImportFeedback({
      text: 'Sambungan folder pantau telah diputuskan.',
      type: 'info',
    });
  };

  // Convert Single WAV to MP3
  const handleConvertSingleToMp3 = async (baseName: string) => {
    setConvertingSingle(baseName);
    const clientId = getClientId();
    try {
      let wavBlob = await getAudioBlob(clientId, baseName, 'wav');
      if (!wavBlob) {
        throw new Error('Berkas WAV tidak ditemukan di penyimpanan lokal.');
      }

      const conv = await convertWavToMp3Client(wavBlob, 192);
      if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
        await saveAudioBlob(clientId, baseName, 'mp3', conv.mp3Blob);

        const currentItem = audioItems.find((it) => it.baseName === baseName);
        const updatedItem: AudioItem = {
          filename: `${baseName}.mp3`,
          baseName,
          hasWav: true,
          hasMp3: true,
          wavSize: currentItem?.wavSize || wavBlob.size,
          mp3Size: conv.mp3Size,
          duration: conv.duration || currentItem?.duration || 0,
          createdAt: currentItem?.createdAt || Date.now(),
          wavPath: `/api/audio/wav/${encodeURIComponent(baseName)}`,
          mp3Path: `/api/audio/mp3/${encodeURIComponent(baseName)}`,
          clientId,
        };
        localHistory.addOrUpdateAudioItem(updatedItem);
        onRefresh();
        setImportFeedback({
          text: `Sukses! Berkas ${baseName}.wav berhasil diubah ke MP3 (192 kbps).`,
          type: 'success',
        });
      } else {
        throw new Error(conv.error || 'Gagal konversi ke MP3.');
      }
    } catch (err: any) {
      console.error('Convert single error:', err);
      setImportFeedback({
        text: `Gagal mengonversi ${baseName}.wav: ${err.message || 'Error saat konversi'}`,
        type: 'error',
      });
    } finally {
      setConvertingSingle(null);
    }
  };

  // Convert ALL WAVs to MP3 one by one
  const handleConvertAllToMp3 = async () => {
    const targets = audioItems.filter((it) => it.hasWav && (!it.hasMp3 || !it.mp3Size || it.mp3Size === 0));
    if (targets.length === 0) {
      setImportFeedback({
        text: 'Semua berkas audio sudah berformat MP3.',
        type: 'info',
      });
      return;
    }

    setIsBatchConverting(true);
    setImportFeedback(null);
    const clientId = getClientId();
    let convertedSuccess = 0;

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      setBatchProgress({
        current: i + 1,
        total: targets.length,
        currentName: item.baseName,
      });

      try {
        let wavBlob = await getAudioBlob(clientId, item.baseName, 'wav');
        if (wavBlob) {
          const conv = await convertWavToMp3Client(wavBlob, 192);
          if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
            await saveAudioBlob(clientId, item.baseName, 'mp3', conv.mp3Blob);

            const updatedItem: AudioItem = {
              ...item,
              filename: `${item.baseName}.mp3`,
              hasMp3: true,
              mp3Size: conv.mp3Size,
              duration: conv.duration || item.duration || 0,
            };
            localHistory.addOrUpdateAudioItem(updatedItem);
            convertedSuccess++;
          }
        }
      } catch (err) {
        console.warn(`Error converting ${item.baseName}:`, err);
      }
    }

    setIsBatchConverting(false);
    setBatchProgress(null);
    onRefresh();

    setImportFeedback({
      text: `Selesai! Sebanyak ${convertedSuccess} berkas WAV berhasil dikonversi ke MP3. Sekarang seluruh file MP3 siap diputar dan diunduh.`,
      type: 'success',
    });
  };

  const handleDownloadFile = async (baseName: string, format: 'mp3' | 'wav') => {
    const targetExt = format.toLowerCase() as 'mp3' | 'wav';
    const targetFilename = `${baseName}.${targetExt}`;
    const clientId = getClientId();

    setDownloadingId(`${baseName}-${targetExt}`);
    setDownloadError(null);

    try {
      const res = await triggerSafeAudioDownload(baseName, targetExt, clientId);
      if (!res.success) {
        throw new Error(res.error || 'Gagal mengunduh');
      }
    } catch (err: any) {
      console.error('Download error:', err);
      setDownloadError(`Gagal unduh ${targetFilename}: ${err.message || 'File belum siap'}`);
      setTimeout(() => setDownloadError(null), 6000);
    } finally {
      setDownloadingId(null);
    }
  };

  // Download ALL WAV files in a ZIP archive
  const handleDownloadAllWavZip = async () => {
    const wavItems = audioItems.filter((it) => it.hasWav);
    if (wavItems.length === 0) {
      setImportFeedback({
        text: 'Belum ada berkas WAV yang tersedia di Audio Library untuk diunduh.',
        type: 'info',
      });
      return;
    }

    setIsZippingWav(true);
    const clientId = getClientId();
    try {
      const zip = new JSZip();
      let count = 0;

      for (const item of wavItems) {
        let blob = await getAudioBlob(clientId, item.baseName, 'wav');
        if (!blob) {
          try {
            const resp = await fetch(`/api/audio/wav/${encodeURIComponent(item.baseName)}?clientId=${encodeURIComponent(clientId)}`);
            if (resp.ok) {
              blob = await resp.blob();
            }
          } catch {}
        }

        if (blob && blob.size > 0) {
          zip.file(`${item.baseName}.wav`, blob);
          count++;
        }
      }

      if (count === 0) {
        window.location.href = `/api/audio/download-all-wav-zip?clientId=${encodeURIComponent(clientId)}`;
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Semua_WAV_AI_TTS_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setImportFeedback({
        text: `Berhasil mengemas ${count} file WAV ke dalam format ZIP! File ZIP sedang diunduh.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('ZIP WAV error:', err);
      window.location.href = `/api/audio/download-all-wav-zip?clientId=${encodeURIComponent(clientId)}`;
    } finally {
      setIsZippingWav(false);
    }
  };

  // Download ALL MP3 files in a ZIP archive
  const handleDownloadAllMp3Zip = async () => {
    const mp3Items = audioItems.filter((it) => (it.hasMp3 && it.mp3Size > 0) || it.hasWav);
    if (mp3Items.length === 0) {
      setImportFeedback({
        text: 'Belum ada berkas MP3 yang tersedia di Audio Library untuk diunduh.',
        type: 'info',
      });
      return;
    }

    setIsZippingMp3(true);
    const clientId = getClientId();
    try {
      const zip = new JSZip();
      let count = 0;

      for (const item of mp3Items) {
        let blob = await getAudioBlob(clientId, item.baseName, 'mp3');
        if (!blob && item.hasWav) {
          const wavBlob = await getAudioBlob(clientId, item.baseName, 'wav');
          if (wavBlob) {
            const conv = await convertWavToMp3Client(wavBlob, 192);
            if (conv.success && conv.mp3Blob) {
              blob = conv.mp3Blob;
              await saveAudioBlob(clientId, item.baseName, 'mp3', blob).catch(() => {});
            }
          }
        }

        if (!blob) {
          try {
            const resp = await fetch(`/api/audio/mp3/${encodeURIComponent(item.baseName)}?clientId=${encodeURIComponent(clientId)}`);
            if (resp.ok) {
              blob = await resp.blob();
            }
          } catch {}
        }

        if (blob && blob.size > 0) {
          zip.file(`${item.baseName}.mp3`, blob);
          count++;
        }
      }

      if (count === 0) {
        window.location.href = `/api/audio/download-all-zip?clientId=${encodeURIComponent(clientId)}`;
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Semua_MP3_AI_TTS_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setImportFeedback({
        text: `Berhasil mengemas ${count} file MP3 ke dalam format ZIP! File ZIP sedang diunduh.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('ZIP MP3 error:', err);
      window.location.href = `/api/audio/download-all-zip?clientId=${encodeURIComponent(clientId)}`;
    } finally {
      setIsZippingMp3(false);
    }
  };

  const handlePlayToggle = async (baseName: string, format: 'mp3' | 'wav') => {
    if (playingItem?.baseName === baseName && playingItem.format === format) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play();
        setIsPlaying(true);
      }
      return;
    }

    setPlayingItem({ baseName, format });
    setIsPlaying(true);

    if (audioRef.current) {
      const clientId = getClientId();
      let localBlob = await getAudioBlob(clientId, baseName, format);

      // Auto-convert on the fly if MP3 requested but not yet in storage
      if (!localBlob && format === 'mp3') {
        const wavBlob = await getAudioBlob(clientId, baseName, 'wav');
        if (wavBlob) {
          try {
            const conv = await convertWavToMp3Client(wavBlob, 192);
            if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
              localBlob = conv.mp3Blob;
              await saveAudioBlob(clientId, baseName, 'mp3', localBlob).catch(() => {});
              onRefresh();
            }
          } catch (e) {}
        }
      }

      if (localBlob) {
        const blobUrl = window.URL.createObjectURL(localBlob);
        audioRef.current.src = blobUrl;
      } else {
        audioRef.current.src = `/api/audio/stream/${format}/${encodeURIComponent(baseName)}?clientId=${encodeURIComponent(clientId)}`;
      }
      audioRef.current.volume = volume;
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
      setIsMuted(v === 0);
    }
  };

  const handleStartRename = (item: AudioItem) => {
    setRenamingItem(item);
    setNewBaseName(item.baseName);
    setRenameError(null);
  };

  const handleConfirmRename = async () => {
    if (!renamingItem || !newBaseName.trim()) return;
    const ok = await onRenameAudio(renamingItem.baseName, newBaseName.trim());
    if (ok) {
      setRenamingItem(null);
      onRefresh();
    } else {
      setRenameError('Gagal mengubah nama file audio.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    const ok = await onDeleteAudio(deletingItem.baseName);
    if (ok) {
      if (playingItem?.baseName === deletingItem.baseName) {
        audioRef.current?.pause();
        setPlayingItem(null);
        setIsPlaying(false);
      }
      setDeletingItem(null);
      onRefresh();
    }
  };

  const handleConfirmDeleteAll = async () => {
    const ok = await onClearAllAudio();
    if (ok) {
      audioRef.current?.pause();
      setPlayingItem(null);
      setIsPlaying(false);
      setIsDeletingAll(false);
      onRefresh();
    }
  };

  const formatSec = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Unconverted items count (items with WAV but missing MP3)
  const unconvertedItems = audioItems.filter((it) => it.hasWav && (!it.hasMp3 || !it.mp3Size || it.mp3Size === 0));

  // Filtered items
  const filtered = audioItems.filter((item) => {
    const matchesSearch = item.baseName.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (formatFilter === 'mp3') return item.hasMp3 && item.mp3Size > 0;
    if (formatFilter === 'wav') return item.hasWav;
    return true;
  });

  return (
    <div className="space-y-5">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Music className="h-5 w-5 text-indigo-400" />
            <span>Audio Library</span>
          </h2>
          <p className="text-xs text-slate-400">
            Pusat audio hasil otomatisasi Text-to-Speech: pemutar audio instan, konversi WAV ke MP3, dan unduh berkas.
          </p>
        </div>

        {/* Top Action Buttons: Ubah Semua ke MP3 & Download All WAV / MP3 ZIP */}
        <div className="flex flex-wrap items-center gap-2.5">
          {unconvertedItems.length > 0 && (
            <button
              onClick={handleConvertAllToMp3}
              disabled={isBatchConverting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-indigo-600 to-purple-600 hover:from-amber-400 hover:to-purple-500 text-white text-xs font-bold shadow-md shadow-indigo-600/30 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              title={`Konversi ${unconvertedItems.length} berkas WAV ke MP3 satu per satu`}
            >
              {isBatchConverting ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <Sparkles className="h-4 w-4 text-amber-200" />
              )}
              <span>
                {isBatchConverting
                  ? `Mengonversi (${batchProgress?.current || 1}/${batchProgress?.total || unconvertedItems.length})...`
                  : `⚡ Ubah Semua ke MP3 (${unconvertedItems.length})`}
              </span>
            </button>
          )}

          {/* Unduh Semua WAV (.zip) */}
          {audioItems.some((a) => a.hasWav) && (
            <button
              onClick={handleDownloadAllWavZip}
              disabled={isZippingWav}
              className="flex items-center gap-1.5 rounded-xl bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-500/40 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:text-white transition-all cursor-pointer disabled:opacity-50 shadow-sm"
              title="Unduh seluruh file WAV di Audio Library dalam 1 arsip ZIP"
            >
              {isZippingWav ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
              ) : (
                <Archive className="h-3.5 w-3.5 text-cyan-400" />
              )}
              <span>{isZippingWav ? 'Mengemas WAV...' : '📦 Unduh Semua WAV (.zip)'}</span>
            </button>
          )}

          {/* Unduh Semua MP3 (.zip) */}
          {audioItems.some((a) => (a.hasMp3 && a.mp3Size > 0) || a.hasWav) && (
            <button
              onClick={handleDownloadAllMp3Zip}
              disabled={isZippingMp3}
              className="flex items-center gap-1.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/40 px-3.5 py-2 text-xs font-semibold text-indigo-200 hover:text-white transition-all cursor-pointer disabled:opacity-50 shadow-sm"
              title="Unduh seluruh file MP3 di Audio Library dalam 1 arsip ZIP"
            >
              {isZippingMp3 ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300" />
              ) : (
                <Archive className="h-3.5 w-3.5 text-indigo-400" />
              )}
              <span>{isZippingMp3 ? 'Mengemas MP3...' : '📦 Unduh Semua MP3 (.zip)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ======================================================== */}
      {/* CARD UTAMA: FOLDER PANTAU AUDIO LIBRARY & SAKELAR KONVERSI */}
      {/* ======================================================== */}
      <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950/20 p-4 sm:p-5 shadow-xl relative overflow-hidden space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8] animate-pulse" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                <FolderSync className="h-4 w-4 text-indigo-400" />
                Folder Pantau Audio WAV di Komputer
              </h3>
              {isFolderConnected && (
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  🟢 TERHUBUNG (MEMANTAU REAL-TIME)
                </span>
              )}
            </div>

            <div className="text-sm font-bold text-white flex items-center gap-2 pt-0.5">
              <span>Folder Aktif:</span>
              {isFolderConnected ? (
                <span className="font-mono text-cyan-300 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800 flex items-center gap-1.5">
                  📁 {connectedFolderName}
                </span>
              ) : (
                <span className="text-slate-400 font-normal italic text-xs">
                  (Belum ada folder yang dipilih)
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons: Sambungkan / Pindai / Putuskan */}
          <div className="flex items-center gap-2 flex-wrap">
            {isFolderConnected ? (
              <>
                <button
                  onClick={() => scanFolderForWavFiles(true)}
                  disabled={isScanning}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-extrabold shadow-lg shadow-cyan-600/30 transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                  title="Pindai folder sekarang untuk mengunggah file WAV baru dan mengonversi ke MP3"
                >
                  <RefreshCw className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>{isScanning ? 'Memindai Folder...' : '🔍 Pindai Folder (Unggah WAV Baru)'}</span>
                </button>

                <button
                  onClick={handleConnectFolder}
                  disabled={isImporting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
                  title="Ganti ke folder lain di komputer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Ganti Folder</span>
                </button>

                <button
                  onClick={handleDisconnectFolder}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all cursor-pointer"
                  title="Putuskan sambungan folder pantau ini"
                >
                  <Unplug className="h-3.5 w-3.5" />
                  <span>Putuskan</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleConnectFolder}
                disabled={isImporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-cyan-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-extrabold shadow-lg shadow-indigo-600/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                ) : (
                  <FolderOpen className="h-4 w-4 text-white" />
                )}
                <span>📂 Sambungkan Folder Pantau WAV</span>
              </button>
            )}
          </div>
        </div>

        {/* FITUR AUTO RUBAH ATAU MANUAL TOGGLE */}
        <div className="rounded-xl bg-slate-950/80 p-3.5 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-xs font-bold text-slate-200">
                Mode Konversi File WAV ke MP3:
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {autoConvertMode ? (
                <span>
                  Mode <strong className="text-emerald-400">Otomatis (Auto)</strong>: Setiap file .wav yang terdeteksi di folder akan langsung otomatis diubah ke MP3 (192 kbps).
                </span>
              ) : (
                <span>
                  Mode <strong className="text-amber-400">Manual</strong>: File .wav yang terdeteksi akan disimpan ke Audio Library, dan Anda dapat memilih kapan ingin mengubahnya ke MP3.
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 self-start md:self-auto shrink-0">
            <button
              onClick={() => handleToggleAutoConvert(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                autoConvertMode
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>⚡ Otomatis (Auto)</span>
            </button>
            <button
              onClick={() => handleToggleAutoConvert(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                !autoConvertMode
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-950/50'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Hand className="h-3.5 w-3.5" />
              <span>✋ Manual</span>
            </button>
          </div>
        </div>

        {/* KONSEKUENSI FOLDER YANG DIPILIH */}
        <div className="rounded-xl bg-indigo-950/30 p-3 border border-indigo-500/20 text-[11px] text-indigo-200/90 leading-relaxed space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-indigo-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Konsekuensi Folder yang Dipilih untuk Audio Library:</span>
          </div>
          <p>
            Seluruh file <strong className="text-cyan-300">.wav</strong> yang sengaja atau tidak sengaja masuk ke folder ini akan otomatis diambil oleh website dan diubah menjadi MP3 (apabila mode otomatis aktif) atau disiapkan untuk konversi manual. <strong>Selain file .wav akan dibiarkan</strong> tanpa disentuh sama sekali.
          </p>
        </div>
      </div>

      {/* Import Feedback Banner */}
      {importFeedback && (
        <div
          className={`p-3 rounded-xl text-xs font-medium border flex items-center justify-between gap-2 ${
            importFeedback.type === 'success'
              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
              : importFeedback.type === 'error'
              ? 'bg-rose-950/50 border-rose-500/40 text-rose-200'
              : 'bg-cyan-950/50 border-cyan-500/40 text-cyan-200'
          }`}
        >
          <span>{importFeedback.text}</span>
          <button
            onClick={() => setImportFeedback(null)}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Progress Bar Batch Convert */}
      {isBatchConverting && batchProgress && (
        <div className="rounded-xl border border-indigo-500/40 bg-slate-900/95 p-4 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>
                Sedang Mengonversi ke MP3: <strong>{batchProgress.currentName}.wav</strong>
              </span>
            </span>
            <span className="font-mono text-cyan-300">
              {batchProgress.current} dari {batchProgress.total} file ({Math.round((batchProgress.current / batchProgress.total) * 100)}%)
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-indigo-500/30">
            <div
              className="bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Unconverted Alert Notice (Calls to Action) */}
      {!isBatchConverting && unconvertedItems.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/25 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
            <div>
              <p className="font-semibold text-white">
                {unconvertedItems.length} Berkas WAV Siap Dikonversi ke MP3
              </p>
              <p className="text-[11px] text-amber-300/80 mt-0.5">
                Klik tombol di samping untuk mengonversi semua berkas sekaligus atau klik tombol per kartu audio.
              </p>
            </div>
          </div>
          <button
            onClick={handleConvertAllToMp3}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-md transition-all cursor-pointer self-start sm:self-auto shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5 fill-current" />
            <span>Ubah Semua ke MP3</span>
          </button>
        </div>
      )}

      {/* Floating Audio Player Widget if playing */}
      {playingItem && (
        <div className="sticky top-16 z-30 rounded-xl border border-indigo-500/40 bg-slate-900/95 backdrop-blur-md p-4 shadow-xl">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={() => handlePlayToggle(playingItem.baseName, playingItem.format)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-md cursor-pointer hover:scale-105 transition-all"
              >
                {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
              </button>
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-white font-mono truncate">
                  {playingItem.baseName}.{playingItem.format}
                </p>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
                  <span
                    className={`px-1.5 py-0.2 rounded font-semibold uppercase text-[9px] ${
                      playingItem.format === 'wav'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}
                  >
                    {playingItem.format === 'wav' ? '🎵 WAV Asli' : '✨ MP3 Konversi'}
                  </span>
                  <span>•</span>
                  <span>{formatSec(currentTime)} / {formatSec(duration)}</span>
                </div>
              </div>
            </div>

            {/* Scrubber */}
            <div className="flex-1 w-full max-w-md flex items-center gap-2 px-2">
              <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
                {formatSec(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="h-1.5 w-full cursor-pointer accent-cyan-400 bg-slate-800 rounded-lg"
              />
              <span className="text-[10px] font-mono text-slate-400 w-8">
                {formatSec(duration)}
              </span>
            </div>

            {/* Direct Quick Download & Volume Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleDownloadFile(playingItem.baseName, 'mp3')}
                disabled={downloadingId === `${playingItem.baseName}-mp3`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50"
                title="Unduh file MP3 hasil konversi langsung ke folder Downloads"
              >
                {downloadingId === `${playingItem.baseName}-mp3` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                <span>Unduh MP3</span>
              </button>

              <div className="hidden sm:flex items-center gap-1.5 border-l border-slate-800 pl-2">
                <button
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.muted = !isMuted;
                      setIsMuted(!isMuted);
                    }
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="h-1.5 w-14 cursor-pointer accent-indigo-400 bg-slate-800 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Cari file audio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
            <button
              onClick={() => setFormatFilter('all')}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                formatFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Semua ({audioItems.length})
            </button>
            <button
              onClick={() => setFormatFilter('mp3')}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                formatFilter === 'mp3' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              MP3 Saja ({audioItems.filter((a) => a.hasMp3 && a.mp3Size > 0).length})
            </button>
            <button
              onClick={() => setFormatFilter('wav')}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                formatFilter === 'wav' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              WAV Saja ({audioItems.filter((a) => a.hasWav).length})
            </button>
          </div>
        </div>
      </div>

      {/* Audio Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filtered.map((item) => {
          const hasReadyMp3 = item.hasMp3 && item.mp3Size > 0;
          const isPlayingThisMp3 = playingItem?.baseName === item.baseName && playingItem.format === 'mp3' && isPlaying;
          const isPlayingThisWav = playingItem?.baseName === item.baseName && playingItem.format === 'wav' && isPlaying;
          const isThisConverting = convertingSingle === item.baseName || (isBatchConverting && batchProgress?.currentName === item.baseName);

          return (
            <div
              key={item.baseName}
              className={`rounded-xl border transition-all p-4 flex flex-col justify-between ${
                hasReadyMp3
                  ? 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  : 'border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        hasReadyMp3
                          ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                          : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      }`}
                    >
                      <FileAudio className="h-4 w-4" />
                    </div>
                    <div className="overflow-hidden">
                      <p className="font-mono text-xs font-bold text-white truncate" title={item.baseName}>
                        {item.baseName}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(item.createdAt).toLocaleDateString()} • {new Date(item.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleStartRename(item)}
                      className="p-1 text-slate-400 hover:text-cyan-400 rounded hover:bg-slate-800 cursor-pointer"
                      title="Ubah Nama"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingItem(item)}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 cursor-pointer"
                      title="Hapus"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-950/60 rounded-lg p-2.5 my-3">
                  <div>
                    MP3 Size:{' '}
                    <strong className={hasReadyMp3 ? 'text-indigo-300 font-bold' : 'text-amber-400 font-medium'}>
                      {hasReadyMp3 ? `${(item.mp3Size / 1024).toFixed(1)} KB` : 'Belum dikonversi'}
                    </strong>
                  </div>
                  <div>
                    WAV Size:{' '}
                    <strong className="text-cyan-300 font-bold">
                      {item.hasWav ? `${(item.wavSize / 1024).toFixed(1)} KB` : 'Tidak ada'}
                    </strong>
                  </div>
                  <div>
                    Durasi: <strong className="text-slate-200">~{item.duration || 0}s</strong>
                  </div>
                  <div>
                    Bitrate: <strong className="text-indigo-400">192 kbps</strong>
                  </div>
                </div>
              </div>

              {/* Action Buttons: Play MP3, Play WAV, Convert, Download */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-3 border-t border-slate-800/80">
                {/* Playback & Conversion Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Play WAV (Lokal) */}
                  <button
                    onClick={() => handlePlayToggle(item.baseName, 'wav')}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                      isPlayingThisWav
                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-sm shadow-cyan-600/30'
                        : 'bg-cyan-950/40 text-cyan-300 border-cyan-500/30 hover:bg-cyan-900/60'
                    }`}
                    title="Putar audio WAV asli"
                  >
                    {isPlayingThisWav ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                    <span>WAV</span>
                  </button>

                  {/* Play MP3 (if ready) */}
                  {hasReadyMp3 && (
                    <button
                      onClick={() => handlePlayToggle(item.baseName, 'mp3')}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-all cursor-pointer ${
                        isPlayingThisMp3
                          ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm shadow-indigo-600/30'
                          : 'bg-indigo-950/40 text-indigo-300 border-indigo-500/30 hover:bg-indigo-900/60'
                      }`}
                      title="Putar audio MP3 hasil konversi"
                    >
                      {isPlayingThisMp3 ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                      <span>MP3</span>
                    </button>
                  )}

                  {/* Button: Ubah ke MP3 (if not ready yet) */}
                  {!hasReadyMp3 && item.hasWav && (
                    <button
                      onClick={() => handleConvertSingleToMp3(item.baseName)}
                      disabled={isThisConverting}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-indigo-600 hover:from-amber-400 hover:to-indigo-500 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 transition-all"
                      title="Ubah file WAV ini menjadi MP3 sekarang"
                    >
                      {isThisConverting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span>{isThisConverting ? 'Mengonversi...' : 'Ubah ke MP3'}</span>
                    </button>
                  )}
                </div>

                {/* Downloads: Unduh WAV saja atau MP3 saja */}
                <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                  {/* Unduh WAV Asli */}
                  {item.hasWav && (
                    <button
                      onClick={() => handleDownloadFile(item.baseName, 'wav')}
                      disabled={downloadingId === `${item.baseName}-wav`}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 hover:text-white border border-cyan-500/30 transition-all cursor-pointer disabled:opacity-50"
                      title={`Unduh file WAV asli: ${item.baseName}.wav`}
                    >
                      {downloadingId === `${item.baseName}-wav` ? (
                        <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                      ) : (
                        <Download className="h-3 w-3 text-cyan-400" />
                      )}
                      <span>Unduh WAV</span>
                    </button>
                  )}

                  {/* Unduh MP3 Hasil Konversi */}
                  {hasReadyMp3 && (
                    <button
                      onClick={() => handleDownloadFile(item.baseName, 'mp3')}
                      disabled={downloadingId === `${item.baseName}-mp3`}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50"
                      title={`Unduh file MP3 hasil konversi: ${item.baseName}.mp3`}
                    >
                      {downloadingId === `${item.baseName}-mp3` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      <span>Unduh MP3</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="col-span-full py-16 text-center text-slate-500 space-y-3">
            <Music className="h-10 w-10 mx-auto opacity-30" />
            <p className="text-xs">Belum ada file audio di Audio Library.</p>
            {isFolderConnected ? (
              <p className="text-[11px] text-slate-400">
                Folder <strong>{connectedFolderName}</strong> sedang dipantau. Saat ada file WAV baru yang diunduh atau dimasukkan ke folder tersebut, website akan otomatis mendeteksi dan mengonversinya.
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">
                Klik tombol <strong>"📂 Sambungkan Folder Pantau WAV"</strong> di atas untuk memantau folder audio Anda.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-2">Ubah Nama File Audio</h3>
            <p className="text-xs text-slate-400 mb-4">
              Nama file baru akan diterapkan ke format WAV dan MP3 di penyimpanan lokal.
            </p>

            <div className="space-y-3">
              <input
                type="text"
                value={newBaseName}
                onChange={(e) => setNewBaseName(e.target.value)}
                placeholder="Nama file baru tanpa ekstensi..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              />

              {renameError && (
                <p className="text-xs text-rose-400">{renameError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRenamingItem(null)}
                  className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={handleConfirmRename}
                  disabled={!newBaseName.trim() || newBaseName.trim() === renamingItem.baseName}
                  className="rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50 cursor-pointer"
                >
                  Simpan Nama
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Item Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2">Hapus File Audio</h3>
            <p className="text-xs text-slate-300 mb-4">
              Apakah Anda yakin ingin menghapus file <strong>{deletingItem.baseName}</strong> dari Audio Library?
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingItem(null)}
                className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-500 cursor-pointer"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Modal */}
      {isDeletingAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2">Hapus Semua Audio Library</h3>
            <p className="text-xs text-slate-300 mb-4">
              Tindakan ini akan mengosongkan seluruh file audio ({audioItems.length} file) dari penyimpanan Audio Library.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setIsDeletingAll(false)}
                className="rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDeleteAll}
                className="rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-500 cursor-pointer"
              >
                Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
