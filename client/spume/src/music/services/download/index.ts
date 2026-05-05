// download services
export {
  // synced state
  isSongSyncedLocally,
  markSongSynced,
  unmarkSongSynced,
  loadSyncedSha256s,
  clearSyncedSha256s,

  // ephemeral-on-disk (rodio + sync_queue_to_local=off)
  isSongOnDiskEphemeral,
  markEphemeralOnDisk,
  unmarkEphemeralOnDisk,
  clearEphemeralOnDisk,
  setEphemeralOnDiskBlake3s,
  
  // loading/progress
  getLoadingSongIds,
  isLoading,
  getLoadingProgress,
  getAllLoadingProgress,
  addToLoadingSet,
  updateLoadingProgress,
  removeFromLoadingSet,
  
  // in-progress tracking
  isDownloadInProgress,
  getInProgressDownload,
  registerDownload,
  canStartDownload,
  getActiveDownloadCount,
  
  // failed downloads
  hasFailedPermanently,
  markDownloadFailed,
  getRetryCount,
  clearFailure,
  clearAllFailures,
  MAX_RETRY_ATTEMPTS,
  
  // pause/resume
  isDownloadsPaused,
  pauseDownloads,
  resumeDownloads,
  
  // initialization
  initDownloadState,
} from "./downloadState";
