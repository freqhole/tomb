// data source selection for the video domain — mirrors music's active
// remote scoping, without the explicit-switch signal machinery (video
// simply follows whichever remote music/data/currentState.ts says is active)
import { getCurrentRemote } from "../../music/data/currentState";
import { localVideoDataSource } from "./local/localSource";
import { RemoteVideoDataSource } from "./remote/remoteSource";
import type { VideoDataSource } from "./types";

export function getVideoDataSource(): VideoDataSource {
  const remote = getCurrentRemote();
  if (remote) {
    return new RemoteVideoDataSource(remote);
  }
  return localVideoDataSource;
}

export function isLocalVideoSourceActive(): boolean {
  return getCurrentRemote() == null;
}

/** true when the active remote needs no real network round-trip to
 *  reach - no remote at all (plain local-library browsing), or a
 *  charnel-managed remote (tauri's own locally-launched server:
 *  "remote" at the data-source-selection level above, since it's still
 *  fetched over HTTP like any other remote, but running on this same
 *  machine with zero meaningful latency) - mirrors
 *  video/data/permissions.ts's `canUpdateVideo`'s identical
 *  `!remote || remote.is_charnel_managed` gate. used to decide whether
 *  a video needs a "stream to a radio station" option at all: streaming
 *  exists to solve a real access/latency problem, which doesn't apply
 *  to a video that's already trivially reachable (see
 *  `isVideoAlreadyLocal` in services/syncState.ts). */
export function isLocalOrCharnelManagedVideoSource(): boolean {
  const remote = getCurrentRemote();
  return !remote || remote.is_charnel_managed === true;
}
