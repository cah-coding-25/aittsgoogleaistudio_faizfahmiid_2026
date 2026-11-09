import React from 'react';
import { Volume2, ChevronDown } from 'lucide-react';

interface NavbarProps {
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  mockMode?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  isMenuOpen,
  onToggleMenu,
  mockMode,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-xl px-3 sm:px-5 py-3">
      <div className="flex items-center justify-between">
        {/* Left: Capsule Menu Trigger & Clean Branding */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Tombol Utama Kapsul Menu di Pojok Kiri Atas */}
          <button
            onClick={onToggleMenu}
            className={`group flex items-center gap-2 rounded-full border px-3.5 py-1.5 transition-all duration-300 cursor-pointer shadow-lg active:scale-95 ${
              isMenuOpen
                ? 'border-cyan-400 bg-cyan-950/90 shadow-cyan-500/20 ring-2 ring-cyan-500/30'
                : 'border-slate-700 bg-slate-900/90 hover:border-cyan-500/50 hover:bg-slate-850'
            }`}
            title="Klik untuk membuka / menutup Kapsul Menu Navigasi"
            aria-label="Tombol Utama Menu Kapsul"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 text-white shadow-md">
              <Volume2 className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <span className="bg-gradient-to-r from-cyan-300 to-indigo-300 bg-clip-text text-transparent">
                MENU
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-cyan-400 transition-transform duration-300 ${
                  isMenuOpen ? 'rotate-180 text-cyan-300' : 'group-hover:translate-y-0.5'
                }`}
              />
            </div>
          </button>

          {/* Clean App Identity */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-extrabold tracking-tight text-white sm:text-base">
                AI TTS STUDIO
              </h1>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-400">
                V1.0
              </span>
              <span className="inline-block rounded-md border border-indigo-500/40 bg-indigo-950/70 px-2 py-0.5 text-[10px] font-bold text-indigo-300 shadow-sm shadow-indigo-950/30">
                by: Faiz_Fahmi_ID
              </span>
              {mockMode && (
                <span className="rounded-md border border-amber-500/30 bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                  MOCK
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 truncate max-w-[260px] sm:max-w-none">
              Otomatisasi TTS Google AI Studio • WAV ke MP3 (192 kbps)
            </p>
          </div>
        </div>

        {/* Right: Kept uncluttered and minimalist as requested */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800/80 rounded-full px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Studio Siap</span>
          </span>
        </div>
      </div>
    </header>
  );
};
