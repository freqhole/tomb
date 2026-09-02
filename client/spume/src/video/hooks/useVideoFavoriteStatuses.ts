// bulk video favorite-status hydration — one `getFavoriteStatusBulk` call
// for a whole list of videos (grid/table views), instead of a per-item
// query. mirrors the "isFavorite" hydration music gets for free from its
// own list queries (video's summary rows don't carry is_favorite).
import { createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getRemoteClient } from "../../music/data";
import { getFavoritedTargetIds } from "../../music/services/storage/db/favorites";

/** query key intentionally starts with "videos" so it's covered by
 * music/queries/favorites.ts's `getQueryKeysToInvalidate("video")`
 * invalidation (which invalidates the ["videos"] prefix on toggle). */
export function videoFavoriteStatusQueryKey(ids: string[]) {
  return ["videos", "favorite-status", [...ids].sort()] as const;
}

/** returns a query whose `.data` is a `Set<string>` of favorited video
 * ids among `videoIds()`. local (no-remote) mode has no account-backed
 * favorites, so it resolves against the local library's own favorites
 * store instead (video has no denormalized `is_favorite` field on its own
 * records, so this shared store is the only place local toggles land). */
export function useVideoFavoriteStatuses(videoIds: Accessor<string[]>) {
  return createQuery(() => ({
    queryKey: videoFavoriteStatusQueryKey(videoIds()),
    queryFn: async (): Promise<Set<string>> => {
      const ids = videoIds();
      if (ids.length === 0) return new Set();

      const client = await getRemoteClient();
      if (!client) {
        const localFavorites = await getFavoritedTargetIds("video");
        return new Set(ids.filter((id) => localFavorites.has(id)));
      }

      const result = await client.entities.getFavoriteStatusBulk({
        target_type: "video",
        target_ids: ids,
      });
      if (!result.success) return new Set();

      return new Set(result.data.filter((item) => item.is_favorite).map((item) => item.target_id));
    },
    enabled: videoIds().length > 0,
    staleTime: 30 * 1000,
  }));
}
