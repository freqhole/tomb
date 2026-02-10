// centralized query key factory for type-safe, consistent query keys
// follows tanstack query best practices for hierarchical keys
// all keys are scoped by data source (remote ID or 'local') to prevent cache collisions

import { getCurrentRemote } from "../data";

// get current data source identifier for query key scoping
function getDataSourceKey(): string {
  const remote = getCurrentRemote();
  return remote ? remote.remote_id : "local";
}

export const queryKeys = {
  // songs
  songs: {
    all: () => ["songs", getDataSourceKey()] as const,
    infinite: (params: {
      sortField?: string;
      sortDirection?: string;
      artistId?: string;
      albumId?: string;
      genreId?: string;
      playlistId?: string;
      search?: string;
      tagFilters?: any;
    }) =>
      [
        ...queryKeys.songs.all(),
        "infinite",
        params.sortField,
        params.sortDirection,
        params.artistId,
        params.albumId,
        params.genreId,
        params.playlistId,
        params.search,
        params.tagFilters,
      ] as const,
    detail: (id: string) => [...queryKeys.songs.all(), id] as const,
  },

  // albums
  albums: {
    all: () => ["albums", getDataSourceKey()] as const,
    lists: () => [...queryKeys.albums.all(), "list"] as const,
    list: (search?: string, tagFilters?: any, sortField?: string, sortDirection?: string) =>
      [...queryKeys.albums.lists(), search, tagFilters, sortField, sortDirection] as const,
    detail: (id: string) => [...queryKeys.albums.all(), id] as const,
    songs: (albumId: string) => ["album", "songs", getDataSourceKey(), albumId] as const,
    autocomplete: (search?: string, artistId?: string) =>
      [...queryKeys.albums.all(), "autocomplete", search, artistId] as const,
  },

  // artists
  artists: {
    all: () => ["artists", getDataSourceKey()] as const,
    lists: () => [...queryKeys.artists.all(), "list"] as const,
    list: (search?: string) => [...queryKeys.artists.lists(), search] as const,
    detail: (id: string) => [...queryKeys.artists.all(), id] as const,
    songs: (artistId: string) => ["artist", "songs", artistId] as const,
    albums: (artistId: string) => ["artist", "albums", artistId] as const,
    autocomplete: (search?: string) =>
      [...queryKeys.artists.all(), "autocomplete", search] as const,
  },

  // genres
  genres: {
    all: () => ["genres", getDataSourceKey()] as const,
    lists: () => [...queryKeys.genres.all(), "list"] as const,
    list: (search?: string) => [...queryKeys.genres.lists(), search] as const,
    detail: (id: string) => [...queryKeys.genres.all(), id] as const,
    songs: (genreId: string) => ["genre", "songs", getDataSourceKey(), genreId] as const,
  },

  // playlists
  playlists: {
    all: () => ["playlists", getDataSourceKey()] as const,
    lists: () => [...queryKeys.playlists.all(), "list"] as const,
    list: () => [...queryKeys.playlists.lists()] as const,
    recent: (limit: number) =>
      [...queryKeys.playlists.all(), "recent", limit] as const,
    detail: (id: string) => [...queryKeys.playlists.all(), id] as const,
    songs: (playlistId: string) => ["playlist", "songs", getDataSourceKey(), playlistId] as const,
  },

  // search
  search: {
    all: () => ["search", getDataSourceKey()] as const,
    suggestions: (query: string, limit?: number) =>
      [...queryKeys.search.all(), "suggestions", query, limit] as const,
    results: (query: string) =>
      [...queryKeys.search.all(), "results", query] as const,
  },

  // favorites
  favorites: {
    all: () => ["favorites", getDataSourceKey()] as const,
    list: (userId?: string) =>
      [...queryKeys.favorites.all(), "list", userId] as const,
    infinite: (params: { targetType?: string }) =>
      [...queryKeys.favorites.all(), "infinite", params] as const,
  },

  // tags
  tags: {
    all: () => ["tags", getDataSourceKey()] as const,
    list: () => [...queryKeys.tags.all(), "list"] as const,
  },
} as const;
