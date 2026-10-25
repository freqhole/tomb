// data source selection for the video domain — mirrors music's active
// remote scoping, without the explicit-switch signal machinery (video
// simply follows whichever remote music/data/currentState.ts says is active)
import { getCurrentRemote } from "../../music/data/currentState";
import { localVideoDataSource } from "./local/localSource";
import { RemoteVideoDataSource } from "./remote/remoteSource";
import type { VideoDataSource } from "./types";

// re-export from currentState.ts for backward compatibility - it lives
// there (not here) so services/syncState.ts can depend on this check
// without pulling in local/localSource.ts and reintroducing the
// localSource -> opfs/helpers -> syncState -> data/index -> localSource
// import cycle madge flags.
export { isLocalOrCharnelManagedVideoSource } from "./currentState";

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
