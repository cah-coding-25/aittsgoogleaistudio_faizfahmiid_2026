import { Router } from 'express';
import { storageService } from '../services/storage.ts';
import { queueManager } from '../services/queue.ts';
import { extractClientId } from './common.ts';

const router = Router();

// GET settings
router.get('/', (req, res) => {
  const clientId = extractClientId(req);
  res.json({ success: true, clientId, settings: storageService.getSettings(clientId) });
});

// POST update settings
router.post('/', (req, res) => {
  const clientId = extractClientId(req);
  const updates = req.body;
  const updated = storageService.saveSettings(clientId, updates);
  queueManager.log(clientId, 'INFO', 'Pengaturan aplikasi diperbarui untuk workspace ini.');
  res.json({ success: true, clientId, settings: updated });
});

export default router;
