import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createIconPNG(size: number, outPath: string) {
  // Raw RGBA scanlines: each scanline has 1 filter byte (0x00) + size * 4 bytes
  const scanlineLength = 1 + size * 4;
  const rawData = Buffer.alloc(scanlineLength * size);

  for (let y = 0; y < size; y++) {
    const lineOffset = y * scanlineLength;
    rawData[lineOffset] = 0; // Filter: None

    for (let x = 0; x < size; x++) {
      const pixelOffset = lineOffset + 1 + x * 4;
      const dx = x - size / 2;
      const dy = y - size / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= size / 2 - 1) {
        // Gradient cyan to purple
        const ratio = (x + y) / (size * 2);
        rawData[pixelOffset] = Math.floor(56 + ratio * 80); // R
        rawData[pixelOffset + 1] = Math.floor(189 - ratio * 80); // G
        rawData[pixelOffset + 2] = 248; // B
        rawData[pixelOffset + 3] = 255; // Alpha
      } else {
        rawData[pixelOffset + 3] = 0; // Transparent
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

// CRC32 table
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate the 3 icons
createIconPNG(16, path.join(process.cwd(), 'extension', 'icons', 'icon16.png'));
createIconPNG(48, path.join(process.cwd(), 'extension', 'icons', 'icon48.png'));
createIconPNG(128, path.join(process.cwd(), 'extension', 'icons', 'icon128.png'));
console.log('Generated extension icons successfully.');
