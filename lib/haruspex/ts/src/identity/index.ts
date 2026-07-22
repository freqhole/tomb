export type { IdentityStore, P2PIdentity } from "./types.js";

export type { IdentitySource } from "./idbStore.js";
export {
  createIdbIdentityStore,
  databaseExists,
  identitySourceAvailable,
  openExistingDatabase,
  readIdentityFrom,
  writeIdentityTo,
} from "./idbStore.js";

export type { ResolveIdentityOptions } from "./resolve.js";
export { persistIdentity, resolveIdentity } from "./resolve.js";

export type { AcquireNodeLeadershipOpts } from "./webLocks.js";
export { acquireNodeLeadership, LOCK_NAME } from "./webLocks.js";
