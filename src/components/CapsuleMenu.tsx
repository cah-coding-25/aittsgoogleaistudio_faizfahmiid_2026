import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  ListOrdered,
  Music,
  AlertTriangle,
  Puzzle,
  Settings as SettingsIcon,
  Terminal,
  RotateCcw,
  Laptop,
  ChevronDown,
  Sparkles,
  X,
  Volume2,
  FileAudio,
} from 'lucide-react';
import { TabId } from './Sidebar';

interface CapsuleMenuProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  pendingCount: number;
  failedCount: number;
  audioCount: number;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onOpenResetModal: () => void;
  onOpenWorkspace?: () => void;
  clientName?: string;
}

export const CapsuleMenu: React.FC<CapsuleMenuProps> = ({
  currentTab,
  onSelectTab,
  pendingCount,
  failedCount,
  audioCount,
  isMenuOpen,
  onToggleMenu,
  onOpenResetModal,
  onOpenWorkspace,
  clientName,
}) => {
  const [hoveredTab, setHoveredTab] = useState<TabId | 'restart' | null>(null);

  const primaryMenuItems: Array<{
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
      badgeColor: 'bg-cyan-500 text-slate-950 font-bold',
    },
    {
      id: 'audio_library',
      label: 'Audio Library',
      icon: Music,
      badge: audioCount > 0 ? audioCount : undefined,
      badgeColor: 'bg-indigo-500 text-white font-bold',
    },
    { id: 'converter', label: 'Konverter WAV ke MP3', icon: FileAudio },
    {
      id: 'failed_jobs',
      label: 'Failed Jobs',
      icon: AlertTriangle,
      badge: failedCount > 0 ? failedCount : undefined,
      badgeColor: 'bg-rose-500 text-white font-bold',
    },
    { id: 'extension', label: 'Extension Setup', icon: Puzzle },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'logs', label: 'Activity Logs', icon: Terminal },
  ];

  return (
    <>
      {/* ============================================================== */}
      {/* 1. DESKTOP & TABLET (Landscape): Floating Capsule from Left     */}
      {/* ============================================================== */}
      <div className="hidden md:block">
        {/* Floating Capsule Container (Clean, Static, Professional - No Sliding Lines) */}
        {isMenuOpen && (
          <div
            className="fixed top-16 lg:top-18 left-3 lg:left-4 z-40 flex flex-col items-center max-h-[calc(100vh-5rem)]"
            role="navigation"
            aria-label="Desktop Capsule Menu"
          >
            {/* The Capsule Dock (Clean, sleek aesthetic without sliding animations) */}
            <div className="rounded-full border border-slate-800 bg-slate-950/95 backdrop-blur-2xl p-1.5 lg:p-2 shadow-xl shadow-black/60 flex flex-col items-center gap-1.5 overflow-y-auto no-scrollbar max-h-[calc(100vh-5.5rem)]">
              {primaryMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                return (
                  <div
                    key={item.id}
                    className="relative flex items-center shrink-0"
                    onMouseEnter={() => setHoveredTab(item.id)}
                    onMouseLeave={() => setHoveredTab(null)}
                  >
                    <button
                      onClick={() => onSelectTab(item.id)}
                      className={`relative flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-full transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-500/25'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                      }`}
                      aria-label={item.label}
                    >
                      <Icon className="h-4 w-4 lg:h-4.5 lg:w-4.5" />

                      {/* Mini Badge dot if there are pending/failed items */}
                      {item.badge !== undefined && (
                        <span
                          className={`absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] shadow-sm ${item.badgeColor}`}
                        >
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </button>

                    {/* Clean Floating Tooltip to the Right */}
                    {hoveredTab === item.id && (
                      <div className="absolute left-12 lg:left-13 z-50 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-md">
                        <div className="flex items-center gap-2">
                          <span>{item.label}</span>
                          {item.badge !== undefined && (
                            <span
                              className={`rounded-full px-1.5 py-0.2 text-[10px] ${item.badgeColor}`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Separator inside capsule */}
              <div className="my-0.5 h-[1px] w-5 lg:w-6 bg-slate-800 shrink-0" />

              {/* Restart Sistem Button inside Capsule */}
              <div
                className="relative flex items-center shrink-0"
                onMouseEnter={() => setHoveredTab('restart')}
                onMouseLeave={() => setHoveredTab(null)}
              >
                <button
                  onClick={onOpenResetModal}
                  className="flex h-9 w-9 lg:h-10 lg:w-10 items-center justify-center rounded-full text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 hover:scale-105 transition-all cursor-pointer"
                  aria-label="Restart Sistem"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                {hoveredTab === 'restart' && (
                  <div className="absolute left-12 lg:left-13 z-50 whitespace-nowrap rounded-lg border border-rose-500/40 bg-rose-950/95 px-3 py-1.5 text-xs font-bold text-rose-200 shadow-xl backdrop-blur-md">
                    Restart & Reset Total Sistem
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 2. ANDROID & MOBILE: Full Drawer Modal when MENU is Open        */}
      {/* ============================================================== */}
      {isMenuOpen && (
        <div className="block md:hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-3 flex flex-col justify-end">
          <div className="w-full max-w-lg mx-auto rounded-3xl border border-slate-700/80 bg-slate-950/95 shadow-2xl p-4 flex flex-col max-h-[85vh] overflow-hidden">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-md">
                  <Volume2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>AI TTS STUDIO</span>
                    <span className="text-[9px] text-cyan-400 bg-cyan-950/80 px-1.5 py-0.2 rounded font-mono">
                      V1.0
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Navigasi Cepat Seluruh Fitur Studio
                  </p>
                </div>
              </div>
              <button
                onClick={onToggleMenu}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white"
                aria-label="Tutup Menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Menu Items List (Touch-Friendly $\ge 44px$) */}
            <div className="flex-1 overflow-y-auto py-2 space-y-1.5 pr-1">
              {primaryMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      onToggleMenu();
                    }}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer min-h-[44px] ${
                      isActive
                        ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-500/20'
                        : 'bg-slate-900/60 text-slate-300 hover:bg-slate-850 hover:text-white border border-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <span>{item.label}</span>
                    </div>

                    {item.badge !== undefined && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.badgeColor}`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Bottom Actions inside Mobile Drawer */}
            <div className="pt-3 border-t border-slate-800 grid grid-cols-2 gap-2 shrink-0">
              {onOpenWorkspace && (
                <button
                  onClick={() => {
                    onOpenWorkspace();
                    onToggleMenu();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-950/40 p-2 text-xs font-semibold text-cyan-200 hover:text-white"
                >
                  <Laptop className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="truncate">Workspace PC</span>
                </button>
              )}

              <button
                onClick={() => {
                  onOpenResetModal();
                  onToggleMenu();
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-2 text-xs font-bold text-rose-300 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Restart Total</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. ANDROID & MOBILE: Bottom Floating Quick Capsule Bar          */}
      {/* ============================================================== */}
      <div className="block md:hidden">
        <nav
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-sm rounded-full border border-slate-700/80 bg-slate-950/95 backdrop-blur-2xl shadow-2xl shadow-black/80 px-2 py-1.5 flex items-center justify-around gap-1 transition-all"
          aria-label="Android Floating Capsule Navigation"
        >
          {primaryMenuItems.slice(0, 4).map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-md shadow-cyan-500/30 scale-105'
                    : 'text-slate-400 hover:text-slate-200 active:scale-95'
                }`}
                aria-label={item.label}
                title={item.label}
              >
                <Icon className="h-4.5 w-4.5" />

                {item.badge !== undefined && (
                  <span
                    className={`absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] ${item.badgeColor}`}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* All Features Drawer Button */}
          <button
            onClick={onToggleMenu}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer ${
              isMenuOpen
                ? 'bg-cyan-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200 active:scale-95'
            }`}
            aria-label="Buka Semua Menu"
            title="Buka Semua Menu"
          >
            <ChevronDown className={`h-4.5 w-4.5 ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>
        </nav>
      </div>
    </>
  );
};
