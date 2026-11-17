import express from 'express';
import cors from 'cors';
import { initStorageDirectories } from '../backend/config/config.ts';

import jobsRouter from '../backend/routes/jobs.ts';
import audioRouter from '../backend/routes/audio.ts';
import queueRouter from '../backend/routes/queue.ts';
import extensionRouter from '../backend/routes/extension.ts';
import settingsRouter from '../backend/routes/settings.ts';
import logsRouter from '../backend/routes/logs.ts';

// Initialize storage directories (with safe /tmp fallback on Vercel)
initStorageDirectories();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Client-Id', 'x-client-id', 'client-id'],
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Mount API routes
app.use('/api/jobs', jobsRouter);
app.use('/api/audio', audioRouter);
app.use('/api/queue', queueRouter);
app.use('/api/extension', extensionRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AI TTS Automation Studio V1.0 (Cloud Serverless / Vercel Ready)',
    timestamp: Date.now(),
    environment: process.env.VERCEL ? 'vercel' : 'node',
  });
});

export default app;
