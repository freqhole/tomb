// midden-worker — hosts the whole MiddenNode (iroh endpoint, protocols,
// blob store) inside a dedicated worker, so the OPFS-backed persistent blob
// store can actually be used (FileSystemSyncAccessHandle only exists in
// dedicated workers - see docs/blob-transfer-opfs-and-sha256-refactor-plan.md
// phase 1). ported from skein's loam/src/workers/midden-worker.ts, which
// runs this exact setup in production - see that file for the fuller
// design writeup this one intentionally keeps in lockstep with.
//
// stateful wasm objects (BiStream, ImportSession, RadioHandle) never cross
// the worker boundary - they live here in id-keyed registries, and the api
// is flat functions over those ids. the main-thread wrapper classes in
// @freqhole/reliquary/worker's midden-worker-client.ts reconstruct the
// object interfaces call sites expect.

import * as Comlink from "comlink";
import { CancelToken, MiddenNode, MiddenNodeOptions } from "@freqhole/midden";
import {
  MIDDEN_WORKER_READY_MESSAGE,
  type MiddenWorkerInitOptions,
} from "@freqhole/reliquary/worker";
import { PLAYER_ALPN } from "../../cenotaph/midden/node";

let node: MiddenNode | null = null;

function requireNode(): MiddenNode {
  if (!node) throw new Error("midden-worker: node not initialized");
  return node;
}

// ---- stream registry --------------------------------------------------------

/** minimal structural view of midden's BiStream (kept local, like skein's
 *  worker, to avoid depending on generated d.ts). */
interface WasmBiStream {
  peer_node_id(): string;
  alpn(): string;
  read_message(): Promise<Uint8Array | null | undefined>;
  write_message(data: Uint8Array): Promise<void>;
  read_to_end(max_size: number): Promise<Uint8Array>;
  write_raw_and_finish(data: Uint8Array): Promise<void>;
  write_line(line: string): Promise<void>;
  read_line(): Promise<string | null | undefined>;
  close(): void;
}

interface WasmImportSession {
  push(chunk: Uint8Array): Promise<void>;
  finish(): Promise<string>;
  abort(): void;
}

/** minimal structural view of midden's RadioHandle. */
interface WasmRadioHandle {
  leave(): void;
}

export interface StreamInfo {
  streamId: number;
  peerNodeId: string;
  alpn: string;
}

const streams = new Map<number, WasmBiStream>();
let nextStreamId = 1;

const sessions = new Map<number, WasmImportSession>();
let nextSessionId = 1;

const radioHandles = new Map<number, WasmRadioHandle>();
let nextRadioHandleId = 1;

// ---- download cancel registry ------------------------------------------------

// pause/cancel for in-flight verified downloads. keyed by a caller-supplied
// download id (the client generates one per download call). the wasm call
// consumes a clone of the token; the original stays here so downloadCancel
// can flip it, and is freed when the download settles.
const cancelTokens = new Map<string, CancelToken>();

// secondary index so a caller that only knows the blake3 (not the
// per-attempt downloadId) can still cancel the transfer. usually one
// downloadId per hash, but a Set handles the same blob being fetched by
// more than one caller at once.
const downloadIdsByBlake3 = new Map<string, Set<string>>();

function registerCancelToken(downloadId: string, blake3Hash?: string): CancelToken {
  const token = new CancelToken();
  cancelTokens.set(downloadId, token);
  if (blake3Hash) {
    let ids = downloadIdsByBlake3.get(blake3Hash);
    if (!ids) {
      ids = new Set();
      downloadIdsByBlake3.set(blake3Hash, ids);
    }
    ids.add(downloadId);
  }
  return token;
}

function releaseCancelToken(downloadId: string, token: CancelToken, blake3Hash?: string): void {
  cancelTokens.delete(downloadId);
  if (blake3Hash) {
    const ids = downloadIdsByBlake3.get(blake3Hash);
    if (ids) {
      ids.delete(downloadId);
      if (ids.size === 0) downloadIdsByBlake3.delete(blake3Hash);
    }
  }
  token.free();
}

function registerStream(stream: WasmBiStream): StreamInfo {
  const streamId = nextStreamId++;
  streams.set(streamId, stream);
  return { streamId, peerNodeId: stream.peer_node_id(), alpn: stream.alpn() };
}

function requireStream(streamId: number): WasmBiStream {
  const stream = streams.get(streamId);
  if (!stream) throw new Error(`midden-worker: unknown stream ${streamId}`);
  return stream;
}

// ---- node lifecycle ----------------------------------------------------------

/** directory name for the persistent OPFS blob store. */
const OPFS_STORE_DIR = "spume-blob-store";

/** web lock name guarding single-tab ownership of the OPFS store. */
const STORE_LOCK_NAME = "spume-midden-blob-store";

/** resolves when we know whether this worker owns the store lock. the lock
 *  (when granted) is held for the worker's lifetime via a never-resolving
 *  promise - worker termination releases it automatically. */
async function acquireStoreLock(): Promise<boolean> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks) return false;
  return new Promise<boolean>((resolve) => {
    void locks
      .request(STORE_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        // hold the lock until the worker dies
        await new Promise<never>(() => {});
      })
      .catch(() => resolve(false));
  });
}

/**
 * create the MiddenNode (restoring from a persisted secret key when given).
 * returns the identity material so the main thread can cache the sync
 * getters (node_id/secret_key) and persist a fresh identity.
 *
 * blob persistence: when this worker wins the store web-lock (single-tab
 * ownership, same v1 policy as skein), the node gets the persistent
 * OPFS-backed blob store; otherwise (second tab) it degrades gracefully to
 * the in-memory store. a best-effort `navigator.storage.persist()` asks
 * the browser not to evict the origin's storage under pressure.
 */
async function init(
  secretKey: Uint8Array | null,
  options?: MiddenWorkerInitOptions
): Promise<{ nodeId: string; secretKey: Uint8Array }> {
  if (node) throw new Error("midden-worker: already initialized");

  const ownsStore = await acquireStoreLock();
  if (ownsStore) {
    // best-effort durability request; result is advisory
    void navigator.storage?.persist?.().catch(() => {});
  } else {
    console.warn(
      "[midden-worker] store lock unavailable (another tab owns it) — using in-memory blob store"
    );
  }
  const storeDir = ownsStore ? OPFS_STORE_DIR : undefined;

  const nodeOptions = new MiddenNodeOptions();
  nodeOptions.secret_key = secretKey ?? undefined;
  nodeOptions.opfs_store_dir = storeDir;
  nodeOptions.extra_alpns = [PLAYER_ALPN, ...(options?.extraAlpns ?? [])];
  if (options?.relayUrls && options.relayUrls.length > 0) {
    nodeOptions.relay_urls = options.relayUrls;
    nodeOptions.relay_custom_only = options.relayCustomOnly ?? false;
  }

  node = await MiddenNode.create_with_options(nodeOptions);
  const sk = node.secret_key();
  return { nodeId: node.node_id(), secretKey: Comlink.transfer(sk, [sk.buffer as ArrayBuffer]) };
}

// ---- streams -----------------------------------------------------------------

async function openBi(peerAddr: string, alpn: string): Promise<StreamInfo> {
  const stream = (await requireNode().open_bi(peerAddr, alpn)) as unknown as WasmBiStream;
  return registerStream(stream);
}

/** long-poll: resolves with the next accepted stream, or null when the
 *  endpoint closes. iroh-blobs connections are handled entirely inside
 *  this call already (see midden's own `accept()` doc comment) - do NOT
 *  also call the wasm node's `start_blob_server()` alongside this, the two
 *  compete for the same incoming connections. */
async function accept(): Promise<StreamInfo | null> {
  const stream = (await requireNode().accept()) as unknown as WasmBiStream | null;
  if (!stream) return null;
  return registerStream(stream);
}

async function streamReadMessage(streamId: number): Promise<Uint8Array | null> {
  const result = await requireStream(streamId).read_message();
  if (result === null || result === undefined) return null;
  return Comlink.transfer(result, [result.buffer as ArrayBuffer]);
}

async function streamWriteMessage(streamId: number, bytes: Uint8Array): Promise<void> {
  await requireStream(streamId).write_message(bytes);
}

async function streamReadToEnd(streamId: number, maxSize: number): Promise<Uint8Array> {
  const result = await requireStream(streamId).read_to_end(maxSize);
  return Comlink.transfer(result, [result.buffer as ArrayBuffer]);
}

async function streamWriteRawAndFinish(streamId: number, bytes: Uint8Array): Promise<void> {
  await requireStream(streamId).write_raw_and_finish(bytes);
}

/** newline-delimited framing (ndjson) - used by the freqhole-events/1
 *  protocol, a separate mode from write_message/read_message's
 *  length-prefixed framing over the same underlying send/recv halves. */
async function streamWriteLine(streamId: number, line: string): Promise<void> {
  await requireStream(streamId).write_line(line);
}

async function streamReadLine(streamId: number): Promise<string | null> {
  const result = await requireStream(streamId).read_line();
  return result ?? null;
}

function streamClose(streamId: number): void {
  const stream = streams.get(streamId);
  if (!stream) return; // already closed/dead — close is idempotent
  streams.delete(streamId);
  try {
    stream.close();
  } catch {
    // stream already dead
  }
}

// ---- blob store ---------------------------------------------------------------

async function importBlob(data: Uint8Array): Promise<string> {
  return requireNode().import_blob(data);
}

async function importBlobAndExportBao(
  data: Uint8Array
): Promise<{ hash: string; bao: Uint8Array }> {
  const result = await requireNode().import_blob_and_export_bao(data);
  const bao = result.bao as Uint8Array;
  return Comlink.transfer({ hash: result.hash as string, bao }, [bao.buffer as ArrayBuffer]);
}

async function importBao(blake3Hash: string, baoData: Uint8Array): Promise<string> {
  return requireNode().import_bao(blake3Hash, baoData);
}

function hasActiveBlob(blake3Hash: string): boolean {
  return requireNode().has_active_blob(blake3Hash);
}

async function hasCompleteBlob(blake3Hash: string): Promise<boolean> {
  return (
    requireNode() as unknown as { has_complete_blob(h: string): Promise<boolean> }
  ).has_complete_blob(blake3Hash);
}

function releaseBlob(blake3Hash: string): void {
  requireNode().release_blob(blake3Hash);
}

function restrictBlobToPeers(blake3Hash: string, peerNodeIds: string[]): void {
  requireNode().restrict_blob_to_peers(blake3Hash, peerNodeIds);
}

function clearBlobRestriction(blake3Hash: string): void {
  requireNode().clear_blob_restriction(blake3Hash);
}

function getActiveTransfers(): unknown[] {
  return (requireNode() as unknown as { get_active_transfers(): unknown[] }).get_active_transfers();
}

// ---- chunked import sessions ---------------------------------------------------

function startImport(): number {
  const session = requireNode().start_import() as unknown as WasmImportSession;
  const sessionId = nextSessionId++;
  sessions.set(sessionId, session);
  return sessionId;
}

async function importPush(sessionId: number, chunk: Uint8Array): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`midden-worker: unknown import session ${sessionId}`);
  await session.push(chunk);
}

async function importFinish(sessionId: number): Promise<string> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`midden-worker: unknown import session ${sessionId}`);
  sessions.delete(sessionId);
  return session.finish();
}

function importAbort(sessionId: number): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  try {
    session.abort();
  } catch {
    // already finished
  }
}

// ---- downloads ------------------------------------------------------------------
// callback args arrive as comlink proxies (async functions). the wasm side
// calls them fire-and-forget, which is exactly the semantic proxies give.

async function ensureBlob(peerAddr: string, blake3Hash: string): Promise<boolean> {
  return requireNode().ensure_blob(peerAddr, blake3Hash);
}

async function downloadVerifiedWithEnsure(
  peerAddr: string,
  blake3Hash: string
): Promise<Uint8Array> {
  const result = await requireNode().download_verified_with_ensure(peerAddr, blake3Hash);
  return Comlink.transfer(result, [result.buffer as ArrayBuffer]);
}

/** pulls a blob directly into this node's own OPFS-backed store, never
 * returning bytes to JS at all - see `download_verified_to_store_with_
 * ensure`'s doc comment in lib/midden/src/lib.rs.
 * use this instead of `downloadVerifiedWithEnsure` whenever the
 * caller only needs the blob to become locally servable. */
async function downloadVerifiedToStoreWithEnsure(
  peerAddr: string,
  blake3Hash: string
): Promise<void> {
  return requireNode().download_verified_to_store_with_ensure(peerAddr, blake3Hash);
}

async function downloadVerifiedWithEnsureProgress(
  peerAddr: string,
  blake3Hash: string,
  totalSize: number,
  onProgress: (fraction: number) => void,
  downloadId?: string
): Promise<Uint8Array> {
  const token = downloadId ? registerCancelToken(downloadId, blake3Hash) : null;
  try {
    const result = await requireNode().download_verified_with_ensure_progress(
      peerAddr,
      blake3Hash,
      totalSize,
      onProgress,
      token ? token.clone_token() : undefined
    );
    return Comlink.transfer(result, [result.buffer as ArrayBuffer]);
  } finally {
    if (downloadId && token) releaseCancelToken(downloadId, token, blake3Hash);
  }
}

async function downloadVerifiedById(
  peerAddr: string,
  blobId: string
): Promise<[Uint8Array, string]> {
  const result = await requireNode().download_verified_by_id(peerAddr, blobId);
  const bytes = result[0] as Uint8Array;
  return Comlink.transfer([bytes, result[1] as string], [bytes.buffer as ArrayBuffer]);
}

async function downloadVerifiedByIdProgress(
  peerAddr: string,
  blobId: string,
  totalSize: number,
  onProgress: (fraction: number) => void
): Promise<[Uint8Array, string]> {
  const result = await requireNode().download_verified_by_id_progress(
    peerAddr,
    blobId,
    totalSize,
    onProgress
  );
  const bytes = result[0] as Uint8Array;
  return Comlink.transfer([bytes, result[1] as string], [bytes.buffer as ArrayBuffer]);
}

async function downloadVerifiedStreamingWithEnsure(
  peerAddr: string,
  blake3Hash: string,
  totalSize: number,
  onChunk: (chunk: Uint8Array, offset: number) => void,
  onProgress: (fraction: number) => void,
  downloadId?: string
): Promise<number> {
  const token = downloadId ? registerCancelToken(downloadId, blake3Hash) : null;
  try {
    return await requireNode().download_verified_streaming_with_ensure(
      peerAddr,
      blake3Hash,
      totalSize,
      onChunk,
      onProgress,
      token ? token.clone_token() : undefined
    );
  } finally {
    if (downloadId && token) releaseCancelToken(downloadId, token, blake3Hash);
  }
}

/** flip the cancel token for an in-flight download (pause). no-op when the
 *  download already settled. the partial stays in the (persistent) store and
 *  the wasm side pins the hash against gc until resumed or unprotected. */
function downloadCancel(downloadId: string): boolean {
  const token = cancelTokens.get(downloadId);
  if (!token) return false;
  token.cancel();
  return true;
}

/** cancel every in-flight download currently transferring this blake3 hash
 *  (normally at most one, but a shared blob can have more than one caller
 *  downloading it at once). returns how many were flagged — 0 means none
 *  were in flight. */
function downloadCancelByBlake3(blake3Hash: string): number {
  const ids = downloadIdsByBlake3.get(blake3Hash);
  if (!ids || ids.size === 0) return 0;
  let count = 0;
  for (const id of [...ids]) {
    if (downloadCancel(id)) count++;
  }
  return count;
}

/** pin a hash against gc (e.g. keep a paused partial alive). */
function protectBlob(blake3Hash: string): void {
  requireNode().protect_blob(blake3Hash);
}

/** remove a gc pin (paused partial resumed to completion or discarded). */
function unprotectBlob(blake3Hash: string): void {
  requireNode().unprotect_blob(blake3Hash);
}

async function computeBlake3(peerAddr: string, blobId: string): Promise<string | null> {
  const result = await requireNode().compute_blake3(peerAddr, blobId);
  return result ?? null;
}

// ---- api requests -----------------------------------------------------------
// exposed as `proxyRequest` to match @freqhole/reliquary/worker's
// MiddenWorkerApi contract, which this worker implements the receiving end
// of (the underlying wasm method is still named `api_request` - see
// midden/src/lib.rs).

async function proxyRequest(
  peerAddr: string,
  method: string,
  path: string,
  body: string | null
): Promise<{ status: number; body: string }> {
  return (await requireNode().api_request(peerAddr, method, path, body)) as {
    status: number;
    body: string;
  };
}

// ---- admin/radio (spume-specific — not needed by skein's own worker) --------

async function proxyAdmin(peerAddr: string, command: string, args: string): Promise<unknown> {
  return requireNode().proxy_admin(peerAddr, command, args);
}

async function tuneRadio(
  peerAddr: string,
  stationId: string | undefined,
  onHello: (json: string) => void,
  onMeta: (json: string) => void,
  onChunk: (seq: number, isInit: boolean, bytes: Uint8Array) => void
): Promise<number> {
  const handle = (await requireNode().tune_radio(
    peerAddr,
    stationId,
    onHello,
    onMeta,
    onChunk
  )) as unknown as WasmRadioHandle;
  const handleId = nextRadioHandleId++;
  radioHandles.set(handleId, handle);
  return handleId;
}

function radioLeave(handleId: number): void {
  const handle = radioHandles.get(handleId);
  if (!handle) return; // already left/dead — idempotent
  radioHandles.delete(handleId);
  try {
    handle.leave();
  } catch {
    // connection already dead
  }
}

const api = {
  init,
  openBi,
  accept,
  streamReadMessage,
  streamWriteMessage,
  streamReadToEnd,
  streamWriteRawAndFinish,
  streamWriteLine,
  streamReadLine,
  streamClose,
  importBlob,
  importBlobAndExportBao,
  importBao,
  hasActiveBlob,
  hasCompleteBlob,
  releaseBlob,
  restrictBlobToPeers,
  clearBlobRestriction,
  getActiveTransfers,
  startImport,
  importPush,
  importFinish,
  importAbort,
  ensureBlob,
  downloadVerifiedWithEnsure,
  downloadVerifiedToStoreWithEnsure,
  downloadVerifiedWithEnsureProgress,
  downloadVerifiedById,
  downloadVerifiedByIdProgress,
  downloadVerifiedStreamingWithEnsure,
  downloadCancel,
  downloadCancelByBlake3,
  protectBlob,
  unprotectBlob,
  computeBlake3,
  proxyRequest,
  proxyAdmin,
  tuneRadio,
  radioLeave,
};

export type MiddenWorkerApi = typeof api;

Comlink.expose(api);

// ready signal AFTER Comlink registered its message listener — an RPC
// posted before the listener exists is dropped forever. the exact literal
// matters: it must match what @freqhole/reliquary/worker's WorkerMiddenNode
// client waits for.
postMessage(MIDDEN_WORKER_READY_MESSAGE);
