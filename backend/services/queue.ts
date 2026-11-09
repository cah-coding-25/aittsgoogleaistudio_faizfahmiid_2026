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

  public getJobForExtension(clientId?: string): TTSJob | null {
    const q = this.getQueue(clientId);
    if (q.state !== 'RUNNING') {
      return null;
    }

    // 1. If currently tracked active job is valid
    if (q.currentJobId) {
      const job = storageService.getJob(q.clientId, q.currentJobId);
      if (job && ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING', 'DOWNLOADING', 'UPLOADING'].includes(job.status)) {
        return job;
      }
    }

    // 2. Check storage for any job currently in-flight
    const allJobs = storageService.getJobs(q.clientId);
    const inFlight = allJobs.find((j) => ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING'].includes(j.status));
    if (inFlight) {
      q.currentJobId = inFlight.id;
      q.isProcessing = true;
      return inFlight;
    }

    // 3. Queue is RUNNING, pick next pending job
    const nextPending = allJobs.find((j) => j.status === 'PENDING' || j.status === 'DRAFT');
    if (nextPending) {
      q.currentJobId = nextPending.id;
      q.isProcessing = true;
      this.setJobStatus(q.clientId, nextPending.id, 'SENDING_TEXT', 'Mengirim data teks ke Google AI Studio.');
      return nextPending;
    }

    // 4. No more pending jobs, conclude queue back to IDLE
    q.state = 'IDLE';
    q.currentJobId = null;
    q.isProcessing = false;
    this.emit('queue_state', { clientId: q.clientId, state: 'IDLE' });
    return null;
  }

  public getAnyRunningJob(): { job: TTSJob; clientId: string } | null {
    for (const [cId, q] of this.queues.entries()) {
      if (q.state === 'RUNNING') {
        const job = this.getJobForExtension(cId);
        if (job) {
          return { job, clientId: cId };
        }
      }
    }
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

    q.state = 'RUNNING';
    const allJobs = storageService.getJobs(q.clientId);
    const hasInFlight = allJobs.some((j) => ['SENDING_TEXT', 'PREPARING', 'WAITING_AUDIO', 'GENERATING', 'DOWNLOADING', 'UPLOADING'].includes(j.status));
    if (!hasInFlight) {
      q.isProcessing = false;
      q.currentJobId = null;
    }
    this.log(q.clientId, 'INFO', 'Antrean pemrosesan TTS dimulai.');
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

    const jobs = storageService.getJobs(q.clientId);
    const nextJob = jobs.find((j) => j.status === 'PENDING' || j.status === 'DRAFT');

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
    if (q.currentJobId !== jobId) {
      return;
    }

    const job = storageService.getJob(clientId, jobId);
    if (!job) return;

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
        this.setJobStatus(clientId, jobId, 'UPLOADING', 'Audio WAV terdeteksi di halaman, mentransfer ke backend...');
        break;
      case 'JOB_COMPLETED':
        this.log(clientId, 'SUCCESS', `Pekerjaan ${job.filename} dilaporkan selesai oleh ekstensi. File WAV tersimpan di folder.`, jobId);
        break;
      case 'JOB_FAILED':
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

    const paths = getClientPaths(job.clientId || clientId);
    const safeBase = sanitizeFilename(job.filename);
    const wavFileName = `${safeBase}.wav`;
    const mp3FileName = `${safeBase}.mp3`;

    const wavPath = path.join(paths.wavDir, wavFileName);
    const mp3Path = path.join(paths.mp3Dir, mp3FileName);

    try {
      this.setJobStatus(clientId, jobId, 'SAVING', `Menyimpan WAV asli (${(wavBuffer.length / 1024).toFixed(1)} KB)...`);
      fs.writeFileSync(wavPath, wavBuffer);
      storageService.setAudioBuffer(clientId, safeBase, 'wav', wavBuffer);

      this.setJobStatus(clientId, jobId, 'CONVERTING', 'Mengonversi audio WAV ke MP3...');
      const settings = storageService.getSettings(clientId);
      const convResult = await convertWavFileToMp3(wavPath, mp3Path, settings.mp3Bitrate);

      if (!convResult.success || !convResult.mp3Path) {
        const failedWav = path.join(paths.failedDir, wavFileName);
        try {
          fs.copyFileSync(wavPath, failedWav);
        } catch {}
        await this.handleJobFailure(clientId, jobId, `Konversi MP3 gagal: ${convResult.error || 'Error tidak diketahui'}`);
        return { success: false, error: convResult.error };
      }

      this.setJobStatus(clientId, jobId, 'VERIFYING', 'Memverifikasi kelengkapan dan ukuran file MP3...');
      if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size === 0) {
        await this.handleJobFailure(clientId, jobId, 'Verifikasi gagal: File MP3 tidak ditemukan atau berukuran 0 byte.');
        return { success: false, error: 'Verifikasi file MP3 gagal.' };
      }

      try {
        const mp3Buf = fs.readFileSync(mp3Path);
        storageService.setAudioBuffer(clientId, safeBase, 'mp3', mp3Buf, convResult.duration);
      } catch {}

      this.setJobStatus(clientId, jobId, 'COMPLETED', `Selesai! MP3 tersimpan: ${mp3FileName} (${(convResult.mp3Size! / 1024).toFixed(1)} KB)`, {
        duration: convResult.duration,
        wavSize: wavBuffer.length,
        mp3Size: convResult.mp3Size,
        wavPath,
        mp3Path,
        completedAt: Date.now(),
        error: undefined,
      });

      q.isProcessing = false;
      q.currentJobId = null;

      if (q.state === 'RUNNING' || (settings.autoContinue && q.state !== 'PAUSED' && q.state !== 'STOPPED')) {
        q.state = 'RUNNING';
        setTimeout(() => this.processNextJob(clientId), 1200);
      }

      return { success: true };
    } catch (err: any) {
      await this.handleJobFailure(clientId, jobId, `Kesalahan pemrosesan audio: ${err?.message || 'Error internal'}`);
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
