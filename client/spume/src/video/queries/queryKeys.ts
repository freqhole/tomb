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
      seasonId?: string,
      contentTypes?: unknown
    ) =>
      [
        ...videoQueryKeys.videos.lists(),
        search,
        tagFilters,
        sortField,
        sortDirection,
        seriesId,
        seasonId,
        contentTypes,
      ] as const,
    detail: (id: string, remoteId?: string) =>
      remoteId
        ? ([...videoQueryKeys.videos.all(), "remote", remoteId, id] as const)
        : ([...videoQueryKeys.videos.all(), id] as const),
    taxons: (id: string) => [...videoQueryKeys.videos.all(), "taxons", id] as const,
    /** a movie's "extras" (see `Video::parent_video_id`). */
    extras: (parentVideoId: string) =>
      [...videoQueryKeys.videos.all(), "extras", parentVideoId] as const,
    /** music_video/karaoke videos on an album. */
    byAlbum: (albumId: string) => [...videoQueryKeys.videos.all(), "by-album", albumId] as const,
    /** music_video/karaoke videos on an artist. */
    byArtist: (artistId: string) =>
      [...videoQueryKeys.videos.all(), "by-artist", artistId] as const,
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

  /** playback progress for a group of videos (a series' episodes, or a
   *  movie + its extras) - see queries/progress.ts's useVideoProgressQuery.
   *  keyed by the caller's own group id only (not the member video ids
   *  themselves): that set rarely changes mid-session, and keying on it
   *  would just add churn to the cache key on every render. not nested
   *  under `series` - a movie's own detail page uses this too, scoped by
   *  its own video id rather than a series id. */
  progress: {
    all: () => ["video-progress", getDataSourceKey()] as const,
    forGroup: (groupId: string) => [...videoQueryKeys.progress.all(), groupId] as const,
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
