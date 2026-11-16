export type JobStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'PREPARING'
  | 'SENDING_TEXT'
  | 'GENERATING'
  | 'WAITING_AUDIO'
  | 'DOWNLOADING'
  | 'UPLOADING'
  | 'CONVERTING'
  | 'SAVING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'RETRYING'
  | 'FAILED'
  | 'PAUSED'
  | 'CANCELLED';

export interface TTSJob {
  id: string;
  order: number;
  filename: string;
  text: string;
  status: JobStatus;
  retryCount: number;
  maxRetries: number;
  duration?: number;
  wavSize?: number;
  mp3Size?: number;
  wavPath?: string;
  mp3Path?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  log?: string[];
  clientId?: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  jobId?: string;
  clientId?: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
  details?: string;
}

export interface AudioItem {
  filename: string;
  baseName: string;
  hasWav: boolean;
  hasMp3: boolean;
  wavSize: number;
  mp3Size: number;
  duration: number;
  createdAt: number;
  wavPath: string;
  mp3Path: string;
  clientId?: string;
}

export type QueueState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface ExtensionStatus {
  connected: boolean;
  aiStudioConnected: boolean;
  lastPing: number;
  tabId?: number;
  activeUrl?: string;
  version: string;
  clientId?: string;
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

export interface QueueStatusResponse {
  state: QueueState;
  currentJob: TTSJob | null;
  extensionStatus: ExtensionStatus;
  clientId?: string;
  stats: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}
