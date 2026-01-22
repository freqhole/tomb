// centralized query key factory for type-safe, consistent query keys
// follows tanstack query best practices for hierarchical keys

export const queryKeys = {
  // songs
  songs: {
    all: ["songs"] as const,
    infinite: (params: {
      sortField?: string;
      sortDirection?: string;
      artistId?: string;
      albumId?: string;
      genreId?: string;
      playlistId?: string;
      search?: string;
    }) => [
      ...queryKeys.songs.all,
      "infinite",
      params.sortField,
      params.sortDirection,
      params.artistId,
      params.albumId,
      params.genreId,
      params.playlistId,
      params.search,
    ] as const,
    detail: (id: string) => [...queryKeys.songs.all, id] as const,
  },

  // albums
  albums: {
    all: ["albums"] as const,
    lists: () => [...queryKeys.albums.all, "list"] as const,
    list: (search?: string) => [...queryKeys.albums.lists(), search] as const,
    detail: (id: string) => [...queryKeys.albums.all, id] as const,
    songs: (albumId: string) => ["album", "songs", albumId] as const,
  },

  // artists
  artists: {
    all: ["artists"] as const,
    lists: () => [...queryKeys.artists.all, "list"] as const,
    list: (search?: string) => [...queryKeys.artists.lists(), search] as const,
    detail: (id: string) => [...queryKeys.artists.all, id] as const,
    songs: (artistId: string) => ["artist", "songs", artistId] as const,
    albums: (artistId: string) => ["artist", "albums", artistId] as const,
  },

  // genres
  genres: {
    all: ["genres"] as const,
    lists: () => [...queryKeys.genres.all, "list"] as const,
    list: (search?: string) => [...queryKeys.genres.lists(), search] as const,
    detail: (id: string) => [...queryKeys.genres.all, id] as const,
    songs: (genreId: string) => ["genre", "songs", genreId] as const,
  },

  // playlists
  playlists: {
    all: ["playlists"] as const,
    lists: () => [...queryKeys.playlists.all, "list"] as const,
    list: () => [...queryKeys.playlists.lists()] as const,
    recent: (limit: number) => [...queryKeys.playlists.all, "recent", limit] as const,
    detail: (id: string) => [...queryKeys.playlists.all, id] as const,
    songs: (playlistId: string) => ["playlist", "songs", playlistId] as const,
  },

  // search
  search: {
    all: ["search"] as const,
    suggestions: (query: string, limit?: number) =>
      [...queryKeys.search.all, "suggestions", query, limit] as const,
    results: (query: string) =>
      [...queryKeys.search.all, "results", query] as const,
  },

  // favorites
  favorites: {
    all: ["favorites"] as const,
    list: (userId?: string) => [...queryKeys.favorites.all, "list", userId] as const,
  },

  // tags
  tags: {
    all: ["tags"] as const,
    list: () => [...queryKeys.tags.all, "list"] as const,
  },
} as const;
