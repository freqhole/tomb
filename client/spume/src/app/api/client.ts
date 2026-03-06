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
  // AppTransport,   // TODO: implement for tauri
  // WasmTransport,  // TODO: implement for P2P
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
};

/**
 * create a transient http remote for one-off connections.
 * use this when you don't have a saved Remote yet (auth flows, connectivity tests).
 */
export function httpRemote(baseUrl: string, apiKey?: string): RemoteLike {
  return { base_url: baseUrl, api_key: apiKey, transport_type: 'http' };
}

/**
 * create a client for a remote.
 * transport selection happens HERE - call sites don't need to know which
 * transport is used.
 */
export function getClientForRemote(remote: RemoteLike): ApiClient {
  const transportType = remote.transport_type ?? 'http';
  
  switch (transportType) {
    case 'app':
      // TODO: implement AppTransport for tauri embedded server
      // return new FreqholeClient(new AppTransport());
      console.warn('app transport not yet implemented, falling back to http');
      return new FreqholeClient(new HttpTransport(remote.base_url!, remote.api_key));
      
    case 'wasm':
      // TODO: implement WasmTransport for P2P connections
      // return new FreqholeClient(new WasmTransport(config.peer_id, config.peer_key));
      console.warn('wasm transport not yet implemented, falling back to http');
      return new FreqholeClient(new HttpTransport(remote.base_url!, remote.api_key));
      
    case 'http':
    default:
      if (!remote.base_url) {
        throw new Error('base_url required for http transport');
      }
      return new FreqholeClient(new HttpTransport(remote.base_url, remote.api_key));
  }
}
