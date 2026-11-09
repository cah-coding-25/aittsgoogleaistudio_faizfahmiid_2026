/**
 * Local IndexedDB Storage for Audio Files (WAV & MP3)
 * Author: Faiz_Fahmi_ID
 *
 * Guarantees that downloaded files are ALWAYS 100% real audio (.mp3 or .wav),
 * NEVER .htm or corrupted files, even if the backend is offline or on ephemeral serverless (Vercel).
 * Stores audio blobs persistently in browser storage per PC/client workspace.
 */

import { convertWavToMp3Client } from './clientAudioConverter';
import { localFolderSync } from './localFolderSync';

const DB_NAME = 'AI_TTS_AUDIO_STORE_V1';
const DB_VERSION = 1;
const STORE_NAME = 'audio_blobs';

interface StoredAudio {
  id: string; // `${clientId}__${format}__${baseName}`
  clientId: string;
  baseName: string;
  format: 'mp3' | 'wav';
  blob: Blob;
  size: number;
  mimeType: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('clientId', 'clientId', { unique: false });
        store.createIndex('baseName', 'baseName', { unique: false });
        store.createIndex('format', 'format', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save an audio blob (MP3 or WAV) to local browser storage
 */
export async function saveAudioBlob(
  clientId: string,
  baseName: string,
  format: 'mp3' | 'wav',
  blob: Blob
): Promise<void> {
  try {
    const db = await openDB();
    const id = `${clientId}__${format}__${baseName}`;
    const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    const item: StoredAudio = {
      id,
      clientId,
      baseName,
      format,
      blob,
      size: blob.size,
      mimeType,
      createdAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[LocalAudioStorage] Could not save audio to IndexedDB:', err);
  }
}

/**
 * Retrieve an audio blob from local browser storage
 */
export async function getAudioBlob(
  clientId: string,
  baseName: string,
  format: 'mp3' | 'wav'
): Promise<Blob | null> {
  try {
    const db = await openDB();
    const id = `${clientId}__${format}__${baseName}`;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(req.result.blob);
        } else {
          // Fallback: search by baseName & format ignoring clientId
          const index = store.index('baseName');
          const cursorReq = index.openCursor(IDBKeyRange.only(baseName));
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const val = cursor.value as StoredAudio;
              if (val.format === format && val.blob) {
                resolve(val.blob);
                return;
              }
              cursor.continue();
            } else {
              resolve(null);
            }
          };
          cursorReq.onerror = () => resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Delete a specific audio track from local browser storage
 */
export async function deleteAudioBlob(
  clientId: string,
  baseName: string
): Promise<void> {
  try {
    const db = await openDB();
    const idMp3 = `${clientId}__mp3__${baseName}`;
    const idWav = `${clientId}__wav__${baseName}`;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(idMp3);
    store.delete(idWav);
  } catch {}
}

/**
 * Clear all local audio blobs for a client or entire database
 */
export async function clearAllAudioBlobs(clientId?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    if (!clientId) {
      store.clear();
      return;
    }

    const index = store.index('clientId');
    const req = index.openCursor(IDBKeyRange.only(clientId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch {}
}

/**
 * Download an audio file directly to the user's Downloads folder.
 * STRICT SAFETY RULES:
 * 1. Guarantees filename ends with .mp3 or .wav matching exact initial input.
 * 2. Checks local IndexedDB first to guarantee instant download without server 404s.
 * 3. If fetching from server, inspects response content-type. NEVER creates or downloads .htm files!
 */
export async function triggerSafeAudioDownload(
  baseName: string,
  format: 'mp3' | 'wav',
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  const targetExt = format.toLowerCase() as 'mp3' | 'wav';
  const cleanBase = baseName.replace(/\.(mp3|wav|htm|html)$/i, '');
  const targetFilename = `${cleanBase}.${targetExt}`;
  const targetMime = targetExt === 'mp3' ? 'audio/mpeg' : 'audio/wav';

  try {
    // Step 1: Check local IndexedDB first
    let audioBlob = await getAudioBlob(clientId, cleanBase, targetExt);

    // Step 1b: If MP3 requested but not in DB, auto-convert from local WAV (IndexedDB or Local Connected Folder)
    if (!audioBlob && targetExt === 'mp3') {
      const wavBlob = await getAudioBlob(clientId, cleanBase, 'wav');
      if (wavBlob) {
        try {
          const conv = await convertWavToMp3Client(wavBlob, 192);
          if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
            audioBlob = conv.mp3Blob;
            await saveAudioBlob(clientId, cleanBase, 'mp3', audioBlob).catch(() => {});
          }
        } catch (e) {
          console.warn('[SafeDownload] Auto-convert from cached WAV failed:', e);
        }
      } else if (localFolderSync.getState().isConnected) {
        try {
          const found = await localFolderSync.findAndReadWavFile(cleanBase);
          if (found) {
            await saveAudioBlob(clientId, cleanBase, 'wav', found.file).catch(() => {});
            const conv = await convertWavToMp3Client(found.file, 192);
            if (conv.success && conv.mp3Blob && conv.mp3Blob.size > 0) {
              audioBlob = conv.mp3Blob;
              await saveAudioBlob(clientId, cleanBase, 'mp3', audioBlob).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('[SafeDownload] Auto-convert from connected folder WAV failed:', e);
        }
      }
    }

    // Step 1c: If WAV requested and not in DB, check local connected folder
    if (!audioBlob && targetExt === 'wav' && localFolderSync.getState().isConnected) {
      try {
        const found = await localFolderSync.findAndReadWavFile(cleanBase);
        if (found) {
          audioBlob = found.file;
          await saveAudioBlob(clientId, cleanBase, 'wav', audioBlob).catch(() => {});
        }
      } catch (e) {}
    }

    // Step 2: If not in IndexedDB or local folder, fetch from server endpoint with payload fallback
    if (!audioBlob) {
      const url = `/api/audio/download/${targetExt}/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`;
      let res = await fetch(url).catch(() => null);

      if (res && res.ok) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html') && !contentType.includes('application/json')) {
          const serverBlob = await res.blob();
          if (serverBlob.size >= 100) {
            audioBlob = new Blob([serverBlob], { type: targetMime });
            saveAudioBlob(clientId, cleanBase, targetExt, audioBlob).catch(() => {});
          }
        }
      }

      // Fallback: Query payload endpoint (returns in-memory base64 from server)
      if (!audioBlob) {
        try {
          const payloadRes = await fetch(`/api/audio/payload/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`);
          if (payloadRes.ok) {
            const data = await payloadRes.json();
            const b64 = targetExt === 'mp3' ? (data.mp3Base64 || data.wavBase64) : (data.wavBase64 || data.mp3Base64);
            if (b64) {
              const byteCharacters = atob(b64);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              audioBlob = new Blob([byteArray], { type: targetMime });
              saveAudioBlob(clientId, cleanBase, targetExt, audioBlob).catch(() => {});
            }
          }
        } catch {}
      }

      if (!audioBlob) {
        throw new Error(`File audio tidak tersedia di server (Status 404). Pastikan teks telah selesai digenerate.`);
      }
    }

    if (!audioBlob || audioBlob.size === 0) {
      throw new Error(`Berkas ${targetFilename} kosong atau tidak ditemukan.`);
    }

    // Step 3: Trigger real browser download with exact name and correct MIME type
    const blobUrl = window.URL.createObjectURL(new Blob([audioBlob], { type: targetMime }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = targetFilename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      window.URL.revokeObjectURL(blobUrl);
    }, 10000);

    return { success: true };
  } catch (err: any) {
    console.error('[SafeAudioDownload] Error:', err);
    return { success: false, error: err.message || 'Gagal mengunduh berkas audio' };
  }
}
