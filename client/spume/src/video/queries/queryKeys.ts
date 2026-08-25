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
      tagFilters?: unknown,
      sortField?: string,
      sortDirection?: string,
      seriesId?: string,
      seasonId?: string
    ) =>
      [
        ...videoQueryKeys.videos.lists(),
        search,
        tagFilters,
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
    // isolated from `list()` on purpose — an autocomplete typeahead
    // (small pageSize, transiently empty search while a caller's value
    // hasn't loaded yet) must never share a query-key/cache-entry with
    // the full unfiltered series list: TanStack Query's shared Query
    // object means whichever observer's fetch() runs last overwrites
    // the *other* observer's cached data for that key (see the
    // "series list collapses to one after closing edit-video modal" bug).
    autocomplete: (search?: string) =>
      [...videoQueryKeys.series.all(), "autocomplete", search] as const,
    detail: (id: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.series.all(), "remote", remoteId, id] as const)
        : ([...videoQueryKeys.series.all(), id] as const),
    seasons: (seriesId: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.series.all(), "seasons", "remote", remoteId, seriesId] as const)
        : ([...videoQueryKeys.series.all(), "seasons", seriesId] as const),
    taxons: (id: string) => [...videoQueryKeys.series.all(), "taxons", id] as const,
  },

  // video-typed items inside a (possibly mixed audio+video) playlist —
  // see queries/playlistItems.ts. songs inside the same playlist are
  // still keyed under music/queries/queryKeys.ts's `playlists.songs()`.
  playlistItems: {
    all: () => ["playlist-video-items", getDataSourceKey()] as const,
    list: (playlistId?: string) => [...videoQueryKeys.playlistItems.all(), playlistId] as const,
  },

  tags: {
    all: () => ["video-tags", getDataSourceKey()] as const,
    list: () => [...videoQueryKeys.tags.all(), "list"] as const,
    entity: (entityType: string, entityId: string) =>
      [...videoQueryKeys.tags.all(), "entity", entityType, entityId] as const,
    seriesAggregate: (seriesId: string) =>
      [...videoQueryKeys.tags.all(), "series-aggregate", seriesId] as const,
  },
} as const;
