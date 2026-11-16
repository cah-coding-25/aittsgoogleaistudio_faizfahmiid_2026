/**
 * Frontend client for communicating with Chrome Extension via Bridge script
 */
import { getClientId } from './clientWorkspace';

export class ExtensionClient {
  private static instance: ExtensionClient;
  private isExtensionReady = false;
  private listeners: Array<(event: any) => void> = [];

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (event.data?.source === 'AI_TTS_EXTENSION') {
          if (event.data.type === 'EXTENSION_READY') {
            this.isExtensionReady = true;
            // Auto handshake with current origin (preserve extension default `unduhan` folder unless user linked a custom folder)
            this.connectHandshake(window.location.origin).catch(() => {});
          }
          this.listeners.forEach((fn) => fn(event.data));
        }
      });
    }
  }

  public static getInstance(): ExtensionClient {
    if (!ExtensionClient.instance) {
      ExtensionClient.instance = new ExtensionClient();
    }
    return ExtensionClient.instance;
  }

  public subscribe(fn: (event: any) => void) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public isReady(): boolean {
    return this.isExtensionReady;
  }

  public async checkPresence(): Promise<boolean> {
    try {
      const res = await this.sendCommand('PING_BRIDGE', {}, 1200);
      if (res?.ready) {
        const wasReady = this.isExtensionReady;
        this.isExtensionReady = true;
        if (!wasReady) {
          this.listeners.forEach((fn) =>
            fn({ source: 'AI_TTS_EXTENSION', type: 'EXTENSION_STATUS_CHANGE', ready: true })
          );
        }
        return true;
      }
    } catch {}
    return this.isExtensionReady;
  }

  public async sendCommand(type: string, payload: any = {}, timeoutMs = 5000): Promise<any> {
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Batas waktu komunikasi ekstensi habis (Timeout). Pastikan ekstensi Chrome terpasang dan aktif.'));
      }, timeoutMs);

      const handleResponse = (event: MessageEvent) => {
        if (event.data?.source === 'AI_TTS_EXTENSION') {
          if (event.data.messageId === messageId) {
            cleanup();
            if (event.data.type === 'ERROR_REPORT') {
              reject(new Error(event.data.payload?.error || 'Kesalahan ekstensi'));
            } else {
              resolve(event.data.payload);
            }
          }
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', handleResponse);
      };

      window.addEventListener('message', handleResponse);

      // Post message targeted for bridge
      window.postMessage(
        {
          target: 'AI_TTS_EXTENSION',
          type,
          messageId,
          payload: {
            clientId: getClientId(),
            ...payload,
          },
        },
        '*'
      );
    });
  }

  public async connectHandshake(backendUrl = window.location.origin): Promise<any> {
    const clientId = getClientId();
    return this.sendCommand('CONNECT', { backendUrl, clientId });
  }

  public async syncDownloadSubfolder(subfolder: string): Promise<any> {
    try {
      return await this.sendCommand('SET_DOWNLOAD_SUBFOLDER', { subfolder });
    } catch (e) {
      console.warn('Could not sync download subfolder to extension bridge:', e);
    }
  }

  public async notifyJobAudioReceived(
    jobId: string,
    filename: string,
    remainingJobs: any[] = [],
    runSessionId = '',
    allCompleted = false
  ): Promise<any> {
    try {
      return await this.sendCommand('JOB_AUDIO_RECEIVED', {
        jobId,
        filename,
        remainingJobs,
        runSessionId,
        allCompleted,
      });
    } catch (e) {
      // Bridge might not be connected in isolated tab, handled gracefully
    }
  }

  public async getPendingExtensionWavs(): Promise<Array<{
    pendingId: string;
    filename: string;
    baseName: string;
    dataUrl: string;
    size: number;
    path?: string;
    createdAt: number;
  }>> {
    try {
      const res = await this.sendCommand('GET_PENDING_EXTENSION_WAVS', {}, 3000);
      return Array.isArray(res?.items) ? res.items : [];
    } catch {
      return [];
    }
  }

  public async ackExtensionWavs(ids: string[]): Promise<void> {
    if (!ids || ids.length === 0) return;
    try {
      await this.sendCommand('ACK_EXTENSION_WAVS', { ids }, 2000);
    } catch {}
  }

  public async scanExtensionUnduhanFolder(
    knownSignatures: Record<string, string> = {}
  ): Promise<{
    success: boolean;
    folderLinked: boolean;
    folderName?: string;
    accepted?: number;
    rejected?: number;
    rejectedFiles?: Array<{ filename: string; reason: string }>;
    items: Array<{
      filename: string;
      baseName: string;
      size: number;
      lastModified: number;
      duration: number;
      dataUrl: string;
    }>;
  }> {
    try {
      const res = await this.sendCommand('SCAN_LINKED_UNDUHAN_FOLDER', { knownSignatures }, 8000);
      return {
        success: !!res?.success,
        folderLinked: !!res?.folderLinked,
        folderName: res?.folderName,
        accepted: Number(res?.accepted || 0),
        rejected: Number(res?.rejected || 0),
        rejectedFiles: Array.isArray(res?.rejectedFiles) ? res.rejectedFiles : [],
        items: Array.isArray(res?.items) ? res.items : [],
      };
    } catch {
      return { success: false, folderLinked: false, items: [] };
    }
  }

  public async getExtensionWavByName(baseName: string): Promise<{
    filename: string;
    baseName: string;
    size: number;
    lastModified: number;
    duration: number;
    dataUrl: string;
  } | null> {
    try {
      const res = await this.sendCommand('GET_EXTENSION_WAV_BY_NAME', { baseName }, 6000);
      if (res?.success && res?.item?.dataUrl) {
        return res.item;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async appendQueueJobs(jobs: any[]): Promise<{ success: boolean; count?: number }> {
    try {
      const res = await this.sendCommand('APPEND_QUEUE_JOBS', { jobs }, 4000);
      return { success: !!res?.success, count: res?.count };
    } catch {
      return { success: false };
    }
  }

  public async getRunnerState(): Promise<{
    success: boolean;
    aiStudioTabFound?: boolean;
    isExecuting: boolean;
    isCooldownWaiting?: boolean;
    isPickingJob?: boolean;
    cooldownElapsedMs?: number;
    pickingElapsedMs?: number;
    executingElapsedMs?: number;
    isQueueActive: boolean;
    currentJobId?: string | null;
    currentFilename?: string | null;
    pendingCount?: number;
  }> {
    try {
      const res = await this.sendCommand('GET_RUNNER_STATE', {}, 2500);
      return {
        success: !!res?.success,
        aiStudioTabFound: !!res?.aiStudioTabFound,
        isExecuting: !!res?.isExecuting,
        isCooldownWaiting: !!res?.isCooldownWaiting,
        isPickingJob: !!res?.isPickingJob,
        cooldownElapsedMs: Number(res?.cooldownElapsedMs || 0),
        pickingElapsedMs: Number(res?.pickingElapsedMs || 0),
        executingElapsedMs: Number(res?.executingElapsedMs || 0),
        isQueueActive: !!res?.isQueueActive,
        currentJobId: res?.currentJobId || null,
        currentFilename: res?.currentFilename || null,
        pendingCount: Number(res?.pendingCount || 0),
      };
    } catch {
      return { success: false, isExecuting: false, isQueueActive: false };
    }
  }

  public async runDiagnostics(): Promise<any> {
    return this.sendCommand('RUN_DIAGNOSTICS');
  }

  public disconnect(): void {
    this.isExtensionReady = false;
    this.listeners = [];
    if (typeof window !== 'undefined') {
      window.postMessage(
        {
          target: 'AI_TTS_EXTENSION',
          type: 'DISCONNECT',
          payload: { clientId: getClientId() },
        },
        '*'
      );
    }
  }
}

export const extensionClient = ExtensionClient.getInstance();
