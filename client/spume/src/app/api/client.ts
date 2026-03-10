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
  createTauriTransport,
  getTauriNodeId,
  type MiddenNodeLike,
  type Transport,
} from "freqhole-api-client";
import { isTauriMode } from "../../utils/tauri";

// re-export for call sites that still need direct access
// note: isTauriAvailable uses local isTauriMode which checks both env var and window.__TAURI__
export { createHttpClient, isAuthError, isNetworkError };
export { isTauriMode as isTauriAvailable };

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
import type { TransportType, Remote } from "../services/storage/types";
export type { TransportType, Remote };

// ============================================================================
// transport factory - THE place where transport selection happens
// ============================================================================

/** minimal remote-like shape needed to create a client */
export type RemoteLike = {
  base_url?: string;
  api_key?: string;
  transport_type?: TransportType;
  peer_addr?: string; // for wasm transport: node_id or full endpoint JSON
};

/**
 * remote reference with required fields for making API calls.
 * use this for functions that need to track which remote they're talking to.
 */
export type RemoteRef = {
  remote_id: string;
  base_url: string;
  name?: string;
  api_key?: string;
  transport_type?: TransportType;
  peer_addr?: string; // for wasm transport: node_id or full endpoint JSON
};

/**
 * create a transient http remote for one-off connections.
 * use this when you don't have a saved Remote yet (auth flows, connectivity tests).
 */
export function httpRemote(baseUrl: string, apiKey?: string): RemoteLike {
  return { base_url: baseUrl, api_key: apiKey, transport_type: 'http' };
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
 * NOTE: throws in Tauri builds - use TauriTransport instead.
 */
export async function getMiddenNode(): Promise<MiddenNodeLike> {
  // midden WASM is not available in Tauri builds - use app P2P
  if (isTauriMode()) {
    throw new Error("midden WASM not available in Tauri - use transport_type: 'app' for P2P");
  }

  if (middenNode) {
    return middenNode;
  }

  if (middenNodePromise) {
    return middenNodePromise;
  }

  // lazy import midden to avoid bundling it when not used
  middenNodePromise = (async () => {
    const { MiddenNode } = await import("midden");

    // check for persisted identity
    const existingIdentity = await getP2PIdentity();

    if (existingIdentity) {
      // restore from persisted key
      console.log("[midden] restoring identity from IndexedDB:", existingIdentity.node_id.slice(0, 16) + "...");
      middenNode = await MiddenNode.create_from_key(existingIdentity.secret_key);
    } else {
      // create new identity and persist it
      middenNode = await MiddenNode.create();
      const secretKey = middenNode.secret_key();
      const nodeId = middenNode.node_id();
      await saveP2PIdentity(secretKey, nodeId);
      console.log("[midden] created new identity:", nodeId.slice(0, 16) + "...");
    }

    const nodeId = middenNode.node_id();
    console.log("[midden] node ready, node_id:", nodeId);
    return middenNode;
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
  if (isTauriMode()) {
    try {
      return await getTauriNodeId();
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

/**
 * create a client for a remote.
 * transport selection happens HERE - call sites don't need to know which
 * transport is used.
 */
export async function getClientForRemote(remote: RemoteLike): Promise<ApiClient> {
  // infer transport type: use wasm if peer_addr is present, otherwise http
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  
  switch (transportType) {
    case 'app':
      if (!remote.peer_addr) {
        throw new Error('peer_addr required for app transport');
      }
      return new FreqholeClient(await createTauriTransport(remote.peer_addr));
      
    case 'wasm':
      if (!remote.peer_addr) {
        throw new Error('peer_addr required for wasm transport');
      }
      const node = await getMiddenNode();
      return new FreqholeClient(new WasmTransport(node, remote.peer_addr));
      
    case 'http':
    default:
      if (!remote.base_url) {
        throw new Error('base_url required for http transport');
      }
      return new FreqholeClient(new HttpTransport(remote.base_url, remote.api_key));
  }
}

// ============================================================================
// transport factory - for direct transport access (blob operations, etc.)
// ============================================================================

/**
 * get a transport for a remote (async).
 * use this when you need direct transport access for blob operations.
 * the Transport interface abstracts away wasm/app/http differences.
 */
export async function getTransportForRemote(remote: RemoteLike): Promise<Transport> {
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  
  switch (transportType) {
    case 'app':
      if (!remote.peer_addr) {
        throw new Error('peer_addr required for app transport');
      }
      return createTauriTransport(remote.peer_addr);
      
    case 'wasm':
      if (!remote.peer_addr) {
        throw new Error('peer_addr required for wasm transport');
      }
      const node = await getMiddenNode();
      return new WasmTransport(node, remote.peer_addr);
      
    case 'http':
    default:
      if (!remote.base_url) {
        throw new Error('base_url required for http transport');
      }
      return new HttpTransport(remote.base_url, remote.api_key);
  }
}

/**
 * check if a remote uses P2P transport (wasm or app).
 */
export function isP2PTransportType(remote: RemoteLike): boolean {
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  return transportType === 'wasm' || transportType === 'app';
}
