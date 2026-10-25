// auto-picks the single best radio station to stream a video to, for the
// video play button's "stream" flyout option. deliberately deterministic
// and silent - no secondary "choose a station" picker here (the existing
// "add to station..." context menu entry already covers manual choice;
// see docs/backlog-video.md item #3's design notes for why).
import type { PublicStation } from "@freqhole/api-client";
import { isStationContentCompatible } from "./stationCompat";

/** filters `stations` to ones that could actually take a video stream
 *  request (enabled + accepts_requests + content_mode-compatible, all
 *  already implied by being in this list at all - see
 *  `radio_stations_full`), then picks exactly one:
 *  1. prefer a station that's already running - joining never needs a
 *     new broadcaster/encoder slot, unlike tuning into a cold one (which
 *     only needs the server to reclaim an idle slot in the rare case
 *     every slot's actually busy - see broadcaster.rs's `start_station`).
 *  2. tie-break toward the node's default station.
 *  3. tie-break toward station id, purely for determinism (repeated
 *     calls with the same input always agree).
 *  returns `null` when nothing qualifies - the caller should hide the
 *  caret/flyout entirely in that case, not fall back to a picker. */
export function pickStreamStation(stations: PublicStation[]): PublicStation | null {
  const candidates = stations.filter(
    (s) => s.accepts_requests && isStationContentCompatible(s.content_mode, "video")
  );
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (a.is_running !== b.is_running) return a.is_running ? -1 : 1;
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return a.station_id.localeCompare(b.station_id);
  });

  return sorted[0];
}
