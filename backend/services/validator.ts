import path from 'path';

/**
 * Sanitize filename to ensure safe cross-platform file saving and prevent path traversal
 */
const WINDOWS_RESERVED_NAMES_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeFilename(filename: string): string {
  if (!filename) return 'untitled';
  // Remove extension if passed
  let clean = filename.replace(/\.(wav|mp3|txt|csv)$/i, '');
  // Strip null bytes and path separators / Windows-forbidden characters
  clean = clean.replace(/[\/\?<>\\:\*\|":]/g, '-');
  // Strip control chars
  clean = clean.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Normalize whitespace and hyphens
  clean = clean.trim().replace(/\s+/g, '_').replace(/-+/g, '-');
  // Avoid leading or trailing dots/dashes/underscores
  clean = clean.replace(/^[\.\-_]+|[\.\s]+$/g, '');
  if (!clean) clean = 'audio_track';
  if (WINDOWS_RESERVED_NAMES_RE.test(clean)) {
    clean = `${clean}_audio`;
  }
  // Limit length so Windows MAX_PATH is never exceeded
  return clean.slice(0, 80).replace(/[\.\s]+$/g, '') || 'audio_track';
}

/**
 * Validate that a filename is strictly alphanumeric + underscores/hyphens
 */
export function isValidFilename(filename: string): { valid: boolean; error?: string } {
  if (!filename || filename.trim().length === 0) {
    return { valid: false, error: 'Nama file tidak boleh kosong.' };
  }
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { valid: false, error: 'Nama file mengandung karakter path traversal terlarang.' };
  }
  const clean = sanitizeFilename(filename);
  if (clean.length === 0) {
    return { valid: false, error: 'Nama file tidak valid setelah disanitasi.' };
  }
  return { valid: true };
}

/**
 * Check if a buffer is a valid RIFF WAV audio container
 */
export function validateWavBuffer(buffer: Buffer): { valid: boolean; sampleRate?: number; channels?: number; duration?: number; error?: string } {
  if (!buffer || buffer.length < 44) {
    return { valid: false, error: 'Buffer audio terlalu kecil (minimal header 44 bytes).' };
  }

  // Check 'RIFF' header
  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    return { valid: false, error: `Header audio bukan RIFF (terbaca: "${riff}").` };
  }

  // Check 'WAVE' format
  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    return { valid: false, error: `Format bukan WAVE (terbaca: "${wave}").` };
  }

  try {
    let offset = 12;
    let fmtFound = false;
    let dataFound = false;
    let numChannels = 1;
    let sampleRate = 24000;
    let byteRate = 0;
    let bitsPerSample = 16;
    let dataSize = 0;

    while (offset <= buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ' && offset + 24 <= buffer.length) {
        numChannels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        byteRate = buffer.readUInt32LE(offset + 16);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
        fmtFound = true;
      } else if (chunkId === 'data') {
        const remaining = Math.max(0, buffer.length - (offset + 8));
        dataSize = chunkSize > 0 ? Math.min(chunkSize, remaining) : remaining;
        dataFound = true;
        break;
      }
      const step = 8 + chunkSize + (chunkSize % 2);
      if (step <= 8) break;
      offset += step;
    }

    if (!fmtFound || !dataFound || numChannels < 1 || sampleRate < 4000 || dataSize <= 0) {
      return { valid: false, error: 'Struktur chunk RIFF/WAVE tidak lengkap atau data audio kosong.' };
    }

    const effectiveByteRate =
      byteRate > 0 ? byteRate : Math.max(1, sampleRate * numChannels * Math.max(1, Math.floor(bitsPerSample / 8)));
    const duration = Math.round((dataSize / effectiveByteRate) * 100) / 100;

    if (!Number.isFinite(duration) || duration <= 0.1) {
      return { valid: false, error: `Durasi audio terlalu pendek (${duration.toFixed(2)}s, minimal > 0.1s).` };
    }

    return {
      valid: true,
      channels: numChannels,
      sampleRate,
      duration,
    };
  } catch (err: any) {
    return { valid: false, error: `Gagal membaca struktur WAV: ${err?.message || 'Format tidak dikenal'}` };
  }
}
