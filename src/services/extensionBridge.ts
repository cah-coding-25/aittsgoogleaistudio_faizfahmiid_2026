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
            // Auto handshake with current origin
            this.connectHandshake(window.location.origin)
              .then(() => {
                const savedFolder = localStorage.getItem('ai_tts_saved_folder_name') || 'unduhan';
                this.syncDownloadSubfolder(savedFolder).catch(() => {});
              })
              .catch(() => {});
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
        this.isExtensionReady = true;
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

  public async notifyJobAudioReceived(jobId: string, filename: string): Promise<any> {
    try {
      return await this.sendCommand('JOB_AUDIO_RECEIVED', { jobId, filename });
    } catch (e) {
      // Bridge might not be connected in isolated tab, handled gracefully
    }
  }

  public async runDiagnostics(): Promise<any> {
    return this.sendCommand('RUN_DIAGNOSTICS');
  }

  public async setDockVisibility(visible: boolean): Promise<any> {
    try {
      return await this.sendCommand('SET_DOCK_VISIBILITY', { visible });
    } catch (e) {
      console.warn('Could not set dock visibility via extension bridge:', e);
    }
  }

  public async getDockVisibility(): Promise<boolean> {
    try {
      const res = await this.sendCommand('GET_DOCK_VISIBILITY', {}, 1500);
      return res?.dockVisible !== false;
    } catch {
      return true;
    }
  }

  public async toggleDock(): Promise<any> {
    try {
      return await this.sendCommand('TOGGLE_DOCK', {});
    } catch (e) {
      console.warn('Could not toggle dock via extension bridge:', e);
    }
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
