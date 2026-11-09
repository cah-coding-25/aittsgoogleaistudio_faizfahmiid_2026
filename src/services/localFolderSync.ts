/**
 * Local Folder Sync Service using File System Access API (showDirectoryPicker)
 * Supports both:
 * 1. "Penyimpanan Tanam" (Internal Harddisk C:/D:) - Permanent & Always Available
 * 2. "Penyimpanan Portabel" (Flashdisk / USB Drive / External SSD) - Mobile but unpluggable
 * Handles graceful detection when portable drive is unplugged vs replugged.
 * Author: Faiz_Fahmi_ID
 */

export type StorageLocationType = 'internal' | 'portable';

export interface FolderSyncState {
  isSupported: boolean;
  isConnected: boolean;
  isMissing: boolean; // True if previously selected folder is missing (e.g. USB flashdisk unplugged)
  folderName: string | null;
  savedFolderName: string | null;
  storageType: StorageLocationType;
  autoDeleteTemporaryWav: boolean;
  isWatching: boolean;
  lastDetectedFile: string | null;
  lastSyncTime: number | null;
  temporaryFileCount: number;
}

type SyncListener = (state: FolderSyncState) => void;

const IDB_DB_NAME = 'ai_tts_sync_db';
const IDB_STORE_NAME = 'handles';
const IDB_KEY = 'connected_dir_handle';

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
  private listeners: Set<SyncListener> = new Set();
  private autoDelete = true;
  private lastDetectedFile: string | null = null;
  private lastSyncTime: number | null = null;
  private temporaryFileCount = 0;
  private isMissing = false;
  private savedFolderName: string | null = null;
  private storageType: StorageLocationType = 'internal';

  constructor() {
    const savedAutoDelete = localStorage.getItem('ai_tts_auto_delete_temp_wav');
    if (savedAutoDelete !== null) {
      this.autoDelete = savedAutoDelete === 'true';
    }

    const savedType = localStorage.getItem('ai_tts_storage_type');
    if (savedType === 'portable' || savedType === 'internal') {
      this.storageType = savedType;
    }

    this.savedFolderName = localStorage.getItem('ai_tts_saved_folder_name');

    // Try restoring persisted handle from previous session
    if (this.isSupported()) {
      getPersistedHandle().then(async (handle) => {
        if (handle) {
          try {
            // Verify if permission is still granted
            const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
              this.dirHandle = handle;
              this.isMissing = false;
              await this.updateTempCount();
              this.notify();
            } else {
              // Permission prompt needed or drive missing
              this.savedFolderName = handle.name;
              this.isMissing = false;
              this.notify();
            }
          } catch (err: any) {
            // Error typically occurs when portable drive is detached
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

  public getDirectoryHandle(): FileSystemDirectoryHandle | null {
    return this.dirHandle;
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
    };
  }

  public setStorageType(type: StorageLocationType) {
    this.storageType = type;
    localStorage.setItem('ai_tts_storage_type', type);
    this.notify();
  }

  public setAutoDelete(enabled: boolean) {
    this.autoDelete = enabled;
    localStorage.setItem('ai_tts_auto_delete_temp_wav', String(enabled));
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

  /**
   * Request user to pick any folder (Downloads, workspace folder, flashdisk, or unduhan/)
   */
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
      this.savedFolderName = handle.name;
      localStorage.setItem('ai_tts_saved_folder_name', handle.name);
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

  /**
   * Attempt to reconnect to previously saved handle (e.g. after portable flashdisk plugged back in)
   */
  public async reconnectSavedHandle(): Promise<{ success: boolean; folderName?: string; error?: string }> {
    try {
      const handle = await getPersistedHandle();
      if (!handle) {
        return await this.pickFolder();
      }

      // Re-request permission from user interaction
      const req = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (req === 'granted') {
        this.dirHandle = handle;
        this.isMissing = false;
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

  /**
   * Disconnect folder handle safely anytime
   */
  public async disconnectFolder(): Promise<void> {
    this.dirHandle = null;
    this.isMissing = false;
    this.savedFolderName = null;
    this.stopWatching();
    this.temporaryFileCount = 0;
    localStorage.removeItem('ai_tts_saved_folder_name');
    await savePersistedHandle(null);
    this.notify();
  }

  /**
   * Count WAV files in connected folder and known subfolders
   */
  public async updateTempCount(): Promise<number> {
    if (!this.dirHandle) {
      this.temporaryFileCount = 0;
      return 0;
    }

    let count = 0;
    try {
      const scanDir = async (dir: FileSystemDirectoryHandle, depth = 0) => {
        if (depth > 2) return;
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            if (name.toLowerCase().endsWith('.wav')) count++;
          } else if (handle.kind === 'directory') {
            const lowerDir = name.toLowerCase();
            if (['unduhan', 'downloads', 'ai_tts_downloads', 'audio', 'temp'].includes(lowerDir)) {
              await scanDir(handle, depth + 1);
            }
          }
        }
      };

      await scanDir(this.dirHandle);
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
   * Save a genuine WAV buffer directly to the user-chosen folder on PC disk
   */
  public async saveWavFileToConnectedFolder(filename: string, buffer: ArrayBuffer): Promise<boolean> {
    if (!this.dirHandle) return false;
    try {
      const cleanName = filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`;
      const fileHandle = await (this.dirHandle as any).getFileHandle(cleanName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
      this.lastDetectedFile = cleanName;
      this.lastSyncTime = Date.now();
      await this.updateTempCount();
      this.notify();
      console.log(`[Folder Sync] Berkas WAV "${cleanName}" berhasil disimpan langsung ke folder: ${this.dirHandle.name}`);
      return true;
    } catch (err) {
      console.warn('[Folder Sync] Gagal menulis berkas ke folder terhubung:', err);
      return false;
    }
  }

  /**
   * Scan root directory and known subdirectories for a matching WAV file
   */
  public async findAndReadWavFile(targetFilename: string): Promise<{ buffer: ArrayBuffer; file: File } | null> {
    if (!this.dirHandle) return null;

    const cleanBase = targetFilename.toLowerCase().replace(/\.(wav|mp3)$/i, '');
    const possibleNames = [
      `${cleanBase}.wav`,
      cleanBase,
      'assistant.wav',
      'audio.wav',
    ];

    try {
      const searchInDirectory = async (dir: FileSystemDirectoryHandle, depth = 0): Promise<{ buffer: ArrayBuffer; file: File; dir: FileSystemDirectoryHandle; entryName: string } | null> => {
        if (depth > 2) return null;

        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            const file = await handle.getFile();
            const lowerName = name.toLowerCase();
            const isMatch = possibleNames.some(
              (p) => lowerName === p || lowerName.startsWith(`${cleanBase}.wav`) || lowerName.startsWith(`${cleanBase} `) || lowerName.includes(cleanBase)
            ) || (lowerName.includes('assistant') && Date.now() - file.lastModified < 60000);

            if (isMatch) {
              if (file.size >= 1000) {
                const buffer = await file.arrayBuffer();
                const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
                if (header === 'RIFF') {
                  return { buffer, file, dir, entryName: name };
                }
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

        // Auto-delete temporary WAV from the directory if enabled
        if (this.autoDelete) {
          try {
            await (result.dir as any).removeEntry(result.entryName);
            console.log(`[Folder Sync] Berkas sementara ${result.entryName} otomatis dibersihkan dari folder.`);
            this.updateTempCount();
          } catch (delErr) {
            console.warn(`[Folder Sync] Tidak dapat menghapus ${result.entryName}:`, delErr);
          }
        }

        return { buffer: result.buffer, file: result.file };
      }
    } catch (e: any) {
      console.warn('[Folder Sync] Error iterating folder (unplugged?):', e);
      if (e?.name === 'NotFoundError' || e?.message?.includes('not found')) {
        this.isMissing = true;
        this.notify();
      }
    }

    return null;
  }

  /**
   * Scan folder and subfolders to retrieve all existing WAV files
   */
  public async listAllWavFiles(): Promise<Array<{ filename: string; file: File; buffer: ArrayBuffer }>> {
    if (!this.dirHandle) return [];
    const results: Array<{ filename: string; file: File; buffer: ArrayBuffer }> = [];

    try {
      const scanDir = async (dir: FileSystemDirectoryHandle, depth = 0) => {
        if (depth > 2) return;
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'file') {
            if (name.toLowerCase().endsWith('.wav')) {
              try {
                const file = await handle.getFile();
                if (file.size >= 1000) {
                  const buffer = await file.arrayBuffer();
                  const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
                  if (header === 'RIFF') {
                    results.push({ filename: name, file, buffer });
                  }
                }
              } catch {}
            }
          } else if (handle.kind === 'directory') {
            const lowerDir = name.toLowerCase();
            if (['unduhan', 'downloads', 'ai_tts_downloads', 'audio', 'temp'].includes(lowerDir) || lowerDir.includes('tts')) {
              await scanDir(handle, depth + 1);
            }
          }
        }
      };

      await scanDir(this.dirHandle);
    } catch (e) {
      console.warn('[Folder Sync] Error listing WAV files:', e);
    }

    return results;
  }

  /**
   * Safely delete all temporary .wav files inside the folder and subfolders.
   * NEVER deletes the folder itself, NEVER deletes extension files (.js, .json, .html, etc.).
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
      this.notify();
      return { success: true, deletedCount: deleted };
    } catch (err: any) {
      return { success: false, deletedCount: deleted, error: err.message || 'Gagal membersihkan folder.' };
    }
  }

  /**
   * Start polling folder for incoming audio files
   */
  public startWatching(onFileDetected: (result: { buffer: ArrayBuffer; filename: string }) => void) {
    if (this.isWatching || !this.dirHandle) return;
    this.isWatching = true;
    this.notify();

    this.watchTimer = setInterval(async () => {
      if (!this.dirHandle) {
        this.stopWatching();
        return;
      }

      try {
        const scanAndProcess = async (dir: FileSystemDirectoryHandle, depth = 0) => {
          if (depth > 2) return;
          for await (const [name, handle] of (dir as any).entries()) {
            if (handle.kind === 'file' && name.toLowerCase().endsWith('.wav')) {
              const file = await handle.getFile();
              if (file.size >= 1000 && Date.now() - file.lastModified > 300) {
                const buffer = await file.arrayBuffer();
                const header = String.fromCharCode(...new Uint8Array(buffer.slice(0, 4)));
                if (header === 'RIFF') {
                  this.lastDetectedFile = name;
                  this.lastSyncTime = Date.now();
                  this.notify();

                  onFileDetected({ buffer, filename: name });

                  if (this.autoDelete) {
                    try {
                      await (dir as any).removeEntry(name);
                      this.updateTempCount();
                    } catch {}
                  }
                }
              }
            } else if (handle.kind === 'directory') {
              const lowerDir = name.toLowerCase();
              if (['unduhan', 'downloads', 'ai_tts_downloads', 'audio', 'temp'].includes(lowerDir)) {
                await scanAndProcess(handle, depth + 1);
              }
            }
          }
        };

        await scanAndProcess(this.dirHandle);
      } catch (err) {
        // Stop watching if drive disconnected
        this.isMissing = true;
        this.notify();
      }
    }, 1200);
  }

  public stopWatching() {
    this.isWatching = false;
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.notify();
  }
}

export const localFolderSync = new LocalFolderSyncService();
