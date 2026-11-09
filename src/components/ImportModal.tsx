import React, { useState, useRef } from 'react';
import { X, Upload, FileSpreadsheet, FileText, Download, Check, AlertCircle } from 'lucide-react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (items: Array<{ filename: string; text: string }>) => Promise<boolean>;
  type: 'txt' | 'csv';
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  type,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedItems, setParsedItems] = useState<Array<{ filename: string; text: string }>>([]);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleDownloadTemplate = () => {
    let content = '';
    let dlName = '';

    if (type === 'csv') {
      content = `filename,text\n001-pembukaan,"Assalamualaikum warahmatullahi wabarakatuh, selamat datang di program audio kami."\n002-materi,"Hari ini kita akan mengulas teknologi terbaru dalam pengolahan suara kecerdasan buatan."\n003-penutup,"Sekian perjumpaan kita kali ini. Sampai jumpa di video selanjutnya."\n`;
      dlName = 'template_tts_import.csv';
    } else {
      content = `001-pembukaan|Assalamualaikum warahmatullahi wabarakatuh, selamat datang di program audio kami.\n002-materi|Hari ini kita akan mengulas teknologi terbaru dalam pengolahan suara kecerdasan buatan.\n003-penutup|Sekian perjumpaan kita kali ini. Sampai jumpa di video selanjutnya.\n`;
      dlName = 'template_tts_import.txt';
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dlName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || text.trim().length === 0) {
          throw new Error('Berkas yang dipilih kosong.');
        }

        const items: Array<{ filename: string; text: string }> = [];

        if (type === 'csv') {
          // Parse CSV
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          let startIdx = 0;

          // Check if first line is header
          if (lines[0].toLowerCase().includes('filename') || lines[0].toLowerCase().includes('teks')) {
            startIdx = 1;
          }

          for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i];
            // Handle quotes in CSV
            const match = line.match(/^(".*?"|[^",\s]+)(?:,|\t)(".*?"|.+)$/);
            if (match) {
              const fn = match[1].replace(/^"|"$/g, '').trim();
              const tx = match[2].replace(/^"|"$/g, '').trim();
              if (tx) items.push({ filename: fn || `audio_${i}`, text: tx });
            } else {
              const parts = line.split(',');
              if (parts.length >= 2) {
                const fn = parts[0].trim();
                const tx = parts.slice(1).join(',').replace(/^"|"$/g, '').trim();
                if (tx) items.push({ filename: fn || `audio_${i}`, text: tx });
              }
            }
          }
        } else {
          // Parse TXT
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('|')) {
              const parts = line.split('|');
              const fn = parts[0].trim();
              const tx = parts.slice(1).join('|').trim();
              if (tx) items.push({ filename: fn || `audio_${i + 1}`, text: tx });
            } else {
              items.push({ filename: `audio_${i + 1}`, text: line.trim() });
            }
          }
        }

        if (items.length === 0) {
          throw new Error('Tidak ditemukan pasangan nama file dan teks yang valid dalam berkas.');
        }

        setParsedItems(items);
      } catch (err: any) {
        setError(err.message || 'Gagal membaca berkas.');
        setParsedItems([]);
      }
    };

    reader.readAsText(file);
  };

  const handleConfirm = async () => {
    if (parsedItems.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const ok = await onImport(parsedItems);
      if (ok) {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Gagal mengimpor teks.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-950/60">
          <div className="flex items-center gap-2">
            {type === 'csv' ? (
              <FileSpreadsheet className="h-5 w-5 text-indigo-400" />
            ) : (
              <FileText className="h-5 w-5 text-cyan-400" />
            )}
            <h2 className="text-base font-bold text-white">
              Import Berkas {type.toUpperCase()}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs">
            <div>
              <p className="font-semibold text-slate-200">
                Format yang Didukung:
              </p>
              <p className="text-[11px] text-slate-400">
                {type === 'csv'
                  ? 'Kolom: filename, text (contoh: 001-intro, "Halo dunia")'
                  : 'Baris berformat: nama_file|teks atau teks biasa per baris'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-cyan-300 hover:bg-slate-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Unduh Template</span>
            </button>
          </div>

          {/* Upload Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/40 p-6 text-center hover:border-cyan-500/50 hover:bg-slate-950/60 transition-all cursor-pointer"
          >
            <Upload className="h-8 w-8 text-slate-500 mb-2" />
            <p className="text-xs font-semibold text-slate-200">
              {fileName ? fileName : `Pilih atau seret berkas .${type} ke sini`}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Klik untuk mencari berkas di komputer
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={type === 'csv' ? '.csv,text/csv' : '.txt,text/plain'}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Parsed Preview */}
          {parsedItems.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-cyan-400">
                  {parsedItems.length} Pekerjaan Siap Diimpor
                </span>
                <span className="text-[11px] text-slate-400">
                  Mempertahankan nama berkas & teks
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {parsedItems.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded bg-slate-900 p-2 text-[11px]"
                  >
                    <span className="font-mono text-cyan-400 font-semibold shrink-0">
                      {item.filename}
                    </span>
                    <span className="text-slate-300 line-clamp-1">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            onClick={handleConfirm}
            disabled={parsedItems.length === 0 || loading}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-50 transition-all cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            <span>{loading ? 'Mengimpor...' : `Impor ${parsedItems.length} Pekerjaan`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
