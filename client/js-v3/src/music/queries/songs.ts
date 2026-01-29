// infinite query hook for songs with album-grouped sorting
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import { debug } from "../../utils/logger";
import { getDataSource } from "../data";
import type { Song } from "../data/types";
import { queryKeys } from "./queryKeys";

export type SongSortField =
  | "added_at"
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year"
  | "duration";

export type SongSortDirection = "asc" | "desc";

interface UseSongsInfiniteQueryOptions {
  sortField?: Accessor<SongSortField>;
  sortDirection?: Accessor<SongSortDirection>;
  pageSize?: number;
  artistId?: Accessor<string | undefined>;
  albumId?: Accessor<string | undefined>;
  query?: Accessor<string | undefined>;
  tagFilters?: Accessor<TagFilter[]>;
}

export function useSongsInfiniteQuery(options?: UseSongsInfiniteQueryOptions) {
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);
  const pageSize = options?.pageSize || 100;
  const artistId = options?.artistId;
  const albumId = options?.albumId;
  const query = options?.query;
  const tagFilters = options?.tagFilters;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.songs.infinite({
      sortField: sortField(),
      sortDirection: sortDirection(),
      artistId: artistId?.(),
      albumId: albumId?.(),
      search: query?.(),
      tagFilters: tagFilters?.(),
    }),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      debug("songsQuery", "fetching songs page:", {
        pageParam,
        sortField: sortField(),
        sortDirection: sortDirection(),
      });
      const dataSource = getDataSource();

      // build query params with tag filters
      const currentTagFilters = tagFilters?.();
      const includeTags = currentTagFilters
        ?.filter((f) => f.mode === "include")
        .map((f) => f.tag);
      const excludeTags = currentTagFilters
        ?.filter((f) => f.mode === "exclude")
        .map((f) => f.tag);

      const response = await dataSource.getSongs({
        offset: pageParam,
        limit: pageSize,
        sort_by: sortField(),
        sort_direction: sortDirection(),
        search: query?.(),
        artist_id: artistId?.(),
        album_id: albumId?.(),
        include_tags:
          includeTags && includeTags.length > 0 ? includeTags : undefined,
        exclude_tags:
          excludeTags && excludeTags.length > 0 ? excludeTags : undefined,
      });

      debug("songsQuery", "received songs page:", {
        count: response.items.length,
        hasMore: response.has_more,
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
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000, // 5 minutes - prevent refetch on remount
    gcTime: 10 * 60 * 1000, // 10 minutes - keep data in cache
    refetchOnMount: false, // don't refetch on remount, keep accumulated pages
    refetchOnWindowFocus: false, // don't refetch on window focus
  }));
}

// simple query hook for fetching a single song by id
export function useSongQuery(songId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: queryKeys.songs.detail(songId() || ""),
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

interface UseAlbumsQueryOptions {
  query?: Accessor<string | undefined>;
  pageSize?: number;
  tagFilters?: Accessor<TagFilter[]>;
}

export function useAlbumsQuery(options?: UseAlbumsQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const query = options?.query;
  const tagFilters = options?.tagFilters;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.albums.list(query?.(), tagFilters?.()),
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

      // build query params with tag filters
      const currentTagFilters = tagFilters?.();
      const includeTags = currentTagFilters
        ?.filter((f) => f.mode === "include")
        .map((f) => f.tag);
      const excludeTags = currentTagFilters
        ?.filter((f) => f.mode === "exclude")
        .map((f) => f.tag);

      return dataSource.getAlbums({
        offset: pageParam,
        limit: pageSize,
        search: query?.(),
        include_tags:
          includeTags && includeTags.length > 0 ? includeTags : undefined,
        exclude_tags:
          excludeTags && excludeTags.length > 0 ? excludeTags : undefined,
      });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
}

export function useAlbumQuery(albumId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: queryKeys.albums.detail(albumId() || ""),
    queryFn: async () => {
      const id = albumId();
      if (!id) return null;

      const dataSource = getDataSource();
      if (!dataSource.getAlbums) {
        return null;
      }

      // query for specific album by id
      const result = await dataSource.getAlbums({
        album_id: id,
        limit: 1,
      });

      return result.items[0] || null;
    },
    enabled: () => !!albumId(),
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

interface UseArtistsQueryOptions {
  query?: Accessor<string | undefined>;
  pageSize?: number;
}

export function useArtistsQuery(options?: UseArtistsQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const query = options?.query;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.artists.list(query?.()),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      console.log(`[useArtistsQuery] queryFn called with pageParam=${pageParam}`);
      const dataSource = getDataSource();
      console.log(`[useArtistsQuery] dataSource:`, dataSource);
      if (!dataSource.getArtists) {
        console.warn(`[useArtistsQuery] dataSource has no getArtists method!`);
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }
      const result = await dataSource.getArtists({
        offset: pageParam,
        limit: pageSize,
        search: query?.(),
      });
      console.log(`[useArtistsQuery] dataSource.getArtists returned:`, result);
      return result;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
}

export function useArtistQuery(artistId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: queryKeys.artists.detail(artistId() || ""),
    queryFn: async () => {
      const id = artistId();
      if (!id) return null;

      const dataSource = getDataSource();
      if (!dataSource.getArtists) {
        return null;
      }

      // query for specific artist by id
      const result = await dataSource.getArtists({
        artist_id: id,
        limit: 1,
      });

      // artist already has thumbnail_url from data source
      return result.items[0] || null;
    },
    enabled: () => !!artistId(),
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

      const result = await dataSource.getArtistSongs(id, { limit: 1000 });
      
      // songs already have thumbnail_url from data source
      return result;
    },
    enabled: () => !!artistId(),
  }));
}

// genres query hooks

interface UseGenresQueryOptions {
  query?: Accessor<string | undefined>;
  pageSize?: number;
}

export function useGenresQuery(options?: UseGenresQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const query = options?.query;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.genres.list(query?.()),
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
        search: query?.(),
      });
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.items.length;
    },
    initialPageParam: 0,
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
    enabled: () => !!genreId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// mutation hooks

import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "../../components/feedback/Toast";

interface UpdateSongsMutationParams {
  song_ids: string[];
  title?: string;
  artist?: string;
  artist_id?: string;
  album?: string;
  album_id?: string;
  genre?: string;
  genre_id?: string;
  year?: number;
  track_number?: number;
  disc_number?: number;
  duration?: number;
  bpm?: number;
  key_signature?: string;
  lyrics?: string;
  user_id?: string;
  updated_by?: string;
}

export function useUpdateSongsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: UpdateSongsMutationParams) => {
      const dataSource = getDataSource();
      if (!dataSource.updateSong) {
        throw new Error("current data source does not support updating songs");
      }

      await dataSource.updateSong(params);
    },
    onSuccess: () => {
      // invalidate all music queries to refresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
      toast.success("song updated");
    },
    onError: (error) => {
      console.error("failed to update songs:", error);
      toast.error("failed to update songs");
    },
  }));
}
