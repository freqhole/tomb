// hook for tracking and toggling favorite status
// provides reactive favorite state that updates across the app
import { useQueryClient } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import type { FavoriteTarget } from "../queries/favorites";
import { useToggleFavoriteMutation } from "../queries/favorites";

interface UseFavoriteStatusOptions {
  targetType: FavoriteTarget;
  targetId: string;
  /** current favorite status (from query data) */
  isFavorite?: boolean;
}

/**
 * hook for managing favorite status with toggle functionality
 *
 * usage:
 * ```typescript
 * const favorite = useFavoriteStatus({
 *   targetType: "song",
 *   targetId: song.id,
 *   isFavorite: song.is_favorite,
 * });
 *
 * <FavoriteHeart
 *   isFavorite={favorite.isFavorite()}
 *   onToggle={favorite.toggle}
 * />
 * ```
 */
export function useFavoriteStatus(options: UseFavoriteStatusOptions) {
  const queryClient = useQueryClient();
  const toggleMutation = useToggleFavoriteMutation();

  // track optimistic state during mutation
  const isFavorite = createMemo(() => {
    // if mutation is pending, show optimistic state
    if (toggleMutation.isPending) {
      // find the pending mutation for this specific item
      const mutations = queryClient.getMutationCache().getAll();
      const pendingMutation = mutations.find(
        (m) =>
          m.state.status === "pending" &&
          m.state.variables &&
          typeof m.state.variables === "object" &&
          "targetId" in m.state.variables &&
          m.state.variables.targetId === options.targetId,
      );

      if (pendingMutation?.state.variables) {
        const vars = pendingMutation.state.variables as {
          isFavorite: boolean;
        };
        return vars.isFavorite;
      }
    }

    // otherwise use provided value
    return options.isFavorite || false;
  });

  const toggle = () => {
    const currentState = isFavorite();
    toggleMutation.mutate({
      targetType: options.targetType,
      targetId: options.targetId,
      isFavorite: !currentState,
    });
  };

  const isLoading = () => toggleMutation.isPending;

  return {
    isFavorite,
    toggle,
    isLoading,
  };
}
