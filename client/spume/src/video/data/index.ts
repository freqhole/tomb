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
