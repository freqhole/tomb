// centralized zod schemas for IDB data validation
// all schemas for external/persisted data should live here

export {
  // remote types
  type TransportType,
  type Remote,
  type HttpRemote,
  type P2PRemote,
  type RemoteRef,
  // helpers
  isHttpRemote,
  isP2PRemote,
  parseRemote,
  safeParseRemote,
  parseRemotes,
  toRemoteRef,
} from "./remote";
