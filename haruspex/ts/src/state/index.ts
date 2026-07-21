export { registerPeerName, peerNameFor, clearPeerNames } from "./peer-names.js";

export type { EndpointAdapter, EndpointState } from "./endpoint-control.js";
export {
  clearEndpointAdapter,
  getEndpointState,
  onEndpointStateChange,
  registerEndpointAdapter,
  restartEndpoint,
  stopEndpoint,
} from "./endpoint-control.js";

export type { FriendDirectoryEntry, FriendPickerCandidate } from "./friend-directory.js";
export { buildFriendDirectory, getFriendsForPicker } from "./friend-directory.js";
