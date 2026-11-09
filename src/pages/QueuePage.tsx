import React, { useState } from 'react';
import {
  ListOrdered,
  Play,
  Pause,
  Square,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Trash2,
  Upload,
  ArrowRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { TTSJob, QueueState } from '../types';
import { ManualAudioUploadModal } from '../components/ManualAudioUploadModal';
import { api } from '../services/api';

interface QueuePageProps {
  jobs: TTSJob[];
  queueState: QueueState;
  currentJob: TTSJob | null;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
  onStopQueue: () => void;
  onRetryJob: (id: string) => Promise<boolean>;
  onClearCompleted: () => Promise<boolean>;
  onClearAllJobs?: () => Promise<boolean>;
  onRefresh: () => void;
}

export const QueuePage: React.FC<QueuePageProps> = ({
  jobs,
  queueState,
  currentJob,
  onStartQueue,
  onPauseQueue,
  onResumeQueue,
  onStopQueue,
  onRetryJob,
  onClearCompleted,
  onClearAllJobs,
  onRefresh,
}) => {
  const [selectedJobForUpload, setSelectedJobForUpload] = useState<TTSJob | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);


  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-500/30';
      case 'FAILED':
        return 'bg-rose-950/80 text-rose-400 border-rose-500/30';
      case 'RETRYING':
        return 'bg-amber-950/80 text-amber-300 border-amber-500/40 animate-pulse';
      case 'GENERATING':
      case 'WAITING_AUDIO':
        return 'bg-blue-950/80 text-blue-300 border-blue-500/40 animate-pulse';
      case 'CONVERTING':
      case 'SAVING':
      case 'VERIFYING':
        return 'bg-purple-950/80 text-purple-300 border-purple-500/40 animate-pulse';
      case 'SENDING_TEXT':
      case 'PREPARING':
        return 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40';
      case 'PAUSED':
        return 'bg-amber-900/40 text-amber-300 border-amber-600/30';
      case 'CANCELLED':
        return 'bg-slate-800 text-slate-400 border-slate-700';
      default:
        return 'bg-slate-800/80 text-slate-300 border-slate-700/60';
    }
  };

  const completedCount = jobs.filter((j) => j.status === 'COMPLETED').length;
  const pendingCount = jobs.filter((j) => j.status === 'PENDING' || j.status === 'DRAFT').length;

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-cyan-400" />
            <span>Generation Queue (One Job at a Time)</span>
          </h2>
          <p className="text-xs text-slate-400">
            Pemrosesan antrean otomatis terurut. Pekerjaan berikutnya hanya dieksekusi setelah MP3 sebelumnya berhasil diverifikasi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {completedCount > 0 && (
            <button
              onClick={onClearCompleted}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
              <span>Bersihkan Selesai ({completedCount})</span>
            </button>
          )}

          {jobs.length > 0 && onClearAllJobs && (
            <button
              onClick={() => setIsClearingAll(true)}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 hover:text-white transition-all cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
              <span>Kosongkan Antrean</span>
            </button>
          )}

          {queueState === 'IDLE' || queueState === 'STOPPED' ? (
            <button
              onClick={onStartQueue}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>MULAI ANTREAN</span>
            </button>
          ) : queueState === 'RUNNING' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onPauseQueue}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-600/20 hover:bg-amber-600/30 px-3 py-1.5 text-xs font-bold text-amber-300 transition-all cursor-pointer"
              >
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>Jeda (Pause)</span>
              </button>
              <button
                onClick={onStopQueue}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-600/20 hover:bg-rose-600/30 px-3 py-1.5 text-xs font-bold text-rose-300 transition-all cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Hentikan</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onResumeQueue}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 hover:bg-emerald-600/30 px-3 py-1.5 text-xs font-bold text-emerald-300 transition-all cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Lanjutkan</span>
              </button>
              <button
                onClick={onStopQueue}
                className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-600/20 hover:bg-rose-600/30 px-3 py-1.5 text-xs font-bold text-rose-300 transition-all cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Hentikan</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Pipeline Progress Banner */}
      {currentJob && (
        <div className="rounded-xl border border-cyan-500/40 bg-gradient-to-r from-slate-900 via-cyan-950/30 to-slate-900 p-4 shadow-lg shadow-cyan-950/20">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Sedang Aktif Diproses: #{currentJob.order} — {currentJob.filename}
              </span>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${getStatusBadge(
                currentJob.status
              )}`}
            >
              {currentJob.status}
            </span>
          </div>

          <p className="text-xs text-slate-300 line-clamp-2 italic mb-3">"{currentJob.text}"</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
            <div>Percobaan Ulang: <strong className="text-white">{currentJob.retryCount || 0} / {currentJob.maxRetries}</strong></div>
            <div>Waktu Mulai: <strong className="text-white">{new Date(currentJob.createdAt).toLocaleTimeString()}</strong></div>
            <div>Teks: <strong className="text-white">{currentJob.text.length} karakter</strong></div>
            <div>Mode: <strong className="text-cyan-400">Strict FIFO Pipeline</strong></div>
          </div>
        </div>
      )}

      {/* Queue Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3 w-16 text-center">Urutan</th>
                <th className="py-3 px-3 w-48">Nama File</th>
                <th className="py-3 px-3 min-w-[240px]">Isi Teks TTS</th>
                <th className="py-3 px-3 w-36 text-center">Status Tahapan</th>
                <th className="py-3 px-3 w-28 text-center">Percobaan</th>
                <th className="py-3 px-3 w-32 text-right">Aksi Manual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {jobs.map((job) => {
                const isCurrent = currentJob?.id === job.id;
                return (
                  <tr
                    key={job.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isCurrent ? 'bg-cyan-950/30' : ''
                    }`}
                  >
                    <td className="py-3 px-3 text-center font-mono font-bold text-cyan-400">
                      {isCurrent ? (
                        <span className="flex items-center justify-center gap-1 text-cyan-300">
                          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                          #{job.order}
                        </span>
                      ) : (
                        `#${job.order}`
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono font-medium text-slate-200">
                      <div>{job.filename}</div>
                      {job.error && (
                        <div className="text-[10px] text-rose-400 truncate mt-0.5" title={job.error}>
                          {job.error}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-slate-300">
                      <p className="line-clamp-2">{job.text}</p>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block rounded-md px-2.5 py-0.5 text-[10px] font-bold border ${getStatusBadge(
                          job.status
                        )}`}
                      >
                        {job.status}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {job.retryCount || 0} / {job.maxRetries}
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {job.status === 'FAILED' && (
                          <button
                            onClick={() => onRetryJob(job.id)}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
                            title="Retry manual pekerjaan ini"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Retry</span>
                          </button>
                        )}

                        {job.status !== 'COMPLETED' && (
                          <button
                            onClick={() => setSelectedJobForUpload(job)}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
                            title="Upload file WAV manual jika ekstraksi otomatis terkendala"
                          >
                            <Upload className="h-3 w-3 text-slate-400" />
                            <span>Upload</span>
                          </button>
                        )}

                        {job.status === 'COMPLETED' && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                            <CheckCircle className="h-3.5 w-3.5" />
                            <span>Tersimpan</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    <ListOrdered className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">Antrean pekerjaan kosong. Tambahkan teks untuk memulai.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Audio Upload Modal */}
      <ManualAudioUploadModal
        isOpen={!!selectedJobForUpload}
        onClose={() => setSelectedJobForUpload(null)}
        job={selectedJobForUpload}
        onUploaded={onRefresh}
      />

      {/* Modal Konfirmasi Kosongkan Antrean */}
      {isClearingAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <span>Kosongkan Seluruh Antrean?</span>
            </h3>
            <p className="text-xs text-slate-300 mb-4">
              Apakah Anda yakin ingin menghapus seluruh <strong className="text-white">{jobs.length} pekerjaan</strong> dari antrean? Data antrean akan dibersihkan dari browser dan server.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsClearingAll(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  if (onClearAllJobs) {
                    await onClearAllJobs();
                  }
                  setIsClearingAll(false);
                }}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500 shadow-md shadow-rose-600/30 cursor-pointer"
              >
                Ya, Kosongkan Antrean
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
