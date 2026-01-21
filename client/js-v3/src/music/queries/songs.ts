// infinite query hook for songs with album-grouped sorting
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getDataSource } from "../data";
import type { Song } from "../data/types";

export type SongSortField =
  | "added_at"
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year";

export type SongSortDirection = "asc" | "desc";

interface UseSongsInfiniteQueryOptions {
  sortField?: Accessor<SongSortField>;
  sortDirection?: Accessor<SongSortDirection>;
  pageSize?: number;
  artistId?: Accessor<string | undefined>;
  albumId?: Accessor<string | undefined>;
  query?: Accessor<string | undefined>;
}

export function useSongsInfiniteQuery(options?: UseSongsInfiniteQueryOptions) {
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);
  const pageSize = options?.pageSize || 100;
  const artistId = options?.artistId;
  const albumId = options?.albumId;
  const query = options?.query;

  return createInfiniteQuery(() => ({
    queryKey: [
      "songs",
      "infinite",
      sortField(),
      sortDirection(),
      artistId?.(),
      albumId?.(),
      query?.(),
    ],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();

      const response = await dataSource.getSongs({
        offset: pageParam,
        limit: pageSize,
        sort_by: sortField(),
        sort_direction: sortDirection(),
        artist_id: artistId?.(),
        album_id: albumId?.(),
        search: query?.(),
      });

      return response;
    },
    getNextPageParam: (lastPage, allPages) => {
      // check if there are more pages based on has_more flag
      if (!lastPage.has_more) return undefined;

      // next offset = total songs loaded so far
      return allPages.reduce((sum, page) => sum + page.items.length, 0);
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000, // 5 minutes - prevent refetch on remount
    gcTime: 10 * 60 * 1000, // 10 minutes - keep data in cache
    refetchOnMount: false, // don't refetch on remount, keep accumulated pages
    refetchOnWindowFocus: false, // don't refetch on window focus
  }));
}

// simple query hook for fetching a single song by id
export function useSongQuery(songId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: ["song", songId()],
    queryFn: async () => {
      const id = songId();
      if (!id) return null;

      const dataSource = getDataSource();
      return dataSource.getSongById(id);
    },
    enabled: !!songId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// albums query hooks

export function useAlbumsQuery(pageSize: number = 100) {
  return createInfiniteQuery(() => ({
    queryKey: ["albums", "list"],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      if (!dataSource.getAlbums) {
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }
      return dataSource.getAlbums({
        offset: pageParam,
        limit: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export function useAlbumSongsQuery(albumId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: ["album", "songs", albumId()],
    queryFn: async () => {
      const id = albumId();
      if (!id)
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };

      const dataSource = getDataSource();
      if (!dataSource.getAlbumSongs) {
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };
      }

      return dataSource.getAlbumSongs(id, { limit: 1000 });
    },
    enabled: !!albumId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// artists query hooks

export function useArtistsQuery(pageSize: number = 100) {
  return createInfiniteQuery(() => ({
    queryKey: ["artists", "list"],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      if (!dataSource.getArtists) {
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }
      return dataSource.getArtists({
        offset: pageParam,
        limit: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export function useArtistSongsQuery(artistId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: ["artist", "songs", artistId()],
    queryFn: async () => {
      const id = artistId();
      if (!id)
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };

      const dataSource = getDataSource();
      if (!dataSource.getArtistSongs) {
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };
      }

      return dataSource.getArtistSongs(id, { limit: 1000 });
    },
    enabled: !!artistId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// genres query hooks

export function useGenresQuery(pageSize: number = 100) {
  return createInfiniteQuery(() => ({
    queryKey: ["genres", "list"],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      if (!dataSource.getGenres) {
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }
      return dataSource.getGenres({
        offset: pageParam,
        limit: pageSize,
      });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

export function useGenreSongsQuery(genreId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: ["genre", "songs", genreId()],
    queryFn: async () => {
      const id = genreId();
      if (!id)
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };

      const dataSource = getDataSource();
      if (!dataSource.getGenreSongs) {
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };
      }

      return dataSource.getGenreSongs(id, { limit: 1000 });
    },
    enabled: !!genreId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}
