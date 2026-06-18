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
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BiStream.prototype);
        obj.__wbg_ptr = ptr;
        BiStreamFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BiStreamFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bistream_free(ptr, 0);
    }
    /**
     * the ALPN protocol this stream was established on.
     * @returns {string}
     */
    alpn() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.bistream_alpn(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * close the stream.
     *
     * finishes the send half and drops both halves.
     */
    close() {
        wasm.bistream_close(this.__wbg_ptr);
    }
    /**
     * the remote peer's node ID (iroh public key as hex string).
     * @returns {string}
     */
    peer_node_id() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.bistream_peer_node_id(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * read a newline-terminated utf-8 line.
     *
     * returns the line WITHOUT the trailing `\n`. returns null on clean
     * stream close (EOF before any bytes). used for ndjson framing.
     * @returns {Promise<any>}
     */
    read_line() {
        const ret = wasm.bistream_read_line(this.__wbg_ptr);
        return ret;
    }
    /**
     * read a length-delimited message.
     *
     * reads a 4-byte big-endian u32 length prefix, then reads that many
     * bytes of payload. returns the payload as a Uint8Array.
     *
     * returns null (JsValue::NULL) if the stream has been closed cleanly
     * by the remote peer (EOF on the length prefix read).
     * @returns {Promise<any>}
     */
    read_message() {
        const ret = wasm.bistream_read_message(this.__wbg_ptr);
        return ret;
    }
    /**
     * read all remaining bytes from the recv stream (no length prefix).
     *
     * reads until the remote peer finishes the stream or `max_size` bytes
     * are read. this matches grimoire's `read_to_end()` framing where
     * the message is terminated by the sender calling `finish()`.
     * @param {number} max_size
     * @returns {Promise<any>}
     */
    read_to_end(max_size) {
        const ret = wasm.bistream_read_to_end(this.__wbg_ptr, max_size);
        return ret;
    }
    /**
     * write a newline-delimited utf-8 line.
     *
     * appends `\n` if not already present, then writes. used for the ndjson
     * framing the `freqhole-events/1` protocol speaks.
     * @param {string} line
     * @returns {Promise<void>}
     */
    write_line(line) {
        const ptr0 = passStringToWasm0(line, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bistream_write_line(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * write a length-delimited message.
     *
     * writes a 4-byte big-endian u32 length prefix followed by the payload.
     * this matches the `LengthDelimitedCodec` framing used by the
     * iroh-automerge-repo example.
     * @param {Uint8Array} data
     * @returns {Promise<void>}
     */
    write_message(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bistream_write_message(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
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
     * (e.g. base64-encoded blob bodies in `proxy_response`).
     * @param {Uint8Array} data
     * @returns {Promise<void>}
     */
    write_raw_and_finish(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bistream_write_raw_and_finish(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
}
if (Symbol.dispose) BiStream.prototype[Symbol.dispose] = BiStream.prototype.free;

/**
 * result from fetching the server hello image from a peer
 */
export class HelloImageResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(HelloImageResult.prototype);
        obj.__wbg_ptr = ptr;
        HelloImageResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HelloImageResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_helloimageresult_free(ptr, 0);
    }
    /**
     * @returns {string | undefined}
     */
    get content_type() {
        const ret = wasm.helloimageresult_content_type(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get data() {
        const ret = wasm.helloimageresult_data(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) HelloImageResult.prototype[Symbol.dispose] = HelloImageResult.prototype.free;

export class IntoUnderlyingByteSource {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingByteSourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingbytesource_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get autoAllocateChunkSize() {
        const ret = wasm.intounderlyingbytesource_autoAllocateChunkSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    cancel() {
        const ptr = this.__destroy_into_raw();
        wasm.intounderlyingbytesource_cancel(ptr);
    }
    /**
     * @param {ReadableByteStreamController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        const ret = wasm.intounderlyingbytesource_pull(this.__wbg_ptr, controller);
        return ret;
    }
    /**
     * @param {ReadableByteStreamController} controller
     */
    start(controller) {
        wasm.intounderlyingbytesource_start(this.__wbg_ptr, controller);
    }
    /**
     * @returns {ReadableStreamType}
     */
    get type() {
        const ret = wasm.intounderlyingbytesource_type(this.__wbg_ptr);
        return __wbindgen_enum_ReadableStreamType[ret];
    }
}
if (Symbol.dispose) IntoUnderlyingByteSource.prototype[Symbol.dispose] = IntoUnderlyingByteSource.prototype.free;

export class IntoUnderlyingSink {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingSinkFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingsink_free(ptr, 0);
    }
    /**
     * @param {any} reason
     * @returns {Promise<any>}
     */
    abort(reason) {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.intounderlyingsink_abort(ptr, reason);
        return ret;
    }
    /**
     * @returns {Promise<any>}
     */
    close() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.intounderlyingsink_close(ptr);
        return ret;
    }
    /**
     * @param {any} chunk
     * @returns {Promise<any>}
     */
    write(chunk) {
        const ret = wasm.intounderlyingsink_write(this.__wbg_ptr, chunk);
        return ret;
    }
}
if (Symbol.dispose) IntoUnderlyingSink.prototype[Symbol.dispose] = IntoUnderlyingSink.prototype.free;

export class IntoUnderlyingSource {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        IntoUnderlyingSourceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_intounderlyingsource_free(ptr, 0);
    }
    cancel() {
        const ptr = this.__destroy_into_raw();
        wasm.intounderlyingsource_cancel(ptr);
    }
    /**
     * @param {ReadableStreamDefaultController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        const ret = wasm.intounderlyingsource_pull(this.__wbg_ptr, controller);
        return ret;
    }
}
if (Symbol.dispose) IntoUnderlyingSource.prototype[Symbol.dispose] = IntoUnderlyingSource.prototype.free;

/**
 * browser P2P node for freqhole federation
 *
 * supports two protocols:
 * - freqhole/1: API proxying and small blob streaming
 * - iroh-blobs: verified streaming for audio files
 */
export class MiddenNode {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MiddenNode.prototype);
        obj.__wbg_ptr = ptr;
        MiddenNodeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MiddenNodeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_middennode_free(ptr, 0);
    }
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
     * @returns {Promise<any>}
     */
    accept() {
        const ret = wasm.middennode_accept(this.__wbg_ptr);
        return ret;
    }
    /**
     * return the number of blobs currently held in the store via active TempTags.
     * @returns {number}
     */
    active_blob_count() {
        const ret = wasm.middennode_active_blob_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * compute blake3 hash for a blob on demand
     *
     * use this when the client doesn't have the blake3 hash yet (not in API response).
     * the server will compute the hash, save it to the database, and add the file
     * to FsStore for verified streaming.
     *
     * returns the blake3 hash (64 hex chars) if successful, null if blob not found.
     * @param {string} peer_addr
     * @param {string} blob_id
     * @returns {Promise<string | undefined>}
     */
    compute_blake3(peer_addr, blob_id) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blob_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_compute_blake3(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * create a new node with random identity
     * waits for relay connection before returning
     * @returns {Promise<MiddenNode>}
     */
    static create() {
        const ret = wasm.middennode_create();
        return ret;
    }
    /**
     * create a node from existing secret key bytes (for persistence)
     * key_bytes must be exactly 32 bytes
     * @param {Uint8Array} key_bytes
     * @returns {Promise<MiddenNode>}
     */
    static create_from_key(key_bytes) {
        const ptr0 = passArray8ToWasm0(key_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_create_from_key(ptr0, len0);
        return ret;
    }
    /**
     * create a node from existing secret key with additional ALPN protocols.
     *
     * `extra_alpns` is a JS array of strings (e.g. ["iroh/automerge-repo/1"]).
     * the node always registers "freqhole/1" plus whatever extra ALPNs are given.
     * @param {Uint8Array} key_bytes
     * @param {Array<any>} extra_alpns
     * @returns {Promise<MiddenNode>}
     */
    static create_with_alpns(key_bytes, extra_alpns) {
        const ptr0 = passArray8ToWasm0(key_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_create_with_alpns(ptr0, len0, extra_alpns);
        return ret;
    }
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
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @returns {Promise<Uint8Array>}
     */
    download_verified(peer_addr, blake3_hash) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * download a blob by blob_id using verified streaming with on-demand blake3
     *
     * use this when the client doesn't have the blake3 hash yet (not in API response).
     * computes blake3 on the server, then uses iroh-blobs verified streaming.
     *
     * returns (blob_data, blake3_hash) for caching the hash for future requests.
     * @param {string} peer_addr
     * @param {string} blob_id
     * @returns {Promise<Array<any>>}
     */
    download_verified_by_id(peer_addr, blob_id) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blob_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified_by_id(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
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
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @param {number} total_size
     * @param {Function} on_chunk
     * @param {Function} on_progress
     * @returns {Promise<number>}
     */
    download_verified_streaming(peer_addr, blake3_hash, total_size, on_chunk, on_progress) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified_streaming(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_chunk, on_progress);
        return ret;
    }
    /**
     * streaming download with auto ensure+retry. first attempts the streaming
     * download; if the verified download fails (blob not in peer's store), calls
     * ensure_blob to load it, then retries.
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @param {number} total_size
     * @param {Function} on_chunk
     * @param {Function} on_progress
     * @returns {Promise<number>}
     */
    download_verified_streaming_with_ensure(peer_addr, blake3_hash, total_size, on_chunk, on_progress) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified_streaming_with_ensure(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_chunk, on_progress);
        return ret;
    }
    /**
     * download a blob using iroh-blobs with automatic ensure + retry
     *
     * tries download_verified first. if blob not in peer's FsStore,
     * calls ensure_blob to load it, then retries.
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @returns {Promise<Uint8Array>}
     */
    download_verified_with_ensure(peer_addr, blake3_hash) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified_with_ensure(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * ensure a blob is loaded into the peer's FsStore by blake3 hash
     *
     * call this before retrying download_verified if the first attempt fails.
     * the server will look up the file by blake3 hash and add it to FsStore.
     *
     * returns true if blob is now available, false if not found.
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @returns {Promise<boolean>}
     */
    ensure_blob(peer_addr, blake3_hash) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_ensure_blob(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * fetch server image from a peer (public, no auth required)
     * used during "add remote" flow before user is authenticated
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * @param {string} peer_addr
     * @returns {Promise<HelloImageResult>}
     */
    fetch_hello_image(peer_addr) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_fetch_hello_image(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * check whether a blob with the given blake3 hash is currently held in the MemStore
     * via an active TempTag. avoids expensive OPFS read + bao recomputation when the
     * blob is already loaded.
     * @param {string} blake3_hash
     * @returns {boolean}
     */
    has_active_blob(blake3_hash) {
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_has_active_blob(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * import a blob from its pre-computed bao-encoded bytes, skipping the
     * expensive bao tree computation. `blake3_hash` is the 64-char hex hash,
     * `bao_data` is the bao-encoded bytes previously returned by
     * `import_blob_and_export_bao`.
     *
     * uses `import_bao_bytes` (iroh-blobs internal API) to feed the pre-computed
     * bao stream directly into the store, then creates a global TempTag via
     * `Tags::temp_tag` to prevent GC.
     * @param {string} blake3_hash
     * @param {Uint8Array} bao_data
     * @returns {Promise<string>}
     */
    import_bao(blake3_hash, bao_data) {
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bao_data, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_import_bao(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * import raw bytes into the iroh-blobs store, returning the blake3 hash.
     * this makes the blob available for verified download by peers.
     * the blob stays in the store as long as its TempTag is held in active_tags.
     * call release_blob() to allow GC, or it will be evicted when the map exceeds 3 entries.
     * @param {Uint8Array} data
     * @returns {Promise<string>}
     */
    import_blob(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_import_blob(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * import raw bytes into the iroh-blobs store, returning both the blake3 hash
     * AND the bao-encoded bytes. the bao bytes can be cached in OPFS and later
     * fed to `import_bao` to skip the expensive bao tree recomputation on re-import.
     *
     * returns a JS object: `{ hash: string, bao: Uint8Array }`
     * @param {Uint8Array} data
     * @returns {Promise<any>}
     */
    import_blob_and_export_bao(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_import_blob_and_export_bao(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * get our node_id (iroh public key)
     * @returns {string}
     */
    node_id() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.middennode_node_id(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * open a bidirectional stream to a peer on a specific ALPN.
     *
     * `peer_addr` can be a plain node_id hex string or a full endpoint
     * address JSON (same format as proxy_request). `alpn` is the protocol
     * to negotiate (e.g. "iroh/automerge-repo/1").
     *
     * returns a BiStream for length-delimited message exchange.
     * @param {string} peer_addr
     * @param {string} alpn
     * @returns {Promise<BiStream>}
     */
    open_bi(peer_addr, alpn) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(alpn, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_open_bi(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * dispatch a typed admin command to a peer over the freqhole-admin/1 ALPN.
     *
     * `args` is a JSON string (the literal `"null"` is accepted for no-payload
     * commands). returns a JS object envelope `{ success, message, data, errors }`
     * matching the wire format. validation of `data` against the per-command
     * schema happens in the spume `AdminClient`.
     * @param {string} peer_addr
     * @param {string} command
     * @param {string} args
     * @returns {Promise<any>}
     */
    proxy_admin(peer_addr, command, args) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(command, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(args, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_proxy_admin(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        return ret;
    }
    /**
     * send an API request to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * @param {string} peer_addr
     * @param {string} method
     * @param {string} path
     * @param {string | null} [body]
     * @returns {Promise<any>}
     */
    proxy_request(peer_addr, method, path, body) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_proxy_request(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret;
    }
    /**
     * release a blob's TempTag, allowing the store to garbage-collect it.
     * blake3_hash should be the 64-char hex string returned by import_blob.
     * @param {string} blake3_hash
     */
    release_blob(blake3_hash) {
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_release_blob(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * get the secret key bytes for persistence (32 bytes)
     * store this in IndexedDB to maintain the same identity across sessions
     * @returns {Uint8Array}
     */
    secret_key() {
        const ret = wasm.middennode_secret_key(this.__wbg_ptr);
        return ret;
    }
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
    start_blob_server() {
        wasm.middennode_start_blob_server(this.__wbg_ptr);
    }
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
     * @param {string} peer_addr
     * @param {string | null | undefined} station_id
     * @param {Function} on_hello
     * @param {Function} on_meta
     * @param {Function} on_chunk
     * @returns {Promise<RadioHandle>}
     */
    tune_radio(peer_addr, station_id, on_hello, on_meta, on_chunk) {
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(station_id) ? 0 : passStringToWasm0(station_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_tune_radio(this.__wbg_ptr, ptr0, len0, ptr1, len1, on_hello, on_meta, on_chunk);
        return ret;
    }
}
if (Symbol.dispose) MiddenNode.prototype[Symbol.dispose] = MiddenNode.prototype.free;

/**
 * handle returned to JS for a tuned-in radio session. dropping the handle
 * (or calling `leave()`) closes the iroh connection, which tears down both
 * read loops.
 */
export class RadioHandle {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RadioHandle.prototype);
        obj.__wbg_ptr = ptr;
        RadioHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RadioHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_radiohandle_free(ptr, 0);
    }
    /**
     * stop receiving audio + meta and close the connection.
     */
    leave() {
        wasm.radiohandle_leave(this.__wbg_ptr);
    }
}
if (Symbol.dispose) RadioHandle.prototype[Symbol.dispose] = RadioHandle.prototype.free;

/**
 * compute the blake3 hash of the given bytes and return as a hex string.
 * this runs entirely in the browser — no network call needed.
 * @param {Uint8Array} data
 * @returns {string}
 */
export function hash_blake3(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hash_blake3(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

export function start() {
    wasm.start();
}
export function __wbg_Error_83742b46f01ce22d(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_String_8564e559799eccda(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}
export function __wbg___wbindgen_debug_string_5398f5bb970e0daa(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_is_function_3c846841762788c1(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
}
export function __wbg___wbindgen_is_object_781bc9f159099513(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
}
export function __wbg___wbindgen_is_string_7ef6b97b02428fae(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
}
export function __wbg___wbindgen_is_undefined_52709e72fb9f179c(arg0) {
    const ret = arg0 === undefined;
    return ret;
}
export function __wbg___wbindgen_string_get_395e606bd0ee4427(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_throw_6ddd609b62940d55(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg__wbg_cb_unref_6b5b6b8576d35cb1(arg0) {
    arg0._wbg_cb_unref();
}
export function __wbg_abort_5ef96933660780b7(arg0) {
    arg0.abort();
}
export function __wbg_abort_6479c2d794ebf2ee(arg0, arg1) {
    arg0.abort(arg1);
}
export function __wbg_addEventListener_3f4b57aea6662d2e() { return handleError(function (arg0, arg1, arg2, arg3) {
    arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
}, arguments); }
export function __wbg_append_608dfb635ee8998f() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
    arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
}, arguments); }
export function __wbg_arrayBuffer_eb8e9ca620af2a19() { return handleError(function (arg0) {
    const ret = arg0.arrayBuffer();
    return ret;
}, arguments); }
export function __wbg_bistream_new(arg0) {
    const ret = BiStream.__wrap(arg0);
    return ret;
}
export function __wbg_body_ac1dad652946e6da(arg0) {
    const ret = arg0.body;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_buffer_60b8043cd926067d(arg0) {
    const ret = arg0.buffer;
    return ret;
}
export function __wbg_byobRequest_6342e5f2b232c0f9(arg0) {
    const ret = arg0.byobRequest;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_byteLength_607b856aa6c5a508(arg0) {
    const ret = arg0.byteLength;
    return ret;
}
export function __wbg_byteOffset_b26b63681c83856c(arg0) {
    const ret = arg0.byteOffset;
    return ret;
}
export function __wbg_call_2d781c1f4d5c0ef8() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_call_dcc2662fa17a72cf() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.call(arg1, arg2, arg3);
    return ret;
}, arguments); }
export function __wbg_call_f858478a02f9600f() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
    const ret = arg0.call(arg1, arg2, arg3, arg4);
    return ret;
}, arguments); }
export function __wbg_cancel_79b3bea07a1028e7(arg0) {
    const ret = arg0.cancel();
    return ret;
}
export function __wbg_catch_d7ed0375ab6532a5(arg0, arg1) {
    const ret = arg0.catch(arg1);
    return ret;
}
export function __wbg_clearTimeout_2256f1e7b94ef517(arg0) {
    const ret = clearTimeout(arg0);
    return ret;
}
export function __wbg_clearTimeout_47a40e3be01ed7a3() { return handleError(function (arg0, arg1) {
    arg0.clearTimeout(arg1);
}, arguments); }
export function __wbg_close_690d36108c557337() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_close_737b4b1fbc658540() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_close_af26905c832a88cb() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_code_aea376e2d265a64f(arg0) {
    const ret = arg0.code;
    return ret;
}
export function __wbg_code_bc4dde4d67926010(arg0) {
    const ret = arg0.code;
    return ret;
}
export function __wbg_crypto_38df2bab126b63dc(arg0) {
    const ret = arg0.crypto;
    return ret;
}
export function __wbg_data_a3d9ff9cdd801002(arg0) {
    const ret = arg0.data;
    return ret;
}
export function __wbg_debug_eaef3b49d572d680(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.debug(...v0);
}
export function __wbg_done_08ce71ee07e3bd17(arg0) {
    const ret = arg0.done;
    return ret;
}
export function __wbg_enqueue_ec3552838b4b7fbf() { return handleError(function (arg0, arg1) {
    arg0.enqueue(arg1);
}, arguments); }
export function __wbg_entries_5b8fe91cea59610e(arg0) {
    const ret = arg0.entries();
    return ret;
}
export function __wbg_error_71b0e71161a5f3a0(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.error(...v0);
}
export function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
}
export function __wbg_fetch_43b2f110608a59ff(arg0) {
    const ret = fetch(arg0);
    return ret;
}
export function __wbg_fetch_5550a88cf343aaa9(arg0, arg1) {
    const ret = arg0.fetch(arg1);
    return ret;
}
export function __wbg_getRandomValues_76dfc69825c9c552() { return handleError(function (arg0, arg1) {
    globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
}, arguments); }
export function __wbg_getRandomValues_c44a50d8cfdaebeb() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments); }
export function __wbg_getReader_9facd4f899beac89() { return handleError(function (arg0) {
    const ret = arg0.getReader();
    return ret;
}, arguments); }
export function __wbg_get_3ef1eba1850ade27() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_a8ee5c45dabc1b3b(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}
export function __wbg_get_done_d0ab690f8df5501f(arg0) {
    const ret = arg0.done;
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}
export function __wbg_get_value_548ae6adf5a174e4(arg0) {
    const ret = arg0.value;
    return ret;
}
export function __wbg_has_926ef2ff40b308cf() { return handleError(function (arg0, arg1) {
    const ret = Reflect.has(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_headers_eb2234545f9ff993(arg0) {
    const ret = arg0.headers;
    return ret;
}
export function __wbg_helloimageresult_new(arg0) {
    const ret = HelloImageResult.__wrap(arg0);
    return ret;
}
export function __wbg_instanceof_ArrayBuffer_101e2bf31071a9f6(arg0) {
    let result;
    try {
        result = arg0 instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Blob_c91af000f11c2d0b(arg0) {
    let result;
    try {
        result = arg0 instanceof Blob;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Response_9b4d9fd451e051b1(arg0) {
    let result;
    try {
        result = arg0 instanceof Response;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_isArray_33b91feb269ff46e(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
}
export function __wbg_length_b3416cf66a5452c8(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_length_ea16607d7b61445b(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_log_7a0760e115750083(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.log(...v0);
}
export function __wbg_message_e959edc81e4b6cb7(arg0, arg1) {
    const ret = arg1.message;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_middennode_new(arg0) {
    const ret = MiddenNode.__wrap(arg0);
    return ret;
}
export function __wbg_msCrypto_bd5a034af96bcba6(arg0) {
    const ret = arg0.msCrypto;
    return ret;
}
export function __wbg_new_0837727332ac86ba() { return handleError(function () {
    const ret = new Headers();
    return ret;
}, arguments); }
export function __wbg_new_227d7c05414eb861() {
    const ret = new Error();
    return ret;
}
export function __wbg_new_49d5571bd3f0c4d4() {
    const ret = new Map();
    return ret;
}
export function __wbg_new_5f486cdf45a04d78(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
}
export function __wbg_new_a70fbab9066b301f() {
    const ret = new Array();
    return ret;
}
export function __wbg_new_ab79df5bd7c26067() {
    const ret = new Object();
    return ret;
}
export function __wbg_new_c518c60af666645b() { return handleError(function () {
    const ret = new AbortController();
    return ret;
}, arguments); }
export function __wbg_new_d15cb560a6a0e5f0(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_new_dd50bcc3f60ba434() { return handleError(function (arg0, arg1) {
    const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_from_slice_22da9388ac046e50(arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_new_typed_aaaeaf29cf802876(arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__h5215e847daa20288(a, state0.b, arg0, arg1);
            } finally {
                state0.a = a;
            }
        };
        const ret = new Promise(cb0);
        return ret;
    } finally {
        state0.a = state0.b = 0;
    }
}
export function __wbg_new_with_byte_offset_and_length_b2ec5bf7b2f35743(arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
}
export function __wbg_new_with_length_825018a1616e9e55(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
}
export function __wbg_new_with_str_and_init_b4b54d1a819bc724() { return handleError(function (arg0, arg1, arg2) {
    const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
    return ret;
}, arguments); }
export function __wbg_new_with_str_sequence_82c04ad794ead10e() { return handleError(function (arg0, arg1, arg2) {
    const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
    return ret;
}, arguments); }
export function __wbg_next_11b99ee6237339e3() { return handleError(function (arg0) {
    const ret = arg0.next();
    return ret;
}, arguments); }
export function __wbg_node_84ea875411254db1(arg0) {
    const ret = arg0.node;
    return ret;
}
export function __wbg_now_16f0c993d5dd6c27() {
    const ret = Date.now();
    return ret;
}
export function __wbg_now_e7c6795a7f81e10f(arg0) {
    const ret = arg0.now();
    return ret;
}
export function __wbg_performance_3fcf6e32a7e1ed0a(arg0) {
    const ret = arg0.performance;
    return ret;
}
export function __wbg_process_44c7a14e11e9f69e(arg0) {
    const ret = arg0.process;
    return ret;
}
export function __wbg_protocol_1ac9e6bde227a312(arg0, arg1) {
    const ret = arg1.protocol;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_prototypesetcall_d62e5099504357e6(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}
export function __wbg_push_e87b0e732085a946(arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
}
export function __wbg_queueMicrotask_0c399741342fb10f(arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
}
export function __wbg_queueMicrotask_a082d78ce798393e(arg0) {
    queueMicrotask(arg0);
}
export function __wbg_radiohandle_new(arg0) {
    const ret = RadioHandle.__wrap(arg0);
    return ret;
}
export function __wbg_randomFillSync_6c25eac9869eb53c() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments); }
export function __wbg_read_7f593a961a7f80ed(arg0) {
    const ret = arg0.read();
    return ret;
}
export function __wbg_readyState_1f1e7f1bdf9f4d42(arg0) {
    const ret = arg0.readyState;
    return ret;
}
export function __wbg_reason_cbcb9911796c4714(arg0, arg1) {
    const ret = arg1.reason;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_releaseLock_ef7766a5da654ff8(arg0) {
    arg0.releaseLock();
}
export function __wbg_removeEventListener_c15bc311b6a5d11f() { return handleError(function (arg0, arg1, arg2, arg3) {
    arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
}, arguments); }
export function __wbg_require_b4edbdcf3e2a1ef0() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments); }
export function __wbg_resolve_ae8d83246e5bcc12(arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
}
export function __wbg_respond_e286ee502e7cf7e4() { return handleError(function (arg0, arg1) {
    arg0.respond(arg1 >>> 0);
}, arguments); }
export function __wbg_send_4a1dc66e8653e5ed() { return handleError(function (arg0, arg1, arg2) {
    arg0.send(getStringFromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_send_d31a693c975dea74() { return handleError(function (arg0, arg1, arg2) {
    arg0.send(getArrayU8FromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_setTimeout_6613a51400c1bf9f() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.setTimeout(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_setTimeout_b188b3bcc8977c7d(arg0, arg1) {
    const ret = setTimeout(arg0, arg1);
    return ret;
}
export function __wbg_set_282384002438957f(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
}
export function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}
export function __wbg_set_7eaa4f96924fd6b3() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(arg0, arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_set_8c0b3ffcf05d61c2(arg0, arg1, arg2) {
    arg0.set(getArrayU8FromWasm0(arg1, arg2));
}
export function __wbg_set_bf7251625df30a02(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
}
export function __wbg_set_binaryType_3dcf8281ec100a8f(arg0, arg1) {
    arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
}
export function __wbg_set_body_a3d856b097dfda04(arg0, arg1) {
    arg0.body = arg1;
}
export function __wbg_set_cache_ec7e430c6056ebda(arg0, arg1) {
    arg0.cache = __wbindgen_enum_RequestCache[arg1];
}
export function __wbg_set_credentials_ed63183445882c65(arg0, arg1) {
    arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
}
export function __wbg_set_handle_event_d54649fda219fb74(arg0, arg1) {
    arg0.handleEvent = arg1;
}
export function __wbg_set_headers_3c8fecc693b75327(arg0, arg1) {
    arg0.headers = arg1;
}
export function __wbg_set_method_8c015e8bcafd7be1(arg0, arg1, arg2) {
    arg0.method = getStringFromWasm0(arg1, arg2);
}
export function __wbg_set_mode_5a87f2c809cf37c2(arg0, arg1) {
    arg0.mode = __wbindgen_enum_RequestMode[arg1];
}
export function __wbg_set_onclose_8da801226bdd7a7b(arg0, arg1) {
    arg0.onclose = arg1;
}
export function __wbg_set_onerror_901ca711f94a5bbb(arg0, arg1) {
    arg0.onerror = arg1;
}
export function __wbg_set_onmessage_6f80ab771bf151aa(arg0, arg1) {
    arg0.onmessage = arg1;
}
export function __wbg_set_onopen_34e3e24cf9337ddd(arg0, arg1) {
    arg0.onopen = arg1;
}
export function __wbg_set_signal_0cebecb698f25d21(arg0, arg1) {
    arg0.signal = arg1;
}
export function __wbg_signal_166e1da31adcac18(arg0) {
    const ret = arg0.signal;
    return ret;
}
export function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_static_accessor_GLOBAL_8adb955bd33fac2f() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_SELF_f207c857566db248() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_WINDOW_bb9f1ba69d61b386() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_status_318629ab93a22955(arg0) {
    const ret = arg0.status;
    return ret;
}
export function __wbg_subarray_a068d24e39478a8a(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
}
export function __wbg_then_098abe61755d12f6(arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
}
export function __wbg_then_9e335f6dd892bc11(arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2);
    return ret;
}
export function __wbg_url_778f9516ea867e17(arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_url_7fefc1820fba4e0c(arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_value_21fc78aab0322612(arg0) {
    const ret = arg0.value;
    return ret;
}
export function __wbg_versions_276b2795b1c6a219(arg0) {
    const ret = arg0.versions;
    return ret;
}
export function __wbg_view_f68a712e7315f8b2(arg0) {
    const ret = arg0.view;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_warn_3a37cdd7216f1479(arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.warn(...v0);
}
export function __wbg_wasClean_69f68dc4ed2d2cc7(arg0) {
    const ret = arg0.wasClean;
    return ret;
}
export function __wbindgen_cast_0000000000000001(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 3029, function: Function { arguments: [NamedExternref("CloseEvent")], shim_idx: 3030, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h294ad2be3504387d, wasm_bindgen__convert__closures_____invoke__h3c1124d888de76f7);
    return ret;
}
export function __wbindgen_cast_0000000000000002(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 3185, function: Function { arguments: [], shim_idx: 3186, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h48b9cf57b0605b6c, wasm_bindgen__convert__closures_____invoke__h19ff6c226dd24a12);
    return ret;
}
export function __wbindgen_cast_0000000000000003(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 3234, function: Function { arguments: [Externref], shim_idx: 3235, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h7b9981a299ee41da, wasm_bindgen__convert__closures_____invoke__h5fadd8e123905fd5);
    return ret;
}
export function __wbindgen_cast_0000000000000004(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 3304, function: Function { arguments: [], shim_idx: 3305, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
    const ret = makeClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h04404acb79c6be20, wasm_bindgen__convert__closures_____invoke__h4a79afe2a4c38dc1);
    return ret;
}
export function __wbindgen_cast_0000000000000005(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 3725, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 3726, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h55c70129bcbd15b5, wasm_bindgen__convert__closures_____invoke__h409293f5a38f3a44);
    return ret;
}
export function __wbindgen_cast_0000000000000006(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 5058, function: Function { arguments: [], shim_idx: 5059, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__hc43fb2de202384f2, wasm_bindgen__convert__closures_____invoke__h45183445e49f200c);
    return ret;
}
export function __wbindgen_cast_0000000000000007(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 5067, function: Function { arguments: [Externref], shim_idx: 5068, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h8f8d4fe60e50c9c6, wasm_bindgen__convert__closures_____invoke__h6e9f0738c1296594);
    return ret;
}
export function __wbindgen_cast_0000000000000008(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000009(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_000000000000000a(arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_000000000000000b(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_000000000000000c(arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
function wasm_bindgen__convert__closures_____invoke__h19ff6c226dd24a12(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__h19ff6c226dd24a12(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h4a79afe2a4c38dc1(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__h4a79afe2a4c38dc1(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h45183445e49f200c(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__h45183445e49f200c(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h3c1124d888de76f7(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h3c1124d888de76f7(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h5fadd8e123905fd5(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h5fadd8e123905fd5(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h409293f5a38f3a44(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h409293f5a38f3a44(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h6e9f0738c1296594(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h6e9f0738c1296594(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h5215e847daa20288(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h5215e847daa20288(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_ReadableStreamType = ["bytes"];


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];


const __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];
const BiStreamFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bistream_free(ptr >>> 0, 1));
const HelloImageResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_helloimageresult_free(ptr >>> 0, 1));
const IntoUnderlyingByteSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingbytesource_free(ptr >>> 0, 1));
const IntoUnderlyingSinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsink_free(ptr >>> 0, 1));
const IntoUnderlyingSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsource_free(ptr >>> 0, 1));
const MiddenNodeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_middennode_free(ptr >>> 0, 1));
const RadioHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_radiohandle_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.dtor(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        try {
            return f(state.a, state.b, ...args);
        } finally {
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
