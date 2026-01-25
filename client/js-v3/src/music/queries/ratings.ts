// query hooks for ratings with optimistic updates
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { debug, error as logError } from "../../utils/logger";
import { getCurrentRemote } from "../data";
import { queryKeys } from "./queryKeys";

// rating target types
export type RatingTarget = "song" | "album" | "artist";

// mutation hook for setting rating
export function useSetRatingMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      targetType: RatingTarget;
      targetId: string;
      rating: number; // 0-5, where 0 means remove rating
    }) => {
      const remote = getCurrentRemote();

      if (!remote) {
        throw new Error("ratings are not supported for local sources");
      }

      const result = await apiClient.music.setRating(remote.base_url, {
        user_id: null, // server will use authenticated user from session
        target_type: params.targetType,
        target_id: params.targetId,
        rating: params.rating,
      });

      if (!result.success) {
        console.error("set rating failed:", result);
        throw new Error("failed to set rating");
      }

      // API response has data.success and data.message
      if (!result.data?.success) {
        console.error("set rating API error:", result.data);
        throw new Error(result.data?.message || "unknown error from server");
      }

      return params.rating;
    },

    onSuccess: (rating, variables) => {
      debug("ratings", "onSuccess:", { rating, variables });

      // invalidate queries to trigger refetch with updated rating
      const queryKeysToInvalidate = getQueryKeysToInvalidate(
        variables.targetType,
      );
      debug(
        "ratings",
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

      debug("ratings", "invalidation complete");
    },

    onError: (error: Error, variables) => {
      logError("ratings", "onError:", error);
      logError("ratings", "variables:", variables);

      // invalidate queries to refetch and show correct state
      debug("ratings", "invalidating queries after error");
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
  targetType: RatingTarget,
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
        ["artist", "songs"], // artist songs contain album data with ratings
      ];
    case "artist":
      return [
        queryKeys.artists.all,
        ["artist", "songs"], // artist songs contain artist data with ratings
      ];
  }
}
