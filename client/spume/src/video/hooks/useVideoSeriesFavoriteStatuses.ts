// bulk video-series favorite-status hydration — mirrors
// useVideoFavoriteStatuses.ts's shape/rationale for the video_series
// favorite target instead of video.
import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getRemoteClient } from "../../music/data";
import { getFavoritedTargetIds } from "../../music/services/storage/db/favorites";

/** query key intentionally starts with "video-series" so it's covered by
 * music/queries/favorites.ts's `getQueryKeysToInvalidate("video_series")`
 * invalidation (which invalidates the ["video-series"] prefix on toggle). */
export function videoSeriesFavoriteStatusQueryKey(ids: string[]) {
  return ["video-series", "favorite-status", [...ids].sort()] as const;
}

/** returns a query whose `.data` is a `Set<string>` of favorited series
 * ids among `seriesIds()`. local (no-remote) mode resolves against the
 * local library's own favorites store (video series has no denormalized
 * is_favorite field on its own records, same as video). */
export function useVideoSeriesFavoriteStatuses(seriesIds: Accessor<string[]>) {
  return createQuery(() => ({
    queryKey: videoSeriesFavoriteStatusQueryKey(seriesIds()),
    queryFn: async (): Promise<Set<string>> => {
      const ids = seriesIds();
      if (ids.length === 0) return new Set();

      const client = await getRemoteClient();
      if (!client) {
        const localFavorites = await getFavoritedTargetIds("video_series");
        return new Set(ids.filter((id) => localFavorites.has(id)));
      }

      const result = await client.entities.getFavoriteStatusBulk({
        target_type: "video_series",
        target_ids: ids,
      });
      if (!result.success) return new Set();

      return new Set(result.data.filter((item) => item.is_favorite).map((item) => item.target_id));
    },
    enabled: seriesIds().length > 0,
    staleTime: 30 * 1000,
  }));
}
