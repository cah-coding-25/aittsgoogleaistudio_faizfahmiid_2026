import React, { useState } from 'react';
import { Terminal, Trash2, Download, Search, AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';
import { ActivityLog } from '../types';

interface LogsPageProps {
  logs: ActivityLog[];
  onClearLogs: () => Promise<boolean>;
}

export const LogsPage: React.FC<LogsPageProps> = ({ logs, onClearLogs }) => {
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'>('ALL');
  const [search, setSearch] = useState('');

  const filteredLogs = logs.filter((log) => {
    if (filterLevel !== 'ALL' && log.level !== filterLevel) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleDownloadLogs = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.jobId ? `(${l.jobId}) ` : ''}${l.message}${l.details ? ` - Details: ${l.details}` : ''}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI_TTS_Logs_${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'SUCCESS':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-500/30';
      case 'ERROR':
        return 'text-rose-400 bg-rose-950/60 border-rose-500/30';
      case 'WARN':
        return 'text-amber-400 bg-amber-950/60 border-amber-500/30';
      default:
        return 'text-cyan-400 bg-cyan-950/60 border-cyan-500/30';
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Terminal className="h-5 w-5 text-cyan-400" />
            <span>Activity Logs & System Diagnostics</span>
          </h2>
          <p className="text-xs text-slate-400">
            Pencatatan real-time seluruh tahapan generasi suara, status ekstensi, konversi audio, dan riwayat kesalahan.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Ekspor Log (.log)</span>
          </button>
          <button
            onClick={onClearLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-950/50 hover:border-rose-500/40 transition-colors cursor-pointer disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Bersihkan Log</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Cari pesan log..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>

        {/* Level Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setFilterLevel(lvl)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                filterLevel === lvl
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal View */}
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="ml-2 text-slate-300 font-semibold">console.out</span>
          </div>
          <span>{filteredLogs.length} entri log</span>
        </div>

        <div className="space-y-2 max-h-[550px] overflow-y-auto pr-2 text-xs">
          {filteredLogs.map((log) => (
            <div key={log.id} className="flex flex-col sm:flex-row sm:items-baseline gap-2 py-1 border-b border-slate-900/60">
              <span className="text-slate-500 shrink-0 text-[11px]">{log.timestamp}</span>
              <span className={`rounded px-1.5 py-0.2 text-[10px] font-bold border shrink-0 ${getLevelBadge(log.level)}`}>
                {log.level}
              </span>
              <div className="flex-1 break-words">
                <span className="text-slate-200">{log.message}</span>
                {log.details && (
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5 bg-slate-900 p-1 rounded border border-slate-800">
                    {log.details}
                  </p>
                )}
              </div>
            </div>
          ))}

          {filteredLogs.length === 0 && (
            <div className="py-12 text-center text-slate-500">
              Tidak ada log yang cocok dengan filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
