export {
  extractNodeId,
  extractNodeIdStrict,
  isValidNodeId,
  parsePeerAddress,
} from "./peer-addr.js";
export type { PeerTarget } from "./peer-addr.js";

// the unified share-token codec (all supported app + legacy token shapes)
// and detectShareInput land here alongside these peer-address helpers.
