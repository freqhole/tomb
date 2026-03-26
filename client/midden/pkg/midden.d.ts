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

/**
 * handle for a subscribed gossip topic
 *
 * holds sender and receiver halves. dropping this leaves the topic.
 */
export class GossipHandle {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * broadcast a message to all peers in the topic
     */
    broadcast(message: Uint8Array): Promise<void>;
    /**
     * receive the next event from the topic
     *
     * returns a JSON string with the event:
     * - {"type":"received","content":<base64>,"from":"<node_id>"}
     * - {"type":"neighbor_up","node_id":"<node_id>"}
     * - {"type":"neighbor_down","node_id":"<node_id>"}
     * - {"type":"lagged"}
     * - null if the topic is closed
     */
    recv(): Promise<any>;
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
 * supports three protocols:
 * - freqhole/1: API proxying and small blob streaming
 * - iroh-blobs: verified streaming for audio files
 * - iroh-gossip: pub/sub messaging for channels
 */
export class MiddenNode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
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
     * download a blob using iroh-blobs with automatic ensure + retry
     *
     * tries download_verified first. if blob not in peer's FsStore,
     * calls ensure_blob to load it, then retries.
     */
    download_verified_with_ensure(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
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
     * fetch server image from a peer (public, no auth required)
     * used during "add remote" flow before user is authenticated
     * peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
     */
    fetch_hello_image(peer_addr: string): Promise<BlobResult>;
    /**
     * subscribe to a gossip topic and wait until joined (at least one peer connected)
     *
     * topic_hex: 32-byte topic id as 64 hex chars
     * bootstrap_peers: JSON array of node_id strings (peers already in the topic)
     *
     * returns a GossipHandle for sending/receiving on this topic
     */
    gossip_join(topic_hex: string, bootstrap_peers_json: string): Promise<GossipHandle>;
    /**
     * subscribe to a gossip topic without waiting for peers
     *
     * useful when you're the first peer (no bootstrap needed).
     * returns a GossipHandle immediately.
     */
    gossip_subscribe(topic_hex: string, bootstrap_peers_json: string): Promise<GossipHandle>;
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
     * associate_with: optional JSON string with entity association metadata
     * returns UploadResult with blob_id and job_id on success
     */
    upload_blob(peer_addr: string, filename: string, content_type: string, data: Uint8Array, associate_with?: string | null): Promise<UploadResult>;
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
