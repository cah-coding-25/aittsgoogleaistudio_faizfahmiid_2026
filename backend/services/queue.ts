import EventEmitter from 'events';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { storageService, TTSJob, JobStatus } from './storage.ts';
import { convertWavFileToMp3, generateTestWav } from './converter.ts';
import { getClientPaths, sanitizeClientId } from '../config/config.ts';
import { sanitizeFilename } from './validator.ts';

export type QueueState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';

export interface ExtensionStatus {
  connected: boolean;
  aiStudioConnected: boolean;
  lastPing: number;
  tabId?: number;
  activeUrl?: string;
  version: string;
}

interface ClientQueueState {
  clientId: string;
  state: QueueState;
  currentJobId: string | null;
  isProcessing: boolean;
  retryTimeoutTimer: NodeJS.Timeout | null;
  sessionToken: string;
  extensionStatus: ExtensionStatus;
}

class QueueManager extends EventEmitter {
  private queues = new Map<string, ClientQueueState>();

  constructor() {
    super();
    this.startHeartbeatCheck();
  }

  private getQueue(rawClientId?: string): ClientQueueState {
    const safeId = sanitizeClientId(rawClientId);
    let q = this.queues.get(safeId);
    if (!q) {
      q = {
        clientId: safeId,
        state: 'IDLE',
        currentJobId: null,
        isProcessing: false,
        retryTimeoutTimer: null,
        sessionToken: crypto.randomBytes(16).toString('hex'),
        extensionStatus: {
          connected: false,
          aiStudioConnected: false,
          lastPing: 0,
          version: '1.0.0',
        },
      };
      this.queues.set(safeId, q);
    }
    return q;
  }

  public getSessionToken(clientId?: string): string {
    return this.getQueue(clientId).sessionToken;
  }

  public getQueueState(clientId?: string): QueueState {
    return this.getQueue(clientId).state;
  }

  public getCurrentJob(clientId?: string): TTSJob | null {
    const q = this.getQueue(clientId);
    if (!q.currentJobId) return null;
    return storageService.getJob(q.clientId, q.currentJobId) || null;
  }

  private sortJobsAscending(jobs: TTSJob[]): TTSJob[] {
    return [...jobs].sort((a, b) => {
      const orderA = Number.isFinite(Number(a?.order)) && Number(a.order) > 0 ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(Number(b?.order)) && Number(b.order) > 0 ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
    });
  }

  public getJobForExtension(clientId?: string): TTSJob | null {
    let q = this.getQueue(clientId);

    // STRICT: ONLY dispatch jobs if a queue was explicitly started (state === 'RUNNING')!
    // Never auto-start IDLE, PAUSED, or STOPPED queues when extension polls /next-job.
    if (q.state !== 'RUNNING') {
      for (const otherQ of this.queues.values()) {
        if (otherQ.state === 'RUNNING') {
          q = otherQ;
          break;
        }
      }
    }

    if (q.state !== 'RUNNING') {
      return null;
    }

    const allJobs = this.sortJobsAscending(storageService.getJobs(q.clientId));
    const lowestPending = allJobs.find((j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING');

    // 1. Check currently tracked active job, but NEVER hold onto a higher-order job if a lower-order pending job exists!
    if (q.currentJobId) {
      const job = allJobs.find((j) => j.id === q.currentJobId);
      if (job && ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING', 'DOWNLOADING', 'UPLOADING'].includes(job.status)) {
        if (!lowestPending || job.order <= lowestPending.order) {
          return job;
        }
      }
    }

    // 2. Check storage for any job currently in-flight that is at or before lowestPending
    const inFlight = allJobs.find((j) => ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING'].includes(j.status));
    if (inFlight && (!lowestPending || inFlight.order <= lowestPending.order)) {
      q.currentJobId = inFlight.id;
      q.isProcessing = true;
      return inFlight;
    }

    // 3. Pick next pending job strictly in ascending order (#1 -> last, unlimited)
    if (lowestPending) {
      q.currentJobId = lowestPending.id;
      q.isProcessing = true;
      this.setJobStatus(q.clientId, lowestPending.id, 'SENDING_TEXT', 'Mengirim data teks ke Google AI Studio.');
      return lowestPending;
    }

    // 4. Conclude queue cleanly back to IDLE when all jobs finish
    q.state = 'IDLE';
    q.currentJobId = null;
    q.isProcessing = false;
    this.emit('queue_state', { clientId: q.clientId, state: 'IDLE' });
    return null;
  }

  public getExtensionStatus(clientId?: string): ExtensionStatus {
    const q = this.getQueue(clientId);
    const isAlive = Date.now() - q.extensionStatus.lastPing < 15000;
    return {
      ...q.extensionStatus,
      connected: isAlive && q.extensionStatus.connected,
      aiStudioConnected: isAlive && q.extensionStatus.aiStudioConnected,
    };
  }

  public updateExtensionHeartbeat(clientId: string | undefined, data: Partial<ExtensionStatus>) {
    const q = this.getQueue(clientId);
    const wasConnected = q.extensionStatus.connected;
    q.extensionStatus = {
      ...q.extensionStatus,
      ...data,
      lastPing: Date.now(),
      connected: true,
    };

    if (!wasConnected) {
      this.log(q.clientId, 'INFO', 'Ekstensi Chrome berhasil terhubung ke Backend.', undefined, { version: data.version });
      this.emit('extension_status', { clientId: q.clientId, status: this.getExtensionStatus(q.clientId) });
    }
  }

  public markExtensionDisconnected(clientId: string) {
    const q = this.getQueue(clientId);
    if (q.extensionStatus.connected) {
      q.extensionStatus.connected = false;
      q.extensionStatus.aiStudioConnected = false;
      this.log(q.clientId, 'WARN', 'Koneksi dengan Ekstensi Chrome terputus.');
      this.emit('extension_status', { clientId: q.clientId, status: this.getExtensionStatus(q.clientId) });
    }
  }

  private startHeartbeatCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const q of this.queues.values()) {
        const active = now - q.extensionStatus.lastPing < 15000;
        if (q.extensionStatus.connected && !active) {
          this.markExtensionDisconnected(q.clientId);
        }
      }
    }, 5000);
  }

  public log(clientId: string | undefined, level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string, jobId?: string, details?: any) {
    const safeId = sanitizeClientId(clientId);
    const detailStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : undefined;
    const item = storageService.addLog(safeId, {
      level,
      message,
      jobId,
      details: detailStr,
    });
    this.emit('log', { clientId: safeId, ...item });
  }

  // --- QUEUE ACTIONS ---
  public async startQueue(clientId?: string): Promise<{ success: boolean; message: string }> {
    const q = this.getQueue(clientId);
    if (q.state === 'RUNNING') {
      return { success: false, message: 'Antrean sedang berjalan.' };
    }

    const extStatus = this.getExtensionStatus(q.clientId);
    const settings = storageService.getSettings(q.clientId);

    if (!settings.mockMode && !extStatus.connected) {
      this.log(q.clientId, 'WARN', 'Ekstensi Chrome belum terhubung ke workspace PC ini. Harap sambungkan ekstensi terlebih dahulu.');
      return { success: false, message: 'Ekstensi Chrome belum terhubung ke workspace PC ini.' };
    }

    // Clear stale in-flight locks & reset any interrupted unfinished jobs to PENDING so #1 always executes first
    q.currentJobId = null;
    q.isProcessing = false;
    const staleStatuses = new Set([
      'SENDING_TEXT',
      'PREPARING',
      'WAITING_AUDIO',
      'GENERATING',
      'DOWNLOADING',
      'UPLOADING',
      'CONVERTING',
      'SAVING',
      'VERIFYING',
    ]);
    for (const job of storageService.getJobs(q.clientId)) {
      if (staleStatuses.has(job.status)) {
        storageService.updateJob(q.clientId, job.id, { status: 'PENDING' });
      }
    }

    q.state = 'RUNNING';
    this.log(q.clientId, 'INFO', 'Antrean pemrosesan TTS dimulai urut #1 hingga selesai.');
    this.emit('queue_state', { clientId: q.clientId, state: q.state });
    this.processNextJob(q.clientId);
    return { success: true, message: 'Antrean berhasil dijalankan.' };
  }

  public pauseQueue(clientId?: string): { success: boolean; message: string } {
    const q = this.getQueue(clientId);
    if (q.state !== 'RUNNING') {
      return { success: false, message: 'Antrean tidak sedang berjalan.' };
    }
    q.state = 'PAUSED';
    if (q.retryTimeoutTimer) {
      clearTimeout(q.retryTimeoutTimer);
      q.retryTimeoutTimer = null;
    }
    this.log(q.clientId, 'INFO', 'Antrean pemrosesan dijeda (PAUSED).');
    this.emit('queue_state', { clientId: q.clientId, state: q.state });
    return { success: true, message: 'Antrean berhasil dijeda.' };
  }

  public resumeQueue(clientId?: string): { success: boolean; message: string } {
    const q = this.getQueue(clientId);
    if (q.state !== 'PAUSED') {
      return { success: false, message: 'Antrean tidak dalam status jeda.' };
    }
    q.state = 'RUNNING';
    this.log(q.clientId, 'INFO', 'Antrean pemrosesan dilanjutkan (RESUMED).');
    this.emit('queue_state', { clientId: q.clientId, state: q.state });
    this.processNextJob(q.clientId);
    return { success: true, message: 'Antrean dilanjutkan.' };
  }

  public stopQueue(clientId?: string): { success: boolean; message: string } {
    const q = this.getQueue(clientId);
    q.state = 'STOPPED';
    if (q.retryTimeoutTimer) {
      clearTimeout(q.retryTimeoutTimer);
      q.retryTimeoutTimer = null;
    }

    if (q.currentJobId) {
      const job = storageService.getJob(q.clientId, q.currentJobId);
      if (job && job.status !== 'COMPLETED' && job.status !== 'FAILED') {
        storageService.updateJob(q.clientId, q.currentJobId, { status: 'CANCELLED' });
      }
      q.currentJobId = null;
    }
    q.isProcessing = false;
    this.log(q.clientId, 'WARN', 'Antrean dihentikan (STOPPED). Pekerjaan aktif dibatalkan dengan aman.');
    this.emit('queue_state', { clientId: q.clientId, state: q.state });
    return { success: true, message: 'Antrean berhasil dihentikan.' };
  }

  // --- JOB PROCESSING ---
  private async processNextJob(clientId: string) {
    const q = this.getQueue(clientId);
    if (q.state !== 'RUNNING' || q.isProcessing) {
      return;
    }

    const jobs = this.sortJobsAscending(storageService.getJobs(q.clientId));
    const nextJob = jobs.find((j) => j.status === 'PENDING' || j.status === 'DRAFT' || j.status === 'RETRYING');

    if (!nextJob) {
      q.state = 'IDLE';
      q.currentJobId = null;
      q.isProcessing = false;
      this.log(q.clientId, 'SUCCESS', 'Seluruh antrean pekerjaan TTS telah selesai.');
      this.emit('queue_state', { clientId: q.clientId, state: q.state });
      return;
    }

    q.isProcessing = true;
    q.currentJobId = nextJob.id;

    this.setJobStatus(q.clientId, nextJob.id, 'PREPARING', 'Mempersiapkan pekerjaan & memvalidasi teks.');
    this.log(q.clientId, 'INFO', `Pekerjaan ${nextJob.order} (${nextJob.filename}) disiapkan.`, nextJob.id);

    const settings = storageService.getSettings(q.clientId);

    if (settings.mockMode) {
      await this.runMockPipeline(q.clientId, nextJob);
      q.isProcessing = false;
      if (q.state === 'RUNNING') {
        setTimeout(() => this.processNextJob(q.clientId), 1000);
      }
      return;
    }

    const extStatus = this.getExtensionStatus(q.clientId);
    if (!extStatus.connected) {
      await this.handleJobFailure(q.clientId, nextJob.id, 'Ekstensi Chrome terputus saat akan memproses pekerjaan.');
      return;
    }

    this.setJobStatus(q.clientId, nextJob.id, 'SENDING_TEXT', 'Mengirim data teks ke Google AI Studio.');
    this.emit('job_dispatch', {
      clientId: q.clientId,
      jobId: nextJob.id,
      order: nextJob.order,
      filename: nextJob.filename,
      text: nextJob.text,
      aiStudioUrl: settings.aiStudioUrl,
    });
  }

  public setJobStatus(clientId: string, jobId: string, status: JobStatus, message?: string, extra?: Partial<TTSJob>) {
    const updated = storageService.updateJob(clientId, jobId, {
      status,
      ...extra,
    });
    if (updated) {
      if (message) {
        const logMap: Record<string, 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'> = {
          COMPLETED: 'SUCCESS',
          FAILED: 'ERROR',
          RETRYING: 'WARN',
        };
        const level = logMap[status] || 'INFO';
        this.log(clientId, level, `[${updated.filename}] ${message}`, jobId);
      }
      this.emit('job_update', { clientId, job: updated });
    }
    return updated;
  }

  public async handleExtensionReport(
    clientId: string,
    jobId: string,
    step: 'TEXT_INSERTED' | 'RUN_CLICKED' | 'GENERATION_STARTED' | 'GENERATION_COMPLETED' | 'AUDIO_DETECTED' | 'JOB_COMPLETED' | 'JOB_FAILED',
    payload?: any
  ) {
    const q = this.getQueue(clientId);
    const job = storageService.getJob(clientId, jobId);
    if (!job) return;

    if (q.currentJobId && q.currentJobId !== jobId) {
      const tracked = storageService.getJob(clientId, q.currentJobId);
      if (step === 'TEXT_INSERTED' && (!tracked || job.order < tracked.order)) {
        q.currentJobId = jobId;
        q.isProcessing = true;
      } else {
        return;
      }
    }

    if (!q.currentJobId && q.state === 'RUNNING') {
      q.currentJobId = jobId;
      q.isProcessing = true;
    }

    switch (step) {
      case 'TEXT_INSERTED':
        this.setJobStatus(clientId, jobId, 'PREPARING', 'Teks berhasil dimasukkan ke kolom Google AI Studio.');
        break;
      case 'RUN_CLICKED':
        this.setJobStatus(clientId, jobId, 'GENERATING', 'Tombol Run ditekan. Memulai proses generasi suara...');
        break;
      case 'GENERATION_STARTED':
        this.setJobStatus(clientId, jobId, 'WAITING_AUDIO', 'Generasi sedang berjalan di Google AI Studio...');
        break;
      case 'GENERATION_COMPLETED':
        this.setJobStatus(clientId, jobId, 'DOWNLOADING', 'Generasi suara selesai, mendeteksi elemen audio...');
        break;
      case 'AUDIO_DETECTED':
        this.setJobStatus(clientId, jobId, 'UPLOADING', 'Audio WAV terdeteksi di halaman, menyimpan ke folder unduhan...');
        break;
      case 'JOB_COMPLETED': {
        this.setJobStatus(clientId, jobId, 'COMPLETED', `Selesai! File WAV "${payload?.filename || job.filename}" tersimpan di folder unduhan.`, {
          completedAt: Date.now(),
          error: undefined,
        });
        if (q.currentJobId === jobId || !q.currentJobId) {
          q.isProcessing = false;
          q.currentJobId = null;
        }
        if (q.state === 'RUNNING') {
          setTimeout(() => this.processNextJob(clientId), 50);
        }
        break;
      }
      case 'JOB_FAILED':
        if (payload?.retrying === true && !payload?.finalFailure) {
          if (q.retryTimeoutTimer) {
            clearTimeout(q.retryTimeoutTimer);
            q.retryTimeoutTimer = null;
          }
          q.currentJobId = jobId;
          q.isProcessing = true;
          this.setJobStatus(
            clientId,
            jobId,
            'RETRYING',
            `Terkendala (${payload?.error || 'kesalahan sementara'}). Mengulang otomatis scene #${job.order} (${payload?.retryCount || 1}/${job.maxRetries || 3})...`,
            {
              retryCount: Number(payload?.retryCount) || (job.retryCount || 0) + 1,
              error: payload?.error,
            }
          );
          break;
        }
        await this.handleJobFailure(clientId, jobId, payload?.error || 'Ekstensi melaporkan kegagalan pada AI Studio.');
        break;
    }
  }

  public async handleWavReceived(
    clientId: string,
    jobId: string,
    wavBuffer: Buffer,
    _originalName?: string,
    jobObj?: TTSJob
  ): Promise<{ success: boolean; error?: string }> {
    const q = this.getQueue(clientId);
    const job = jobObj || storageService.getJob(clientId, jobId) || storageService.findJobByFilename(clientId, jobId) || storageService.findJobByFilename(clientId, _originalName || '');
    if (!job) {
      return { success: false, error: 'Pekerjaan tidak ditemukan di sistem antrean.' };
    }

    const resolvedJobId = job.id;
    const resolvedClientId = job.clientId || clientId;
    const resolvedQueue = this.getQueue(resolvedClientId);
    const paths = getClientPaths(resolvedClientId);
    const safeBase = sanitizeFilename(job.filename);
    const wavFileName = `${safeBase}.wav`;
    const mp3FileName = `${safeBase}.mp3`;

    const wavPath = path.join(paths.wavDir, wavFileName);
    const mp3Path = path.join(paths.mp3Dir, mp3FileName);

    try {
      this.setJobStatus(resolvedClientId, resolvedJobId, 'SAVING', `Menyimpan WAV asli (${(wavBuffer.length / 1024).toFixed(1)} KB)...`);
      fs.writeFileSync(wavPath, wavBuffer);
      storageService.setAudioBuffer(resolvedClientId, safeBase, 'wav', wavBuffer);

      this.setJobStatus(resolvedClientId, resolvedJobId, 'CONVERTING', 'Mengonversi audio WAV ke MP3...');
      const settings = storageService.getSettings(resolvedClientId);
      const convResult = await convertWavFileToMp3(wavPath, mp3Path, settings.mp3Bitrate);

      if (!convResult.success || !convResult.mp3Path) {
        const failedWav = path.join(paths.failedDir, wavFileName);
        try {
          fs.copyFileSync(wavPath, failedWav);
        } catch {}
        await this.handleJobFailure(resolvedClientId, resolvedJobId, `Konversi MP3 gagal: ${convResult.error || 'Error tidak diketahui'}`);
        return { success: false, error: convResult.error };
      }

      this.setJobStatus(resolvedClientId, resolvedJobId, 'VERIFYING', 'Memverifikasi kelengkapan dan ukuran file MP3...');
      if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size === 0) {
        await this.handleJobFailure(resolvedClientId, resolvedJobId, 'Verifikasi gagal: File MP3 tidak ditemukan atau berukuran 0 byte.');
        return { success: false, error: 'Verifikasi file MP3 gagal.' };
      }

      try {
        const mp3Buf = fs.readFileSync(mp3Path);
        storageService.setAudioBuffer(resolvedClientId, safeBase, 'mp3', mp3Buf, convResult.duration);
      } catch {}

      this.setJobStatus(resolvedClientId, resolvedJobId, 'COMPLETED', `Selesai! MP3 tersimpan: ${mp3FileName} (${(convResult.mp3Size! / 1024).toFixed(1)} KB)`, {
        duration: convResult.duration,
        wavSize: wavBuffer.length,
        mp3Size: convResult.mp3Size,
        wavPath,
        mp3Path,
        completedAt: Date.now(),
        error: undefined,
      });

      if (resolvedQueue.currentJobId === resolvedJobId || !resolvedQueue.currentJobId) {
        resolvedQueue.isProcessing = false;
        resolvedQueue.currentJobId = null;
      }

      if (resolvedQueue.state === 'RUNNING') {
        setTimeout(() => this.processNextJob(resolvedClientId), 50);
      }

      return { success: true };
    } catch (err: any) {
      await this.handleJobFailure(resolvedClientId, resolvedJobId, `Kesalahan pemrosesan audio: ${err?.message || 'Error internal'}`);
      return { success: false, error: err?.message };
    }
  }

  public async handleJobFailure(clientId: string, jobId: string, errorMsg: string) {
    const q = this.getQueue(clientId);
    const job = storageService.getJob(clientId, jobId);
    if (!job) return;

    const settings = storageService.getSettings(clientId);
    const currentRetries = job.retryCount || 0;

    if (settings.autoRetry && currentRetries < settings.maxRetries && q.state === 'RUNNING') {
      const nextAttempt = currentRetries + 1;
      const delays = settings.retryDelays || [5000, 15000, 30000];
      const delayMs = delays[Math.min(currentRetries, delays.length - 1)] || 10000;

      this.setJobStatus(clientId, jobId, 'RETRYING', `Percobaan gagal (${errorMsg}). Mencoba kembali (${nextAttempt}/${settings.maxRetries}) dalam ${delayMs / 1000} detik...`, {
        retryCount: nextAttempt,
        error: errorMsg,
      });

      q.retryTimeoutTimer = setTimeout(async () => {
        if (q.state === 'RUNNING' && q.currentJobId === jobId) {
          this.log(clientId, 'INFO', `Menjalankan ulang pekerjaan ${job.order} (Percobaan ke-${nextAttempt}).`, jobId);
          q.isProcessing = false;
          this.processNextJob(clientId);
        }
      }, delayMs);

      return;
    }

    this.setJobStatus(clientId, jobId, 'FAILED', `Pekerjaan gagal setelah ${currentRetries} percobaan: ${errorMsg}`, {
      error: errorMsg,
    });
    this.log(clientId, 'ERROR', `Pekerjaan ${job.order} (${job.filename}) ditandai FAILED.`, jobId, errorMsg);

    q.isProcessing = false;
    q.currentJobId = null;

    if (settings.stopWhenFailed) {
      this.stopQueue(clientId);
      return;
    }

    if (settings.skipFailedJobs && q.state === 'RUNNING') {
      setTimeout(() => this.processNextJob(clientId), 1500);
    }
  }

  public retrySingleJob(clientId: string, jobId: string): boolean {
    const job = storageService.getJob(clientId, jobId);
    if (!job) return false;

    this.setJobStatus(clientId, jobId, 'PENDING', 'Pekerjaan diatur ulang ke status antrean (PENDING).', {
      retryCount: 0,
      error: undefined,
    });

    const q = this.getQueue(clientId);
    if (q.state === 'RUNNING' && !q.isProcessing) {
      this.processNextJob(clientId);
    }
    return true;
  }

  private async runMockPipeline(clientId: string, job: TTSJob) {
    this.log(clientId, 'INFO', `[MOCK MODE] Mensimulasikan pembuatan audio untuk ${job.filename}...`, job.id);
    this.setJobStatus(clientId, job.id, 'GENERATING', '[MOCK MODE] Mensimulasikan generasi suara...');
    await new Promise((r) => setTimeout(r, 1200));

    this.setJobStatus(clientId, job.id, 'DOWNLOADING', '[MOCK MODE] Membuat sampel audio sintetis...');
    const duration = Math.min(60, Math.max(2, Math.round(job.text.length / 15)));
    const syntheticWav = generateTestWav(duration);
    await new Promise((r) => setTimeout(r, 600));

    await this.handleWavReceived(clientId, job.id, syntheticWav, `${job.filename}.wav`);
  }
}

export const queueManager = new QueueManager();
