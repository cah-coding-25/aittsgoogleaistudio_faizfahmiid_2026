import React, { useMemo, useState, useEffect } from 'react';
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
  Play,
  RotateCcw,
  Activity,
  AudioWaveform,
  ChevronRight,
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

const PIPELINE_STAGES = [
  { key: 'PREP', label: 'Siapkan Teks', statuses: ['PREPARING', 'SENDING_TEXT'] },
  { key: 'AI_STUDIO', label: 'AI Studio Run', statuses: ['GENERATING'] },
  { key: 'WAIT', label: 'Tunggu Audio', statuses: ['WAITING_AUDIO'] },
  { key: 'CAPTURE', label: 'Tangkap WAV', statuses: ['DOWNLOADING', 'UPLOADING'] },
  { key: 'MP3', label: 'Konversi MP3', statuses: ['CONVERTING', 'SAVING'] },
  { key: 'VERIFY', label: 'Verifikasi', statuses: ['VERIFYING', 'COMPLETED'] },
] as const;

function getStageIndex(status?: string): number {
  if (!status) return 0;
  if (status === 'COMPLETED') return PIPELINE_STAGES.length;
  const idx = PIPELINE_STAGES.findIndex((s) => (s.statuses as readonly string[]).includes(status));
  return idx >= 0 ? idx : 0;
}

function getProgressPercent(status?: string): number {
  switch (status) {
    case 'PREPARING':
      return 16;
    case 'SENDING_TEXT':
      return 28;
    case 'GENERATING':
      return 48;
    case 'WAITING_AUDIO':
      return 64;
    case 'DOWNLOADING':
    case 'UPLOADING':
      return 78;
    case 'CONVERTING':
    case 'SAVING':
      return 90;
    case 'VERIFYING':
      return 96;
    case 'COMPLETED':
      return 100;
    default:
      return 35;
  }
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
  onNavigate,
  onStartQueue,
  onConnectExtension,
  onOpenWorkspace,
  onRetryFailed,
}) => {
  const [queueFilter, setQueueFilter] = useState<'all' | 'pending' | 'completed' | 'failed'>('all');
  const [logFilter, setLogFilter] = useState<'all' | 'SUCCESS' | 'ERROR'>('all');
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const isQueueRunning = queueState === 'RUNNING';
  const isQueuePaused = queueState === 'PAUSED';

  // Live 1-second tick only while queue is running or currentJob is active
  useEffect(() => {
    if (!isQueueRunning && !currentJob) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isQueueRunning, currentJob]);

  // Core statistics (100% preserved)
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

  const completionPct = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;
  const ringCircumference = 2 * Math.PI * 30;
  const ringOffset = ringCircumference - (completionPct / 100) * ringCircumference;

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (a, b) =>
          (Number(a.order) || Number.MAX_SAFE_INTEGER) - (Number(b.order) || Number.MAX_SAFE_INTEGER) ||
          (a.createdAt || 0) - (b.createdAt || 0)
      ),
    [jobs]
  );

  const filteredQueueJobs = useMemo(() => {
    if (queueFilter === 'pending') {
      return sortedJobs.filter((j) => j.status !== 'COMPLETED' && j.status !== 'FAILED');
    }
    if (queueFilter === 'completed') {
      return sortedJobs.filter((j) => j.status === 'COMPLETED');
    }
    if (queueFilter === 'failed') {
      return sortedJobs.filter((j) => j.status === 'FAILED');
    }
    return sortedJobs;
  }, [sortedJobs, queueFilter]);

  const filteredLogs = useMemo(() => {
    const base =
      logFilter === 'SUCCESS'
        ? logs.filter((l) => l.level === 'SUCCESS')
        : logFilter === 'ERROR'
        ? logs.filter((l) => l.level === 'ERROR' || l.level === 'WARN')
        : logs;
    return base.slice(-8).reverse();
  }, [logs, logFilter]);

  const nextPendingJob = useMemo(
    () => sortedJobs.find((j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING') || null,
    [sortedJobs]
  );

  const activeElapsedSec = currentJob?.updatedAt
    ? Math.max(0, Math.floor((nowTick - currentJob.updatedAt) / 1000))
    : 0;

  const eqHeights = [0.42, 0.85, 0.62, 1.0, 0.54, 0.9, 0.48, 0.76, 0.38];

  return (
    <div className="space-y-5 animate-fade-up-enter">
      {/* Live Studio Command Header */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800/90 bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950/95 p-4 sm:p-5 shadow-xl shadow-black/30">
        {/* Subtle Ambient Top Accent */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-px transition-opacity duration-500 ${
            isQueueRunning
              ? 'bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent opacity-100'
              : 'bg-gradient-to-r from-transparent via-slate-600/40 to-transparent opacity-70'
          }`}
        />

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: Studio Identity */}
          <div className="flex flex-wrap items-center gap-3.5 min-w-0">
            <div
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-300 ${
                isQueueRunning
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-slate-700/80 bg-slate-800/70 text-slate-300'
              }`}
            >
              {isQueueRunning && (
                <span className="pointer-events-none absolute inset-0 rounded-xl border border-cyan-400/50 animate-sonar-ring" />
              )}
              <AudioWaveform className="h-5 w-5" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-white">
                  Dashboard Monitoring
                </h2>

                {/* PC Workspace Selector */}
                <button
                  onClick={onOpenWorkspace}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-950/50 hover:bg-cyan-900/60 hover:border-cyan-400/60 px-2.5 py-1 text-xs text-cyan-200 hover:text-white transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0"
                  title="Kelola identitas perangkat dan data lokal PC ini"
                >
                  <Laptop className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span className="font-semibold text-white">{clientName}</span>
                  <span className="text-cyan-400/80">·</span>
                  <span className="text-[11px] font-mono text-cyan-300">Lokal</span>
                </button>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 tabular-nums">
                <span className={isQueueRunning ? 'text-cyan-300 font-semibold' : isQueuePaused ? 'text-amber-300 font-semibold' : 'text-slate-300 font-medium'}>
                  {isQueueRunning
                    ? 'Otomatisasi TTS Aktif Berjalan'
                    : isQueuePaused
                    ? 'Antrean Dijeda Sementara'
                    : mockMode
                    ? 'Mode Simulasi Aktif'
                    : 'Studio Siap Memproses'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {completedJobs}/{totalJobs} selesai ({completionPct}%)
                </span>
                <span aria-hidden="true">·</span>
                <span>{totalMp3} MP3 siap unduh</span>
              </div>
            </div>
          </div>

          {/* Right: Live Audio Waveform Visualizer */}
          <div
            className="hidden sm:flex items-end gap-1 h-8 px-3.5 py-2 rounded-lg border border-slate-800/80 bg-slate-950/60 shrink-0"
            aria-hidden="true"
            title={isQueueRunning ? 'Aktivitas pemrosesan suara real-time' : 'Visualizer audio standby'}
          >
            {eqHeights.map((h, i) => (
              <span
                key={i}
                className={`w-1 rounded-full transition-colors duration-300 ${
                  isQueueRunning || currentJob
                    ? 'bg-gradient-to-t from-cyan-500 to-emerald-400 animate-eq-bar'
                    : 'bg-slate-700'
                }`}
                style={{
                  height: isQueueRunning || currentJob ? `${Math.round(h * 18)}px` : `${Math.round(h * 10)}px`,
                  animationDelay: `${i * 0.11}s`,
                  animationDuration: `${0.85 + (i % 3) * 0.22}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 4 Live System Nodes (Interactive & Animated Telemetry) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Backend Online */}
        <div className="group rounded-xl border border-slate-800/90 bg-slate-900/60 hover:bg-slate-900/90 hover:border-emerald-500/35 p-3.5 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/25 transition-transform duration-200 group-hover:scale-105">
              <Server className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 font-medium truncate">Backend Local</p>
              <p className="text-xs font-bold text-emerald-400 truncate tabular-nums">Online (:3000)</p>
            </div>
          </div>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-sonar-ring" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        </div>

        {/* Audio Processor Ready */}
        <div
          onClick={() => onNavigate('converter')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onNavigate('converter');
          }}
          className="group rounded-xl border border-slate-800/90 bg-slate-900/60 hover:bg-slate-900/90 hover:border-cyan-500/35 p-3.5 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          title="Buka Konverter WAV ke MP3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/25 transition-transform duration-200 group-hover:scale-105">
              <Cpu className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 font-medium truncate">Audio Processor</p>
              <p className="text-xs font-bold text-cyan-400 truncate">Ready (WAV→MP3)</p>
            </div>
          </div>
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shrink-0" />
        </div>

        {/* Extension Chrome Connected */}
        <div
          onClick={extensionStatus.connected ? () => onNavigate('extension') : onConnectExtension}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (extensionStatus.connected) onNavigate('extension');
              else onConnectExtension();
            }
          }}
          className={`group rounded-xl border bg-slate-900/60 hover:bg-slate-900/90 p-3.5 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 cursor-pointer ${
            extensionStatus.connected
              ? 'border-slate-800/90 hover:border-emerald-500/35'
              : 'border-amber-500/30 hover:border-amber-400/60'
          }`}
          title={extensionStatus.connected ? 'Lihat status ekstensi Chrome' : 'Klik untuk menyambungkan Ekstensi Chrome'}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${
                extensionStatus.connected
                  ? 'bg-emerald-500/10 border border-emerald-500/25'
                  : 'bg-amber-500/10 border border-amber-500/25'
              }`}
            >
              <Chrome
                className={`h-4 w-4 ${
                  extensionStatus.connected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 font-medium truncate">Extension Chrome</p>
              <p
                className={`text-xs font-bold truncate ${
                  extensionStatus.connected ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {extensionStatus.connected ? 'Terhubung' : 'Belum Terhubung · Hubungkan'}
              </p>
            </div>
          </div>
          {extensionStatus.connected ? (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-sonar-ring" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shrink-0" />
          )}
        </div>

        {/* Google AI Studio Connected */}
        <div
          onClick={() => onNavigate('extension')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onNavigate('extension');
          }}
          className="group rounded-xl border border-slate-800/90 bg-slate-900/60 hover:bg-slate-900/90 hover:border-indigo-500/35 p-3.5 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          title="Cek koneksi tab Google AI Studio"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${
                extensionStatus.aiStudioConnected
                  ? 'bg-emerald-500/10 border border-emerald-500/25'
                  : 'bg-slate-800/50 border border-slate-700/50'
              }`}
            >
              <Globe2
                className={`h-4 w-4 ${
                  extensionStatus.aiStudioConnected ? 'text-emerald-400' : 'text-slate-400'
                }`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 font-medium truncate">Google AI Studio</p>
              <p
                className={`text-xs font-bold truncate ${
                  extensionStatus.aiStudioConnected ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {extensionStatus.aiStudioConnected ? 'Tab Terdeteksi' : 'Tab Belum Terbuka'}
              </p>
            </div>
          </div>
          {extensionStatus.aiStudioConnected ? (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-sonar-ring" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-slate-600 shrink-0" />
          )}
        </div>
      </div>

      {/* Interactive Progress Overview & 7 Statistics Cards */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch">
        {/* Radial Progress Summary Card */}
        <div className="xl:col-span-3 rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex items-center gap-4">
          <div className="relative h-20 w-20 shrink-0 flex items-center justify-center">
            <svg className="h-20 w-20 -rotate-90" viewBox="0 0 72 72">
              <circle
                cx="36"
                cy="36"
                r="30"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                className="text-slate-800"
              />
              <circle
                cx="36"
                cy="36"
                r="30"
                fill="none"
                stroke="url(#dashProgressGrad)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                className="transition-all duration-700 ease-out"
              />
              <defs>
                <linearGradient id="dashProgressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center tabular-nums">
              <span className="text-base font-extrabold text-white leading-none">{completionPct}%</span>
              <span className="text-[10px] text-slate-400 mt-0.5">Selesai</span>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white">Progres Produksi</span>
              <Activity className={`h-3.5 w-3.5 ${isQueueRunning ? 'text-cyan-400' : 'text-slate-500'}`} />
            </div>
            <p className="text-[11px] text-slate-400 tabular-nums">
              {completedJobs} dari {totalJobs} adegan telah selesai dirender
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 7 Clickable Statistics Cards */}
        <div className="xl:col-span-9 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <button
            onClick={() => onNavigate('text_manager')}
            className="group text-left rounded-xl border border-slate-800/90 bg-slate-900/55 hover:bg-slate-900/90 hover:border-cyan-500/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <FileText className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span className="truncate">Total Teks</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-cyan-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-white tabular-nums">{totalJobs}</div>
          </button>

          <button
            onClick={() => onNavigate('queue')}
            className="group text-left rounded-xl border border-slate-800/90 bg-slate-900/55 hover:bg-slate-900/90 hover:border-amber-500/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="truncate">Menunggu</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-amber-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-amber-300 tabular-nums">{pendingJobs}</div>
          </button>

          <button
            onClick={() => onNavigate('queue')}
            className={`group text-left rounded-xl border bg-slate-900/55 hover:bg-slate-900/90 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer ${
              processingJobs > 0
                ? 'border-blue-500/40 shadow-sm shadow-blue-500/10'
                : 'border-slate-800/90 hover:border-blue-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <Loader2 className={`h-3.5 w-3.5 text-blue-400 shrink-0 ${processingJobs > 0 ? 'animate-spin' : ''}`} />
                <span className="truncate">Sedang Diproses</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-blue-400 tabular-nums">{processingJobs}</div>
          </button>

          <button
            onClick={() => onNavigate('audio_library')}
            className="group text-left rounded-xl border border-slate-800/90 bg-slate-900/55 hover:bg-slate-900/90 hover:border-emerald-500/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="truncate">Berhasil</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-emerald-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-emerald-400 tabular-nums">{completedJobs}</div>
          </button>

          <button
            onClick={() => onNavigate('failed_jobs')}
            className={`group text-left rounded-xl border bg-slate-900/55 hover:bg-slate-900/90 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer ${
              failedJobs > 0 ? 'border-rose-500/40' : 'border-slate-800/90 hover:border-rose-500/40'
            }`}
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                <span className="truncate">Gagal</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-rose-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-rose-400 tabular-nums">{failedJobs}</div>
          </button>

          <button
            onClick={() => onNavigate('audio_library')}
            className="group text-left rounded-xl border border-slate-800/90 bg-slate-900/55 hover:bg-slate-900/90 hover:border-indigo-500/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <Music className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <span className="truncate">Total MP3</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-indigo-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-indigo-300 tabular-nums">{totalMp3}</div>
          </button>

          <button
            onClick={() => onNavigate('audio_library')}
            className="group text-left rounded-xl border border-slate-800/90 bg-slate-900/55 hover:bg-slate-900/90 hover:border-purple-500/40 p-3.5 transition-all duration-200 hover:-translate-y-0.5 cursor-pointer col-span-2 sm:col-span-1"
          >
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <HardDrive className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                <span className="truncate">Total Ukuran</span>
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 text-purple-400 transition-opacity shrink-0" />
            </div>
            <div className="mt-2.5 text-xl font-extrabold text-purple-300 tabular-nums">{totalSizeMb} MB</div>
          </button>
        </div>
      </div>

      {/* Live Pipeline Visualizer (Active Job OR Standby Studio Monitor) */}
      {currentJob ? (
        <div className="relative overflow-hidden rounded-2xl border border-cyan-500/40 bg-slate-900/90 p-5 shadow-xl shadow-cyan-950/25">
          {/* Flowing shimmer bar */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-slate-800/80">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pipeline-shimmer" />
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 animate-sonar-ring" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-400" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white truncate tabular-nums">
                  Pekerjaan Sedang Aktif: #{currentJob.order} — {currentJob.filename}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5 tabular-nums">
                  <span>Status: <strong className="text-cyan-300">{currentJob.status}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>Durasi tahap: {activeElapsedSec}d</span>
                  <span aria-hidden="true">·</span>
                  <span>{currentJob.text.length} karakter</span>
                  <span aria-hidden="true">·</span>
                  <span>Percobaan: {currentJob.retryCount || 0}/{currentJob.maxRetries}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onNavigate('queue')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-950/50 hover:bg-cyan-900/60 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Pantau Antrean</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 6-Stage Animated Pipeline Stepper */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            {PIPELINE_STAGES.map((stage, idx) => {
              const currentIdx = getStageIndex(currentJob.status);
              const isDone = idx < currentIdx;
              const isActive = idx === currentIdx;
              return (
                <div
                  key={stage.key}
                  className={`relative rounded-lg border px-3 py-2 text-xs transition-all duration-300 ${
                    isDone
                      ? 'border-emerald-500/35 bg-emerald-950/30 text-emerald-300'
                      : isActive
                      ? 'border-cyan-400/60 bg-cyan-950/45 text-white shadow-sm shadow-cyan-500/20'
                      : 'border-slate-800 bg-slate-950/50 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="font-mono text-[10px] font-bold tabular-nums">
                      0{idx + 1}
                    </span>
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin shrink-0" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-slate-700 shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 font-semibold truncate">{stage.label}</p>
                </div>
              );
            })}
          </div>

          {/* Quote Box & Progress Track */}
          <div className="rounded-lg bg-slate-950/90 p-3.5 border border-slate-800/90 mb-3">
            <p className="text-xs text-slate-300 italic line-clamp-2 leading-relaxed">
              "{currentJob.text}"
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-400 font-medium tabular-nums">
              <span>Alur: Teks → AI Studio → Run → Deteksi WAV → Konversi MP3 → Verifikasi</span>
              <span className="text-cyan-300 font-semibold">{getProgressPercent(currentJob.status)}%</span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="relative h-full overflow-hidden bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-500 ease-out"
                style={{ width: `${getProgressPercent(currentJob.status)}%` }}
              >
                <div className="absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pipeline-shimmer" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/50 p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/70 text-cyan-400">
              <Activity className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">
                {nextPendingJob
                  ? `Siap Lanjut ke Scene Berikutnya: #${nextPendingJob.order} — ${nextPendingJob.filename}`
                  : totalJobs > 0 && completedJobs === totalJobs
                  ? `Seluruh ${completedJobs} Pekerjaan Selesai`
                  : 'Monitor Pipeline Otomatisasi Siap'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {nextPendingJob
                  ? nextPendingJob.text
                  : totalJobs > 0 && failedJobs > 0
                  ? `${failedJobs} pekerjaan gagal siap dicoba ulang atau lanjutkan antrean baru.`
                  : 'Tambahkan teks baru atau klik Mulai Antrean untuk memproses audio melalui Google AI Studio.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {failedJobs > 0 && onRetryFailed && (
              <button
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1.5 text-xs font-bold text-amber-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                <span>Ulangi Gagal ({failedJobs})</span>
              </button>
            )}
            {nextPendingJob && (
              <button
                onClick={onStartQueue}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 px-3.5 py-1.5 text-xs font-bold text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current shrink-0" />
                <span>Jalankan (#{nextPendingJob.order})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Flexible Split Monitoring Grid: Next Jobs + Live Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {/* Next Jobs in Queue with Interactive Filter Tabs */}
        <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>Antrean Pekerjaan Berikutnya</span>
              </h3>

              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg bg-slate-950/80 border border-slate-800 p-0.5 text-[11px]">
                  {(
                    [
                      { id: 'all', label: `Semua (${totalJobs})` },
                      { id: 'pending', label: `Tunggu (${pendingJobs})` },
                      { id: 'completed', label: `Sukses (${completedJobs})` },
                      { id: 'failed', label: `Gagal (${failedJobs})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setQueueFilter(tab.id)}
                      className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap cursor-pointer tabular-nums ${
                        queueFilter === tab.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => onNavigate('queue')}
                  className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <span>Lihat Semua</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                </button>
              </div>
            </div>

            {filteredQueueJobs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-lg">
                <Clock className="h-6 w-6 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-xs text-slate-300 font-semibold">
                  {totalJobs === 0
                    ? 'Antrean Pekerjaan Kosong (0)'
                    : 'Tidak ada pekerjaan pada filter ini'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {totalJobs === 0
                    ? 'Tambahkan teks pertama Anda melalui tombol Tambah Teks atau Import.'
                    : 'Pilih filter lain atau klik Lihat Semua untuk mengelola antrean.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {filteredQueueJobs.slice(0, 6).map((j) => {
                  const isActiveRow = currentJob?.id === j.id;
                  return (
                    <div
                      key={j.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs transition-all duration-150 ${
                        isActiveRow
                          ? 'border-cyan-500/50 bg-cyan-950/25'
                          : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950/90'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-[11px] font-bold text-cyan-400 shrink-0 tabular-nums">
                          #{j.order}
                        </span>
                        <span className="font-mono font-medium text-slate-200 truncate max-w-[140px]">
                          {j.filename}
                        </span>
                        <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
                          {j.text}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                          j.status === 'COMPLETED'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                            : j.status === 'FAILED'
                            ? 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
                            : ['PREPARING', 'SENDING_TEXT', 'GENERATING', 'WAITING_AUDIO', 'DOWNLOADING', 'UPLOADING', 'CONVERTING', 'SAVING', 'VERIFYING'].includes(j.status)
                            ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Logs Feed with Interactive Level Filter */}
        <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>Log Aktivitas Terkini</span>
              </h3>

              <div className="flex items-center gap-2">
                <div className="inline-flex items-center rounded-lg bg-slate-950/80 border border-slate-800 p-0.5 text-[11px]">
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      { id: 'SUCCESS', label: 'Sukses' },
                      { id: 'ERROR', label: 'Kendala' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setLogFilter(tab.id)}
                      className={`rounded-md px-2 py-1 font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        logFilter === tab.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => onNavigate('logs')}
                  className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  <span>Buka Log Terminal</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                </button>
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-500 border border-dashed border-slate-800 rounded-lg">
                <Terminal className="h-6 w-6 mx-auto mb-2 opacity-30 text-slate-400" />
                <p className="text-xs text-slate-300 font-semibold">
                  {logs.length === 0 ? 'Sistem Siap (0 Log)' : 'Belum ada log di kategori ini'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Seluruh interaksi ekstensi dan konversi audio akan dicatat di sini secara real-time.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 font-mono text-[11px] max-h-60 overflow-y-auto pr-1">
                {filteredLogs.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1 hover:bg-slate-950/70 transition-colors text-slate-300"
                  >
                    <span className="text-slate-500 shrink-0 tabular-nums">
                      {l.timestamp?.includes('T') ? new Date(l.timestamp).toLocaleTimeString() : l.timestamp}
                    </span>
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
                    <span className="break-words min-w-0 flex-1">{l.message}</span>
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
