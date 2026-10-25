// shared station media-type compatibility logic - used both by
// AddToStationModal.tsx's request-taking station list (songs vs videos)
// and the video play button's auto-pick-a-stream-station flow. mirrors
// the server's own compatibility rule exactly (see
// grimoire/src/offal/music/radio.rs's submit_request and
// grimoire/src/radio/playlist.rs's request-queue picker loop) so the
// client never offers a station the server would reject anyway.
import type { StationSelectorTarget } from "../../music/hooks/stationSelectorState";

export type RequestMediaKind = "song" | "video";

/** which media kind a station request target resolves to - determines
 *  which `content_mode`s are compatible (see `isStationContentCompatible`
 *  below). */
export function targetMediaKind(target: StationSelectorTarget): RequestMediaKind {
  return target.kind === "video" || target.kind === "video_series" ? "video" : "song";
}

/** true if a station's `content_mode` ('audio_only' | 'audio_or_video' |
 *  'video_only') accepts a request of the given kind - a video request
 *  should never target an `audio_only` station, and a song request
 *  should never target a `video_only` one. */
export function isStationContentCompatible(contentMode: string, kind: RequestMediaKind): boolean {
  const mode = contentMode.trim().toLowerCase();
  if (kind === "song") return mode !== "video_only";
  return mode !== "audio_only";
}
