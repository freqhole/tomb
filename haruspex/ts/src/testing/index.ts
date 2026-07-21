// exported test utilities: doubles and fixtures consuming apps use in
// their own suites instead of re-rolling mocks. no restriction on what
// this subpath imports at runtime (it is only ever imported by test
// files), but its exports stay framework-free - none of these doubles
// need solid-js.

export { makeIdentity, makeIdentities } from "./identity-fixtures.js";
export {
  createFakeWebauthnTransport,
  FAKE_CEREMONY_DEPS,
  FAKE_CREDENTIAL,
  FAKE_REGISTRATION_CHALLENGE,
  FAKE_AUTHENTICATION_CHALLENGE,
  resetFakeCeremonyDeps,
} from "./webauthn-mocks.js";
export {
  makeKnockScope,
  makeKnockRecord,
  makeKnockDecision,
  makeKnockRecords,
} from "./knock-fixtures.js";
export {
  makeFriendDirectoryEntry,
  makeFriendDirectoryEntries,
  makeSavedRemote,
  makePendingRemote,
  createFakeEndpointAdapter,
  type SavedRemote,
  type PendingRemote,
} from "./state-fixtures.js";
export { loadProtocolFixtures, loadProtocolFixture } from "./protocol-fixtures.js";
export { setupFakeIndexedDB, teardownFakeIndexedDB } from "./idb-harness.js";
