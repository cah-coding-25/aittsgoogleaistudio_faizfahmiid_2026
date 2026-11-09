import lamejs from '@breezystack/lamejs';

export interface ClientConversionResult {
  success: boolean;
  mp3Blob: Blob;
  mp3Size: number;
  duration: number;
  error?: string;
}

/**
 * Decode WAV file array buffer into 16-bit PCM samples
 */
export async function decodeAudioBuffer(file: File | Blob | ArrayBuffer): Promise<{
  channels: number;
  sampleRate: number;
  leftChannel: Int16Array;
  rightChannel?: Int16Array;
  duration: number;
}> {
  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const view = new DataView(arrayBuffer);

  // Strategy 1: Pure RIFF WAV parser (Fastest, synchronous, bypasses any AudioContext browser restrictions)
  if (arrayBuffer.byteLength >= 44) {
    try {
      const isRiff =
        String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) === 'RIFF' &&
        String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) === 'WAVE';

      if (isRiff) {
        let offset = 12;
        let channels = 1;
        let sampleRate = 24000;
        let bitsPerSample = 16;
        let dataOffset = 44;
        let dataSize = 0;
        let fmtFound = false;

        while (offset < arrayBuffer.byteLength - 8) {
          const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
          );
          const chunkSize = view.getUint32(offset + 4, true);

          if (chunkId === 'fmt ') {
            channels = view.getUint16(offset + 10, true) || 1;
            sampleRate = view.getUint32(offset + 12, true) || 24000;
            bitsPerSample = view.getUint16(offset + 22, true) || 16;
            fmtFound = true;
          } else if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataSize = Math.min(chunkSize, arrayBuffer.byteLength - dataOffset);
            break;
          }
          offset += 8 + chunkSize + (chunkSize % 2);
        }

        if (fmtFound && dataOffset > 0 && dataSize > 0) {
          const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
          const numSamples = Math.floor(dataSize / (bytesPerSample * channels));
          const left = new Int16Array(numSamples);
          const right = channels > 1 ? new Int16Array(numSamples) : undefined;

          let readPtr = dataOffset;
          for (let i = 0; i < numSamples; i++) {
            if (readPtr + bytesPerSample > arrayBuffer.byteLength) break;
            let sample = 0;
            if (bitsPerSample === 16) {
              sample = view.getInt16(readPtr, true);
            } else if (bitsPerSample === 8) {
              sample = (view.getUint8(readPtr) - 128) * 256;
            } else if (bitsPerSample === 32) {
              sample = Math.round(view.getInt32(readPtr, true) / 65536);
            }
            left[i] = sample;
            readPtr += bytesPerSample;

            if (channels > 1 && right && readPtr + bytesPerSample <= arrayBuffer.byteLength) {
              let rSample = 0;
              if (bitsPerSample === 16) {
                rSample = view.getInt16(readPtr, true);
              } else if (bitsPerSample === 8) {
                rSample = (view.getUint8(readPtr) - 128) * 256;
              } else if (bitsPerSample === 32) {
                rSample = Math.round(view.getInt32(readPtr, true) / 65536);
              }
              right[i] = rSample;
              readPtr += bytesPerSample;
            }
          }

          const duration = Math.round((numSamples / sampleRate) * 100) / 100;
          return { channels, sampleRate, leftChannel: left, rightChannel: right, duration };
        }
      }
    } catch (parseErr) {
      console.warn('[ClientConverter] Direct RIFF parse error, falling back to Web Audio:', parseErr);
    }
  }

  // Strategy 2: Web Audio API fallback for other audio encodings
  if (typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const channels = decoded.numberOfChannels;
      const sampleRate = decoded.sampleRate;
      const duration = decoded.duration;

      const leftFloat = decoded.getChannelData(0);
      const leftChannel = new Int16Array(leftFloat.length);
      for (let i = 0; i < leftFloat.length; i++) {
        const s = Math.max(-1, Math.min(1, leftFloat[i]));
        leftChannel[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      let rightChannel: Int16Array | undefined;
      if (channels > 1) {
        const rightFloat = decoded.getChannelData(1);
        rightChannel = new Int16Array(rightFloat.length);
        for (let i = 0; i < rightFloat.length; i++) {
          const s = Math.max(-1, Math.min(1, rightFloat[i]));
          rightChannel[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
      }

      ctx.close().catch(() => {});
      return { channels, sampleRate, leftChannel, rightChannel, duration };
    } catch (e) {
      console.warn('[ClientConverter] Web Audio decode failed:', e);
    }
  }

  throw new Error('Berkas bukan format WAV PCM yang valid.');
}

/**
 * Convert any WAV audio to MP3 completely inside the browser (100% client-side, 0 network)
 */
export async function convertWavToMp3Client(
  file: File | Blob | ArrayBuffer,
  bitrateKbps = 192
): Promise<ClientConversionResult> {
  try {
    const { channels, sampleRate, leftChannel, rightChannel, duration } = await decodeAudioBuffer(file);

    // Resolve Mp3Encoder constructor from @breezystack/lamejs in any environment
    const Mp3Encoder =
      (lamejs as any).Mp3Encoder ||
      (lamejs as any).default?.Mp3Encoder ||
      (typeof window !== 'undefined' && (window as any).lamejs?.Mp3Encoder) ||
      lamejs;

    if (typeof Mp3Encoder !== 'function') {
      throw new Error('LAME MP3 encoder tidak dapat dimuat di browser.');
    }

    const encoder = new Mp3Encoder(channels, sampleRate, bitrateKbps);
    const mp3Chunks: Uint8Array[] = [];
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
      if (mp3buf && mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf.buffer, mp3buf.byteOffset, mp3buf.length));
      }
    }

    const flushBuf = encoder.flush();
    if (flushBuf && flushBuf.length > 0) {
      mp3Chunks.push(new Uint8Array(flushBuf.buffer, flushBuf.byteOffset, flushBuf.length));
    }

    const mp3Blob = new Blob(mp3Chunks as unknown as BlobPart[], { type: 'audio/mpeg' });

    return {
      success: true,
      mp3Blob,
      mp3Size: mp3Blob.size,
      duration,
    };
  } catch (err: any) {
    console.error('[ClientConverter] Error converting WAV to MP3:', err);
    return {
      success: false,
      mp3Blob: new Blob([], { type: 'audio/mpeg' }),
      mp3Size: 0,
      duration: 0,
      error: err?.message || 'Gagal konversi ke MP3 di browser.',
    };
  }
}
