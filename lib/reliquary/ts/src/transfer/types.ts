// shared shapes for ./transfer: the structural transport surface this
// subpath needs from a midden-shaped node, plus the request/result types
// for snatch (peer -> local) and serve (local -> peer) flows.
//
// this subpath never imports midden at runtime - only structural types
// matching its snake_case surface, so any BlobCapableNode-shaped object
// (a real wasm node, a worker-backed facade, a test double) works the
// same way. every method is optional: a caller's node may implement only
// a subset (a lean transport, a peer reachable only via app-level rpc),
// and each snatch strategy degrades to the next when its required method
// is missing OR when it fails against a given peer (a peer whose backend
// only accepts an app-level rpc alpn makes the verified strategies fail
// even though the local node has the methods) - only a cancelled error
// stops the fallthrough.

/** structural transport surface this subpath needs from a node. */
export interface BlobCapableNode {
  node_id(): string;

  /** bulk verified download of a known blake3 hash, with progress. the
   *  peer is asked to ensure the blob is staged before the transfer
   *  starts. strategy 1 of `snatchBlob`/`snatchBlobToDisk`. */
  download_verified_with_ensure_progress?(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<Uint8Array>;

  /** chunk-streamed verified download: each verified chunk arrives via
   *  `onChunk` as it is read out of the peer's store, at its explicit
   *  byte offset. strategy 2 of `snatchBlob` (chunks are accumulated into
   *  one buffer) and the primary path of `snatchBlobToDisk` (chunks are
   *  written straight to the caller's writable).
   *
   *  the chunk is always a fresh, plain-ArrayBuffer-backed view (never a
   *  SharedArrayBuffer view) - the narrower type lets it be handed
   *  straight to a `FileSystemWritableFileStream.write()` call without a
   *  cast. */
  download_verified_streaming_with_ensure?(
    peerAddr: string,
    blake3Hash: string,
    totalSize: number,
    onChunk: (chunk: Uint8Array<ArrayBuffer>, offset: number) => void,
    onProgress: (fraction: number) => void,
    downloadId?: string
  ): Promise<number>;

  /** unverified base64 json fallback for peers not reachable over the
   *  verified-transfer transport at all (e.g. a desktop peer whose native
   *  backend only accepts an app-level rpc alpn). strategy 3 - the
   *  response has no transport-level integrity checking, so its bytes are
   *  hash-checked explicitly against the requested blake3 before use. */
  proxy_request?(
    peerAddr: string,
    method: string,
    path: string,
    body: string | null
  ): Promise<{ status: number; body: string }>;

  /** pause/cancel an in-flight download by the id passed to it. returns
   *  false when the download already settled. */
  download_cancel?(downloadId: string): Promise<boolean>;

  /** release a gc pin held by a paused/cancelled download, letting the
   *  partial be reclaimed. */
  unprotect_blob?(blake3Hash: string): Promise<void>;

  /** import local bytes into the node's own store so a peer can download
   *  them by hash. used by `BlobServer`/`serveBlobRequest`. */
  import_blob?(data: Uint8Array): Promise<string>;

  /** release a previously-imported blob from the node's store. used by
   *  `BlobServer`'s release timer. */
  release_blob?(blake3Hash: string): Promise<void> | void;
}

/** what a snatch needs to know about the blob being fetched. */
export interface SnatchInfo {
  /** app-addressable id used to build the strategy-3 proxy path (see
   *  `SnatchOptions.proxyPath`). defaults to `blake3` when omitted - most
   *  callers address blobs by blake3 directly. */
  id?: string;
  blake3: string;
  size: number;
  mime?: string;
}

export interface SnatchOptions {
  onProgress?(fraction: number): void;
  /** aborting rejects immediately with an AbortError - no next-peer retry,
   *  no disk truncation (a resumed snatch rewrites the same offsets). */
  signal?: AbortSignal;
  /** opaque id registered with the node for this download; pass the same
   *  id to `pauseSnatchDownload` to pause the in-flight transfer. */
  downloadId?: string;
  /** per-peer attempt timeout in ms. default 10 minutes - generous because
   *  the responding peer may need to stage the blob into its own store
   *  (bao tree computation) on first request. */
  timeoutMs?: number;
  /** build the http path used by the base64 `proxy_request` fallback
   *  (strategy 3). omit to skip that strategy entirely. */
  proxyPath?(id: string): string;
  /** parse the strategy-3 proxy response body into its base64 payload +
   *  mime. defaults to a flat `{ data, mime }` json shape; supply this
   *  when the peer's rpc envelope nests differently. return null when the
   *  response indicates no blob. */
  parseProxyResponse?(body: string): { data: string; mime?: string } | null;
}

export interface SnatchResult {
  bytes: Uint8Array;
  blake3: string;
  mime?: string;
}

export interface DiskSnatchResult {
  size: number;
  blake3: string;
  mime?: string;
}
