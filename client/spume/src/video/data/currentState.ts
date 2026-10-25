// lightweight, deliberately dependency-light derived state for the
// video domain. the only import is music/data/currentState.ts's
// getCurrentRemote - no `./index` (data-source selection, depends on
// local/localSource.ts) and no `./permissions` (depends on
// music/data/permissions.ts, which itself depends on music/data/index.ts
// -> music/data/local/localSource.ts -> video/data/index.ts). anything
// needing just "is the active source local/charnel-managed" should
// import from here, not from `./index` or `./permissions`, so this stays
// a true leaf and services/syncState.ts can depend on it without closing
// the localSource -> opfs/helpers -> syncState -> data/index ->
// localSource import cycle madge flags.
import { getCurrentRemote } from "../../music/data/currentState";

/** true when the active remote needs no real network round-trip to
 *  reach - no remote at all (plain local-library browsing), or a
 *  charnel-managed remote (tauri's own locally-launched server:
 *  "remote" at the data-source-selection level, since it's still
 *  fetched over HTTP like any other remote, but running on this same
 *  machine with zero meaningful latency) - identical gate to
 *  `data/permissions.ts`'s `canUpdateVideo`'s `!remote ||
 *  remote.is_charnel_managed` check. used to decide whether a video
 *  needs a "stream to a radio station" option at all: streaming exists
 *  to solve a real access/latency problem, which doesn't apply to a
 *  video that's already trivially reachable (see `isVideoAlreadyLocal`
 *  in services/syncState.ts). */
export function isLocalOrCharnelManagedVideoSource(): boolean {
  const remote = getCurrentRemote();
  return !remote || remote.is_charnel_managed === true;
}
