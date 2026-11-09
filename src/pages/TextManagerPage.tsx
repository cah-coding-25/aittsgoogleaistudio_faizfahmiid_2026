import React, { useState } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Copy,
  Edit2,
  ArrowUp,
  ArrowDown,
  Search,
  FileSpreadsheet,
  AlertCircle,
  Check,
  X,
  Volume2,
} from 'lucide-react';
import { TTSJob } from '../types';

interface TextManagerPageProps {
  jobs: TTSJob[];
  onAddTextModal: () => void;
  onImportModal: (type: 'txt' | 'csv') => void;
  onUpdateJob: (id: string, updates: Partial<TTSJob>) => Promise<boolean>;
  onDeleteJob: (id: string) => Promise<boolean>;
  onDuplicateJob: (job: TTSJob) => Promise<boolean>;
  onReorder: (jobIds: string[]) => Promise<boolean>;
  onClearAllJobs?: () => Promise<boolean>;
}

export const TextManagerPage: React.FC<TextManagerPageProps> = ({
  jobs,
  onAddTextModal,
  onImportModal,
  onUpdateJob,
  onDeleteJob,
  onDuplicateJob,
  onReorder,
  onClearAllJobs,
}) => {
  const [search, setSearch] = useState('');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editFilename, setEditFilename] = useState('');
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Filter jobs
  const filteredJobs = jobs.filter(
    (j) =>
      j.filename.toLowerCase().includes(search.toLowerCase()) ||
      j.text.toLowerCase().includes(search.toLowerCase())
  );

  // Check duplicate filenames in current set
  const nameCounts = new Map<string, number>();
  jobs.forEach((j) => {
    const k = j.filename.toLowerCase();
    nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
  });

  const handleStartEdit = (job: TTSJob) => {
    setEditingJobId(job.id);
    setEditFilename(job.filename);
    setEditText(job.text);
    setEditError(null);
  };

  const handleSaveEdit = async (jobId: string) => {
    if (!editFilename.trim()) {
      setEditError('Nama file tidak boleh kosong.');
      return;
    }
    if (!editText.trim()) {
      setEditError('Isi teks tidak boleh kosong.');
      return;
    }

    const ok = await onUpdateJob(jobId, {
      filename: editFilename.trim(),
      text: editText.trim(),
    });

    if (ok) {
      setEditingJobId(null);
    } else {
      setEditError('Gagal menyimpan perubahan.');
    }
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= jobs.length) return;

    const newOrder = [...jobs];
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    onReorder(newOrder.map((j) => j.id));
  };

  return (
    <div className="space-y-5">
      {/* Top Header & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="h-5 w-5 text-cyan-400" />
            <span>Text Manager & Editor</span>
          </h2>
          <p className="text-xs text-slate-400">
            Kelola teks narasi suara, tentukan nama file unik, urutan pengerjaan, dan import massal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {jobs.length > 0 && onClearAllJobs && (
            <button
              onClick={() => setIsDeletingAll(true)}
              className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-900/60 hover:text-white transition-all cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
              <span>Hapus Semua Teks</span>
            </button>
          )}
          <button
            onClick={() => onImportModal('txt')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5 text-cyan-400" />
            <span>Import TXT</span>
          </button>
          <button
            onClick={() => onImportModal('csv')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-indigo-400" />
            <span>Import CSV</span>
          </button>
          <button
            onClick={onAddTextModal}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:from-cyan-500 hover:to-indigo-500 transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah Teks</span>
          </button>
        </div>
      </div>

      {/* Search and Summary */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Cari nama file atau isi teks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>Total: <strong className="text-white">{jobs.length}</strong> pekerjaan</span>
          <span>•</span>
          <span>Ditampilkan: <strong className="text-cyan-400">{filteredJobs.length}</strong></span>
        </div>
      </div>

      {/* Jobs List / Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden shadow-md">
        {/* Desktop & Tablet Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3 w-16 text-center">Urutan</th>
                <th className="py-3 px-3 w-48">Nama File</th>
                <th className="py-3 px-3 min-w-[260px]">Isi Teks TTS</th>
                <th className="py-3 px-3 w-28 text-center">Status</th>
                <th className="py-3 px-3 w-28 text-center">Durasi / Size</th>
                <th className="py-3 px-3 w-36 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredJobs.map((job, idx) => {
                const isEditing = editingJobId === job.id;
                const isDuplicate = (nameCounts.get(job.filename.toLowerCase()) || 0) > 1;

                return (
                  <tr
                    key={job.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isEditing ? 'bg-cyan-950/20' : ''
                    }`}
                  >
                    {/* Urutan & Move buttons */}
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1 font-mono font-bold text-cyan-400">
                        <span>{String(job.order).padStart(3, '0')}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => handleMove(idx, 'up')}
                            disabled={idx === 0}
                            className="p-0.5 text-slate-500 hover:text-cyan-400 disabled:opacity-20 cursor-pointer"
                            title="Pindah ke atas"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => handleMove(idx, 'down')}
                            disabled={idx === jobs.length - 1}
                            className="p-0.5 text-slate-500 hover:text-cyan-400 disabled:opacity-20 cursor-pointer"
                            title="Pindah ke bawah"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Nama File */}
                    <td className="py-3 px-3 font-mono font-medium text-slate-200">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editFilename}
                          onChange={(e) => setEditFilename(e.target.value)}
                          className="w-full rounded border border-cyan-500 bg-slate-950 px-2 py-1 text-xs text-white"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{job.filename}</span>
                          {isDuplicate && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[9px] bg-amber-950/80 text-amber-400 border border-amber-500/30"
                              title="Nama file duplikat! Disarankan ubah agar tidak tertimpa."
                            >
                              Duplikat
                            </span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Isi Teks TTS */}
                    <td className="py-3 px-3 text-slate-300">
                      {isEditing ? (
                        <div className="space-y-1">
                          <textarea
                            rows={3}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full rounded border border-cyan-500 bg-slate-950 px-2 py-1 text-xs text-white resize-y"
                          />
                          {editError && (
                            <p className="text-[10px] text-rose-400 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              <span>{editError}</span>
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="line-clamp-2">{job.text}</p>
                          <span className="text-[10px] text-slate-500">
                            {job.text.length} karakter
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          job.status === 'COMPLETED'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            : job.status === 'FAILED'
                            ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                            : ['PREPARING', 'SENDING_TEXT', 'GENERATING', 'CONVERTING', 'SAVING'].includes(job.status)
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 animate-pulse'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>

                    {/* Durasi / Size */}
                    <td className="py-3 px-3 text-center text-slate-400">
                      {job.duration ? (
                        <div className="font-mono text-[11px] text-slate-300">
                          <div>~{job.duration}s</div>
                          {job.mp3Size && (
                            <div className="text-[10px] text-slate-500">
                              {(job.mp3Size / 1024).toFixed(1)} KB
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>

                    {/* Aksi */}
                    <td className="py-3 px-3 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleSaveEdit(job.id)}
                            className="rounded p-1 text-emerald-400 hover:bg-emerald-950 cursor-pointer"
                            title="Simpan"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingJobId(null)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
                            title="Batal"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleStartEdit(job)}
                            className="rounded p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 cursor-pointer"
                            title="Edit Teks"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDuplicateJob(job)}
                            className="rounded p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 cursor-pointer"
                            title="Duplikasi Pekerjaan"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteJob(job.id)}
                            className="rounded p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 cursor-pointer"
                            title="Hapus Pekerjaan"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">Tidak ada pekerjaan teks yang ditemukan.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Adaptive Cards View (< md) */}
        <div className="block md:hidden divide-y divide-slate-800/70">
          {filteredJobs.map((job, idx) => {
            const isEditing = editingJobId === job.id;
            const isDuplicate = (nameCounts.get(job.filename.toLowerCase()) || 0) > 1;

            return (
              <div key={`m-txt-${job.id}`} className="p-3 space-y-2.5">
                {/* Header: Order, Move buttons, Status */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono font-bold text-xs text-cyan-400 shrink-0">
                      #{String(job.order).padStart(3, '0')}
                    </span>
                    <div className="flex items-center gap-0.5 bg-slate-800/80 rounded px-1 py-0.5 border border-slate-700/60">
                      <button
                        onClick={() => handleMove(idx, 'up')}
                        disabled={idx === 0}
                        className="p-1 text-slate-400 hover:text-white disabled:opacity-20 active:scale-95"
                        title="Pindah ke atas"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMove(idx, 'down')}
                        disabled={idx === jobs.length - 1}
                        className="p-1 text-slate-400 hover:text-white disabled:opacity-20 active:scale-95"
                        title="Pindah ke bawah"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <span
                    className={`rounded-md px-2 py-0.5 text-[9px] font-bold shrink-0 ${
                      job.status === 'COMPLETED'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                        : job.status === 'FAILED'
                        ? 'bg-rose-950 text-rose-400 border border-rose-500/30'
                        : ['PREPARING', 'SENDING_TEXT', 'GENERATING', 'CONVERTING', 'SAVING'].includes(job.status)
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 animate-pulse'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {job.status}
                  </span>
                </div>

                {/* Filename & Duplicate badge */}
                <div>
                  {isEditing ? (
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-semibold">Nama File:</label>
                      <input
                        type="text"
                        value={editFilename}
                        onChange={(e) => setEditFilename(e.target.value)}
                        className="w-full rounded border border-cyan-500 bg-slate-950 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-200">
                      <span className="truncate">{job.filename}</span>
                      {isDuplicate && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] bg-amber-950/80 text-amber-400 border border-amber-500/30">
                          Duplikat
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Text Snippet / Editor */}
                <div>
                  {isEditing ? (
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-semibold">Isi Teks TTS:</label>
                      <textarea
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full rounded border border-cyan-500 bg-slate-950 px-2.5 py-1.5 text-xs text-white resize-y"
                      />
                      {editError && (
                        <p className="text-[10px] text-rose-400 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          <span>{editError}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/70">
                      <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">{job.text}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1.5 mt-1 border-t border-slate-800/50">
                        <span>{job.text.length} karakter</span>
                        {job.duration && (
                          <span className="font-mono text-slate-400">
                            ~{job.duration}s {job.mp3Size ? `• ${(job.mp3Size / 1024).toFixed(1)} KB` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Footer */}
                <div className="flex items-center justify-end gap-1 pt-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(job.id)}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white active:bg-emerald-700"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Simpan</span>
                      </button>
                      <button
                        onClick={() => setEditingJobId(null)}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-800 text-slate-300 active:bg-slate-700"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Batal</span>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEdit(job)}
                        className="flex items-center gap-1 rounded-lg p-2 text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 active:bg-slate-700"
                        title="Edit Teks"
                      >
                        <Edit2 className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-[11px]">Edit</span>
                      </button>
                      <button
                        onClick={() => onDuplicateJob(job)}
                        className="flex items-center gap-1 rounded-lg p-2 text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 active:bg-slate-700"
                        title="Duplikasi Pekerjaan"
                      >
                        <Copy className="h-3.5 w-3.5 text-indigo-400" />
                        <span className="text-[11px]">Salin</span>
                      </button>
                      <button
                        onClick={() => onDeleteJob(job.id)}
                        className="flex items-center gap-1 rounded-lg p-2 text-xs font-medium bg-rose-950/40 text-rose-300 border border-rose-500/30 active:bg-rose-900/60"
                        title="Hapus Pekerjaan"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        <span className="text-[11px]">Hapus</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {filteredJobs.length === 0 && (
            <div className="py-8 text-center text-slate-500 px-4">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">Tidak ada pekerjaan teks yang ditemukan.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Konfirmasi Hapus Semua Teks */}
      {isDeletingAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-rose-400 mb-2 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              <span>Hapus Semua Teks & Riwayat?</span>
            </h3>
            <p className="text-xs text-slate-300 mb-4">
              Apakah Anda yakin ingin menghapus <strong className="text-white">{jobs.length} pekerjaan teks</strong> dari daftar? Tindakan ini akan menghapus riwayat dari browser dan server.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsDeletingAll(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  if (onClearAllJobs) {
                    await onClearAllJobs();
                  }
                  setIsDeletingAll(false);
                }}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-500 shadow-md shadow-rose-600/30 cursor-pointer"
              >
                Ya, Hapus Semua Teks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
