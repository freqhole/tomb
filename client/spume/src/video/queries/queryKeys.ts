// centralized query key factory for the video domain — mirrors
// music/queries/queryKeys.ts's hierarchical shape and remote-scoping
// pattern to keep local/remote caches from colliding.
import { getCurrentRemote } from "../../music/data/currentState";

function getDataSourceKey(): string {
  const remote = getCurrentRemote();
  return remote ? remote.remote_id : "local";
}

export const videoQueryKeys = {
  videos: {
    all: () => ["videos", getDataSourceKey()] as const,
    lists: () => [...videoQueryKeys.videos.all(), "list"] as const,
    list: (
      search?: string,
      sortField?: string,
      sortDirection?: string,
      seriesId?: string,
      seasonId?: string
    ) =>
      [
        ...videoQueryKeys.videos.lists(),
        search,
        sortField,
        sortDirection,
        seriesId,
        seasonId,
      ] as const,
    detail: (id: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.videos.all(), "remote", remoteId, id] as const)
        : ([...videoQueryKeys.videos.all(), id] as const),
    taxons: (id: string) => [...videoQueryKeys.videos.all(), "taxons", id] as const,
  },

  series: {
    all: () => ["video-series", getDataSourceKey()] as const,
    lists: () => [...videoQueryKeys.series.all(), "list"] as const,
    list: (search?: string) => [...videoQueryKeys.series.lists(), search] as const,
    detail: (id: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.series.all(), "remote", remoteId, id] as const)
        : ([...videoQueryKeys.series.all(), id] as const),
    seasons: (seriesId: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.series.all(), "seasons", "remote", remoteId, seriesId] as const)
        : ([...videoQueryKeys.series.all(), "seasons", seriesId] as const),
  },

  // video-typed items inside a (possibly mixed audio+video) playlist —
  // see queries/playlistItems.ts. songs inside the same playlist are
  // still keyed under music/queries/queryKeys.ts's `playlists.songs()`.
  playlistItems: {
    all: () => ["playlist-video-items", getDataSourceKey()] as const,
    list: (playlistId?: string) => [...videoQueryKeys.playlistItems.all(), playlistId] as const,
  },
} as const;
