import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import lamejs from '@breezystack/lamejs';
import { validateWavBuffer } from './validator.ts';
import { storageService } from './storage.ts';

export interface ConversionResult {
  success: boolean;
  mp3Path?: string;
  mp3Size?: number;
  duration?: number;
  error?: string;
}

/**
 * Check if ffmpeg binary exists in PATH
 */
export function hasSystemFFmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a valid synthetic 16-bit PCM WAV buffer (useful for mock testing & verification)
 */
export function generateTestWav(durationSeconds = 2, sampleRate = 24000, frequency = 440): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // 'fmt ' chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28); // byte rate
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
  buffer.writeUInt16LE(bitsPerSample, 34);

  // 'data' chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Synthesize sine wave with gentle decay
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.max(0, 1 - t / durationSeconds);
    const sample = Math.sin(2 * Math.PI * frequency * t) * 0.5 * envelope;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Parse WAV PCM 16-bit samples from buffer
 */
function parseWavPCM(buffer: Buffer): {
  channels: number;
  sampleRate: number;
  leftChannel: Int16Array;
  rightChannel?: Int16Array;
} {
  let offset = 12;
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = 44;
  let dataSize = buffer.length - 44;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(offset + 8);
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }
    // Word-aligned chunk padding
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const numSamples = Math.floor(dataSize / (bytesPerSample * channels));
  const left = new Int16Array(numSamples);
  const right = channels > 1 ? new Int16Array(numSamples) : undefined;

  let readPtr = dataOffset;
  for (let i = 0; i < numSamples; i++) {
    if (readPtr + bytesPerSample > buffer.length) break;

    // Decode sample for left channel
    let sampleVal = 0;
    if (bitsPerSample === 16) {
      sampleVal = buffer.readInt16LE(readPtr);
    } else if (bitsPerSample === 32) {
      if (audioFormat === 3) {
        // IEEE Float32 (-1.0 to 1.0)
        const f = buffer.readFloatLE(readPtr);
        sampleVal = Math.max(-32768, Math.min(32767, Math.round(f * 32767)));
      } else {
        sampleVal = Math.round(buffer.readInt32LE(readPtr) / 65536);
      }
    } else if (bitsPerSample === 24) {
      const b0 = buffer[readPtr];
      const b1 = buffer[readPtr + 1];
      const b2 = buffer[readPtr + 2];
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= ~0xffffff;
      sampleVal = Math.round(val / 256);
    } else if (bitsPerSample === 8) {
      sampleVal = (buffer.readUInt8(readPtr) - 128) * 256;
    }
    left[i] = Math.max(-32768, Math.min(32767, sampleVal));
    readPtr += bytesPerSample;

    // Decode sample for right channel if stereo
    if (channels > 1 && right) {
      if (readPtr + bytesPerSample <= buffer.length) {
        let rightVal = 0;
        if (bitsPerSample === 16) {
          rightVal = buffer.readInt16LE(readPtr);
        } else if (bitsPerSample === 32) {
          if (audioFormat === 3) {
            const f = buffer.readFloatLE(readPtr);
            rightVal = Math.max(-32768, Math.min(32767, Math.round(f * 32767)));
          } else {
            rightVal = Math.round(buffer.readInt32LE(readPtr) / 65536);
          }
        } else if (bitsPerSample === 24) {
          const b0 = buffer[readPtr];
          const b1 = buffer[readPtr + 1];
          const b2 = buffer[readPtr + 2];
          let val = (b2 << 16) | (b1 << 8) | b0;
          if (val & 0x800000) val |= ~0xffffff;
          rightVal = Math.round(val / 256);
        } else if (bitsPerSample === 8) {
          rightVal = (buffer.readUInt8(readPtr) - 128) * 256;
        }
        right[i] = Math.max(-32768, Math.min(32767, rightVal));
        readPtr += bytesPerSample;
      }
    }
  }

  return { channels, sampleRate, leftChannel: left, rightChannel: right };
}

let cachedMp3EncoderClass: any = null;
function getMp3Encoder(): any {
  if (cachedMp3EncoderClass) return cachedMp3EncoderClass;
  const direct = (lamejs as any)?.Mp3Encoder || (lamejs as any)?.default?.Mp3Encoder;
  if (typeof direct === 'function') {
    cachedMp3EncoderClass = direct;
    return cachedMp3EncoderClass;
  }
  try {
    const iifePath = path.resolve('node_modules/@breezystack/lamejs/dist/lamejs.iife.js');
    if (fs.existsSync(iifePath)) {
      const code = fs.readFileSync(iifePath, 'utf8');
      const mod = new Function(code + '; return lamejs;')();
      if (mod && typeof mod.Mp3Encoder === 'function') {
        cachedMp3EncoderClass = mod.Mp3Encoder;
        return cachedMp3EncoderClass;
      }
    }
  } catch (e) {
    console.warn('[Converter] Could not load iife lamejs:', e);
  }
  return null;
}

/**
 * Convert WAV buffer to MP3 buffer using native lamejs
 */
export function convertWavToMp3Buffer(wavBuffer: Buffer, bitrateKbps = 192): { mp3Buffer: Buffer; duration: number } {
  const { channels, sampleRate, leftChannel, rightChannel } = parseWavPCM(wavBuffer);
  const Mp3EncoderClass = getMp3Encoder();
  if (!Mp3EncoderClass) {
    throw new Error('LAME MP3 Encoder tidak tersedia di runtime.');
  }
  const encoder = new Mp3EncoderClass(channels, sampleRate, bitrateKbps);

  const mp3Data: Buffer[] = [];
  const sampleBlockSize = 1152;
  const numSamples = leftChannel.length;

  for (let i = 0; i < numSamples; i += sampleBlockSize) {
    const leftChunk = leftChannel.subarray(i, i + sampleBlockSize);
    let mp3buf: Int8Array | Uint8Array;
    if (channels === 1 || !rightChannel) {
      mp3buf = encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = rightChannel.subarray(i, i + sampleBlockSize);
      mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    }
    if (mp3buf.length > 0) {
      mp3Data.push(Buffer.from(mp3buf));
    }
  }

  const flushBuf = encoder.flush();
  if (flushBuf.length > 0) {
    mp3Data.push(Buffer.from(flushBuf));
  }

  const mp3Buffer = Buffer.concat(mp3Data);
  const duration = Math.round((numSamples / sampleRate) * 100) / 100;

  return { mp3Buffer, duration };
}

/**
 * Convert a WAV file on disk to MP3 file on disk
 */
export async function convertWavFileToMp3(
  wavPath: string,
  outputPath: string,
  bitrateKbps = 192
): Promise<ConversionResult> {
  try {
    if (!fs.existsSync(wavPath)) {
      return { success: false, error: `File WAV sumber tidak ditemukan: ${wavPath}` };
    }

    const wavBuffer = fs.readFileSync(wavPath);
    const wavCheck = validateWavBuffer(wavBuffer);
    if (!wavCheck.valid) {
      return { success: false, error: wavCheck.error || 'File WAV tidak valid' };
    }

    // Check settings for preferred mode
    const settings = storageService.getSettings();
    let mp3Buffer: Buffer | null = null;
    let duration = wavCheck.duration || 0;

    if (settings.conversionMode === 'ffmpeg' && hasSystemFFmpeg()) {
      try {
        execSync(`ffmpeg -y -i "${wavPath}" -b:a ${bitrateKbps}k "${outputPath}"`, { stdio: 'pipe' });
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          return {
            success: true,
            mp3Path: outputPath,
            mp3Size: stats.size,
            duration,
          };
        }
      } catch (e: any) {
        console.warn('System ffmpeg failed, falling back to built-in encoder', e.message);
      }
    }

    // Built-in pure JS encoder (reliable everywhere)
    const result = convertWavToMp3Buffer(wavBuffer, bitrateKbps);
    mp3Buffer = result.mp3Buffer;
    duration = result.duration;

    if (!mp3Buffer || mp3Buffer.length < 128) {
      return { success: false, error: 'Hasil konversi MP3 kosong atau korup.' };
    }

    // Write MP3 output
    fs.writeFileSync(outputPath, mp3Buffer);

    // Verify written file
    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'File MP3 gagal ditulis ke disk.' };
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      return { success: false, error: 'Ukuran file MP3 yang tersimpan adalah 0 byte.' };
    }

    return {
      success: true,
      mp3Path: outputPath,
      mp3Size: stats.size,
      duration,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Kesalahan konversi audio: ${err?.message || 'Error tidak diketahui'}`,
    };
  }
}
