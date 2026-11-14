import React from 'react';
import {
  LayoutDashboard,
  FileText,
  ListOrdered,
  Music,
  AlertTriangle,
  Puzzle,
  Settings as SettingsIcon,
  Terminal,
  Laptop,
  FileAudio,
} from 'lucide-react';

export type TabId =
  | 'dashboard'
  | 'text_manager'
  | 'queue'
  | 'audio_library'
  | 'converter'
  | 'failed_jobs'
  | 'extension'
  | 'settings'
  | 'logs';

interface SidebarProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  onOpenGuide: () => void;
  pendingCount: number;
  failedCount: number;
  audioCount: number;
  clientName?: string;
  onOpenWorkspace?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  pendingCount,
  failedCount,
  audioCount,
  clientName,
  onOpenWorkspace,
}) => {
  const menuItems: Array<{
    id: TabId;
    label: string;
    icon: React.ElementType;
    badge?: number;
    badgeColor?: string;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'text_manager', label: 'Text Manager', icon: FileText },
    {
      id: 'queue',
      label: 'Generation Queue',
      icon: ListOrdered,
      badge: pendingCount > 0 ? pendingCount : undefined,
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    },
    {
      id: 'audio_library',
      label: 'Audio Library',
      icon: Music,
      badge: audioCount > 0 ? audioCount : undefined,
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    },
    { id: 'converter', label: 'Konverter WAV ke MP3', icon: FileAudio },
    {
      id: 'failed_jobs',
      label: 'Failed Jobs',
      icon: AlertTriangle,
      badge: failedCount > 0 ? failedCount : undefined,
      badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
    { id: 'extension', label: 'Extension & Setup', icon: Puzzle },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'logs', label: 'Activity Logs', icon: Terminal },
  ];

  return (
    <aside className="w-full md:w-64 shrink-0 border-r border-slate-800 bg-slate-950/70 p-3 flex md:flex-col justify-between overflow-x-auto md:overflow-y-auto">
      <nav className="flex md:flex-col gap-1 w-full min-w-max md:min-w-0">
        <div className="hidden md:block px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Menu Utama
        </div>

        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-950/80 to-indigo-950/80 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-900/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-300'
                  }`}
                />
                <span>{item.label}</span>
              </div>

              {item.badge !== undefined && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                    item.badgeColor || 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="hidden md:block border-t border-slate-800/80 pt-3 px-3 text-[11px] text-slate-500 space-y-2">
        {onOpenWorkspace && (
          <button
            onClick={onOpenWorkspace}
            className="w-full text-left rounded-lg bg-cyan-950/30 p-2.5 border border-cyan-500/20 text-[10px] cursor-pointer hover:bg-cyan-900/40 transition-colors"
            title="Klik untuk membuka pengaturan penyimpanan lokal PC ini"
          >
            <div className="flex items-center justify-between text-cyan-300 font-semibold mb-0.5">
              <span className="flex items-center gap-1.5">
                <Laptop className="h-3.5 w-3.5 text-cyan-400" />
                <span className="truncate max-w-[110px]">{clientName || 'PC Lokal'}</span>
              </span>
              <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 py-0.2 rounded font-mono">
                Terisolasi
              </span>
            </div>
            <span className="text-slate-400 block text-[9px]">Penyimpanan lokal khusus PC ini</span>
          </button>
        )}

        <div>
          <p className="flex items-center gap-1.5 font-medium text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Local Engine Active</span>
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">Port 3000 • Strict FIFO</p>
        </div>

        <div className="rounded-lg bg-slate-900/80 p-2.5 border border-slate-800 text-[10px]">
          <span className="text-slate-400 block">Dibuat & Dikembangkan:</span>
          <span className="font-bold text-indigo-300 tracking-wide text-[11px]">
            by: Faiz_Fahmi_ID
          </span>
        </div>
      </div>
    </aside>
  );
};
