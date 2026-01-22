// query hooks for favorites
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote } from "../data";
import { setFavorite as setLocalFavorite } from "../services/storage/db";

// favorite target types
export type FavoriteTarget = "song" | "album" | "artist" | "playlist";

// mutation hook for toggling favorite status
export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      targetType: FavoriteTarget;
      targetId: string;
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
    onSuccess: (isFavorite, variables) => {
      // show success toast
      const action = isFavorite ? "added to" : "removed from";
      toast.success(`${action} favorites`);

      // invalidate relevant queries to refetch with updated favorite status
      invalidateQueriesForTarget(
        queryClient,
        variables.targetType,
        variables.targetId,
      );
    },
    onError: (error: Error, variables) => {
      // show error toast
      console.error("failed to toggle favorite:", error);
      const action = variables.isFavorite ? "add to" : "remove from";
      toast.error(`failed to ${action} favorites`, {
        title: "error",
      });
    },
  }));
}

// helper to invalidate all queries that might show this item's favorite status
function invalidateQueriesForTarget(
  queryClient: ReturnType<typeof useQueryClient>,
  targetType: FavoriteTarget,
  targetId: string,
) {
  // invalidate the specific item query
  queryClient.invalidateQueries({
    queryKey: [targetType + "s", targetId],
  });

  // also invalidate list queries that might show this item
  switch (targetType) {
    case "song":
      queryClient.invalidateQueries({ queryKey: ["songs"] });
      queryClient.invalidateQueries({ queryKey: ["albums"] }); // album detail shows songs
      queryClient.invalidateQueries({ queryKey: ["playlists"] }); // playlist detail shows songs
      queryClient.invalidateQueries({ queryKey: ["search"] });
      break;
    case "album":
      queryClient.invalidateQueries({ queryKey: ["albums"] });
      queryClient.invalidateQueries({ queryKey: ["artists"] }); // artist detail shows albums
      queryClient.invalidateQueries({ queryKey: ["search"] });
      break;
    case "artist":
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      break;
    case "playlist":
      queryClient.invalidateQueries({ queryKey: ["playlists"] });
      break;
  }
}
