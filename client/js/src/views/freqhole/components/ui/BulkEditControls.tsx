/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { FavoriteHeart, StarRating } from "./";
import { useSongState } from "../../services/songState";
import type { Song } from "../../../../lib/music/schemas/song";

export interface BulkEditControlsProps {
  selectedSongs: Song[];
  onBulkFavorite: (isFavorite: boolean) => Promise<void>;
  onBulkRate: (rating: number) => Promise<void>;
  class?: string;
}

/**
 * Bulk edit controls for selected songs
 * Shows aggregate state and allows bulk operations
 */
export function BulkEditControls(props: BulkEditControlsProps) {
  const [isUpdating, setIsUpdating] = createSignal(false);
  const songState = useSongState();

  // Calculate if all songs are favorited
  const allFavorited = () => {
    if (props.selectedSongs.length === 0) return false;
    return props.selectedSongs.every((song) => songState.isFavorite(song.id));
  };

  // Calculate average rating (rounded)
  const averageRating = () => {
    const selectedSongs = props.selectedSongs;
    if (selectedSongs.length === 0) return 0;

    const ratings = selectedSongs
      .map((song) => songState.getRating(song.id))
      .filter((rating) => rating > 0);

    if (ratings.length === 0) return 0;
    return Math.round(
      ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    );
  };

  const handleBulkFavorite = async (isFavorite: boolean) => {
    if (isUpdating()) return;

    try {
      setIsUpdating(true);
      await props.onBulkFavorite(isFavorite);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleBulkRate = async (rating: number) => {
    if (isUpdating()) return;

    try {
      setIsUpdating(true);
      await props.onBulkRate(rating);
    } finally {
      setIsUpdating(false);
    }
  };

  if (props.selectedSongs.length === 0) {
    return null;
  }

  return (
    <div class={`flex items-center gap-4 ${props.class || ""}`}>
      {/* Bulk Favorite Toggle */}
      <div class="cursor-pointer" title="Toggle favorites for selected songs">
        <FavoriteHeart
          isFavorite={allFavorited()}
          onToggle={handleBulkFavorite}
          disabled={isUpdating()}
          size="md"
          class="opacity-80 hover:opacity-100 transition-opacity"
        />
      </div>

      {/* Bulk Rating */}
      <div class="cursor-pointer" title="Rate selected songs">
        <StarRating
          rating={averageRating()}
          onRatingChange={handleBulkRate}
          disabled={isUpdating()}
          size="md"
          class="opacity-80 hover:opacity-100 transition-opacity"
        />
      </div>
    </div>
  );
}
