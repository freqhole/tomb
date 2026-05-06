//#region exports

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
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
            if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
            _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
            if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
            _assertNum(this.__wbg_ptr);
            const ret = wasm.bistream_peer_node_id(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(max_size);
        const ret = wasm.bistream_read_to_end(this.__wbg_ptr, max_size);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
     * @param {Uint8Array} data
     * @returns {Promise<void>}
     */
    write_raw_and_finish(data) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.helloimageresult_data(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) HelloImageResult.prototype[Symbol.dispose] = HelloImageResult.prototype.free;

export class IntoUnderlyingByteSource {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.intounderlyingbytesource_autoAllocateChunkSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    cancel() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        const ptr = this.__destroy_into_raw();
        _assertNum(ptr);
        wasm.intounderlyingbytesource_cancel(ptr);
    }
    /**
     * @param {ReadableByteStreamController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.intounderlyingbytesource_pull(this.__wbg_ptr, controller);
        return ret;
    }
    /**
     * @param {ReadableByteStreamController} controller
     */
    start(controller) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.intounderlyingbytesource_start(this.__wbg_ptr, controller);
    }
    /**
     * @returns {ReadableStreamType}
     */
    get type() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.intounderlyingbytesource_type(this.__wbg_ptr);
        return __wbindgen_enum_ReadableStreamType[ret];
    }
}
if (Symbol.dispose) IntoUnderlyingByteSource.prototype[Symbol.dispose] = IntoUnderlyingByteSource.prototype.free;

export class IntoUnderlyingSink {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        const ptr = this.__destroy_into_raw();
        _assertNum(ptr);
        const ret = wasm.intounderlyingsink_abort(ptr, reason);
        return ret;
    }
    /**
     * @returns {Promise<any>}
     */
    close() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        const ptr = this.__destroy_into_raw();
        _assertNum(ptr);
        const ret = wasm.intounderlyingsink_close(ptr);
        return ret;
    }
    /**
     * @param {any} chunk
     * @returns {Promise<any>}
     */
    write(chunk) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.intounderlyingsink_write(this.__wbg_ptr, chunk);
        return ret;
    }
}
if (Symbol.dispose) IntoUnderlyingSink.prototype[Symbol.dispose] = IntoUnderlyingSink.prototype.free;

export class IntoUnderlyingSource {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        const ptr = this.__destroy_into_raw();
        _assertNum(ptr);
        wasm.intounderlyingsource_cancel(ptr);
    }
    /**
     * @param {ReadableStreamDefaultController} controller
     * @returns {Promise<any>}
     */
    pull(controller) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennode_accept(this.__wbg_ptr);
        return ret;
    }
    /**
     * return the number of blobs currently held in the store via active TempTags.
     * @returns {number}
     */
    active_blob_count() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
            if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
            _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
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
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.radiohandle_leave(this.__wbg_ptr);
    }
}
if (Symbol.dispose) RadioHandle.prototype[Symbol.dispose] = RadioHandle.prototype.free;

/**
 * Debug API exposed to browser console for terminal inspection.
 */
export class TerminalDebugApi {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(TerminalDebugApi.prototype);
        obj.__wbg_ptr = ptr;
        TerminalDebugApiFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TerminalDebugApiFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_terminaldebugapi_free(ptr, 0);
    }
    /**
     * Returns the full atlas glyph-to-symbol mapping as a JavaScript array.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript objects fails.
     * @returns {Array<any>}
     */
    getAtlasLookup() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getAtlasLookup(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the base glyph ID for a given symbol, or null if not found.
     * @param {string} symbol
     * @returns {number | undefined}
     */
    getBaseGlyphId(symbol) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(symbol, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.terminaldebugapi_getBaseGlyphId(this.__wbg_ptr, ptr0, len0);
        return ret === 0xFFFFFF ? undefined : ret;
    }
    /**
     * Returns the canvas size in pixels as an object with `width` and `height` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getCanvasSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getCanvasSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the cell size in pixels as an object with `width` and `height` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getCellSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getCellSize(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the number of glyphs available in the font atlas.
     * @returns {number}
     */
    getGlyphCount() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getGlyphCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Returns an array of glyphs that were requested but not found in the font atlas.
     * @returns {Array<any>}
     */
    getMissingGlyphs() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getMissingGlyphs(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the symbol for a given glyph ID, or null if not found.
     * @param {number} glyph_id
     * @returns {string | undefined}
     */
    getSymbol(glyph_id) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        _assertNum(glyph_id);
        const ret = wasm.terminaldebugapi_getSymbol(this.__wbg_ptr, glyph_id);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Returns the terminal size in cells as an object with `cols` and `rows` fields.
     *
     * # Panics
     *
     * Panics if setting properties on the JavaScript object fails.
     * @returns {any}
     */
    getTerminalSize() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.terminaldebugapi_getTerminalSize(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) TerminalDebugApi.prototype[Symbol.dispose] = TerminalDebugApi.prototype.free;

/**
 * wasm entry. invoked from js after the module loads. async because
 * `MiddenNode::create()` is async — the returned `Promise` resolves
 * once the iroh endpoint is bound and the relay (if any) connected.
 *
 * note: named `boot` (not `start`) to avoid colliding with midden's
 * `#[wasm_bindgen(start)]` describe symbol when both crates are linked.
 * @returns {Promise<void>}
 */
export function boot() {
    const ret = wasm.boot();
    return ret;
}

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

//#endregion

//#region wasm imports
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_960c155d3d49e4c2: function() { return logError(function (arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_String_8564e559799eccda: function() { return logError(function (arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg___wbindgen_boolean_get_6ea149f0a8dcc5ff: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            if (!isLikeNone(ret)) {
                _assertBoolean(ret);
            }
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_ab4b34d23d6778bd: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_3baa9db1a987f47d: function(arg0) {
            const ret = typeof(arg0) === 'function';
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_is_null_52ff4ec04186736f: function(arg0) {
            const ret = arg0 === null;
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_is_object_63322ec0cd6ea4ef: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_is_string_6df3bf7ef1164ed3: function(arg0) {
            const ret = typeof(arg0) === 'string';
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_is_undefined_29a43b4d42920abd: function(arg0) {
            const ret = arg0 === undefined;
            _assertBoolean(ret);
            return ret;
        },
        __wbg___wbindgen_number_get_c7f42aed0525c451: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            if (!isLikeNone(ret)) {
                _assertNum(ret);
            }
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_7ed5322991caaec5: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_b46c9b5a9f08ec37: function() { return logError(function (arg0) {
            arg0._wbg_cb_unref();
        }, arguments); },
        __wbg_abort_4ce5b484434ef6fd: function() { return logError(function (arg0) {
            arg0.abort();
        }, arguments); },
        __wbg_abort_d53712380a54cc81: function() { return logError(function (arg0, arg1) {
            arg0.abort(arg1);
        }, arguments); },
        __wbg_activeTexture_3df5a43f55a69a6c: function() { return logError(function (arg0, arg1) {
            arg0.activeTexture(arg1 >>> 0);
        }, arguments); },
        __wbg_activeTexture_546afc38eb98df71: function() { return logError(function (arg0, arg1) {
            arg0.activeTexture(arg1 >>> 0);
        }, arguments); },
        __wbg_addEventListener_2ed1344165a839a7: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3, arg4 !== 0);
        }, arguments); },
        __wbg_addEventListener_8176dab41b09531c: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_addEventListener_872d6537eadf7bec: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_altKey_3116112ec764f316: function() { return logError(function (arg0) {
            const ret = arg0.altKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_altKey_c4f26b40f1b826b4: function() { return logError(function (arg0) {
            const ret = arg0.altKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_appendChild_e95c8b3b936d250a: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.appendChild(arg1);
            return ret;
        }, arguments); },
        __wbg_append_e8fc56ce7c00e874: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_arrayBuffer_848c392b70c67d3d: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_attachShader_1eec3a0d2bfe6f83: function() { return logError(function (arg0, arg1, arg2) {
            arg0.attachShader(arg1, arg2);
        }, arguments); },
        __wbg_attachShader_e1c4cb1f00f167df: function() { return logError(function (arg0, arg1, arg2) {
            arg0.attachShader(arg1, arg2);
        }, arguments); },
        __wbg_beginPath_b4ec56dc6dbd28c7: function() { return logError(function (arg0) {
            arg0.beginPath();
        }, arguments); },
        __wbg_bindBufferBase_a0b97da288b2e5bc: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bindBufferBase(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_bindBuffer_710a611286e86fe9: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindBuffer(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindBuffer_b193f35215c88d5d: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindBuffer(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindTexture_a87fb41b3319bcb9: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindTexture(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindTexture_c3fcb7dc0c448083: function() { return logError(function (arg0, arg1, arg2) {
            arg0.bindTexture(arg1 >>> 0, arg2);
        }, arguments); },
        __wbg_bindVertexArrayOES_b0e8a5a6c8a88c84: function() { return logError(function (arg0, arg1) {
            arg0.bindVertexArrayOES(arg1);
        }, arguments); },
        __wbg_bindVertexArray_ea785b5f2238eb93: function() { return logError(function (arg0, arg1) {
            arg0.bindVertexArray(arg1);
        }, arguments); },
        __wbg_bistream_new: function() { return logError(function (arg0) {
            const ret = BiStream.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_body_0c3a51aec038a31a: function() { return logError(function (arg0) {
            const ret = arg0.body;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_body_c7b35a55457167ba: function() { return logError(function (arg0) {
            const ret = arg0.body;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_bufferData_f267cdc80efbd6a0: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferData(arg1 >>> 0, arg2, arg3 >>> 0);
        }, arguments); },
        __wbg_bufferData_f401229c915b8028: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferData(arg1 >>> 0, arg2, arg3 >>> 0);
        }, arguments); },
        __wbg_bufferSubData_3708c0445a03981a: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferSubData(arg1 >>> 0, arg2, arg3);
        }, arguments); },
        __wbg_bufferSubData_ade66d88865db9fc: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.bufferSubData(arg1 >>> 0, arg2, arg3);
        }, arguments); },
        __wbg_buffer_d0f5ea0926a691fd: function() { return logError(function (arg0) {
            const ret = arg0.buffer;
            return ret;
        }, arguments); },
        __wbg_button_c794bf4b1dcd7c4c: function() { return logError(function (arg0) {
            const ret = arg0.button;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_byobRequest_dc6aed9db01b12c6: function() { return logError(function (arg0) {
            const ret = arg0.byobRequest;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_byteLength_3e660e5661f3327e: function() { return logError(function (arg0) {
            const ret = arg0.byteLength;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_byteOffset_ecd62abe44dd28d4: function() { return logError(function (arg0) {
            const ret = arg0.byteOffset;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_call_86e39d65afc3d9db: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_a24592a6f349a97e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_bb28efe6b2f55b86: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_cancel_ceb1bda02e29f0a9: function() { return logError(function (arg0) {
            const ret = arg0.cancel();
            return ret;
        }, arguments); },
        __wbg_catch_e9362815fd0b24cf: function() { return logError(function (arg0, arg1) {
            const ret = arg0.catch(arg1);
            return ret;
        }, arguments); },
        __wbg_clearColor_2b334a2a4b9f1124: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearColor(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clearColor_6e92030afcf0f68f: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearColor(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clearRect_b5a1c34799cc9fcf: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.clearRect(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_clearTimeout_2256f1e7b94ef517: function() { return logError(function (arg0) {
            const ret = clearTimeout(arg0);
            return ret;
        }, arguments); },
        __wbg_clearTimeout_47a40e3be01ed7a3: function() { return handleError(function (arg0, arg1) {
            arg0.clearTimeout(arg1);
        }, arguments); },
        __wbg_clear_d82c0c485d1af30e: function() { return logError(function (arg0, arg1) {
            arg0.clear(arg1 >>> 0);
        }, arguments); },
        __wbg_clear_e39cde04b063e709: function() { return logError(function (arg0, arg1) {
            arg0.clear(arg1 >>> 0);
        }, arguments); },
        __wbg_clientHeight_01b31bebacb195f0: function() { return logError(function (arg0) {
            const ret = arg0.clientHeight;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_clientWidth_188be30d8e061ee5: function() { return logError(function (arg0) {
            const ret = arg0.clientWidth;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_clip_4681bd12b584a12f: function() { return logError(function (arg0) {
            arg0.clip();
        }, arguments); },
        __wbg_clipboardData_f03e3b5606f47f6d: function() { return logError(function (arg0) {
            const ret = arg0.clipboardData;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_clipboard_a08ffae077ba7949: function() { return logError(function (arg0) {
            const ret = arg0.clipboard;
            return ret;
        }, arguments); },
        __wbg_close_88106990eea7f544: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_e6c8977a002e9e13: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_close_fb954dfaf67b5732: function() { return handleError(function (arg0) {
            arg0.close();
        }, arguments); },
        __wbg_code_c4f315d8dc91de14: function() { return logError(function (arg0) {
            const ret = arg0.code;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_code_e2d14bb68011f972: function() { return logError(function (arg0) {
            const ret = arg0.code;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_commit_f3306d9b329a3e06: function() { return handleError(function (arg0) {
            arg0.commit();
        }, arguments); },
        __wbg_compileShader_b39b7d5caca97c9d: function() { return logError(function (arg0, arg1) {
            arg0.compileShader(arg1);
        }, arguments); },
        __wbg_compileShader_fc084de511370bc0: function() { return logError(function (arg0, arg1) {
            arg0.compileShader(arg1);
        }, arguments); },
        __wbg_createBuffer_6ad9886c8fed1a21: function() { return logError(function (arg0) {
            const ret = arg0.createBuffer();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createBuffer_f68202a47c36c3d6: function() { return logError(function (arg0) {
            const ret = arg0.createBuffer();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createElement_bbd4c90086fe6f7b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.createElement(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_createObjectURL_46e1b0c55389893b: function() { return handleError(function (arg0, arg1) {
            const ret = URL.createObjectURL(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_createProgram_635f6f85c5f3c83d: function() { return logError(function (arg0) {
            const ret = arg0.createProgram();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createProgram_bedc70c0d16e41df: function() { return logError(function (arg0) {
            const ret = arg0.createProgram();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createShader_2c8d8c9f17967efe: function() { return logError(function (arg0, arg1) {
            const ret = arg0.createShader(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createShader_5484e429d7514a9d: function() { return logError(function (arg0, arg1) {
            const ret = arg0.createShader(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createTexture_caeb4349ae5c7a83: function() { return logError(function (arg0) {
            const ret = arg0.createTexture();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createTexture_f9850d55f04c7883: function() { return logError(function (arg0) {
            const ret = arg0.createTexture();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createVertexArrayOES_25823ca742b59551: function() { return logError(function (arg0) {
            const ret = arg0.createVertexArrayOES();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_createVertexArray_a8c3e6799bdb5af8: function() { return logError(function (arg0) {
            const ret = arg0.createVertexArray();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_crypto_29aef212cef5071d: function() { return handleError(function (arg0) {
            const ret = arg0.crypto;
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function() { return logError(function (arg0) {
            const ret = arg0.crypto;
            return ret;
        }, arguments); },
        __wbg_ctrlKey_31968cccd46bdef6: function() { return logError(function (arg0) {
            const ret = arg0.ctrlKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_ctrlKey_a49693667722b909: function() { return logError(function (arg0) {
            const ret = arg0.ctrlKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_currentTime_ed6ce93e843d1f92: function() { return logError(function (arg0) {
            const ret = arg0.currentTime;
            return ret;
        }, arguments); },
        __wbg_data_b5233fd85361a418: function() { return logError(function (arg0, arg1) {
            const ret = arg1.data;
            const ptr1 = passArray8ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_data_bb9dffdd1e99cf2d: function() { return logError(function (arg0) {
            const ret = arg0.data;
            return ret;
        }, arguments); },
        __wbg_debug_514c7d0e60446ced: function() { return logError(function (arg0, arg1) {
            console.debug(arg0, arg1);
        }, arguments); },
        __wbg_debug_eaef3b49d572d680: function() { return logError(function (arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            console.debug(...v0);
        }, arguments); },
        __wbg_deleteBuffer_521c77539f9941c1: function() { return logError(function (arg0, arg1) {
            arg0.deleteBuffer(arg1);
        }, arguments); },
        __wbg_deleteBuffer_558c85bd550b15df: function() { return logError(function (arg0, arg1) {
            arg0.deleteBuffer(arg1);
        }, arguments); },
        __wbg_deleteProgram_6d3a2bdf7fc6d658: function() { return logError(function (arg0, arg1) {
            arg0.deleteProgram(arg1);
        }, arguments); },
        __wbg_deleteProgram_8175823e816f19ed: function() { return logError(function (arg0, arg1) {
            arg0.deleteProgram(arg1);
        }, arguments); },
        __wbg_deleteShader_379785984071d8af: function() { return logError(function (arg0, arg1) {
            arg0.deleteShader(arg1);
        }, arguments); },
        __wbg_deleteShader_460e3d0b80ea3790: function() { return logError(function (arg0, arg1) {
            arg0.deleteShader(arg1);
        }, arguments); },
        __wbg_deleteTexture_6de16581bf7e5e00: function() { return logError(function (arg0, arg1) {
            arg0.deleteTexture(arg1);
        }, arguments); },
        __wbg_deleteTexture_8714aac647598458: function() { return logError(function (arg0, arg1) {
            arg0.deleteTexture(arg1);
        }, arguments); },
        __wbg_delete_10b3489d089185d7: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.delete(arg1);
            return ret;
        }, arguments); },
        __wbg_devicePixelRatio_18e6533e6d7f4088: function() { return logError(function (arg0) {
            const ret = arg0.devicePixelRatio;
            return ret;
        }, arguments); },
        __wbg_document_7a41071f2f439323: function() { return logError(function (arg0) {
            const ret = arg0.document;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_done_9158f7cc8751ba32: function() { return logError(function (arg0) {
            const ret = arg0.done;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_drawElementsInstancedANGLE_01b7fe3dcfda1f57: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.drawElementsInstancedANGLE(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_drawElementsInstanced_9cdd75777f6fe52e: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.drawElementsInstanced(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_duration_dff62afc73b8479d: function() { return logError(function (arg0) {
            const ret = arg0.duration;
            return ret;
        }, arguments); },
        __wbg_enableVertexAttribArray_44d2f9d5bd7d4773: function() { return logError(function (arg0, arg1) {
            arg0.enableVertexAttribArray(arg1 >>> 0);
        }, arguments); },
        __wbg_enableVertexAttribArray_a6fb4500c619f67f: function() { return logError(function (arg0, arg1) {
            arg0.enableVertexAttribArray(arg1 >>> 0);
        }, arguments); },
        __wbg_ended_169e869435b2b5d2: function() { return logError(function (arg0) {
            const ret = arg0.ended;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_enqueue_4767ce322820c94d: function() { return handleError(function (arg0, arg1) {
            arg0.enqueue(arg1);
        }, arguments); },
        __wbg_entries_bf727fcd7bf35a41: function() { return logError(function (arg0) {
            const ret = arg0.entries();
            return ret;
        }, arguments); },
        __wbg_error_176f747c592e7ba3: function() { return logError(function (arg0) {
            const ret = arg0.error;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_error_2001591ad2463697: function() { return logError(function (arg0) {
            console.error(arg0);
        }, arguments); },
        __wbg_error_43690a185e0311ac: function() { return handleError(function (arg0) {
            const ret = arg0.error;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_error_71b0e71161a5f3a0: function() { return logError(function (arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            console.error(...v0);
        }, arguments); },
        __wbg_error_a6fa202b58aa1cd3: function() { return logError(function (arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        }, arguments); },
        __wbg_fetch_0d322c0aed196b8b: function() { return logError(function (arg0, arg1) {
            const ret = arg0.fetch(arg1);
            return ret;
        }, arguments); },
        __wbg_fetch_43b2f110608a59ff: function() { return logError(function (arg0) {
            const ret = fetch(arg0);
            return ret;
        }, arguments); },
        __wbg_fillText_8aaa9fc0088bfe5b: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.fillText(getStringFromWasm0(arg1, arg2), arg3, arg4);
        }, arguments); },
        __wbg_getAll_1050a25926d2df6c: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getAll(arg1);
            return ret;
        }, arguments); },
        __wbg_getAll_7f3a9865edd84fcd: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getAll(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getAll_a898878594f5e590: function() { return handleError(function (arg0) {
            const ret = arg0.getAll();
            return ret;
        }, arguments); },
        __wbg_getAttribute_8627dea35cdb7b06: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.getAttribute(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getContext_69ddc504535a2e7b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getContext_fc146f8ec021d074: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getData_a20c218e8ae28672: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.getData(getStringFromWasm0(arg2, arg3));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getElementById_0b5a508c91194690: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getElementById(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getExtension_5228364a0715c7db: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getExtension(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getImageData_1b529eb619aaa4b1: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.getImageData(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_getParameter_594f21b1d26abeed: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getParameter(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getParameter_e1c6e394a2959d43: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getParameter(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getProgramInfoLog_00af0d3e29c73293: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getProgramInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getProgramInfoLog_612d2724e854e752: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getProgramInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getProgramParameter_6aa39c38709e0d9d: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getProgramParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getProgramParameter_d18275e84d037799: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getProgramParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getRandomValues_76dfc69825c9c552: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_getRandomValues_d696488e492c36ff: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getRandomValues(arg1);
            return ret;
        }, arguments); },
        __wbg_getReader_9facd4f899beac89: function() { return handleError(function (arg0) {
            const ret = arg0.getReader();
            return ret;
        }, arguments); },
        __wbg_getShaderInfoLog_57fd85336a768aa9: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getShaderInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getShaderInfoLog_ef603aa10b52d639: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1.getShaderInfoLog(arg2);
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getShaderParameter_4676ea57a8db83ec: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getShaderParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getShaderParameter_f1ed538581985875: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.getShaderParameter(arg1, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_getSupportedExtensions_a6b7a4d43810c644: function() { return logError(function (arg0) {
            const ret = arg0.getSupportedExtensions();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getUniformBlockIndex_79370b4799b9dd60: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformBlockIndex(arg1, getStringFromWasm0(arg2, arg3));
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_getUniformLocation_084155a4348002df: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformLocation(arg1, getStringFromWasm0(arg2, arg3));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getUniformLocation_91e9e13f695e50c5: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.getUniformLocation(arg1, getStringFromWasm0(arg2, arg3));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_get_11e6a39c9721f332: function() { return logError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.get(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_get_59664ef421721a7e: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg1[arg2 >>> 0];
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_get_6011fa3a58f61074: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_803cfa78503173c3: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.get(arg1);
            return ret;
        }, arguments); },
        __wbg_get_8360291721e2339f: function() { return logError(function (arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        }, arguments); },
        __wbg_get_done_282bca5d3f90e0a8: function() { return logError(function (arg0) {
            const ret = arg0.done;
            if (!isLikeNone(ret)) {
                _assertBoolean(ret);
            }
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        }, arguments); },
        __wbg_get_unchecked_17f53dad852b9588: function() { return logError(function (arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        }, arguments); },
        __wbg_get_value_65a7a2c60b42fd75: function() { return logError(function (arg0) {
            const ret = arg0.value;
            return ret;
        }, arguments); },
        __wbg_has_880f1d472f7cecba: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_headers_6022deb4e576fb8e: function() { return logError(function (arg0) {
            const ret = arg0.headers;
            return ret;
        }, arguments); },
        __wbg_height_528848d067cc2221: function() { return logError(function (arg0) {
            const ret = arg0.height;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_height_fc2f1def9f6e7730: function() { return logError(function (arg0) {
            const ret = arg0.height;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_helloimageresult_new: function() { return logError(function (arg0) {
            const ret = HelloImageResult.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_innerHeight_72e7bb88c4b9ede8: function() { return handleError(function (arg0) {
            const ret = arg0.innerHeight;
            return ret;
        }, arguments); },
        __wbg_innerWidth_c7446907ab672e41: function() { return handleError(function (arg0) {
            const ret = arg0.innerWidth;
            return ret;
        }, arguments); },
        __wbg_instanceof_ArrayBuffer_7c8433c6ed14ffe3: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Blob_10148a11a16aee87: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Blob;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Element_56c8d987654f359e: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Element;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_HtmlAudioElement_c2affb8eafa47d12: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLAudioElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_HtmlCanvasElement_ea4dfc3bb77c734b: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLCanvasElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_IdbDatabase_3b6930bc25a91170: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof IDBDatabase;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_IdbFactory_8af6762731f44f3b: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof IDBFactory;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_IdbOpenDbRequest_d0071b8c6aae51ff: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof IDBOpenDBRequest;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_IdbRequest_cb20b218916840b2: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof IDBRequest;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_IdbTransaction_30097053aa3abb1e: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof IDBTransaction;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_OffscreenCanvasRenderingContext2d_285a274020b4f230: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof OffscreenCanvasRenderingContext2D;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Response_9b2d111407865ff2: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Uint8Array_152ba1f289edcf3f: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_WebGl2RenderingContext_23f2da2f294d4c8e: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof WebGL2RenderingContext;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_instanceof_Window_cc64c86c8ef9e02b: function() { return logError(function (arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_isArray_c3109d14ffc06469: function() { return logError(function (arg0) {
            const ret = Array.isArray(arg0);
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_isContextLost_08db9c8003a26317: function() { return logError(function (arg0) {
            const ret = arg0.isContextLost();
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_key_2cbc38fa83cdb336: function() { return logError(function (arg0, arg1) {
            const ret = arg1.key;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_length_167a2db2c5f76499: function() { return logError(function (arg0) {
            const ret = arg0.length;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_length_3d4ecd04bd8d22f1: function() { return logError(function (arg0) {
            const ret = arg0.length;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_length_9f1775224cf1d815: function() { return logError(function (arg0) {
            const ret = arg0.length;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_linkProgram_0f095b446d393a30: function() { return logError(function (arg0, arg1) {
            arg0.linkProgram(arg1);
        }, arguments); },
        __wbg_linkProgram_aa5b01ff0fcf3a80: function() { return logError(function (arg0, arg1) {
            arg0.linkProgram(arg1);
        }, arguments); },
        __wbg_location_73c89ca5bb53ddf3: function() { return logError(function (arg0) {
            const ret = arg0.location;
            return ret;
        }, arguments); },
        __wbg_log_7a0760e115750083: function() { return logError(function (arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            console.log(...v0);
        }, arguments); },
        __wbg_log_7e1aa9064a1dbdbd: function() { return logError(function (arg0) {
            console.log(arg0);
        }, arguments); },
        __wbg_mark_ab30dfc6cf11130f: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.mark(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_measure_6eb97f50378785c5: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.measure(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_message_ec476bcf269dd7c4: function() { return logError(function (arg0, arg1) {
            const ret = arg1.message;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_metaKey_665498d01ebfd062: function() { return logError(function (arg0) {
            const ret = arg0.metaKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_metaKey_f8f3c1d2a5b88850: function() { return logError(function (arg0) {
            const ret = arg0.metaKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_middennode_new: function() { return logError(function (arg0) {
            const ret = MiddenNode.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_msCrypto_bd5a034af96bcba6: function() { return logError(function (arg0) {
            const ret = arg0.msCrypto;
            return ret;
        }, arguments); },
        __wbg_navigator_bc077756492232c5: function() { return logError(function (arg0) {
            const ret = arg0.navigator;
            return ret;
        }, arguments); },
        __wbg_new_0c7403db6e782f19: function() { return logError(function (arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        }, arguments); },
        __wbg_new_15a4889b4b90734d: function() { return handleError(function () {
            const ret = new Headers();
            return ret;
        }, arguments); },
        __wbg_new_227d7c05414eb861: function() { return logError(function () {
            const ret = new Error();
            return ret;
        }, arguments); },
        __wbg_new_2a6e9133304ae2bf: function() { return handleError(function (arg0, arg1) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_34d45cc8e36aaead: function() { return logError(function () {
            const ret = new Map();
            return ret;
        }, arguments); },
        __wbg_new_5e360d2ff7b9e1c3: function() { return logError(function (arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_682678e2f47e32bc: function() { return logError(function () {
            const ret = new Array();
            return ret;
        }, arguments); },
        __wbg_new_98c22165a42231aa: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_aa8d0fa9762c29bd: function() { return logError(function () {
            const ret = new Object();
            return ret;
        }, arguments); },
        __wbg_new_af890c4e1a2d9b0a: function() { return handleError(function (arg0, arg1) {
            const ret = new OffscreenCanvas(arg0 >>> 0, arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_b5ea43e23f6008c0: function() { return logError(function (arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_typed_323f37fd55ab048d: function() { return logError(function (arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h5f1feff97ef5b238(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        }, arguments); },
        __wbg_new_with_buffer_source_sequence_and_options_5c932e0df134d541: function() { return handleError(function (arg0, arg1) {
            const ret = new Blob(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_new_with_byte_offset_and_length_01848e8d6a3d49ad: function() { return logError(function (arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_new_with_length_8c854e41ea4dae9b: function() { return logError(function (arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        }, arguments); },
        __wbg_new_with_str_04d11e3fcb860ce4: function() { return handleError(function (arg0, arg1) {
            const ret = new URLSearchParams(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_new_with_str_and_init_897be1708e42f39d: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_with_str_sequence_6453b755acdcc2e7: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_next_0340c4ae324393c3: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_node_84ea875411254db1: function() { return logError(function (arg0) {
            const ret = arg0.node;
            return ret;
        }, arguments); },
        __wbg_now_a9b7df1cbee90986: function() { return logError(function () {
            const ret = Date.now();
            return ret;
        }, arguments); },
        __wbg_now_e7c6795a7f81e10f: function() { return logError(function (arg0) {
            const ret = arg0.now();
            return ret;
        }, arguments); },
        __wbg_objectStoreNames_c755717c02e8876b: function() { return logError(function (arg0) {
            const ret = arg0.objectStoreNames;
            return ret;
        }, arguments); },
        __wbg_objectStore_5942e8f91c946be8: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_offsetX_a88ab66c480b77a3: function() { return logError(function (arg0) {
            const ret = arg0.offsetX;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_offsetY_679a899b0b60c036: function() { return logError(function (arg0) {
            const ret = arg0.offsetY;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_open_0949b7cdde2ab99a: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.open(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_open_90f4e40d36c2c9f5: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
            return ret;
        }, arguments); },
        __wbg_pause_4d31251d7f5adac1: function() { return handleError(function (arg0) {
            arg0.pause();
        }, arguments); },
        __wbg_performance_3fcf6e32a7e1ed0a: function() { return logError(function (arg0) {
            const ret = arg0.performance;
            return ret;
        }, arguments); },
        __wbg_performance_e0409977f06d6f6b: function() { return logError(function (arg0) {
            const ret = arg0.performance;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_play_c4046eb80d8ddda8: function() { return handleError(function (arg0) {
            const ret = arg0.play();
            return ret;
        }, arguments); },
        __wbg_preventDefault_f55c01cb5fd2bcc0: function() { return logError(function (arg0) {
            arg0.preventDefault();
        }, arguments); },
        __wbg_process_44c7a14e11e9f69e: function() { return logError(function (arg0) {
            const ret = arg0.process;
            return ret;
        }, arguments); },
        __wbg_protocol_b901d6b01a8d0d83: function() { return logError(function (arg0, arg1) {
            const ret = arg1.protocol;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_prototypesetcall_a6b02eb00b0f4ce2: function() { return logError(function (arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        }, arguments); },
        __wbg_push_471a5b068a5295f6: function() { return logError(function (arg0, arg1) {
            const ret = arg0.push(arg1);
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_put_2d1082795891ee40: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.put(arg1);
            return ret;
        }, arguments); },
        __wbg_put_fd02d3070a55994c: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.put(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_querySelector_8d395ebd237ebd46: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.querySelector(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_queueMicrotask_5d15a957e6aa920e: function() { return logError(function (arg0) {
            queueMicrotask(arg0);
        }, arguments); },
        __wbg_queueMicrotask_f8819e5ffc402f36: function() { return logError(function (arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        }, arguments); },
        __wbg_radiohandle_new: function() { return logError(function (arg0) {
            const ret = RadioHandle.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_read_ddc2d178d2e57272: function() { return logError(function (arg0) {
            const ret = arg0.read();
            return ret;
        }, arguments); },
        __wbg_readyState_c78e609c7de3b381: function() { return logError(function (arg0) {
            const ret = arg0.readyState;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_reason_e943590a4ef0d587: function() { return logError(function (arg0, arg1) {
            const ret = arg1.reason;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_rect_23ab6daae0a2a799: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.rect(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_releaseLock_9baaf3ccc5cfad69: function() { return logError(function (arg0) {
            arg0.releaseLock();
        }, arguments); },
        __wbg_removeEventListener_0634324250b098cc: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_removeEventListener_7bdf07404d9b24bd: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_requestAnimationFrame_6f039d778639cc28: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.requestAnimationFrame(arg1);
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_e6c466bc1052f16c: function() { return logError(function (arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        }, arguments); },
        __wbg_respond_008ca9525ae22847: function() { return handleError(function (arg0, arg1) {
            arg0.respond(arg1 >>> 0);
        }, arguments); },
        __wbg_restore_42cdb8bfdf76deac: function() { return logError(function (arg0) {
            arg0.restore();
        }, arguments); },
        __wbg_result_f782323755b96dc8: function() { return handleError(function (arg0) {
            const ret = arg0.result;
            return ret;
        }, arguments); },
        __wbg_run_0b0a622deae25fda: function() { return logError(function (arg0, arg1, arg2) {
            try {
                var state0 = {a: arg1, b: arg2};
                var cb0 = () => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h6a214642496403cd(a, state0.b, );
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = arg0.run(cb0);
                _assertBoolean(ret);
                return ret;
            } finally {
                state0.a = 0;
            }
        }, arguments); },
        __wbg_save_ba600b0595ba2d8c: function() { return logError(function (arg0) {
            arg0.save();
        }, arguments); },
        __wbg_search_ceee70e1153af3ec: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.search;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_send_15358dbe221c6258: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_send_186c85704c7f2d00: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.send(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_setAttribute_6fde4098d274155c: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setAttribute(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setProperty_0d903d23a71dfe70: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setProperty(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setTimeout_6613a51400c1bf9f: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_setTimeout_b188b3bcc8977c7d: function() { return logError(function (arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_set_022bee52d0b05b19: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_set_3bf1de9fab0cd644: function() { return logError(function (arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        }, arguments); },
        __wbg_set_3d484eb794afec82: function() { return logError(function (arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_set_6be42768c690e380: function() { return logError(function (arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        }, arguments); },
        __wbg_set_binaryType_770e68648ca5e83d: function() { return logError(function (arg0, arg1) {
            arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
        }, arguments); },
        __wbg_set_body_be11680f34217f75: function() { return logError(function (arg0, arg1) {
            arg0.body = arg1;
        }, arguments); },
        __wbg_set_cache_968edea422613d1b: function() { return logError(function (arg0, arg1) {
            arg0.cache = __wbindgen_enum_RequestCache[arg1];
        }, arguments); },
        __wbg_set_credentials_6577be90e0e85eb6: function() { return logError(function (arg0, arg1) {
            arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
        }, arguments); },
        __wbg_set_currentTime_8dff14aaffa6af0b: function() { return logError(function (arg0, arg1) {
            arg0.currentTime = arg1;
        }, arguments); },
        __wbg_set_fde2cec06c23692b: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_fillStyle_0576080e32ad721b: function() { return logError(function (arg0, arg1, arg2) {
            arg0.fillStyle = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_font_a19f1499878e7211: function() { return logError(function (arg0, arg1, arg2) {
            arg0.font = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_handle_event_18c81b21e4853d37: function() { return logError(function (arg0, arg1) {
            arg0.handleEvent = arg1;
        }, arguments); },
        __wbg_set_headers_50fc01786240a440: function() { return logError(function (arg0, arg1) {
            arg0.headers = arg1;
        }, arguments); },
        __wbg_set_height_24d07d982f176ac6: function() { return logError(function (arg0, arg1) {
            arg0.height = arg1 >>> 0;
        }, arguments); },
        __wbg_set_height_be9b2b920bd68401: function() { return logError(function (arg0, arg1) {
            arg0.height = arg1 >>> 0;
        }, arguments); },
        __wbg_set_method_c9f1f985f6b6c427: function() { return logError(function (arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_mode_5e08d503428c06b9: function() { return logError(function (arg0, arg1) {
            arg0.mode = __wbindgen_enum_RequestMode[arg1];
        }, arguments); },
        __wbg_set_onabort_7eecdbabbc4fd5f8: function() { return logError(function (arg0, arg1) {
            arg0.onabort = arg1;
        }, arguments); },
        __wbg_set_onclose_17fa3bbcc4ba3541: function() { return logError(function (arg0, arg1) {
            arg0.onclose = arg1;
        }, arguments); },
        __wbg_set_oncomplete_8c9c4dac8e331f19: function() { return logError(function (arg0, arg1) {
            arg0.oncomplete = arg1;
        }, arguments); },
        __wbg_set_onerror_5cae5e3b994ad11f: function() { return logError(function (arg0, arg1) {
            arg0.onerror = arg1;
        }, arguments); },
        __wbg_set_onerror_da99c4232662a084: function() { return logError(function (arg0, arg1) {
            arg0.onerror = arg1;
        }, arguments); },
        __wbg_set_onerror_ed658d0b50b67e95: function() { return logError(function (arg0, arg1) {
            arg0.onerror = arg1;
        }, arguments); },
        __wbg_set_onmessage_c1db358b9c38e3f1: function() { return logError(function (arg0, arg1) {
            arg0.onmessage = arg1;
        }, arguments); },
        __wbg_set_onopen_cd47b8fb1d92dee9: function() { return logError(function (arg0, arg1) {
            arg0.onopen = arg1;
        }, arguments); },
        __wbg_set_onsuccess_bf03d6c06709ef09: function() { return logError(function (arg0, arg1) {
            arg0.onsuccess = arg1;
        }, arguments); },
        __wbg_set_onupgradeneeded_3fc8649a687213f5: function() { return logError(function (arg0, arg1) {
            arg0.onupgradeneeded = arg1;
        }, arguments); },
        __wbg_set_preload_fdc04e704538fd40: function() { return logError(function (arg0, arg1, arg2) {
            arg0.preload = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_signal_1d4e73c2305a0e7c: function() { return logError(function (arg0, arg1) {
            arg0.signal = arg1;
        }, arguments); },
        __wbg_set_src_131d0c69b284b037: function() { return logError(function (arg0, arg1, arg2) {
            arg0.src = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_textAlign_01d9d4dc03a75858: function() { return logError(function (arg0, arg1, arg2) {
            arg0.textAlign = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_textBaseline_2b18db1816710f31: function() { return logError(function (arg0, arg1, arg2) {
            arg0.textBaseline = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_type_8b2743f6b4de4035: function() { return logError(function (arg0, arg1, arg2) {
            arg0.type = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_volume_1741406a2f0b0ce9: function() { return logError(function (arg0, arg1) {
            arg0.volume = arg1;
        }, arguments); },
        __wbg_set_width_5cda41d4d06a14dd: function() { return logError(function (arg0, arg1) {
            arg0.width = arg1 >>> 0;
        }, arguments); },
        __wbg_shaderSource_084cd6ed337b36be: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.shaderSource(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_shaderSource_9b5906e1f027a314: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.shaderSource(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_shiftKey_dcf8ee699c273ed2: function() { return logError(function (arg0) {
            const ret = arg0.shiftKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_shiftKey_e483c13c966878f6: function() { return logError(function (arg0) {
            const ret = arg0.shiftKey;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_signal_fdc54643b47bf85b: function() { return logError(function (arg0) {
            const ret = arg0.signal;
            return ret;
        }, arguments); },
        __wbg_stack_3b0d974bbf31e44f: function() { return logError(function (arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_static_accessor_CREATE_TASK_f3ab6a6954bda493: function() { return logError(function () {
            const ret = typeof console === 'undefined' ? null : console?.createTask;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_GLOBAL_8cfadc87a297ca02: function() { return logError(function () {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_602256ae5c8f42cf: function() { return logError(function () {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_SELF_e445c1c7484aecc3: function() { return logError(function () {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_static_accessor_WINDOW_f20e8576ef1e0f17: function() { return logError(function () {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_status_43e0d2f15b22d69f: function() { return logError(function (arg0) {
            const ret = arg0.status;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_stopPropagation_e088fca8231e68c4: function() { return logError(function (arg0) {
            arg0.stopPropagation();
        }, arguments); },
        __wbg_stringify_91082ed7a5a5769e: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_style_c331a9f6564f8f62: function() { return logError(function (arg0) {
            const ret = arg0.style;
            return ret;
        }, arguments); },
        __wbg_subarray_f8ca46a25b1f5e0d: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        }, arguments); },
        __wbg_target_6d97e221d11b71b6: function() { return logError(function (arg0) {
            const ret = arg0.target;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_terminaldebugapi_new: function() { return logError(function (arg0) {
            const ret = TerminalDebugApi.__wrap(arg0);
            return ret;
        }, arguments); },
        __wbg_texParameteri_83c7801427720baa: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.texParameteri(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_texParameteri_bc24667dff936ebd: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.texParameteri(arg1 >>> 0, arg2 >>> 0, arg3);
        }, arguments); },
        __wbg_texStorage3D_645d2a06d38f0291: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.texStorage3D(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5, arg6);
        }, arguments); },
        __wbg_texSubImage3D_5e37ae4a691b540a: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
            arg0.texSubImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9 >>> 0, arg10 >>> 0, arg11);
        }, arguments); },
        __wbg_texSubImage3D_c572dcb916b31c0d: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11) {
            arg0.texSubImage3D(arg1 >>> 0, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9 >>> 0, arg10 >>> 0, arg11);
        }, arguments); },
        __wbg_then_792e0c862b060889: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_then_8e16ee11f05e4827: function() { return logError(function (arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        }, arguments); },
        __wbg_transaction_9af5475ca3bd3fa9: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.transaction(arg1, __wbindgen_enum_IdbTransactionMode[arg2]);
            return ret;
        }, arguments); },
        __wbg_type_37ad6e505f20fc7e: function() { return logError(function (arg0, arg1) {
            const ret = arg1.type;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_uniform1i_bde3c7d92bc444b2: function() { return logError(function (arg0, arg1, arg2) {
            arg0.uniform1i(arg1, arg2);
        }, arguments); },
        __wbg_uniform1i_cfd4726efd9d58b4: function() { return logError(function (arg0, arg1, arg2) {
            arg0.uniform1i(arg1, arg2);
        }, arguments); },
        __wbg_uniformBlockBinding_937f5d284b5d4fca: function() { return logError(function (arg0, arg1, arg2, arg3) {
            arg0.uniformBlockBinding(arg1, arg2 >>> 0, arg3 >>> 0);
        }, arguments); },
        __wbg_url_2bf741820e6563a0: function() { return logError(function (arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_url_7e153eff46938d20: function() { return logError(function (arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_useProgram_6403314e6307ff8f: function() { return logError(function (arg0, arg1) {
            arg0.useProgram(arg1);
        }, arguments); },
        __wbg_useProgram_b0607e62e147410b: function() { return logError(function (arg0, arg1) {
            arg0.useProgram(arg1);
        }, arguments); },
        __wbg_value_ee3a06f4579184fa: function() { return logError(function (arg0) {
            const ret = arg0.value;
            return ret;
        }, arguments); },
        __wbg_versions_276b2795b1c6a219: function() { return logError(function (arg0) {
            const ret = arg0.versions;
            return ret;
        }, arguments); },
        __wbg_vertexAttribDivisorANGLE_49500429f99e1d27: function() { return logError(function (arg0, arg1, arg2) {
            arg0.vertexAttribDivisorANGLE(arg1 >>> 0, arg2 >>> 0);
        }, arguments); },
        __wbg_vertexAttribDivisor_406c4f2dab66050b: function() { return logError(function (arg0, arg1, arg2) {
            arg0.vertexAttribDivisor(arg1 >>> 0, arg2 >>> 0);
        }, arguments); },
        __wbg_vertexAttribIPointer_a64fdd378b987c16: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.vertexAttribIPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4, arg5);
        }, arguments); },
        __wbg_vertexAttribPointer_89754c61239e5837: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.vertexAttribPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4 !== 0, arg5, arg6);
        }, arguments); },
        __wbg_vertexAttribPointer_dfec25e05e323ba4: function() { return logError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.vertexAttribPointer(arg1 >>> 0, arg2, arg3 >>> 0, arg4 !== 0, arg5, arg6);
        }, arguments); },
        __wbg_view_701664ffb3b1ce67: function() { return logError(function (arg0) {
            const ret = arg0.view;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_viewport_325ef6f6b074c24f: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.viewport(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_viewport_b1858453ab05f289: function() { return logError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.viewport(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_warn_3a37cdd7216f1479: function() { return logError(function (arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
            wasm.__wbindgen_free(arg0, arg1 * 4, 4);
            console.warn(...v0);
        }, arguments); },
        __wbg_warn_3cc416af27dbdc02: function() { return logError(function (arg0) {
            console.warn(arg0);
        }, arguments); },
        __wbg_wasClean_bd109e45fffa711a: function() { return logError(function (arg0) {
            const ret = arg0.wasClean;
            _assertBoolean(ret);
            return ret;
        }, arguments); },
        __wbg_width_3aacf063073c2757: function() { return logError(function (arg0) {
            const ret = arg0.width;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_width_5adcb07d04d08bdf: function() { return logError(function (arg0) {
            const ret = arg0.width;
            _assertNum(ret);
            return ret;
        }, arguments); },
        __wbg_writeText_41e0b9b209591a06: function() { return logError(function (arg0, arg1, arg2) {
            const ret = arg0.writeText(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 3077, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h261297f9ed4d8faa);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000002: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 5235, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h28df6fbd2539c2b0);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000003: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [F64], shim_idx: 99, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hadc12f01aa7065aa);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000004: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("ClipboardEvent")], shim_idx: 98, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hf8e602e77ff9a7d9);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000005: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("CloseEvent")], shim_idx: 2705, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hd708dd4267a96cb5);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000006: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("Event")], shim_idx: 211, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h5d71ff872b1d5909);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000007: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("Event")], shim_idx: 5155, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h59f1033aa70f8c27);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000008: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("IDBVersionChangeEvent")], shim_idx: 96, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h4edcd5fd25d1a5f8);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000009: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("KeyboardEvent")], shim_idx: 97, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hdab86b435490b991);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000a: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 3420, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h9809f3fd50c3c3d1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000b: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MouseEvent")], shim_idx: 232, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hd09ca7d2702b6eb2);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000c: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("WebGLContextEvent")], shim_idx: 231, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h416aed90a7a8c3c5);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000d: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3016, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h8562949088471579);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000e: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3110, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h56f1e1b449ad8b46);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000000f: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3148, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
            const ret = makeClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h76b9af86ce4e103c);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000010: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 4972, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha6c3f31b0a323655);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000011: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 801, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h90b51df68e2bc330);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000012: function() { return logError(function (arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000013: function() { return logError(function (arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000014: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(F32)) -> NamedExternref("Float32Array")`.
            const ret = getArrayF32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000015: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I16)) -> NamedExternref("Int16Array")`.
            const ret = getArrayI16FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000016: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I32)) -> NamedExternref("Int32Array")`.
            const ret = getArrayI32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000017: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(I8)) -> NamedExternref("Int8Array")`.
            const ret = getArrayI8FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000018: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U16)) -> NamedExternref("Uint16Array")`.
            const ret = getArrayU16FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000019: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U32)) -> NamedExternref("Uint32Array")`.
            const ret = getArrayU32FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000001a: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000001b: function() { return logError(function (arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        }, arguments); },
        __wbindgen_cast_000000000000001c: function() { return logError(function (arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rathole_bg.js": import0,
    };
}


//#endregion
function wasm_bindgen__convert__closures_____invoke__h8562949088471579(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h8562949088471579(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h56f1e1b449ad8b46(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h56f1e1b449ad8b46(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h76b9af86ce4e103c(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h76b9af86ce4e103c(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__ha6c3f31b0a323655(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__ha6c3f31b0a323655(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h90b51df68e2bc330(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h90b51df68e2bc330(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h6a214642496403cd(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h6a214642496403cd(arg0, arg1);
    return ret !== 0;
}

function wasm_bindgen__convert__closures_____invoke__h261297f9ed4d8faa(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h261297f9ed4d8faa(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hf8e602e77ff9a7d9(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hf8e602e77ff9a7d9(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hd708dd4267a96cb5(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hd708dd4267a96cb5(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h5d71ff872b1d5909(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h5d71ff872b1d5909(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h59f1033aa70f8c27(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h59f1033aa70f8c27(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h4edcd5fd25d1a5f8(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h4edcd5fd25d1a5f8(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hdab86b435490b991(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hdab86b435490b991(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h9809f3fd50c3c3d1(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h9809f3fd50c3c3d1(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hd09ca7d2702b6eb2(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hd09ca7d2702b6eb2(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h416aed90a7a8c3c5(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h416aed90a7a8c3c5(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h28df6fbd2539c2b0(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h28df6fbd2539c2b0(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h5f1feff97ef5b238(arg0, arg1, arg2, arg3) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h5f1feff97ef5b238(arg0, arg1, arg2, arg3);
}

function wasm_bindgen__convert__closures_____invoke__hadc12f01aa7065aa(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hadc12f01aa7065aa(arg0, arg1, arg2);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_IdbTransactionMode = ["readonly", "readwrite", "versionchange", "readwriteflush", "cleanup"];


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
const TerminalDebugApiFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_terminaldebugapi_free(ptr >>> 0, 1));


//#region intrinsics
function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertBoolean(n) {
    if (typeof(n) !== 'boolean') {
        throw new Error(`expected a boolean argument, found ${typeof(n)}`);
    }
}

function _assertNum(n) {
    if (typeof(n) !== 'number') throw new Error(`expected a number argument, found ${typeof(n)}`);
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

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

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
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

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedInt16ArrayMemory0 = null;
function getInt16ArrayMemory0() {
    if (cachedInt16ArrayMemory0 === null || cachedInt16ArrayMemory0.byteLength === 0) {
        cachedInt16ArrayMemory0 = new Int16Array(wasm.memory.buffer);
    }
    return cachedInt16ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

let cachedInt8ArrayMemory0 = null;
function getInt8ArrayMemory0() {
    if (cachedInt8ArrayMemory0 === null || cachedInt8ArrayMemory0.byteLength === 0) {
        cachedInt8ArrayMemory0 = new Int8Array(wasm.memory.buffer);
    }
    return cachedInt8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
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

function logError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        let error = (function () {
            try {
                return e instanceof Error ? `${e.message}\n\nStack:\n${e.stack}` : e.toString();
            } catch(_) {
                return "<failed to stringify thrown value>";
            }
        }());
        console.error("wasm-bindgen: imported JS function that was not marked as `catch` threw an error:", error);
        throw e;
    }
}

function makeClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
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
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
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
            wasm.__wbindgen_destroy_closure(state.a, state.b);
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
    if (typeof(arg) !== 'string') throw new Error(`expected a string argument, found ${typeof(arg)}`);
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
        if (ret.read !== arg.length) throw new Error('failed to pass whole string');
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


//#endregion

//#region wasm loading
let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedInt16ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedInt8ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rathole_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
//#endregion
export { wasm as __wasm }
