// smart favorite toggle component with business logic
// wraps FavoriteHeart with mutation handling
import { Show } from "solid-js";
import {
  useToggleFavoriteMutation,
  type FavoriteTarget,
} from "../music/queries/favorites";
import { FavoriteHeart, type FavoriteHeartProps } from "../components/ratings/FavoriteHeart";
import { canSetFavorite } from "../music/data/permissions";

export interface FavoriteToggleProps
  extends Pick<FavoriteHeartProps, "disabled" | "size" | "readonly" | "class"> {
  /** target type (song, album, artist, playlist) - REQUIRED */
  targetType: FavoriteTarget;
  /** target id - REQUIRED */
  targetId: string;
  /** current favorite status - REQUIRED */
  isFavorite: boolean;
  /** sha256 for songs (needed for queue updates) - optional, only for songs */
  sha256?: string;
  /** callback after successful toggle - optional */
  onToggleSuccess?: (newValue: boolean) => void;
}

// smart favorite toggle with automatic mutation handling
// use this in the app - NOT FavoriteHeart directly
// automatically hidden if user doesn't have permission to set favorites
export function FavoriteToggle(props: FavoriteToggleProps) {
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  const handleToggle = (newValue: boolean) => {
    toggleFavoriteMutation.mutate(
      {
        targetType: props.targetType,
        targetId: props.targetId,
        sha256: props.sha256,
        isFavorite: newValue,
      },
      {
        onSuccess: () => {
          props.onToggleSuccess?.(newValue);
        },
      },
    );
  };

  return (
    <Show when={canSetFavorite()}>
      <FavoriteHeart
        isFavorite={props.isFavorite}
        onToggle={handleToggle}
        disabled={props.disabled || toggleFavoriteMutation.isPending}
        size={props.size}
        readonly={props.readonly}
        class={props.class}
      />
    </Show>
  );
}
