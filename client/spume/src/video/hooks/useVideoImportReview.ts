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
import { getClientForRemote } from "../../app/api/client";
import { getRemoteMediaUrl } from "../../utils/urls";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import type { PatchVideoGroupReviewRequest } from "@freqhole/api-client";
import { queryClient } from "../../queryClient";
import { videoQueryKeys } from "../queries/queryKeys";

// broad invalidation so any other view (video grid tiles, series detail
// episode rows, etc.) picks up content_type/series/season changes made
// during review — mirrors EditVideoModal.tsx's invalidateVideoQueries.
function invalidateVideoQueries(): void {
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
}

// ----------------------------------------------------------------------------
// types
// ----------------------------------------------------------------------------

export interface ImportReviewVideoItem {
  id: string;
  title: string;
  /** "series" | "movie" | "clip" - only meaningful for a standalone
   * (non-series) group, mirrors `Video.content_type`'s own semantics. */
  contentType: string;
  seasonId?: string | null;
  seasonNumber?: number | null;
  seasonTitle?: string | null;
  episodeNumber?: number | null;
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
    newSeason?: { season_number: number; title: string | null } | null
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

  const key = createMemo<[string, CurrentRemoteInfo, number] | null>(() => {
    const id = sessionId();
    const r = remote();
    if (!id || !r) return null;
    return [id, r, reloadKey()];
  });

  const [data] = createResource(key, async (k): Promise<ImportReviewVideoGroup[]> => {
    if (!k) return [];
    const [sid, r] = k;

    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      setError(`failed to reach remote: ${(err as Error).message}`);
      return [];
    }

    const resp = await client.video.listPendingVideoImportReview({ session_id: sid });
    if (!resp.success || !resp.data) return [];

    // flatten groups across sessions (should be just one session matching sid)
    return resp.data.flatMap((session) =>
      session.groups.map((g): ImportReviewVideoGroup => ({
        groupKey: g.group_key,
        seriesId: g.series_id ?? null,
        seriesTitle: g.series_title ?? null,
        posterUrl: posterUrlFromBlob(g.poster_blob_id, r),
        posterBlobId: g.poster_blob_id ?? null,
        remoteServerId: r.remote_id,
        pendingBlobCount: g.pending_blob_count,
        videos: g.videos.map((v) => ({
          id: v.video_id,
          title: v.title,
          contentType: v.content_type,
          seasonId: v.season_id ?? null,
          seasonNumber: v.season_number ?? null,
          seasonTitle: v.season_title ?? null,
          episodeNumber: v.episode_number ?? null,
        })),
      }))
    );
  });

  function refetch() {
    setReloadKey((n) => n + 1);
  }

  async function patchGroup(
    groupKey: string,
    req: Omit<PatchVideoGroupReviewRequest, "group_key" | "session_id">
  ) {
    setError(null);
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      const msg = `failed to reach remote: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    const resp = await client.video.patchVideoGroupReview({
      group_key: groupKey,
      session_id: sid,
      ...req,
    });
    if (!resp.success) {
      const msg = `patch failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`;
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
    newSeason: { season_number: number; title: string | null } | null = null
  ) {
    setError(null);
    const r = remote();
    if (!r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      const msg = `failed to reach remote: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    const resp = await client.video.moveVideoReview({
      video_id: videoId,
      to_series_id: toSeriesId,
      to_season_id: toSeasonId,
      content_type: contentType,
      new_series_title: newSeriesTitle,
      new_season: newSeason,
    });
    if (!resp.success) {
      const msg = `move failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`;
      setError(msg);
      throw new Error(msg);
    }
    invalidateVideoQueries();
    refetch();
  }

  async function markReviewed(groupKey: string) {
    setError(null);
    const sid = sessionId();
    const r = remote();
    if (!sid || !r) return;
    let client;
    try {
      client = await getClientForRemote(r);
    } catch (err) {
      const msg = `failed to reach remote: ${(err as Error).message}`;
      setError(msg);
      throw new Error(msg);
    }
    const resp = await client.video.markVideoGroupReviewed({
      group_key: groupKey,
      session_id: sid,
    });
    if (!resp.success) {
      const msg = `mark reviewed failed: ${resp.error?.issues?.[0]?.message ?? "unknown error"}`;
      setError(msg);
      throw new Error(msg);
    }
    invalidateVideoQueries();
    refetch();
  }

  return {
    // data.latest keeps the previous value during a source-change refetch,
    // same reasoning as useImportReview.ts
    groups: () => data.latest ?? data() ?? [],
    loading: () => (data.loading && !data.latest) || data.state === "unresolved",
    error,
    clearError: () => setError(null),
    patchGroup,
    moveVideo,
    markReviewed,
    refetch,
  };
}
