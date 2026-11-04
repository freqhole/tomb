// hook for the video import review flow - mirrors
// music/hooks/useImportReview.ts, but simpler: the server-side
// `list_pending_video_import_review` route already groups + joins videos
// per group (see grimoire's `video::import_review::repository`), so no
// separate per-group enrichment queries are needed here.
//
// usage:
//   const review = useVideoImportReview(() => sessionId(), remote);
//   review.groups()       // ImportReviewVideoGroup[]
//   review.loading()      // boolean
//   review.patchGroup(groupKey, req)
//   review.moveVideo(videoId, toSeriesId, toSeasonId)
//   review.markReviewed(groupKey)
//   review.refetch()

import { createSignal, createResource, createMemo } from "solid-js";
import { getVideoReviewBackend } from "../services/reviewBackend";
import { toast } from "../../components/feedback/Toast";
import { getRemoteMediaUrl } from "../../utils/urls";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import type { PatchVideoGroupReviewRequest } from "@freqhole/api-client";
import { queryClient } from "../../queryClient";
import { videoQueryKeys } from "../queries/queryKeys";
import { queryKeys } from "../../music/queries/queryKeys";

// broad invalidation so any other view (video grid tiles, series detail
// episode rows, etc.) picks up content_type/series/season changes made
// during review — mirrors EditVideoModal.tsx's invalidateVideoQueries.
function invalidateVideoQueries(): void {
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
  // moving a video into a music type can create (and moving it out can
  // orphan-delete) artists + albums
  void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
  void queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
  void queryClient.invalidateQueries({ queryKey: ["artist", "albums"] });
}

// ----------------------------------------------------------------------------
// types
// ----------------------------------------------------------------------------

export interface ImportReviewVideoItem {
  id: string;
  title: string;
  /** "series" | "movie" | "clip" | "karaoke" | "music_video" - only
   * meaningful for a standalone (non-series) group, mirrors
   * `Video.content_type`'s own semantics. */
  contentType: string;
  seasonId?: string | null;
  seasonNumber?: number | null;
  seasonTitle?: string | null;
  episodeNumber?: number | null;
  /** artist/album of a music_video/karaoke video (e.g. one the importer
   * guessed from the title). */
  artistId?: string | null;
  artistName?: string | null;
  albumId?: string | null;
  albumTitle?: string | null;
}

/** artist/album destination for a music_video/karaoke `moveVideo` - the
 * literal desired final state, see grimoire's `MoveVideoReviewRequest`. */
export interface MoveVideoMusicLink {
  artistId?: string | null;
  /** artist to find-or-create by name server-side. */
  artistName?: string | null;
  albumId?: string | null;
  /** album to find-or-create by title under the artist. */
  albumTitle?: string | null;
}

export interface ImportReviewVideoGroup {
  groupKey: string;
  seriesId?: string | null;
  seriesTitle?: string | null;
  posterUrl?: string | null;
  posterBlobId?: string | null;
  remoteServerId?: string | null;
  pendingBlobCount: number;
  videos: ImportReviewVideoItem[];
}

export interface VideoImportReviewHandle {
  groups: () => ImportReviewVideoGroup[];
  loading: () => boolean;
  /** durable send target set at import time (see grimoire's
   * import_session_send_targetz, shared with music's session tracking) -
   * `undefined` means this session has no target (purely local import). */
  targetRemoteId: () => string | undefined;
  targetRemoteName: () => string | undefined;
  /** last failure from patchGroup/moveVideo/markReviewed, for inline
   * display - never shown as a toast (see ImportVideoReviewEditor.tsx). */
  error: () => string | null;
  clearError: () => void;
  patchGroup: (
    groupKey: string,
    req: Omit<PatchVideoGroupReviewRequest, "group_key" | "session_id">
  ) => Promise<void>;
  moveVideo: (
    videoId: string,
    toSeriesId: string | null,
    toSeasonId?: string | null,
    contentType?: string | null,
    newSeriesTitle?: string | null,
    newSeason?: { season_number: number; title: string | null } | null,
    musicLink?: MoveVideoMusicLink | null
  ) => Promise<void>;
  markReviewed: (groupKey: string) => Promise<void>;
  refetch: () => void;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function posterUrlFromBlob(
  blobId: string | null | undefined,
  remote: CurrentRemoteInfo | null | undefined
): string | null {
  if (!blobId || !remote?.base_url) return null;
  return getRemoteMediaUrl(remote.base_url, blobId);
}

// ----------------------------------------------------------------------------
// hook
// ----------------------------------------------------------------------------

export function useVideoImportReview(
  sessionId: () => string | null,
  remote: () => CurrentRemoteInfo | null | undefined
): VideoImportReviewHandle {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const key = createMemo<[string, CurrentRemoteInfo | null, number] | null>(() => {
    const id = sessionId();
    const r = remote();
    if (!id || r === undefined) return null;
    return [id, r, reloadKey()];
  });

  const [data] = createResource(key, async (k) => {
    const [sid, r] = k;
    const scope = `${r?.remote_id ?? "browser"}:${sid}`;
    setError(null);
    let sessions;
    let target: { id: string; name: string } | null;
    try {
      const backend = getVideoReviewBackend(r);
      [sessions, target] = await Promise.all([
        backend.listPendingSessions(sid),
        backend.getSessionTarget(sid),
      ]);
    } catch (err) {
      const message = `failed to load video review: ${(err as Error).message}`;
      toast.error(message);
      return { groups: [], target: null, error: message, scope };
    }

    const groups = sessions.flatMap((session) =>
      session.groups.map((g): ImportReviewVideoGroup => ({
        groupKey: g.group_key,
        seriesId: g.series_id ?? null,
        seriesTitle: g.series_title ?? null,
        posterUrl: posterUrlFromBlob(g.poster_blob_id, r),
        posterBlobId: g.poster_blob_id ?? null,
        remoteServerId: r?.remote_id ?? null,
        pendingBlobCount: g.pending_blob_count,
        videos: g.videos.map((v) => ({
          id: v.video_id,
          title: v.title,
          contentType: v.content_type,
          seasonId: v.season_id ?? null,
          seasonNumber: v.season_number ?? null,
          seasonTitle: v.season_title ?? null,
          episodeNumber: v.episode_number ?? null,
          artistId: v.artist_id ?? null,
          artistName: v.artist_name ?? null,
          albumId: v.album_id ?? null,
          albumTitle: v.album_title ?? null,
        })),
      }))
    );
    return { groups, target, error: null, scope };
  });

  const resolvedData = () => {
    const k = key();
    const result = data.latest;
    return k && result?.scope === `${k[1]?.remote_id ?? "browser"}:${k[0]}` ? result : undefined;
  };

  function refetch() {
    setReloadKey((n) => n + 1);
  }

  async function patchGroup(
    groupKey: string,
    req: Omit<PatchVideoGroupReviewRequest, "group_key" | "session_id">
  ) {
    setError(null);
    const sid = sessionId();
    if (!sid) throw new Error("no video review session selected");
    try {
      await getVideoReviewBackend(remote()).patchGroup({
        group_key: groupKey,
        session_id: sid,
        ...req,
      });
    } catch (err) {
      const msg = `patch failed: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    invalidateVideoQueries();
    refetch();
  }

  async function moveVideo(
    videoId: string,
    toSeriesId: string | null,
    toSeasonId: string | null = null,
    contentType: string | null = null,
    newSeriesTitle: string | null = null,
    newSeason: { season_number: number; title: string | null } | null = null,
    musicLink: MoveVideoMusicLink | null = null
  ) {
    setError(null);
    try {
      await getVideoReviewBackend(remote()).moveVideo({
        video_id: videoId,
        to_series_id: toSeriesId,
        to_season_id: toSeasonId,
        content_type: contentType,
        new_series_title: newSeriesTitle,
        new_season: newSeason,
        to_artist_id: musicLink?.artistId ?? null,
        new_artist_name: musicLink?.artistName ?? null,
        to_album_id: musicLink?.albumId ?? null,
        new_album_title: musicLink?.albumTitle ?? null,
      });
    } catch (err) {
      const msg = `move failed: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    invalidateVideoQueries();
    refetch();
  }

  async function markReviewed(groupKey: string) {
    setError(null);
    const sid = sessionId();
    if (!sid) throw new Error("no video review session selected");
    try {
      await getVideoReviewBackend(remote()).markReviewed(sid, groupKey);
    } catch (err) {
      const msg = `mark reviewed failed: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    invalidateVideoQueries();
    refetch();
  }

  return {
    groups: () => resolvedData()?.groups ?? [],
    loading: () => !resolvedData() || data.loading,
    targetRemoteId: () => resolvedData()?.target?.id,
    targetRemoteName: () => resolvedData()?.target?.name,
    error: () => error() ?? resolvedData()?.error ?? null,
    clearError: () => setError(null),
    patchGroup,
    moveVideo,
    markReviewed,
    refetch,
  };
}
