/**
 * Layanan Sinkronisasi Folder Lokal Ketat (folderSyncService)
 * Re-exports strict folder validation, IndexedDB directory handle persistence,
 * and real-time audio folder watcher utilities.
 */
export {
  folderSyncService,
  localFolderSync,
  validateAudioFileStrict,
  validateRiffWaveBuffer,
  isBlockedFilename,
  getFileExtensionLower,
} from './localFolderSync';

export type {
  StorageLocationType,
  StrictAudioValidationResult,
  ValidLocalAudioEntry,
  FolderSyncScanSummary,
  FolderSyncState,
} from './localFolderSync';
