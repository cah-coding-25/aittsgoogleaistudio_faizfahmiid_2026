import React, { useState } from 'react';
import {
  Settings as SettingsIcon,
  Save,
  Check,
  AlertCircle,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  Download,
  Info,
  Folder,
} from 'lucide-react';
import { AppSettings } from '../types';
import { getClientId, getClientName } from '../services/clientWorkspace';

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (newSettings: Partial<AppSettings>) => Promise<boolean>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onSaveSettings,
}) => {
  const [formData, setFormData] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const ok = await onSaveSettings(formData);
      if (ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        throw new Error('Gagal menyimpan pengaturan.');
      }
    } catch (err: any) {
      setError(err.message || 'Kesalahan saat menyimpan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-cyan-400" />
          <span>Pengaturan Sistem & Konfigurasi Audio</span>
        </h2>
        <p className="text-xs text-slate-400">
          Atur parameter antrean, bitrate MP3, auto-retry, preferensi penyimpanan lokal, dan mode pengujian.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {saveSuccess && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3.5 text-xs text-emerald-300">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>Pengaturan berhasil disimpan dan langsung diterapkan ke sistem!</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3.5 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Section 1: Audio Processing & Conversion */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <span>Pengaturan Audio & Konverter MP3</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Bitrate Output MP3
              </label>
              <select
                value={formData.mp3Bitrate}
                onChange={(e) =>
                  setFormData({ ...formData, mp3Bitrate: Number(e.target.value) as any })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value={128}>128 kbps (Standar, Ukuran Kecil)</option>
                <option value={192}>192 kbps (Default, Kualitas Studio Seimbang)</option>
                <option value={256}>256 kbps (High Fidelity)</option>
                <option value={320}>320 kbps (Kualitas Maksimal)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Mesin Konversi Audio
              </label>
              <select
                value={formData.conversionMode}
                onChange={(e) =>
                  setFormData({ ...formData, conversionMode: e.target.value as any })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              >
                <option value="lamejs">Pure JavaScript Built-in (Tanpa Dependensi Binary Luar)</option>
                <option value="ffmpeg">System FFmpeg (Jika terpasang di OS)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Queue & Retry Rules */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-400" />
            <span>Aturan Antrean & Percobaan Ulang (Auto Retry)</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Maksimal Percobaan Retry per Pekerjaan
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={formData.maxRetries}
                onChange={(e) =>
                  setFormData({ ...formData, maxRetries: Math.max(1, Math.min(5, Number(e.target.value))) })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">Nilai rekomendasi: 3 kali percobaan</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Target URL Google AI Studio
              </label>
              <input
                type="url"
                value={formData.aiStudioUrl}
                onChange={(e) => setFormData({ ...formData, aiStudioUrl: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-3 border-t border-slate-800">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-slate-200">Auto Retry Otomatis</p>
                <p className="text-[11px] text-slate-400">
                  Coba ulang otomatis (jeda 5s, 15s, 30s) jika terjadi kendala sementara.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.autoRetry}
                onChange={(e) => setFormData({ ...formData, autoRetry: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-slate-200">Auto Continue Antrean</p>
                <p className="text-[11px] text-slate-400">
                  Langsung lanjutkan ke pekerjaan berikutnya setelah file MP3 tersimpan dan diverifikasi.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.autoContinue}
                onChange={(e) => setFormData({ ...formData, autoContinue: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-slate-200">Pertahankan Berkas WAV Asli (Preserve WAV)</p>
                <p className="text-[11px] text-slate-400">
                  Simpan berkas master WAV di <code className="text-slate-300">storage/wav/</code> setelah dikonversi ke MP3.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.preserveWavFiles}
                onChange={(e) => setFormData({ ...formData, preserveWavFiles: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-slate-200">Hentikan Antrean Jika Terjadi Kegagalan (Stop When Failed)</p>
                <p className="text-[11px] text-slate-400">
                  Hentikan antrean jika semua percobaan retry pada satu pekerjaan habis.
                </p>
              </div>
              <input
                type="checkbox"
                checked={formData.stopWhenFailed}
                onChange={(e) => setFormData({ ...formData, stopWhenFailed: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0"
              />
            </label>
          </div>
        </div>

        {/* Section 3: Mock Testing Mode */}
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                <span>Mode Pengujian Mandiri (Mock Testing Mode)</span>
              </h3>
              <p className="text-xs text-amber-400/80 mt-0.5">
                Uji seluruh fungsionalitas website, antrean FIFO, sintesis audio WAV, dan konversi MP3 tanpa harus membuka tab Google AI Studio sungguhan.
              </p>
            </div>
            <input
              type="checkbox"
              checked={formData.mockMode}
              onChange={(e) => setFormData({ ...formData, mockMode: e.target.checked })}
              className="h-5 w-5 rounded border-amber-500 bg-slate-950 text-amber-500 focus:ring-0 cursor-pointer"
            />
          </div>
        </div>

        {/* Section 4: Folder Penyimpanan Sementara & Jalur Unduh Otomatis */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-emerald-400" />
            <span>Folder Penyimpanan Sementara & Jalur Unduh Otomatis</span>
          </h3>

          <div className="space-y-3 text-xs text-slate-300">
            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800 flex items-start gap-3">
              <Folder className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-white">
                  Lokasi Folder Workspace Sementara:
                </p>
                <code className="text-cyan-400 font-mono text-[11px] block bg-slate-900 px-2 py-1 rounded">
                  storage/workspaces/{getClientId()}/
                </code>
                <p className="text-[11px] text-slate-400">
                  Perangkat Anda (<strong className="text-slate-300">{getClientName()}</strong>) memiliki folder penyimpanan sementara khusus yang terisolasi dari PC lain. Ekstensi Chrome langsung menyerap audio WAV dari AI Studio ke memory dan mengirimkannya ke folder ini tanpa memunculkan kotak dialog "Save As".
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
              <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <Download className="h-3.5 w-3.5" />
                  <span>Alur Unduhan ke PC Anda:</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Ketika tombol <strong className="text-indigo-300">Unduh MP3</strong> atau <strong className="text-cyan-300">Unduh WAV</strong> ditekan di Audio Library, file langsung diunduh ke folder <strong className="text-slate-200">Downloads PC Anda</strong> dengan nama file yang sama persis seperti input teks awal (<code className="text-slate-300">.mp3</code> atau <code className="text-slate-300">.wav</code>, tidak pernah format <code className="text-rose-400">.htm</code>).
                </p>
              </div>

              <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <Info className="h-3.5 w-3.5" />
                  <span>Penghapusan & Bersih-Bersih:</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Menghapus file dari halaman Audio Library atau menekan tombol "Hapus Semua Audio" akan menghapus seluruh file di folder sementara secara instan. Jika histori browser dibersihkan, ID workspace akan berganti baru dan bersih.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Save className="h-4 w-4" />
            <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
