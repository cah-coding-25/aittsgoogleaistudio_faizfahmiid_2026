import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { initStorageDirectories, APP_ROOT } from './backend/config/config.ts';

import jobsRouter from './backend/routes/jobs.ts';
import audioRouter from './backend/routes/audio.ts';
import queueRouter from './backend/routes/queue.ts';
import extensionRouter from './backend/routes/extension.ts';
import settingsRouter from './backend/routes/settings.ts';
import logsRouter from './backend/routes/logs.ts';

function parsePort(): number {
  const argv = process.argv;
  const portIdx = argv.indexOf('--port');
  if (portIdx !== -1 && argv[portIdx + 1]) {
    const val = parseInt(argv[portIdx + 1], 10);
    if (!isNaN(val)) return val;
  }
  const pIdx = argv.indexOf('-p');
  if (pIdx !== -1 && argv[pIdx + 1]) {
    const val = parseInt(argv[pIdx + 1], 10);
    if (!isNaN(val)) return val;
  }
  return Number(process.env.PORT) || 3000;
}

function parseHost(): string {
  const argv = process.argv;
  const hostIdx = argv.indexOf('--host');
  if (hostIdx !== -1 && argv[hostIdx + 1] && !argv[hostIdx + 1].startsWith('-')) {
    return argv[hostIdx + 1];
  }
  return process.env.HOST || '0.0.0.0';
}

async function startServer() {
  initStorageDirectories();

  const app = express();
  const PORT = parsePort();
  const HOST = parseHost();
  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.join(APP_ROOT, 'dist');
  const hasDist = fs.existsSync(distPath);

  // Enable CORS with support for local extension requests and origins
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Client-Id', 'x-client-id', 'client-id'],
  }));

  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  // Serve static extension folder for inspection / manual unpacked loading
  app.use('/extension-static', express.static(path.join(APP_ROOT, 'extension')));

  // Mount API routes
  app.use('/api/jobs', jobsRouter);
  app.use('/api/audio', audioRouter);
  app.use('/api/queue', queueRouter);
  app.use('/api/extension', extensionRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/logs', logsRouter);

  // Healthcheck endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'AI TTS Automation Studio V1.0',
      timestamp: Date.now(),
      port: PORT,
      host: HOST,
    });
  });

  // Attach Vite middleware in development or fallback when dist is not built
  if (!isProd || !hasDist) {
    if (fs.existsSync(path.join(APP_ROOT, 'vite.config.ts'))) {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[AI TTS AUTOMATION STUDIO V1.0] Server running on http://${HOST}:${PORT}`);
  });

  // Handle termination signals gracefully
  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal: Failed to start server:', err);
  process.exit(1);
});
