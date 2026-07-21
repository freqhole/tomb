export {
  extractNodeId,
  extractNodeIdStrict,
  isValidNodeId,
  parsePeerAddress,
} from "./peer-addr.js";
export type { PeerTarget } from "./peer-addr.js";

export type {
  DocSharePayload,
  EntitySharePayload,
  NodeSharePayload,
  ShareTokenPayload,
} from "./codec.js";
export {
  decodeShareToken,
  encodeShareToken,
  extractShareToken,
  shareFragment,
} from "./codec.js";

export type { ShareInputDetection } from "./detect.js";
export { detectShareInput } from "./detect.js";
