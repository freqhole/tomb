// infinite query hook for songs with album-grouped sorting
import { createInfiniteQuery, createQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import type { TagFilter } from "../../components/forms/TagFilterPicker";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { debug } from "../../utils/logger";
import { getDataSource } from "../data";
import { RemoteMusicDataSource } from "../data/remote/remoteSource";
import type { MusicDataSource } from "../data/types";
import { queryKeys } from "./queryKeys";

// pick a data source: a remote-scoped one when an explicit remote is
// supplied (e.g. the library view's selected remote), otherwise the
// globally-active source. used by the album editor modal so it works
// for both context-menu edits (active source) and bulk-enrichment review
// (per-remote source).
function pickAlbumSource(remote: Remote | undefined): MusicDataSource {
  if (remote && remote.remote_id) {
    return new RemoteMusicDataSource(remote) as unknown as MusicDataSource;
  }
  return getDataSource();
}

export type SongSortField =
  | "added_at"
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "year"
  | "duration"
  | "play_count";

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
export function useSongQuery(
  songId: Accessor<string | undefined>,
  remote?: Accessor<Remote | undefined>,
) {
  return createQuery(() => ({
    queryKey: [...queryKeys.songs.detail(songId() || ""), remote?.()?.remote_id ?? null] as const,
    queryFn: async () => {
      const id = songId();
      if (!id) return null;

      const dataSource = pickAlbumSource(remote?.());
      return dataSource.getSongById(id);
    },
    enabled: !!songId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// albums query hooks

export type AlbumSortField = "title" | "artist" | "year" | "song_count" | "added_at";

interface UseAlbumsQueryOptions {
  query?: Accessor<string | undefined>;
  pageSize?: number;
  tagFilters?: Accessor<TagFilter[]>;
  sortField?: Accessor<AlbumSortField>;
  sortDirection?: Accessor<"asc" | "desc">;
}

export function useAlbumsQuery(options?: UseAlbumsQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const query = options?.query;
  const tagFilters = options?.tagFilters;
  const sortField = options?.sortField || (() => "added_at" as const);
  const sortDirection = options?.sortDirection || (() => "desc" as const);

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.albums.list(query?.(), tagFilters?.(), sortField?.(), sortDirection?.()),
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
        sort_by: sortField?.(),
        sort_direction: sortDirection?.(),
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

export function useAlbumQuery(
  albumId: Accessor<string | undefined>,
  remote?: Accessor<Remote | undefined>
) {
  return createQuery(() => ({
    queryKey: queryKeys.albums.detail(albumId() || "", remote?.()?.remote_id),
    queryFn: async () => {
      const id = albumId();
      if (!id) return null;
      const dataSource = pickAlbumSource(remote?.());
      if (!dataSource.getAlbums) return null;

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

export function useAlbumSongsQuery(
  albumId: Accessor<string | undefined>,
  remote?: Accessor<Remote | undefined>
) {
  return createQuery(() => ({
    queryKey: queryKeys.albums.songs(albumId() || "", remote?.()?.remote_id),
    queryFn: async () => {
      const id = albumId();
      if (!id)
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };

      const dataSource = pickAlbumSource(remote?.());
      if (!dataSource.getAlbumSongs) {
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };
      }

      return dataSource.getAlbumSongs(id, { limit: 1000 });
    },
    enabled: () => !!albumId(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  }));
}

// artists query hooks

interface UseArtistsQueryOptions {
  query?: Accessor<string | undefined>;
  pageSize?: number;
  /** reactive enabled flag — defaults to always enabled. used to skip
   *  fetching the full artist list on narrow viewports when only the
   *  detail view is showing. */
  enabled?: Accessor<boolean>;
}

export function useArtistsQuery(options?: UseArtistsQueryOptions) {
  const pageSize = options?.pageSize || 100;
  const query = options?.query;
  const enabled = options?.enabled;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.artists.list(query?.()),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
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
    enabled: () => (enabled ? enabled() : true),
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
    queryKey: queryKeys.artists.songs(artistId() || ""),
    queryFn: async () => {
      const id = artistId();
      if (!id)
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };

      const dataSource = getDataSource();
      if (!dataSource.getArtistSongs) {
        return { items: [], total: 0, offset: 0, limit: 100, has_more: false };
      }

      // sort by album release date (year) to group albums chronologically
      const result = await dataSource.getArtistSongs(id, { 
        limit: 1000,
        sort_by: "year",
        sort_direction: "desc",
      });
      
      // songs already have thumbnail_url from data source
      return result;
    },
    enabled: () => !!artistId(),
  }));
}

// genres query hooks were removed during the taxonomy refactor — genres are
// now a kind under the unified taxon system. fetch them via the taxonomy
// queries (or the AlbumTaxonsEditor) instead of a dedicated genres list.

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
  album_type?: string;
  populate_track_artist?: boolean;
  aggregate_album_images?: boolean;
  genre?: string;
  genre_id?: string;
  year?: number;
  track_number?: number;
  disc_number?: number;
  duration?: number;
  bpm?: number;
  lyrics?: string;
  track_artist?: string | null;
  entity_urls?: Array<{ id?: string; name?: string | null; url: string }>;
  user_id?: string;
  updated_by?: string;
}

export function useUpdateSongsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (
      params: UpdateSongsMutationParams & { remote?: Remote },
    ) => {
      const { remote, ...updateParams } = params;
      const dataSource = pickAlbumSource(remote);
      if (!dataSource.updateSong) {
        throw new Error("current data source does not support updating songs");
      }

      await dataSource.updateSong(updateParams);
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

// bulk delete songs mutation
export function useBulkDeleteSongsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (songIds: string[]) => {
      const dataSource = getDataSource();
      if (!dataSource.bulkDeleteSongs) {
        throw new Error("current data source does not support bulk delete");
      }

      return await dataSource.bulkDeleteSongs(songIds);
    },
    onSuccess: (result) => {
      // invalidate all music queries to refresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });

      const { deleted_count, failed_ids } = result;
      if (failed_ids.length > 0) {
        toast.warning(`deleted ${deleted_count} songs, ${failed_ids.length} failed`);
      } else {
        toast.success(`deleted ${deleted_count} songs`);
      }
    },
    onError: (error) => {
      console.error("failed to bulk delete songs:", error);
      toast.error("failed to delete songs");
    },
  }));
}

// bulk clear song artwork mutation (removes primary images, preserves waveforms)
export function useBulkClearSongArtworkMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (songIds: string[]) => {
      const dataSource = getDataSource();
      if (!dataSource.bulkClearSongArtwork) {
        throw new Error("current data source does not support clearing artwork");
      }

      return await dataSource.bulkClearSongArtwork(songIds);
    },
    onSuccess: (result) => {
      // invalidate song queries to refresh image data
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });

      const { cleared_count, failed_ids } = result;
      if (failed_ids.length > 0) {
        toast.warning(`cleared artwork for ${cleared_count} songs, ${failed_ids.length} failed`);
      } else {
        toast.success(`cleared artwork for ${cleared_count} songs`);
      }
    },
    onError: (error) => {
      console.error("failed to clear song artwork:", error);
      toast.error("failed to clear artwork");
    },
  }));
}
