// TauriTransport - P2P transport for Tauri apps
//
// uses Tauri IPC commands to make P2P requests via the server's
// app iroh endpoint. no WASM needed.

import type { Transport, TransportResponse, BlobData } from "./transport.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// tauri invoke is dynamically imported to avoid bundling in browser builds
let invoke: InvokeFn | null = null;

/**
 * initialize tauri invoke function
 * call this before using TauriTransport
 */
async function ensureInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;
  try {
    const tauri = await import("@tauri-apps/api/core");
    invoke = tauri.invoke as InvokeFn;
    return invoke;
  } catch {
    throw new Error("@tauri-apps/api not available - not running in Tauri");
  }
}

/**
 * check if tauri is available
 */
export function isTauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

// unified cache for blobs - reuse same cache name as WasmTransport for consistency
const CACHE_NAME = "freqhole-blobs-v1";

// in-memory url cache for revocation
const urlCache = new Map<string, string>();

/**
 * decode base64 string to Uint8Array
 * handles both standard and URL-safe base64 encoding
 */
function base64ToBytes(base64: string): Uint8Array {
  // convert URL-safe base64 to standard base64
  let standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  // add padding if needed
  const padLen = (4 - (standardBase64.length % 4)) % 4;
  standardBase64 += '='.repeat(padLen);
  
  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * TauriTransport - P2P transport using Tauri IPC commands
 * implements Transport interface for use with FreqholeClient
 */
export class TauriTransport implements Transport {
  private peerAddr: string;
  private nodeId: string | null = null;

  constructor(peerAddr: string) {
    this.peerAddr = peerAddr;
  }

  /**
   * initialize transport - must be called before use
   */
  async init(): Promise<void> {
    const inv = await ensureInvoke();

    const available = (await inv("p2p_is_available")) as boolean;
    if (!available) {
      throw new Error("P2P not available - federation endpoint not running");
    }

    this.nodeId = (await inv("p2p_get_node_id")) as string;
  }

  /**
   * get local node_id (returns null if not yet initialized)
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * make an API request via P2P
   */
  async request(method: string, path: string, body?: string): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    const result = (await inv("p2p_proxy_request", {
      peerAddr: this.peerAddr,
      method,
      path,
      body: body ?? null,
    })) as { status: number; body: string };

    return result;
  }

  /**
   * upload via P2P (not yet implemented)
   */
  async upload(_path: string, _formData: FormData): Promise<TransportResponse> {
    // P2P upload would require streaming the file over iroh
    // for now, return an error
    throw new Error("upload not supported over P2P transport");
  }

  /**
   * fetch a blob via P2P
   */
  async fetchBlob(blobId: string): Promise<BlobData> {
    const inv = await ensureInvoke();

    const result = (await inv("p2p_fetch_blob", {
      peerAddr: this.peerAddr,
      blobId,
    })) as { data: string; content_type: string | null };

    // decode base64 data (handles URL-safe encoding)
    const bytes = base64ToBytes(result.data);

    return {
      data: bytes,
      contentType: result.content_type ?? "application/octet-stream",
    };
  }

  /**
   * get a URL for a blob - caches in Cache API
   */
  async getBlobUrl(blobId: string): Promise<string> {
    // check in-memory cache first
    const cached = urlCache.get(blobId);
    if (cached) {
      return cached;
    }

    // check Cache API (use fake http URL since Cache API requires HTTP/HTTPS)
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = `https://p2p-cache.local/${this.peerAddr}/${blobId}`;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      urlCache.set(blobId, url);
      return url;
    }

    // fetch via P2P and cache
    const blobData = await this.fetchBlob(blobId);
    const blob = new Blob([blobData.data.slice().buffer], { type: blobData.contentType });

    // store in Cache API
    const response = new Response(blob, {
      headers: { "Content-Type": blobData.contentType },
    });
    await cache.put(cacheKey, response);

    // create object URL
    const url = URL.createObjectURL(blob);
    urlCache.set(blobId, url);
    return url;
  }

  /**
   * revoke a blob URL
   */
  revokeBlobUrl(blobId: string): void {
    const url = urlCache.get(blobId);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(blobId);
    }
  }

  /**
   * clear all blob URLs
   */
  clearBlobUrls(): void {
    for (const url of urlCache.values()) {
      URL.revokeObjectURL(url);
    }
    urlCache.clear();
  }
}

// transport cache - reuse instances per peer
const transportCache = new Map<string, TauriTransport>();

/**
 * get or create a TauriTransport for a peer (async)
 * initializes transport before returning
 */
export async function createTauriTransport(peerAddr: string): Promise<TauriTransport> {
  const existing = transportCache.get(peerAddr);
  if (existing) {
    return existing;
  }

  const transport = new TauriTransport(peerAddr);
  await transport.init();
  transportCache.set(peerAddr, transport);
  return transport;
}

/**
 * get or create a TauriTransport (alias for createTauriTransport)
 */
export async function getTauriTransport(peerAddr: string): Promise<TauriTransport> {
  return createTauriTransport(peerAddr);
}

/**
 * get local node_id from tauri
 */
export async function getTauriNodeId(): Promise<string> {
  const inv = await ensureInvoke();
  return (await inv("p2p_get_node_id")) as string;
}

/**
 * check if P2P is available in tauri
 */
export async function isTauriP2PAvailable(): Promise<boolean> {
  try {
    const inv = await ensureInvoke();
    return (await inv("p2p_is_available")) as boolean;
  } catch {
    return false;
  }
}
