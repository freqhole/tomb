/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

type ReadableStreamType = "bytes";

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
     */
    write_raw_and_finish(data: Uint8Array): Promise<void>;
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
 * - freqhole/1: API proxying and small blob streaming
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
     */
    accept(): Promise<any>;
    /**
     * return the number of blobs currently held in the store via active TempTags.
     */
    active_blob_count(): number;
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
     * create a new node with random identity
     * waits for relay connection before returning
     */
    static create(): Promise<MiddenNode>;
    /**
     * create a node from existing secret key bytes (for persistence)
     * key_bytes must be exactly 32 bytes
     */
    static create_from_key(key_bytes: Uint8Array): Promise<MiddenNode>;
    /**
     * create a node from existing secret key with additional ALPN protocols.
     *
     * `extra_alpns` is a JS array of strings (e.g. ["iroh/automerge-repo/1"]).
     * the node always registers "freqhole/1" plus whatever extra ALPNs are given.
     */
    static create_with_alpns(key_bytes: Uint8Array, extra_alpns: Array<any>): Promise<MiddenNode>;
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
     * full pipeline from blob_id with progress reporting
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
    download_verified_streaming(peer_addr: string, blake3_hash: string, total_size: number, on_chunk: Function, on_progress: Function): Promise<number>;
    /**
     * streaming download with auto ensure+retry. first attempts the streaming
     * download; if the verified download fails (blob not in peer's store), calls
     * ensure_blob to load it, then retries.
     */
    download_verified_streaming_with_ensure(peer_addr: string, blake3_hash: string, total_size: number, on_chunk: Function, on_progress: Function): Promise<number>;
    /**
     * download a blob using iroh-blobs with automatic ensure + retry
     *
     * tries download_verified first. if blob not in peer's FsStore,
     * calls ensure_blob to load it, then retries.
     */
    download_verified_with_ensure(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
    /**
     * download with ensure + retry and progress reporting
     *
     * tries download first; if blob not in peer's FsStore, calls ensure_blob
     * then retries. progress callback receives fraction (0.0 to 1.0).
     */
    download_verified_with_ensure_progress(peer_addr: string, blake3_hash: string, total_size: number, on_progress: Function): Promise<Uint8Array>;
    /**
     * download a blob with progress reporting via JS callback
     *
     * same as download_verified but calls on_progress(fraction) where
     * fraction is bytes_received / total_size (0.0 to 1.0).
     * total_size should come from the automerge doc's size field.
     */
    download_verified_with_progress(peer_addr: string, blake3_hash: string, total_size: number, on_progress: Function): Promise<Uint8Array>;
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
     * check whether a blob with the given blake3 hash is currently held in the MemStore
     * via an active TempTag. avoids expensive OPFS read + bao recomputation when the
     * blob is already loaded.
     */
    has_active_blob(blake3_hash: string): boolean;
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
     * call release_blob() to allow GC, or it will be evicted when the map exceeds 3 entries.
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
     * get our node_id (iroh public key)
     */
    node_id(): string;
    /**
     * open a bidirectional stream to a peer on a specific ALPN.
     *
     * `peer_addr` can be a plain node_id hex string or a full endpoint
     * address JSON (same format as proxy_request). `alpn` is the protocol
     * to negotiate (e.g. "iroh/automerge-repo/1").
     *
     * returns a BiStream for length-delimited message exchange.
     */
    open_bi(peer_addr: string, alpn: string): Promise<BiStream>;
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
     * send an API request to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     */
    proxy_request(peer_addr: string, method: string, path: string, body?: string | null): Promise<any>;
    /**
     * release a blob's TempTag, allowing the store to garbage-collect it.
     * blake3_hash should be the 64-char hex string returned by import_blob.
     */
    release_blob(blake3_hash: string): void;
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
}

/**
 * compute the blake3 hash of the given bytes and return as a hex string.
 * this runs entirely in the browser — no network call needed.
 */
export function hash_blake3(data: Uint8Array): string;

export function start(): void;
