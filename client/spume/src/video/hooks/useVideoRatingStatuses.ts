// bulk video rating-status hydration — one `getRatingStatusBulk` call for a
// whole list of videos, mirroring useVideoFavoriteStatuses.ts's shape for
// the domain-agnostic ratings bulk-status endpoint.
import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getRemoteClient } from "../../music/data";

/** query key intentionally starts with "videos" so it's covered by
 * music/queries/ratings.ts's `getQueryKeysToInvalidate("video")`
 * invalidation (which invalidates the ["videos"] prefix on rating change). */
export function videoRatingStatusQueryKey(ids: string[]) {
  return ["videos", "rating-status", [...ids].sort()] as const;
}

/** returns a query whose `.data` is a `Map<string, number>` of the caller's
 * own rating for each rated video id among `videoIds()`. local (no-remote)
 * mode has no account-backed ratings for video, so it resolves to an empty
 * map rather than erroring. */
export function useVideoRatingStatuses(videoIds: Accessor<string[]>) {
  return createQuery(() => ({
    queryKey: videoRatingStatusQueryKey(videoIds()),
    queryFn: async (): Promise<Map<string, number>> => {
      const ids = videoIds();
      if (ids.length === 0) return new Map();

      const client = await getRemoteClient();
      if (!client) return new Map();

      const result = await client.entities.getRatingStatusBulk({
        target_type: "video",
        target_ids: ids,
      });
      if (!result.success) return new Map();

      const ratings = new Map<string, number>();
      for (const item of result.data) {
        if (item.rating != null) ratings.set(item.target_id, item.rating);
      }
      return ratings;
    },
    enabled: videoIds().length > 0,
    staleTime: 30 * 1000,
  }));
}
