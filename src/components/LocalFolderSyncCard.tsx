import React, { useEffect, useState } from 'react';
import {
  Folder,
  FolderCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Unlink,
  Link,
  Check,
  Trash2,
} from 'lucide-react';
import { localFolderSync, FolderSyncState } from '../services/localFolderSync';
import { extensionClient } from '../services/extensionBridge';

interface LocalFolderSyncCardProps {
  onSyncTriggered?: () => void;
  compact?: boolean;
}

export const LocalFolderSyncCard: React.FC<LocalFolderSyncCardProps> = ({ onSyncTriggered, compact = false }) => {
  const [state, setState] = useState<FolderSyncState>(localFolderSync.getState());
  const [connecting, setConnecting] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' | 'warn' } | null>(null);

  // Target path state (e.g. C:\Users\USER\Downloads\unduhan)
  const [fullPathInput, setFullPathInput] = useState<string>(() => {
    return localStorage.getItem('ai_tts_full_folder_path') || 'C:\\Users\\USER\\Downloads\\unduhan';
  });

  const extractFolderNameFromPath = (pathStr: string): string => {
    const clean = pathStr.trim().replace(/[/\\]+$/, '');
    const segments = clean.split(/[/\\]/);
    return segments[segments.length - 1] || 'unduhan';
  };

  const handleApplyFullPath = async (pathStr: string) => {
    const clean = pathStr.trim() || 'C:\\Users\\USER\\Downloads\\unduhan';
    setFullPathInput(clean);
    localStorage.setItem('ai_tts_full_folder_path', clean);
    const folderSeg = extractFolderNameFromPath(clean);
    localStorage.setItem('ai_tts_saved_subfolder_name', folderSeg);
    await extensionClient.syncDownloadSubfolder(folderSeg).catch(() => {});
    setMessage({
      text: `Alamat folder berhasil disetel ke "${clean}". Ekstensi diarahkan ke folder "${folderSeg}".`,
      type: 'success',
    });
  };

  useEffect(() => {
    const unsub = localFolderSync.subscribe((newState) => {
      setState(newState);
      if (newState.isConnected && newState.folderName) {
        localStorage.setItem('ai_tts_saved_subfolder_name', newState.folderName);
        const autoFullPath = `C:\\Users\\USER\\Downloads\\${newState.folderName}`;
        setFullPathInput(autoFullPath);
        localStorage.setItem('ai_tts_full_folder_path', autoFullPath);
        extensionClient.syncDownloadSubfolder(newState.folderName).catch(() => {});
      }
    });
    return unsub;
  }, []);

  const handlePickFolder = async () => {
    setConnecting(true);
    setMessage(null);
    try {
      const res = await localFolderSync.pickFolder();
      if (res.success && res.folderName) {
        extensionClient.syncDownloadSubfolder(res.folderName).catch(() => {});
        setMessage({
          text: `Folder "${res.folderName}" berhasil terhubung! Ekstensi & website membaca satu folder yang sama.`,
          type: 'success',
        });
        onSyncTriggered?.();
      } else if (res.error) {
        setMessage({ text: res.error, type: 'error' });
      }
    } catch (e: any) {
      setMessage({ text: e.message || 'Gagal menghubungkan folder.', type: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await localFolderSync.disconnectFolder();
    setMessage({ text: 'Koneksi folder lokal berhasil diputuskan.', type: 'info' });
  };

  const handleClearFolder = async () => {
    if (!state.isConnected) return;
    setIsCleaning(true);
    try {
      const res = await localFolderSync.clearTemporaryWavFiles();
      if (res.success) {
        setMessage({
          text: `${res.deletedCount} berkas WAV sementara di folder unduhan berhasil dibersihkan.`,
          type: 'success',
        });
      } else {
        setMessage({ text: res.error || 'Gagal membersihkan berkas.', type: 'error' });
      }
    } catch (err: any) {
      setMessage({ text: err?.message || 'Gagal membersihkan berkas.', type: 'error' });
    } finally {
      setIsCleaning(false);
    }
  };

  if (!state.isSupported) {
    return null;
  }

  // Compact Mode (for header / navbar banner)
  if (compact) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div
            className={`p-2 rounded-lg ${
              state.isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-slate-800 text-slate-400 border border-slate-700/40'
            }`}
          >
            {state.isConnected ? <FolderCheck size={16} /> : <Folder size={16} />}
          </div>
          <div>
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <span>
                {state.isConnected ? `Folder Terhubung: ${state.folderName}` : 'Penyimpanan Folder Audio Lokal'}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  state.isConnected
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {state.isConnected ? 'Aktif' : 'Belum Terhubung'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              {state.isConnected
                ? `${state.folderName} • Siap membaca otomatis WAV hasil unduhan AI Studio`
                : 'Klik Hubungkan Folder agar website dan ekstensi membaca folder yang sama'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {state.isConnected ? (
            <>
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-cyan-300 hover:text-white bg-cyan-950/40 hover:bg-cyan-900/60 rounded border border-cyan-500/30 cursor-pointer"
              >
                <RefreshCw size={11} />
                <span>Ganti</span>
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-rose-300 hover:text-white bg-rose-950/30 hover:bg-rose-900/50 rounded border border-rose-500/30 cursor-pointer"
              >
                <Unlink size={11} />
                <span>Putuskan</span>
              </button>
            </>
          ) : (
            <button
              onClick={handlePickFolder}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-sm transition-all cursor-pointer"
            >
              <Folder size={12} />
              <span>{connecting ? 'Menghubungkan...' : 'Hubungkan Folder'}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full Clean Single Card Mode (Zero redundant boxes, crystal clear layout)
  const currentFolderSeg = extractFolderNameFromPath(fullPathInput);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-6 shadow-xl space-y-4">
      {/* 1. Header with Connection Status Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              state.isConnected
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-500/10'
                : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
            }`}
          >
            {state.isConnected ? <FolderCheck size={22} /> : <Folder size={22} />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white">Folder Penyimpanan Audio Komputer</h3>
              {state.isConnected ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Terhubung: "{state.folderName}"
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                  Belum Terhubung
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Satu folder bersama untuk unduhan WAV Ekstensi Chrome dan pembacaan otomatis Website Dashboard.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {state.isConnected ? (
            <>
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/60 text-cyan-300 text-xs font-semibold transition-all cursor-pointer shadow-sm"
                title="Ganti folder ke direktori lain kapan saja"
              >
                <RefreshCw size={13} className="text-cyan-400" />
                <span>Ganti Folder</span>
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 hover:border-rose-500/50 bg-slate-800/80 hover:bg-rose-950/40 text-slate-300 hover:text-rose-400 text-xs font-semibold transition-all cursor-pointer"
                title="Putuskan izin akses folder kapan saja"
              >
                <Unlink size={13} className="text-rose-400" />
                <span>Putuskan</span>
              </button>
              <button
                onClick={handleClearFolder}
                disabled={isCleaning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-amber-300 text-xs font-medium transition-all cursor-pointer"
                title="Hapus file WAV sementara di folder ini"
              >
                <Trash2 size={13} className="text-amber-400" />
                <span>{isCleaning ? '...' : 'Kosongkan WAV'}</span>
              </button>
            </>
          ) : (
            <button
              onClick={handlePickFolder}
              disabled={connecting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 via-cyan-500 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-cyan-500/25 active:scale-95 transition-all cursor-pointer"
            >
              <Folder size={15} />
              <span>{connecting ? 'Membuka Explorer...' : 'Hubungkan Folder di Komputer'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Path Address Setting Bar */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Link size={13} className="text-cyan-400" />
            <span>Alamat Path Folder di Windows:</span>
          </label>
          <span className="text-[11px] text-slate-400">
            Subfolder Ekstensi: <strong className="text-cyan-300 font-mono">{currentFolderSeg}</strong>
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={fullPathInput}
            onChange={(e) => setFullPathInput(e.target.value)}
            placeholder="C:\Users\USER\Downloads\unduhan"
            className="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-cyan-300 font-mono font-medium focus:border-cyan-400 focus:outline-none shadow-inner"
          />
          <button
            onClick={() => handleApplyFullPath(fullPathInput)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-all shadow-md active:scale-95 cursor-pointer shrink-0"
          >
            <Check size={13} />
            <span>Terapkan Alamat</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-400">
          Ekstensi Chrome otomatis mengunduh file WAV dari Google AI Studio ke subfolder ini (misal: <code>Downloads\{currentFolderSeg}</code>). Website otomatis membaca dan mengonversi audio ke MP3.
        </p>
      </div>

      {/* Feedback Message */}
      {message && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : message.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              : 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-cyan-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
};
