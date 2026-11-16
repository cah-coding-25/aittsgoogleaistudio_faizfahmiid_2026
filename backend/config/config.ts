import path from 'path';
import fs from 'fs';

export const APP_ROOT = process.cwd();

// Detect serverless environment (Vercel, AWS Lambda, Cloud Run, etc.)
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.VERCEL_ENV ||
  process.env.LAMBDA_TASK_ROOT
);

export const STORAGE_DIR = isServerless
  ? path.join('/tmp', 'ai-tts-storage')
  : path.join(APP_ROOT, 'storage');

export const WAV_DIR = path.join(STORAGE_DIR, 'wav');
export const MP3_DIR = path.join(STORAGE_DIR, 'mp3');
export const FAILED_DIR = path.join(STORAGE_DIR, 'failed');
export const METADATA_DIR = path.join(STORAGE_DIR, 'metadata');

export const JOBS_FILE = path.join(METADATA_DIR, 'jobs.json');
export const HISTORY_FILE = path.join(METADATA_DIR, 'history.json');
export const SETTINGS_FILE = path.join(METADATA_DIR, 'settings.json');
export const LOGS_FILE = path.join(METADATA_DIR, 'logs.json');

// Ensure root storage directories exist
export function initStorageDirectories() {
  const dirs = [STORAGE_DIR, WAV_DIR, MP3_DIR, FAILED_DIR, METADATA_DIR];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (err: any) {
      if (err?.code === 'EROFS' || err?.code === 'EACCES') {
        const fallbackStorage = path.join('/tmp', 'ai-tts-storage');
        try {
          if (!fs.existsSync(fallbackStorage)) {
            fs.mkdirSync(fallbackStorage, { recursive: true });
          }
        } catch {}
      }
    }
  }
}

// Sanitize client ID to prevent path traversal
export function sanitizeClientId(clientId?: string | null): string {
  if (!clientId || typeof clientId !== 'string') return 'default';
  const clean = clientId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
  return clean || 'default';
}

// Retrieve paths partitioned per PC/Workspace
export function getClientPaths(rawClientId?: string | null) {
  const safeId = sanitizeClientId(rawClientId);
  if (safeId === 'default') {
    return {
      clientId: 'default',
      baseDir: STORAGE_DIR,
      wavDir: WAV_DIR,
      mp3Dir: MP3_DIR,
      failedDir: FAILED_DIR,
      metadataDir: METADATA_DIR,
      jobsFile: JOBS_FILE,
      historyFile: HISTORY_FILE,
      settingsFile: SETTINGS_FILE,
      logsFile: LOGS_FILE,
    };
  }

  const baseDir = path.join(STORAGE_DIR, 'workspaces', safeId);
  const wavDir = path.join(baseDir, 'wav');
  const mp3Dir = path.join(baseDir, 'mp3');
  const failedDir = path.join(baseDir, 'failed');
  const metadataDir = path.join(baseDir, 'metadata');

  return {
    clientId: safeId,
    baseDir,
    wavDir,
    mp3Dir,
    failedDir,
    metadataDir,
    jobsFile: path.join(metadataDir, 'jobs.json'),
    historyFile: path.join(metadataDir, 'history.json'),
    settingsFile: path.join(metadataDir, 'settings.json'),
    logsFile: path.join(metadataDir, 'logs.json'),
  };
}

export function initClientDirectories(rawClientId?: string | null) {
  initStorageDirectories();
  const paths = getClientPaths(rawClientId);
  const dirs = [paths.baseDir, paths.wavDir, paths.mp3Dir, paths.failedDir, paths.metadataDir];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {}
  }
  return paths;
}

export interface AppSettings {
  aiStudioUrl: string;
  storagePath: string;
  outputFormat: 'mp3';
  mp3Bitrate: 128 | 192 | 256 | 320;
  maxRetries: number;
  retryDelays: number[];
  autoStart: boolean;
  autoRetry: boolean;
  autoSave: boolean;
  autoContinue: boolean;
  stopWhenFailed: boolean;
  skipFailedJobs: boolean;
  preserveWavFiles: boolean;
  mockMode: boolean;
  conversionMode: 'lamejs' | 'ffmpeg';
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiStudioUrl: 'https://aistudio.google.com/',
  storagePath: 'storage',
  outputFormat: 'mp3',
  mp3Bitrate: 192,
  maxRetries: 3,
  retryDelays: [5000, 15000, 30000],
  autoStart: false,
  autoRetry: true,
  autoSave: true,
  autoContinue: true,
  stopWhenFailed: false,
  skipFailedJobs: true,
  preserveWavFiles: true,
  mockMode: false,
  conversionMode: 'lamejs',
};
