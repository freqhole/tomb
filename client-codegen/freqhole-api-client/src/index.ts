// freqhole api client - main exports
export * as app from "./app.js";
export * as auth from "./auth.js";
export * as music from "./music.js";

// export utilities (url helpers, uploads, etc)
export * as utils from "./utils.js";

// export webauthn helpers
export * as webauthn from "./webauthn.js";

// export permission helpers
export * as permissions from "./permissions.js";

// export hand-rolled favorites types (codegen doesn't handle discriminated unions)
export type { FavoriteItem, ListFavoritesResponse } from "./favorites.js";

// export schemas and types
export type * from "./codegen/schema.js";
export * as schema from "./codegen/schema.js";

// export route auth types
export type { RouteAuth, RouteAuthType, UserRoleName } from "./codegen/routes.js";
export { roleHierarchy } from "./codegen/routes.js";

// export low-level escape hatch
export { request, isAuthError } from "./client.js";
export type { SafeParseResult } from "./client.js";
