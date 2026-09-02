// cache update utilities for video queries — mirrors music/queries/cacheUpdates.ts.

import { queryClient } from "../../queryClient";

/**
 * broad invalidation for local-library writes (sync-to-local adding a video,
 * or refreshing a series/season row's artwork and metadata). the two key trees
 * always go together: a video sync creates and updates series/season rows as
 * well as the video itself.
 */
export function invalidateVideoLibraryQueries(): void {
  // Sync can read from a remote while writing to the browser-local library.
  // `videoQueryKeys.*.all()` incorporates the *current* source, so invalidating
  // only that key misses the other scope. Refetch inactive cached views too:
  // useVideosQuery deliberately disables refetchOnMount.
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "videos" || query.queryKey[0] === "video-series",
    refetchType: "all",
  });
}
