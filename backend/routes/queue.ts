import { Router } from 'express';
import { queueManager } from '../services/queue.ts';
import { storageService } from '../services/storage.ts';
import { extractClientId } from './common.ts';

const router = Router();

// GET queue status
router.get('/status', (req, res) => {
  const clientId = extractClientId(req);
  const state = queueManager.getQueueState(clientId);
  const currentJob = queueManager.getCurrentJob(clientId);
  const extStatus = queueManager.getExtensionStatus(clientId);
  const jobs = storageService.getJobs(clientId);

  const total = jobs.length;
  const pending = jobs.filter((j) => j.status === 'PENDING' || j.status === 'DRAFT').length;
  const processing = jobs.filter((j) =>
    ['PREPARING', 'SENDING_TEXT', 'GENERATING', 'WAITING_AUDIO', 'DOWNLOADING', 'UPLOADING', 'CONVERTING', 'SAVING', 'VERIFYING', 'RETRYING'].includes(j.status)
  ).length;
  const completed = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;

  res.json({
    success: true,
    clientId,
    state,
    currentJob,
    extensionStatus: extStatus,
    stats: {
      total,
      pending,
      processing,
      completed,
      failed,
    },
  });
});

// POST start queue
router.post('/start', async (req, res) => {
  const clientId = extractClientId(req);
  const result = await queueManager.startQueue(clientId);
  res.json(result);
});

// POST pause queue
router.post('/pause', (req, res) => {
  const clientId = extractClientId(req);
  const result = queueManager.pauseQueue(clientId);
  res.json(result);
});

// POST resume queue
router.post('/resume', (req, res) => {
  const clientId = extractClientId(req);
  const result = queueManager.resumeQueue(clientId);
  res.json(result);
});

// POST stop queue
router.post('/stop', (req, res) => {
  const clientId = extractClientId(req);
  const result = queueManager.stopQueue(clientId);
  res.json(result);
});

export default router;
