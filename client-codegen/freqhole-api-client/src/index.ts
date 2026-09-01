// freqhole api client - main exports

// instance-based client
export {
  FreqholeClient,
  createClient,
  createHttpClient,
  isAuthError,
  isNetworkError,
} from "./FreqholeClient.js";
export type { SafeParseResult } from "./FreqholeClient.js";

// transport abstraction
export {
  HttpTransport,
  pollingJobEvents,
  snapshotJobEventsViaRequest,
  POLL_INTERVAL_FALLBACK_MS,
} from "./transport.js";
export { WasmTransport } from "./WasmTransport.js";
export { isTauriRuntime } from "./tauriRuntime.js";
export {
  CharnelTransport,
  createCharnelTransport,
  getCharnelTransport,
  getCharnelNodeId,
  isCharnelAvailable,
  isCharnelP2PAvailable,
} from "./CharnelTransport.js";
export {
  CharnelLocalTransport,
  createCharnelLocalTransport,
  JobEventsStreamClosed,
} from "./CharnelLocalTransport.js";
export type {
  MiddenNodeLike,
  BlobResultLike,
  BlobProgressCallback,
  RadioHandleLike,
  BiStreamLike,
} from "./WasmTransport.js";
export type { Transport, TransportResponse, BlobData } from "./transport.js";

// shared error parsing/human-message conventions - the canonical place to
// turn a server error_type into user-facing text (see docs/error-handling.md)
export {
  AUTH_ERROR_PATH,
  ERROR_TYPE_MESSAGES,
  parseErrorResponseBody,
  friendlyMessage,
  buildErrorIssue,
  toZodError,
} from "./errors.js";
export type { ParsedApiError } from "./errors.js";

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

// export admin client (freqhole-admin/1 ALPN)
export {
  AdminClient,
  AdminCommandError,
  AdminRequestValidationError,
  AdminResponseValidationError,
} from "./AdminClient.js";
export type { AdminTransport, AdminResponse, AdminErrorDetail } from "./AdminClient.js";
export { adminCommands } from "./codegen/admin_commands.js";
export type { AdminCommandName, AdminAuth, AdminAuthType } from "./codegen/admin_commands.js";
