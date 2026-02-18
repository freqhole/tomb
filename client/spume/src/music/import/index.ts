// music import module - local and remote import services
export { importMusicFiles, type ImportResult } from "./localImport";
export {
  uploadFilesToRemote,
  fetchUrlsOnRemote,
  getUploadJobs,
  clearCompletedJobs,
  clearAllJobs,
  type RemoteUploadResult,
  type UploadJob,
  type UploadJobStatus,
  type UploadJobType,
} from "./remoteImport";
export { extractMetadata, processMusicFile, processMusicFiles, type AudioMetadata } from "./fileProcessor";
