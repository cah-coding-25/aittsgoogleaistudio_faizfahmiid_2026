import { TTSJob, AudioItem, ActivityLog, AppSettings } from '../types';
import { getClientId } from './clientWorkspace';

// Storage key scoping per PC/Workspace to guarantee 100% isolation
const getJobsStorageKey = () => `ai_tts_jobs_${getClientId()}`;
const getAudioStorageKey = () => `ai_tts_audio_${getClientId()}`;
const getLogsStorageKey = () => `ai_tts_logs_${getClientId()}`;
const getSettingsStorageKey = () => `ai_tts_settings_${getClientId()}`;

// Legacy migration keys
const LEGACY_JOBS_KEY = 'ai_tts_jobs_persistent_v1';
const LEGACY_AUDIO_KEY = 'ai_tts_audio_library_persistent_v1';
const LEGACY_LOGS_KEY = 'ai_tts_logs_persistent_v1';

/**
 * Fast deep check if two job arrays have identical content.
 * Prevents React from re-rendering and flickering if jobs have not changed.
 */
export function areJobsEqual(a: TTSJob[] | null | undefined, b: TTSJob[] | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const ja = a[i];
    const jb = b[i];
    if (
      ja.id !== jb.id ||
      ja.status !== jb.status ||
      ja.order !== jb.order ||
      ja.filename !== jb.filename ||
      ja.text !== jb.text ||
      ja.retryCount !== jb.retryCount ||
      ja.updatedAt !== jb.updatedAt ||
      ja.duration !== jb.duration ||
      ja.error !== jb.error
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Fast check if two audio item arrays have identical content.
 * Prevents re-rendering the audio library and restarting playback.
 */
export function areAudioItemsEqual(a: AudioItem[] | null | undefined, b: AudioItem[] | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const ia = a[i];
    const ib = b[i];
    if (
      ia.baseName !== ib.baseName ||
      ia.hasMp3 !== ib.hasMp3 ||
      ia.hasWav !== ib.hasWav ||
      ia.mp3Size !== ib.mp3Size ||
      ia.wavSize !== ib.wavSize ||
      ia.duration !== ib.duration ||
      ia.createdAt !== ib.createdAt
    ) {
      return false;
    }
  }
  return true;
}

export const localHistory = {
  // --- JOBS & TEXTS ---
  getJobs(): TTSJob[] {
    try {
      const key = getJobsStorageKey();
      let raw = localStorage.getItem(key);

      // Seamless migration from legacy single-tenant storage if present
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_JOBS_KEY);
        if (legacy) {
          localStorage.setItem(key, legacy);
          raw = legacy;
        }
      }

      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[LocalHistory] Error reading jobs from localStorage:', e);
      return [];
    }
  },

  saveJobs(jobs: TTSJob[]): void {
    try {
      localStorage.setItem(getJobsStorageKey(), JSON.stringify(jobs));
    } catch (e) {
      console.warn('[LocalHistory] Error saving jobs to localStorage:', e);
    }
  },

  /**
   * Anti-flicker merge:
   * Compares the merged result with the existing local list.
   * If identical, returns the PREVIOUS array reference so React bails out of rendering.
   */
  mergeJobs(serverJobs: TTSJob[]): TTSJob[] {
    const local = this.getJobs();
    if (!serverJobs || serverJobs.length === 0) {
      return local;
    }

    const map = new Map<string, TTSJob>();
    // Seed with local items first
    for (const j of local) {
      map.set(j.id, j);
    }

    // Merge or overwrite with server items (server has authoritative status/processing)
    for (const sj of serverJobs) {
      const existing = map.get(sj.id);
      if (existing) {
        map.set(sj.id, { ...existing, ...sj });
      } else {
        map.set(sj.id, sj);
      }
    }

    const merged = Array.from(map.values()).sort((a, b) => a.order - b.order);

    if (areJobsEqual(local, merged)) {
      return local; // Referential stability: avoid React re-render
    }

    this.saveJobs(merged);
    return merged;
  },

  updateJob(id: string, partial: Partial<TTSJob>): TTSJob[] {
    const current = this.getJobs();
    const idx = current.findIndex((j) => j.id === id);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...partial, updatedAt: Date.now() };
      this.saveJobs(current);
    }
    return current;
  },

  deleteJob(id: string): TTSJob[] {
    const current = this.getJobs();
    const updated = current.filter((j) => j.id !== id);
    updated.forEach((j, i) => (j.order = i + 1));
    this.saveJobs(updated);
    return updated;
  },

  addJobs(items: Array<{ filename: string; text: string }>): TTSJob[] {
    const current = this.getJobs();
    let maxOrder = current.reduce((max, j) => Math.max(max, j.order || 0), 0);
    const now = Date.now();
    const newJobs: TTSJob[] = items.map((item, idx) => ({
      id: `job_${now}_${Math.random().toString(36).substring(2, 7)}_${idx}`,
      filename: item.filename,
      text: item.text,
      status: 'PENDING',
      order: ++maxOrder,
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    }));
    const updated = [...current, ...newJobs];
    this.saveJobs(updated);
    return updated;
  },

  clearCompletedJobs(): TTSJob[] {
    const current = this.getJobs();
    const remaining = current.filter((j) => j.status !== 'COMPLETED');
    remaining.forEach((j, i) => (j.order = i + 1));
    this.saveJobs(remaining);
    return remaining;
  },

  clearAllJobs(): TTSJob[] {
    try {
      localStorage.removeItem(getJobsStorageKey());
    } catch {}
    return [];
  },

  // --- AUDIO LIBRARY ---
  getAudioItems(): AudioItem[] {
    try {
      const key = getAudioStorageKey();
      let raw = localStorage.getItem(key);

      // Seamless migration from legacy storage
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_AUDIO_KEY);
        if (legacy) {
          localStorage.setItem(key, legacy);
          raw = legacy;
        }
      }

      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[LocalHistory] Error reading audio items from localStorage:', e);
      return [];
    }
  },

  saveAudioItems(items: AudioItem[]): void {
    try {
      localStorage.setItem(getAudioStorageKey(), JSON.stringify(items));
    } catch (e) {
      console.warn('[LocalHistory] Error saving audio items to localStorage:', e);
    }
  },

  mergeAudioItems(serverItems: AudioItem[]): AudioItem[] {
    const local = this.getAudioItems();
    if (!serverItems || serverItems.length === 0) {
      return local;
    }

    const map = new Map<string, AudioItem>();
    for (const item of local) {
      map.set(item.baseName, item);
    }

    for (const sItem of serverItems) {
      const existing = map.get(sItem.baseName);
      if (existing) {
        map.set(sItem.baseName, {
          ...existing,
          ...sItem,
          hasMp3: sItem.hasMp3 || existing.hasMp3,
          hasWav: sItem.hasWav || existing.hasWav,
          mp3Size: sItem.mp3Size || existing.mp3Size,
          wavSize: sItem.wavSize || existing.wavSize,
          duration: sItem.duration || existing.duration,
        });
      } else {
        map.set(sItem.baseName, sItem);
      }
    }

    const merged = Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);

    if (areAudioItemsEqual(local, merged)) {
      return local; // Referential stability
    }

    this.saveAudioItems(merged);
    return merged;
  },

  addOrUpdateAudioItem(item: AudioItem): AudioItem[] {
    const local = this.getAudioItems();
    const idx = local.findIndex((i) => i.baseName === item.baseName);
    let next: AudioItem[];
    if (idx >= 0) {
      next = [...local];
      next[idx] = { ...next[idx], ...item };
    } else {
      next = [item, ...local];
    }
    this.saveAudioItems(next);
    return next;
  },

  deleteAudio(baseName: string): AudioItem[] {
    const current = this.getAudioItems();
    const updated = current.filter((item) => item.baseName !== baseName);
    this.saveAudioItems(updated);
    return updated;
  },

  clearAllAudio(): AudioItem[] {
    try {
      localStorage.removeItem(getAudioStorageKey());
    } catch {}
    return [];
  },

  // --- LOGS ---
  getLogs(): ActivityLog[] {
    try {
      const key = getLogsStorageKey();
      let raw = localStorage.getItem(key);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_LOGS_KEY);
      }
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveLogs(logs: ActivityLog[]): void {
    try {
      localStorage.setItem(getLogsStorageKey(), JSON.stringify(logs.slice(-300)));
    } catch {}
  },

  clearLogs(): void {
    try {
      localStorage.removeItem(getLogsStorageKey());
      localStorage.removeItem(LEGACY_LOGS_KEY);
    } catch {}
  },

  addLog(level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS', message: string, details?: any): void {
    try {
      const logs = this.getLogs();
      const newLog: ActivityLog = {
        id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        level,
        message,
        details: typeof details === 'string' ? details : details ? JSON.stringify(details) : undefined,
      };
      this.saveLogs([...logs, newLog]);
    } catch {}
  },

  // --- SETTINGS (Local per PC) ---
  getLocalSettings(): Partial<AppSettings> | null {
    try {
      const raw = localStorage.getItem(getSettingsStorageKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  saveLocalSettings(settings: Partial<AppSettings>): void {
    try {
      const existing = this.getLocalSettings() || {};
      const merged = { ...existing, ...settings };
      localStorage.setItem(getSettingsStorageKey(), JSON.stringify(merged));
    } catch {}
  },

  clearAll(): void {
    try {
      localStorage.removeItem(getJobsStorageKey());
      localStorage.removeItem(getAudioStorageKey());
      localStorage.removeItem(getLogsStorageKey());
      localStorage.removeItem(LEGACY_JOBS_KEY);
      localStorage.removeItem(LEGACY_AUDIO_KEY);
      localStorage.removeItem(LEGACY_LOGS_KEY);
    } catch {}
  },
};
