import { TTSJob, ActivityLog, AudioItem, AppSettings, QueueStatusResponse, QueueState } from '../types';
import { getClientId } from './clientWorkspace';
import { localHistory } from './localHistory';
import { convertWavToMp3Client } from './clientAudioConverter';
import { deleteAudioBlob, clearAllAudioBlobs, saveAudioBlob } from './localAudioStorage';

const BASE_URL = '';

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const clientId = getClientId();
  return {
    'X-Client-Id': clientId,
    'X-Session-Token': clientId,
    ...customHeaders,
  };
}

/**
 * Safe fetch helper that gracefully returns null if the host has no backend (e.g. GitHub Pages, Netlify Static)
 * or if the network request fails / returns HTML instead of JSON.
 */
async function safeFetchJson<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

// ---------------- JOBS ----------------

export async function fetchJobs(): Promise<TTSJob[]> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ jobs: TTSJob[] }>(
    `${BASE_URL}/api/jobs?clientId=${encodeURIComponent(clientId)}`,
    { headers: getHeaders() }
  );
  if (data && Array.isArray(data.jobs)) {
    return data.jobs;
  }
  // Universal Static Host Fallback (GitHub Pages, Netlify Static, Cloudflare Pages)
  return localHistory.getJobs();
}

export async function createJobs(items: Array<{ filename: string; text: string }>): Promise<{
  success: boolean;
  addedCount: number;
  jobs: TTSJob[];
  error?: string;
}> {
  const data = await safeFetchJson<{ success: boolean; addedCount: number; jobs: TTSJob[]; error?: string }>(
    `${BASE_URL}/api/jobs`,
    {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items, clientId: getClientId() }),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const updatedJobs = localHistory.addJobs(items);
  localHistory.addLog('INFO', `Menambahkan ${items.length} teks ke antrean (mode browser/serverless)`);
  return {
    success: true,
    addedCount: items.length,
    jobs: updatedJobs,
  };
}

export async function updateJob(id: string, updates: Partial<TTSJob>): Promise<{ success: boolean; job?: TTSJob; error?: string }> {
  const data = await safeFetchJson<{ success: boolean; job?: TTSJob; error?: string }>(
    `${BASE_URL}/api/jobs/${id}`,
    {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(updates),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const updatedList = localHistory.updateJob(id, updates);
  const found = updatedList.find((j) => j.id === id);
  return { success: true, job: found };
}

export async function deleteJob(id: string): Promise<{ success: boolean; error?: string }> {
  const data = await safeFetchJson<{ success: boolean; error?: string }>(
    `${BASE_URL}/api/jobs/${id}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  localHistory.deleteJob(id);
  return { success: true };
}

export async function reorderJobs(jobIds: string[]): Promise<{ success: boolean; jobs: TTSJob[] }> {
  const data = await safeFetchJson<{ success: boolean; jobs: TTSJob[] }>(
    `${BASE_URL}/api/jobs/reorder`,
    {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ jobIds }),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const current = localHistory.getJobs();
  const map = new Map(current.map((j) => [j.id, j]));
  const reordered: TTSJob[] = [];
  jobIds.forEach((id, idx) => {
    const job = map.get(id);
    if (job) {
      job.order = idx + 1;
      reordered.push(job);
      map.delete(id);
    }
  });
  // Append any remaining
  map.forEach((job) => {
    job.order = reordered.length + 1;
    reordered.push(job);
  });
  localHistory.saveJobs(reordered);
  return { success: true, jobs: reordered };
}

export async function clearCompletedJobs(): Promise<{ success: boolean; jobs: TTSJob[] }> {
  const data = await safeFetchJson<{ success: boolean; jobs: TTSJob[] }>(
    `${BASE_URL}/api/jobs/clear-completed`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const remaining = localHistory.clearCompletedJobs();
  return { success: true, jobs: remaining };
}

export async function clearAllJobs(): Promise<{ success: boolean; jobs: TTSJob[] }> {
  const data = await safeFetchJson<{ success: boolean; jobs: TTSJob[] }>(
    `${BASE_URL}/api/jobs/clear-all`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const empty = localHistory.clearAllJobs();
  return { success: true, jobs: empty };
}

export async function retryJob(id: string): Promise<{ success: boolean; error?: string }> {
  const data = await safeFetchJson<{ success: boolean; error?: string }>(
    `${BASE_URL}/api/jobs/${id}/retry`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  localHistory.updateJob(id, { status: 'PENDING', retryCount: 0, error: undefined });
  return { success: true };
}

export async function retryAllFailed(): Promise<{ success: boolean; count: number }> {
  const data = await safeFetchJson<{ success: boolean; count: number }>(
    `${BASE_URL}/api/jobs/retry-all-failed`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data && data.success) {
    return data;
  }
  // Static Host Fallback
  const current = localHistory.getJobs();
  let count = 0;
  current.forEach((j) => {
    if (j.status === 'FAILED') {
      j.status = 'PENDING';
      j.retryCount = 0;
      j.error = undefined;
      count++;
    }
  });
  if (count > 0) {
    localHistory.saveJobs(current);
  }
  return { success: true, count };
}

// ---------------- QUEUE ----------------

export async function getQueueStatus(): Promise<QueueStatusResponse> {
  const clientId = getClientId();
  const data = await safeFetchJson<QueueStatusResponse>(
    `${BASE_URL}/api/queue/status?clientId=${encodeURIComponent(clientId)}`,
    { headers: getHeaders() }
  );
  if (data) {
    return data;
  }
  // Static Host Fallback: derive status from local jobs
  const jobs = localHistory.getJobs();
  const pending = jobs.filter((j) => j.status === 'PENDING').length;
  const completed = jobs.filter((j) => j.status === 'COMPLETED').length;
  const failed = jobs.filter((j) => j.status === 'FAILED').length;
  const activeJob = jobs.find((j) =>
    ['PREPARING', 'SENDING_TEXT', 'GENERATING', 'WAITING_AUDIO', 'DOWNLOADING', 'UPLOADING', 'CONVERTING', 'SAVING', 'VERIFYING'].includes(j.status)
  ) || null;

  const queueState: QueueState = activeJob ? 'RUNNING' : 'IDLE';

  return {
    state: queueState,
    currentJob: activeJob,
    extensionStatus: {
      connected: true,
      aiStudioConnected: true,
      lastPing: Date.now(),
      version: '1.1.0',
    },
    stats: {
      total: jobs.length,
      pending,
      processing: activeJob ? 1 : 0,
      completed,
      failed,
    },
  };
}

export async function startQueue(): Promise<{ success: boolean; message: string }> {
  const data = await safeFetchJson<{ success: boolean; message: string }>(
    `${BASE_URL}/api/queue/start`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data) return data;
  return { success: true, message: 'Queue started locally' };
}

export async function pauseQueue(): Promise<{ success: boolean; message: string }> {
  const data = await safeFetchJson<{ success: boolean; message: string }>(
    `${BASE_URL}/api/queue/pause`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data) return data;
  return { success: true, message: 'Queue paused locally' };
}

export async function resumeQueue(): Promise<{ success: boolean; message: string }> {
  const data = await safeFetchJson<{ success: boolean; message: string }>(
    `${BASE_URL}/api/queue/resume`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data) return data;
  return { success: true, message: 'Queue resumed locally' };
}

export async function stopQueue(): Promise<{ success: boolean; message: string }> {
  const data = await safeFetchJson<{ success: boolean; message: string }>(
    `${BASE_URL}/api/queue/stop`,
    {
      method: 'POST',
      headers: getHeaders(),
    }
  );
  if (data) return data;
  return { success: true, message: 'Queue stopped locally' };
}

// ---------------- AUDIO ----------------

export async function fetchAudioLibrary(): Promise<AudioItem[]> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ items: AudioItem[] }>(
    `${BASE_URL}/api/audio/library?clientId=${encodeURIComponent(clientId)}`,
    { headers: getHeaders() }
  );
  if (data && Array.isArray(data.items)) {
    return data.items;
  }
  // Static Host Fallback
  return localHistory.getAudioItems();
}

export async function deleteAudio(baseName: string): Promise<{ success: boolean }> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ success: boolean }>(
    `${BASE_URL}/api/audio/${encodeURIComponent(baseName)}?clientId=${encodeURIComponent(clientId)}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );
  if (data) {
    await deleteAudioBlob(baseName, clientId).catch(() => {});
    return data;
  }
  // Static Host Fallback
  localHistory.deleteAudio(baseName);
  await deleteAudioBlob(baseName, clientId).catch(() => {});
  return { success: true };
}

export async function clearAllAudio(): Promise<{ success: boolean; count?: number }> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ success: boolean; count?: number }>(
    `${BASE_URL}/api/audio/all?clientId=${encodeURIComponent(clientId)}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );
  if (data) {
    await clearAllAudioBlobs(clientId).catch(() => {});
    return data;
  }
  // Static Host Fallback
  localHistory.clearAllAudio();
  await clearAllAudioBlobs(clientId).catch(() => {});
  return { success: true };
}

export async function renameAudio(oldBase: string, newBase: string): Promise<{ success: boolean; newBase?: string; error?: string }> {
  const data = await safeFetchJson<{ success: boolean; newBase?: string; error?: string }>(
    `${BASE_URL}/api/audio/rename`,
    {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ oldBase, newBase, clientId: getClientId() }),
    }
  );
  if (data) return data;
  // Static Host Fallback
  const current = localHistory.getAudioItems();
  const item = current.find((i) => i.baseName === oldBase);
  if (item) {
    item.baseName = newBase;
    item.filename = `${newBase}.mp3`;
    localHistory.saveAudioItems(current);
  }
  return { success: true, newBase };
}

export async function uploadWavFallback(jobId: string, file: File, filename?: string): Promise<{ success: boolean; error?: string }> {
  const clientId = getClientId();
  const formData = new FormData();
  formData.append('audio', file);
  if (filename) formData.append('filename', filename);

  try {
    const res = await fetch(`${BASE_URL}/api/audio/upload/${jobId}?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: {
        'X-Client-Id': clientId,
        'X-Session-Token': clientId,
      },
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch {}

  // Static Host Fallback: convert in browser & save to IndexedDB
  try {
    const baseName = (filename || file.name || `audio_${jobId}`).replace(/\.[^/.]+$/, '');
    const conversion = await convertWavToMp3Client(file, 192);

    await saveAudioBlob(clientId, baseName, 'mp3', conversion.mp3Blob);
    await saveAudioBlob(clientId, baseName, 'wav', file);

    const audioItem: AudioItem = {
      filename: `${baseName}.mp3`,
      baseName,
      hasMp3: true,
      hasWav: true,
      mp3Size: conversion.mp3Blob.size,
      wavSize: file.size,
      duration: conversion.duration,
      createdAt: Date.now(),
      wavPath: `/api/audio/${encodeURIComponent(baseName)}.wav`,
      mp3Path: `/api/audio/${encodeURIComponent(baseName)}.mp3`,
      clientId,
    };
    localHistory.addOrUpdateAudioItem(audioItem);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Local upload fallback failed' };
  }
}

export async function convertWavDirect(file: File, bitrate = 192, filename?: string): Promise<{
  success: boolean;
  baseName?: string;
  wavFilename?: string;
  mp3Filename?: string;
  wavSize?: number;
  mp3Size?: number;
  duration?: number;
  wavBase64?: string;
  mp3Base64?: string;
  error?: string;
}> {
  const clientId = getClientId();
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('bitrate', String(bitrate));
  if (filename) formData.append('filename', filename);

  try {
    const res = await fetch(`${BASE_URL}/api/audio/convert?clientId=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      headers: {
        'X-Client-Id': clientId,
        'X-Session-Token': clientId,
      },
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.success) return data;
    }
  } catch {}

  // Static Host Fallback: Pure browser conversion via lamejs
  try {
    const baseName = (filename || file.name || `audio_${Date.now()}`).replace(/\.[^/.]+$/, '');
    const conversion = await convertWavToMp3Client(file, bitrate);
    const wavBase64 = await blobToBase64(file);
    const mp3Base64 = await blobToBase64(conversion.mp3Blob);

    // Save locally
    await saveAudioBlob(clientId, baseName, 'mp3', conversion.mp3Blob);
    await saveAudioBlob(clientId, baseName, 'wav', file);

    const audioItem: AudioItem = {
      filename: `${baseName}.mp3`,
      baseName,
      hasMp3: true,
      hasWav: true,
      mp3Size: conversion.mp3Blob.size,
      wavSize: file.size,
      duration: conversion.duration,
      createdAt: Date.now(),
      wavPath: `/api/audio/${encodeURIComponent(baseName)}.wav`,
      mp3Path: `/api/audio/${encodeURIComponent(baseName)}.mp3`,
      clientId,
    };
    localHistory.addOrUpdateAudioItem(audioItem);

    return {
      success: true,
      baseName,
      wavFilename: `${baseName}.wav`,
      mp3Filename: `${baseName}.mp3`,
      wavSize: file.size,
      mp3Size: conversion.mp3Blob.size,
      duration: conversion.duration,
      wavBase64,
      mp3Base64,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Client conversion failed',
    };
  }
}

// ---------------- SETTINGS ----------------

export async function fetchSettings(): Promise<AppSettings> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ settings: AppSettings }>(
    `${BASE_URL}/api/settings?clientId=${encodeURIComponent(clientId)}`,
    { headers: getHeaders() }
  );
  if (data && data.settings) {
    return data.settings;
  }
  // Static Host Fallback
  const local = localHistory.getLocalSettings();
  return {
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
    ...(local || {}),
  };
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const data = await safeFetchJson<{ settings: AppSettings }>(
    `${BASE_URL}/api/settings`,
    {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ ...settings, clientId: getClientId() }),
    }
  );
  if (data && data.settings) {
    localHistory.saveLocalSettings(data.settings);
    return data.settings;
  }
  // Static Host Fallback
  localHistory.saveLocalSettings(settings);
  return (await fetchSettings());
}

// ---------------- LOGS ----------------

export async function fetchLogs(limit = 200): Promise<ActivityLog[]> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ logs: ActivityLog[] }>(
    `${BASE_URL}/api/logs?limit=${limit}&clientId=${encodeURIComponent(clientId)}`,
    { headers: getHeaders() }
  );
  if (data && Array.isArray(data.logs)) {
    return data.logs;
  }
  // Static Host Fallback
  return localHistory.getLogs().slice(-limit);
}

export async function clearLogs(): Promise<{ success: boolean }> {
  const clientId = getClientId();
  const data = await safeFetchJson<{ success: boolean }>(
    `${BASE_URL}/api/logs?clientId=${encodeURIComponent(clientId)}`,
    {
      method: 'DELETE',
      headers: getHeaders(),
    }
  );
  if (data) {
    localHistory.clearLogs();
    return data;
  }
  // Static Host Fallback
  localHistory.clearLogs();
  return { success: true };
}

export const uploadWav = uploadWavFallback;

export const api = {
  fetchJobs,
  createJobs,
  updateJob,
  deleteJob,
  reorderJobs,
  clearCompletedJobs,
  clearAllJobs,
  retryJob,
  retryAllFailed,
  getQueueStatus,
  startQueue,
  pauseQueue,
  resumeQueue,
  stopQueue,
  fetchAudioLibrary,
  deleteAudio,
  clearAllAudio,
  renameAudio,
  uploadWav: uploadWavFallback,
  uploadWavFallback,
  convertWavDirect,
  fetchSettings,
  updateSettings,
  fetchLogs,
  clearLogs,
};
