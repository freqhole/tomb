// query hooks for favorites with optimistic updates
import { 
  createInfiniteQuery, 
  createMutation, 
  useQueryClient 
} from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { updateSongInQueue } from "../../app/services/storage/db";
import { toast } from "../../components/feedback/Toast";
import { debug, error as logError, warn } from "../../utils/logger";
import { getDataSource } from "../data";
import type { FavoriteItem, FavoriteTarget, ListFavoritesParams } from "../data/types";
import {
  updateAlbumInCache,
  updateArtistInCache,
  updatePlaylistInCache,
  updateSongInCache,
} from "./cacheUpdates";
import { queryKeys } from "./queryKeys";

// re-export for convenience
export type { FavoriteTarget };

// infinite query hook for favorites list
interface UseFavoritesInfiniteQueryOptions {
  pageSize?: number;
  targetType?: Accessor<FavoriteTarget | undefined>;
}

export function useFavoritesInfiniteQuery(
  options?: UseFavoritesInfiniteQueryOptions,
) {
  const pageSize = options?.pageSize || 100;
  const targetType = options?.targetType;

  return createInfiniteQuery(() => ({
    queryKey: queryKeys.favorites.infinite({
      targetType: targetType?.(),
    }),
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      debug("favoritesQuery", "fetching favorites page:", {
        pageParam,
        targetType: targetType?.(),
      });
      
      const dataSource = getDataSource();
      if (!dataSource.listFavorites) {
        throw new Error("favorites not supported by current data source");
      }

      const params: ListFavoritesParams = {
        target_type: targetType?.(),
        offset: pageParam,
        limit: pageSize,
      };

      const response = await dataSource.listFavorites(params);

      debug("favoritesQuery", "received favorites page:", {
        pageParam,
        count: response.items.length,
        hasMore: response.has_more,
      });

      return {
        items: response.items,
        nextOffset: response.has_more
          ? pageParam + pageSize
          : undefined,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  }));
}

// mutation hook for toggling favorite status
export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      targetType: FavoriteTarget;
      targetId: string;
      sha256?: string; // for songs
      isFavorite: boolean;
    }) => {
      const dataSource = getDataSource();

      // check if datasource supports favorites
      if (!dataSource.setFavorite) {
        throw new Error("current data source does not support favorites");
      }

      // call datasource method - it handles local vs remote
      await dataSource.setFavorite({
        targetType: params.targetType,
        targetId: params.targetId,
        isFavorite: params.isFavorite,
      });

      return params.isFavorite;
    },

    // optimistic update - immediately update the cache before the API call
    onMutate: async (variables) => {
      debug("favorites", "onMutate called:", variables);

      // update the appropriate entity in cache immediately for instant UI feedback
      if (variables.targetType === "song") {
        debug("favorites", "optimistically updating song in cache");
        updateSongInCache(queryClient, variables.targetId, variables.sha256 || "", {
          is_favorite: variables.isFavorite,
        });
        
        // also update song in queue (IndexedDB) so PlayerBar and Queue show correct state
        if (variables.sha256) {
          debug("favorites", "updating song in queue (IndexedDB)");
          await updateSongInQueue(variables.targetId, variables.sha256, {
            is_favorite: variables.isFavorite,
          });
        }
      } else if (variables.targetType === "album") {
        debug("favorites", "optimistically updating album in cache");
        updateAlbumInCache(queryClient, variables.targetId, {
          is_favorite: variables.isFavorite,
        });
      } else if (variables.targetType === "artist") {
        debug("favorites", "optimistically updating artist in cache");
        updateArtistInCache(queryClient, variables.targetId, {
          is_favorite: variables.isFavorite,
        });
      } else if (variables.targetType === "playlist") {
        debug("favorites", "optimistically updating playlist in cache");
        updatePlaylistInCache(queryClient, variables.targetId, {
          is_favorite: variables.isFavorite,
        });
      }

      debug("favorites", "onMutate complete");
      return { variables };
    },

    onSuccess: (isFavorite, variables) => {
      debug("favorites", "onSuccess:", { isFavorite, variables });
      // show success toast
      const action = isFavorite ? "added to" : "removed from";
      toast.success(`${action} favorites`);

      // invalidate queries to trigger refetch with updated favorite status
      const queryKeysToInvalidate = getQueryKeysToInvalidate(
        variables.targetType,
      );
      debug(
        "favorites",
        "invalidating queries with keys:",
        queryKeysToInvalidate,
      );

      // invalidate each query key prefix
      queryKeysToInvalidate.forEach((queryKey) => {
        queryClient.invalidateQueries({
          queryKey,
          exact: false,
        });
      });

      debug("favorites", "invalidation complete");
    },

    onError: (error: Error, variables, context) => {
      // show error toast
      logError("favorites", "onError:", error);
      logError("favorites", "variables:", variables);
      const action = variables.isFavorite ? "add to" : "remove from";
      toast.error(`failed to ${action} favorites`, {
        title: "error",
      });

      // invalidate queries to refetch and show correct state
      debug("favorites", "invalidating queries after error");
      const queryKeysToInvalidate = getQueryKeysToInvalidate(
        variables.targetType,
      );
      queryKeysToInvalidate.forEach((queryKey) => {
        queryClient.invalidateQueries({
          queryKey,
          exact: false,
        });
      });
    },
  }));
}

// helper to invalidate queries for a target type
// returns array of query keys to invalidate
function getQueryKeysToInvalidate(
  targetType: FavoriteTarget,
): Array<readonly unknown[]> {
  switch (targetType) {
    case "song":
      // invalidate all queries that might contain songs
      return [
        queryKeys.songs.all,
        queryKeys.favorites.all, // favorites list
        queryKeys.playlists.all, // playlist songs
        ["album", "songs"], // album songs (prefix match all album detail views)
        ["artist", "songs"], // artist songs
        ["genre", "songs"], // genre songs
      ];
    case "album":
      return [
        queryKeys.albums.all, // album lists and detail views (all nested queries)
        queryKeys.favorites.all, // favorites list
        ["artist", "songs"], // artist songs contain album_is_favorite
        ["album", "songs"], // album detail views show album favorite status
      ];
    case "artist":
      return [
        queryKeys.artists.all, // artist lists and detail views (all nested queries)
        queryKeys.favorites.all, // favorites list
        ["artist", "songs"], // artist songs contain artist data with is_favorite
      ];
    case "playlist":
      return [
        queryKeys.playlists.all, // playlist lists and detail views
        queryKeys.favorites.all, // favorites list
      ];
  }
}
