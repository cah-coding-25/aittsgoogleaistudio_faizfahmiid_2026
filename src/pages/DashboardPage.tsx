import React from 'react';
import {
  FileText,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Music,
  HardDrive,
  Terminal,
  Cpu,
  Chrome,
  Globe2,
  Server,
  ArrowRight,
  Laptop,
} from 'lucide-react';
import { TTSJob, ActivityLog, AudioItem, QueueState, ExtensionStatus } from '../types';
import { TabId } from '../components/Sidebar';

interface DashboardPageProps {
  jobs: TTSJob[];
  logs: ActivityLog[];
  audioItems: AudioItem[];
  queueState: QueueState;
  currentJob: TTSJob | null;
  extensionStatus: ExtensionStatus;
  mockMode: boolean;
  clientName: string;
  clientId: string;
  onNavigate: (tab: TabId) => void;
  onStartQueue: () => void;
  onPauseQueue: () => void;
  onResumeQueue: () => void;
  onStopQueue: () => void;
  onOpenAddModal: () => void;
  onOpenImportModal: (type: 'txt' | 'csv') => void;
  onConnectExtension: () => void;
  onOpenGuide: () => void;
  onOpenWorkspace: () => void;
  onOpenResetModal: () => void;
  onRetryFailed?: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  jobs,
  logs,
  audioItems,
  queueState,
  currentJob,
  extensionStatus,
  mockMode,
  clientName,
  clientId,
  onNavigate,
  onStartQueue,
  onPauseQueue,
  onResumeQueue,
  onStopQueue,
  onOpenAddModal,
  onOpenImportModal,
  onConnectExtension,
  onOpenGuide,
  onOpenWorkspace,
  onOpenResetModal,
  onRetryFailed,
}) => {
  // Compute statistics
  const totalJobs = jobs.length;
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING' || j.status === 'DRAFT').length;
  const processingJobs = jobs.filter((j) =>
    [
      'PREPARING',
      'SENDING_TEXT',
      'GENERATING',
      'WAITING_AUDIO',
      'DOWNLOADING',
      'UPLOADING',
      'CONVERTING',
      'SAVING',
      'VERIFYING',
      'RETRYING',
    ].includes(j.status)
  ).length;
  const completedJobs = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;

  const totalMp3 = audioItems.filter((a) => a.hasMp3).length;
  const totalSizeBytes = audioItems.reduce((acc, a) => acc + (a.mp3Size || 0) + (a.wavSize || 0), 0);
  const totalSizeMb = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="space-y-6">
      {/* Clean Dashboard Header */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 sm:p-5 backdrop-blur-md">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-xl font-extrabold tracking-tight text-white">
            Dashboard Monitoring
          </h2>

          {/* PC Workspace Badge */}
          <button
            onClick={onOpenWorkspace}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/50 hover:bg-cyan-900/60 px-2.5 py-1 text-xs text-cyan-200 hover:text-white transition-all cursor-pointer shadow-sm shadow-cyan-950/30"
            title="Kelola identitas perangkat dan data lokal PC ini"
          >
            <Laptop className="h-3.5 w-3.5 text-cyan-400" />
            <span className="font-semibold text-white">{clientName}</span>
            <span className="text-[10px] text-cyan-400/90 bg-cyan-900/70 px-1 py-0.2 rounded font-mono">
              Lokal
            </span>
          </button>
        </div>
      </div>

      {/* 4 Status Indicator Badges (Verified Status - Non-duplicated) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* Backend Online */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Server className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0 truncate">
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">Backend Local</p>
              <p className="text-[11px] sm:text-xs font-bold text-emerald-400 truncate">Online (:3000)</p>
            </div>
          </div>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 animate-pulse ml-2" />
        </div>

        {/* Audio Processor Ready */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <Cpu className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="min-w-0 truncate">
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">Audio Processor</p>
              <p className="text-[11px] sm:text-xs font-bold text-cyan-400 truncate">Ready (WAV→MP3)</p>
            </div>
          </div>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-400 ml-2" />
        </div>

        {/* Extension Chrome Connected */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg ${
                extensionStatus.connected
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-slate-800/40 border border-slate-700/40'
              }`}
            >
              <Chrome
                className={`h-4 w-4 ${
                  extensionStatus.connected ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
            </div>
            <div className="min-w-0 truncate">
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">Extension Chrome</p>
              <p
                className={`text-[11px] sm:text-xs font-bold truncate ${
                  extensionStatus.connected ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {extensionStatus.connected ? 'Terhubung' : 'Belum Terhubung'}
              </p>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ml-2 ${
              extensionStatus.connected ? 'bg-emerald-500' : 'bg-slate-600'
            }`}
          />
        </div>

        {/* Google AI Studio Connected */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className={`flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg ${
                extensionStatus.aiStudioConnected
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-slate-800/40 border border-slate-700/40'
              }`}
            >
              <Globe2
                className={`h-4 w-4 ${
                  extensionStatus.aiStudioConnected ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
            </div>
            <div className="min-w-0 truncate">
              <p className="text-[10px] sm:text-[11px] text-slate-400 font-medium truncate">Google AI Studio</p>
              <p
                className={`text-[11px] sm:text-xs font-bold truncate ${
                  extensionStatus.aiStudioConnected ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {extensionStatus.aiStudioConnected ? 'Tab Terdeteksi' : 'Tab Belum Terbuka'}
              </p>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ml-2 ${
              extensionStatus.aiStudioConnected ? 'bg-emerald-500' : 'bg-slate-600'
            }`}
          />
        </div>
      </div>

      {/* 7 Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">Total Teks</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-white">{totalJobs}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="truncate">Menunggu</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-amber-300">{pendingJobs}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <Loader2 className={`h-3.5 w-3.5 text-blue-400 shrink-0 ${processingJobs > 0 ? 'animate-spin' : ''}`} />
            <span className="truncate">Diproses</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-blue-400">{processingJobs}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Berhasil</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-emerald-400">{completedJobs}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span className="truncate">Gagal</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-rose-400">{failedJobs}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <Music className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            <span className="truncate">Total MP3</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-indigo-300">{totalMp3}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-2.5 sm:p-3.5 col-span-2 sm:col-span-1">
          <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 text-[11px] sm:text-xs">
            <HardDrive className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            <span className="truncate">Ukuran</span>
          </div>
          <div className="mt-1.5 sm:mt-2 text-lg sm:text-xl font-extrabold text-purple-300">{totalSizeMb} MB</div>
        </div>
      </div>

      {/* Active Job Visualizer */}
      {currentJob ? (
        <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/90 p-4 sm:p-5 shadow-lg shadow-cyan-950/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-3 w-3 shrink-0 rounded-full bg-cyan-400 animate-ping" />
              <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                Pekerjaan Sedang Aktif: #{currentJob.order} — {currentJob.filename}
              </h3>
            </div>
            <span className="self-start sm:self-auto rounded-full border border-cyan-500/40 bg-cyan-950/60 px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-cyan-300 whitespace-nowrap">
              STATUS: {currentJob.status}
            </span>
          </div>

          <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800 mb-3">
            <p className="text-xs text-slate-300 italic">"{currentJob.text}"</p>
          </div>

          {/* Progress bar steps */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-400 font-medium">
              <span>Alur: Teks → AI Studio → Run → Deteksi WAV → Konversi MP3 → Verifikasi</span>
              <span>Percobaan: {currentJob.retryCount || 0}/{currentJob.maxRetries}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-300"
                style={{
                  width:
                    currentJob.status === 'PREPARING'
                      ? '15%'
                      : currentJob.status === 'SENDING_TEXT'
                      ? '30%'
                      : currentJob.status === 'GENERATING'
                      ? '50%'
                      : currentJob.status === 'WAITING_AUDIO'
                      ? '65%'
                      : currentJob.status === 'DOWNLOADING' || currentJob.status === 'UPLOADING'
                      ? '80%'
                      : currentJob.status === 'CONVERTING' || currentJob.status === 'SAVING'
                      ? '90%'
                      : currentJob.status === 'COMPLETED'
                      ? '100%'
                      : '40%',
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Split view: Next Jobs in Queue & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Next Jobs in Queue */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span>Antrean Pekerjaan Berikutnya</span>
              </h3>
              <button
                onClick={() => onNavigate('queue')}
                className="text-[11px] font-semibold text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Lihat Semua ({pendingJobs})</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-lg">
                <Clock className="h-6 w-6 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-xs text-slate-300 font-semibold">Antrean Pekerjaan Kosong (0)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tambahkan teks pertama Anda melalui menu <strong>Tambah Teks</strong> atau <strong>Import CSV/TXT</strong>.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.slice(0, 4).map((j) => (
                  <div
                    key={j.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 p-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <span className="font-mono text-[11px] font-bold text-cyan-400 shrink-0">
                        #{j.order}
                      </span>
                      <span className="font-mono font-medium text-slate-200 truncate">
                        {j.filename}
                      </span>
                      <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
                        • {j.text}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                        j.status === 'COMPLETED'
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                          : j.status === 'FAILED'
                          ? 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
                          : ['PREPARING', 'GENERATING', 'CONVERTING', 'SAVING'].includes(j.status)
                          ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 animate-pulse'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {j.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Logs Feed */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                <span>Log Aktivitas Terkini</span>
              </h3>
              <button
                onClick={() => onNavigate('logs')}
                className="text-[11px] font-semibold text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Buka Log Terminal</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-lg">
                <Terminal className="h-6 w-6 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-xs text-slate-300 font-semibold">Sistem Siap (0 Log)</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Seluruh interaksi ekstensi dan konversi audio akan dicatat di sini secara real-time.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 font-mono text-[11px] max-h-48 overflow-y-auto pr-1">
                {logs.slice(-5).reverse().map((l) => (
                  <div key={l.id} className="flex items-start gap-2 text-slate-300">
                    <span className="text-slate-500 shrink-0">{l.timestamp}</span>
                    <span
                      className={`font-semibold shrink-0 ${
                        l.level === 'SUCCESS'
                          ? 'text-emerald-400'
                          : l.level === 'ERROR'
                          ? 'text-rose-400'
                          : l.level === 'WARN'
                          ? 'text-amber-400'
                          : 'text-cyan-400'
                      }`}
                    >
                      [{l.level}]
                    </span>
                    <span className="truncate">{l.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
