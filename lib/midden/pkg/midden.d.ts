/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

/**
 * a bidirectional QUIC stream for length-delimited message exchange.
 *
 * wraps an iroh (SendStream, RecvStream) pair. messages are framed with
 * a 4-byte big-endian u32 length prefix, matching `LengthDelimitedCodec`
 * from tokio-util.
 *
 * the send and recv halves use RefCell<Option<...>> so that async read
 * and write operations can proceed concurrently (safe because WASM is
 * single-threaded).
 *
 * also holds the parent `Connection` handle, purely to keep the QUIC
 * connection alive for as long as this stream is alive: iroh/quinn tears
 * a connection down once its last `Connection` handle is dropped, and
 * neither `accept()` nor `open_bi()` keep any other handle around after
 * handing a `BiStream` to JS. without this field, the connection was
 * dropped (and the peer's in-flight read failed with "connection lost")
 * the moment `accept()`/`open_bi()` returned - often before a response
 * written moments later on the same stream even finished flushing.
 */
export class BiStream {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * the ALPN protocol this stream was established on.
     */
    alpn(): string;
    /**
     * close the stream.
     *
     * finishes the send half and drops both halves.
     */
    close(): void;
    /**
     * the remote peer's node ID (iroh public key as hex string).
     */
    peer_node_id(): string;
    /**
     * read a newline-terminated utf-8 line.
     *
     * returns the line WITHOUT the trailing `\n`. returns null on clean
     * stream close (EOF before any bytes). used for ndjson framing.
     */
    read_line(): Promise<any>;
    /**
     * read a length-delimited message.
     *
     * reads a 4-byte big-endian u32 length prefix, then reads that many
     * bytes of payload. returns the payload as a Uint8Array.
     *
     * returns null (JsValue::NULL) if the stream has been closed cleanly
     * by the remote peer (EOF on the length prefix read).
     */
    read_message(): Promise<any>;
    /**
     * read all remaining bytes from the recv stream (no length prefix).
     *
     * reads until the remote peer finishes the stream or `max_size` bytes
     * are read. this matches grimoire's `read_to_end()` framing where
     * the message is terminated by the sender calling `finish()`.
     */
    read_to_end(max_size: number): Promise<any>;
    /**
     * write a newline-delimited utf-8 line.
     *
     * appends `\n` if not already present, then writes. used for the ndjson
     * framing the `freqhole-events/1` protocol speaks.
     */
    write_line(line: string): Promise<void>;
    /**
     * write a length-delimited message.
     *
     * writes a 4-byte big-endian u32 length prefix followed by the payload.
     * this matches the `LengthDelimitedCodec` framing used by the
     * iroh-automerge-repo example.
     */
    write_message(data: Uint8Array): Promise<void>;
    /**
     * write raw bytes without a length prefix, then finish the send stream.
     *
     * this matches grimoire's `send_response()` framing where the message
     * is terminated by calling `finish()` on the send stream. the receiver
     * uses `read_to_end()` to read all bytes.
     *
     * after `finish()` we await `stopped()` so the peer's ack is observed
     * before this method returns. without this, JS callers that drop /
     * `close()` the stream immediately after `write_raw_and_finish` can
     * race the QUIC flush -- the peer's `read_to_end` then errors with
     * "connection lost" mid-payload because the in-flight frames are
     * torn down with the connection. matters most for large payloads
     * (e.g. base64-encoded blob bodies in `api_response`).
     */
    write_raw_and_finish(data: Uint8Array): Promise<void>;
}

/**
 * incremental blake3 hasher for streaming uploads — feed fixed-size chunks
 * via update() and read the final hex hash from finalize(). lets JS hash a
 * File while streaming it (file.stream() reader loop) instead of holding
 * the whole payload in memory for a one-shot hash_blake3().
 */
export class Blake3Hasher {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * finish and return the hash as a 64-char hex string. the hasher can
     * keep absorbing after this (blake3 finalize is non-destructive), but
     * callers should treat the session as done.
     */
    finalize(): string;
    constructor();
    /**
     * absorb the next chunk of data.
     */
    update(chunk: Uint8Array): void;
}

/**
 * cooperative cancellation for in-flight downloads (pause/cancel from JS).
 * the download loops select on `cancelled()` between progress events —
 * cancellation takes effect at the next event boundary, and the partial
 * data stays in the store, so a later download of the same hash resumes
 * from the persisted bitfield (only missing ranges transfer).
 */
export class CancelToken {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * request cancellation. idempotent.
     */
    cancel(): void;
    /**
     * return a new CancelToken sharing the same cancellation state.
     * needed because passing a wasm class by value consumes the JS handle —
     * callers keep the original and pass a clone into download calls.
     */
    clone_token(): CancelToken;
    is_cancelled(): boolean;
    constructor();
}

/**
 * result from fetching the server hello image from a peer
 */
export class HelloImageResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly content_type: string | undefined;
    readonly data: Uint8Array;
}

/**
 * chunked import session — the streaming counterpart to import_blob.
 *
 * created via MiddenNode::start_import(). JS feeds fixed-size chunks with
 * push() (backpressured: the promise resolves only once the chunk is
 * queued), then finish() completes the import and returns the blake3 hash.
 * the wasm boundary never sees the whole payload at once; the store's
 * ImportByteStream machinery computes the bao tree incrementally.
 *
 * the finished blob is pinned in the node's active_tags (same as
 * import_blob) until release_blob() is called.
 */
export class ImportSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * abort the import. any partially-imported data is left to GC.
     */
    abort(): void;
    /**
     * signal end-of-stream, wait for the import to complete, pin the
     * resulting blob, and return its blake3 hash as a hex string.
     */
    finish(): Promise<string>;
    /**
     * queue the next chunk. resolves once the chunk has been accepted by
     * the import stream (bounded channel — this is the backpressure point).
     */
    push(chunk: Uint8Array): Promise<void>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * browser P2P node for freqhole federation
 *
 * supports two protocols:
 * - freqhole/1: API requests and small blob streaming
 * - iroh-blobs: verified streaming for audio files
 */
export class MiddenNode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * accept the next incoming connection and bidirectional stream.
     *
     * blocks until an incoming connection arrives on any registered ALPN.
     * returns a BiStream with the peer's node ID and the negotiated ALPN.
     *
     * returns null (JsValue::NULL) if the endpoint has been closed.
     *
     * the caller should check `stream.alpn()` to route the connection
     * to the appropriate handler.
     *
     * a single incoming attempt failing during the TLS handshake (e.g. the
     * peer aborts mid-handshake - normal during connection-path racing, or
     * a peer that redials before noticing an earlier attempt is still
     * live) does not end this call: it's logged and the loop moves on to
     * the next queued incoming connection. propagating that failure to the
     * caller instead would surface as a JS-level error on every accept()
     * call, forcing the caller through a full error-handling/backoff cycle
     * (see `IrohNetworkAdapter`'s accept loop) before the next, perfectly
     * good, already-queued connection is even looked at - under a burst of
     * aborted handshakes this can visibly stall new connections from ever
     * completing.
     */
    accept(): Promise<any>;
    /**
     * return the number of blobs currently held in the store via active TempTags.
     */
    active_blob_count(): number;
    /**
     * send an API request to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     */
    api_request(peer_addr: string, method: string, path: string, body?: string | null): Promise<any>;
    /**
     * PROTOTYPE: remove a hash's restriction, returning it to the default
     * (served to anyone) state.
     */
    clear_blob_restriction(blake3_hash: string): void;
    /**
     * compute blake3 hash for a blob on demand
     *
     * use this when the client doesn't have the blake3 hash yet (not in API response).
     * the server will compute the hash, save it to the database, and add the file
     * to FsStore for verified streaming.
     *
     * returns the blake3 hash (64 hex chars) if successful, null if blob not found.
     */
    compute_blake3(peer_addr: string, blob_id: string): Promise<string | undefined>;
    /**
     * create a new node with random identity, an in-memory blob store, and
     * the default ALPN set. waits for relay connection before returning.
     *
     * deprecated: use `create_with_options` instead.
     *
     * `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
     * (defaults to 10s when omitted/undefined).
     */
    static create(connect_timeout_ms?: number | null): Promise<MiddenNode>;
    /**
     * create a node from existing secret key bytes (for persistence)
     * key_bytes must be exactly 32 bytes.
     *
     * deprecated: use `create_with_options` instead.
     *
     * `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
     * (defaults to 10s when omitted/undefined).
     */
    static create_from_key(key_bytes: Uint8Array, connect_timeout_ms?: number | null): Promise<MiddenNode>;
    /**
     * create a node from existing secret key with additional ALPN protocols.
     *
     * deprecated: use `create_with_options` instead.
     *
     * `extra_alpns` is a JS array of strings (e.g. ["iroh/automerge-repo/1"]).
     * the node always registers the default ALPN set plus whatever extra ALPNs are given.
     *
     * `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
     * (defaults to 10s when omitted/undefined).
     */
    static create_with_alpns(key_bytes: Uint8Array, extra_alpns: Array<any>, connect_timeout_ms?: number | null): Promise<MiddenNode>;
    /**
     * create a node from an options bag. this is the single canonical
     * constructor — `create`/`create_from_key`/`create_with_alpns` below
     * are deprecated wrappers kept for existing callers (spume, playlistz).
     */
    static create_with_options(options: MiddenNodeOptions): Promise<MiddenNode>;
    /**
     * download a blob using iroh-blobs verified streaming
     *
     * this is the preferred method for audio files - provides:
     * - verified streaming (each chunk is cryptographically verified)
     * - resume support (can restart interrupted transfers)
     * - efficient parallel chunk fetching
     *
     * peer_addr: plain node_id or full endpoint JSON
     * blake3_hash: the blake3 hash of the blob (64 hex chars)
     */
    download_verified(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
    /**
     * download a blob by blob_id using verified streaming with on-demand blake3
     *
     * use this when the client doesn't have the blake3 hash yet (not in API response).
     * computes blake3 on the server, then uses iroh-blobs verified streaming.
     *
     * returns (blob_data, blake3_hash) for caching the hash for future requests.
     */
    download_verified_by_id(peer_addr: string, blob_id: string): Promise<Array<any>>;
    /**
     * full pipeline from blob_id with progress reporting.
     *
     * computes blake3 on demand, then uses verified download with progress.
     * returns [data: Uint8Array, blake3: string].
     */
    download_verified_by_id_progress(peer_addr: string, blob_id: string, total_size: number, on_progress: Function): Promise<Array<any>>;
    /**
     * download a verified blob and stream chunks to JS via callback
     *
     * this is the preferred path for large blobs (audio files). instead of
     * materializing the full blob in wasm linear memory (which fails around
     * 32MB+ due to allocator pressure on a single contiguous Bytes), this:
     *
     * 1. downloads the blob into MemStore using the verified iroh-blobs path
     * 2. opens a streaming reader and pulls chunks
     * 3. delivers each chunk to the JS callback as a Uint8Array
     *
     * JS side accumulates chunks (e.g. into a Blob via array of BlobParts) and
     * can release each chunk as it goes. wasm peak memory stays bounded by
     * chunk_size + the original MemStore copy.
     *
     * callback signature: `on_chunk(chunk: Uint8Array, offset: u64) -> void`
     * progress callback: `on_progress(fraction: f64) -> void`
     *
     * returns total bytes streamed.
     */
    download_verified_streaming(peer_addr: string, blake3_hash: string, total_size: number, on_chunk: Function, on_progress: Function, cancel?: CancelToken | null): Promise<number>;
    /**
     * streaming download with auto ensure+retry. first attempts the streaming
     * download; if the verified download fails (blob not in peer's store), calls
     * ensure_blob to load it, then retries. a deliberate cancellation is NOT
     * retried — it propagates immediately with the "download cancelled" message.
     */
    download_verified_streaming_with_ensure(peer_addr: string, blake3_hash: string, total_size: number, on_chunk: Function, on_progress: Function, cancel?: CancelToken | null): Promise<number>;
    /**
     * download a blob using iroh-blobs with automatic ensure + retry
     *
     * tries download_verified first. if blob not in peer's FsStore,
     * calls ensure_blob to load it, then retries.
     */
    download_verified_with_ensure(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
    /**
     * download with ensure + retry and progress reporting.
     *
     * tries download first; if blob not in peer's FsStore, calls ensure_blob
     * then retries. progress callback receives fraction (0.0 to 1.0).
     * `cancel`: optional cooperative cancellation (pause) — a deliberate
     * cancellation is NOT retried, it propagates immediately.
     *
     * NOTE: any failure on the first attempt triggers this same
     * ensure-then-retry fallback, not just the "blob not in FsStore yet"
     * case the fallback was designed for. for a large blob, the first
     * attempt can stream a substantial fraction of the bytes (driving
     * `on_progress` most/all of the way to 1.0) before failing late, so the
     * caller-visible symptom is a full 0->100% progress cycle that silently
     * restarts from 0 for a second full cycle. logging the first attempt's
     * error and explicitly resetting progress to 0 here makes this restart
     * visible/diagnosable instead of looking like a silent glitch.
     */
    download_verified_with_ensure_progress(peer_addr: string, blake3_hash: string, total_size: number, on_progress: Function, cancel?: CancelToken | null): Promise<Uint8Array>;
    /**
     * download a blob with progress reporting via JS callback
     *
     * same as download_verified but calls on_progress(fraction) where
     * fraction is bytes_received / total_size (0.0 to 1.0).
     * total_size should come from the caller's known size field.
     * `cancel`: optional cooperative cancellation (pause) — see
     * download_verified_streaming for the semantics.
     */
    download_verified_with_progress(peer_addr: string, blake3_hash: string, total_size: number, on_progress: Function, cancel?: CancelToken | null): Promise<Uint8Array>;
    /**
     * ensure a blob is loaded into the peer's FsStore by blake3 hash
     *
     * call this before retrying download_verified if the first attempt fails.
     * the server will look up the file by blake3 hash and add it to FsStore.
     *
     * returns true if blob is now available, false if not found.
     */
    ensure_blob(peer_addr: string, blake3_hash: string): Promise<boolean>;
    /**
     * fetch server image from a peer (public, no auth required)
     * used during "add remote" flow before user is authenticated
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     */
    fetch_hello_image(peer_addr: string): Promise<HelloImageResult>;
    /**
     * snapshot of this node's own outgoing blob transfers currently in
     * flight (this node serving, some other peer snatching) - mirrors
     * reliquary's hub-side `TransferRegistry::snapshot`, so loam's
     * `p2p/transfer-progress.ts` can show live upload progress for browser
     * peers too, not just tauri peers. each entry serializes as
     * `{ peerId, blake3, bytesSent, totalSize }`.
     */
    get_active_transfers(): any;
    /**
     * check whether a blob with the given blake3 hash is currently held in the store
     * via an active TempTag. avoids expensive OPFS read + bao recomputation when the
     * blob is already loaded.
     */
    has_active_blob(blake3_hash: string): boolean;
    /**
     * check whether a COMPLETE blob with this hash exists in the blob store
     * itself — with the persistent opfs store this is true across reloads,
     * even when no TempTag pins it. lets serving paths skip re-imports
     * entirely.
     */
    has_complete_blob(blake3_hash: string): Promise<boolean>;
    /**
     * import a blob from its pre-computed bao-encoded bytes, skipping the
     * expensive bao tree computation. `blake3_hash` is the 64-char hex hash,
     * `bao_data` is the bao-encoded bytes previously returned by
     * `import_blob_and_export_bao`.
     *
     * uses `import_bao_bytes` (iroh-blobs internal API) to feed the pre-computed
     * bao stream directly into the store, then creates a global TempTag via
     * `Tags::temp_tag` to prevent GC.
     */
    import_bao(blake3_hash: string, bao_data: Uint8Array): Promise<string>;
    /**
     * import raw bytes into the iroh-blobs store, returning the blake3 hash.
     * this makes the blob available for verified download by peers.
     * the blob stays in the store as long as its TempTag is held in active_tags.
     * call release_blob() to allow GC.
     */
    import_blob(data: Uint8Array): Promise<string>;
    /**
     * import raw bytes into the iroh-blobs store, returning both the blake3 hash
     * AND the bao-encoded bytes. the bao bytes can be cached in OPFS and later
     * fed to `import_bao` to skip the expensive bao tree recomputation on re-import.
     *
     * returns a JS object: `{ hash: string, bao: Uint8Array }`
     */
    import_blob_and_export_bao(data: Uint8Array): Promise<any>;
    /**
     * get our full endpoint address as JSON (node_id + relay url + any direct addrs).
     *
     * after `online()` has resolved this includes the home relay url, which is
     * enough for a remote peer to dial us directly via the relay without doing
     * a pkarr/DNS discovery lookup first. pass the returned string straight to
     * `open_bi`/`connect` on the other side - `parse_peer_addr` accepts this
     * same JSON shape. avoids the discovery propagation race on fresh boots.
     */
    node_addr(): string;
    /**
     * get our node_id (iroh public key)
     */
    node_id(): string;
    /**
     * open a bidirectional stream to a peer on a specific ALPN.
     *
     * `peer_addr` can be a plain node_id hex string or a full endpoint
     * address JSON (same format as api_request). `alpn` is the protocol
     * to negotiate (e.g. "iroh/automerge-repo/1").
     *
     * returns a BiStream for length-delimited message exchange.
     */
    open_bi(peer_addr: string, alpn: string): Promise<BiStream>;
    /**
     * pin a hash so gc won't sweep it (e.g. a paused partial download).
     * idempotent. pair with unprotect_blob when the partial is resumed to
     * completion or discarded.
     */
    protect_blob(blake3_hash: string): void;
    /**
     * dispatch a typed admin command to a peer over the freqhole-admin/1 ALPN.
     *
     * `args` is a JSON string (the literal `"null"` is accepted for no-payload
     * commands). returns a JS object envelope `{ success, message, data, errors }`
     * matching the wire format. validation of `data` against the per-command
     * schema happens in the spume `AdminClient`.
     */
    proxy_admin(peer_addr: string, command: string, args: string): Promise<any>;
    /**
     * release a blob's TempTag, allowing the store to garbage-collect it.
     * blake3_hash should be the 64-char hex string returned by import_blob.
     */
    release_blob(blake3_hash: string): void;
    /**
     * PROTOTYPE: restrict a blob (by blake3 hex hash) so only the given
     * peer node ids may fetch it over the `iroh-blobs/*` ALPN. a hash with
     * no restriction registered is served to anyone (today's default
     * behavior, unchanged) — calling this is what opts a specific hash
     * into gating.
     *
     * this is a stopgap/demo hook, not the real canvas-ACL integration: it
     * has to be called explicitly, from JS, with an already-resolved list
     * of allowed peer node ids for this one hash.
     */
    restrict_blob_to_peers(blake3_hash: string, peer_node_ids: Array<any>): void;
    /**
     * get the secret key bytes for persistence (32 bytes)
     * store this in IndexedDB to maintain the same identity across sessions
     */
    secret_key(): Uint8Array;
    /**
     * start a background accept loop that handles incoming iroh-blobs connections.
     *
     * call this once after creating the node to allow remote peers to pull blobs
     * from this node (e.g., for P2P music upload where the server pulls from browser).
     *
     * only handles iroh-blobs connections — other ALPNs are ignored (dropped).
     * safe to call multiple times (subsequent calls are no-ops).
     *
     * WARNING: if you also call `accept()` from JS, both loops will compete for
     * incoming connections and each will only see a subset. use one or the other,
     * not both. freqhole uses `start_blob_server()`, skein uses `accept()`.
     *
     * NOTE: no application-level peer auth is applied here. iroh-blobs transfers
     * are content-addressed (blake3 verified), so a peer can only download blobs
     * they already know the hash of. peer filtering can be added later if needed.
     */
    start_blob_server(): void;
    /**
     * begin a chunked import — the streaming counterpart to import_blob for
     * payloads that shouldn't be materialized as one contiguous &[u8] across
     * the wasm boundary. see ImportSession for the push/finish protocol.
     */
    start_import(): ImportSession;
    /**
     * connect to a freqhole radio broadcaster.
     *
     * callbacks (all called from JS land):
     * - `on_hello(json: string)` — fires once when the server's Hello
     *   message arrives. payload is the JSON-encoded `HelloMessage`.
     * - `on_meta(json: string)` — fires on each track change with the
     *   JSON-encoded `MetaMessage`.
     * - `on_chunk(seq: number, is_init: boolean, bytes: Uint8Array)` —
     *   fires per audio chunk. `is_init = true` marks the start of a new
     *   track; the JS side should append it to the same SourceBuffer.
     *
     * returns a [`RadioHandle`] — keep a reference to it; dropping it stops
     * playback and closes the iroh connection.
     */
    tune_radio(peer_addr: string, station_id: string | null | undefined, on_hello: Function, on_meta: Function, on_chunk: Function): Promise<RadioHandle>;
    /**
     * remove a gc pin added by protect_blob (or by a cancelled download).
     */
    unprotect_blob(blake3_hash: string): void;
}

/**
 * options bag for `MiddenNode::create_with_options`, the single canonical
 * constructor. build one, set whichever fields are needed, and pass it in:
 *
 * ```js
 * const opts = new MiddenNodeOptions();
 * opts.opfs_store_dir = "midden-blob-store";
 * opts.connect_timeout_ms = 5000;
 * const node = await MiddenNode.create_with_options(opts);
 * ```
 *
 * `create`/`create_from_key`/`create_with_alpns` remain as deprecated
 * wrappers over this constructor for existing callers (spume, playlistz).
 */
export class MiddenNodeOptions {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    /**
     * per-dial timeout (ms) for `open_bi`/`connect` (defaults to 10s).
     */
    get connect_timeout_ms(): number | undefined;
    set connect_timeout_ms(value: number | null | undefined);
    /**
     * additional ALPN protocols to register beyond the default set.
     */
    get extra_alpns(): string[] | undefined;
    set extra_alpns(value: string[] | null | undefined);
    /**
     * when given, blobs persist in an OPFS-backed store under this
     * directory (worker context required); otherwise (or when OPFS is
     * unavailable) an in-memory store is used.
     */
    get opfs_store_dir(): string | undefined;
    set opfs_store_dir(value: string | null | undefined);
    /**
     * the node's secret key (32 raw bytes). omit (or pass null/undefined)
     * to generate a random identity.
     */
    get secret_key(): Uint8Array | undefined;
    set secret_key(value: Uint8Array | null | undefined);
}

/**
 * handle returned to JS for a tuned-in radio session. dropping the handle
 * (or calling `leave()`) closes the iroh connection, which tears down both
 * read loops.
 */
export class RadioHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * stop receiving audio + meta and close the connection.
     */
    leave(): void;
}

/**
 * compute the blake3 hash of the given bytes and return as a hex string.
 * this runs entirely in the browser — no network call needed.
 */
export function hash_blake3(data: Uint8Array): string;

/**
 * opfs store selftest — runs the full import/export round trip against
 * real OPFS through the real iroh-blobs api. worker context required
 * (sync access handles). wasm-only debug helper, used for manual
 * debugging from the blob worker, not from automated tests.
 */
export function opfs_store_selftest(): Promise<string>;

/**
 * persistence selftest: blobs + tags survive a store shutdown/reopen over
 * the same OPFS directory. worker context required. wasm-only debug
 * helper, used for manual debugging from the blob worker.
 */
export function opfs_store_selftest_persistence(): Promise<string>;

export function start(): void;
