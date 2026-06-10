// automerge transport layer - iroh QUIC network adapter for automerge-repo.
//
// re-exports everything needed by consuming packages.
export {
  IrohNetworkAdapter,
  SYNC_ALPN,
} from "./IrohNetworkAdapter.js";

export type {
  BiStreamLike,
  MiddenStreamNode,
  ConnectionSummary,
  IrohNetworkAdapterOptions,
} from "./IrohNetworkAdapter.js";
