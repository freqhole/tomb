// query hooks for playlists
import {
  createInfiniteQuery,
  createMutation,
  createQuery,
  useQueryClient,
} from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getDataSource } from "../data";
import type { PlaylistSummary, Song } from "../data/types";
import { queryKeys } from "./queryKeys";

// query hook for recent playlists (no pagination, just top N)
export function useRecentPlaylistsQuery(
  limit: number = 5,
  enabled: Accessor<boolean> = () => true,
) {
  return createQuery(() => ({
    queryKey: queryKeys.playlists.recent(limit),
    queryFn: async () => {
      const dataSource = getDataSource();

      if (!dataSource.getPlaylists) {
        return [];
      }

      const response = await dataSource.getPlaylists({
        offset: 0,
        limit,
      });

      return response.items;
    },
    enabled: enabled(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  }));
}

// query options for playlists
interface UsePlaylistsQueryOptions {
  search?: Accessor<string | undefined>;
  pageSize?: number;
}

// infinite query hook for playlists
export function usePlaylistsQuery(options?: UsePlaylistsQueryOptions) {
  const search = options?.search;
  const pageSize = options?.pageSize || 50;

  return createInfiniteQuery(() => ({
    queryKey: [...queryKeys.playlists.all, "infinite", search?.()],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();

      if (!dataSource.getPlaylists) {
        // local source doesn't support playlists yet
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }

      const response = await dataSource.getPlaylists({
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
      });

      return response;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  }));
}

// query options for playlist songs
interface UsePlaylistSongsQueryOptions {
  playlistId: Accessor<string | undefined>;
  search?: Accessor<string | undefined>;
  pageSize?: number;
}

// infinite query hook for playlist songs
export function usePlaylistSongsQuery(options: UsePlaylistSongsQueryOptions) {
  const playlistId = options.playlistId;
  const search = options?.search;
  const pageSize = options?.pageSize || 100;

  return createInfiniteQuery(() => ({
    queryKey: ["playlists", playlistId(), "songs", "infinite", search?.()],
    enabled: !!playlistId(),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const dataSource = getDataSource();
      const id = playlistId();

      if (!id || !dataSource.getPlaylistSongs) {
        return {
          items: [],
          total: 0,
          offset: 0,
          limit: pageSize,
          has_more: false,
        };
      }

      const response = await dataSource.getPlaylistSongs(id, {
        offset: pageParam,
        limit: pageSize,
        search: search?.(),
      });

      return response;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
  }));
}

// mutation hook for creating playlists
export function useCreatePlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      title: string;
      description?: string | null;
      is_public?: boolean;
    }) => {
      const dataSource = getDataSource();

      if (!dataSource.createPlaylist) {
        throw new Error("data source does not support creating playlists");
      }

      return await dataSource.createPlaylist(params);
    },
    onSuccess: () => {
      // invalidate playlists queries to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
  }));
}

// mutation hook for updating playlists
export function useUpdatePlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      playlistId: string;
      title?: string | null;
      description?: string | null;
      is_public?: boolean | null;
      thumbnail_blob_id?: string | null;
    }) => {
      const dataSource = getDataSource();

      if (!dataSource.updatePlaylist) {
        throw new Error("data source does not support updating playlists");
      }

      const { playlistId, ...updateParams } = params;
      return await dataSource.updatePlaylist(playlistId, updateParams);
    },
    onSuccess: (_, variables) => {
      // invalidate playlists queries and specific playlist songs
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
      queryClient.invalidateQueries({
        queryKey: ["playlists", variables.playlistId],
      });
    },
  }));
}

// mutation hook for deleting playlists
export function useDeletePlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (playlistId: string) => {
      const dataSource = getDataSource();

      if (!dataSource.deletePlaylist) {
        throw new Error("data source does not support deleting playlists");
      }

      await dataSource.deletePlaylist(playlistId);
    },
    onSuccess: (_, playlistId) => {
      // invalidate playlists queries
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      // remove specific playlist queries from cache
      queryClient.removeQueries({ queryKey: ["playlists", playlistId] });
    },
  }));
}

// mutation hook for adding songs to playlist
export function useAddSongsToPlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: { playlistId: string; songIds: string[] }) => {
      const dataSource = getDataSource();

      if (!dataSource.addSongsToPlaylist) {
        throw new Error(
          "data source does not support adding songs to playlists",
        );
      }

      await dataSource.addSongsToPlaylist(params.playlistId, params.songIds);
    },
    onSuccess: (_, variables) => {
      // invalidate playlist songs query to refetch
      queryClient.invalidateQueries({
        queryKey: ["playlists", variables.playlistId, "songs"],
      });
      // also invalidate playlists list (song count may have changed)
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
  }));
}

// mutation hook for removing songs from playlist
export function useRemoveSongsFromPlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: { playlistId: string; songIds: string[] }) => {
      const dataSource = getDataSource();

      if (!dataSource.removeSongsFromPlaylist) {
        throw new Error(
          "data source does not support removing songs from playlists",
        );
      }

      await dataSource.removeSongsFromPlaylist(
        params.playlistId,
        params.songIds,
      );
    },
    onSuccess: (_, variables) => {
      // invalidate playlist songs query to refetch
      queryClient.invalidateQueries({
        queryKey: ["playlists", variables.playlistId, "songs"],
      });
      // also invalidate playlists list (song count may have changed)
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
    },
  }));
}

// mutation hook for reordering songs in playlist
export function useReorderPlaylistSongsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      playlistId: string;
      songIds: string[];
      newPosition: number;
    }) => {
      const dataSource = getDataSource();

      if (!dataSource.reorderPlaylistSongs) {
        throw new Error(
          "data source does not support reordering playlist songs",
        );
      }

      await dataSource.reorderPlaylistSongs(
        params.playlistId,
        params.songIds,
        params.newPosition,
      );
    },
    onSuccess: (_, variables) => {
      // invalidate playlist songs query to refetch with new order
      queryClient.invalidateQueries({
        queryKey: ["playlists", variables.playlistId, "songs"],
      });
    },
  }));
}
