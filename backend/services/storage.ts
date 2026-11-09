import fs from 'fs';
import path from 'path';
import {
  initClientDirectories,
  getClientPaths,
  sanitizeClientId,
  STORAGE_DIR,
  WAV_DIR,
  MP3_DIR,
  AppSettings,
  DEFAULT_SETTINGS
} from '../config/config.ts';

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

interface WorkspaceMemory {
  clientId: string;
  jobs: TTSJob[];
  history: TTSJob[];
  settings: AppSettings;
  logs: ActivityLog[];
}

class StorageService {
  private workspaces = new Map<string, WorkspaceMemory>();

  constructor() {
    this.getWorkspace('default');
  }

  private getWorkspace(rawClientId?: string): WorkspaceMemory {
    const safeId = sanitizeClientId(rawClientId);
    let ws = this.workspaces.get(safeId);
    if (!ws) {
      ws = this.loadWorkspaceFromDisk(safeId);
      this.workspaces.set(safeId, ws);
    }
    return ws;
  }

  private loadWorkspaceFromDisk(safeId: string): WorkspaceMemory {
    const paths = initClientDirectories(safeId);

    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    try {
      if (fs.existsSync(paths.settingsFile)) {
        const raw = fs.readFileSync(paths.settingsFile, 'utf-8');
        settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } else {
        fs.writeFileSync(paths.settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      }
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }

    let jobs: TTSJob[] = [];
    try {
      if (fs.existsSync(paths.jobsFile)) {
        const raw = fs.readFileSync(paths.jobsFile, 'utf-8');
        jobs = JSON.parse(raw);
        const now = Date.now();
        for (const job of jobs) {
          if (
            [
              'PREPARING',
              'SENDING_TEXT',
              'GENERATING',
              'WAITING_AUDIO',
              'DOWNLOADING',
              'UPLOADING',
              'CONVERTING',
              'SAVING',
              'VERIFYING',
              'RETRYING'
            ].includes(job.status) &&
            now - (job.updatedAt || 0) > 300000
          ) {
            job.status = 'PENDING';
            job.updatedAt = now;
          }
        }
      }
    } catch {
      jobs = [];
    }

    let history: TTSJob[] = [];
    try {
      if (fs.existsSync(paths.historyFile)) {
        const raw = fs.readFileSync(paths.historyFile, 'utf-8');
        history = JSON.parse(raw);
      }
    } catch {
      history = [];
    }

    let logs: ActivityLog[] = [];
    try {
      if (fs.existsSync(paths.logsFile)) {
        const raw = fs.readFileSync(paths.logsFile, 'utf-8');
        logs = JSON.parse(raw);
      }
    } catch {
      logs = [];
    }

    return {
      clientId: safeId,
      jobs,
      history,
      settings,
      logs,
    };
  }

  // --- JOBS ---
  public getJobs(clientId?: string): TTSJob[] {
    const ws = this.getWorkspace(clientId);
    return [...ws.jobs].sort((a, b) => a.order - b.order);
  }

  public getJob(clientId: string | undefined, id: string): TTSJob | undefined {
    const ws = this.getWorkspace(clientId);
    const found = ws.jobs.find((j) => j.id === id);
    if (found) return found;

    // Search across all loaded workspaces
    for (const [_, otherWs] of this.workspaces.entries()) {
      const match = otherWs.jobs.find((j) => j.id === id);
      if (match) return match;
    }

    // Check default workspace
    if (clientId !== 'default') {
      const defWs = this.getWorkspace('default');
      const match = defWs.jobs.find((j) => j.id === id);
      if (match) return match;
    }

    return undefined;
  }

  public findJobByFilename(clientId: string | undefined, baseName: string): TTSJob | undefined {
    const clean = baseName.toLowerCase().replace(/\.(wav|mp3)$/i, '');
    const ws = this.getWorkspace(clientId);
    const found = ws.jobs.find((j) => j.filename.toLowerCase() === clean);
    if (found) return found;

    for (const [_, otherWs] of this.workspaces.entries()) {
      const match = otherWs.jobs.find((j) => j.filename.toLowerCase() === clean);
      if (match) return match;
    }
    return undefined;
  }

  public getOrCreateJob(clientId: string | undefined, id: string, defaultFilename: string): TTSJob {
    let job = this.getJob(clientId, id) || this.findJobByFilename(clientId, defaultFilename);
    if (!job) {
      const cleanName = defaultFilename.replace(/\.(wav|mp3)$/i, '');
      const ws = this.getWorkspace(clientId);
      job = {
        id: id || `job_${Date.now()}`,
        order: ws.jobs.length + 1,
        filename: cleanName,
        text: cleanName,
        status: 'CONVERTING',
        retryCount: 0,
        maxRetries: 3,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        clientId: ws.clientId,
      };
      ws.jobs.push(job);
      this.saveJobs(clientId, ws.jobs);
    }
    return job;
  }

  public saveJobs(clientId: string | undefined, jobs: TTSJob[]) {
    const ws = this.getWorkspace(clientId);
    ws.jobs = jobs;
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.jobsFile, JSON.stringify(ws.jobs, null, 2), 'utf-8');
    } catch (e) {
      console.error(`Failed to write jobs.json for client ${clientId}`, e);
    }
  }

  public updateJob(clientId: string | undefined, id: string, updates: Partial<TTSJob>): TTSJob | null {
    let ws = this.getWorkspace(clientId);
    let idx = ws.jobs.findIndex((j) => j.id === id);

    if (idx === -1) {
      // Find workspace that owns this job
      for (const [wId, otherWs] of this.workspaces.entries()) {
        const otherIdx = otherWs.jobs.findIndex((j) => j.id === id);
        if (otherIdx !== -1) {
          ws = otherWs;
          idx = otherIdx;
          break;
        }
      }
    }

    if (idx === -1) return null;
    const current = ws.jobs[idx];
    const updated = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    ws.jobs[idx] = updated;
    this.saveJobs(ws.clientId, ws.jobs);

    if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
      this.addToHistory(ws.clientId, updated);
    }
    return updated;
  }

  public addJobs(clientId: string | undefined, newJobs: TTSJob[]) {
    const ws = this.getWorkspace(clientId);
    const stamped = newJobs.map((j) => ({ ...j, clientId: ws.clientId }));
    ws.jobs.push(...stamped);
    this.saveJobs(clientId, ws.jobs);
  }

  public deleteJob(clientId: string | undefined, id: string): boolean {
    const ws = this.getWorkspace(clientId);
    const prevLen = ws.jobs.length;
    ws.jobs = ws.jobs.filter((j) => j.id !== id);
    if (ws.jobs.length !== prevLen) {
      ws.jobs.forEach((j, i) => (j.order = i + 1));
      this.saveJobs(clientId, ws.jobs);
      return true;
    }
    return false;
  }

  public clearCompleted(clientId?: string) {
    const ws = this.getWorkspace(clientId);
    ws.jobs = ws.jobs.filter((j) => j.status !== 'COMPLETED');
    ws.jobs.forEach((j, i) => (j.order = i + 1));
    this.saveJobs(clientId, ws.jobs);
  }

  public clearAllJobs(clientId?: string, force = true): void {
    const ws = this.getWorkspace(clientId);
    if (force) {
      ws.jobs = [];
    } else {
      ws.jobs = ws.jobs.filter((j) =>
        ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING', 'CONVERTING'].includes(j.status)
      );
    }
    ws.jobs.forEach((j, i) => (j.order = i + 1));
    this.saveJobs(clientId, ws.jobs);
    ws.history = [];
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.historyFile, JSON.stringify([], null, 2), 'utf-8');
    } catch {}
  }

  // --- HISTORY ---
  public getHistory(clientId?: string): TTSJob[] {
    const ws = this.getWorkspace(clientId);
    return [...ws.history];
  }

  public addToHistory(clientId: string | undefined, job: TTSJob) {
    const ws = this.getWorkspace(clientId);
    const idx = ws.history.findIndex((h) => h.id === job.id);
    if (idx >= 0) {
      ws.history[idx] = { ...job };
    } else {
      ws.history.unshift({ ...job });
    }
    if (ws.history.length > 500) {
      ws.history = ws.history.slice(0, 500);
    }
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.historyFile, JSON.stringify(ws.history, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write history.json', e);
    }
  }

  // --- SETTINGS ---
  public getSettings(clientId?: string): AppSettings {
    const ws = this.getWorkspace(clientId);
    return { ...ws.settings };
  }

  public saveSettings(clientId: string | undefined, newSettings: Partial<AppSettings>): AppSettings {
    const ws = this.getWorkspace(clientId);
    ws.settings = { ...ws.settings, ...newSettings };
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.settingsFile, JSON.stringify(ws.settings, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write settings.json', e);
    }
    return ws.settings;
  }

  // --- LOGS ---
  public getLogs(clientId?: string, limit = 200): ActivityLog[] {
    const ws = this.getWorkspace(clientId);
    return ws.logs.slice(-limit);
  }

  public addLog(clientId: string | undefined, entry: Omit<ActivityLog, 'id' | 'timestamp'>) {
    const ws = this.getWorkspace(clientId);
    const logItem: ActivityLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      timestamp:
        new Date().toLocaleTimeString('id-ID', { hour12: false }) +
        '.' +
        String(new Date().getMilliseconds()).padStart(3, '0'),
      clientId: ws.clientId,
      ...entry,
    };
    ws.logs.push(logItem);
    if (ws.logs.length > 1000) {
      ws.logs = ws.logs.slice(-1000);
    }
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.logsFile, JSON.stringify(ws.logs, null, 2), 'utf-8');
    } catch {}
    return logItem;
  }

  public clearLogs(clientId?: string) {
    const ws = this.getWorkspace(clientId);
    ws.logs = [];
    const paths = getClientPaths(clientId);
    try {
      fs.writeFileSync(paths.logsFile, JSON.stringify([], null, 2), 'utf-8');
    } catch {}
  }

  // --- AUDIO FILES ---
  public getAudioLibrary(clientId?: string): AudioItem[] {
    const paths = initClientDirectories(clientId);
    const ws = this.getWorkspace(clientId);

    const mp3Files = fs.existsSync(paths.mp3Dir) ? fs.readdirSync(paths.mp3Dir).filter((f) => f.endsWith('.mp3')) : [];
    const wavFiles = fs.existsSync(paths.wavDir) ? fs.readdirSync(paths.wavDir).filter((f) => f.endsWith('.wav')) : [];

    const baseNames = new Set<string>();
    mp3Files.forEach((f) => baseNames.add(f.replace(/\.mp3$/i, '')));
    wavFiles.forEach((f) => baseNames.add(f.replace(/\.wav$/i, '')));

    const items: AudioItem[] = [];

    for (const base of baseNames) {
      const wavName = `${base}.wav`;
      const mp3Name = `${base}.mp3`;
      const wavP = path.join(paths.wavDir, wavName);
      const mp3P = path.join(paths.mp3Dir, mp3Name);

      const hasWav = fs.existsSync(wavP);
      const hasMp3 = fs.existsSync(mp3P);

      let wavSize = 0;
      let mp3Size = 0;
      let ctime = Date.now();

      if (hasMp3) {
        try {
          const st = fs.statSync(mp3P);
          mp3Size = st.size;
          ctime = st.mtimeMs;
        } catch {}
      }
      if (hasWav) {
        try {
          const st = fs.statSync(wavP);
          wavSize = st.size;
          if (!hasMp3) ctime = st.mtimeMs;
        } catch {}
      }

      const matchedJob = ws.jobs.find((j) => j.filename === base) || ws.history.find((h) => h.filename === base);
      const duration = matchedJob?.duration || (mp3Size > 0 ? Math.round(mp3Size / (192 * 128)) : 0);

      items.push({
        filename: hasMp3 ? mp3Name : wavName,
        baseName: base,
        hasWav,
        hasMp3,
        wavSize,
        mp3Size,
        duration,
        createdAt: ctime,
        wavPath: wavP,
        mp3Path: mp3P,
        clientId: ws.clientId,
      });
    }

    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  public deleteAudio(clientId: string | undefined, baseName: string): boolean {
    const paths = getClientPaths(clientId);
    const wavP = path.join(paths.wavDir, `${baseName}.wav`);
    const mp3P = path.join(paths.mp3Dir, `${baseName}.mp3`);
    let deleted = false;
    if (fs.existsSync(wavP)) {
      try {
        fs.unlinkSync(wavP);
        deleted = true;
      } catch {}
    }
    if (fs.existsSync(mp3P)) {
      try {
        fs.unlinkSync(mp3P);
        deleted = true;
      } catch {}
    }
    return deleted;
  }

  public renameAudio(clientId: string | undefined, oldBase: string, newBase: string): boolean {
    const paths = getClientPaths(clientId);
    const oldWav = path.join(paths.wavDir, `${oldBase}.wav`);
    const newWav = path.join(paths.wavDir, `${newBase}.wav`);
    const oldMp3 = path.join(paths.mp3Dir, `${oldBase}.mp3`);
    const newMp3 = path.join(paths.mp3Dir, `${newBase}.mp3`);

    let renamed = false;
    if (fs.existsSync(oldWav)) {
      fs.renameSync(oldWav, newWav);
      renamed = true;
    }
    if (fs.existsSync(oldMp3)) {
      fs.renameSync(oldMp3, newMp3);
      renamed = true;
    }
    return renamed;
  }

  public clearAllAudio(clientId?: string): number {
    const paths = initClientDirectories(clientId);
    let count = 0;
    try {
      if (fs.existsSync(paths.mp3Dir)) {
        const mp3s = fs.readdirSync(paths.mp3Dir).filter((f) => f.endsWith('.mp3'));
        for (const f of mp3s) {
          try {
            fs.unlinkSync(path.join(paths.mp3Dir, f));
            count++;
          } catch {}
        }
      }
      if (fs.existsSync(paths.wavDir)) {
        const wavs = fs.readdirSync(paths.wavDir).filter((f) => f.endsWith('.wav'));
        for (const f of wavs) {
          try {
            fs.unlinkSync(path.join(paths.wavDir, f));
            count++;
          } catch {}
        }
      }
    } catch (e) {
      console.error('Failed clearAllAudio:', e);
    }
    return count;
  }

  // In-memory audio buffer cache for serverless environments (Vercel)
  private audioBufferCache = new Map<string, { wav?: Buffer; mp3?: Buffer; duration?: number; updatedAt: number }>();

  public setAudioBuffer(clientId: string | undefined, baseName: string, format: 'wav' | 'mp3', buffer: Buffer, duration?: number) {
    const safeClient = sanitizeClientId(clientId);
    const keys = [baseName, `${safeClient}:${baseName}`];
    for (const k of keys) {
      const existing = this.audioBufferCache.get(k) || { updatedAt: Date.now() };
      if (format === 'wav') existing.wav = buffer;
      if (format === 'mp3') existing.mp3 = buffer;
      if (duration) existing.duration = duration;
      existing.updatedAt = Date.now();
      this.audioBufferCache.set(k, existing);
    }
  }

  public getAudioBuffer(clientId: string | undefined, baseName: string, format: 'wav' | 'mp3'): Buffer | null {
    const safeClient = sanitizeClientId(clientId);
    const entry = this.audioBufferCache.get(`${safeClient}:${baseName}`) || this.audioBufferCache.get(baseName);
    if (!entry) return null;
    return (format === 'mp3' ? entry.mp3 : entry.wav) || null;
  }

  public getAudioPayload(clientId: string | undefined, baseName: string): { wavBase64?: string; mp3Base64?: string; duration?: number } | null {
    const safeClient = sanitizeClientId(clientId);
    const entry = this.audioBufferCache.get(`${safeClient}:${baseName}`) || this.audioBufferCache.get(baseName);
    let wavBuf = entry?.wav;
    let mp3Buf = entry?.mp3;

    if (!wavBuf) {
      const p = this.getAudioFilePath(clientId, 'wav', baseName) || this.findAudioFileAcrossAllWorkspaces('wav', baseName);
      if (p && fs.existsSync(p)) {
        try { wavBuf = fs.readFileSync(p); } catch {}
      }
    }
    if (!mp3Buf) {
      const p = this.getAudioFilePath(clientId, 'mp3', baseName) || this.findAudioFileAcrossAllWorkspaces('mp3', baseName);
      if (p && fs.existsSync(p)) {
        try { mp3Buf = fs.readFileSync(p); } catch {}
      }
    }

    if (!wavBuf && !mp3Buf) return null;
    return {
      wavBase64: wavBuf ? wavBuf.toString('base64') : undefined,
      mp3Base64: mp3Buf ? mp3Buf.toString('base64') : undefined,
      duration: entry?.duration,
    };
  }

  public getAudioFilePath(clientId: string | undefined, format: 'wav' | 'mp3', baseName: string): string {
    const paths = getClientPaths(clientId);
    const dir = format === 'wav' ? paths.wavDir : paths.mp3Dir;
    return path.join(dir, `${baseName}.${format}`);
  }

  /**
   * Search for audio file across all client workspaces and root storage directory.
   * Guarantees download links succeed even if clientId query parameter is omitted.
   */
  public findAudioFileAcrossAllWorkspaces(format: 'wav' | 'mp3', baseName: string): string | null {
    const ext = `.${format}`;
    const filename = `${baseName}${ext}`;

    // 1. Check root storage directory
    const rootPath = path.join(format === 'wav' ? WAV_DIR : MP3_DIR, filename);
    if (fs.existsSync(rootPath)) {
      return rootPath;
    }

    // 2. Check all workspace folders in storage/workspaces
    const wsRoot = path.join(STORAGE_DIR, 'workspaces');
    if (fs.existsSync(wsRoot)) {
      try {
        const wsFolders = fs.readdirSync(wsRoot);
        for (const ws of wsFolders) {
          const candPath = path.join(wsRoot, ws, format, filename);
          if (fs.existsSync(candPath)) {
            return candPath;
          }
        }
      } catch {}
    }

    return null;
  }
}

export const storageService = new StorageService();
