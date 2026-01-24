// query hooks for favorites with optimistic updates
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { updateSongInQueue } from "../../app/services/storage/db";
import { toast } from "../../components/feedback/Toast";
import { debug, error as logError, warn } from "../../utils/logger";
import { getCurrentRemote } from "../data";
import { setFavorite as setLocalFavorite } from "../services/storage/db";
import {
  updateAlbumInCache,
  updateArtistInCache,
  updatePlaylistInCache,
  updateSongInCache,
} from "./cacheUpdates";
import { queryKeys } from "./queryKeys";

// favorite target types
export type FavoriteTarget = "song" | "album" | "artist" | "playlist";

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
      const remote = getCurrentRemote();

      // for remote sources, call the API
      if (remote) {
        const result = await apiClient.music.setFavorite(remote.base_url, {
          user_id: null, // server will use authenticated user from session
          target_type: params.targetType,
          target_id: params.targetId,
          is_favorite: params.isFavorite,
        });

        if (!result.success) {
          console.error("set favorite failed:", result);
          throw new Error(
            `failed to ${params.isFavorite ? "add to" : "remove from"} favorites`,
          );
        }

        // API response has data.success and data.message
        if (!result.data?.success) {
          console.error("set favorite API error:", result.data);
          throw new Error(result.data?.message || "unknown error from server");
        }

        return params.isFavorite;
      }

      // for local source, use local storage
      // note: playlists are not supported in local storage favorites
      if (params.targetType === "playlist") {
        throw new Error("local playlists do not support favorites");
      }

      await setLocalFavorite(
        params.targetType as "song" | "album" | "artist",
        params.targetId,
        params.isFavorite,
      );

      return params.isFavorite;
    },

    // optimistic update - immediately update the cache before the API call
    onMutate: async (variables) => {
      debug("favorites", "onMutate called:", variables);

      // update the song in the queue (IndexedDB) immediately so PlayerBar and Queue show correct state
      if (variables.targetType === "song" && variables.sha256) {
        debug("favorites", "updating song in queue (IndexedDB)");
        await updateSongInQueue(variables.targetId, variables.sha256, {
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
        queryKeys.playlists.all, // playlist songs
        ["album", "songs"], // album songs
        ["artist", "songs"], // artist songs
        ["genre", "songs"], // genre songs
      ];
    case "album":
      return [
        queryKeys.albums.all,
        ["artist", "songs"], // artist songs contain album_is_favorite
      ];
    case "artist":
      return [
        queryKeys.artists.all,
        ["artist", "songs"], // artist songs contain artist data with is_favorite
      ];
    case "playlist":
      return [queryKeys.playlists.all];
  }
}
