import React, { useState } from 'react';
import { X, Plus, AlertCircle, FileText, Layers, Check } from 'lucide-react';
import { TTSJob } from '../types';

interface AddTextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddJobs: (items: Array<{ filename: string; text: string }>) => Promise<boolean>;
  existingJobs: TTSJob[];
}

export const AddTextModal: React.FC<AddTextModalProps> = ({
  isOpen,
  onClose,
  onAddJobs,
  existingJobs,
}) => {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  // Single mode state
  const [singleFilename, setSingleFilename] = useState('');
  const [singleText, setSingleText] = useState('');

  // Bulk mode state
  const [bulkContent, setBulkContent] = useState('');
  const [bulkPrefix, setBulkPrefix] = useState('001-audio');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const existingNames = new Set(existingJobs.map((j) => j.filename.toLowerCase()));
  const isDuplicateSingle = singleFilename.trim() && existingNames.has(singleFilename.trim().toLowerCase());

  // Parse bulk lines: "filename|text" or plain lines
  const parsedBulkItems = bulkContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => {
      if (line.includes('|')) {
        const parts = line.split('|');
        return {
          filename: parts[0].trim(),
          text: parts.slice(1).join('|').trim(),
        };
      } else {
        const padded = String(existingJobs.length + idx + 1).padStart(3, '0');
        return {
          filename: `${padded}-${bulkPrefix.replace(/^[0-9]+-?/, '') || 'track'}`,
          text: line,
        };
      }
    })
    .filter((item) => item.text.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'single') {
        if (!singleFilename.trim()) {
          throw new Error('Nama file wajib diisi.');
        }
        if (!singleText.trim()) {
          throw new Error('Isi teks TTS tidak boleh kosong.');
        }

        const ok = await onAddJobs([
          {
            filename: singleFilename.trim(),
            text: singleText.trim(),
          },
        ]);

        if (ok) {
          setSingleFilename('');
          setSingleText('');
          onClose();
        }
      } else {
        if (parsedBulkItems.length === 0) {
          throw new Error('Tidak ada baris teks valid yang terdeteksi.');
        }

        const ok = await onAddJobs(parsedBulkItems);
        if (ok) {
          setBulkContent('');
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || 'Gagal menambahkan teks.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">Tambah Pekerjaan Suara (TTS)</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-5 pt-3">
          <button
            type="button"
            onClick={() => setMode('single')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-semibold transition-all ${
              mode === 'single'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Mode A — Single Input</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('bulk')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-semibold transition-all ${
              mode === 'bulk'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Mode B — Bulk Input ({parsedBulkItems.length} baris)</span>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'single' ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Nama File (tanpa .wav / .mp3)
                  </label>
                  {isDuplicateSingle && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertCircle className="h-3 w-3" />
                      <span>Nama file sudah ada (akan di-disambiguasi otomatis)</span>
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Contoh: 001-pembukaan"
                  value={singleFilename}
                  onChange={(e) => setSingleFilename(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Isi Teks TTS yang akan Dibaca AI
                </label>
                <textarea
                  rows={5}
                  placeholder="Masukkan kalimat atau paragraf yang ingin dihasilkan suaranya..."
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none resize-y"
                  required
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {singleText.length} karakter • perkiraan durasi: ~{Math.max(1, Math.round(singleText.length / 15))} detik
                </p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Prefix Penamaan Otomatis (jika baris tidak menyertakan pemisah '|')
                </label>
                <input
                  type="text"
                  value={bulkPrefix}
                  onChange={(e) => setBulkPrefix(e.target.value)}
                  placeholder="audio"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Tempel Banyak Teks Sekaligus
                </label>
                <p className="text-[11px] text-slate-400 mb-2">
                  Format per baris: <code className="text-cyan-300">nama_file|isi teks suara</code> atau cukup satu baris teks narasi.
                </p>
                <textarea
                  rows={8}
                  placeholder={`001-pembukaan|Assalamualaikum warahmatullahi wabarakatuh...\n002-narasi|Selamat datang di acara kami hari ini...\n003-penutup|Terima kasih telah mendengarkan.`}
                  value={bulkContent}
                  onChange={(e) => setBulkContent(e.target.value)}
                  className="w-full font-mono text-[11px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none resize-y"
                  required
                />
              </div>

              {parsedBulkItems.length > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[11px] font-semibold text-slate-400 mb-2">
                    Preview ({parsedBulkItems.length} pekerjaan terdeteksi):
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 pr-2">
                    {parsedBulkItems.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className="font-mono text-cyan-400 shrink-0 font-medium">{item.filename}:</span>
                        <span className="truncate text-slate-300">{item.text}</span>
                      </div>
                    ))}
                    {parsedBulkItems.length > 5 && (
                      <div className="text-[10px] text-slate-500 italic">
                        ...dan {parsedBulkItems.length - 5} pekerjaan lainnya
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 transition-all cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{loading ? 'Menyimpan...' : mode === 'single' ? 'Tambah Pekerjaan' : `Tambah ${parsedBulkItems.length} Pekerjaan`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
