// auto-download service - background download manager for queue songs
export {
  getPendingDownloadCount,
  isAutoDownloadRunning,
  pauseAutoDownload,
  resumeAutoDownload,
  updateAutoDownloadQueue,
  resumeAutoDownloadsOnInit,
  downloadAllNow,
  onAutoDownloadEnabled,
} from "./manager";

// re-export clearAllFailures from download state for callers that need it directly
export { clearAllFailures } from "../download";
