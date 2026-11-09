import React, { useState, useRef } from 'react';
import {
  FileAudio,
  Upload,
  ArrowRight,
  Music,
  Download,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Volume2,
  HardDrive,
  RefreshCw,
  FolderDown,
} from 'lucide-react';
import { convertWavDirect } from '../services/api';
import { getClientId } from '../services/clientWorkspace';
import { saveAudioBlob, triggerSafeAudioDownload } from '../services/localAudioStorage';
import { AudioItem } from '../types';

interface ConvertedResult {
  baseName: string;
  wavFilename: string;
  mp3Filename: string;
  wavSize: number;
  mp3Size: number;
  duration: number;
  wavBlob?: Blob;
  mp3Blob?: Blob;
  wavUrl?: string;
  mp3Url?: string;
  bitrate: number;
  savedToLibrary?: boolean;
}

interface WavConverterPageProps {
  onAudioLibraryUpdated?: () => void;
  onNavigateToLibrary?: () => void;
}

export const WavConverterPage: React.FC<WavConverterPageProps> = ({
  onAudioLibraryUpdated,
  onNavigateToLibrary,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState<number>(192);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertedResult | null>(null);

  // Audio Playback state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activePlaying, setActivePlaying] = useState<'wav' | 'mp3' | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // History of session conversions
  const [history, setHistory] = useState<ConvertedResult[]>([]);

  const handleFileSelect = (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.wav')) {
      setError('Hanya berkas format audio WAV (.wav) yang diperbolehkan.');
      return;
    }
    setSelectedFile(file);
    setResult(null);
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleStartConversion = async () => {
    if (!selectedFile) return;
    setIsConverting(true);
    setError(null);

    const clientId = getClientId();
    const rawBaseName = selectedFile.name.replace(/\.wav$/i, '');

    try {
      // 1. Direct call to real WAV to MP3 conversion engine
      const res = await convertWavDirect(selectedFile, bitrate, rawBaseName);

      if (!res.success) {
        throw new Error(res.error || 'Gagal mengonversi berkas WAV ke MP3.');
      }

      // 2. Decode MP3 base64 or build Blob
      let mp3Blob: Blob | undefined;
      let wavBlob: Blob = selectedFile;

      if (res.mp3Base64) {
        const byteCharacters = atob(res.mp3Base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        mp3Blob = new Blob([new Uint8Array(byteNumbers)], { type: 'audio/mpeg' });
      }

      // 3. Persist both WAV and MP3 blobs to browser IndexedDB
      await saveAudioBlob(clientId, res.baseName || rawBaseName, 'wav', wavBlob).catch(() => {});
      if (mp3Blob) {
        await saveAudioBlob(clientId, res.baseName || rawBaseName, 'mp3', mp3Blob).catch(() => {});
      }

      const wavUrl = URL.createObjectURL(wavBlob);
      const mp3Url = mp3Blob ? URL.createObjectURL(mp3Blob) : `/api/audio/stream/mp3/${encodeURIComponent(res.baseName || rawBaseName)}?clientId=${encodeURIComponent(clientId)}`;

      const newResult: ConvertedResult = {
        baseName: res.baseName || rawBaseName,
        wavFilename: res.wavFilename || `${rawBaseName}.wav`,
        mp3Filename: res.mp3Filename || `${rawBaseName}.mp3`,
        wavSize: res.wavSize || selectedFile.size,
        mp3Size: res.mp3Size || 0,
        duration: res.duration || 0,
        wavBlob,
        mp3Blob,
        wavUrl,
        mp3Url,
        bitrate,
        savedToLibrary: true,
      };

      setResult(newResult);
      setHistory((prev) => [newResult, ...prev]);

      if (onAudioLibraryUpdated) {
        onAudioLibraryUpdated();
      }
    } catch (err: any) {
      console.error('Conversion failed:', err);
      setError(err.message || 'Terjadi kesalahan saat memproses konversi audio.');
    } finally {
      setIsConverting(false);
    }
  };

  const handlePlayAudio = (type: 'wav' | 'mp3', url?: string) => {
    if (!url || !audioRef.current) return;

    if (activePlaying === type && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    audioRef.current.src = url;
    setActivePlaying(type);
    setIsPlaying(true);
    audioRef.current.play().catch(() => setIsPlaying(false));
  };

  const handleDownloadFile = async (baseName: string, format: 'wav' | 'mp3') => {
    const clientId = getClientId();
    await triggerSafeAudioDownload(baseName, format, clientId);
  };

  return (
    <div className="space-y-6">
      {/* Hidden audio element for preview */}
      <audio
        ref={audioRef}
        onEnded={() => {
          setIsPlaying(false);
          setActivePlaying(null);
        }}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <FileAudio className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>Alat Konverter WAV ke MP3 Asli</span>
                <span className="rounded bg-cyan-900/60 border border-cyan-500/40 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                  Real LAME Encoder
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Ubah berkas audio WAV asli dari Google AI Studio atau komputer Anda menjadi MP3 nyata. Unduh file WAV asli atau MP3 hasil konversi kapan saja.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Converter Control Box */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 sm:p-6 shadow-xl">
        <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <span>1. Pilih atau Tarik Berkas WAV</span>
        </h3>

        {/* Drag & Drop Box */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleFileSelect(e.target.files[0]);
            }
          }}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
            selectedFile
              ? 'border-cyan-500/60 bg-cyan-950/20'
              : 'border-slate-700 bg-slate-950/50 hover:border-cyan-500/40 hover:bg-slate-950/70'
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mb-3">
            <Upload className="h-6 w-6" />
          </div>

          {selectedFile ? (
            <div className="space-y-1">
              <p className="text-sm font-bold text-cyan-300">{selectedFile.name}</p>
              <p className="text-xs text-slate-400">
                Ukuran: {(selectedFile.size / 1024).toFixed(1)} KB • Tipe: Audio WAV PCM
              </p>
              <p className="text-[11px] text-cyan-400 underline mt-2">
                Klik untuk mengganti berkas WAV
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-200">
                Tarik & Lepas File WAV di sini, atau <span className="text-cyan-400 underline">Klik untuk Memilih</span>
              </p>
              <p className="text-xs text-slate-500">
                Mendukung berkas audio WAV hasil unduhan Google AI Studio (misal: bauv1.wav, bauv2.wav)
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Options & Start Button */}
        <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300 font-medium">Bitrate MP3:</span>
            <div className="flex items-center gap-1.5">
              {[128, 192, 256, 320].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBitrate(b)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                    bitrate === b
                      ? 'bg-cyan-500 text-white shadow-sm shadow-cyan-500/30'
                      : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {b} kbps {b === 192 ? '★' : ''}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStartConversion}
            disabled={!selectedFile || isConverting}
            className={`flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-xs font-bold text-white transition-all shadow-lg ${
              !selectedFile || isConverting
                ? 'opacity-50 cursor-not-allowed bg-slate-800 border border-slate-700'
                : 'bg-gradient-to-r from-cyan-600 via-cyan-500 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 cursor-pointer shadow-cyan-500/25 active:scale-95'
            }`}
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Mengonversi WAV ke MP3...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Konversi WAV ke MP3</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Result Section: Dual Audio & Direct Downloads */}
      {result && (
        <div className="rounded-2xl border border-emerald-500/40 bg-slate-900/90 p-5 sm:p-6 shadow-2xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Konversi Berhasil: "{result.baseName}"
              </h3>
            </div>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-1 text-xs font-semibold text-emerald-300 font-mono">
              Durasi: ~{result.duration}s • {result.bitrate} kbps
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            {/* 1. File WAV Asli */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded bg-cyan-950 border border-cyan-500/40 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                    FORMAT ASLI (WAV)
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {(result.wavSize / 1024).toFixed(1)} KB
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2 truncate">
                  {result.wavFilename}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Audio PCM tidak terkompresi asli dari Google AI Studio
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <button
                  onClick={() => handlePlayAudio('wav', result.wavUrl)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                >
                  {activePlaying === 'wav' && isPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5 fill-current text-cyan-400" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current text-cyan-400" />
                      <span>Putar WAV</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleDownloadFile(result.baseName, 'wav')}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer shadow-sm shadow-cyan-600/30"
                  title="Unduh file WAV asli langsung ke folder Downloads"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Unduh File WAV Asli</span>
                </button>
              </div>
            </div>

            {/* 2. File MP3 Hasil Konversi */}
            <div className="rounded-xl border border-indigo-500/40 bg-slate-950/70 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded bg-indigo-950 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-mono text-indigo-300">
                    HASIL KONVERSI (MP3)
                  </span>
                  <span className="text-xs text-indigo-300 font-mono font-bold">
                    {(result.mp3Size / 1024).toFixed(1)} KB (Hemat ~{Math.max(0, Math.round((1 - result.mp3Size / result.wavSize) * 100))}%)
                  </span>
                </div>
                <h4 className="text-sm font-bold text-indigo-100 mt-2 truncate">
                  {result.mp3Filename}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Audio MPEG Layer III terkompresi stereo {result.bitrate} kbps
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <button
                  onClick={() => handlePlayAudio('mp3', result.mp3Url)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                >
                  {activePlaying === 'mp3' && isPlaying ? (
                    <>
                      <Pause className="h-3.5 w-3.5 fill-current text-indigo-400" />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 fill-current text-indigo-400" />
                      <span>Putar MP3</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleDownloadFile(result.baseName, 'mp3')}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer shadow-sm shadow-indigo-600/30"
                  title="Unduh file MP3 hasil konversi langsung ke folder Downloads"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Unduh File MP3 Hasil Konversi</span>
                </button>
              </div>
            </div>
          </div>

          {/* Action to view in library */}
          {onNavigateToLibrary && (
            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={onNavigateToLibrary}
                className="flex items-center gap-1.5 text-xs text-cyan-400 hover:underline cursor-pointer font-semibold"
              >
                <span>Buka di Audio Library</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Conversion History */}
      {history.length > 1 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
            <span>Riwayat Konversi Sesi Ini ({history.length})</span>
          </h3>

          <div className="space-y-2">
            {history.slice(1).map((item, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <Music className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="font-bold text-slate-200 truncate">{item.baseName}</span>
                  <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                    • WAV: {(item.wavSize / 1024).toFixed(1)} KB → MP3: {(item.mp3Size / 1024).toFixed(1)} KB
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleDownloadFile(item.baseName, 'wav')}
                    className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition-colors cursor-pointer"
                  >
                    Unduh WAV
                  </button>
                  <button
                    onClick={() => handleDownloadFile(item.baseName, 'mp3')}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] font-bold text-white transition-colors cursor-pointer"
                  >
                    Unduh MP3
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
