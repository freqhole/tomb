// music import module - local and remote import services
export {
  extractMetadata,
  processMusicFile,
  processMusicFiles,
  type AudioMetadata,
} from "./fileProcessor";
export {
  clearLocalImportProgress,
  getLocalImportProgress,
  importMusicFiles,
  type ImportResult,
  type LocalImportPhase,
  type LocalImportProgress,
} from "./localImport";
export {
  clearAllJobs,
  clearCompletedJobs,
  fetchUrlsOnRemote,
  getUploadJobs,
  uploadFilesToRemote,
  uploadPathsToRemote,
  type RemoteUploadResult,
  type UploadJob,
  type UploadJobStatus,
  type UploadJobType,
} from "./remoteImport";
