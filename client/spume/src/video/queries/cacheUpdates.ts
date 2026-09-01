// cache update utilities for video queries — mirrors music/queries/cacheUpdates.ts.

import { queryClient } from "../../queryClient";
import { videoQueryKeys } from "./queryKeys";

/**
 * broad invalidation for local-library writes (sync-to-local adding a video,
 * or refreshing a series/season row's artwork and metadata). the two key trees
 * always go together: a video sync creates and updates series/season rows as
 * well as the video itself.
 */
export function invalidateVideoLibraryQueries(): void {
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
  void queryClient.invalidateQueries({ queryKey: videoQueryKeys.series.all() });
}
