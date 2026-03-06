// api client facade - THE boundary between spume and freqhole-api-client
//
// this is the ONLY file in spume that imports from freqhole-api-client.
// all other files should import from this module.
//
// purpose:
// - contain the external dependency to a single choke point
// - re-export functions, types, and helpers that spume needs
// - enable future transport swaps (HTTP → P2P) in one place

// client factory and error helpers
export {
  createHttpClient,
  isAuthError,
  isNetworkError,
} from "freqhole-api-client";

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
