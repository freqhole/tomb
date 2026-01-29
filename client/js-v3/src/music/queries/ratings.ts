// query hooks for ratings with optimistic updates
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "../../components/feedback/Toast";
import { debug, error as logError } from "../../utils/logger";
import { getDataSource } from "../data";
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
      const dataSource = getDataSource();

      // check if datasource supports ratings
      if (!dataSource.setRating) {
        throw new Error("current data source does not support ratings");
      }

      // call datasource method - it handles local vs remote
      await dataSource.setRating({
        targetType: params.targetType,
        targetId: params.targetId,
        rating: params.rating,
      });

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
        queryKeys.songs.all(),
        queryKeys.playlists.all(), // playlist songs
        ["album", "songs"], // album songs
        ["artist", "songs"], // artist songs
        ["genre", "songs"], // genre songs
      ];
    case "album":
      return [
        queryKeys.albums.all(),
        ["artist", "songs"], // artist songs contain album data with ratings
      ];
    case "artist":
      return [
        queryKeys.artists.all(),
        ["artist", "songs"], // artist songs contain artist data with ratings
      ];
  }
}
