/**
 * Layanan Sinkronisasi Folder Lokal Ketat (folderSyncService / localFolderSync)
 * Using File System Access API (showDirectoryPicker) + Strict Audio Container Validation.
 *
 * Aturan Ketat Folder Audio:
 * - Hanya berkas audio asli valid (.wav ber-header RIFF/WAVE atau audio valid berdurasi > 0.1 detik)
 *   yang diterima, dibaca, dan disinkronkan ke penyimpanan IndexedDB website sebagai Audio Adegan.
 * - File .htm, .html, .crdownload, .tmp, .part, gambar (.png/.jpg/.webp/dll), atau file non-audio
 *   ditolak secara otomatis.
 *
 * Author: Faiz_Fahmi_ID
 */

export type StorageLocationType = 'internal' | 'portable';

export interface StrictAudioValidationResult {
  valid: boolean;
  format?: 'wav' | 'mp3' | 'audio';
  duration: number;
  cleanBaseName: string;
  sampleRate?: number;
  channels?: number;
  reason?: string;
}

export interface ValidLocalAudioEntry {
  filename: string;
  baseName: string;
  file: File;
  buffer: ArrayBuffer;
  duration: number;
  format: 'wav' | 'mp3' | 'audio';
}

export interface FolderSyncScanSummary {
  totalScanned: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectedFiles: Array<{ filename: string; reason: string }>;
}

export interface FolderSyncState {
  isSupported: boolean;
  isConnected: boolean;
  isMissing: boolean;
  folderName: string | null;
  savedFolderName: string | null;
  storageType: StorageLocationType;
  autoDeleteTemporaryWav: boolean;
  isWatching: boolean;
  lastDetectedFile: string | null;
  lastSyncTime: number | null;
  temporaryFileCount: number;
  acceptedCount: number;
  rejectedCount: number;
  lastRejectedFile: string | null;
  lastRejectedReason: string | null;
}

type SyncListener = (state: FolderSyncState) => void;

const IDB_DB_NAME = 'ai_tts_sync_db';
const IDB_STORE_NAME = 'handles';
const IDB_KEY = 'connected_dir_handle';

const BLOCKED_EXTENSIONS = new Set([
  '.htm', '.html', '.xhtml', '.mhtml',
  '.crdownload', '.tmp', '.temp', '.part', '.partial', '.download',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff', '.avif',
  '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.md', '.xml', '.csv', '.log',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.msi', '.bat', '.cmd', '.sh', '.dll',
]);

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac', '.webm', '.opus',
]);

const BLOCKED_EXACT_FILENAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  '.ds_store',
  'readme.txt',
]);

export function getFileExtensionLower(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

export function isBlockedFilename(filename: string): { blocked: boolean; reason?: string } {
  const trimmed = (filename || '').trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower.startsWith('.') || lower.startsWith('~$')) {
    return { blocked: true, reason: 'Berkas sistem atau sementara tersembunyi ditolak.' };
  }
  if (BLOCKED_EXACT_FILENAMES.has(lower)) {
    return { blocked: true, reason: `Berkas non-audio "${trimmed}" dilewati otomatis.` };
  }
  const ext = getFileExtensionLower(lower);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { blocked: true, reason: `Ekstensi ${ext} ditolak otomatis (bukan berkas audio valid).` };
  }
  if (ext && !ALLOWED_AUDIO_EXTENSIONS.has(ext)) {
    return { blocked: true, reason: `Ekstensi ${ext} bukan format audio yang didukung.` };
  }
  return { blocked: false };
}

/**
 * Validasi header RIFF/WAVE & hitung durasi sebenarnya dari ArrayBuffer
 */
export function validateRiffWaveBuffer(buffer: ArrayBuffer): {
  valid: boolean;
  duration: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  reason?: string;
} {
  if (!buffer || buffer.byteLength < 44) {
    return {
      valid: false,
      duration: 0,
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      reason: 'Ukuran buffer terlalu kecil (< 44 byte header RIFF/WAVE).',
    };
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Deteksi cepat file HTML/Gambar/PDF/ZIP yang menyamar sebagai .wav
  const head4 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const headLower = head4.toLowerCase();
  if (headLower.startsWith('<htm') || headLower.startsWith('<!do') || headLower.startsWith('<svg')) {
    return { valid: false, duration: 0, sampleRate: 0, channels: 0, bitsPerSample: 0, reason: 'Berkas berisi HTML/SVG, bukan audio WAV.' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { valid: false, duration: 0, sampleRate: 0, channels: 0, bitsPerSample: 0, reason: 'Berkas berisi gambar PNG, ditolak.' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: false, duration: 0, sampleRate: 0, channels: 0, bitsPerSample: 0, reason: 'Berkas berisi gambar JPEG, ditolak.' };
  }
  if (head4 === 'GIF8' || head4 === '%PDF' || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03)) {
    return { valid: false, duration: 0, sampleRate: 0, channels: 0, bitsPerSample: 0, reason: `Berkas bertanda "${head4}" bukan audio.` };
  }

  const riffTag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const waveTag = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riffTag !== 'RIFF' || waveTag !== 'WAVE') {
    return {
      valid: false,
      duration: 0,
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      reason: `Header bukan RIFF/WAVE yang sah (${riffTag}/${waveTag}).`,
    };
  }

  let offset = 12;
  let fmtFound = false;
  let dataFound = false;
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset <= buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ' && offset + 8 + 16 <= buffer.byteLength) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      byteRate = view.getUint32(offset + 16, true);
      bitsPerSample = view.getUint16(offset + 22, true);
      fmtFound = true;
    } else if (chunkId === 'data') {
      const remaining = Math.max(0, buffer.byteLength - (offset + 8));
      dataSize = chunkSize > 0 ? Math.min(chunkSize, remaining) : remaining;
      dataFound = true;
      break;
    }

    const step = 8 + chunkSize + (chunkSize % 2);
    if (step <= 8) break;
    offset += step;
  }

  if (!fmtFound || !dataFound || channels < 1 || sampleRate < 4000 || dataSize <= 0) {
    return {
      valid: false,
      duration: 0,
      sampleRate,
      channels,
      bitsPerSample,
      reason: 'Struktur chunk RIFF/WAVE tidak lengkap atau data audio kosong.',
    };
  }

  const effectiveByteRate =
    byteRate > 0 ? byteRate : Math.max(1, sampleRate * channels * Math.max(1, Math.floor(bitsPerSample / 8)));
  const duration = Math.round((dataSize / effectiveByteRate) * 100) / 100;

  if (!Number.isFinite(duration) || duration <= 0.1) {
    return {
      valid: false,
      duration,
      sampleRate,
      channels,
      bitsPerSample,
      reason: `Durasi audio terlalu pendek (${duration.toFixed(2)} detik, minimal > 0.1 detik).`,
    };
  }

  return { valid: true, duration, sampleRate, channels, bitsPerSample };
}

/**
 * Decode non-RIFF audio container using Web Audio API to enforce strict duration > 0.1s
 */
async function probeDurationViaWebAudio(buffer: ArrayBuffer): Promise<number | null> {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(buffer.slice(0));
    return Number.isFinite(decoded.duration) ? Math.round(decoded.duration * 100) / 100 : null;
  } catch {
    return null;
  } finally {
    if (ctx) {
      ctx.close().catch(() => {});
    }
  }
}

/**
 * Validasi Ketat Berkas Audio Folder Lokal:
 * - Menolak otomatis .htm, .html, .crdownload, .tmp, gambar, dan non-audio.
 * - Menerima hanya .wav ber-header RIFF/WAVE atau berkas audio valid berdurasi > 0.1 detik.
 */
export async function validateAudioFileStrict(file: File): Promise<{
  validation: StrictAudioValidationResult;
  buffer?: ArrayBuffer;
}> {
  const filename = file?.name || '';
  const blockCheck = isBlockedFilename(filename);
  if (blockCheck.blocked) {
    return {
      validation: {
        valid: false,
        duration: 0,
        cleanBaseName: filename,
        reason: blockCheck.reason,
      },
    };
  }

  if (file.size < 128) {
    return {
      validation: {
        valid: false,
        duration: 0,
        cleanBaseName: filename,
        reason: 'Ukuran file terlalu kecil (< 128 byte).',
      },
    };
  }

  const ext = getFileExtensionLower(filename);
  const cleanBaseName = filename.replace(/\.(wav|mp3|ogg|m4a|aac|flac|webm|opus)$/i, '').trim() || 'audio';

  const buffer = await file.arrayBuffer();
  const riffCheck = validateRiffWaveBuffer(buffer);

  if (riffCheck.valid) {
    return {
      validation: {
        valid: true,
        format: 'wav',
        duration: riffCheck.duration,
        cleanBaseName,
        sampleRate: riffCheck.sampleRate,
        channels: riffCheck.channels,
      },
      buffer,
    };
  }

  // Tolak langsung jika file .wav tapi isinya HTML/gambar/korup
  if (ext === '.wav' && riffCheck.reason && !riffCheck.reason.startsWith('Header bukan RIFF/WAVE')) {
    return {
      validation: {
        valid: false,
        duration: 0,
        cleanBaseName,
        reason: riffCheck.reason,
      },
    };
  }

  // Untuk file audio non-RIFF (mis. MP3/OGG/M4A/FLAC/WebM atau audio/* valid), verifikasi lewat Web Audio decode (> 0.1 detik)
  const isAudioExt = ALLOWED_AUDIO_EXTENSIONS.has(ext) || (file.type || '').toLowerCase().startsWith('audio/');
  if (isAudioExt) {
    const decodedDuration = await probeDurationViaWebAudio(buffer);
    if (decodedDuration !== null && decodedDuration > 0.1) {
      return {
        validation: {
          valid: true,
          format: ext === '.mp3' ? 'mp3' : 'audio',
          duration: decodedDuration,
          cleanBaseName,
        },
        buffer,
      };
    }
  }

  return {
    validation: {
      valid: false,
      duration: 0,
      cleanBaseName,
      reason: riffCheck.reason || 'Berkas bukan audio RIFF/WAVE atau durasi audio <= 0.1 detik.',
    },
  };
}

// Simple IndexedDB helper to persist directory handle across page reloads
async function getPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const getReq = store.get(IDB_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function savePersistedHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        if (handle) {
          store.put(handle, IDB_KEY);
        } else {
          store.delete(IDB_KEY);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

class LocalFolderSyncService {
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private isWatching = false;
  private watchTimer: any = null;
  private watchInFlight = false;
  private seenFileFingerprints = new Map<string, string>();
  private seenRejectedFingerprints = new Map<string, string>();
  private listeners: Set<SyncListener> = new Set();
  private autoDelete = false;
  private lastDetectedFile: string | null = null;
  private lastSyncTime: number | null = null;
  private temporaryFileCount = 0;
  private acceptedCount = 0;
  private rejectedCount = 0;
  private lastRejectedFile: string | null = null;
  private lastRejectedReason: string | null = null;
  private isMissing = false;
  private savedFolderName: string | null = null;
  private storageType: StorageLocationType = 'internal';

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const savedAutoDelete = localStorage.getItem('ai_tts_auto_delete_temp_wav');
      if (savedAutoDelete === 'true') {
        this.autoDelete = false;
        localStorage.setItem('ai_tts_auto_delete_temp_wav', 'false');
      }

      const savedType = localStorage.getItem('ai_tts_storage_type');
      if (savedType === 'portable' || savedType === 'internal') {
        this.storageType = savedType;
      }

      this.savedFolderName = localStorage.getItem('ai_tts_saved_folder_name');
    }

    if (this.isSupported()) {
      getPersistedHandle().then(async (handle) => {
        if (handle) {
          try {
            const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
              this.dirHandle = handle;
              this.isMissing = false;
              await this.updateTempCount();
              this.notify();
            } else {
              this.savedFolderName = handle.name;
              this.isMissing = false;
              this.notify();
            }
          } catch (err: any) {
            console.warn('[Folder Sync] Handle restoration error (drive detached?):', err);
            this.isMissing = true;
            this.notify();
          }
        }
      });
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  public getState(): FolderSyncState {
    return {
      isSupported: this.isSupported(),
      isConnected: !!this.dirHandle && !this.isMissing,
      isMissing: this.isMissing,
      folderName: this.dirHandle ? this.dirHandle.name : null,
      savedFolderName: this.savedFolderName,
      storageType: this.storageType,
      autoDeleteTemporaryWav: this.autoDelete,
      isWatching: this.isWatching,
      lastDetectedFile: this.lastDetectedFile,
      lastSyncTime: this.lastSyncTime,
      temporaryFileCount: this.temporaryFileCount,
      acceptedCount: this.acceptedCount,
      rejectedCount: this.rejectedCount,
      lastRejectedFile: this.lastRejectedFile,
      lastRejectedReason: this.lastRejectedReason,
    };
  }

  public setStorageType(type: StorageLocationType) {
    this.storageType = type;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_tts_storage_type', type);
    }
    this.notify();
  }

  public setAutoDelete(enabled: boolean) {
    this.autoDelete = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ai_tts_auto_delete_temp_wav', String(enabled));
    }
    this.notify();
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const s = this.getState();
    this.listeners.forEach((fn) => fn(s));
  }

  public async pickFolder(): Promise<{ success: boolean; folderName?: string; error?: string }> {
    if (!this.isSupported()) {
      return { success: false, error: 'Browser ini belum mendukung File System Access API. Gunakan Google Chrome desktop.' };
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'downloads',
      });

      this.dirHandle = handle;
      this.isMissing = false;
      this.seenFileFingerprints.clear();
      this.seenRejectedFingerprints.clear();
      this.savedFolderName = handle.name;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('ai_tts_saved_folder_name', handle.name);
      }
      await savePersistedHandle(handle);
      await this.updateTempCount();
      this.notify();
      return { success: true, folderName: handle.name };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, error: 'Pemilihan folder dibatalkan oleh pengguna.' };
      }
      return { success: false, error: err.message || 'Gagal memilih folder.' };
    }
  }

  public async reconnectSavedHandle(): Promise<{ success: boolean; folderName?: string; error?: string }> {
    try {
      const handle = await getPersistedHandle();
      if (!handle) {
        return await this.pickFolder();
      }

      const req = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (req === 'granted') {
        this.dirHandle = handle;
        this.isMissing = false;
        this.seenFileFingerprints.clear();
        this.seenRejectedFingerprints.clear();
        this.savedFolderName = handle.name;
        await this.updateTempCount();
        this.notify();
        return { success: true, folderName: handle.name };
      } else {
        return { success: false, error: 'Izin akses folder ditolak oleh peramban.' };
      }
    } catch (err: any) {
      this.isMissing = true;
      this.notify();
      return { success: false, error: `Folder belum terdeteksi di drive PC (${err.message || 'Periksa flashdisk/koneksi folder'}).` };
    }
  }

  public async disconnectFolder(): Promise<void> {
    this.dirHandle = null;
    this.isMissing = false;
    this.savedFolderName = null;
    this.stopWatching();
    this.seenFileFingerprints.clear();
    this.seenRejectedFingerprints.clear();
    this.temporaryFileCount = 0;
    this.acceptedCount = 0;
    this.rejectedCount = 0;
    this.lastRejectedFile = null;
    this.lastRejectedReason = null;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ai_tts_saved_folder_name');
    }
    await savePersistedHandle(null);
    this.notify();
  }

  /**
   * Resolve the target "unduhan" directory:
   * - If user picked "unduhan" directly -> uses it.
   * - If user picked extension root containing "unduhan/" -> uses its existing "unduhan" subfolder.
   */
  private async resolveUnduhanDir(rootDir: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
    if (!rootDir) return rootDir;
    if (rootDir.name.toLowerCase() === 'unduhan') {
      return rootDir;
    }
    try {
      const sub = await (rootDir as any).getDirectoryHandle('unduhan', { create: false });
      if (sub) return sub;
    } catch {}
    return rootDir;
  }

  /**
   * Write a validated RIFF/WAVE file into the connected "unduhan" folder.
   * Rejects non-RIFF/WAVE or <= 0.1s buffers automatically!
   */
  public async writeWavFile(filename: string, data: Blob | ArrayBuffer): Promise<boolean> {
    if (!this.dirHandle) return false;
    try {
      const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
      const check = validateRiffWaveBuffer(buf);
      if (!check.valid) {
        console.warn('[Folder Sync] Menolak menulis berkas non-RIFF/WAVE ke folder:', filename, check.reason);
        return false;
      }

      const cleanName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
      const targetDir = await this.resolveUnduhanDir(this.dirHandle);
      const fileHandle = await (targetDir as any).getFileHandle(cleanName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buf);
      await writable.close();

      // Pre-mark written file fingerprint so live watcher does not duplicate ingestion
      try {
        const writtenFile = await fileHandle.getFile();
        this.seenFileFingerprints.set(cleanName.toLowerCase(), `${writtenFile.size}::${writtenFile.lastModified}`);
      } catch {}

      this.lastDetectedFile = cleanName;
      this.lastSyncTime = Date.now();
      await this.updateTempCount();
      return true;
    } catch (err) {
      console.warn('[Folder Sync] Failed writing WAV into connected unduhan folder:', err);
      return false;
    }
  }

  /**
   * Count valid audio candidates in the connected unduhan folder
   */
  public async updateTempCount(): Promise<number> {
    if (!this.dirHandle) {
      this.temporaryFileCount = 0;
      return 0;
    }

    let count = 0;
    try {
      const targetDir = await this.resolveUnduhanDir(this.dirHandle);
      for await (const [name, handle] of (targetDir as any).entries()) {
        if (handle.kind === 'file') {
          const check = isBlockedFilename(name);
          if (!check.blocked) count++;
        }
      }
      this.temporaryFileCount = count;
      this.isMissing = false;
      this.notify();
    } catch (err) {
      console.warn('[Folder Sync] Folder read check failed (portable drive disconnected?):', err);
      this.temporaryFileCount = 0;
      this.isMissing = true;
      this.notify();
    }
    return count;
  }

  /**
   * Scan root directory and known subdirectories for a specific matching valid WAV/audio file
   */
  public async findAndReadWavFile(targetFilename: string): Promise<{ buffer: ArrayBuffer; file: File } | null> {
    if (!this.dirHandle) return null;

    const cleanBase = targetFilename.toLowerCase().replace(/\.(wav|mp3|ogg|m4a|flac|webm)$/i, '');
    const possibleNames = [`${cleanBase}.wav`, cleanBase, 'assistant.wav', 'audio.wav'];

    try {
      const searchInDirectory = async (
        dir: FileSystemDirectoryHandle,
        depth = 0
      ): Promise<{ buffer: ArrayBuffer; file: File; dir: FileSystemDirectoryHandle; entryName: string } | null> => {
        if (depth > 2) return null;

        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            if (isBlockedFilename(name).blocked) continue;
            const file = await handle.getFile();
            const lowerName = name.toLowerCase();
            const isMatch =
              possibleNames.some(
                (p) => lowerName === p || lowerName.startsWith(`${cleanBase}.wav`) || lowerName.startsWith(`${cleanBase} `) || lowerName.includes(cleanBase)
              ) ||
              (lowerName.includes('assistant') && Date.now() - file.lastModified < 60000);

            if (isMatch) {
              const { validation, buffer } = await validateAudioFileStrict(file);
              if (validation.valid && buffer) {
                return { buffer, file, dir, entryName: name };
              }
            }
          } else if (handle.kind === 'directory') {
            const lowerDir = name.toLowerCase();
            if (['unduhan', 'downloads', 'ai_tts_downloads', 'audio', 'temp'].includes(lowerDir) || lowerDir.includes('tts')) {
              const foundInSub = await searchInDirectory(handle, depth + 1);
              if (foundInSub) return foundInSub;
            }
          }
        }
        return null;
      };

      const result = await searchInDirectory(this.dirHandle);
      if (result) {
        this.lastDetectedFile = result.entryName;
        this.lastSyncTime = Date.now();
        this.isMissing = false;
        this.notify();

        if (this.autoDelete) {
          try {
            await (result.dir as any).removeEntry(result.entryName);
            this.updateTempCount();
          } catch {}
        }

        return { buffer: result.buffer, file: result.file };
      }
    } catch (e: any) {
      console.warn('[Folder Sync] Error iterating folder:', e);
      if (e?.name === 'NotFoundError' || e?.message?.includes('not found')) {
        this.isMissing = true;
        this.notify();
      }
    }

    return null;
  }

  /**
   * Read & strictly validate all valid audio files inside the connected "unduhan" folder.
   * Rejects .htm, .crdownload, .tmp, images, and <= 0.1s audio automatically.
   */
  public async scanValidAudioFiles(): Promise<{
    entries: ValidLocalAudioEntry[];
    summary: FolderSyncScanSummary;
  }> {
    if (!this.dirHandle) {
      return {
        entries: [],
        summary: { totalScanned: 0, acceptedCount: 0, rejectedCount: 0, rejectedFiles: [] },
      };
    }

    const entries: ValidLocalAudioEntry[] = [];
    const rejectedFiles: Array<{ filename: string; reason: string }> = [];
    let totalScanned = 0;

    try {
      const targetDir = await this.resolveUnduhanDir(this.dirHandle);
      for await (const [name, handle] of (targetDir as any).entries()) {
        if (handle.kind !== 'file') continue;
        totalScanned++;

        const blockCheck = isBlockedFilename(name);
        if (blockCheck.blocked) {
          // Abaikan README.txt dari hitungan error user, tapi tetap catat file mencurigakan seperti .htm/.crdownload/.tmp/gambar
          if (name.toLowerCase() !== 'readme.txt') {
            rejectedFiles.push({ filename: name, reason: blockCheck.reason || 'Ditolak aturan ketat folder audio.' });
          }
          continue;
        }

        try {
          const file = await handle.getFile();
          const { validation, buffer } = await validateAudioFileStrict(file);
          if (validation.valid && buffer) {
            entries.push({
              filename: name,
              baseName: validation.cleanBaseName,
              file,
              buffer,
              duration: validation.duration,
              format: validation.format || 'wav',
            });
            this.seenFileFingerprints.set(name.toLowerCase(), `${file.size}::${file.lastModified}`);
          } else {
            rejectedFiles.push({
              filename: name,
              reason: validation.reason || 'Format audio tidak valid atau durasi <= 0.1 detik.',
            });
          }
        } catch (err: any) {
          rejectedFiles.push({ filename: name, reason: err?.message || 'Gagal membaca berkas.' });
        }
      }

      this.lastSyncTime = Date.now();
      this.temporaryFileCount = entries.length;
      this.acceptedCount = entries.length;
      this.rejectedCount = rejectedFiles.length;
      if (rejectedFiles.length > 0) {
        const lastRej = rejectedFiles[rejectedFiles.length - 1];
        this.lastRejectedFile = lastRej.filename;
        this.lastRejectedReason = lastRej.reason;
      } else {
        this.lastRejectedFile = null;
        this.lastRejectedReason = null;
      }
      this.isMissing = false;
      this.notify();
    } catch (e: any) {
      console.warn('[Folder Sync] Error listing valid audio files:', e);
      if (e?.name === 'NotFoundError' || e?.message?.includes('not found')) {
        this.isMissing = true;
        this.notify();
      }
    }

    return {
      entries,
      summary: {
        totalScanned,
        acceptedCount: entries.length,
        rejectedCount: rejectedFiles.length,
        rejectedFiles,
      },
    };
  }

  /**
   * Backward-compatible wrapper returning ValidLocalAudioEntry[]
   */
  public async listAllWavFiles(): Promise<ValidLocalAudioEntry[]> {
    const { entries } = await this.scanValidAudioFiles();
    return entries;
  }

  /**
   * Safely delete only audio files inside connected folder. NEVER deletes extension files.
   */
  public async clearTemporaryWavFiles(): Promise<{ success: boolean; deletedCount: number; error?: string }> {
    if (!this.dirHandle) {
      return { success: false, deletedCount: 0, error: 'Folder belum terhubung.' };
    }

    let deleted = 0;
    try {
      const cleanDir = async (dir: FileSystemDirectoryHandle, depth = 0) => {
        if (depth > 2) return;
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            if (name.toLowerCase().endsWith('.wav')) {
              try {
                await (dir as any).removeEntry(name);
                this.seenFileFingerprints.delete(name.toLowerCase());
                deleted++;
              } catch (e) {
                console.warn(`[Folder Sync] Gagal menghapus ${name}:`, e);
              }
            }
          } else if (handle.kind === 'directory') {
            const lowerDir = name.toLowerCase();
            if (['unduhan', 'downloads', 'ai_tts_downloads', 'audio', 'temp'].includes(lowerDir)) {
              await cleanDir(handle, depth + 1);
            }
          }
        }
      };

      await cleanDir(this.dirHandle);
      this.temporaryFileCount = 0;
      this.acceptedCount = 0;
      this.notify();
      return { success: true, deletedCount: deleted };
    } catch (err: any) {
      return { success: false, deletedCount: deleted, error: err.message || 'Gagal membersihkan folder.' };
    }
  }

  /**
   * Mark a filename/size/lastModified as already ingested (e.g. synced via Extension Bridge)
   */
  public markFingerprintIngested(filename: string, size: number, lastModified: number) {
    this.seenFileFingerprints.set(filename.toLowerCase(), `${size}::${lastModified}`);
  }

  /**
   * Start real-time strict watcher on connected "unduhan" folder.
   * Only emits newly added or modified valid audio files (RIFF/WAVE or valid audio > 0.1s).
   * Automatically rejects .htm, .crdownload, .tmp, images, and corrupt files.
   */
  public startWatching(onFileDetected: (result: ValidLocalAudioEntry) => void) {
    if (!this.dirHandle) return;
    if (this.isWatching) return;

    this.isWatching = true;
    this.notify();

    this.watchTimer = setInterval(async () => {
      if (!this.dirHandle) {
        this.stopWatching();
        return;
      }
      if (this.watchInFlight) return;
      this.watchInFlight = true;

      try {
        const targetDir = await this.resolveUnduhanDir(this.dirHandle);
        let validCountInDir = 0;
        let rejectedInDir = 0;

        for await (const [name, handle] of (targetDir as any).entries()) {
          if (handle.kind !== 'file') continue;
          const lowerKey = name.toLowerCase();

          const blockCheck = isBlockedFilename(name);
          if (blockCheck.blocked) {
            if (lowerKey !== 'readme.txt') {
              rejectedInDir++;
              if (this.seenRejectedFingerprints.get(lowerKey) !== blockCheck.reason) {
                this.seenRejectedFingerprints.set(lowerKey, blockCheck.reason || 'blocked');
                this.lastRejectedFile = name;
                this.lastRejectedReason = blockCheck.reason || 'File non-audio ditolak otomatis.';
                console.warn(`[folderSyncService] Menolak otomatis "${name}": ${this.lastRejectedReason}`);
              }
            }
            continue;
          }

          const file = await handle.getFile();
          const fp = `${file.size}::${file.lastModified}`;

          // Wait briefly if file was just created < 250ms ago so OS finishes flushing bytes
          if (Date.now() - file.lastModified < 250) continue;

          if (this.seenFileFingerprints.get(lowerKey) === fp) {
            validCountInDir++;
            continue;
          }

          const { validation, buffer } = await validateAudioFileStrict(file);
          if (!validation.valid || !buffer) {
            rejectedInDir++;
            const rejFp = `${fp}::${validation.reason}`;
            if (this.seenRejectedFingerprints.get(lowerKey) !== rejFp) {
              this.seenRejectedFingerprints.set(lowerKey, rejFp);
              this.lastRejectedFile = name;
              this.lastRejectedReason = validation.reason || 'Audio tidak valid.';
              console.warn(`[folderSyncService] File "${name}" ditolak aturan ketat: ${this.lastRejectedReason}`);
            }
            continue;
          }

          // Lolos aturan ketat -> tandai & kirim ke callback website untuk disimpan ke IndexedDB sebagai Audio Adegan
          this.seenFileFingerprints.set(lowerKey, fp);
          validCountInDir++;
          this.lastDetectedFile = name;
          this.lastSyncTime = Date.now();

          onFileDetected({
            filename: name,
            baseName: validation.cleanBaseName,
            file,
            buffer,
            duration: validation.duration,
            format: validation.format || 'wav',
          });

          if (this.autoDelete) {
            try {
              await (targetDir as any).removeEntry(name);
            } catch {}
          }
        }

        if (
          this.temporaryFileCount !== validCountInDir ||
          this.rejectedCount !== rejectedInDir ||
          this.isMissing
        ) {
          this.temporaryFileCount = validCountInDir;
          this.acceptedCount = validCountInDir;
          this.rejectedCount = rejectedInDir;
          this.isMissing = false;
          this.notify();
        }
      } catch (err) {
        this.isMissing = true;
        this.notify();
      } finally {
        this.watchInFlight = false;
      }
    }, 1500);
  }

  public stopWatching() {
    this.isWatching = false;
    this.watchInFlight = false;
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.notify();
  }
}

export const localFolderSync = new LocalFolderSyncService();
export const folderSyncService = localFolderSync;
