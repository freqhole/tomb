// freqhole api client - main exports
export * as music from "./music.js";
export * as auth from "./auth.js";
export * as app from "./app.js";

// export utilities (url helpers, uploads, etc)
export * as utils from "./utils.js";

// export schemas and types
export * as schema from "./codegen/schema.js";
export type * from "./codegen/schema.js";

// export low-level escape hatch
export { request } from "./client.js";
export type { SafeParseResult } from "./client.js";
