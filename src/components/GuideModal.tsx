import React from 'react';
import {
  X,
  BookOpen,
  Chrome,
  Globe2,
  FileText,
  Play,
  Music,
  Download,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  HelpCircle,
  ShieldCheck,
  Cpu,
} from 'lucide-react';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAddText: () => void;
  onDownloadExtension: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({
  isOpen,
  onClose,
  onOpenAddText,
  onDownloadExtension,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 shadow-md shadow-cyan-500/20">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Panduan Lengkap Alur Penggunaan</h2>
                <span className="rounded-md border border-indigo-500/30 bg-indigo-950/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  by: Faiz_Fahmi_ID
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Langkah demi langkah otomatisasi Text-to-Speech Google AI Studio sampai menjadi file MP3.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300">
          {/* Visual Workflow Flowchart */}
          <div className="rounded-xl border border-cyan-500/30 bg-slate-950/80 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-3 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Diagram Alur Sistem Otomatisasi (Strict FIFO Pipeline)</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center text-[10px] font-semibold">
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-cyan-400 font-mono">1. INPUT</span>
                <span className="text-slate-200">Website Input Teks Massal</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-indigo-400 font-mono">2. DISPATCH</span>
                <span className="text-slate-200">Kirim ke Ekstensi Chrome</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-blue-400 font-mono">3. INJECT</span>
                <span className="text-slate-200">Isi Prompt AI Studio & Run</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-purple-400 font-mono">4. DETECT</span>
                <span className="text-slate-200">Ambil Audio Blob WAV</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-emerald-400 font-mono">5. CONVERT</span>
                <span className="text-slate-200">Konversi ke MP3 192kbps</span>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1">
                <span className="text-cyan-400 font-mono">6. SAVE</span>
                <span className="text-slate-200">Simpan Lokal & Next Job</span>
              </div>
            </div>
          </div>

          {/* Detailed Steps */}
          <div className="space-y-4">
            {/* Step 1 */}
            <div className="flex gap-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-600/20 text-cyan-400 font-bold font-mono">
                1
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="font-bold text-white text-sm flex items-center justify-between">
                  <span>Buka Website Online (Tanpa File .BAT) atau Pasang Ekstensi</span>
                  <button
                    type="button"
                    onClick={onDownloadExtension}
                    className="flex items-center gap-1 text-[11px] text-cyan-400 hover:underline cursor-pointer"
                  >
                    <Download className="h-3 w-3" />
                    <span>Unduh Ekstensi ZIP</span>
                  </button>
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  Jika website di-host di <strong>Vercel / Cloud</strong>, Anda <strong>TIDAK PERLU membuka file .bat</strong> sama sekali di PC! Cukup buka link website di Chrome, lalu unduh Ekstensi ZIP di atas, buka <code className="text-cyan-300">chrome://extensions/</code>, aktifkan <strong>Developer mode</strong>, dan klik <strong>"Load unpacked"</strong>. Ekstensi ini sangat hemat RAM (&lt; 15MB) sehingga sangat nyaman untuk PC kentang!
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 font-bold font-mono">
                2
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="font-bold text-white text-sm">
                  Buka Tab Google AI Studio & Pengaturan Download Otomatis
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  Buka tab baru ke <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-cyan-400 underline">https://aistudio.google.com/</a>, pastikan Anda sudah login dengan akun Google Anda dan berada pada halaman prompt TTS. Indikator di dashboard website akan berubah menjadi hijau (<span className="text-emerald-400 font-semibold">Tab Terdeteksi</span>).
                </p>
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-950/30 p-2.5 text-[11px] text-cyan-200 mt-2">
                  <strong>💡 Tips Otomatisasi Tanpa Pop-up "Save As":</strong> Agar Chrome tidak memunculkan kotak dialog Windows ("Save As") saat mengunduh WAV dari AI Studio, buka <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-300 font-mono">chrome://settings/downloads</code> lalu matikan opsi <em>"Tanyakan lokasi penyimpanan setiap file sebelum mengunduh"</em>. Berkas akan langsung terunduh dan diproses ke MP3 otomatis!
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-600/20 text-purple-400 font-bold font-mono">
                3
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="font-bold text-white text-sm flex items-center justify-between">
                  <span>Masukkan Daftar Teks Suara (Text Manager)</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAddText();
                    }}
                    className="text-[11px] text-indigo-400 hover:underline cursor-pointer"
                  >
                    + Tambah Teks Sekarang
                  </button>
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  Anda dapat memilih <strong>Mode A (Single)</strong> untuk input satuan, atau <strong>Mode B (Bulk)</strong> untuk menempel ratusan baris sekaligus dalam format:
                  <br />
                  <code className="text-cyan-300 font-mono mt-1 inline-block bg-slate-900 px-2 py-0.5 rounded">nama_file|isi teks narasi suara Anda</code>.
                  <br />
                  Anda juga dapat menggunakan tombol <strong>Import CSV</strong> atau <strong>Import TXT</strong>.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/20 text-emerald-400 font-bold font-mono">
                4
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="font-bold text-white text-sm">
                  Tekan Tombol "MULAI GENERATE"
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  Sistem antrean akan otomatis mengambil pekerjaan satu per satu: mengirim teks ke AI Studio, menekan Run, menunggu audio selesai dibuat, mengonversi WAV ke MP3 (192 kbps), memverifikasi file, dan otomatis melanjutkan ke teks berikutnya tanpa perlu intervensi manual!
                </p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex gap-4 p-3.5 rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-600/20 text-cyan-400 font-bold font-mono">
                5
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="font-bold text-white text-sm">
                  Dengarkan & Unduh File MP3 di Audio Library
                </h3>
                <p className="text-slate-400 leading-relaxed">
                  Semua file tersimpan langsung di komputer Anda pada folder <code className="text-slate-200">storage/mp3/</code>. Anda dapat memutar audio di dalam dashboard, mempratinjau WAV/MP3, atau mengklik tombol <strong>"Download Semua MP3 (ZIP)"</strong> untuk mengunduh seluruh file dalam satu paket zip.
                </p>
              </div>
            </div>
          </div>

          {/* Author attribution callout */}
          <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 to-cyan-950/40 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-indigo-400 shrink-0" />
              <div>
                <p className="text-xs font-bold text-white">AI TTS AUTOMATION STUDIO V1.0</p>
                <p className="text-[11px] text-slate-400">Dirancang & Dikembangkan oleh: <strong className="text-indigo-300">Faiz_Fahmi_ID</strong></p>
              </div>
            </div>
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-[10px] font-bold text-indigo-300 border border-indigo-500/40">
              Verified Solution
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-3.5 bg-slate-950/70">
          <span className="text-[11px] text-slate-500">
            Tekan ESC atau tombol Tutup untuk kembali ke aplikasi.
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 transition-all cursor-pointer"
          >
            Mengerti, Tutup Panduan
          </button>
        </div>
      </div>
    </div>
  );
};
