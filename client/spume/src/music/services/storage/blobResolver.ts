// blob resolver - resolves blob IDs to URLs for any transport type
//
// for HTTP remotes: returns direct URLs (browser handles auth via cookies/api key)
// for P2P remotes: fetches via WasmTransport, caches in Cache API, returns blob URL
//
// usage:
//   const url = await resolveBlobUrl(blobId, remoteId);
//   <img src={url} /> or <audio src={url} />

import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import {
  getMiddenNode,
  type Remote,
} from "../../../app/api/client";
import { WasmTransport } from "freqhole-api-client";
import { debug } from "../../../utils/logger";

// cache of active blob URLs to prevent memory leaks
// keyed by `${remoteId}/${blobId}`
const activeBlobUrls = new Map<string, string>();

/**
 * resolve a blob ID to a URL for display/playback.
 *
 * @param blobId - the blob ID (sha256 or server blob ID)
 * @param remoteId - the remote server ID (for looking up transport type)
 * @returns URL string usable in <img src> or <audio src>
 */
export async function resolveBlobUrl(
  blobId: string,
  remoteId: string,
): Promise<string> {
  debug("blobResolver", `resolving blob ${blobId.slice(0, 8)}... for remote ${remoteId}`);

  const remote = await getRemoteById(remoteId);
  if (!remote) {
    throw new Error(`remote not found: ${remoteId}`);
  }

  // check if we already have an active blob URL
  const cacheKey = `${remoteId}/${blobId}`;
  const cached = activeBlobUrls.get(cacheKey);
  if (cached) {
    debug("blobResolver", `using cached blob URL for ${blobId.slice(0, 8)}...`);
    return cached;
  }

  // determine transport type
  const transportType = remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");

  if (transportType === "wasm") {
    return resolveP2PBlob(blobId, remote, cacheKey);
  } else {
    // HTTP transport - return direct URL
    return `${remote.base_url}/api/blobs/${blobId}`;
  }
}

/**
 * resolve a blob via P2P transport.
 * fetches the blob, caches it, and returns a blob URL.
 */
async function resolveP2PBlob(
  blobId: string,
  remote: Remote,
  cacheKey: string,
): Promise<string> {
  debug("blobResolver", `fetching P2P blob ${blobId.slice(0, 8)}...`);

  if (!remote.peer_addr) {
    throw new Error(`remote ${remote.remote_id} has no peer_addr for P2P transport`);
  }

  // get midden node and create transport
  const node = await getMiddenNode();
  const transport = new WasmTransport(node, remote.peer_addr);

  // use WasmTransport's getBlobUrl which fetches, caches, and returns blob URL
  const url = await transport.getBlobUrl(blobId);

  // track the URL for cleanup
  activeBlobUrls.set(cacheKey, url);

  debug("blobResolver", `resolved P2P blob ${blobId.slice(0, 8)}... to blob URL`);
  return url;
}

/**
 * revoke a cached blob URL to free memory.
 * call this when an image/audio element is removed from the DOM.
 */
export function revokeBlobUrl(blobId: string, remoteId: string): void {
  const cacheKey = `${remoteId}/${blobId}`;
  const url = activeBlobUrls.get(cacheKey);
  if (url) {
    // only revoke blob: URLs (not http: URLs)
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
    activeBlobUrls.delete(cacheKey);
    debug("blobResolver", `revoked blob URL for ${blobId.slice(0, 8)}...`);
  }
}

/**
 * clear all cached blob URLs.
 * call this on logout or when switching remotes.
 */
export function clearAllBlobUrls(): void {
  for (const url of activeBlobUrls.values()) {
    if (url.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
  activeBlobUrls.clear();
  debug("blobResolver", "cleared all blob URLs");
}

/**
 * check if a remote uses P2P transport.
 */
export async function isP2PRemote(remoteId: string): Promise<boolean> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return false;
  const transportType = remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");
  return transportType === "wasm";
}

/**
 * get the transport type for a remote.
 */
export async function getRemoteTransportType(
  remoteId: string,
): Promise<"http" | "wasm" | "app" | null> {
  const remote = await getRemoteById(remoteId);
  if (!remote) return null;
  return remote.transport_type ?? (remote.peer_addr ? "wasm" : "http");
}
