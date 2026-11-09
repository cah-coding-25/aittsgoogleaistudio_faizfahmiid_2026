import path from 'path';

/**
 * Sanitize filename to ensure safe cross-platform file saving and prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'untitled';
  // Remove extension if passed
  let clean = filename.replace(/\.(wav|mp3|txt|csv)$/i, '');
  // Strip null bytes and path separators
  clean = clean.replace(/[\/\?<>\\:\*\|":]/g, '-');
  // Strip control chars
  clean = clean.replace(/[\x00-\x1f\x80-\x9f]/g, '');
  // Normalize whitespace and hyphens
  clean = clean.trim().replace(/\s+/g, '_').replace(/-+/g, '-');
  // Avoid leading dots or dashes
  clean = clean.replace(/^[\.\-]+/, '');
  if (!clean) clean = 'audio_track';
  // Limit length
  return clean.slice(0, 100);
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
    let numChannels = 1;
    let sampleRate = 24000;
    let bitsPerSample = 16;
    let dataSize = 0;

    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        numChannels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
      } else if (chunkId === 'data') {
        dataSize = chunkSize;
        break;
      }
      offset += 8 + chunkSize;
    }

    const bytesPerSample = (bitsPerSample / 8) * numChannels;
    const duration = bytesPerSample > 0 && sampleRate > 0 && dataSize > 0 
      ? Math.round((dataSize / (sampleRate * bytesPerSample)) * 100) / 100 
      : 0;

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
