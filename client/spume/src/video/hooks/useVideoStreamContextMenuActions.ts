// shared "stream to a radio station" context-menu action for videos and
// video series - reactively splices a "stream on X" entry (see
// useStreamFlyoutActions.ts) into an existing MenuAction[] built by
// useVideoContextMenu/useVideoSeriesContextMenu (contextMenu.ts).
//
// IMPORTANT: this splicing happens OUTSIDE useVideoContextMenu/
// useVideoSeriesContextMenu, via `withStreamMenuActions` below, not as an
// option those functions read internally - they both call
// createMutation() (useDeleteVideoMutation/useDeleteVideoSeriesMutation/
// useRemovePlaylistItemsMutation) and must only ever be invoked ONCE per
// component instance, so they can't safely be re-run inside a reactive
// memo just to pick up a station lookup that resolves later. the base
// array they return is a one-time snapshot; `withStreamMenuActions`
// combines that stable snapshot with a separately-reactive stream-action
// tail, so the "stream on X" entry can appear once its async lookup
// resolves without needing to rebuild (and re-mutation-hook) the rest of
// the menu.
//
// built on the exact same station-pick/submit logic the play buttons
// use, so a right-click "stream on X" and a play-button flyout's
// "stream on X" are always in perfect agreement.
import { createMemo, type Accessor } from "solid-js";
import type { MenuAction } from "../../components/overlays/ContextMenu";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { useStreamFlyoutActions } from "../../components/radio/useStreamFlyoutActions";
import { isVideoAlreadyLocal } from "../services/syncState";
import { fetchVideoProgressForVideos, pickResumeTarget, resumePositionFor } from "../queries/progress";
import { getVideoDataSource } from "../data";
import type { VideoSeries, VideoSummary } from "../data/types";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";

/** pure array-splice helper: inserts `streamActions` right before `base`'s
 *  first separator (matching where useVideoContextMenu/
 *  useVideoSeriesContextMenu already put their own separator, right
 *  after the play/queue actions), or appends at the end if there's no
 *  separator at all. a no-op (`base` returned as-is) when
 *  `streamActions` is empty. exported separately from
 *  `withStreamMenuActions` below for call sites that already wrap their
 *  own `useVideoContextMenu`/`useVideoSeriesContextMenu` call in their
 *  own `createMemo` (e.g. VideoListRow.tsx) - reuse this plain function
 *  inside that existing memo instead of nesting a second one via
 *  `withStreamMenuActions`. */
export function spliceStreamMenuActions(
  base: MenuAction[],
  streamActions: MenuAction[]
): MenuAction[] {
  if (streamActions.length === 0) return base;
  const separatorIndex = base.findIndex((a) => a.type === "separator");
  const insertAt = separatorIndex >= 0 ? separatorIndex : base.length;
  return [...base.slice(0, insertAt), ...streamActions, ...base.slice(insertAt)];
}

/** combines a stable base `MenuAction[]` (computed once by
 *  useVideoContextMenu/useVideoSeriesContextMenu) with a reactively-
 *  updating stream-action tail (see `spliceStreamMenuActions` above for
 *  the insertion rule). returns an accessor; read it at the JSX
 *  consumption point (`actions={combined()}`) so updates propagate once
 *  the station lookup resolves. */
export function withStreamMenuActions(
  base: MenuAction[],
  streamActions: Accessor<MenuAction[]>
): Accessor<MenuAction[]> {
  const combined = createMemo(() => spliceStreamMenuActions(base, streamActions()));
  return combined;
}

/** a single video's "stream to a radio station" flyout state - same
 *  shape `useStreamFlyoutActions` itself returns (`showCaret`/
 *  `menuActions`), so one call can serve both a context menu's "stream
 *  on X" entry (via `menuActions()`, spliced through
 *  `spliceStreamMenuActions`/`withStreamMenuActions` above) and a hover
 *  play button's own flyout trigger (via `showCaret()`) without
 *  duplicating the underlying station lookup. */
export function useVideoStreamContextMenuActions(
  video: VideoSummary | QueuedVideo,
  remote: Accessor<Remote | null>
) {
  return useStreamFlyoutActions({
    remote,
    resolveStreamItems: async () => {
      const progress = await fetchVideoProgressForVideos([video]);
      return [
        {
          kind: "video",
          itemId: video.id,
          startPositionSeconds: resumePositionFor(video.id, progress),
        },
      ];
    },
    streamLabel: () => `video "${video.title}"`,
    alreadyLocal: () => isVideoAlreadyLocal(video),
  });
}

// play-all/stream-all need the series' full video list, but most
// callers (grid tiles, list rows) only have the bare series row on
// hand - mirrors contextMenu.ts's own resolveSeriesVideos (not reused
// directly since it's module-private there; same fetch-on-demand logic).
async function resolveSeriesVideosForStream(
  series: VideoSeries,
  preloaded: VideoSummary[]
): Promise<VideoSummary[]> {
  if (preloaded.length > 0) return preloaded;
  try {
    const detail = await getVideoDataSource().getVideoSeriesDetail(series.id);
    if (!detail) return [];
    return [...detail.seasons.flatMap((season) => season.videos), ...detail.unassignedVideos];
  } catch (err) {
    console.error("failed to load series videos for a stream request:", err);
    return [];
  }
}

/** a series' "stream to a radio station" flyout state - full resume-aware
 *  episode list, same as the series detail panel's own header button.
 *  same `{showCaret, menuActions}` shape as
 *  `useVideoStreamContextMenuActions` above, for the same reason.
 *  `alreadyLocal` is optional: pass the caller's own richer check when
 *  it already has one on hand (e.g. the detail panel's own
 *  `isSeriesAlreadyLocal`, which knows the real resume target); most
 *  callers only have the bare series row (no preloaded video list, no
 *  progress data) and get a simpler "is episode 1 already local"
 *  fallback instead - a reasonable proxy, not pixel-perfect, but a
 *  synchronously-answerable one (the real resume target can't be known
 *  without first fetching the series' video list + progress, and
 *  `alreadyLocal` must answer synchronously to gate the flyout before
 *  the user even opens the menu). */
export function useSeriesStreamContextMenuActions(
  series: VideoSeries,
  allVideos: VideoSummary[],
  remote: Accessor<Remote | null>,
  alreadyLocal?: () => boolean
) {
  return useStreamFlyoutActions({
    remote,
    resolveStreamItems: async () => {
      const videos = await resolveSeriesVideosForStream(series, allVideos);
      if (videos.length === 0) return null;
      const progress = await fetchVideoProgressForVideos(videos);
      const target = pickResumeTarget(videos, progress);
      const startIndex = target?.index ?? 0;
      return videos.slice(startIndex).map((v, i) => ({
        kind: "video" as const,
        itemId: v.id,
        startPositionSeconds: i === 0 ? target?.positionSeconds : undefined,
      }));
    },
    streamLabel: () => `series "${series.title}"`,
    alreadyLocal:
      alreadyLocal ??
      (() => {
        const first = allVideos[0];
        return !!first && isVideoAlreadyLocal(first);
      }),
  });
}
