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
     * read a newline-terminated utf-8 line.
     *
     * returns the line WITHOUT the trailing `\n`. returns null on clean
     * stream close (EOF before any bytes). used for ndjson framing.
     * @returns {Promise<any>}
     */
    read_line() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
     * write a newline-delimited utf-8 line.
     *
     * appends `\n` if not already present, then writes. used for the ndjson
     * framing the `freqhole-events/1` protocol speaks.
     * @param {string} line
     * @returns {Promise<void>}
     */
    write_line(line) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
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
     *
     * after `finish()` we await `stopped()` so the peer's ack is observed
     * before this method returns. without this, JS callers that drop /
     * `close()` the stream immediately after `write_raw_and_finish` can
     * race the QUIC flush -- the peer's `read_to_end` then errors with
     * "connection lost" mid-payload because the in-flight frames are
     * torn down with the connection. matters most for large payloads
     * (e.g. base64-encoded blob bodies in `api_response`).
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
 * incremental blake3 hasher for streaming uploads — feed fixed-size chunks
 * via update() and read the final hex hash from finalize(). lets JS hash a
 * File while streaming it (file.stream() reader loop) instead of holding
 * the whole payload in memory for a one-shot hash_blake3().
 */
export class Blake3Hasher {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Blake3HasherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_blake3hasher_free(ptr, 0);
    }
    /**
     * finish and return the hash as a 64-char hex string. the hasher can
     * keep absorbing after this (blake3 finalize is non-destructive), but
     * callers should treat the session as done.
     * @returns {string}
     */
    finalize() {
        let deferred1_0;
        let deferred1_1;
        try {
            if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
            _assertNum(this.__wbg_ptr);
            const ret = wasm.blake3hasher_finalize(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    constructor() {
        const ret = wasm.blake3hasher_new();
        this.__wbg_ptr = ret;
        Blake3HasherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * absorb the next chunk of data.
     * @param {Uint8Array} chunk
     */
    update(chunk) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.blake3hasher_update(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) Blake3Hasher.prototype[Symbol.dispose] = Blake3Hasher.prototype.free;

/**
 * cooperative cancellation for in-flight downloads (pause/cancel from JS).
 * the download loops select on `cancelled()` between progress events —
 * cancellation takes effect at the next event boundary, and the partial
 * data stays in the store, so a later download of the same hash resumes
 * from the persisted bitfield (only missing ranges transfer).
 */
export class CancelToken {
    static __wrap(ptr) {
        const obj = Object.create(CancelToken.prototype);
        obj.__wbg_ptr = ptr;
        CancelTokenFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CancelTokenFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_canceltoken_free(ptr, 0);
    }
    /**
     * request cancellation. idempotent.
     */
    cancel() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.canceltoken_cancel(this.__wbg_ptr);
    }
    /**
     * return a new CancelToken sharing the same cancellation state.
     * needed because passing a wasm class by value consumes the JS handle —
     * callers keep the original and pass a clone into download calls.
     * @returns {CancelToken}
     */
    clone_token() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.canceltoken_clone_token(this.__wbg_ptr);
        return CancelToken.__wrap(ret);
    }
    /**
     * @returns {boolean}
     */
    is_cancelled() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.canceltoken_is_cancelled(this.__wbg_ptr);
        return ret !== 0;
    }
    constructor() {
        const ret = wasm.canceltoken_new();
        this.__wbg_ptr = ret;
        CancelTokenFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) CancelToken.prototype[Symbol.dispose] = CancelToken.prototype.free;

/**
 * result from fetching the server hello image from a peer
 */
export class HelloImageResult {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
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
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        const obj = Object.create(ImportSession.prototype);
        obj.__wbg_ptr = ptr;
        ImportSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ImportSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_importsession_free(ptr, 0);
    }
    /**
     * abort the import. any partially-imported data is left to GC.
     */
    abort() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.importsession_abort(this.__wbg_ptr);
    }
    /**
     * signal end-of-stream, wait for the import to complete, pin the
     * resulting blob, and return its blake3 hash as a hex string.
     * @returns {Promise<string>}
     */
    finish() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.importsession_finish(this.__wbg_ptr);
        return ret;
    }
    /**
     * queue the next chunk. resolves once the chunk has been accepted by
     * the import stream (bounded channel — this is the backpressure point).
     * @param {Uint8Array} chunk
     * @returns {Promise<void>}
     */
    push(chunk) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.importsession_push(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
}
if (Symbol.dispose) ImportSession.prototype[Symbol.dispose] = ImportSession.prototype.free;

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
 * - freqhole/1: API requests and small blob streaming
 * - iroh-blobs: verified streaming for audio files
 */
export class MiddenNode {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
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
     * send an API request to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * @param {string} peer_addr
     * @param {string} method
     * @param {string} path
     * @param {string | null} [body]
     * @returns {Promise<any>}
     */
    api_request(peer_addr, method, path, body) {
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
        const ret = wasm.middennode_api_request(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret;
    }
    /**
     * PROTOTYPE: remove a hash's restriction, returning it to the default
     * (served to anyone) state.
     * @param {string} blake3_hash
     */
    clear_blob_restriction(blake3_hash) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_clear_blob_restriction(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
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
     * create a new node with random identity, an in-memory blob store, and
     * the default ALPN set. waits for relay connection before returning.
     *
     * deprecated: use `create_with_options` instead.
     *
     * `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
     * (defaults to 10s when omitted/undefined).
     * @param {number | null} [connect_timeout_ms]
     * @returns {Promise<MiddenNode>}
     */
    static create(connect_timeout_ms) {
        if (!isLikeNone(connect_timeout_ms)) {
            _assertNum(connect_timeout_ms);
        }
        const ret = wasm.middennode_create(isLikeNone(connect_timeout_ms) ? Number.MAX_SAFE_INTEGER : (connect_timeout_ms) >>> 0);
        return ret;
    }
    /**
     * create a node from existing secret key bytes (for persistence)
     * key_bytes must be exactly 32 bytes.
     *
     * deprecated: use `create_with_options` instead.
     *
     * `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
     * (defaults to 10s when omitted/undefined).
     * @param {Uint8Array} key_bytes
     * @param {number | null} [connect_timeout_ms]
     * @returns {Promise<MiddenNode>}
     */
    static create_from_key(key_bytes, connect_timeout_ms) {
        const ptr0 = passArray8ToWasm0(key_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        if (!isLikeNone(connect_timeout_ms)) {
            _assertNum(connect_timeout_ms);
        }
        const ret = wasm.middennode_create_from_key(ptr0, len0, isLikeNone(connect_timeout_ms) ? Number.MAX_SAFE_INTEGER : (connect_timeout_ms) >>> 0);
        return ret;
    }
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
     * @param {Uint8Array} key_bytes
     * @param {Array<any>} extra_alpns
     * @param {number | null} [connect_timeout_ms]
     * @returns {Promise<MiddenNode>}
     */
    static create_with_alpns(key_bytes, extra_alpns, connect_timeout_ms) {
        const ptr0 = passArray8ToWasm0(key_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        if (!isLikeNone(connect_timeout_ms)) {
            _assertNum(connect_timeout_ms);
        }
        const ret = wasm.middennode_create_with_alpns(ptr0, len0, extra_alpns, isLikeNone(connect_timeout_ms) ? Number.MAX_SAFE_INTEGER : (connect_timeout_ms) >>> 0);
        return ret;
    }
    /**
     * create a node from an options bag. this is the single canonical
     * constructor — `create`/`create_from_key`/`create_with_alpns` below
     * are deprecated wrappers kept for existing callers (spume, playlistz).
     * @param {MiddenNodeOptions} options
     * @returns {Promise<MiddenNode>}
     */
    static create_with_options(options) {
        _assertClass(options, MiddenNodeOptions);
        if (options.__wbg_ptr === 0) {
            throw new Error('Attempt to use a moved value');
        }
        var ptr0 = options.__destroy_into_raw();
        const ret = wasm.middennode_create_with_options(ptr0);
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
     * full pipeline from blob_id with progress reporting.
     *
     * computes blake3 on demand, then uses verified download with progress.
     * returns [data: Uint8Array, blake3: string].
     * @param {string} peer_addr
     * @param {string} blob_id
     * @param {number} total_size
     * @param {Function} on_progress
     * @returns {Promise<Array<any>>}
     */
    download_verified_by_id_progress(peer_addr, blob_id, total_size, on_progress) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blob_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_download_verified_by_id_progress(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_progress);
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
     * @param {CancelToken | null} [cancel]
     * @returns {Promise<number>}
     */
    download_verified_streaming(peer_addr, blake3_hash, total_size, on_chunk, on_progress, cancel) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(cancel)) {
            _assertClass(cancel, CancelToken);
            if (cancel.__wbg_ptr === 0) {
                throw new Error('Attempt to use a moved value');
            }
            ptr2 = cancel.__destroy_into_raw();
        }
        const ret = wasm.middennode_download_verified_streaming(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_chunk, on_progress, ptr2);
        return ret;
    }
    /**
     * streaming download with auto ensure+retry. first attempts the streaming
     * download; if the verified download fails (blob not in peer's store), calls
     * ensure_blob to load it, then retries. a deliberate cancellation is NOT
     * retried — it propagates immediately with the "download cancelled" message.
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @param {number} total_size
     * @param {Function} on_chunk
     * @param {Function} on_progress
     * @param {CancelToken | null} [cancel]
     * @returns {Promise<number>}
     */
    download_verified_streaming_with_ensure(peer_addr, blake3_hash, total_size, on_chunk, on_progress, cancel) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(cancel)) {
            _assertClass(cancel, CancelToken);
            if (cancel.__wbg_ptr === 0) {
                throw new Error('Attempt to use a moved value');
            }
            ptr2 = cancel.__destroy_into_raw();
        }
        const ret = wasm.middennode_download_verified_streaming_with_ensure(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_chunk, on_progress, ptr2);
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
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @param {number} total_size
     * @param {Function} on_progress
     * @param {CancelToken | null} [cancel]
     * @returns {Promise<Uint8Array>}
     */
    download_verified_with_ensure_progress(peer_addr, blake3_hash, total_size, on_progress, cancel) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(cancel)) {
            _assertClass(cancel, CancelToken);
            if (cancel.__wbg_ptr === 0) {
                throw new Error('Attempt to use a moved value');
            }
            ptr2 = cancel.__destroy_into_raw();
        }
        const ret = wasm.middennode_download_verified_with_ensure_progress(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_progress, ptr2);
        return ret;
    }
    /**
     * download a blob with progress reporting via JS callback
     *
     * same as download_verified but calls on_progress(fraction) where
     * fraction is bytes_received / total_size (0.0 to 1.0).
     * total_size should come from the caller's known size field.
     * `cancel`: optional cooperative cancellation (pause) — see
     * download_verified_streaming for the semantics.
     * @param {string} peer_addr
     * @param {string} blake3_hash
     * @param {number} total_size
     * @param {Function} on_progress
     * @param {CancelToken | null} [cancel]
     * @returns {Promise<Uint8Array>}
     */
    download_verified_with_progress(peer_addr, blake3_hash, total_size, on_progress, cancel) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        let ptr2 = 0;
        if (!isLikeNone(cancel)) {
            _assertClass(cancel, CancelToken);
            if (cancel.__wbg_ptr === 0) {
                throw new Error('Attempt to use a moved value');
            }
            ptr2 = cancel.__destroy_into_raw();
        }
        const ret = wasm.middennode_download_verified_with_progress(this.__wbg_ptr, ptr0, len0, ptr1, len1, total_size, on_progress, ptr2);
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
     * check whether a blob with the given blake3 hash is currently held in the store
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
     * check whether a COMPLETE blob with this hash exists in the blob store
     * itself — with the persistent opfs store this is true across reloads,
     * even when no TempTag pins it. lets serving paths skip re-imports
     * entirely.
     * @param {string} blake3_hash
     * @returns {Promise<boolean>}
     */
    has_complete_blob(blake3_hash) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_has_complete_blob(this.__wbg_ptr, ptr0, len0);
        return ret;
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
     * call release_blob() to allow GC.
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
     * get our full endpoint address as JSON (node_id + relay url + any direct addrs).
     *
     * after `online()` has resolved this includes the home relay url, which is
     * enough for a remote peer to dial us directly via the relay without doing
     * a pkarr/DNS discovery lookup first. pass the returned string straight to
     * `open_bi`/`connect` on the other side - `parse_peer_addr` accepts this
     * same JSON shape. avoids the discovery propagation race on fresh boots.
     * @returns {string}
     */
    node_addr() {
        let deferred2_0;
        let deferred2_1;
        try {
            if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
            _assertNum(this.__wbg_ptr);
            const ret = wasm.middennode_node_addr(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
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
     * address JSON (same format as api_request). `alpn` is the protocol
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
     * pin a hash so gc won't sweep it (e.g. a paused partial download).
     * idempotent. pair with unprotect_blob when the partial is resumed to
     * completion or discarded.
     * @param {string} blake3_hash
     */
    protect_blob(blake3_hash) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_protect_blob(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
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
     * PROTOTYPE: restrict a blob (by blake3 hex hash) so only the given
     * peer node ids may fetch it over the `iroh-blobs/*` ALPN. a hash with
     * no restriction registered is served to anyone (today's default
     * behavior, unchanged) — calling this is what opts a specific hash
     * into gating.
     *
     * this is a stopgap/demo hook, not the real canvas-ACL integration: it
     * has to be called explicitly, from JS, with an already-resolved list
     * of allowed peer node ids for this one hash.
     * @param {string} blake3_hash
     * @param {Array<any>} peer_node_ids
     */
    restrict_blob_to_peers(blake3_hash, peer_node_ids) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_restrict_blob_to_peers(this.__wbg_ptr, ptr0, len0, peer_node_ids);
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
     * begin a chunked import — the streaming counterpart to import_blob for
     * payloads that shouldn't be materialized as one contiguous &[u8] across
     * the wasm boundary. see ImportSession for the push/finish protocol.
     * @returns {ImportSession}
     */
    start_import() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennode_start_import(this.__wbg_ptr);
        return ImportSession.__wrap(ret);
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
    /**
     * remove a gc pin added by protect_blob (or by a cancelled download).
     * @param {string} blake3_hash
     */
    unprotect_blob(blake3_hash) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(blake3_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_unprotect_blob(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) MiddenNode.prototype[Symbol.dispose] = MiddenNode.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MiddenNodeOptionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_middennodeoptions_free(ptr, 0);
    }
    /**
     * per-dial timeout (ms) for `open_bi`/`connect` (defaults to 10s).
     * @returns {number | undefined}
     */
    get connect_timeout_ms() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennodeoptions_get_connect_timeout_ms(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * additional ALPN protocols to register beyond the default set.
     * @returns {string[] | undefined}
     */
    get extra_alpns() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennodeoptions_get_extra_alpns(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        }
        return v1;
    }
    /**
     * when given, blobs persist in an OPFS-backed store under this
     * directory (worker context required); otherwise (or when OPFS is
     * unavailable) an in-memory store is used.
     * @returns {string | undefined}
     */
    get opfs_store_dir() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennodeoptions_get_opfs_store_dir(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * the node's secret key (32 raw bytes). omit (or pass null/undefined)
     * to generate a random identity.
     * @returns {Uint8Array | undefined}
     */
    get secret_key() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.middennodeoptions_get_secret_key(this.__wbg_ptr);
        return ret;
    }
    constructor() {
        const ret = wasm.middennodeoptions_new();
        this.__wbg_ptr = ret;
        MiddenNodeOptionsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number | null} [ms]
     */
    set connect_timeout_ms(ms) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        if (!isLikeNone(ms)) {
            _assertNum(ms);
        }
        wasm.middennodeoptions_set_connect_timeout_ms(this.__wbg_ptr, isLikeNone(ms) ? Number.MAX_SAFE_INTEGER : (ms) >>> 0);
    }
    /**
     * @param {string[] | null} [alpns]
     */
    set extra_alpns(alpns) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        var ptr0 = isLikeNone(alpns) ? 0 : passArrayJsValueToWasm0(alpns, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.middennodeoptions_set_extra_alpns(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {string | null} [dir]
     */
    set opfs_store_dir(dir) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        var ptr0 = isLikeNone(dir) ? 0 : passStringToWasm0(dir, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        wasm.middennodeoptions_set_opfs_store_dir(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {Uint8Array | null} [key]
     */
    set secret_key(key) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        wasm.middennodeoptions_set_secret_key(this.__wbg_ptr, isLikeNone(key) ? 0 : addToExternrefTable0(key));
    }
}
if (Symbol.dispose) MiddenNodeOptions.prototype[Symbol.dispose] = MiddenNodeOptions.prototype.free;

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

/**
 * opfs store selftest — runs the full import/export round trip against
 * real OPFS through the real iroh-blobs api. worker context required
 * (sync access handles). wasm-only debug helper, used for manual
 * debugging from the blob worker, not from automated tests.
 * @returns {Promise<string>}
 */
export function opfs_store_selftest() {
    const ret = wasm.opfs_store_selftest();
    return ret;
}

/**
 * persistence selftest: blobs + tags survive a store shutdown/reopen over
 * the same OPFS directory. worker context required. wasm-only debug
 * helper, used for manual debugging from the blob worker.
 * @returns {Promise<string>}
 */
export function opfs_store_selftest_persistence() {
    const ret = wasm.opfs_store_selftest_persistence();
    return ret;
}

export function start() {
    wasm.start();
}

//#endregion

//#region wasm imports
export function __wbg_Error_92b29b0548f8b746() { return logError(function (arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_String_8564e559799eccda() { return logError(function (arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg___wbindgen_boolean_get_fa956cfa2d1bd751(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    if (!isLikeNone(ret)) {
        _assertBoolean(ret);
    }
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}
export function __wbg___wbindgen_debug_string_c25d447a39f5578f(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_is_function_1ff95bcc5517c252(arg0) {
    const ret = typeof(arg0) === 'function';
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_object_a27215656b807791(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_string_ea5e6cc2e4141dfe(arg0) {
    const ret = typeof(arg0) === 'string';
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_undefined_c05833b95a3cf397(arg0) {
    const ret = arg0 === undefined;
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_string_get_b0ca35b86a603356(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_throw_344f42d3211c4765(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg__wbg_cb_unref_fffb441def202758() { return logError(function (arg0) {
    arg0._wbg_cb_unref();
}, arguments); }
export function __wbg_abort_8bae0f33e7833997() { return logError(function (arg0) {
    arg0.abort();
}, arguments); }
export function __wbg_abort_eee9248a6d680839() { return logError(function (arg0, arg1) {
    arg0.abort(arg1);
}, arguments); }
export function __wbg_addEventListener_c33b246adf950d7c() { return handleError(function (arg0, arg1, arg2, arg3) {
    arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
}, arguments); }
export function __wbg_append_01c74e5c6b58aa64() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
    arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
}, arguments); }
export function __wbg_arrayBuffer_3b637f0fa65c5351() { return handleError(function (arg0) {
    const ret = arg0.arrayBuffer();
    return ret;
}, arguments); }
export function __wbg_bistream_new() { return logError(function (arg0) {
    const ret = BiStream.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_body_18c9f2ac15ead4b2() { return logError(function (arg0) {
    const ret = arg0.body;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_buffer_54b87055582c8a81() { return logError(function (arg0) {
    const ret = arg0.buffer;
    return ret;
}, arguments); }
export function __wbg_byobRequest_06b654bb15590436() { return logError(function (arg0) {
    const ret = arg0.byobRequest;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_byteLength_41862ca4020b9c43() { return logError(function (arg0) {
    const ret = arg0.byteLength;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_byteOffset_d42e18c4441f628b() { return logError(function (arg0) {
    const ret = arg0.byteOffset;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_call_44b7209e1e252e6a() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
    const ret = arg0.call(arg1, arg2, arg3, arg4);
    return ret;
}, arguments); }
export function __wbg_call_8a2dd23819f8a60a() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments); }
export function __wbg_call_a6e5c5dce5018821() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_call_e3b662382210db98() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.call(arg1, arg2, arg3);
    return ret;
}, arguments); }
export function __wbg_cancel_3983a93e24cc66b3() { return logError(function (arg0) {
    const ret = arg0.cancel();
    return ret;
}, arguments); }
export function __wbg_catch_c1a60df4c30d76d3() { return logError(function (arg0, arg1) {
    const ret = arg0.catch(arg1);
    return ret;
}, arguments); }
export function __wbg_clearTimeout_333bba87532ab9d3() { return logError(function (arg0) {
    const ret = clearTimeout(arg0);
    return ret;
}, arguments); }
export function __wbg_clearTimeout_47a40e3be01ed7a3() { return handleError(function (arg0, arg1) {
    arg0.clearTimeout(arg1);
}, arguments); }
export function __wbg_close_249a23304523681b() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_close_72d318d9c16e83ef() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_close_c65ca0257e895318() { return handleError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_close_d00f4cb641f9db10() { return logError(function (arg0) {
    arg0.close();
}, arguments); }
export function __wbg_code_1fc52b4142a112ac() { return logError(function (arg0) {
    const ret = arg0.code;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_code_cb4327cfc515673b() { return logError(function (arg0) {
    const ret = arg0.code;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_createSyncAccessHandle_0caafebe31e4f2d9() { return logError(function (arg0) {
    const ret = arg0.createSyncAccessHandle();
    return ret;
}, arguments); }
export function __wbg_crypto_38df2bab126b63dc() { return logError(function (arg0) {
    const ret = arg0.crypto;
    return ret;
}, arguments); }
export function __wbg_data_328de4280640da92() { return logError(function (arg0) {
    const ret = arg0.data;
    return ret;
}, arguments); }
export function __wbg_debug_eaef3b49d572d680() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.debug(...v0);
}, arguments); }
export function __wbg_done_89b2b13e91a60321() { return logError(function (arg0) {
    const ret = arg0.done;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_enqueue_6d83b4c6281bafd6() { return handleError(function (arg0, arg1) {
    arg0.enqueue(arg1);
}, arguments); }
export function __wbg_entries_900cefd6f70eb290() { return logError(function (arg0) {
    const ret = arg0.entries();
    return ret;
}, arguments); }
export function __wbg_error_71b0e71161a5f3a0() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.error(...v0);
}, arguments); }
export function __wbg_error_a6fa202b58aa1cd3() { return logError(function (arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
}, arguments); }
export function __wbg_fetch_074561c3e313c86f() { return logError(function (arg0) {
    const ret = fetch(arg0);
    return ret;
}, arguments); }
export function __wbg_fetch_b5951fc96f52f786() { return logError(function (arg0, arg1) {
    const ret = arg0.fetch(arg1);
    return ret;
}, arguments); }
export function __wbg_flush_a4bd8d4e05ad23f6() { return handleError(function (arg0) {
    arg0.flush();
}, arguments); }
export function __wbg_getDirectoryHandle_cf175faf1a75a384() { return logError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.getDirectoryHandle(getStringFromWasm0(arg1, arg2), arg3);
    return ret;
}, arguments); }
export function __wbg_getDirectory_389283588dfb8117() { return logError(function (arg0) {
    const ret = arg0.getDirectory();
    return ret;
}, arguments); }
export function __wbg_getFileHandle_72de55ab3ca9ad57() { return logError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.getFileHandle(getStringFromWasm0(arg1, arg2), arg3);
    return ret;
}, arguments); }
export function __wbg_getRandomValues_c44a50d8cfdaebeb() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments); }
export function __wbg_getRandomValues_cc7f052a444bb2ce() { return handleError(function (arg0, arg1) {
    globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
}, arguments); }
export function __wbg_getReader_9facd4f899beac89() { return handleError(function (arg0) {
    const ret = arg0.getReader();
    return ret;
}, arguments); }
export function __wbg_getSize_29187e13478442fb() { return handleError(function (arg0) {
    const ret = arg0.getSize();
    return ret;
}, arguments); }
export function __wbg_get_507a50627bffa49b() { return logError(function (arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}, arguments); }
export function __wbg_get_78f252d074a84d0b() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_done_670108eb06ecbe46() { return logError(function (arg0) {
    const ret = arg0.done;
    if (!isLikeNone(ret)) {
        _assertBoolean(ret);
    }
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}, arguments); }
export function __wbg_get_value_f465f5be30aa0963() { return logError(function (arg0) {
    const ret = arg0.value;
    return ret;
}, arguments); }
export function __wbg_has_8374cf06984d8bfc() { return handleError(function (arg0, arg1) {
    const ret = Reflect.has(arg0, arg1);
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_headers_cf9c80f30e2a4eff() { return logError(function (arg0) {
    const ret = arg0.headers;
    return ret;
}, arguments); }
export function __wbg_helloimageresult_new() { return logError(function (arg0) {
    const ret = HelloImageResult.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_instanceof_ArrayBuffer_4480b9e0068a8adb() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_Blob_c6523f92a32c8695() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof Blob;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_FileSystemDirectoryHandle_c9ab7c5cdb7a7c30() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof FileSystemDirectoryHandle;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_FileSystemFileHandle_68e80b30532d5f04() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof FileSystemFileHandle;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_FileSystemSyncAccessHandle_db0b7504516129c1() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof FileSystemSyncAccessHandle;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_Response_c8b64b2256f01bec() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof Response;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_Window_05ba1ee4f6781663() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof Window;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_instanceof_WorkerGlobalScope_8ec07b5e040a41c3() { return logError(function (arg0) {
    let result;
    try {
        result = arg0 instanceof WorkerGlobalScope;
    } catch (_) {
        result = false;
    }
    const ret = result;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_isArray_0677c962b281d01a() { return logError(function (arg0) {
    const ret = Array.isArray(arg0);
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_length_1f0964f4a5e2c6d8() { return logError(function (arg0) {
    const ret = arg0.length;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_length_370319915dc99107() { return logError(function (arg0) {
    const ret = arg0.length;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_log_7a0760e115750083() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.log(...v0);
}, arguments); }
export function __wbg_message_fb0e6e7854e6ea7a() { return logError(function (arg0, arg1) {
    const ret = arg1.message;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_middennode_new() { return logError(function (arg0) {
    const ret = MiddenNode.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_msCrypto_bd5a034af96bcba6() { return logError(function (arg0) {
    const ret = arg0.msCrypto;
    return ret;
}, arguments); }
export function __wbg_navigator_51379c10a84aeec9() { return logError(function (arg0) {
    const ret = arg0.navigator;
    return ret;
}, arguments); }
export function __wbg_navigator_99621db14b3f1099() { return logError(function (arg0) {
    const ret = arg0.navigator;
    return ret;
}, arguments); }
export function __wbg_new_0d809930cd1354c6() { return handleError(function () {
    const ret = new Headers();
    return ret;
}, arguments); }
export function __wbg_new_227d7c05414eb861() { return logError(function () {
    const ret = new Error();
    return ret;
}, arguments); }
export function __wbg_new_32b398fb48b6d94a() { return logError(function () {
    const ret = new Array();
    return ret;
}, arguments); }
export function __wbg_new_4339b2a2675a03e3() { return handleError(function () {
    const ret = new AbortController();
    return ret;
}, arguments); }
export function __wbg_new_7796ffc7ed656783() { return logError(function () {
    const ret = new Map();
    return ret;
}, arguments); }
export function __wbg_new_b667d279fd5aa943() { return logError(function (arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_bf8729ffe10e9ee7() { return handleError(function (arg0, arg1) {
    const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_cd45aabdf6073e84() { return logError(function (arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
}, arguments); }
export function __wbg_new_da52cf8fe3429cb2() { return logError(function () {
    const ret = new Object();
    return ret;
}, arguments); }
export function __wbg_new_from_slice_77cdfb7977362f3c() { return logError(function (arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_typed_1824d93f294193e5() { return logError(function (arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf(a, state0.b, arg0, arg1);
            } finally {
                state0.a = a;
            }
        };
        const ret = new Promise(cb0);
        return ret;
    } finally {
        state0.a = 0;
    }
}, arguments); }
export function __wbg_new_with_byte_offset_and_length_54c7724ee3ec7d82() { return logError(function (arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
}, arguments); }
export function __wbg_new_with_length_e6785c33c8e4cce8() { return logError(function (arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
}, arguments); }
export function __wbg_new_with_str_and_init_d95cbe11ce28e65e() { return handleError(function (arg0, arg1, arg2) {
    const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
    return ret;
}, arguments); }
export function __wbg_new_with_str_sequence_2de2f569c29910ad() { return handleError(function (arg0, arg1, arg2) {
    const ret = new WebSocket(getStringFromWasm0(arg0, arg1), arg2);
    return ret;
}, arguments); }
export function __wbg_next_71f2aa1cb3d1e37e() { return handleError(function (arg0) {
    const ret = arg0.next();
    return ret;
}, arguments); }
export function __wbg_node_84ea875411254db1() { return logError(function (arg0) {
    const ret = arg0.node;
    return ret;
}, arguments); }
export function __wbg_now_86c0d4ba3fa605b8() { return logError(function () {
    const ret = Date.now();
    return ret;
}, arguments); }
export function __wbg_now_e7c6795a7f81e10f() { return logError(function (arg0) {
    const ret = arg0.now();
    return ret;
}, arguments); }
export function __wbg_performance_3fcf6e32a7e1ed0a() { return logError(function (arg0) {
    const ret = arg0.performance;
    return ret;
}, arguments); }
export function __wbg_process_44c7a14e11e9f69e() { return logError(function (arg0) {
    const ret = arg0.process;
    return ret;
}, arguments); }
export function __wbg_protocol_14b3b1c4bf71cd4a() { return logError(function (arg0, arg1) {
    const ret = arg1.protocol;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_prototypesetcall_4770620bbe4688a0() { return logError(function (arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}, arguments); }
export function __wbg_push_d2ae3af0c1217ae6() { return logError(function (arg0, arg1) {
    const ret = arg0.push(arg1);
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_queueMicrotask_0ab5b2d2393e99b9() { return logError(function (arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
}, arguments); }
export function __wbg_queueMicrotask_6a09b7bc46549209() { return logError(function (arg0) {
    queueMicrotask(arg0);
}, arguments); }
export function __wbg_radiohandle_new() { return logError(function (arg0) {
    const ret = RadioHandle.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_randomFillSync_6c25eac9869eb53c() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments); }
export function __wbg_random_039a7d5d06e0d333() { return logError(function () {
    const ret = Math.random();
    return ret;
}, arguments); }
export function __wbg_read_27d98fb08886b1fc() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.read(getArrayU8FromWasm0(arg1, arg2), arg3);
    return ret;
}, arguments); }
export function __wbg_read_8afa15f12a160ef8() { return logError(function (arg0) {
    const ret = arg0.read();
    return ret;
}, arguments); }
export function __wbg_readyState_50bc38c2a9e83db6() { return logError(function (arg0) {
    const ret = arg0.readyState;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_reason_5dc8e429d537d6a9() { return logError(function (arg0, arg1) {
    const ret = arg1.reason;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_releaseLock_5b92874cad775644() { return logError(function (arg0) {
    arg0.releaseLock();
}, arguments); }
export function __wbg_removeEntry_e38219fa4a98cfb3() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.removeEntry(getStringFromWasm0(arg1, arg2));
    return ret;
}, arguments); }
export function __wbg_removeEventListener_eb8291c80ca9056d() { return handleError(function (arg0, arg1, arg2, arg3) {
    arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
}, arguments); }
export function __wbg_require_b4edbdcf3e2a1ef0() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments); }
export function __wbg_resolve_2191a4dfe481c25b() { return logError(function (arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
}, arguments); }
export function __wbg_respond_510e32df8aeb6817() { return handleError(function (arg0, arg1) {
    arg0.respond(arg1 >>> 0);
}, arguments); }
export function __wbg_run_5aa314612b150933() { return logError(function (arg0, arg1, arg2) {
    try {
        var state0 = {a: arg1, b: arg2};
        var cb0 = () => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d(a, state0.b, );
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
}, arguments); }
export function __wbg_send_a321b376d40ec867() { return handleError(function (arg0, arg1, arg2) {
    arg0.send(getArrayU8FromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_send_df98dd5ede9b3f4d() { return handleError(function (arg0, arg1, arg2) {
    arg0.send(getStringFromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_setTimeout_3a808dd861dd3c12() { return logError(function (arg0, arg1) {
    const ret = setTimeout(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_setTimeout_6613a51400c1bf9f() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.setTimeout(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_set_4d7dd76f3dae2926() { return logError(function (arg0, arg1, arg2) {
    arg0.set(getArrayU8FromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_set_575dd786d51585f8() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_set_6be42768c690e380() { return logError(function (arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}, arguments); }
export function __wbg_set_8535240470bf2500() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(arg0, arg1, arg2);
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_set_8a16b38e4805b298() { return logError(function (arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
}, arguments); }
export function __wbg_set_at_674f6538cd77adef() { return logError(function (arg0, arg1) {
    arg0.at = arg1;
}, arguments); }
export function __wbg_set_binaryType_a37b086c78ca7c29() { return logError(function (arg0, arg1) {
    arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
}, arguments); }
export function __wbg_set_body_029f2d171e0a005f() { return logError(function (arg0, arg1) {
    arg0.body = arg1;
}, arguments); }
export function __wbg_set_cache_b4a740b195c051f4() { return logError(function (arg0, arg1) {
    arg0.cache = __wbindgen_enum_RequestCache[arg1];
}, arguments); }
export function __wbg_set_create_a807a6e9ac628698() { return logError(function (arg0, arg1) {
    arg0.create = arg1 !== 0;
}, arguments); }
export function __wbg_set_create_fa1dfa475fac91e9() { return logError(function (arg0, arg1) {
    arg0.create = arg1 !== 0;
}, arguments); }
export function __wbg_set_credentials_bb34a40189e3b43b() { return logError(function (arg0, arg1) {
    arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
}, arguments); }
export function __wbg_set_handle_event_dd6bc370a8cb4486() { return logError(function (arg0, arg1) {
    arg0.handleEvent = arg1;
}, arguments); }
export function __wbg_set_headers_9c61d123c3ee1f10() { return logError(function (arg0, arg1) {
    arg0.headers = arg1;
}, arguments); }
export function __wbg_set_method_5532d59b92d76467() { return logError(function (arg0, arg1, arg2) {
    arg0.method = getStringFromWasm0(arg1, arg2);
}, arguments); }
export function __wbg_set_mode_66c79886ad78fc05() { return logError(function (arg0, arg1) {
    arg0.mode = __wbindgen_enum_RequestMode[arg1];
}, arguments); }
export function __wbg_set_onclose_f706475385ecce07() { return logError(function (arg0, arg1) {
    arg0.onclose = arg1;
}, arguments); }
export function __wbg_set_onerror_9f5773fd31512333() { return logError(function (arg0, arg1) {
    arg0.onerror = arg1;
}, arguments); }
export function __wbg_set_onmessage_836d2f72130b4706() { return logError(function (arg0, arg1) {
    arg0.onmessage = arg1;
}, arguments); }
export function __wbg_set_onopen_4f65470ae522a61a() { return logError(function (arg0, arg1) {
    arg0.onopen = arg1;
}, arguments); }
export function __wbg_set_signal_c4ef8faddb4c1446() { return logError(function (arg0, arg1) {
    arg0.signal = arg1;
}, arguments); }
export function __wbg_signal_dad7cb35193abd31() { return logError(function (arg0) {
    const ret = arg0.signal;
    return ret;
}, arguments); }
export function __wbg_stack_3b0d974bbf31e44f() { return logError(function (arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_static_accessor_CREATE_TASK_7ee0dd8bc83df5b2() { return logError(function () {
    const ret = typeof console === 'undefined' ? null : console?.createTask;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_GLOBAL_4ef717fb391d88b7() { return logError(function () {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4() { return logError(function () {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_SELF_146583524fe1469b() { return logError(function () {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_WINDOW_f2829a2234d7819e() { return logError(function () {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_status_c45b3b9b3033184a() { return logError(function (arg0) {
    const ret = arg0.status;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_storage_3c893ad40b9e831e() { return logError(function (arg0) {
    const ret = arg0.storage;
    return ret;
}, arguments); }
export function __wbg_storage_756400487605531a() { return logError(function (arg0) {
    const ret = arg0.storage;
    return ret;
}, arguments); }
export function __wbg_subarray_3ed232c8a6baee09() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
}, arguments); }
export function __wbg_then_16d107c451e9905d() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_then_6ec10ae38b3e92f7() { return logError(function (arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
}, arguments); }
export function __wbg_truncate_98a6032d23095328() { return handleError(function (arg0, arg1) {
    arg0.truncate(arg1);
}, arguments); }
export function __wbg_url_a410c0bec2fb1b2c() { return logError(function (arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_url_abdb8fb08377f8c0() { return logError(function (arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_value_a5d5488a9589444a() { return logError(function (arg0) {
    const ret = arg0.value;
    return ret;
}, arguments); }
export function __wbg_versions_276b2795b1c6a219() { return logError(function (arg0) {
    const ret = arg0.versions;
    return ret;
}, arguments); }
export function __wbg_view_21f1d4a4f175dfa9() { return logError(function (arg0) {
    const ret = arg0.view;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_warn_3a37cdd7216f1479() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.warn(...v0);
}, arguments); }
export function __wbg_wasClean_3c7aa2335da09e74() { return logError(function (arg0) {
    const ret = arg0.wasClean;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_write_e557b5312ec23477() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.write(getArrayU8FromWasm0(arg1, arg2), arg3);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000001() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 2924, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000002() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 5007, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000003() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("CloseEvent")], shim_idx: 1818, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000004() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 3389, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000005() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 2888, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc8728011322ac642);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000006() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3099, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000007() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 3101, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
    const ret = makeClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000008() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 4976, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000009() { return logError(function (arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000a() { return logError(function (arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000b() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000c() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000d() { return logError(function (arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
}, arguments); }
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}

//#endregion
function wasm_bindgen__convert__closures_____invoke__hc8728011322ac642(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hc8728011322ac642(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h664b7a54f532788b(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hdf2e0feb328f9c9c(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h53f0ac92999d4a51(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h72d513d189e25b7d(arg0, arg1);
    return ret !== 0;
}

function wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h9bfafcd5df7f650f(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h3cac54e009c37b19(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h0b2903c49209e780(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h009da3dd3294e065(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf(arg0, arg1, arg2, arg3) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h744df718fbe3badf(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_ReadableStreamType = ["bytes"];


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];


const __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];
const BiStreamFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bistream_free(ptr, 1));
const Blake3HasherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_blake3hasher_free(ptr, 1));
const CancelTokenFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_canceltoken_free(ptr, 1));
const HelloImageResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_helloimageresult_free(ptr, 1));
const ImportSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_importsession_free(ptr, 1));
const IntoUnderlyingByteSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingbytesource_free(ptr, 1));
const IntoUnderlyingSinkFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsink_free(ptr, 1));
const IntoUnderlyingSourceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_intounderlyingsource_free(ptr, 1));
const MiddenNodeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_middennode_free(ptr, 1));
const MiddenNodeOptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_middennodeoptions_free(ptr, 1));
const RadioHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_radiohandle_free(ptr, 1));


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

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
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
    return decodeText(ptr >>> 0, len);
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

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
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

let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}

//#endregion
