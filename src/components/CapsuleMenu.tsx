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
      {/* 1. DESKTOP & TABLET: Dropdown Floating Capsule from Top-Left */}
      {/* ============================================================== */}
      <div className="hidden md:block">
        {/* Floating Capsule Container */}
        {isMenuOpen && (
          <div
            className="fixed top-18 left-4 z-50 flex flex-col items-center animate-in fade-in slide-in-from-top-4 duration-300"
            role="navigation"
            aria-label="Desktop Capsule Menu"
          >
            {/* The Capsule Dock (Only Logos / Icons for sleek aesthetics) */}
            <div className="rounded-full border border-cyan-500/30 bg-slate-950/90 backdrop-blur-2xl p-2 shadow-2xl shadow-cyan-950/40 flex flex-col items-center gap-1.5 transition-all">
              {/* Header Indicator */}
              <div
                className="h-1.5 w-6 rounded-full bg-cyan-500/40 mb-1"
                title="Kapsul Menu Aktif"
              />

              {primaryMenuItems.map((item, index) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                return (
                  <div
                    key={item.id}
                    className="relative flex items-center"
                    onMouseEnter={() => setHoveredTab(item.id)}
                    onMouseLeave={() => setHoveredTab(null)}
                    style={{
                      animationDelay: `${index * 35}ms`,
                    }}
                  >
                    <button
                      onClick={() => onSelectTab(item.id)}
                      className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-lg shadow-cyan-500/30 scale-105'
                          : 'text-slate-400 hover:text-white hover:bg-slate-850 hover:scale-105'
                      }`}
                      aria-label={item.label}
                    >
                      <Icon className="h-4.5 w-4.5" />

                      {/* Mini Badge dot if there are pending/failed items */}
                      {item.badge !== undefined && (
                        <span
                          className={`absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] shadow-sm ${item.badgeColor}`}
                        >
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </button>

                    {/* Smooth Floating Tooltip to the Right */}
                    {hoveredTab === item.id && (
                      <div className="absolute left-13 z-50 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs font-semibold text-white shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-left-2 duration-150">
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
              <div className="my-1 h-[1px] w-6 bg-slate-800" />

              {/* Restart Sistem Button inside Capsule */}
              <div
                className="relative flex items-center"
                onMouseEnter={() => setHoveredTab('restart')}
                onMouseLeave={() => setHoveredTab(null)}
              >
                <button
                  onClick={onOpenResetModal}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 hover:scale-105 transition-all cursor-pointer"
                  aria-label="Restart Sistem"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                {hoveredTab === 'restart' && (
                  <div className="absolute left-13 z-50 whitespace-nowrap rounded-lg border border-rose-500/40 bg-rose-950/95 px-3 py-1.5 text-xs font-bold text-rose-200 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-left-2 duration-150">
                    Restart & Reset Total Sistem
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 2. ANDROID & MOBILE: Bottom Floating Capsule Bar                */}
      {/* ============================================================== */}
      <div className="block md:hidden">
        <nav
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-md rounded-full border border-slate-700/80 bg-slate-950/95 backdrop-blur-2xl shadow-2xl shadow-black/80 px-2 py-1.5 flex items-center justify-around gap-1 transition-all"
          aria-label="Android Floating Capsule Navigation"
        >
          {primaryMenuItems.slice(0, 5).map((item) => {
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
              >
                <Icon className="h-4.5 w-4.5" />

                {/* Badge Dot */}
                {item.badge !== undefined && (
                  <span
                    className={`absolute 0 top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] ${item.badgeColor}`}
                  >
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* More / Settings Menu for Mobile */}
          <button
            onClick={() => onSelectTab(currentTab === 'settings' ? 'extension' : 'settings')}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer ${
              currentTab === 'settings' || currentTab === 'extension' || currentTab === 'logs'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            aria-label="Pengaturan"
          >
            <SettingsIcon className="h-4.5 w-4.5" />
          </button>

          {/* Quick Restart in Mobile Capsule */}
          <button
            onClick={onOpenResetModal}
            className="flex h-10 w-10 items-center justify-center rounded-full text-rose-400 hover:bg-rose-500/20 active:scale-90 transition-all cursor-pointer"
            aria-label="Restart Sistem"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </nav>
      </div>
    </>
  );
};
