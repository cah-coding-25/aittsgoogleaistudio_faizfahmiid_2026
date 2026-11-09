import React, { useState, useRef } from 'react';
import { X, Upload, Music, AlertCircle, Check, Loader2 } from 'lucide-react';
import { TTSJob } from '../types';
import { uploadWavFallback, convertWavDirect } from '../services/api';
import { getClientId } from '../services/clientWorkspace';
import { saveAudioBlob } from '../services/localAudioStorage';

interface ManualAudioUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: TTSJob | null;
  onUploaded: () => void;
}

export const ManualAudioUploadModal: React.FC<ManualAudioUploadModalProps> = ({
  isOpen,
  onClose,
  job,
  onUploaded,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !job) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.toLowerCase().endsWith('.wav')) {
        setError('Hanya berkas format .wav yang diperbolehkan.');
        return;
      }
      setFile(selected);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    const clientId = getClientId();
    const targetFilename = job.filename;

    try {
      // 1. Save WAV to browser IndexedDB immediately
      await saveAudioBlob(clientId, targetFilename, 'wav', file).catch(() => {});

      // 2. Upload and convert to MP3 via backend
      let res = await uploadWavFallback(job.id, file, targetFilename).catch(() => null);

      if (!res || !res.success) {
        // Infallible fallback: use standalone convert endpoint
        const convRes = await convertWavDirect(file, 192, targetFilename);
        if (!convRes.success) {
          throw new Error(convRes.error || res?.error || 'Gagal memproses dan mengonversi file audio.');
        }
      }

      onUploaded();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Gagal mengunggah file.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2">
            <Music className="h-5 w-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">Upload Audio WAV Manual</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
            <p className="text-slate-400">Pekerjaan Target:</p>
            <p className="font-semibold text-cyan-300 font-mono mt-0.5">
              {job.filename}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">"{job.text}"</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 p-6 text-center hover:border-cyan-500/50 hover:bg-slate-950/60 transition-all cursor-pointer"
          >
            <Upload className="h-8 w-8 text-slate-500 mb-2" />
            <p className="text-xs font-semibold text-slate-200">
              {file ? file.name : 'Pilih file WAV dari komputer'}
            </p>
            {file && (
              <p className="text-[11px] text-cyan-400 mt-1">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,audio/wav"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 px-5 py-3 bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || loading}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{loading ? 'Mengonversi...' : 'Upload & Konversi ke MP3'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
