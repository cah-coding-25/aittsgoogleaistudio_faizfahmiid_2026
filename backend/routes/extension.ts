import { Router } from 'express';
import { queueManager } from '../services/queue.ts';
import { storageService } from '../services/storage.ts';
import { buildExtensionZip } from '../services/extensionPacker.ts';
import { extractClientId } from './common.ts';

const router = Router();

// Handshake
router.post('/handshake', (req, res) => {
  const clientId = extractClientId(req);
  const { client, version } = req.body;
  const token = queueManager.getSessionToken(clientId);

  queueManager.updateExtensionHeartbeat(clientId, {
    connected: true,
    version: version || '1.1.0',
  });

  queueManager.log(clientId, 'SUCCESS', `Handshake berhasil dengan ekstensi Chrome (${client || 'AI TTS Extension'} v${version || '1.1'}) di workspace ${clientId}.`);

  res.json({
    success: true,
    clientId,
    token,
    backendStatus: 'ONLINE',
    queueState: queueManager.getQueueState(clientId),
  });
});

// Heartbeat
router.post('/heartbeat', (req, res) => {
  const clientId = extractClientId(req);
  const { aiStudioConnected, tabId, activeUrl, version } = req.body;

  queueManager.updateExtensionHeartbeat(clientId, {
    aiStudioConnected: !!aiStudioConnected,
    tabId,
    activeUrl,
    version: version || '1.1.0',
  });

  res.json({
    success: true,
    clientId,
    queueState: queueManager.getQueueState(clientId),
    currentJobId: queueManager.getCurrentJob(clientId)?.id || null,
  });
});

// Get extension status
router.get('/status', (req, res) => {
  const clientId = extractClientId(req);
  res.json({
    success: true,
    clientId,
    status: queueManager.getExtensionStatus(clientId),
    sessionToken: queueManager.getSessionToken(clientId),
  });
});

// Extension fetches next job to process
router.get('/next-job', (req, res) => {
  const clientId = extractClientId(req);
  let current = queueManager.getJobForExtension(clientId);
  let resolvedClientId = clientId;

  if (!current) {
    const fallback = queueManager.getAnyRunningJob();
    if (fallback) {
      current = fallback.job;
      resolvedClientId = fallback.clientId;
    }
  }

  if (!current) {
    return res.json({ success: true, clientId, hasJob: false });
  }

  const settings = storageService.getSettings(resolvedClientId);
  res.json({
    success: true,
    clientId: resolvedClientId,
    hasJob: true,
    job: {
      id: current.id,
      order: current.order,
      filename: current.filename,
      text: current.text,
      aiStudioUrl: settings.aiStudioUrl,
      clientId: resolvedClientId,
    },
  });
});

// Report milestone
router.post('/report', async (req, res) => {
  const clientId = extractClientId(req);
  const { jobId, step, payload } = req.body;

  if (!jobId || !step) {
    return res.status(400).json({ success: false, error: 'jobId dan step diperlukan.' });
  }

  await queueManager.handleExtensionReport(clientId, jobId, step, payload);
  res.json({ success: true, clientId });
});

// Download Chrome Extension as ZIP
router.get('/download-zip', async (req, res) => {
  try {
    const clientId = extractClientId(req);
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
    const detectedUrl = (req.query.backendUrl as string) || req.headers.origin || `${proto}://${host}`;
    const cleanBackendUrl = detectedUrl.replace(/\/$/, '');

    const zipBuffer = await buildExtensionZip(cleanBackendUrl, clientId);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="AI_TTS_Chrome_Extension_${clientId}.zip"`,
      'Content-Length': zipBuffer.length,
    });
    res.send(zipBuffer);
  } catch (err: any) {
    res.status(500).send(`Gagal menyiapkan paket ekstensi: ${err?.message || 'Error internal'}`);
  }
});

export default router;
