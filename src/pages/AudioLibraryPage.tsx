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
  Check,
  X,
  FileAudio,
  Sparkles,
  Loader2,
  Info,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import JSZip from 'jszip';
import { AudioItem } from '../types';
import { getClientId } from '../services/clientWorkspace';
import { triggerSafeAudioDownload, saveAudioBlob, resolveValidAudioBlob } from '../services/localAudioStorage';
import { localHistory } from '../services/localHistory';
import { convertWavToMp3Client } from '../services/clientAudioConverter';
import {
  folderSyncService,
  validateAudioFileStrict,
  FolderSyncState,
} from '../services/folderSyncService';
import { extensionClient } from '../services/extensionBridge';

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
  const activeBlobUrlRef = useRef<string | null>(null);
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
  const [isZippingAll, setIsZippingAll] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Persistent "unduhan" Folder Sync & Extension readiness state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [folderSyncState, setFolderSyncState] = useState<FolderSyncState>(() => folderSyncService.getState());
  const [extReady, setExtReady] = useState<boolean>(() => extensionClient.isReady());
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isBatchConverting, setIsBatchConverting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [convertingSingle, setConvertingSingle] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        window.URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return folderSyncService.subscribe((state) => {
      setFolderSyncState(state);
    });
  }, []);

  useEffect(() => {
    extensionClient.checkPresence().then((ready) => {
      if (ready) setExtReady(true);
    }).catch(() => {});
    return extensionClient.subscribe((ev) => {
      if (
        ev?.type === 'EXTENSION_READY' ||
        ev?.type === 'EXTENSION_STATUS_CHANGE' ||
        ev?.type === 'NEW_WAV_FROM_EXTENSION'
      ) {
        setExtReady(extensionClient.isReady());
      }
    });
  }, []);

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

  // Helper: persist strictly validated Audio Adegan into Website IndexedDB + localHistory
  const persistValidatedEntryToIndexedDb = useCallback(async (
    activeClientId: string,
    cleanBase: string,
    format: 'wav' | 'mp3' | 'audio',
    blob: Blob,
    duration: number,
    createdAt: number
  ) => {
    const storageFormat = format === 'mp3' ? 'mp3' : 'wav';
    await saveAudioBlob(activeClientId, cleanBase, storageFormat, blob);
    const existing = localHistory.getAudioItems().find((it) => it.baseName === cleanBase);
    const isDirectMp3 = storageFormat === 'mp3';
    const newAudioItem: AudioItem = {
      filename: isDirectMp3 || existing?.hasMp3 ? `${cleanBase}.mp3` : `${cleanBase}.wav`,
      baseName: cleanBase,
      hasWav: !isDirectMp3 || existing?.hasWav || false,
      hasMp3: isDirectMp3 || existing?.hasMp3 || false,
      wavSize: isDirectMp3 ? (existing?.wavSize || 0) : blob.size,
      mp3Size: isDirectMp3 ? blob.size : (existing?.mp3Size || 0),
      duration: duration || existing?.duration || 0,
      createdAt: createdAt || existing?.createdAt || Date.now(),
      wavPath: `/api/audio/wav/${encodeURIComponent(cleanBase)}`,
      mp3Path: `/api/audio/mp3/${encodeURIComponent(cleanBase)}`,
      clientId: activeClientId,
    };
    localHistory.addOrUpdateAudioItem(newAudioItem);
  }, []);

  // Sync strictly valid audio files from connected "unduhan" folder AND extension's linked unduhan folder
  const syncFromConnectedFolder = useCallback(async (showStatusBanner = false) => {
    const folderConnected = folderSyncService.getState().isConnected;
    const extConnected = extensionClient.isReady();
    if (!folderConnected && !extConnected) return 0;

    setIsImporting(true);
    try {
      const activeClientId = getClientId();
      const existingItems = localHistory.getAudioItems();
      let syncedCount = 0;
      let validTotal = 0;
      let rejectedTotal = 0;

      if (folderConnected) {
        const { entries, summary } = await folderSyncService.scanValidAudioFiles();
        validTotal = entries.length;
        rejectedTotal += summary.rejectedCount;

        for (const entry of entries) {
          const existing = existingItems.find((it) => it.baseName === entry.baseName);
          const expectedSize = entry.format === 'mp3' ? existing?.mp3Size : existing?.wavSize;
          if (!existing || expectedSize !== entry.buffer.byteLength) {
            const safeBlob = new Blob([entry.buffer], {
              type: entry.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
            });
            await persistValidatedEntryToIndexedDb(
              activeClientId,
              entry.baseName,
              entry.format,
              safeBlob,
              entry.duration,
              entry.file.lastModified
            );
            syncedCount++;
          }
        }
      }

      // Juga pindai folder unduhan milik ekstensi lewat bridge jika ekstensi aktif
      if (extConnected) {
        const extScan = await extensionClient.scanExtensionUnduhanFolder({});
        if (extScan.success && extScan.folderLinked) {
          rejectedTotal += Number(extScan.rejected || 0);
          validTotal = Math.max(validTotal, Number(extScan.accepted || 0));
          for (const item of extScan.items) {
            try {
              const commaIdx = item.dataUrl.indexOf(',');
              const b64 = commaIdx >= 0 ? item.dataUrl.slice(commaIdx + 1) : item.dataUrl;
              const binStr = atob(b64);
              const bytes = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
              const blob = new Blob([bytes], { type: 'audio/wav' });
              const existing = localHistory.getAudioItems().find((it) => it.baseName === item.baseName);
              if (!existing || existing.wavSize !== blob.size) {
                await persistValidatedEntryToIndexedDb(
                  activeClientId,
                  item.baseName,
                  'wav',
                  blob,
                  item.duration,
                  item.lastModified
                );
                syncedCount++;
              }
            } catch {}
          }
        }
      }

      if (syncedCount > 0) {
        onRefresh();
        if (showStatusBanner) {
          const rejectedNote = rejectedTotal > 0 ? ` (${rejectedTotal} berkas non-audio/.htm/.crdownload/.tmp/gambar ditolak otomatis)` : '';
          setImportFeedback({
            text: `Berhasil menyinkronkan ${syncedCount} Audio Adegan valid ke IndexedDB dari "${folderSyncService.getState().folderName || 'unduhan'}"${rejectedNote}.`,
            type: 'success',
          });
        }
      } else if (showStatusBanner) {
        const rejectedNote = rejectedTotal > 0 ? ` • ${rejectedTotal} berkas non-audio ditolak otomatis.` : '';
        setImportFeedback({
          text: `Folder "${folderSyncService.getState().folderName || 'unduhan'}" sudah sinkron (${validTotal} Audio Adegan valid${rejectedNote})`,
          type: 'info',
        });
      }
      return syncedCount;
    } finally {
      setIsImporting(false);
    }
  }, [onRefresh, persistValidatedEntryToIndexedDb]);

  // Auto-sync when Audio Library opens, folder connects, or extension becomes ready
  useEffect(() => {
    if (folderSyncState.isConnected || extReady) {
      syncFromConnectedFolder(false).catch(() => {});
    }
  }, [folderSyncState.isConnected, extReady, syncFromConnectedFolder]);

  // Action: Pick & link persistent "unduhan" folder (then sync all valid Audio Adegan)
  const handlePickFolderAndImportWav = async () => {
    setIsImporting(true);
    setImportFeedback(null);

    if (folderSyncService.isSupported()) {
      const picked = await folderSyncService.pickFolder();
      if (picked.success) {
        const { entries, summary } = await folderSyncService.scanValidAudioFiles();
        const activeClientId = getClientId();
        let importedCount = 0;

        for (const entry of entries) {
          const safeBlob = new Blob([entry.buffer], {
            type: entry.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
          });
          await persistValidatedEntryToIndexedDb(
            activeClientId,
            entry.baseName,
            entry.format,
            safeBlob,
            entry.duration,
            entry.file.lastModified
          );
          importedCount++;
        }

        const rejectedNote = summary.rejectedCount > 0
          ? ` (${summary.rejectedCount} berkas non-audio/.htm/.crdownload/.tmp/gambar ditolak otomatis.)`
          : '';

        if (importedCount > 0) {
          setImportFeedback({
            text: `Folder "${picked.folderName}" terhubung & ${importedCount} Audio Adegan valid disimpan ke IndexedDB! Pemantauan real-time aktif.${rejectedNote}`,
            type: 'success',
          });
          onRefresh();
        } else {
          setImportFeedback({
            text: `Folder "${picked.folderName}" terhubung! Pemantauan real-time aktif — WAV valid (>0.1 detik) dari ekstensi atau File Manager otomatis masuk sebagai Audio Adegan.${rejectedNote}`,
            type: 'info',
          });
        }
        setIsImporting(false);
        return;
      } else if (picked.error && picked.error.includes('dibatalkan')) {
        setIsImporting(false);
        return;
      }
    }

    // Strategy 2: File input fallback
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
    setIsImporting(false);
  };

  // Reconnect saved persistent "unduhan" handle after browser restart (1-click)
  const handleReconnectSavedFolder = async () => {
    setIsImporting(true);
    setImportFeedback(null);
    const res = await folderSyncService.reconnectSavedHandle();
    if (res.success) {
      await syncFromConnectedFolder(true);
    } else if (res.error) {
      setImportFeedback({ text: res.error, type: 'error' });
    }
    setIsImporting(false);
  };

  // Fallback for HTML input folder selection — strictly enforces RIFF/WAVE & >0.1s rules
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setImportFeedback(null);
    const activeClientId = getClientId();
    let importedCount = 0;
    let rejectedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.toLowerCase() === 'readme.txt') continue;
      try {
        const { validation, buffer } = await validateAudioFileStrict(file);
        if (!validation.valid || !buffer) {
          rejectedCount++;
          continue;
        }
        const safeBlob = new Blob([buffer], {
          type: validation.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        });
        await persistValidatedEntryToIndexedDb(
          activeClientId,
          validation.cleanBaseName,
          validation.format || 'wav',
          safeBlob,
          validation.duration,
          file.lastModified
        );
        importedCount++;
      } catch (err) {
        rejectedCount++;
        console.warn('Could not import file:', file.name, err);
      }
    }

    if (importedCount > 0) {
      const rejText = rejectedCount > 0 ? ` (${rejectedCount} berkas non-audio/.htm/.crdownload/.tmp/gambar ditolak otomatis)` : '';
      setImportFeedback({
        text: `Berhasil mengunggah ${importedCount} Audio Adegan valid ke IndexedDB${rejText}! Klik "⚡ Ubah Semua ke MP3" untuk konversi.`,
        type: 'success',
      });
      onRefresh();
    } else {
      setImportFeedback({
        text: rejectedCount > 0
          ? `Tidak ada audio valid. ${rejectedCount} berkas (.htm/.crdownload/.tmp/gambar/durasi <=0.1d) ditolak otomatis.`
          : 'Tidak ada berkas audio RIFF/WAVE valid (>0.1 detik) dalam folder yang dipilih.',
        type: 'error',
      });
    }
    setIsImporting(false);
    e.target.value = '';
  };

  // Convert Single WAV to MP3
  const handleConvertSingleToMp3 = async (baseName: string) => {
    setConvertingSingle(baseName);
    const clientId = getClientId();
    try {
      const wavBlob = await resolveValidAudioBlob(clientId, baseName, 'wav');
      if (!wavBlob) {
        throw new Error('Berkas WAV asli tidak ditemukan di penyimpanan lokal, ekstensi, maupun folder unduhan.');
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
        const wavBlob = await resolveValidAudioBlob(clientId, item.baseName, 'wav');
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

  const handlePlayToggle = async (baseName: string, format: 'mp3' | 'wav') => {
    if (playingItem?.baseName === baseName && playingItem.format === format) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        try {
          await audioRef.current?.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
        }
      }
      return;
    }

    setDownloadError(null);
    const clientId = getClientId();
    const localBlob = await resolveValidAudioBlob(clientId, baseName, format);

    if (!localBlob || localBlob.size === 0) {
      setIsPlaying(false);
      setPlayingItem(null);
      setDownloadError(
        `File ${baseName}.${format} asli belum ditemukan di browser/ekstensi. Klik "Pilih Folder \\"unduhan\\" Ekstensi" untuk memuat file WAV asli.`
      );
      setTimeout(() => setDownloadError(null), 6500);
      return;
    }

    if (audioRef.current) {
      if (activeBlobUrlRef.current) {
        window.URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }

      const blobUrl = window.URL.createObjectURL(localBlob);
      activeBlobUrlRef.current = blobUrl;
      audioRef.current.pause();
      audioRef.current.src = blobUrl;
      audioRef.current.volume = volume;
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      setDuration(0);
      setPlayingItem({ baseName, format });

      try {
        audioRef.current.load();
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (playErr: any) {
        setIsPlaying(false);
        setDownloadError(`Gagal memutar ${baseName}.${format}: ${playErr?.message || 'Format audio tidak dapat diputar browser'}`);
      }
    }
  };

  const handleDownloadAllMp3Zip = async () => {
    const mp3Items = audioItems.filter((a) => a.hasMp3 && a.mp3Size > 0);
    if (mp3Items.length === 0) return;

    setIsZippingAll(true);
    setDownloadError(null);
    const clientId = getClientId();

    try {
      const zip = new JSZip();
      let addedCount = 0;

      for (const item of mp3Items) {
        const blob = await resolveValidAudioBlob(clientId, item.baseName, 'mp3');
        if (blob && blob.size > 0) {
          zip.file(`${item.baseName}.mp3`, blob);
          addedCount++;
        }
      }

      if (addedCount === 0) {
        throw new Error('Tidak ada file MP3 siap bundel yang ditemukan di browser maupun server.');
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const dateStr = new Date().toISOString().slice(0, 10);
      const blobUrl = window.URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `AI_TTS_MP3_${dateStr}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);
    } catch (err: any) {
      setDownloadError(err.message || 'Gagal membuat paket ZIP MP3.');
      setTimeout(() => setDownloadError(null), 6000);
    } finally {
      setIsZippingAll(false);
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

  return (
    <div className="space-y-5">
      <audio
        ref={audioRef}
        onLoadedMetadata={() => {
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onDurationChange={() => {
          if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
            setDuration(audioRef.current.duration);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          setIsPlaying(false);
          if (playingItem) {
            setDownloadError(`File ${playingItem.baseName}.${playingItem.format} gagal dimuat atau bukan berkas audio yang valid.`);
          }
        }}
      />

      {/* Hidden folder input fallback */}
      <input
        type="file"
        ref={fileInputRef}
        // @ts-ignore
        webkitdirectory="true"
        directory="true"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Header & Primary Output Actions */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800/90">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <Music className="h-5 w-5 text-indigo-400 shrink-0" />
            <h2 className="text-lg font-bold tracking-tight text-white">Audio Library</h2>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Ambil file WAV hasil unduhan ekstensi dari folder komputer Anda, lalu konversi ke MP3 (192 kbps) siap unduh.
            <span className="text-slate-600 mx-2" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">{audioItems.length}</span> file tersedia
          </p>
        </div>

        {/* Library Output & Cleanup Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {unconvertedItems.length > 0 && (
            <button
              onClick={handleConvertAllToMp3}
              disabled={isBatchConverting}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              title={`Konversi ${unconvertedItems.length} berkas WAV ke MP3 satu per satu`}
            >
              {isBatchConverting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-indigo-100" />
              )}
              <span className="tabular-nums">
                {isBatchConverting
                  ? `Mengonversi (${batchProgress?.current || 1}/${batchProgress?.total || unconvertedItems.length})...`
                  : `Ubah Semua ke MP3 (${unconvertedItems.length})`}
              </span>
            </button>
          )}

          {audioItems.some((a) => a.hasMp3 && a.mp3Size > 0) && (
            <button
              onClick={handleDownloadAllMp3Zip}
              disabled={isZippingAll}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isZippingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              ) : (
                <Download className="h-3.5 w-3.5 text-indigo-400" />
              )}
              <span>{isZippingAll ? 'Membuat ZIP...' : 'Download Semua MP3 (ZIP)'}</span>
            </button>
          )}

          {audioItems.length > 0 && (
            <button
              onClick={() => setIsDeletingAll(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-rose-500/30 bg-rose-950/30 hover:bg-rose-900/50 text-xs font-semibold text-rose-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
              <span>Hapus Semua</span>
            </button>
          )}
        </div>
      </div>

      {/* Download Error Banner */}
      {downloadError && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border bg-rose-950/40 border-rose-500/40 text-rose-300 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{downloadError}</span>
          </div>
          <button onClick={() => setDownloadError(null)} className="text-slate-400 hover:text-white text-xs px-1 cursor-pointer">✕</button>
        </div>
      )}

      {/* Unified Folder Sync & Extension Bar (folderSyncService) */}
      <div
        className={`rounded-xl border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
          folderSyncState.isConnected
            ? 'border-emerald-500/30 bg-emerald-950/15'
            : folderSyncState.savedFolderName
            ? 'border-amber-500/30 bg-slate-900/70'
            : 'border-slate-800 bg-slate-900/60'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
              folderSyncState.isConnected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : folderSyncState.savedFolderName
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400'
            }`}
          >
            <FolderOpen className="h-4 w-4" />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-semibold text-white">
                {folderSyncState.isConnected
                  ? `Sinkron Aktif: "${folderSyncState.folderName}"`
                  : folderSyncState.savedFolderName
                  ? `Folder "${folderSyncState.savedFolderName}" tersimpan`
                  : 'Default Sinkronisasi: Folder "unduhan" Ekstensi'}
              </span>

              {folderSyncState.isConnected ? (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-emerald-300">
                    {folderSyncState.temporaryFileCount} WAV valid
                  </span>
                  {folderSyncState.isWatching && (
                    <>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-emerald-400 font-medium">Pemantauan Real-time Aktif</span>
                    </>
                  )}
                </>
              ) : folderSyncState.savedFolderName ? (
                <>
                  <span className="text-slate-600" aria-hidden="true">—</span>
                  <span className="text-amber-300">klik "Sambung Ulang" untuk membaca WAV</span>
                </>
              ) : null}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Hanya berkas <code className="text-cyan-300">.wav</code> ber-header RIFF/WAVE valid (&gt; 0.1 detik) yang dimuat otomatis ke Audio Library; berkas <code className="text-rose-300">.htm</code>, <code className="text-rose-300">.crdownload</code>, <code className="text-rose-300">.tmp</code>, dan gambar ditolak otomatis
              {folderSyncState.rejectedCount > 0 && folderSyncState.lastRejectedFile
                ? ` (${folderSyncState.rejectedCount} ditolak, terakhir: ${folderSyncState.lastRejectedFile}).`
                : '.'}
            </p>
          </div>
        </div>

        {/* Folder & Extension Sync Buttons */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          {!folderSyncState.isConnected && folderSyncState.savedFolderName && (
            <button
              onClick={handleReconnectSavedFolder}
              disabled={isImporting}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              title="Aktifkan ulang izin akses folder unduhan dari sesi sebelumnya"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} />
              <span>Sambung Ulang "{folderSyncState.savedFolderName}"</span>
            </button>
          )}

          {(folderSyncState.isConnected || extReady) && (
            <button
              onClick={() => syncFromConnectedFolder(true)}
              disabled={isImporting}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-500/40 text-xs font-semibold text-emerald-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              title="Baca ulang file audio valid di folder unduhan ekstensi & lokal (termasuk file manual via File Manager)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isImporting ? 'animate-spin' : ''}`} />
              <span className="tabular-nums">
                {folderSyncState.isConnected
                  ? `Sinkronkan (${folderSyncState.temporaryFileCount} WAV)`
                  : 'Sinkronkan Ekstensi'}
              </span>
            </button>
          )}

          <button
            onClick={handlePickFolderAndImportWav}
            disabled={isImporting}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
              !folderSyncState.isConnected && !folderSyncState.savedFolderName
                ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                : 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white'
            }`}
            title="Pilih folder unduhan milik ekstensi (atau Downloads\\unduhan) agar selalu sinkron"
          >
            {isImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
            <span>
              {isImporting
                ? 'Menyinkronkan...'
                : folderSyncState.isConnected || folderSyncState.savedFolderName
                ? 'Pilih Folder Lain'
                : 'Pilih Folder "unduhan" Ekstensi'}
            </span>
          </button>
        </div>
      </div>

      {/* Import Feedback Banner */}
      {importFeedback && (
        <div
          className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border text-xs animate-fadeIn ${
            importFeedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : importFeedback.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              : 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {importFeedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : importFeedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-cyan-400" />
            )}
            <span>{importFeedback.text}</span>
          </div>
          <button
            onClick={() => setImportFeedback(null)}
            className="text-slate-400 hover:text-white text-xs px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Batch Conversion Progress Indicator */}
      {isBatchConverting && batchProgress && (
        <div className="p-4 rounded-xl border border-indigo-500/40 bg-indigo-950/40 text-xs text-indigo-200 space-y-2 animate-fadeIn">
          <div className="flex items-center justify-between font-semibold">
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

                {/* Downloads */}
                <div className="flex items-center gap-1.5 self-end sm:self-auto flex-wrap">
                  {item.hasWav && (
                    <button
                      onClick={() => handleDownloadFile(item.baseName, 'wav')}
                      disabled={downloadingId === `${item.baseName}-wav`}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white border border-cyan-500/30 transition-all cursor-pointer disabled:opacity-50"
                      title={`Unduh file WAV asli ${item.baseName}.wav`}
                    >
                      {downloadingId === `${item.baseName}-wav` ? (
                        <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                      ) : (
                        <Download className="h-3 w-3 text-cyan-400" />
                      )}
                      <span>{hasReadyMp3 ? 'WAV' : 'Unduh WAV'}</span>
                    </button>
                  )}

                  {hasReadyMp3 && (
                    <button
                      onClick={() => handleDownloadFile(item.baseName, 'mp3')}
                      disabled={downloadingId === `${item.baseName}-mp3`}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-md shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50"
                      title={`Unduh file ${item.baseName}.mp3 ke folder Downloads PC`}
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
            <button
              onClick={handlePickFolderAndImportWav}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md cursor-pointer"
            >
              <FolderOpen className="h-4 w-4" />
              <span>📂 Ambil File WAV dari Folder Komputer</span>
            </button>
          </div>
        )}
      </div>

      {/* Rename Modal */}
      {renamingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-white mb-2">Ubah Nama File Audio</h3>
            <p className="text-[11px] text-slate-400 mb-3">
              Mengubah nama berkas WAV dan MP3 sekaligus pada penyimpanan lokal.
            </p>
            {renameError && (
              <p className="text-xs text-rose-400 mb-2">{renameError}</p>
            )}
            <input
              type="text"
              value={newBaseName}
              onChange={(e) => setNewBaseName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white mb-4 focus:border-cyan-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRenamingItem(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmRename}
                className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-cyan-500"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-rose-500/30 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2">Konfirmasi Hapus Audio</h3>
            <p className="text-xs text-slate-300 mb-4">
              Apakah Anda yakin ingin menghapus berkas audio <strong className="text-white font-mono">{deletingItem.baseName}</strong> dari disk lokal? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingItem(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDelete}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
              >
                Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete ALL Confirmation Modal */}
      {isDeletingAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <span>Hapus Semua File Audio?</span>
            </h3>
            <p className="text-xs text-slate-300 mb-4">
              Apakah Anda yakin ingin menghapus <strong className="text-white">{audioItems.length} berkas audio</strong> dari penyimpanan lokal browser? Semua file MP3 dan WAV akan dihapus permanen.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsDeletingAll(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmDeleteAll}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500 shadow-md shadow-rose-600/30 cursor-pointer"
              >
                Ya, Hapus Semua Audio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
