// api client facade - THE boundary between spume and freqhole-api-client
//
// this is the ONLY file in spume that imports from freqhole-api-client.
// all other files should import from this module.
//
// purpose:
// - contain the external dependency to a single choke point
// - re-export functions, types, and helpers that spume needs
// - enable future transport swaps (HTTP → P2P) in one place

import {
  createHttpClient,
  isAuthError,
  isNetworkError,
  FreqholeClient,
  HttpTransport,
  WasmTransport,
  createCharnelTransport,
  getCharnelNodeId,
  createCharnelLocalTransport,
  type MiddenNodeLike,
  type Transport,
} from "freqhole-api-client";
import { isCharnelMode } from "../services/charnel";

// re-export for call sites that still need direct access
// note: isCharnelAvailable uses local isCharnelMode which checks both env var and window.__TAURI__
export { createHttpClient, isAuthError, isNetworkError };
export { isCharnelMode as isCharnelAvailable };

// client type (inferred from factory function)
export type { FreqholeClient } from "freqhole-api-client";

// result type for api calls
export type { SafeParseResult } from "freqhole-api-client";

// transport types (for future P2P transport)
export type {
  Transport,
  TransportResponse,
  BlobData,
} from "freqhole-api-client";

// permission helpers
export { permissions } from "freqhole-api-client";

// webauthn helpers
export { webauthn } from "freqhole-api-client";

// url/media helpers
export { utils } from "freqhole-api-client";

// types re-exported for spume use
export type { UserRoleName } from "freqhole-api-client";

// API parameter type (used internally by data layer)
export type { QueryParams as ApiQueryParams } from "freqhole-api-client";

// type alias for client instance (convenience for typing)
import type { createHttpClient as CreateHttpClientFn } from "freqhole-api-client";
export type ApiClient = ReturnType<typeof CreateHttpClientFn>;

// re-export TransportType and Remote for consumers
import type { TransportType, Remote, RemoteRef, HttpRemote, P2PRemote } from "../services/storage/types";
import { isHttpRemote, isP2PRemote, toRemoteRef } from "../services/storage/types";
import { getRemoteCacheName } from "../../music/services/cache/cacheNames";
export type { TransportType, Remote, RemoteRef, HttpRemote, P2PRemote };
export { isHttpRemote, isP2PRemote, toRemoteRef };

// ============================================================================
// transport factory - THE place where transport selection happens
// ============================================================================

/**
 * minimal remote-like shape needed to create a client.
 * RemoteRef is permissive and accepts both new discriminated format and legacy format.
 */
export type RemoteLike = RemoteRef;

/**
 * create a transient http remote for one-off connections.
 * use this when you don't have a saved Remote yet (auth flows, connectivity tests).
 */
export function httpRemote(baseUrl: string, apiKey?: string): RemoteLike {
  return { transport: "http", base_url: baseUrl, api_key: apiKey };
}

// ============================================================================
// midden node singleton (lazy initialization for P2P transport)
// ============================================================================

import { getP2PIdentity, saveP2PIdentity } from "../services/storage/db";

let middenNode: MiddenNodeLike | null = null;
let middenNodePromise: Promise<MiddenNodeLike> | null = null;

/**
 * get or create the midden node singleton.
 * uses persisted identity from IndexedDB if available, otherwise creates new.
 * NOTE: throws in Tauri builds - use CharnelTransport instead.
 */
export async function getMiddenNode(): Promise<MiddenNodeLike> {
  // midden WASM is not available in Tauri builds - use app P2P
  if (isCharnelMode()) {
    throw new Error("midden WASM not available in Tauri - use transport_type: 'app' for P2P");
  }

  if (middenNode) {
    return middenNode;
  }

  if (middenNodePromise) {
    return middenNodePromise;
  }

  // lazy import midden to avoid bundling it when not used
  middenNodePromise = (async (): Promise<MiddenNodeLike> => {
    const { MiddenNode } = await import("midden");

    // check for persisted identity
    const existingIdentity = await getP2PIdentity();

    let node: MiddenNodeLike;
    if (existingIdentity) {
      // restore from persisted key
      console.log("[midden] restoring identity from IndexedDB:", existingIdentity.node_id.slice(0, 16) + "...");
      node = await MiddenNode.create_from_key(existingIdentity.secret_key);
    } else {
      // create new identity and persist it
      node = await MiddenNode.create();
      const secretKey = node.secret_key();
      const nodeId = node.node_id();
      await saveP2PIdentity(secretKey, nodeId);
      console.log("[midden] created new identity:", nodeId.slice(0, 16) + "...");
    }

    middenNode = node;
    const nodeId = node.node_id();
    console.log("[midden] node ready, node_id:", nodeId);
    return node;
  })();

  return middenNodePromise;
}

/**
 * get our local node_id (for sharing with peers).
 * returns null if P2P not initialized yet.
 */
export function getLocalNodeId(): string | null {
  return middenNode?.node_id() ?? null;
}

/**
 * get local node_id (async - works for both midden and tauri)
 */
export async function getLocalNodeIdAsync(): Promise<string | null> {
  if (middenNode) {
    return middenNode.node_id();
  }
  if (isCharnelMode()) {
    try {
      return await getCharnelNodeId();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * check if midden node is initialized
 */
export function isMiddenInitialized(): boolean {
  return middenNode !== null;
}

// ============================================================================
// client factory
// ============================================================================

/** resolve transport type from RemoteLike (handles both new and legacy formats) */
function resolveTransport(remote: RemoteLike): "http" | "wasm" | "app" {
  // new discriminated format
  if ("transport" in remote && remote.transport) {
    return remote.transport;
  }
  // legacy format - infer from fields
  if ("transport_type" in remote && remote.transport_type) {
    return remote.transport_type;
  }
  // fallback: infer from presence of peer_addr vs base_url
  if ("peer_addr" in remote && remote.peer_addr) {
    return isCharnelMode() ? "app" : "wasm";
  }
  return "http";
}

/** resolve peer_addr from RemoteLike */
function resolvePeerAddr(remote: RemoteLike): string | undefined {
  if ("peer_addr" in remote) {
    return remote.peer_addr;
  }
  return undefined;
}

/** resolve base_url from RemoteLike */
function resolveBaseUrl(remote: RemoteLike): string | undefined {
  if ("base_url" in remote) {
    return remote.base_url || undefined;
  }
  return undefined;
}

/**
 * create a client for a remote.
 * transport selection happens HERE - call sites don't need to know which
 * transport is used.
 */
export async function getClientForRemote(remote: RemoteLike): Promise<ApiClient> {
  const transportType = resolveTransport(remote);
  const peerAddr = resolvePeerAddr(remote);
  const baseUrl = resolveBaseUrl(remote);
  
  switch (transportType) {
    case 'app':
      if (!peerAddr) {
        throw new Error('peer_addr required for app transport');
      }
      return new FreqholeClient(await createCharnelTransport(peerAddr));
      
    case 'wasm':
      if (!peerAddr) {
        throw new Error('peer_addr required for wasm transport');
      }
      const clientNode = await getMiddenNode();
      const clientCacheName = remote.remote_id ? getRemoteCacheName(remote.remote_id) : undefined;
      return new FreqholeClient(new WasmTransport(clientNode, peerAddr, clientCacheName));
      
    case 'http':
    default:
      // charnel-managed remotes use IPC (no base_url needed)
      if (isCharnelMode() && remote.is_charnel_managed) {
        console.log('[client] using CharnelLocalTransport for tauri-managed remote');
        return new FreqholeClient(createCharnelLocalTransport(""));
      }
      if (!baseUrl) {
        throw new Error('base_url required for http transport');
      }
      return new FreqholeClient(new HttpTransport(baseUrl, remote.api_key));
  }
}

// ============================================================================
// transport factory - for direct transport access (blob operations, etc.)
// ============================================================================

/**
 * get a transport for a remote (async).
 * use this when you need direct transport access for blob operations.
 * the Transport interface abstracts away wasm/app/http differences.
 * 
 * NOTE: dispatch transport doesn't support blobs yet, so we still use
 * HttpTransport for blob operations even in Tauri mode.
 */
export async function getTransportForRemote(remote: RemoteLike): Promise<Transport> {
  const transportType = resolveTransport(remote);
  const peerAddr = resolvePeerAddr(remote);
  const baseUrl = resolveBaseUrl(remote);
  
  switch (transportType) {
    case 'app':
      if (!peerAddr) {
        throw new Error('peer_addr required for app transport');
      }
      const appCacheName = remote.remote_id ? getRemoteCacheName(remote.remote_id) : undefined;
      return createCharnelTransport(peerAddr, appCacheName);
      
    case 'wasm':
      if (!peerAddr) {
        throw new Error('peer_addr required for wasm transport');
      }
      const transportNode = await getMiddenNode();
      const transportCacheName = remote.remote_id ? getRemoteCacheName(remote.remote_id) : undefined;
      return new WasmTransport(transportNode, peerAddr, transportCacheName);
      
    case 'http':
    default:
      // charnel-managed remotes use IPC (no base_url needed)
      if (isCharnelMode() && remote.is_charnel_managed) {
        return createCharnelLocalTransport("");
      }
      if (!baseUrl) {
        throw new Error('base_url required for http transport');
      }
      return new HttpTransport(baseUrl, remote.api_key);
  }
}

/**
 * check if a remote uses P2P transport (wasm or app).
 */
export function isP2PTransportType(remote: RemoteLike): boolean {
  const transportType = resolveTransport(remote);
  return transportType === 'wasm' || transportType === 'app';
}
