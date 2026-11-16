import { Router } from 'express';
import { storageService, TTSJob } from '../services/storage.ts';
import { sanitizeFilename, isValidFilename } from '../services/validator.ts';
import { queueManager } from '../services/queue.ts';
import { extractClientId } from './common.ts';

const router = Router();

// GET all jobs
router.get('/', (req, res) => {
  const clientId = extractClientId(req);
  const jobs = storageService.getJobs(clientId);
  res.json({ success: true, jobs });
});

// GET job history
router.get('/history', (req, res) => {
  const clientId = extractClientId(req);
  const history = storageService.getHistory(clientId);
  res.json({ success: true, history });
});

// POST create jobs (single or bulk)
router.post('/', (req, res) => {
  const clientId = extractClientId(req);
  const body = req.body;
  const items: Array<{ filename: string; text: string; order?: number }> = Array.isArray(body)
    ? body
    : body.items
    ? body.items
    : [body];

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Tidak ada data teks yang dikirim.' });
  }

  const existingJobs = storageService.getJobs(clientId);
  const existingNames = new Set(existingJobs.map((j) => j.filename.toLowerCase()));
  let currentMaxOrder = existingJobs.reduce((max, j) => Math.max(max, j.order), 0);

  const newJobs: TTSJob[] = [];
  const errors: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.text || item.text.trim().length === 0) {
      errors.push(`Item ke-${i + 1}: Teks kosong.`);
      continue;
    }

    let rawFilename = item.filename ? item.filename.trim() : `audio_${currentMaxOrder + i + 1}`;
    let base = sanitizeFilename(rawFilename);

    if (existingNames.has(base.toLowerCase())) {
      let counter = 1;
      while (existingNames.has(`${base}_${counter}`.toLowerCase())) {
        counter++;
      }
      base = `${base}_${counter}`;
    }
    existingNames.add(base.toLowerCase());

    currentMaxOrder++;
    const job: TTSJob = {
      id: 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      order: item.order || currentMaxOrder,
      filename: base,
      text: item.text.trim(),
      status: 'PENDING',
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clientId,
    };

    newJobs.push(job);
  }

  if (newJobs.length === 0) {
    return res.status(400).json({ success: false, error: 'Gagal menambahkan pekerjaan.', details: errors });
  }

  storageService.addJobs(clientId, newJobs);
  queueManager.log(clientId, 'INFO', `Menambahkan ${newJobs.length} pekerjaan teks baru ke antrean.`);

  res.json({
    success: true,
    addedCount: newJobs.length,
    jobs: newJobs,
    warnings: errors.length > 0 ? errors : undefined,
  });
});

// PUT update job
router.put('/:id', (req, res) => {
  const clientId = extractClientId(req);
  const { id } = req.params;
  const { filename, text, order } = req.body;

  const job = storageService.getJob(clientId, id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Pekerjaan tidak ditemukan.' });
  }

  if (job.status === 'GENERATING' || job.status === 'CONVERTING') {
    return res.status(400).json({ success: false, error: 'Tidak dapat mengubah pekerjaan yang sedang diproses.' });
  }

  const updates: Partial<TTSJob> = {};
  if (filename) {
    const clean = sanitizeFilename(filename);
    const valid = isValidFilename(clean);
    if (!valid.valid) {
      return res.status(400).json({ success: false, error: valid.error });
    }
    updates.filename = clean;
  }
  if (text !== undefined) {
    if (!text.trim()) {
      return res.status(400).json({ success: false, error: 'Teks tidak boleh kosong.' });
    }
    updates.text = text.trim();
  }
  if (typeof order === 'number') {
    updates.order = order;
  }

  const updated = storageService.updateJob(clientId, id, updates);
  res.json({ success: true, job: updated });
});

// DELETE job
router.delete('/:id', (req, res) => {
  const clientId = extractClientId(req);
  const { id } = req.params;
  const job = storageService.getJob(clientId, id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Pekerjaan tidak ditemukan.' });
  }
  if (job.status === 'GENERATING' || job.status === 'CONVERTING') {
    return res.status(400).json({ success: false, error: 'Pekerjaan sedang aktif diproses.' });
  }
  const deleted = storageService.deleteJob(clientId, id);
  queueManager.log(clientId, 'INFO', `Pekerjaan ${job.order} (${job.filename}) dihapus.`);
  res.json({ success: deleted });
});

// POST reorder
router.post('/reorder', (req, res) => {
  const clientId = extractClientId(req);
  const { jobIds } = req.body;
  if (!Array.isArray(jobIds)) {
    return res.status(400).json({ success: false, error: 'jobIds harus berupa array string.' });
  }

  const allJobs = storageService.getJobs(clientId);
  const idMap = new Map(allJobs.map((j) => [j.id, j]));

  const reordered: TTSJob[] = [];
  let order = 1;
  for (const id of jobIds) {
    const j = idMap.get(id);
    if (j) {
      j.order = order++;
      reordered.push(j);
      idMap.delete(id);
    }
  }

  for (const remaining of idMap.values()) {
    remaining.order = order++;
    reordered.push(remaining);
  }

  storageService.saveJobs(clientId, reordered);
  res.json({ success: true, jobs: reordered });
});

// POST clear completed
router.post('/clear-completed', (req, res) => {
  const clientId = extractClientId(req);
  storageService.clearCompleted(clientId);
  queueManager.log(clientId, 'INFO', 'Membersihkan pekerjaan yang sudah berstatus COMPLETED.');
  res.json({ success: true, jobs: storageService.getJobs(clientId) });
});

// POST clear all jobs and history
router.post('/clear-all', (req, res) => {
  const clientId = extractClientId(req);
  storageService.clearAllJobs(clientId);
  queueManager.log(clientId, 'INFO', 'Semua riwayat dan antrean teks berhasil dihapus/dikosongkan.');
  res.json({ success: true, jobs: storageService.getJobs(clientId) });
});

// POST retry single job
router.post('/:id/retry', (req, res) => {
  const clientId = extractClientId(req);
  const { id } = req.params;
  const success = queueManager.retrySingleJob(clientId, id);
  if (!success) {
    return res.status(404).json({ success: false, error: 'Pekerjaan tidak ditemukan.' });
  }
  res.json({ success: true });
});

// POST retry all failed
router.post('/retry-all-failed', (req, res) => {
  const clientId = extractClientId(req);
  const jobs = storageService.getJobs(clientId);
  const failedJobs = jobs.filter((j) => j.status === 'FAILED');

  for (const job of failedJobs) {
    storageService.updateJob(clientId, job.id, {
      status: 'PENDING',
      retryCount: 0,
      error: undefined,
    });
  }

  queueManager.log(clientId, 'INFO', `Mengatur ulang ${failedJobs.length} pekerjaan FAILED ke antrean PENDING.`);
  if (failedJobs.length > 0 && queueManager.getQueueState(clientId) === 'IDLE') {
    queueManager.startQueue(clientId);
  }

  res.json({ success: true, count: failedJobs.length });
});

export default router;
