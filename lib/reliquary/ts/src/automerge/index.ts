// entry point for the automerge subpath: iroh-transport NetworkAdapter for
// automerge-repo plus the acl change-stripping wrapper mechanism. this is
// one of two subpaths in this package allowed a framework-shaped peer
// dependency (`@automerge/automerge-repo`); ./blobs, ./transfer, ./worker,
// and ./utils must never import from here.

export { IrohNetworkAdapter, SYNC_ALPN } from "./iroh-network-adapter.js";
export type {
  BiStreamLike,
  ConnectionSummary,
  EndpointState,
  IrohNetworkAdapterOptions,
  MiddenStreamNode,
} from "./types.js";

export {
  AclFilteringNetworkAdapter,
  createAclFilteringAdapter,
  createHandleBasedRoleResolver,
} from "./acl-filtering.js";
export type { AclFilteringOptions, HandleLookup, RoleResolver } from "./acl-filtering.js";
