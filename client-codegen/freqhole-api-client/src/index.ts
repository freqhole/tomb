// freqhole api client - main exports

// instance-based client
export { FreqholeClient, createClient, createHttpClient, isAuthError, isNetworkError } from "./FreqholeClient.js";
export type { SafeParseResult } from "./FreqholeClient.js";

// transport abstraction
export { HttpTransport } from "./transport.js";
export { WasmTransport } from "./WasmTransport.js";
export { TauriTransport, createTauriTransport, getTauriTransport, getTauriNodeId, isTauriAvailable, isTauriP2PAvailable } from "./TauriTransport.js";
export type { MiddenNodeLike, BlobResultLike, BlobProgressCallback } from "./WasmTransport.js";
export type { Transport, TransportResponse, BlobData } from "./transport.js";

// export utilities (url helpers, uploads, etc)
export * as utils from "./utils.js";

// export webauthn helpers
export * as webauthn from "./webauthn.js";

// export permission helpers
export * as permissions from "./permissions.js";

// export hand-rolled favorites types (codegen doesn't handle discriminated unions)
export type { FavoriteItem, ListFavoritesResponse } from "./domains/favorites.types.js";

// export schemas and types
export type * from "./codegen/schema.js";
export * as schema from "./codegen/schema.js";

// export route auth types
export type { RouteAuth, RouteAuthType, UserRoleName } from "./codegen/routes.js";
export { roleHierarchy } from "./codegen/routes.js";
