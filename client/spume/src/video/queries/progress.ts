// video playback-progress fetch for the series detail view's "continue"
// button + per-episode progress fill, and the single-video detail
// view's "resume" button + extras progress fill.
//
// keyed by blake3 content hash (grimoire's playback_progress.rs), not
// entity id: an exact `blake3_in` filter against the active data
// source's own playback_progressz returns precisely the requested
// videos' progress - no recency cap, no approximation. merged with the
// SAME content's progress on the charnel-managed local library (if one
// exists and differs from whatever's currently active), since a
// locally-synced copy of a remote video has its own, separate
// entity_id/progress row for "the same" underlying file - blake3 is the
// one identity that's stable across both databases.
//
// remote-only, same limitation as useVideoTaxonsQuery.ts: a purely
// local (opfs-only, no remote at all) source has no server to report
// progress to (videoServerProgressSync.ts only syncs
// `source_type === "remote"` videos), so it resolves to an empty map.
import { createQuery } from "@tanstack/solid-query";
import type { PlaybackProgress } from "@freqhole/api-client";
import { getRemoteClient } from "../../music/data";
import { getCurrentRemote } from "../../music/data/currentState";
import { getClientForRemote } from "../../app/api/client";
import { getTauriManagedRemote } from "../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../app/services/charnel";
import { videoQueryKeys } from "./queryKeys";

/** a progress row at/above this fraction counts as "finished" (watched
 *  enough that resuming it isn't useful) - mirrors
 *  videoListenProgress.ts's markVideoCompleted doc comment (">90%
 *  watched"). shared by VideoSeriesDetailPanel's "continue" target and
 *  VideoDetailView's single-video "resume" check, so both treat
 *  "basically done" consistently. */
export const COMPLETED_PROGRESS_THRESHOLD = 0.9;

type RemoteClient = NonNullable<Awaited<ReturnType<typeof getRemoteClient>>>;

/** fetch progress rows for exactly these blake3 hashes from one client,
 *  keyed by blake3 (a row with no blake3 - shouldn't happen for a real
 *  `entity_type: "video"` row, see playback_progress.rs - is simply
 *  dropped, since it can't be correlated back to a specific episode by
 *  content hash). best-effort: a failed/unreachable client resolves to
 *  an empty map rather than throwing, so one source being unavailable
 *  never blocks the other. */
async function fetchProgressByBlake3(
  client: RemoteClient,
  blake3List: string[]
): Promise<Map<string, PlaybackProgress>> {
  const map = new Map<string, PlaybackProgress>();
  if (blake3List.length === 0) return map;

  try {
    const result = await client.entities.listPlaybackProgress({ blake3_in: blake3List });
    if (!result.success) return map;
    for (const row of result.data) {
      if (row.blake3) map.set(row.blake3, row);
    }
  } catch {
    // unreachable remote, etc. - treat as "no progress data from this
    // source" rather than failing the whole query.
  }
  return map;
}

/** merge two blake3-keyed progress maps, keeping whichever row was
 *  updated more recently for each hash - "most recently touched wins",
 *  the same tie-break rule the continue-target memo itself uses when
 *  picking among several in-progress episodes. */
function mergeByMostRecent(
  base: Map<string, PlaybackProgress>,
  other: Map<string, PlaybackProgress>
): Map<string, PlaybackProgress> {
  if (other.size === 0) return base;
  const merged = new Map(base);
  for (const [hash, row] of other) {
    const existing = merged.get(hash);
    if (!existing || row.updated_at > existing.updated_at) {
      merged.set(hash, row);
    }
  }
  return merged;
}

/** fetch playback progress for a list of videos (keyed by video id), with
 *  the same cross-library (charnel self) merge `useVideoProgressQuery`
 *  does - a plain async function for imperative call sites (an on-click
 *  handler that only just fetched its video list, e.g. a context-menu
 *  "play all" action) that can't use a reactive query hook. `videos` only
 *  needs `id`/`blake3`. */
export async function fetchVideoProgressForVideos(
  videos: { id: string; blake3?: string | null }[]
): Promise<Map<string, PlaybackProgress>> {
  const blake3List = [...new Set(videos.map((v) => v.blake3).filter((b): b is string => !!b))];
  if (blake3List.length === 0) return new Map();

  const client = await getRemoteClient();
  if (!client) return new Map();

  let byBlake3 = await fetchProgressByBlake3(client, blake3List);

  // cross-library: also check the charnel-managed local library's own
  // progress for the same content, when one exists and isn't already
  // the source we just queried above (comparing by remote_id, not
  // object identity - getCurrentRemote()/getTauriManagedRemote() can
  // return distinct objects for the same underlying remote).
  if (isCharnelMode()) {
    const activeRemoteId = getCurrentRemote()?.remote_id;
    const selfRemote = await getTauriManagedRemote();
    if (selfRemote && selfRemote.remote_id !== activeRemoteId) {
      const selfClient = await getClientForRemote(selfRemote);
      const selfByBlake3 = await fetchProgressByBlake3(selfClient, blake3List);
      byBlake3 = mergeByMostRecent(byBlake3, selfByBlake3);
    }
  }

  // the UI layer only knows video ids, not blake3es - resolve back.
  const byVideoId = new Map<string, PlaybackProgress>();
  for (const item of videos) {
    const row = item.blake3 ? byBlake3.get(item.blake3) : undefined;
    if (row) byVideoId.set(item.id, row);
  }
  return byVideoId;
}

/** an episode/video to resume into, plus where. */
export interface ResumeTarget {
  /** index of the target video within the `videos` list this was
   *  computed from - the caller's own `playVideoQueue` startIndex. */
  index: number;
  positionSeconds: number;
}

/** pick which video in an ordered list to resume into, given a progress
 *  map keyed by video id: whichever video has the most-recently-updated
 *  progress row. if that video is already finished (at/above
 *  `COMPLETED_PROGRESS_THRESHOLD`), "resuming" means the *next* video in
 *  the list instead (from its start - 0 seconds); if there is no next
 *  video (it was the last one), there's nothing left to resume into and
 *  this returns `null`. shared by VideoSeriesDetailPanel's series/season
 *  "continue" targets and every on-demand "play all" call site (context
 *  menu, favorites, graph viz). */
export function pickResumeTarget(
  videos: { id: string }[],
  progressByVideoId: Map<string, PlaybackProgress>
): ResumeTarget | null {
  if (progressByVideoId.size === 0) return null;

  let bestIndex = -1;
  let best: PlaybackProgress | undefined;
  videos.forEach((video, index) => {
    const row = progressByVideoId.get(video.id);
    if (!row) return;
    if (!best || row.updated_at > best.updated_at) {
      best = row;
      bestIndex = index;
    }
  });
  if (bestIndex < 0 || !best) return null;

  const finished = best.position_fraction >= COMPLETED_PROGRESS_THRESHOLD;
  const targetIndex = finished ? bestIndex + 1 : bestIndex;
  if (targetIndex >= videos.length) return null;

  return {
    index: targetIndex,
    positionSeconds: finished ? 0 : (best.position_seconds ?? 0),
  };
}

/** resume position for one already-identified video (not "pick which of
 *  several to resume into" - that's `pickResumeTarget`'s job). returns
 *  `undefined` when there's nothing worth resuming (no saved progress,
 *  or already finished) - matches `playVideoQueue`'s own optional
 *  `startPositionSeconds` param shape, so a caller can pass this
 *  straight through. used anywhere a single specific video's own play
 *  button is clicked directly (an episode row, an unassigned video row,
 *  a movie's extras row, a movie's own detail page). */
export function resumePositionFor(
  videoId: string,
  progressByVideoId: Map<string, PlaybackProgress>
): number | undefined {
  const row = progressByVideoId.get(videoId);
  if (!row || row.position_fraction >= COMPLETED_PROGRESS_THRESHOLD) return undefined;
  return row.position_seconds ?? undefined;
}

/** playback progress for a group of videos (a series' episodes, or a
 *  movie + its extras), keyed by video id - any video with no saved
 *  progress (or no blake3 of its own yet) is simply absent from the
 *  returned map. `videos` is read fresh inside `queryFn` (not part of
 *  the query key - see queryKeys.ts's `progress` doc comment); only
 *  `id`/`blake3` are used. `groupId` just scopes the query cache entry
 *  (a series id, a movie's own video id, whatever the caller finds
 *  natural) - it's never sent to the server. */
export function useVideoProgressQuery(
  groupId: () => string | undefined,
  videos: () => { id: string; blake3?: string | null }[]
) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.progress.forGroup(groupId() || ""),
    queryFn: () => fetchVideoProgressForVideos(videos()),
    enabled: !!groupId() && videos().length > 0,
    // matches videoServerProgressSync.ts's own ~60s server-sync cadence -
    // polling more often than the server data itself can change is just
    // wasted traffic.
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  }));
}
