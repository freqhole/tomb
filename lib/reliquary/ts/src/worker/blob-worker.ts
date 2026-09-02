// blob worker entry - moves CPU-bound blob work (blake3 hashing, sha256
// hashing, base64 encode/decode, OPFS writes) off the main thread.
//
// architecture: comlink-exposed module. spun up lazily by
// `blob-worker-client.ts` on first use. shares no state with the main
// thread other than what's passed across postMessage (with transfer
// ownership for ArrayBuffers).
//
// kept deliberately thin: all the actual logic lives in
// `blob-worker-logic.ts`, which has no comlink/postMessage side effects
// and is what the test suite imports directly. this file is the
// worker-only glue - importing it anywhere other than as a worker script
// runs `Comlink.expose()` and posts a ready message for no reason.

import * as Comlink from "comlink";
import {
  BLOB_WORKER_READY_MESSAGE,
  base64Decode,
  base64Encode,
  generateThumbnailDataUrl,
  hashAbort,
  hashBegin,
  hashBlake3,
  hashFinish,
  hashPush,
  hashSha256,
  opfsStoreSelftest,
  opfsStoreSelftestPersistence,
  processBlobBytes,
  readBlobFromOpfs,
  resizeImageToWebpDataUrl,
  uploadAbort,
  uploadBegin,
  uploadFinish,
  uploadPush,
  writeBlobToOpfs,
} from "./blob-worker-logic.js";

const api = {
  hashBlake3,
  hashSha256,
  base64Encode,
  base64Decode,
  writeBlobToOpfs,
  readBlobFromOpfs,
  processBlobBytes,
  resizeImageToWebpDataUrl,
  generateThumbnailDataUrl,
  uploadBegin,
  uploadPush,
  uploadFinish,
  uploadAbort,
  hashBegin,
  hashPush,
  hashFinish,
  hashAbort,
  opfsStoreSelftest,
  opfsStoreSelftestPersistence,
};

export type BlobWorkerApi = typeof api;

Comlink.expose(api);

// signal readiness *after* Comlink has registered its message listener.
//
// without this, a Comlink RPC call sent right after `new Worker()` can race
// the worker's own startup (fetching + instantiating a wasm-backed midden
// module, when one is bundled, can take a couple of seconds). if the
// browser dispatches the postMessage'd call before Comlink.expose() above
// has added its "message" listener, the event fires with no listener
// attached and is silently dropped forever - the caller's promise never
// resolves. see `getBlobWorker()` in blob-worker-client.ts, which waits
// for this signal before handing out the worker proxy.
postMessage(BLOB_WORKER_READY_MESSAGE);
