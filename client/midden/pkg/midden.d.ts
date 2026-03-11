/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

type ReadableStreamType = "bytes";

/**
 * blob fetch result
 */
export class BlobResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * get content type (if known)
     */
    content_type(): string | undefined;
    /**
     * get blob data as Uint8Array
     */
    data(): Uint8Array;
    /**
     * get blob size in bytes
     */
    size(): number;
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
 */
export class MiddenNode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
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
     * fetch a blob from a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * returns BlobResult with data and metadata
     */
    fetch_blob(peer_addr: string, blob_id: string): Promise<BlobResult>;
    /**
     * fetch a blob from a peer with progress callback
     * callback is called with (received_bytes, total_bytes) as arguments
     * if total_bytes is 0, the size is unknown
     */
    fetch_blob_with_progress(peer_addr: string, blob_id: string, on_progress: Function): Promise<BlobResult>;
    /**
     * get our node_id (iroh public key)
     */
    node_id(): string;
    /**
     * send an API request to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     */
    proxy_request(peer_addr: string, method: string, path: string, body?: string | null): Promise<any>;
    /**
     * get the secret key bytes for persistence (32 bytes)
     * store this in IndexedDB to maintain the same identity across sessions
     */
    secret_key(): Uint8Array;
    /**
     * upload a blob to a peer
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     * returns UploadResult with blob_id and job_id on success
     */
    upload_blob(peer_addr: string, filename: string, content_type: string, data: Uint8Array): Promise<UploadResult>;
}

/**
 * upload result
 */
export class UploadResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * get the created blob_id (if successful)
     */
    blob_id(): string | undefined;
    /**
     * get the full server response body (for Zod validation)
     */
    body(): string | undefined;
    /**
     * get the import job_id
     */
    job_id(): string | undefined;
}

export function start(): void;
