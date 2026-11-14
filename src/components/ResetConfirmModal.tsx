import React from 'react';
import {
  AlertTriangle,
  RotateCcw,
  X,
  Trash2,
  HardDrive,
  Unplug,
  ListOrdered,
  Loader2,
} from 'lucide-react';

interface ResetConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmReset: () => Promise<void>;
  isResetting: boolean;
  clientName: string;
  clientId: string;
  jobsCount: number;
  audioCount: number;
}

export const ResetConfirmModal: React.FC<ResetConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirmReset,
  isResetting,
  clientName,
  clientId,
  jobsCount,
  audioCount,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900/95 p-6 shadow-2xl shadow-rose-950/50 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <RotateCcw className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Restart & Reset Total Sistem
              </h3>
              <p className="text-xs text-rose-300/80">
                Hapus seluruh koneksi & penyimpanan sementara PC ini
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isResetting}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Details */}
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-xs">
          <p className="font-semibold text-slate-200 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>Tindakan ini akan menghapus dan mereset:</span>
          </p>

          <ul className="space-y-2 text-slate-400 pl-1">
            <li className="flex items-center gap-2.5">
              <Unplug className="h-3.5 w-3.5 text-rose-400 shrink-0" />
              <span>
                <strong>Koneksi Ekstensi:</strong> Memutuskan koneksi ekstensi Chrome dan mereset socket status.
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <HardDrive className="h-3.5 w-3.5 text-rose-400 shrink-0" />
              <span>
                <strong>Penyimpanan Sementara:</strong> Menghapus bersih folder <code className="text-cyan-400 font-mono">storage/workspaces/{clientId}/</code> ({audioCount} audio sementara).
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <ListOrdered className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>
                <strong>Antrean Pekerjaan:</strong> Mengosongkan {jobsCount} teks antrean antrean TTS.
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <Trash2 className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>
                <strong>Data Browser:</strong> Mengosongkan log aktivitas dan meregenerasi identitas workspace bersih.
              </span>
            </li>
          </ul>
        </div>

        {/* Warning Callout */}
        <div className="rounded-lg bg-rose-950/30 border border-rose-500/20 px-3 py-2 text-[11px] text-rose-300">
          Perangkat Anda (<strong>{clientName}</strong>) akan kembali ke kondisi awal yang segar dan siap digunakan tanpa sisa cache.
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isResetting}
            className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all disabled:opacity-50 cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirmReset}
            disabled={isResetting}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-5 py-2 text-xs font-bold text-white hover:from-rose-500 hover:to-red-500 shadow-lg shadow-rose-600/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isResetting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Mereset Sistem...</span>
              </>
            ) : (
              <>
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Ya, Restart & Reset Sekarang</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
