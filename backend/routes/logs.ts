import { Router, Response } from 'express';
import { storageService } from '../services/storage.ts';
import { queueManager } from '../services/queue.ts';
import { extractClientId } from './common.ts';

const router = Router();

interface SSEClientRecord {
  res: Response;
  clientId: string;
}

// Store active SSE clients with their clientId
const sseClients = new Set<SSEClientRecord>();

// Broadcast to SSE clients targeted by clientId
function broadcastEvent(type: string, data: any) {
  const targetClientId = data?.clientId;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of sseClients) {
    // If targetClientId is present and doesn't match client's workspace, skip
    if (targetClientId && targetClientId !== client.clientId) {
      continue;
    }
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Attach queueManager event listeners
queueManager.on('log', (data) => broadcastEvent('log', data));
queueManager.on('job_update', (data) => broadcastEvent('job_update', data.job || data));
queueManager.on('queue_state', (data) => broadcastEvent('queue_state', data));
queueManager.on('extension_status', (data) => broadcastEvent('extension_status', data.status || data));
queueManager.on('job_dispatch', (data) => broadcastEvent('job_dispatch', data));

// GET activity logs
router.get('/', (req, res) => {
  const clientId = extractClientId(req);
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
  res.json({ success: true, clientId, logs: storageService.getLogs(clientId, limit) });
});

// DELETE activity logs
router.delete('/', (req, res) => {
  const clientId = extractClientId(req);
  storageService.clearLogs(clientId);
  broadcastEvent('logs_cleared', { clientId });
  res.json({ success: true, clientId });
});

// GET Server-Sent Events stream
router.get('/stream', (req, res) => {
  const clientId = extractClientId(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();

  // Send initial connection sync for this specific client workspace
  res.write(
    `event: sync\ndata: ${JSON.stringify({
      clientId,
      queueState: queueManager.getQueueState(clientId),
      currentJob: queueManager.getCurrentJob(clientId),
      extensionStatus: queueManager.getExtensionStatus(clientId),
      jobs: storageService.getJobs(clientId),
      logs: storageService.getLogs(clientId, 50),
      timestamp: Date.now(),
    })}\n\n`
  );

  const clientRecord: SSEClientRecord = { res, clientId };
  sseClients.add(clientRecord);

  // Send heartbeat keepalive every 15 seconds
  const pingTimer = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(pingTimer);
      sseClients.delete(clientRecord);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingTimer);
    sseClients.delete(clientRecord);
  });
});

export default router;
