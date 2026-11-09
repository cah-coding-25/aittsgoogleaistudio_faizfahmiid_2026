import React, { useState } from 'react';
import {
  Laptop,
  Copy,
  Check,
  Download,
  Upload,
  RefreshCw,
  X,
  ShieldCheck,
  HardDrive,
  Info,
} from 'lucide-react';
import { getClientId, getClientName, setClientName, resetWorkspace, exportWorkspaceBackup } from '../services/clientWorkspace';
import { localHistory } from '../services/localHistory';
import { TTSJob, AudioItem, ActivityLog, AppSettings } from '../types';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: TTSJob[];
  audioItems: AudioItem[];
  settings: AppSettings;
  logs: ActivityLog[];
  onWorkspaceReset: () => void;
  onWorkspaceReload: () => void;
  onShowToast: (msg: string, type: 'info' | 'error' | 'success') => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  jobs,
  audioItems,
  settings,
  logs,
  onWorkspaceReset,
  onWorkspaceReload,
  onShowToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(getClientName());
  const [isEditingName, setIsEditingName] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  if (!isOpen) return null;

  const clientId = getClientId();

  const handleCopyId = () => {
    navigator.clipboard.writeText(clientId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onShowToast('Workspace ID disalin ke papan klip', 'info');
  };

  const handleSaveName = () => {
    if (!name.trim()) return;
    const updated = setClientName(name);
    setName(updated);
    setIsEditingName(false);
    onShowToast(`Nama perangkat diubah menjadi: ${updated}`, 'success');
  };

  const handleExport = () => {
    exportWorkspaceBackup({
      jobs,
      audioItems,
      settings,
      logs,
    });
    onShowToast('Berkas cadangan data PC lokal berhasil diunduh.', 'success');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed.jobs)) {
          localHistory.saveJobs(parsed.jobs);
        }
        if (Array.isArray(parsed.audioItems)) {
          localHistory.saveAudioItems(parsed.audioItems);
        }
        if (parsed.settings) {
          localHistory.saveLocalSettings(parsed.settings);
        }
        if (parsed.clientName) {
          setClientName(parsed.clientName);
          setName(parsed.clientName);
        }
        onWorkspaceReload();
        onShowToast('Data workspace lokal berhasil dipulihkan dari cadangan!', 'success');
        onClose();
      } catch (err: any) {
        onShowToast(`Gagal membaca berkas cadangan: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleReset = () => {
    const newId = resetWorkspace();
    onWorkspaceReset();
    setIsConfirmingReset(false);
    onShowToast(`Workspace PC diatur ulang. ID Baru: ${newId}`, 'success');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-4 sm:p-6 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shrink-0">
              <Laptop className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Pengaturan & Penyimpanan Lokal PC</span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 rounded-md px-1.5 py-0.5">
                  <ShieldCheck className="h-3 w-3" />
                  Terisolasi
                </span>
              </h3>
              <p className="text-xs text-slate-400 truncate">
                Pemisahan data mandiri untuk tiap perangkat pada domain website yang sama.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-4 sm:mt-5 space-y-4 text-xs overflow-y-auto flex-1 pr-0.5">
          {/* Explanation Box */}
          <div className="flex items-start gap-3 rounded-xl border border-cyan-500/20 bg-cyan-950/30 p-3.5 text-cyan-200">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-cyan-400" />
            <p className="leading-relaxed">
              Setiap PC/laptop memiliki <strong>Workspace Lokal tersendiri</strong>. Antrean teks, pekerjaan suara, dan file audio Anda hanya tersimpan dan aktif di PC ini. Pengguna lain di perangkat berbeda tidak dapat melihat ataupun mengganggu proses antrean Anda.
            </p>
          </div>

          {/* PC Name & Workspace ID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Device Name */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">
                Nama Perangkat / Label PC:
              </label>
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 rounded-lg border border-cyan-500/50 bg-slate-900 px-2.5 py-1 text-xs text-white focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold cursor-pointer"
                  >
                    Simpan
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 text-sm">{name}</span>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
                  >
                    Ubah
                  </button>
                </div>
              )}
            </div>

            {/* Workspace ID */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <label className="text-[11px] font-medium text-slate-400 block mb-1.5">
                ID Workspace Perangkat:
              </label>
              <div className="flex items-center justify-between bg-slate-900/90 rounded-lg px-2.5 py-1 border border-slate-800">
                <code className="text-xs text-cyan-300 font-mono select-all truncate">{clientId}</code>
                <button
                  onClick={handleCopyId}
                  className="p-1 text-slate-400 hover:text-cyan-300 transition-colors ml-2"
                  title="Salin ID"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Current Stats */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-[11px] mb-2 font-medium">
              <span className="flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-indigo-400" />
                Data Aktif di Perangkat Ini:
              </span>
              <span className="text-slate-500">Penyimpanan Browser & Server Partition</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-900 p-2 border border-slate-800/80">
                <div className="text-base font-bold text-cyan-400">{jobs.length}</div>
                <div className="text-[10px] text-slate-400">Total Teks/Jobs</div>
              </div>
              <div className="rounded-lg bg-slate-900 p-2 border border-slate-800/80">
                <div className="text-base font-bold text-indigo-400">{audioItems.length}</div>
                <div className="text-[10px] text-slate-400">File Audio</div>
              </div>
              <div className="rounded-lg bg-slate-900 p-2 border border-slate-800/80">
                <div className="text-base font-bold text-emerald-400">{settings.mp3Bitrate} kbps</div>
                <div className="text-[10px] text-slate-400">Format MP3</div>
              </div>
            </div>
          </div>

          {/* Backup & Restore Controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2.5">
            <div className="text-[11px] font-semibold text-slate-300">Cadangkan / Pulihkan Data PC Ini:</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 text-cyan-400" />
                <span>Export Cadangan (JSON)</span>
              </button>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-all cursor-pointer">
                <Upload className="h-3.5 w-3.5 text-indigo-400" />
                <span>Import Cadangan (JSON)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Reset Workspace */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
            {isConfirmingReset ? (
              <div className="flex items-center gap-2 w-full justify-between">
                <span className="text-rose-400 text-xs font-medium">Yakin ingin membuat ID workspace baru?</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
                  >
                    Ya, Reset
                  </button>
                  <button
                    onClick={() => setIsConfirmingReset(false)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsConfirmingReset(true)}
                className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Buat Workspace Bersih Baru untuk PC ini</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer text-xs"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
