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
  type MiddenNodeLike,
} from "freqhole-api-client";

// re-export for call sites that still need direct access
export { createHttpClient, isAuthError, isNetworkError };

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

let middenNode: MiddenNodeLike | null = null;
let middenNodePromise: Promise<MiddenNodeLike> | null = null;

/**
 * get or create the midden node singleton.
 * call this when you need the node, not at app startup.
 */
export async function getMiddenNode(): Promise<MiddenNodeLike> {
  if (middenNode) {
    return middenNode;
  }

  if (middenNodePromise) {
    return middenNodePromise;
  }

  // lazy import midden to avoid bundling it when not used
  middenNodePromise = (async () => {
    const { MiddenNode } = await import("midden");
    middenNode = await MiddenNode.create();
    const nodeId = middenNode.node_id();
    console.log("[midden] node created, full node_id:", nodeId);
    return middenNode;
  })();

  return middenNodePromise;
}

/**
 * get our local node_id (for sharing with peers).
 * returns null if midden not initialized yet.
 */
export function getLocalNodeId(): string | null {
  return middenNode?.node_id() ?? null;
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
 *
 * NOTE: for wasm transport, use getClientForRemoteAsync instead to ensure
 * the midden node is initialized.
 */
export function getClientForRemote(remote: RemoteLike): ApiClient {
  // infer transport type: use wasm if peer_addr is present, otherwise http
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  
  switch (transportType) {
    case 'app':
      // TODO: implement AppTransport for tauri embedded server
      console.warn('app transport not yet implemented, falling back to http');
      return new FreqholeClient(new HttpTransport(remote.base_url!, remote.api_key));
      
    case 'wasm':
      // for sync access, midden must be initialized first
      if (!middenNode) {
        throw new Error('midden node not initialized - use getClientForRemoteAsync for wasm transport');
      }
      if (!remote.peer_addr) {
        throw new Error('peer_addr required for wasm transport');
      }
      return new FreqholeClient(new WasmTransport(middenNode, remote.peer_addr));
      
    case 'http':
    default:
      if (!remote.base_url) {
        throw new Error('base_url required for http transport');
      }
      return new FreqholeClient(new HttpTransport(remote.base_url, remote.api_key));
  }
}

/**
 * create a client for a remote (async version).
 * initializes midden node if needed for wasm transport.
 */
export async function getClientForRemoteAsync(remote: RemoteLike): Promise<ApiClient> {
  // infer transport type: use wasm if peer_addr is present, otherwise http
  const transportType = remote.transport_type ?? (remote.peer_addr ? 'wasm' : 'http');
  
  if (transportType === 'wasm') {
    if (!remote.peer_addr) {
      throw new Error('peer_addr required for wasm transport');
    }
    const node = await getMiddenNode();
    return new FreqholeClient(new WasmTransport(node, remote.peer_addr));
  }
  
  // for non-wasm transports, just use sync version
  return getClientForRemote(remote);
}
