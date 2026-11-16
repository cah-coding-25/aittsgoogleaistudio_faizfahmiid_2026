import React, { useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  Upload,
  Trash2,
  FileText,
  AlertCircle,
  HelpCircle,
  CheckCircle,
} from 'lucide-react';
import { TTSJob } from '../types';
import { ManualAudioUploadModal } from '../components/ManualAudioUploadModal';

interface FailedJobsPageProps {
  jobs: TTSJob[];
  onRetryJob: (id: string) => Promise<boolean>;
  onRetryAllFailed: () => Promise<boolean>;
  onDeleteJob: (id: string) => Promise<boolean>;
  onRefresh: () => void;
}

export const FailedJobsPage: React.FC<FailedJobsPageProps> = ({
  jobs,
  onRetryJob,
  onRetryAllFailed,
  onDeleteJob,
  onRefresh,
}) => {
  const [selectedForUpload, setSelectedForUpload] = useState<TTSJob | null>(null);
  const failedJobs = jobs.filter((j) => j.status === 'FAILED');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            <span>Pusat Penanganan Pekerjaan Gagal (Failed Jobs)</span>
          </h2>
          <p className="text-xs text-slate-400">
            Daftar pekerjaan yang mengalami kendala setelah batas maksimal auto-retry. Anda dapat mencoba kembali atau melampirkan file audio WAV secara manual.
          </p>
        </div>

        {failedJobs.length > 0 && (
          <button
            onClick={onRetryAllFailed}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-rose-600 px-4 py-2 text-xs font-bold text-white hover:from-amber-500 hover:to-rose-500 shadow-md shadow-rose-950/20 transition-all cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Coba Ulang Semua ({failedJobs.length})</span>
          </button>
        )}
      </div>

      {/* Triage Info Banner */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-300">
        <div className="flex items-start gap-2.5">
          <HelpCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">
              Penyebab Umum Kegagalan & Solusi Cepat:
            </p>
            <ul className="list-disc list-inside space-y-0.5 text-amber-300/80 text-[11px]">
              <li>Tab Google AI Studio tertutup atau belum membuka prompt TTS: buka kembali tab <code className="text-cyan-300">https://aistudio.google.com/</code>.</li>
              <li>Akun Google meminta login ulang atau CAPTCHA: lakukan login di browser Chrome Anda.</li>
              <li>Ekstraksi audio otomatis terhalang: gunakan tombol <strong>"Upload WAV"</strong> di bawah untuk mengonversi berkas WAV yang Anda unduh manual.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Failed Jobs List */}
      <div className="space-y-3">
        {failedJobs.map((job) => (
          <div
            key={job.id}
            className="rounded-xl border border-rose-500/30 bg-slate-900/60 p-4 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-cyan-400">
                  #{job.order}
                </span>
                <span className="font-mono text-xs font-bold text-white">
                  {job.filename}
                </span>
                <span className="rounded-md border border-rose-500/30 bg-rose-950/80 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                  Gagal setelah {job.retryCount || 0}x percobaan
                </span>
              </div>

              <div className="rounded-lg bg-slate-950 p-2.5 text-xs text-slate-300 border border-slate-800">
                "{job.text}"
              </div>

              {job.error && (
                <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/30 rounded p-2 border border-rose-500/20">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span><strong>Diagnostik Error:</strong> {job.error}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => onRetryJob(job.id)}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-600/20 hover:bg-amber-600/30 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Coba Ulang</span>
              </button>

              <button
                onClick={() => setSelectedForUpload(job)}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-600/20 hover:bg-cyan-600/30 px-3 py-2 text-xs font-semibold text-cyan-300 transition-colors cursor-pointer"
                title="Unggah berkas WAV manual"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Upload WAV</span>
              </button>

              <button
                onClick={() => onDeleteJob(job.id)}
                className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                title="Hapus dari antrean"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        {failedJobs.length === 0 && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400">
            <CheckCircle className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-white">Tidak Ada Pekerjaan Gagal</h3>
            <p className="text-xs text-slate-500 mt-1">
              Seluruh pekerjaan TTS berjalan lancar tanpa kendala.
            </p>
          </div>
        )}
      </div>

      <ManualAudioUploadModal
        isOpen={!!selectedForUpload}
        onClose={() => setSelectedForUpload(null)}
        job={selectedForUpload}
        onUploaded={onRefresh}
      />
    </div>
  );
};
