// centralized cache update utilities for mutations
// provides a clean abstraction for "this entity changed, update it everywhere"

import type { QueryClient } from "@tanstack/solid-query";
import { debug } from "../../utils/logger";
import type { Album, Artist, Playlist, Song } from "../services/storage/types";
import { queryKeys } from "./queryKeys";

/**
 * updates a song across all query caches where it might appear.
 * use this for optimistic updates or after successful mutations.
 */
export function updateSongInCache(
  queryClient: QueryClient,
  songId: string,
  sha256: string,
  updates: Partial<Song>,
): void {
  debug("cacheUpdates", "updateSongInCache called:", {
    songId,
    sha256,
    updates,
  });

  // helper to update song in array if found
  const updateSongInArray = (songs: Song[]): Song[] => {
    return songs.map((song) =>
      song.id === songId || song.sha256 === sha256
        ? { ...song, ...updates }
        : song,
    );
  };

  // 1. update specific song query
  queryClient.setQueryData<Song>(["song", sha256], (old) =>
    old ? { ...old, ...updates } : old,
  );
  queryClient.setQueryData<Song>(["song", songId], (old) =>
    old ? { ...old, ...updates } : old,
  );

  // 2. update all infinite songs queries
  const songsQueries = queryClient.getQueriesData<{
    pages: Array<{
      items: Song[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>;
    pageParams: unknown[];
  }>({
    queryKey: [...queryKeys.songs.all(), "infinite"],
    exact: false,
  });

  for (const [queryKey, data] of songsQueries) {
    if (!data?.pages) continue;

    debug("cacheUpdates", "updating infinite songs query:", queryKey);
    const updatedData = {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: updateSongInArray(page.items),
      })),
    };
    queryClient.setQueryData(queryKey, updatedData);
    debug("cacheUpdates", "updated infinite songs query");
  }

  // 3. update album songs queries
  const albumSongsQueries = queryClient.getQueriesData<{
    items: Song[];
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
  }>({
    queryKey: ["album", "songs"], // queryKeys.albums.songs() needs albumId
    exact: false,
  });

  for (const [queryKey, data] of albumSongsQueries) {
    if (!data?.items) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      items: updateSongInArray(data.items),
    });
  }

  // 4. update artist songs queries
  const artistSongsQueries = queryClient.getQueriesData<{
    items: Song[];
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
  }>({
    queryKey: ["artist", "songs"], // queryKeys.artists.songs() needs artistId
    exact: false,
  });

  for (const [queryKey, data] of artistSongsQueries) {
    if (!data?.items) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      items: updateSongInArray(data.items),
    });
  }

  // 5. update genre songs queries
  const genreSongsQueries = queryClient.getQueriesData<{
    items: Song[];
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
  }>({
    queryKey: ["genre", "songs"], // queryKeys.genres.songs() needs genreId
    exact: false,
  });

  for (const [queryKey, data] of genreSongsQueries) {
    if (!data?.items) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      items: updateSongInArray(data.items),
    });
  }

  // 6. update playlist songs queries
  const playlistSongsQueries = queryClient.getQueriesData<{
    items: Song[];
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
  }>({
    queryKey: ["playlist", "songs"], // queryKeys.playlists.songs() needs playlistId
    exact: false,
  });

  for (const [queryKey, data] of playlistSongsQueries) {
    if (!data?.items) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      items: updateSongInArray(data.items),
    });
  }

  // 7. update search results if they contain songs
  const searchQueries = queryClient.getQueriesData<{
    pages: Array<{ songs?: Song[] }>;
  }>({
    queryKey: queryKeys.search.all(),
    exact: false,
  });

  for (const [queryKey, data] of searchQueries) {
    if (!data?.pages) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        songs: page.songs ? updateSongInArray(page.songs) : page.songs,
      })),
    });
  }

  debug("cacheUpdates", "updateSongInCache complete");
}

/**
 * updates an album across all query caches where it might appear.
 */
export function updateAlbumInCache(
  queryClient: QueryClient,
  albumId: string,
  updates: Partial<Album>,
): void {
  debug("cacheUpdates", "updateAlbumInCache called:", {
    albumId,
    updates,
  });

  const updateAlbumInArray = <T extends { album_id: string }>(albums: T[]): T[] => {
    return albums.map((album) =>
      album.album_id === albumId ? { ...album, ...updates } : album,
    );
  };

  // 1. update specific album detail query
  queryClient.setQueryData<Album>(queryKeys.albums.detail(albumId), (old) =>
    old ? { ...old, ...updates } : old,
  );

  // 2. update albums infinite queries (AlbumSummary[])
  const albumsInfiniteQueries = queryClient.getQueriesData<{
    pages: Array<{
      items: unknown[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>;
    pageParams: unknown[];
  }>({
    queryKey: [...queryKeys.albums.all(), "list"],
    exact: false,
  });

  for (const [queryKey, data] of albumsInfiniteQueries) {
    if (!data?.pages) continue;

    debug("cacheUpdates", "updating infinite albums query:", queryKey);
    const updatedData = {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: updateAlbumInArray(page.items as Album[]),
      })),
    };
    queryClient.setQueryData(queryKey, updatedData);

    debug("cacheUpdates", "updated infinite albums query");
  }

  // 3. update artist albums queries
  const artistAlbumsQueries = queryClient.getQueriesData<{
    items: Album[];
  }>({
    queryKey: ["artist", "albums"],
    exact: false,
  });

  for (const [queryKey, data] of artistAlbumsQueries) {
    if (!data?.items) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      items: updateAlbumInArray(data.items),
    });
  }

  // 4. update songs with album_is_favorite when album favorite changes
  if (updates.is_favorite !== undefined) {
    // update artist songs queries (where the album favorite heart appears)
    const artistSongsQueries = queryClient.getQueriesData<{
      items: Song[];
    }>({
      queryKey: ["artist", "songs"],
      exact: false,
    });

    for (const [queryKey, data] of artistSongsQueries) {
      if (!data?.items) continue;

      const updatedData = {
        ...data,
        items: data.items.map(song =>
          song.album_id === albumId
            ? { ...song, album_is_favorite: updates.is_favorite }
            : song
        ),
      };
      queryClient.setQueryData(queryKey, updatedData);
    }

    // also update album songs queries
    const albumSongsQueries = queryClient.getQueriesData<{
      items: Song[];
    }>({
      queryKey: ["album", "songs"],
      exact: false,
    });

    for (const [queryKey, data] of albumSongsQueries) {
      if (!data?.items) continue;

      const updatedData = {
        ...data,
        items: data.items.map(song =>
          song.album_id === albumId
            ? { ...song, album_is_favorite: updates.is_favorite }
            : song
        ),
      };
      queryClient.setQueryData(queryKey, updatedData);
    }
  }
}

/**
 * updates an artist across all query caches where it might appear.
 */
export function updateArtistInCache(
  queryClient: QueryClient,
  artistId: string,
  updates: Partial<Artist>,
): void {
  const updateArtistInArray = (artists: Artist[]): Artist[] => {
    return artists.map((artist) =>
      artist.artist_id === artistId ? { ...artist, ...updates } : artist,
    );
  };

  // 1. update specific artist query
  queryClient.setQueryData<Artist>(["artist", artistId], (old) =>
    old ? { ...old, ...updates } : old,
  );

  // 2. update artists list queries
  const artistsQueries = queryClient.getQueriesData<{
    pages: Array<{ items: Artist[] }>;
  }>({
    queryKey: queryKeys.artists.all(),
    exact: false,
  });

  for (const [queryKey, data] of artistsQueries) {
    if (!data?.pages) continue;

    queryClient.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: updateArtistInArray(page.items),
      })),
    });
  }
}

/**
 * updates a playlist across all query caches where it might appear.
 */
export function updatePlaylistInCache(
  queryClient: QueryClient,
  playlistId: string,
  updates: Partial<Playlist>,
): void {
  debug("cacheUpdates", "updatePlaylistInCache called:", {
    playlistId,
    updates,
  });

  const updatePlaylistInArray = (playlists: Playlist[]): Playlist[] => {
    return playlists.map((playlist) =>
      playlist.playlist_id === playlistId
        ? { ...playlist, ...updates }
        : playlist,
    );
  };

  // 1. update specific playlist query
  queryClient.setQueryData<Playlist>(["playlist", playlistId], (old) =>
    old ? { ...old, ...updates } : old,
  );

  // 2. update playlists infinite queries
  const playlistsInfiniteQueries = queryClient.getQueriesData<{
    pages: Array<{
      items: Playlist[];
      total: number;
      offset: number;
      limit: number;
      has_more: boolean;
    }>;
    pageParams: unknown[];
  }>({
    queryKey: [...queryKeys.playlists.all(), "infinite"],
    exact: false,
  });

  for (const [queryKey, data] of playlistsInfiniteQueries) {
    if (!data?.pages) continue;

    debug("cacheUpdates", "updating infinite playlists query:", queryKey);
    const updatedData = {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: updatePlaylistInArray(page.items),
      })),
    };
    queryClient.setQueryData(queryKey, updatedData);
    debug("cacheUpdates", "updated infinite playlists query");
  }

  // 3. update playlists list queries (legacy/simple queries if any)
  const playlistsQueries = queryClient.getQueriesData<Playlist[]>({
    queryKey: queryKeys.playlists.all(),
    exact: false,
  });

  for (const [queryKey, data] of playlistsQueries) {
    if (!Array.isArray(data)) continue;

    queryClient.setQueryData(queryKey, updatePlaylistInArray(data));
  }
}

/**
 * minimal invalidation - only invalidate queries that actually need server data refetch.
 * use this instead of broad invalidation to avoid unnecessary network requests.
 */
export function invalidateEntityQueries(
  queryClient: QueryClient,
  entityType: "song" | "album" | "artist" | "playlist",
  _entityId: string,
): void {
  // for most mutations (favorites, ratings), we don't need to invalidate anything
  // because we update the cache optimistically. only invalidate if we need fresh
  // server data (like aggregate counts, computed fields, etc.)

  switch (entityType) {
    case "song":
      // don't invalidate song lists - we update them optimistically
      // only invalidate if you need fresh aggregate data
      break;

    case "album":
      // albums might have computed fields like song_count that need refresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.albums.all(),
        exact: false,
      });
      break;

    case "artist":
      // artists might have computed fields like album_count that need refresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.artists.all(),
        exact: false,
      });
      break;

    case "playlist":
      // playlists might have computed fields like song_count that need refresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.all(),
        exact: false,
      });
      break;
  }
}
