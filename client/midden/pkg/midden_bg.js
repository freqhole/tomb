//#region exports

/**
 * blob fetch result
 */
export class BlobResult {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(BlobResult.prototype);
        obj.__wbg_ptr = ptr;
        BlobResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BlobResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_blobresult_free(ptr, 0);
    }
    /**
     * get content type (if known)
     * @returns {string | undefined}
     */
    content_type() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.blobresult_content_type(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * get blob data as Uint8Array
     * @returns {Uint8Array}
     */
    data() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.blobresult_data(this.__wbg_ptr);
        return ret;
    }
    /**
     * get blob size in bytes
     * @returns {number}
     */
    size() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.blobresult_size(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) BlobResult.prototype[Symbol.dispose] = BlobResult.prototype.free;

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
     * fetch a blob from a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * returns BlobResult with data and metadata
     * @param {string} peer_addr
     * @param {string} blob_id
     * @returns {Promise<BlobResult>}
     */
    fetch_blob(peer_addr, blob_id) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blob_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_fetch_blob(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * fetch a blob from a peer with progress callback
     * callback is called with (received_bytes, total_bytes) as arguments
     * if total_bytes is 0, the size is unknown
     * @param {string} peer_addr
     * @param {string} blob_id
     * @param {Function} on_progress
     * @returns {Promise<BlobResult>}
     */
    fetch_blob_with_progress(peer_addr, blob_id, on_progress) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(blob_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_fetch_blob_with_progress(this.__wbg_ptr, ptr0, len0, ptr1, len1, on_progress);
        return ret;
    }
    /**
     * fetch server image from a peer (public, no auth required)
     * used during "add remote" flow before user is authenticated
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * @param {string} peer_addr
     * @returns {Promise<BlobResult>}
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
     * upload a blob to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * returns UploadResult with blob_id and job_id on success
     * @param {string} peer_addr
     * @param {string} filename
     * @param {string} content_type
     * @param {Uint8Array} data
     * @returns {Promise<UploadResult>}
     */
    upload_blob(peer_addr, filename, content_type, data) {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ptr0 = passStringToWasm0(peer_addr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(content_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.middennode_upload_blob(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret;
    }
}
if (Symbol.dispose) MiddenNode.prototype[Symbol.dispose] = MiddenNode.prototype.free;

/**
 * upload result
 */
export class UploadResult {
    constructor() {
        throw new Error('cannot invoke `new` directly');
    }
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(UploadResult.prototype);
        obj.__wbg_ptr = ptr;
        UploadResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UploadResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_uploadresult_free(ptr, 0);
    }
    /**
     * get the created blob_id (if successful)
     * @returns {string | undefined}
     */
    blob_id() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.uploadresult_blob_id(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * get the full server response body (for Zod validation)
     * @returns {string | undefined}
     */
    body() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.uploadresult_body(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * get the import job_id
     * @returns {string | undefined}
     */
    job_id() {
        if (this.__wbg_ptr == 0) throw new Error('Attempt to use a moved value');
        _assertNum(this.__wbg_ptr);
        const ret = wasm.uploadresult_job_id(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) UploadResult.prototype[Symbol.dispose] = UploadResult.prototype.free;

export function start() {
    wasm.start();
}

//#endregion

//#region wasm imports
export function __wbg_Error_83742b46f01ce22d() { return logError(function (arg0, arg1) {
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
export function __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    if (!isLikeNone(ret)) {
        _assertBoolean(ret);
    }
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
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_object_781bc9f159099513(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_string_7ef6b97b02428fae(arg0) {
    const ret = typeof(arg0) === 'string';
    _assertBoolean(ret);
    return ret;
}
export function __wbg___wbindgen_is_undefined_52709e72fb9f179c(arg0) {
    const ret = arg0 === undefined;
    _assertBoolean(ret);
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
export function __wbg__wbg_cb_unref_6b5b6b8576d35cb1() { return logError(function (arg0) {
    arg0._wbg_cb_unref();
}, arguments); }
export function __wbg_abort_5ef96933660780b7() { return logError(function (arg0) {
    arg0.abort();
}, arguments); }
export function __wbg_abort_6479c2d794ebf2ee() { return logError(function (arg0, arg1) {
    arg0.abort(arg1);
}, arguments); }
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
export function __wbg_blobresult_new() { return logError(function (arg0) {
    const ret = BlobResult.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_body_ac1dad652946e6da() { return logError(function (arg0) {
    const ret = arg0.body;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_buffer_60b8043cd926067d() { return logError(function (arg0) {
    const ret = arg0.buffer;
    return ret;
}, arguments); }
export function __wbg_byobRequest_6342e5f2b232c0f9() { return logError(function (arg0) {
    const ret = arg0.byobRequest;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_byteLength_607b856aa6c5a508() { return logError(function (arg0) {
    const ret = arg0.byteLength;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_byteOffset_b26b63681c83856c() { return logError(function (arg0) {
    const ret = arg0.byteOffset;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_call_2d781c1f4d5c0ef8() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_call_dcc2662fa17a72cf() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.call(arg1, arg2, arg3);
    return ret;
}, arguments); }
export function __wbg_call_e133b57c9155d22c() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments); }
export function __wbg_cancel_79b3bea07a1028e7() { return logError(function (arg0) {
    const ret = arg0.cancel();
    return ret;
}, arguments); }
export function __wbg_catch_d7ed0375ab6532a5() { return logError(function (arg0, arg1) {
    const ret = arg0.catch(arg1);
    return ret;
}, arguments); }
export function __wbg_clearTimeout_47a40e3be01ed7a3() { return handleError(function (arg0, arg1) {
    arg0.clearTimeout(arg1);
}, arguments); }
export function __wbg_clearTimeout_6b8d9a38b9263d65() { return logError(function (arg0) {
    const ret = clearTimeout(arg0);
    return ret;
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
export function __wbg_code_aea376e2d265a64f() { return logError(function (arg0) {
    const ret = arg0.code;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_code_bc4dde4d67926010() { return logError(function (arg0) {
    const ret = arg0.code;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_createTask_6eb3a8b6dd2f87c9() { return handleError(function (arg0, arg1) {
    const ret = console.createTask(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_crypto_38df2bab126b63dc() { return logError(function (arg0) {
    const ret = arg0.crypto;
    return ret;
}, arguments); }
export function __wbg_data_a3d9ff9cdd801002() { return logError(function (arg0) {
    const ret = arg0.data;
    return ret;
}, arguments); }
export function __wbg_debug_eaef3b49d572d680() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.debug(...v0);
}, arguments); }
export function __wbg_done_08ce71ee07e3bd17() { return logError(function (arg0) {
    const ret = arg0.done;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_enqueue_ec3552838b4b7fbf() { return handleError(function (arg0, arg1) {
    arg0.enqueue(arg1);
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
export function __wbg_fetch_5550a88cf343aaa9() { return logError(function (arg0, arg1) {
    const ret = arg0.fetch(arg1);
    return ret;
}, arguments); }
export function __wbg_fetch_9dad4fe911207b37() { return logError(function (arg0) {
    const ret = fetch(arg0);
    return ret;
}, arguments); }
export function __wbg_getRandomValues_3f44b700395062e5() { return handleError(function (arg0, arg1) {
    globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
}, arguments); }
export function __wbg_getRandomValues_c44a50d8cfdaebeb() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments); }
export function __wbg_getReader_b4b1868fbca77dbe() { return handleError(function (arg0) {
    const ret = arg0.getReader();
    return ret;
}, arguments); }
export function __wbg_get_326e41e095fb2575() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_3ef1eba1850ade27() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_done_d0ab690f8df5501f() { return logError(function (arg0) {
    const ret = arg0.done;
    if (!isLikeNone(ret)) {
        _assertBoolean(ret);
    }
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}, arguments); }
export function __wbg_get_value_548ae6adf5a174e4() { return logError(function (arg0) {
    const ret = arg0.value;
    return ret;
}, arguments); }
export function __wbg_has_926ef2ff40b308cf() { return handleError(function (arg0, arg1) {
    const ret = Reflect.has(arg0, arg1);
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbg_headers_eb2234545f9ff993() { return logError(function (arg0) {
    const ret = arg0.headers;
    return ret;
}, arguments); }
export function __wbg_instanceof_ArrayBuffer_101e2bf31071a9f6() { return logError(function (arg0) {
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
export function __wbg_instanceof_Blob_c91af000f11c2d0b() { return logError(function (arg0) {
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
export function __wbg_instanceof_Response_9b4d9fd451e051b1() { return logError(function (arg0) {
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
export function __wbg_iterator_d8f549ec8fb061b1() { return logError(function () {
    const ret = Symbol.iterator;
    return ret;
}, arguments); }
export function __wbg_length_ea16607d7b61445b() { return logError(function (arg0) {
    const ret = arg0.length;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_log_7a0760e115750083() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.log(...v0);
}, arguments); }
export function __wbg_message_e959edc81e4b6cb7() { return logError(function (arg0, arg1) {
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
export function __wbg_new_0837727332ac86ba() { return handleError(function () {
    const ret = new Headers();
    return ret;
}, arguments); }
export function __wbg_new_227d7c05414eb861() { return logError(function () {
    const ret = new Error();
    return ret;
}, arguments); }
export function __wbg_new_5f486cdf45a04d78() { return logError(function (arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
}, arguments); }
export function __wbg_new_a70fbab9066b301f() { return logError(function () {
    const ret = new Array();
    return ret;
}, arguments); }
export function __wbg_new_ab79df5bd7c26067() { return logError(function () {
    const ret = new Object();
    return ret;
}, arguments); }
export function __wbg_new_c518c60af666645b() { return handleError(function () {
    const ret = new AbortController();
    return ret;
}, arguments); }
export function __wbg_new_d15cb560a6a0e5f0() { return logError(function (arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_dd50bcc3f60ba434() { return handleError(function (arg0, arg1) {
    const ret = new WebSocket(getStringFromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_from_slice_22da9388ac046e50() { return logError(function (arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
}, arguments); }
export function __wbg_new_typed_aaaeaf29cf802876() { return logError(function (arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__hb37f1d12fbbbca88(a, state0.b, arg0, arg1);
            } finally {
                state0.a = a;
            }
        };
        const ret = new Promise(cb0);
        return ret;
    } finally {
        state0.a = state0.b = 0;
    }
}, arguments); }
export function __wbg_new_with_byte_offset_and_length_b2ec5bf7b2f35743() { return logError(function (arg0, arg1, arg2) {
    const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
    return ret;
}, arguments); }
export function __wbg_new_with_length_825018a1616e9e55() { return logError(function (arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
}, arguments); }
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
export function __wbg_next_e01a967809d1aa68() { return logError(function (arg0) {
    const ret = arg0.next;
    return ret;
}, arguments); }
export function __wbg_node_84ea875411254db1() { return logError(function (arg0) {
    const ret = arg0.node;
    return ret;
}, arguments); }
export function __wbg_now_16f0c993d5dd6c27() { return logError(function () {
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
export function __wbg_prototypesetcall_d62e5099504357e6() { return logError(function (arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}, arguments); }
export function __wbg_push_e87b0e732085a946() { return logError(function (arg0, arg1) {
    const ret = arg0.push(arg1);
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_queueMicrotask_0c399741342fb10f() { return logError(function (arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
}, arguments); }
export function __wbg_queueMicrotask_a082d78ce798393e() { return logError(function (arg0) {
    queueMicrotask(arg0);
}, arguments); }
export function __wbg_randomFillSync_6c25eac9869eb53c() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments); }
export function __wbg_read_7f593a961a7f80ed() { return logError(function (arg0) {
    const ret = arg0.read();
    return ret;
}, arguments); }
export function __wbg_readyState_1f1e7f1bdf9f4d42() { return logError(function (arg0) {
    const ret = arg0.readyState;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_reason_cbcb9911796c4714() { return logError(function (arg0, arg1) {
    const ret = arg1.reason;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_releaseLock_ef7766a5da654ff8() { return logError(function (arg0) {
    arg0.releaseLock();
}, arguments); }
export function __wbg_removeEventListener_c15bc311b6a5d11f() { return handleError(function (arg0, arg1, arg2, arg3) {
    arg0.removeEventListener(getStringFromWasm0(arg1, arg2), arg3);
}, arguments); }
export function __wbg_require_b4edbdcf3e2a1ef0() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments); }
export function __wbg_resolve_ae8d83246e5bcc12() { return logError(function (arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
}, arguments); }
export function __wbg_respond_e286ee502e7cf7e4() { return handleError(function (arg0, arg1) {
    arg0.respond(arg1 >>> 0);
}, arguments); }
export function __wbg_run_78b7b601add6ed6b() { return logError(function (arg0, arg1, arg2) {
    try {
        var state0 = {a: arg1, b: arg2};
        var cb0 = () => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__h569cea25dbd1aa76(a, state0.b, );
            } finally {
                state0.a = a;
            }
        };
        const ret = arg0.run(cb0);
        _assertBoolean(ret);
        return ret;
    } finally {
        state0.a = state0.b = 0;
    }
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
export function __wbg_setTimeout_f757f00851f76c42() { return logError(function (arg0, arg1) {
    const ret = setTimeout(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_set_6be42768c690e380() { return logError(function (arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}, arguments); }
export function __wbg_set_8c0b3ffcf05d61c2() { return logError(function (arg0, arg1, arg2) {
    arg0.set(getArrayU8FromWasm0(arg1, arg2));
}, arguments); }
export function __wbg_set_binaryType_3dcf8281ec100a8f() { return logError(function (arg0, arg1) {
    arg0.binaryType = __wbindgen_enum_BinaryType[arg1];
}, arguments); }
export function __wbg_set_body_a3d856b097dfda04() { return logError(function (arg0, arg1) {
    arg0.body = arg1;
}, arguments); }
export function __wbg_set_cache_ec7e430c6056ebda() { return logError(function (arg0, arg1) {
    arg0.cache = __wbindgen_enum_RequestCache[arg1];
}, arguments); }
export function __wbg_set_credentials_ed63183445882c65() { return logError(function (arg0, arg1) {
    arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
}, arguments); }
export function __wbg_set_handle_event_d54649fda219fb74() { return logError(function (arg0, arg1) {
    arg0.handleEvent = arg1;
}, arguments); }
export function __wbg_set_headers_3c8fecc693b75327() { return logError(function (arg0, arg1) {
    arg0.headers = arg1;
}, arguments); }
export function __wbg_set_method_8c015e8bcafd7be1() { return logError(function (arg0, arg1, arg2) {
    arg0.method = getStringFromWasm0(arg1, arg2);
}, arguments); }
export function __wbg_set_mode_5a87f2c809cf37c2() { return logError(function (arg0, arg1) {
    arg0.mode = __wbindgen_enum_RequestMode[arg1];
}, arguments); }
export function __wbg_set_onclose_8da801226bdd7a7b() { return logError(function (arg0, arg1) {
    arg0.onclose = arg1;
}, arguments); }
export function __wbg_set_onerror_901ca711f94a5bbb() { return logError(function (arg0, arg1) {
    arg0.onerror = arg1;
}, arguments); }
export function __wbg_set_onmessage_6f80ab771bf151aa() { return logError(function (arg0, arg1) {
    arg0.onmessage = arg1;
}, arguments); }
export function __wbg_set_onopen_34e3e24cf9337ddd() { return logError(function (arg0, arg1) {
    arg0.onopen = arg1;
}, arguments); }
export function __wbg_set_signal_0cebecb698f25d21() { return logError(function (arg0, arg1) {
    arg0.signal = arg1;
}, arguments); }
export function __wbg_signal_166e1da31adcac18() { return logError(function (arg0) {
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
export function __wbg_static_accessor_GLOBAL_8adb955bd33fac2f() { return logError(function () {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913() { return logError(function () {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_SELF_f207c857566db248() { return logError(function () {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_static_accessor_WINDOW_bb9f1ba69d61b386() { return logError(function () {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_status_318629ab93a22955() { return logError(function (arg0) {
    const ret = arg0.status;
    _assertNum(ret);
    return ret;
}, arguments); }
export function __wbg_stringify_5ae93966a84901ac() { return handleError(function (arg0) {
    const ret = JSON.stringify(arg0);
    return ret;
}, arguments); }
export function __wbg_subarray_a068d24e39478a8a() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
}, arguments); }
export function __wbg_then_098abe61755d12f6() { return logError(function (arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
}, arguments); }
export function __wbg_then_9e335f6dd892bc11() { return logError(function (arg0, arg1, arg2) {
    const ret = arg0.then(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_uploadresult_new() { return logError(function (arg0) {
    const ret = UploadResult.__wrap(arg0);
    return ret;
}, arguments); }
export function __wbg_url_778f9516ea867e17() { return logError(function (arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_url_7fefc1820fba4e0c() { return logError(function (arg0, arg1) {
    const ret = arg1.url;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}, arguments); }
export function __wbg_value_21fc78aab0322612() { return logError(function (arg0) {
    const ret = arg0.value;
    return ret;
}, arguments); }
export function __wbg_versions_276b2795b1c6a219() { return logError(function (arg0) {
    const ret = arg0.versions;
    return ret;
}, arguments); }
export function __wbg_view_f68a712e7315f8b2() { return logError(function (arg0) {
    const ret = arg0.view;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_warn_3a37cdd7216f1479() { return logError(function (arg0, arg1) {
    var v0 = getArrayJsValueFromWasm0(arg0, arg1).slice();
    wasm.__wbindgen_free(arg0, arg1 * 4, 4);
    console.warn(...v0);
}, arguments); }
export function __wbg_wasClean_69f68dc4ed2d2cc7() { return logError(function (arg0) {
    const ret = arg0.wasClean;
    _assertBoolean(ret);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000001() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 1955, function: Function { arguments: [NamedExternref("CloseEvent")], shim_idx: 1956, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h04df11150c2ec967, wasm_bindgen__convert__closures_____invoke__hab17faabe688f6d8);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000002() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 2395, function: Function { arguments: [], shim_idx: 2396, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__ha7f394643b1887b3, wasm_bindgen__convert__closures_____invoke__he5a7fdd38fa79d5e);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000003() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 2455, function: Function { arguments: [Externref], shim_idx: 2456, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h62030f04146461fd, wasm_bindgen__convert__closures_____invoke__h66dcf80ecdfd60a9);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000004() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 2479, function: Function { arguments: [], shim_idx: 2480, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h662eff4f51ac122f, wasm_bindgen__convert__closures_____invoke__ha42ef89cec163d20);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000005() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 2484, function: Function { arguments: [], shim_idx: 2485, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
    const ret = makeClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h94ada4b4ca07a4ba, wasm_bindgen__convert__closures_____invoke__h8e48a5c06956cc7f);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000006() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 2881, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 2882, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h8a10a08b2dea436a, wasm_bindgen__convert__closures_____invoke__hf0f0900181bab35b);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000007() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 4413, function: Function { arguments: [], shim_idx: 4414, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__hf45afd2339ecd0b0, wasm_bindgen__convert__closures_____invoke__h527d1a328962d6ec);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000008() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { dtor_idx: 4424, function: Function { arguments: [Externref], shim_idx: 4456, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen__closure__destroy__h80c7527661a50b70, wasm_bindgen__convert__closures_____invoke__ha84b42b578005502);
    return ret;
}, arguments); }
export function __wbindgen_cast_0000000000000009() { return logError(function (arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000a() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
}, arguments); }
export function __wbindgen_cast_000000000000000b() { return logError(function (arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
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
function wasm_bindgen__convert__closures_____invoke__he5a7fdd38fa79d5e(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__he5a7fdd38fa79d5e(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__ha42ef89cec163d20(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__ha42ef89cec163d20(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h8e48a5c06956cc7f(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h8e48a5c06956cc7f(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h527d1a328962d6ec(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h527d1a328962d6ec(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h569cea25dbd1aa76(arg0, arg1) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h569cea25dbd1aa76(arg0, arg1);
    return ret !== 0;
}

function wasm_bindgen__convert__closures_____invoke__hab17faabe688f6d8(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hab17faabe688f6d8(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h66dcf80ecdfd60a9(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__h66dcf80ecdfd60a9(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__hf0f0900181bab35b(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hf0f0900181bab35b(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__ha84b42b578005502(arg0, arg1, arg2) {
    _assertNum(arg0);
    _assertNum(arg1);
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__ha84b42b578005502(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__hb37f1d12fbbbca88(arg0, arg1, arg2, arg3) {
    _assertNum(arg0);
    _assertNum(arg1);
    wasm.wasm_bindgen__convert__closures_____invoke__hb37f1d12fbbbca88(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_BinaryType = ["blob", "arraybuffer"];


const __wbindgen_enum_ReadableStreamType = ["bytes"];


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];


const __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];
const BlobResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_blobresult_free(ptr >>> 0, 1));
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
const UploadResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_uploadresult_free(ptr >>> 0, 1));


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
