import React, { useState, useEffect } from 'react';
import {
  Puzzle,
  Download,
  Chrome,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Cpu,
  Globe,
  Cloud,
  Check,
  Copy,
  Zap,
  ArrowRight,
  Server,
  Sparkles,
} from 'lucide-react';
import { ExtensionStatus } from '../types';
import { extensionClient } from '../services/extensionBridge';
import { downloadExtensionZipClient } from '../services/extensionDownloader';

interface ExtensionPageProps {
  extensionStatus: ExtensionStatus;
  onRefresh: () => void;
}

export const ExtensionPage: React.FC<ExtensionPageProps> = ({
  extensionStatus,
  onRefresh,
}) => {
  const [connecting, setConnecting] = useState(false);
  const [connectMessage, setConnectMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState('');
  const [downloadingZip, setDownloadingZip] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCurrentOrigin(window.location.origin);
    }
  }, []);

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      await downloadExtensionZipClient(currentOrigin);
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleTestHandshake = async () => {
    setConnecting(true);
    setConnectMessage(null);
    try {
      const res = await extensionClient.connectHandshake(currentOrigin || window.location.origin);
      if (res && res.success) {
        setConnectMessage({
          text: `Berhasil! Ekstensi terhubung ke ${res.backendUrl || currentOrigin} (Latensi: ${res.latency || 0}ms). Sesi terverifikasi.`,
        });
      } else {
        setConnectMessage({
          text: `Gagal: ${res?.error || 'Tidak ada respon dari ekstensi. Pastikan ekstensi sudah di-load di Chrome.'}`,
          isError: true,
        });
      }
      onRefresh();
    } catch (err: any) {
      setConnectMessage({
        text: `Koneksi gagal: ${err.message}. Pastikan ekstensi Chrome terpasang dan aktif di tab ini.`,
        isError: true,
      });
    } finally {
      setConnecting(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setDiagnosticsRunning(true);
    setDiagnosticResult(null);
    try {
      const res = await extensionClient.runDiagnostics();
      setDiagnosticResult(res);
    } catch (err: any) {
      setDiagnosticResult({ error: err.message });
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  const handleCopyOrigin = () => {
    if (!currentOrigin) return;
    navigator.clipboard.writeText(currentOrigin);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const downloadZipUrl = currentOrigin
    ? `/api/extension/download-zip?backendUrl=${encodeURIComponent(currentOrigin)}`
    : '/api/extension/download-zip';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Puzzle className="h-5 w-5 text-cyan-400" />
            <span>Chrome Extension Controller & Cloud Integration</span>
          </h2>
          <p className="text-xs text-slate-400">
            Jembatan otomatisasi browser: Web Dashboard online di cloud + Ekstensi ringan lokal di Chrome tanpa membebani PC kentang.
          </p>
        </div>

        <button
          onClick={handleDownloadZip}
          disabled={downloadingZip}
          className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 shadow-md shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-60"
        >
          <Download className={`h-3.5 w-3.5 ${downloadingZip ? 'animate-bounce' : ''}`} />
          <span>{downloadingZip ? 'Menyiapkan Ekstensi...' : 'Unduh Ekstensi ZIP (Siap Pakai)'}</span>
        </button>
      </div>

      {/* Online Cloud Auto-Sync Banner */}
      <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-indigo-950/40 p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
                Alamat Server Web Dashboard Saat Ini
              </h3>
              <span className="text-[10px] rounded bg-cyan-950 px-1.5 py-0.5 border border-cyan-500/30 text-cyan-400 font-mono">
                {currentOrigin.includes('localhost') ? 'Local Server' : 'Online Cloud Deployment'}
              </span>
            </div>
            <p className="text-xs text-slate-300 font-mono break-all flex items-center gap-2">
              <span className="text-white font-bold">{currentOrigin || 'Memuat alamat...'}</span>
              <button
                onClick={handleCopyOrigin}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
                title="Salin URL Server"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTestHandshake}
              disabled={connecting}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white transition-all shadow-md shadow-cyan-500/20 cursor-pointer disabled:opacity-50"
            >
              <Zap className={`h-3.5 w-3.5 ${connecting ? 'animate-bounce' : ''}`} />
              <span>{connecting ? 'Menghubungkan...' : 'Koneksikan Ekstensi ke URL Ini'}</span>
            </button>
          </div>
        </div>

        {connectMessage && (
          <div
            className={`mt-3 p-2.5 rounded-lg text-xs font-medium border ${
              connectMessage.isError
                ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
            }`}
          >
            {connectMessage.text}
          </div>
        )}
      </div>

      {/* Potato PC Advantage Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400">
            <Cpu className="h-4 w-4" />
            <h4 className="text-xs font-bold text-white">0% Beban PC Kentang</h4>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Tidak perlu install Node.js, tidak perlu jalanin terminal CMD, dan <strong>tanpa perlu buka file .bat lagi</strong> di PC. Cukup buka link website di browser Chrome seperti website biasa!
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-indigo-400">
            <Globe className="h-4 w-4" />
            <h4 className="text-xs font-bold text-white">Hosting Online (Vercel / Cloud)</h4>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Dapat diupload ke GitHub lalu dideploy ke Vercel, Render, atau Railway gratis. Dashboard antrean teks bisa dibuka dari laptop manapun kapan saja 24/7.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400">
            <Puzzle className="h-4 w-4" />
            <h4 className="text-xs font-bold text-white">Ekstensi Lokal Sangat Ringan</h4>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Ekstensi Chrome hanya membutuhkan memori &lt; 15MB. Bertindak sebagai jembatan cerdas antara tab Google AI Studio dengan dashboard online Anda.
          </p>
        </div>
      </div>

      {/* Realtime Connection Card & Step-by-Step Guide */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Status Koneksi Ekstensi & AI Studio</span>
          </h3>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
              <span className="text-slate-400">Status Ekstensi Chrome:</span>
              <span
                className={`font-bold flex items-center gap-1.5 ${
                  extensionStatus.connected ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {extensionStatus.connected ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Terhubung (v{extensionStatus.version})</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-slate-500" />
                    <span>Belum Terhubung</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
              <span className="text-slate-400">Tab Google AI Studio:</span>
              <span
                className={`font-bold flex items-center gap-1.5 ${
                  extensionStatus.aiStudioConnected ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {extensionStatus.aiStudioConnected ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Terdeteksi (Tab #{extensionStatus.tabId})</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-slate-500" />
                    <span>Tidak Terdeteksi</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
              <span className="text-slate-400">Target URL Google AI Studio:</span>
              <a
                href="https://aistudio.google.com/"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 hover:underline flex items-center gap-1 font-mono text-[11px]"
              >
                <span>https://aistudio.google.com/</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              onClick={handleTestHandshake}
              disabled={connecting}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${connecting ? 'animate-spin' : ''}`} />
              <span>{connecting ? 'Menghubungkan...' : 'Uji Handshake Ekstensi'}</span>
            </button>
            <button
              onClick={handleRunDiagnostics}
              disabled={diagnosticsRunning}
              className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/40 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition-all cursor-pointer disabled:opacity-50"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>{diagnosticsRunning ? 'Memeriksa DOM...' : 'Jalankan Diagnostik AI Studio'}</span>
            </button>
          </div>
        </div>

        {/* Step-by-Step Visual Setup Cards */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Chrome className="h-4 w-4 text-cyan-400" />
            <span>Panduan Pasang Ekstensi di Chrome PC Anda</span>
          </h3>

          <div className="space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <span className="inline-block rounded bg-cyan-950 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/30 mb-1">
                LANGKAH 1: UNDUH & EKSTRAK ZIP
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                Klik tombol <strong>"Unduh Ekstensi ZIP"</strong> di atas. Ekstrak file ZIP tersebut ke folder di komputer Anda (misal: <code className="text-cyan-300 font-mono">D:\AI_TTS_Extension\</code>). File ZIP sudah otomatis terkonfigurasi dengan URL website ini!
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <span className="inline-block rounded bg-indigo-950 px-2 py-0.5 text-[10px] font-bold text-indigo-400 border border-indigo-500/30 mb-1">
                LANGKAH 2: PASANG DI GOOGLE CHROME
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                1. Di browser Chrome, buka alamat: <code className="text-indigo-300 font-mono">chrome://extensions/</code>
                <br />
                2. Aktifkan sakelar <strong>"Developer mode"</strong> di pojok kanan atas.
                <br />
                3. Klik tombol <strong>"Load unpacked"</strong> di pojok kiri atas dan pilih folder hasil ekstrak tadi.
                <br />
                4. Klik ikon puzzle Chrome 🧩 lalu klik <strong>Pin 📌</strong> ikon AI TTS Studio agar selalu muncul di toolbar.
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <span className="inline-block rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 mb-1">
                LANGKAH 3: BUKA AI STUDIO & MULAI
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                1. Buka tab baru: <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-cyan-400 underline font-mono">https://aistudio.google.com/</a> dan pastikan akun Google login.
                <br />
                2. Buka tab website ini, klik <strong>"Koneksikan Ekstensi ke URL Ini"</strong>. Status akan langsung berubah jadi <strong>Terhubung</strong> & <strong>Tab Terdeteksi</strong>!
              </p>
            </div>

            <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
              <span className="inline-block rounded bg-cyan-950 px-2 py-0.5 text-[10px] font-bold text-cyan-400 border border-cyan-500/40 mb-1">
                FOLDER "unduhan" EKSTENSI &amp; ISOLASI UNDUHAN
              </span>
              <div className="font-mono bg-slate-950 p-2.5 rounded border border-slate-800 text-[11px] text-cyan-300 space-y-1 mb-2">
                <div className="text-white font-bold">📍 Folder Bawaan Ekstensi &amp; Website:</div>
                <div className="text-emerald-300 font-bold">...\AI_TTS_Extension\unduhan\  &amp;  Downloads\unduhan\</div>
                <div className="text-slate-400 text-[10px] pt-1">
                  Di dalam folder hasil ekstrak ekstensi sudah tersedia folder <strong>unduhan</strong>. Sambungkan folder tersebut satu kali di menu <strong>Audio Library</strong> agar file WAV dari antrean ekstensi maupun file WAV yang Anda masukkan manual lewat File Manager selalu tersinkron otomatis.
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                • <strong>Isolasi Ketat:</strong> Unduhan biasa/manual yang Anda klik di Google AI Studio tidak akan masuk ke folder <code className="text-cyan-300">unduhan</code>. Hanya hasil WAV ekstensi atau file manual yang Anda taruh di File Manager.<br />
                • <strong>Reset Bersih:</strong> Tombol reset sistem hanya membersihkan berkas audio sementara (<code className="text-cyan-300">*.wav</code>). Folder dan ekstensi tetap aman 100%.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Cloud Deployment Architecture Guide */}
      <div className="rounded-xl border border-indigo-500/30 bg-slate-950/80 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              Cara Deploy ke Vercel / Render / GitHub (Standar Profesional Internasional)
            </h3>
          </div>
          <span className="text-[10px] font-bold text-indigo-300 bg-indigo-950/80 px-2.5 py-1 rounded-full border border-indigo-500/40">
            Zero-BAT Setup
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
              <span className="flex h-5 w-5 rounded-full bg-indigo-600/30 items-center justify-center text-xs">1</span>
              <span>Push Kode ke Repositori GitHub Anda</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Buat repository baru di <code className="text-indigo-300 font-mono">github.com</code>, lalu push seluruh folder project ini ke GitHub. File <code className="text-slate-200">vercel.json</code> dan konfigurasi cloud sudah siap disertakan secara otomatis!
            </p>
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-300 space-y-1">
              <p>git init</p>
              <p>git add .</p>
              <p>git commit -m "feat: AI TTS Studio V1.0 Cloud Ready"</p>
              <p>git remote add origin https://github.com/USERNAME/REPO.git</p>
              <p>git push -u origin main</p>
            </div>
          </div>

          <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center gap-2 text-cyan-300 font-bold text-sm">
              <span className="flex h-5 w-5 rounded-full bg-cyan-600/30 items-center justify-center text-xs">2</span>
              <span>Deploy di Vercel atau Render (1-Klik)</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Buka <code className="text-cyan-300 font-mono">vercel.com</code> (atau Render / Railway):
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
              <li>Klik <strong>"Add New Project"</strong> &rarr; pilih repositori GitHub Anda.</li>
              <li>Framework Preset: <strong>Vite</strong>.</li>
              <li>Build Command: <code className="text-cyan-300 font-mono">npm run build</code>.</li>
              <li>Output Directory: <code className="text-cyan-300 font-mono">dist</code>.</li>
              <li>Klik <strong>"Deploy"</strong> &mdash; selesai dalam 1 menit!</li>
            </ul>
            <p className="text-emerald-400 text-[11px] font-semibold">
              Hasilnya: Anda mendapatkan URL website seperti <span className="font-mono">https://ai-tts.vercel.app</span> yang dapat dibuka kapan saja tanpa membuka file .bat!
            </p>
          </div>
        </div>
      </div>

      {/* Diagnostics Output Section */}
      {diagnosticResult && (
        <div className="rounded-xl border border-cyan-500/40 bg-slate-950 p-5 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white flex items-center gap-2 font-mono">
              <Terminal className="h-4 w-4 text-cyan-400" />
              <span>Hasil Inspeksi DOM Google AI Studio:</span>
            </h3>
            <span className="text-[10px] text-slate-500">
              {new Date().toLocaleTimeString()}
            </span>
          </div>

          <pre className="rounded-lg bg-slate-900/90 p-4 font-mono text-[11px] text-slate-300 overflow-x-auto border border-slate-800 max-h-72">
            {JSON.stringify(diagnosticResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
