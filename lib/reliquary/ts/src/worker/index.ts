export type { ProcessedBlob, ResizeImageOptions } from "./blob-worker-logic.js";
export { BLOB_WORKER_READY_MESSAGE, OPFS_DIR as BLOB_OPFS_DIR } from "./blob-worker-logic.js";

export type { BlobWorkerApi } from "./blob-worker.js";

export {
  getBlobWorker,
  shutdownBlobWorker,
  hashBlake3,
  hashBlake3Streaming,
  hashSha256,
  base64Encode,
  base64Decode,
  processBlobBytes,
  writeBlobToOpfs,
  streamFileToOpfs,
  resizeImageToWebpDataUrl,
  generateThumbnailDataUrl,
} from "./blob-worker-client.js";

export type { MiddenWorkerApi, MiddenWorkerIdentity, StreamInfo } from "./midden-worker-contract.js";
export {
  MIDDEN_WORKER_READY_MESSAGE,
  MIDDEN_WORKER_READY_TIMEOUT_MS,
} from "./midden-worker-contract.js";

export type { CreateMiddenWorker } from "./midden-worker-client.js";
export { WorkerBiStream, WorkerImportSession, WorkerMiddenNode } from "./midden-worker-client.js";

export { MiddenNode } from "./midden-stub.js";

export type { Blake3HasherLike, MiddenBlake3Module } from "./midden-blake3.js";
export { loadMiddenBlake3, resetMiddenBlake3Cache } from "./midden-blake3.js";
