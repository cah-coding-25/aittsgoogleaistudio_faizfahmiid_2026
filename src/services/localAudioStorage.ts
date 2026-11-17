/**
 * Local IndexedDB Storage for Audio Files (WAV & MP3)
 * Author: Faiz_Fahmi_ID
 *
 * Guarantees that downloaded files are ALWAYS 100% real audio (.mp3 or .wav),
 * NEVER .htm or corrupted files, even if the backend is offline or on ephemeral serverless (Vercel).
 * Stores audio blobs persistently in browser storage per PC/client workspace.
 */

import { convertWavToMp3Client } from './clientAudioConverter';
import { localFolderSync, validateRiffWaveBuffer } from './localFolderSync';
import { extensionClient } from './extensionBridge';

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

function cleanAudioBaseName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\.(mp3|wav|htm|html|ogg|m4a|flac|webm)$/i, '')
    .trim();
}

function decodeBase64ToArrayBuffer(rawInput: string): ArrayBuffer {
  const commaIdx = rawInput.indexOf(',');
  const b64 = commaIdx >= 0 ? rawInput.slice(commaIdx + 1) : rawInput;
  const binStr = atob(b64);
  const buf = new ArrayBuffer(binStr.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return buf;
}

export function isValidAudioBuffer(
  buffer: ArrayBuffer,
  format: 'mp3' | 'wav'
): { valid: boolean; reason?: string } {
  if (!buffer || buffer.byteLength < 64) {
    return { valid: false, reason: 'Buffer audio kosong atau terlalu kecil (< 64 byte).' };
  }

  const bytes = new Uint8Array(buffer);
  const head4 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const headLower = head4.toLowerCase();

  // Tolak tegas HTML, JSON error, PDF, gambar, atau ZIP yang menyamar sebagai file audio
  if (
    headLower.startsWith('<htm') ||
    headLower.startsWith('<!do') ||
    headLower.startsWith('<svg') ||
    headLower.startsWith('<?xm')
  ) {
    return { valid: false, reason: 'File berisi HTML/XML (bukan audio asli).' };
  }
  if (bytes[0] === 0x7b || bytes[0] === 0x5b) {
    // '{' or '[' JSON error payload
    try {
      const sampleText = new TextDecoder().decode(bytes.subarray(0, Math.min(256, bytes.length))).trim();
      if (sampleText.startsWith('{') || sampleText.startsWith('[')) {
        return { valid: false, reason: 'File berisi JSON error server, bukan audio asli.' };
      }
    } catch {}
  }
  if (
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    head4 === 'GIF8' ||
    head4 === '%PDF' ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03)
  ) {
    return { valid: false, reason: `File berisi non-audio (${head4}).` };
  }

  if (format === 'wav') {
    const riff = validateRiffWaveBuffer(buffer);
    if (!riff.valid) {
      return { valid: false, reason: riff.reason || 'Header RIFF/WAVE WAV tidak valid.' };
    }
    return { valid: true };
  }

  // Format MP3: tolak file terlalu kecil atau RIFF mentah yang belum dikonversi, cari header ID3 atau frame sync MPEG
  if (buffer.byteLength < 128) {
    return { valid: false, reason: 'Berkas MP3 terlalu kecil (< 128 byte).' };
  }
  if (head4 === 'RIFF') {
    return { valid: false, reason: 'Berkas masih berformat WAV (RIFF), bukan MP3.' };
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { valid: true }; // ID3 tag
  }
  const scanLimit = Math.min(bytes.length - 1, 8192);
  for (let i = 0; i < scanLimit; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0 && (bytes[i + 1] & 0x06) !== 0x00) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'Stream frame MPEG/MP3 tidak valid.' };
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
 * Save a strictly verified in-memory audio blob (MP3 or WAV) to IndexedDB.
 * Reads bytes into memory first so IndexedDB NEVER holds an expiring disk File handle.
 */
export async function saveAudioBlob(
  clientId: string,
  baseName: string,
  format: 'mp3' | 'wav',
  blob: Blob
): Promise<void> {
  const cleanBase = cleanAudioBaseName(baseName);
  if (!cleanBase || !blob) return;

  try {
    const buf = await blob.arrayBuffer();
    const check = isValidAudioBuffer(buf, format);
    if (!check.valid) {
      console.warn(`[LocalAudioStorage] Menolak menyimpan ${cleanBase}.${format} ke IndexedDB: ${check.reason}`);
      return;
    }

    const db = await openDB();
    const id = `${clientId}__${format}__${cleanBase}`;
    const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const memoryBlob = new Blob([buf], { type: mimeType });

    const item: StoredAudio = {
      id,
      clientId,
      baseName: cleanBase,
      format,
      blob: memoryBlob,
      size: memoryBlob.size,
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

async function deleteByKeyId(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Retrieve and validate an audio blob from IndexedDB.
 * Automatically purges corrupt/dead entries and returns a fresh in-memory Blob.
 */
export async function getAudioBlob(
  clientId: string,
  baseName: string,
  format: 'mp3' | 'wav'
): Promise<Blob | null> {
  const cleanBase = cleanAudioBaseName(baseName);
  if (!cleanBase) return null;

  try {
    const db = await openDB();
    const id = `${clientId}__${format}__${cleanBase}`;

    const candidate = await new Promise<StoredAudio | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(req.result as StoredAudio);
        } else {
          // Fallback: search by baseName & format across workspaces
          const index = store.index('baseName');
          const cursorReq = index.openCursor(IDBKeyRange.only(cleanBase));
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const val = cursor.value as StoredAudio;
              if (val.format === format && val.blob) {
                resolve(val);
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

    if (!candidate || !candidate.blob) return null;

    try {
      const buf = await candidate.blob.arrayBuffer();
      const check = isValidAudioBuffer(buf, format);
      if (!check.valid) {
        console.warn(`[LocalAudioStorage] Menghapus cache rusak ${candidate.id}: ${check.reason}`);
        await deleteByKeyId(candidate.id);
        return null;
      }
      const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
      return new Blob([buf], { type: mimeType });
    } catch {
      // File handle expired or unreadable on disk -> remove corrupt entry
      await deleteByKeyId(candidate.id);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Waterfall resolver to obtain 100% genuine, verified audio bytes (.wav or .mp3):
 * 1. Verified IndexedDB
 * 2. Connected local "unduhan" folder (File System Access API)
 * 3. Chrome Extension direct bridge readback (`GET_EXTENSION_WAV_BY_NAME`)
 * 4. Server `/api/audio/payload/:baseName` or `/api/audio/download/:format/:baseName`
 * And for MP3: auto-converts locally from verified WAV via LAME if MP3 isn't cached yet.
 */
export async function resolveValidAudioBlob(
  clientId: string,
  baseName: string,
  format: 'mp3' | 'wav'
): Promise<Blob | null> {
  const cleanBase = cleanAudioBaseName(baseName);
  if (!cleanBase) return null;

  const targetMime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

  // 1. Check IndexedDB (already strictly validated)
  const cached = await getAudioBlob(clientId, cleanBase, format);
  if (cached) return cached;

  // Helper to resolve genuine WAV from any available source
  const resolveVerifiedWav = async (): Promise<Blob | null> => {
    const cachedWav = await getAudioBlob(clientId, cleanBase, 'wav');
    if (cachedWav) return cachedWav;

    // 2a. Local connected "unduhan" folder
    if (localFolderSync.getState().isConnected) {
      try {
        const found = await localFolderSync.findAndReadWavFile(cleanBase);
        if (found?.buffer) {
          const check = isValidAudioBuffer(found.buffer, 'wav');
          if (check.valid) {
            const wavBlob = new Blob([found.buffer], { type: 'audio/wav' });
            await saveAudioBlob(clientId, cleanBase, 'wav', wavBlob);
            return wavBlob;
          }
        }
      } catch {}
    }

    // 2b. Chrome Extension readback (fs_handle or AUTO-EKSTENSI rolling cache)
    try {
      const extItem = await extensionClient.getExtensionWavByName(cleanBase);
      if (extItem?.dataUrl) {
        const buf = decodeBase64ToArrayBuffer(extItem.dataUrl);
        if (isValidAudioBuffer(buf, 'wav').valid) {
          const wavBlob = new Blob([buf], { type: 'audio/wav' });
          await saveAudioBlob(clientId, cleanBase, 'wav', wavBlob);
          return wavBlob;
        }
      }
    } catch {}

    // 2c. Server payload JSON base64
    try {
      const payloadRes = await fetch(`/api/audio/payload/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`);
      if (payloadRes.ok) {
        const data = await payloadRes.json();
        if (data?.wavBase64) {
          const buf = decodeBase64ToArrayBuffer(data.wavBase64);
          if (isValidAudioBuffer(buf, 'wav').valid) {
            const wavBlob = new Blob([buf], { type: 'audio/wav' });
            await saveAudioBlob(clientId, cleanBase, 'wav', wavBlob);
            return wavBlob;
          }
        }
      }
    } catch {}

    // 2d. Server binary download
    try {
      const dlRes = await fetch(`/api/audio/download/wav/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`);
      if (dlRes.ok) {
        const ct = (dlRes.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('text/html') && !ct.includes('application/json')) {
          const buf = await dlRes.arrayBuffer();
          if (isValidAudioBuffer(buf, 'wav').valid) {
            const wavBlob = new Blob([buf], { type: 'audio/wav' });
            await saveAudioBlob(clientId, cleanBase, 'wav', wavBlob);
            return wavBlob;
          }
        }
      }
    } catch {}

    return null;
  };

  if (format === 'wav') {
    return await resolveVerifiedWav();
  }

  // format === 'mp3':
  // 3a. Convert locally from resolved genuine WAV first (fast & always playable)
  const wavBlob = await resolveVerifiedWav();
  if (wavBlob) {
    try {
      const conv = await convertWavToMp3Client(wavBlob, 192);
      if (conv.success && conv.mp3Blob && conv.mp3Blob.size >= 128) {
        const mp3Buf = await conv.mp3Blob.arrayBuffer();
        if (isValidAudioBuffer(mp3Buf, 'mp3').valid) {
          const cleanMp3 = new Blob([mp3Buf], { type: targetMime });
          await saveAudioBlob(clientId, cleanBase, 'mp3', cleanMp3);
          return cleanMp3;
        }
      }
    } catch (e) {
      console.warn('[ResolveAudio] Local WAV->MP3 conversion failed:', e);
    }
  }

  // 3b. Server MP3 payload fallback
  try {
    const payloadRes = await fetch(`/api/audio/payload/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`);
    if (payloadRes.ok) {
      const data = await payloadRes.json();
      if (data?.mp3Base64) {
        const buf = decodeBase64ToArrayBuffer(data.mp3Base64);
        if (isValidAudioBuffer(buf, 'mp3').valid) {
          const mp3Blob = new Blob([buf], { type: targetMime });
          await saveAudioBlob(clientId, cleanBase, 'mp3', mp3Blob);
          return mp3Blob;
        }
      }
    }
  } catch {}

  // 3c. Server MP3 binary download fallback
  try {
    const dlRes = await fetch(`/api/audio/download/mp3/${encodeURIComponent(cleanBase)}?clientId=${encodeURIComponent(clientId)}`);
    if (dlRes.ok) {
      const ct = (dlRes.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('text/html') && !ct.includes('application/json')) {
        const buf = await dlRes.arrayBuffer();
        if (isValidAudioBuffer(buf, 'mp3').valid) {
          const mp3Blob = new Blob([buf], { type: targetMime });
          await saveAudioBlob(clientId, cleanBase, 'mp3', mp3Blob);
          return mp3Blob;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Delete a specific audio track from local browser storage
 */
export async function deleteAudioBlob(
  clientId: string,
  baseName: string
): Promise<void> {
  const cleanBase = cleanAudioBaseName(baseName);
  try {
    const db = await openDB();
    const idMp3 = `${clientId}__mp3__${cleanBase}`;
    const idWav = `${clientId}__wav__${cleanBase}`;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(idMp3);
      store.delete(idWav);

      // Also purge any fallback entry with the same baseName so getAudioBlob never resurrects deleted audio
      try {
        const index = store.index('baseName');
        const req = index.openCursor(IDBKeyRange.only(cleanBase));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      } catch {}

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

/**
 * Rename saved WAV & MP3 blobs in IndexedDB from oldBase to newBase
 */
export async function renameAudioBlobs(
  clientId: string,
  oldBase: string,
  newBase: string
): Promise<void> {
  if (!oldBase || !newBase || oldBase === newBase) return;
  try {
    const wavBlob = await getAudioBlob(clientId, oldBase, 'wav');
    const mp3Blob = await getAudioBlob(clientId, oldBase, 'mp3');
    if (wavBlob) {
      await saveAudioBlob(clientId, newBase, 'wav', wavBlob);
    }
    if (mp3Blob) {
      await saveAudioBlob(clientId, newBase, 'mp3', mp3Blob);
    }
    await deleteAudioBlob(clientId, oldBase);
  } catch {}
}

/**
 * Clear all local audio blobs for a client or entire database
 */
export async function clearAllAudioBlobs(clientId?: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();

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
    });
  } catch {}
}

/**
 * Download an audio file directly to the user's Downloads folder.
 * STRICT SAFETY RULES:
 * 1. Guarantees filename ends with .mp3 or .wav matching exact initial input.
 * 2. Resolves & validates genuine RIFF/WAVE or MPEG bytes (IndexedDB -> folder -> extension -> server).
 * 3. NEVER downloads HTML, JSON, empty, or corrupted audio files!
 */
export async function triggerSafeAudioDownload(
  baseName: string,
  format: 'mp3' | 'wav',
  clientId: string
): Promise<{ success: boolean; error?: string }> {
  const targetExt = format.toLowerCase() as 'mp3' | 'wav';
  const cleanBase = cleanAudioBaseName(baseName);
  const targetFilename = `${cleanBase}.${targetExt}`;
  const targetMime = targetExt === 'mp3' ? 'audio/mpeg' : 'audio/wav';

  try {
    const audioBlob = await resolveValidAudioBlob(clientId, cleanBase, targetExt);

    if (!audioBlob || audioBlob.size === 0) {
      throw new Error(
        `Berkas ${targetFilename} asli belum tersedia di browser atau folder "unduhan". Hubungkan folder "unduhan" ekstensi atau klik "Sinkronkan Ekstensi" terlebih dahulu.`
      );
    }

    const buf = await audioBlob.arrayBuffer();
    const finalCheck = isValidAudioBuffer(buf, targetExt);
    if (!finalCheck.valid) {
      throw new Error(`Dibatalkan demi keamanan: ${finalCheck.reason}`);
    }

    const blobUrl = window.URL.createObjectURL(new Blob([buf], { type: targetMime }));
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
