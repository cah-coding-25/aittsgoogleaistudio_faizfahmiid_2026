/**
 * Client Workspace Manager
 * Guarantees complete data and settings isolation between different PCs/browsers,
 * even when sharing the same deployed website domain.
 */

const CLIENT_ID_KEY = 'ai_tts_client_workspace_id_v1';
const CLIENT_NAME_KEY = 'ai_tts_client_workspace_name_v1';

export interface WorkspaceBackupData {
  version: number;
  clientId: string;
  clientName: string;
  exportedAt: string;
  jobs: any[];
  audioItems: any[];
  settings: any;
  logs: any[];
}

export function generateRandomId(prefix = 'pc_ws_'): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${rand}`;
}

export function getClientId(): string {
  if (typeof window === 'undefined') return 'default';
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || id.trim() === '') {
      id = generateRandomId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch (e) {
    return 'default';
  }
}

export function getClientName(): string {
  if (typeof window === 'undefined') return 'PC Lokal';
  try {
    const name = localStorage.getItem(CLIENT_NAME_KEY);
    if (name && name.trim()) {
      return name.trim();
    }
    const id = getClientId();
    const short = id.replace(/^pc_ws_/, '').toUpperCase();
    return `PC-${short || 'LOKAL'}`;
  } catch (e) {
    return 'PC Lokal';
  }
}

export function setClientName(name: string): string {
  const clean = name.trim() || getClientName();
  try {
    localStorage.setItem(CLIENT_NAME_KEY, clean);
  } catch {}
  return clean;
}

export function resetWorkspace(): string {
  const newId = generateRandomId();
  try {
    localStorage.setItem(CLIENT_ID_KEY, newId);
    const short = newId.replace(/^pc_ws_/, '').toUpperCase();
    localStorage.setItem(CLIENT_NAME_KEY, `PC-${short}`);
  } catch {}
  return newId;
}

export function exportWorkspaceBackup(data: {
  jobs: any[];
  audioItems: any[];
  settings: any;
  logs: any[];
}): void {
  const backup: WorkspaceBackupData = {
    version: 1,
    clientId: getClientId(),
    clientName: getClientName(),
    exportedAt: new Date().toISOString(),
    jobs: data.jobs,
    audioItems: data.audioItems,
    settings: data.settings,
    logs: data.logs,
  };

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `AI_TTS_Backup_${getClientName().replace(/\s+/g, '_')}_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
