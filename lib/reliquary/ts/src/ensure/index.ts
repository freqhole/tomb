// ensure-blob protocol: shared p2p blob availability check + staging.

export {
  DEFAULT_ENSURE_ALPN,
  type PeerMessage,
  type EnsureBlobRequest,
  type EnsureBlobResponse,
} from "./types.js";

export { createEnsureBlobHandler, type EnsureBlobHandlerDeps } from "./responder.js";

export { ensureBlobOverAlpn, type EnsureCapableNode } from "./client.js";
