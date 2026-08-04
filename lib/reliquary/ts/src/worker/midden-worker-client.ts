// midden-worker-client - main-thread wrapper around a midden worker entry.
//
// see `midden-worker-contract.ts` for the full comlink message-shape
// contract this file codes against. the entry itself lives with whichever
// app hosts it (its lifecycle is entangled with that app's own boot and
// identity wiring) - this facade only knows how to talk to it once it's
// running, so the caller of `WorkerMiddenNode.create()` supplies a factory
// that constructs the entry's Worker instance.
//
// `WorkerMiddenNode` implements the same snake_case surface as a wasm
// MiddenNode (MiddenNodeLike / MiddenStreamNode), and `WorkerBiStream` /
// `WorkerImportSession` reconstruct the stateful objects over the entry's
// flat id-keyed api. call sites - network adapters, protocol handlers,
// transfer/blob glue, test bridges - keep working unchanged, except for
// the documented sync->async flips (`has_active_blob`).

import * as Comlink from "comlink";
import {
  MIDDEN_WORKER_READY_MESSAGE,
  MIDDEN_WORKER_READY_TIMEOUT_MS,
  type MiddenWorkerApi,
  type StreamInfo,
  type WorkerActiveTransfer,
} from "./midden-worker-contract.js";
import { log } from "../utils/log.js";

const TAG = "midden.worker";

type Api = Comlink.Remote<MiddenWorkerApi>;

/** copy a view to an exact-length buffer and mark it for transfer. the
 *  copy is required for correctness, not just safety: transferring the
 *  caller's own buffer would detach it (callers legitimately reuse their
 *  buffers after a send), and a bare structured clone of a subarray view
 *  would clone the ENTIRE underlying buffer, not just the view. one exact
 *  copy + zero-copy transfer is the cheapest correct option. */
function toTransferable(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  return Comlink.transfer(copy, [copy.buffer as ArrayBuffer]);
}

/** main-thread face of a worker-held BiStream. implements BiStreamLike. */
export class WorkerBiStream {
  constructor(
    private readonly api: Api,
    private readonly info: StreamInfo
  ) {}

  peer_node_id(): string {
    return this.info.peerNodeId;
  }

  alpn(): string {
    return this.info.alpn;
  }

  async read_message(): Promise<Uint8Array | null> {
    return this.api.streamReadMessage(this.info.streamId);
  }

  async write_message(data: Uint8Array): Promise<void> {
    await this.api.streamWriteMessage(this.info.streamId, toTransferable(data));
  }

  async read_to_end(maxSize: number): Promise<Uint8Array> {
    return this.api.streamReadToEnd(this.info.streamId, maxSize);
  }

  async write_raw_and_finish(data: Uint8Array): Promise<void> {
    await this.api.streamWriteRawAndFinish(this.info.streamId, toTransferable(data));
  }

  /** fire-and-forget, matching a wasm BiStream's sync close(). */
  close(): void {
    this.api.streamClose(this.info.streamId).catch(() => {
      // worker gone - nothing to close
    });
  }
}

/** main-thread face of a worker-held ImportSession. `start_import()` stays
 *  synchronous (like a wasm ImportSession) by resolving the session id
 *  lazily. */
export class WorkerImportSession {
  private readonly sessionId: Promise<number>;

  constructor(private readonly api: Api) {
    this.sessionId = api.startImport();
  }

  async push(chunk: Uint8Array): Promise<void> {
    const id = await this.sessionId;
    await this.api.importPush(id, toTransferable(chunk));
  }

  async finish(): Promise<string> {
    const id = await this.sessionId;
    return this.api.importFinish(id);
  }

  abort(): void {
    void this.sessionId.then((id) => this.api.importAbort(id)).catch(() => {});
  }
}

/**
 * constructs (or otherwise obtains) the Worker instance hosting the midden
 * worker entry. this package doesn't own that entry file (see
 * `midden-worker-contract.ts`), so it can't spawn it via a relative
 * `new Worker(new URL(...))` the way this subpath's own blob worker does -
 * the embedding app supplies this, typically:
 *
 * ```ts
 * const node = await WorkerMiddenNode.create(secretKey, () =>
 *   new Worker(new URL("./midden-worker.js", import.meta.url), { type: "module" })
 * );
 * ```
 */
export type CreateMiddenWorker = () => Worker;

/**
 * main-thread face of a worker-hosted MiddenNode. same snake_case method
 * names as a wasm node so existing call sites and capability probes
 * (`typeof node.method === "function"`) keep working.
 *
 * sync->async flips vs a wasm node (call sites must be audited/adjusted):
 * - has_active_blob returns a Promise<boolean> (must be awaited)
 * - release_blob / restrict_blob_to_peers / clear_blob_restriction return
 *   promises that fire-and-forget callers may ignore
 */
export class WorkerMiddenNode {
  private constructor(
    private readonly api: Api,
    private readonly worker: Worker,
    private readonly nodeId: string,
    private readonly secretKey: Uint8Array
  ) {}

  /** spawn the worker (via `createWorker`), wait for the ready handshake,
   *  create the node. */
  static async create(
    secretKey: Uint8Array | null,
    createWorker: CreateMiddenWorker
  ): Promise<WorkerMiddenNode> {
    const worker = createWorker();

    const ready = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        log.warn(TAG, `worker did not signal ready within ${MIDDEN_WORKER_READY_TIMEOUT_MS}ms`);
        resolve(false);
      }, MIDDEN_WORKER_READY_TIMEOUT_MS);
      const onMessage = (e: MessageEvent): void => {
        if (e.data !== MIDDEN_WORKER_READY_MESSAGE) return;
        clearTimeout(timeout);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("message", onMessage);
        resolve(true);
      };
      // a worker script that fails to load (network error, blocked by a dev
      // server's file-serving restrictions, syntax error, etc.) fires an
      // `error` event, never a `message` - without this listener the promise
      // above would otherwise sit unresolved for the full ready-timeout with
      // no indication anything went wrong.
      const onError = (e: ErrorEvent): void => {
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        log.warn(TAG, "worker failed to load:", e.message || e);
        resolve(false);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
    });

    if (!ready) {
      worker.terminate();
      throw new Error("midden worker did not become ready in time");
    }

    const api = Comlink.wrap<MiddenWorkerApi>(worker);
    try {
      const identity = await api.init(secretKey);
      log.debug(TAG, "worker node ready:", identity.nodeId.slice(0, 16) + "...");
      return new WorkerMiddenNode(api, worker, identity.nodeId, identity.secretKey);
    } catch (err) {
      worker.terminate();
      throw err;
    }
  }

  /** tear the worker down (identity delete/import). in-flight calls reject. */
  terminate(): void {
    this.worker.terminate();
  }

  // ---- identity (sync, cached at init) ----

  node_id(): string {
    return this.nodeId;
  }

  secret_key(): Uint8Array {
    return this.secretKey;
  }

  // ---- streams ----

  async open_bi(peerAddr: string, alpn: string): Promise<WorkerBiStream> {
    return new WorkerBiStream(this.api, await this.api.openBi(peerAddr, alpn));
  }

  async accept(): Promise<WorkerBiStream | null> {
    const info = await this.api.accept();
    if (!info) return null;
    return new WorkerBiStream(this.api, info);
  }

  // ---- blob store ----

  async import_blob(data: Uint8Array): Promise<string> {
    return this.api.importBlob(toTransferable(data));
  }

  async import_blob_and_export_bao(data: Uint8Array): Promise<{ hash: string; bao: Uint8Array }> {
    return this.api.importBlobAndExportBao(toTransferable(data));
  }

  async import_bao(blake3Hash: string, baoData: Uint8Array): Promise<string> {
    return this.api.importBao(blake3Hash, toTransferable(baoData));
  }

  /** NOTE: async here (sync on a wasm node) - callers must await. */
  has_active_blob(blake3Hash: string): Promise<boolean> {
    return this.api.hasActiveBlob(blake3Hash);
  }

  has_complete_blob(blake3Hash: string): Promise<boolean> {
    return this.api.hasCompleteBlob(blake3Hash);
  }

  release_blob(blake3Hash: string): Promise<void> {
    return this.api.releaseBlob(blake3Hash);
  }

  restrict_blob_to_peers(blake3Hash: string, peerNodeIds: string[]): Promise<void> {
    return this.api.restrictBlobToPeers(blake3Hash, peerNodeIds);
  }

  clear_blob_restriction(blake3Hash: string): Promise<void> {
    return this.api.clearBlobRestriction(blake3Hash);
  }

  /** snapshot of this node's own outgoing blob transfers currently in
   *  flight - see `MiddenNode::get_active_transfers` in `midden/src/lib.rs`. */
  get_active_transfers(): Promise<WorkerActiveTransfer[]> {
    return this.api.getActiveTransfers();
  }

  start_import(): WorkerImportSession {
    return new WorkerImportSession(this.api);
  }

  // ---- downloads ----

  async ensure_blob(peerAddr: string, blake3Hash: string): Promise<boolean> {
    return this.api.ensureBlob(peerAddr, blake3Hash);
  }

  async download_verified_with_ensure(peerAddr: string, blake3Hash: string): Promise<Uint8Array> {
    return this.api.downloadVerifiedWithEnsure(peerAddr, blake3Hash);
  }

  async download_verified_with_ensure_progress(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<Uint8Array> {
    return this.api.downloadVerifiedWithEnsureProgress(
      peerAddr,
      blake3Hash,
      totalSize,
      Comlink.proxy(onProgress),
      downloadId
    );
  }

  async download_verified_by_id(peerAddr: string, blobId: string): Promise<[Uint8Array, string]> {
    return this.api.downloadVerifiedById(peerAddr, blobId);
  }

  async download_verified_by_id_progress(
    peerAddr: string,
    blobId: string,
    totalSize: number,
    onProgress: (fraction: number) => void
  ): Promise<[Uint8Array, string]> {
    return this.api.downloadVerifiedByIdProgress(
      peerAddr,
      blobId,
      totalSize,
      Comlink.proxy(onProgress)
    );
  }

  async download_verified_streaming_with_ensure(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onChunk: (chunk: Uint8Array, offset: number) => void,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<number> {
    return this.api.downloadVerifiedStreamingWithEnsure(
      peerAddr,
      blake3Hash,
      totalSize,
      Comlink.proxy(onChunk),
      Comlink.proxy(onProgress),
      downloadId
    );
  }

  /** pause/cancel an in-flight download by the id passed to the download
   *  call. returns false when the download already settled. the partial
   *  stays in the persistent store, pinned against gc - a later download
   *  of the same hash resumes from the persisted bitfield. */
  async download_cancel(downloadId: string): Promise<boolean> {
    return this.api.downloadCancel(downloadId);
  }

  /** pause/cancel every in-flight download for this blake3 hash, without
   *  needing the per-attempt downloadId. returns how many were flagged. */
  async download_cancel_by_blake3(blake3Hash: string): Promise<number> {
    return this.api.downloadCancelByBlake3(blake3Hash);
  }

  /** pin a hash against gc (keep a paused partial alive). */
  async protect_blob(blake3Hash: string): Promise<void> {
    return this.api.protectBlob(blake3Hash);
  }

  /** remove a gc pin added by protect_blob or a cancelled download. */
  async unprotect_blob(blake3Hash: string): Promise<void> {
    return this.api.unprotectBlob(blake3Hash);
  }

  async compute_blake3(peerAddr: string, blobId: string): Promise<string | null> {
    return this.api.computeBlake3(peerAddr, blobId);
  }

  // ---- proxy requests ----

  async proxy_request(
    peerAddr: string,
    method: string,
    path: string,
    body?: string | null
  ): Promise<{ status: number; body: string }> {
    return this.api.proxyRequest(peerAddr, method, path, body ?? null);
  }
}
