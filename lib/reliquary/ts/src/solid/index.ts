// thin solid-js reactive wrappers with no business logic of their own:
// every helper here just adapts a caller-supplied source of truth (a
// progress map, a connection-summary source, a blob-fetching function)
// into a solid signal/resource. this is the only subpath besides
// `./automerge` allowed to depend on a framework - it may import
// `solid-js`.

export { createTransferProgress, type TransferProgress } from "./transfer-progress.js";
export {
  createConnectionSummary,
  type ConnectionSummaryLike,
  type CreateConnectionSummaryOptions,
} from "./connection-summary.js";
export { createBlobUrl } from "./blob-url.js";
