// documented comlink message-shape contract between a midden worker entry
// and this package's main-thread client facade (`midden-worker-client.ts`).
//
// the entry itself - the module that owns the iroh endpoint, the blob
// store, the web-lock guarding single-tab OPFS ownership, and boot/identity
// wiring - is not part of this package. it stays with whichever app hosts
// it, since its lifecycle is entangled with that app's own identity/boot
// flow. this file is the seam: it pins down every method name, argument
// shape, and transfer-ownership rule the entry and the client must agree
// on, so the two can be developed independently as long as both sides
// keep implementing this exact interface.
//
// stream/session state (BiStream, ImportSession) never crosses the
// comlink boundary as objects - the entry holds them in id-keyed
// registries and exposes flat functions over those ids; the client's
// `WorkerBiStream` / `WorkerImportSession` classes reconstruct the
// stateful object interfaces callers expect.
//
// any change to this file must be made in lockstep with the entry-side
// implementation - there is no runtime version negotiation.

/** identifies a stream registered on the entry side; opaque to the client
 *  beyond routing subsequent read/write/close calls back to it. */
export interface StreamInfo {
  streamId: number;
  peerNodeId: string;
  alpn: string;
}

/** result of `init`: the node's identity, cached on the client so the
 *  sync `node_id()`/`secret_key()` getters don't need a round trip. */
export interface MiddenWorkerIdentity {
  nodeId: string;
  secretKey: Uint8Array;
}

/** one outgoing blob transfer in flight on the worker-hosted node - same
 *  shape as a raw wasm MiddenNode's `get_active_transfers()`
 *  (`{peerId, blake3, bytesSent, totalSize}`, see midden/src/transfers.rs). */
export interface WorkerActiveTransfer {
  peerId: string;
  blake3: string;
  bytesSent: number;
  totalSize: number;
}

/**
 * the entry's comlink-exposed surface. every method here runs on the
 * worker thread; callback arguments (`onProgress`, `onChunk`) arrive as
 * comlink proxies and are invoked fire-and-forget from the entry side.
 *
 * transfer discipline: Uint8Array/ArrayBuffer arguments and return values
 * are expected to travel as transferables (see `Comlink.transfer`) rather
 * than structured-cloned copies wherever the sender doesn't need to reuse
 * the buffer afterwards - the client's `toTransferable` helper enforces
 * this on the way in.
 */
export interface MiddenWorkerApi {
  /** create the node (restoring from a persisted secret key when given). */
  init(secretKey: Uint8Array | null): Promise<MiddenWorkerIdentity>;

  // ---- streams ----
  openBi(peerAddr: string, alpn: string): Promise<StreamInfo>;
  /** long-poll: resolves with the next accepted stream, or null when the
   *  endpoint closes. */
  accept(): Promise<StreamInfo | null>;
  streamReadMessage(streamId: number): Promise<Uint8Array | null>;
  streamWriteMessage(streamId: number, data: Uint8Array): Promise<void>;
  streamReadToEnd(streamId: number, maxSize: number): Promise<Uint8Array>;
  streamWriteRawAndFinish(streamId: number, data: Uint8Array): Promise<void>;
  /** idempotent - closing an already-closed/dead stream id is a no-op. */
  streamClose(streamId: number): Promise<void>;

  // ---- blob store ----
  importBlob(data: Uint8Array): Promise<string>;
  importBlobAndExportBao(data: Uint8Array): Promise<{ hash: string; bao: Uint8Array }>;
  importBao(blake3Hash: string, baoData: Uint8Array): Promise<string>;
  hasActiveBlob(blake3Hash: string): Promise<boolean>;
  /** true when a COMPLETE blob with this hash exists in the blob store
   *  itself - with a persistent store this survives reloads even without
   *  an active temp-tag. */
  hasCompleteBlob(blake3Hash: string): Promise<boolean>;
  releaseBlob(blake3Hash: string): Promise<void>;
  restrictBlobToPeers(blake3Hash: string, peerNodeIds: string[]): Promise<void>;
  clearBlobRestriction(blake3Hash: string): Promise<void>;
  /** snapshot of this node's own outgoing blob transfers currently in
   *  flight - forwards to the wasm node's `get_active_transfers()`. */
  getActiveTransfers(): Promise<WorkerActiveTransfer[]>;

  // ---- chunked import sessions ----
  startImport(): Promise<number>;
  importPush(sessionId: number, chunk: Uint8Array): Promise<void>;
  importFinish(sessionId: number): Promise<string>;
  importAbort(sessionId: number): Promise<void>;

  // ---- downloads ----
  ensureBlob(peerAddr: string, blake3Hash: string): Promise<boolean>;
  downloadVerifiedWithEnsure(peerAddr: string, blake3Hash: string): Promise<Uint8Array>;
  downloadVerifiedWithEnsureProgress(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<Uint8Array>;
  downloadVerifiedById(peerAddr: string, blobId: string): Promise<[Uint8Array, string]>;
  downloadVerifiedByIdProgress(
    peerAddr: string,
    blobId: string,
    totalSize: number,
    onProgress: (fraction: number) => void
  ): Promise<[Uint8Array, string]>;
  downloadVerifiedStreamingWithEnsure(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onChunk: (chunk: Uint8Array, offset: number) => void,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<number>;
  /** pause/cancel an in-flight download by the id passed to the download
   *  call. returns false when the download already settled. the partial
   *  stays in the store, pinned against gc - a later download of the same
   *  hash resumes from the persisted bitfield. */
  downloadCancel(downloadId: string): Promise<boolean>;
  /** pause/cancel every in-flight download for this blake3 hash, without
   *  needing the per-attempt downloadId (e.g. cleaning up after a caller
   *  that no longer has its own download state). returns how many were
   *  flagged - 0 means none were in flight. */
  downloadCancelByBlake3(blake3Hash: string): Promise<number>;
  /** pin a hash against gc (keep a paused partial download alive). */
  protectBlob(blake3Hash: string): Promise<void>;
  /** remove a gc pin added by protectBlob or a cancelled download. */
  unprotectBlob(blake3Hash: string): Promise<void>;
  computeBlake3(peerAddr: string, blobId: string): Promise<string | null>;

  // ---- proxy requests ----
  proxyRequest(
    peerAddr: string,
    method: string,
    path: string,
    body: string | null
  ): Promise<{ status: number; body: string }>;
}

/** message the entry must `postMessage` immediately after `Comlink.expose()`
 *  registers its message listener - and not a moment before. an rpc call
 *  sent before that listener exists fires with nothing attached and is
 *  dropped forever, so the client waits for this exact literal before
 *  handing out its comlink proxy. */
export const MIDDEN_WORKER_READY_MESSAGE = "midden-worker-ready";

/** how long the client waits for `MIDDEN_WORKER_READY_MESSAGE` before
 *  giving up. generous: the entry's top level typically awaits a large
 *  wasm module's instantiation before it can register that listener. */
export const MIDDEN_WORKER_READY_TIMEOUT_MS = 20_000;
