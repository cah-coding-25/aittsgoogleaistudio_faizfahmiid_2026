import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { getClientPaths } from '../config/config.ts';
import { storageService } from '../services/storage.ts';
import { queueManager } from '../services/queue.ts';
import { sanitizeFilename, validateWavBuffer } from '../services/validator.ts';
import { extractClientId } from './common.ts';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'audio/wav' ||
      file.mimetype === 'audio/x-wav' ||
      file.mimetype === 'audio/wave' ||
      file.originalname.toLowerCase().endsWith('.wav') ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file audio WAV yang diperbolehkan.'));
    }
  },
});

// GET audio library items
router.get('/library', (req, res) => {
  const clientId = extractClientId(req);
  const library = storageService.getAudioLibrary(clientId);
  res.json({ success: true, clientId, items: library });
});

// POST upload WAV for a job (multipart form-data)
router.post('/upload/:jobId', upload.single('audio'), async (req, res) => {
  const clientId = extractClientId(req);
  const { jobId } = req.params;
  const file = req.file;

  if (!file || !file.buffer) {
    return res.status(400).json({ success: false, error: 'Tidak ada file WAV yang diunggah.' });
  }

  let job = storageService.getJob(clientId, jobId) || storageService.findJobByFilename(clientId, file.originalname);
  if (!job) {
    const defaultName = file.originalname ? file.originalname.replace(/\.wav$/i, '') : 'audio_track';
    job = storageService.getOrCreateJob(clientId, jobId, defaultName);
  }

  const wavCheck = validateWavBuffer(file.buffer);
  if (!wavCheck.valid) {
    queueManager.log(clientId, 'ERROR', `File WAV yang diterima untuk ${job.filename} tidak valid: ${wavCheck.error}`, jobId);
    return res.status(400).json({ success: false, error: wavCheck.error });
  }

  queueManager.log(clientId, 'INFO', `File WAV valid diterima (${(file.buffer.length / 1024).toFixed(1)} KB, ~${wavCheck.duration}s).`, jobId);

  const result = await queueManager.handleWavReceived(clientId, job.id, file.buffer, file.originalname, job);
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }

  res.json({ success: true, message: 'Audio WAV berhasil diproses dan dikonversi ke MP3.' });
});

// POST upload WAV via JSON Base64 (Rock-solid fallback, immune to multipart/CORS boundary issues)
router.post('/upload-base64/:jobId', async (req, res) => {
  const clientId = extractClientId(req);
  const { jobId } = req.params;
  const { filename, base64Audio } = req.body;

  if (!base64Audio) {
    return res.status(400).json({ success: false, error: 'Tidak ada data audio base64 yang dikirim.' });
  }

  try {
    const buffer = Buffer.from(base64Audio, 'base64');
    const safeName = filename || `audio_${Date.now()}`;
    const cleanName = safeName.replace(/\.(wav|mp3)$/i, '');

    let job = storageService.getJob(clientId, jobId) || storageService.findJobByFilename(clientId, cleanName);
    if (!job) {
      job = storageService.getOrCreateJob(clientId, jobId, cleanName);
    }

    const wavCheck = validateWavBuffer(buffer);
    if (!wavCheck.valid) {
      queueManager.log(clientId, 'ERROR', `Buffer audio untuk ${job.filename} tidak valid: ${wavCheck.error}`, jobId);
      return res.status(400).json({ success: false, error: wavCheck.error });
    }

    queueManager.log(clientId, 'INFO', `Audio base64 valid diterima (${(buffer.length / 1024).toFixed(1)} KB, ~${wavCheck.duration}s).`, jobId);

    const result = await queueManager.handleWavReceived(clientId, job.id, buffer, `${cleanName}.wav`, job);
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, message: 'Audio WAV berhasil diproses dan dikonversi ke MP3 via JSON payload.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Error server saat memproses base64' });
  }
});

// POST standalone WAV to MP3 conversion tool
router.post('/convert', upload.single('audio'), async (req, res) => {
  const clientId = extractClientId(req);
  const file = req.file;
  const bitrate = parseInt(req.body.bitrate, 10) || 192;

  if (!file || !file.buffer) {
    return res.status(400).json({ success: false, error: 'Tidak ada file WAV yang diunggah untuk dikonversi.' });
  }

  const wavCheck = validateWavBuffer(file.buffer);
  if (!wavCheck.valid) {
    return res.status(400).json({ success: false, error: `File bukan WAV PCM yang valid: ${wavCheck.error}` });
  }

  try {
    const rawName = req.body.filename || file.originalname || `audio_${Date.now()}`;
    const baseName = sanitizeFilename(rawName);
    const paths = getClientPaths(clientId);

    const wavFileName = `${baseName}.wav`;
    const mp3FileName = `${baseName}.mp3`;
    const wavPath = path.join(paths.wavDir, wavFileName);
    const mp3Path = path.join(paths.mp3Dir, mp3FileName);

    // Save WAV
    fs.writeFileSync(wavPath, file.buffer);
    storageService.setAudioBuffer(clientId, baseName, 'wav', file.buffer, wavCheck.duration);

    // Convert to real MP3 using LAME encoder
    const { convertWavFileToMp3 } = await import('../services/converter.ts');
    const convResult = await convertWavFileToMp3(wavPath, mp3Path, bitrate);
    if (!convResult.success || !convResult.mp3Path) {
      return res.status(500).json({ success: false, error: convResult.error || 'Gagal mengonversi WAV ke MP3' });
    }

    const mp3Buffer = fs.readFileSync(mp3Path);
    storageService.setAudioBuffer(clientId, baseName, 'mp3', mp3Buffer, convResult.duration);

    queueManager.log(clientId, 'SUCCESS', `[Konverter] Berkas ${wavFileName} (${(file.buffer.length / 1024).toFixed(1)} KB) berhasil dikonversi ke MP3 (${(mp3Buffer.length / 1024).toFixed(1)} KB, ${bitrate} kbps).`);

    res.json({
      success: true,
      message: 'Konversi WAV ke MP3 berhasil diselesaikan.',
      baseName,
      wavFilename: wavFileName,
      mp3Filename: mp3FileName,
      wavSize: file.buffer.length,
      mp3Size: mp3Buffer.length,
      duration: convResult.duration,
      wavBase64: file.buffer.toString('base64'),
      mp3Base64: mp3Buffer.toString('base64'),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Error konversi internal' });
  }
});

// GET payload with base64 audio data for client IndexedDB syncing
router.get('/payload/:baseName', (req, res) => {
  const clientId = extractClientId(req);
  const { baseName } = req.params;
  const safeBase = sanitizeFilename(baseName);
  const payload = storageService.getAudioPayload(clientId, safeBase);
  if (!payload) {
    return res.status(404).json({ success: false, error: 'Audio payload tidak ditemukan.' });
  }
  res.json({ success: true, baseName: safeBase, ...payload });
});

// GET stream audio (mp3 or wav)
router.get('/stream/:format/:baseName', (req, res) => {
  const clientId = extractClientId(req);
  const { format, baseName } = req.params;
  const safeBase = sanitizeFilename(baseName);

  if (format !== 'wav' && format !== 'mp3') {
    return res.status(400).send('Format tidak didukung.');
  }

  let filePath = storageService.getAudioFilePath(clientId, format, safeBase);
  if (!fs.existsSync(filePath)) {
    const fallback = storageService.findAudioFileAcrossAllWorkspaces(format, safeBase);
    if (fallback) {
      filePath = fallback;
    }
  }

  const contentType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';

  if (!fs.existsSync(filePath)) {
    // Check in-memory buffer cache for serverless environments (Vercel)
    const cachedBuf = storageService.getAudioBuffer(clientId, safeBase, format);
    if (cachedBuf && cachedBuf.length > 0) {
      res.writeHead(200, {
        'Content-Length': cachedBuf.length,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      return res.end(cachedBuf);
    }
    return res.status(404).send('File audio tidak ditemukan.');
  }

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET download audio (mp3 or wav with guaranteed exact filename and audio MIME type)
router.get('/download/:format/:baseName', (req, res) => {
  const clientId = extractClientId(req);
  const { format, baseName } = req.params;
  const safeBase = sanitizeFilename(baseName);

  if (format !== 'wav' && format !== 'mp3') {
    return res.status(400).send('Format tidak didukung.');
  }

  const ext = format === 'mp3' ? '.mp3' : '.wav';
  const downloadFilename = safeBase.toLowerCase().endsWith(ext) ? safeBase : `${safeBase}${ext}`;
  const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

  let filePath = storageService.getAudioFilePath(clientId, format, safeBase);
  if (!fs.existsSync(filePath)) {
    const fallback = storageService.findAudioFileAcrossAllWorkspaces(format, safeBase);
    if (fallback) {
      filePath = fallback;
    }
  }

  if (!fs.existsSync(filePath)) {
    // Check in-memory buffer cache for serverless environments (Vercel)
    const cachedBuf = storageService.getAudioBuffer(clientId, safeBase, format);
    if (cachedBuf && cachedBuf.length > 0) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
      res.setHeader('Content-Length', cachedBuf.length);
      return res.end(cachedBuf);
    }
    return res.status(404).json({ success: false, error: 'File audio tidak ditemukan di penyimpanan server.' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
  res.download(filePath, downloadFilename);
});

// DELETE all audio files
router.delete('/all', (req, res) => {
  const clientId = extractClientId(req);
  const count = storageService.clearAllAudio(clientId);
  queueManager.log(clientId, 'INFO', `Semua file audio (${count} berkas) di workspace ini berhasil dihapus.`);
  res.json({ success: true, count });
});

// DELETE audio
router.delete('/:baseName', (req, res) => {
  const clientId = extractClientId(req);
  const { baseName } = req.params;
  const safeBase = sanitizeFilename(baseName);
  const deleted = storageService.deleteAudio(clientId, safeBase);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'File tidak ditemukan untuk dihapus.' });
  }
  queueManager.log(clientId, 'INFO', `File audio "${safeBase}" dihapus dari penyimpanan.`);
  res.json({ success: true });
});

// POST rename audio
router.post('/rename', (req, res) => {
  const clientId = extractClientId(req);
  const { oldBase, newBase } = req.body;
  if (!oldBase || !newBase) {
    return res.status(400).json({ success: false, error: 'Parameter oldBase dan newBase wajib diisi.' });
  }

  const safeOld = sanitizeFilename(oldBase);
  const safeNew = sanitizeFilename(newBase);

  const renamed = storageService.renameAudio(clientId, safeOld, safeNew);
  if (!renamed) {
    return res.status(404).json({ success: false, error: 'File audio tidak dapat diubah namanya.' });
  }
  queueManager.log(clientId, 'INFO', `Nama file audio diubah dari "${safeOld}" menjadi "${safeNew}".`);
  res.json({ success: true, newBase: safeNew });
});

// GET download all MP3 as ZIP
router.get('/download-all-zip', async (req, res) => {
  try {
    const clientId = extractClientId(req);
    const paths = getClientPaths(clientId);
    const mp3Files = fs.existsSync(paths.mp3Dir) ? fs.readdirSync(paths.mp3Dir).filter((f) => f.endsWith('.mp3')) : [];

    if (mp3Files.length === 0) {
      return res.status(400).send('Belum ada file MP3 yang tersedia untuk diunduh di workspace ini.');
    }

    const zip = new JSZip();
    for (const file of mp3Files) {
      const fullPath = path.join(paths.mp3Dir, file);
      const content = fs.readFileSync(fullPath);
      zip.file(file, content);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="AI_TTS_Audio_MP3_${clientId}_${timestamp}.zip"`,
      'Content-Length': zipBuffer.length,
    });
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).send(`Gagal membuat berkas ZIP: ${err?.message || 'Error internal'}`);
  }
});

// GET download all WAV as ZIP
router.get('/download-all-wav-zip', async (req, res) => {
  try {
    const clientId = extractClientId(req);
    const paths = getClientPaths(clientId);
    const wavFiles = fs.existsSync(paths.wavDir) ? fs.readdirSync(paths.wavDir).filter((f) => f.endsWith('.wav')) : [];

    if (wavFiles.length === 0) {
      return res.status(400).send('Belum ada file WAV yang tersedia untuk diunduh di workspace ini.');
    }

    const zip = new JSZip();
    for (const file of wavFiles) {
      const fullPath = path.join(paths.wavDir, file);
      const content = fs.readFileSync(fullPath);
      zip.file(file, content);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const timestamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="AI_TTS_Audio_WAV_${clientId}_${timestamp}.zip"`,
      'Content-Length': zipBuffer.length,
    });
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).send(`Gagal membuat berkas ZIP WAV: ${err?.message || 'Error internal'}`);
  }
});

export default router;
