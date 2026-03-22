// auto-download service - background download manager for queue songs
export {
  getPendingDownloadCount,
  isAutoDownloadRunning,
  pauseAutoDownload,
  resumeAutoDownload,
  updateAutoDownloadQueue,
  resumeAutoDownloadsOnInit,
  downloadAllNow,
  clearFailedDownloads,
  onAutoDownloadEnabled,
} from "./manager";
