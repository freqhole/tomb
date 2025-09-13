/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { StarRatingCompact } from "./StarRatingCompact";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSongState } from "../../services/songState";
import type { Song } from "../../../../lib/music/schemas/song";

export interface SongStarRatingCompactProps {
  song: Song | null | undefined;
  size?: "sm" | "md" | "lg";
  class?: string;
  onRate?: (songId: string, rating: number) => void;
  disabled?: boolean;
  selected?: boolean;
}

/**
 * Compact star rating component that works with Song objects
 * Handles API calls and state management automatically
 * Click cycles through 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
 */
export function SongStarRatingCompact(props: SongStarRatingCompactProps) {
  const [isUpdating, setIsUpdating] = createSignal(false);
  const events = useGlobalEvents();
  const songState = useSongState();

  const getRating = () => {
    if (!props.song) return null;
    // Use the state service to get the most up-to-date rating
    return songState.getRating(props.song.id);
  };

  const handleRate = async (rating: number) => {
    const song = props.song;
    if (!song || isUpdating()) return;

    try {
      setIsUpdating(true);

      // Optimistic update through state service
      songState.updateRating(song.id, rating);

      const result = await apiClient.rateSong(song.id, rating);

      // Check if the server actually cleared the rating
      if (
        rating === 0 &&
        result.rating !== null &&
        result.rating !== undefined
      ) {
        console.warn(
          `[SongStarRatingCompact] tried to clear rating but server returned: ${result.rating}`
        );
      }

      // Emit global event for state synchronization
      events.emit("song:rating-updated", {
        songId: song.id,
        rating: rating,
      });

      // Call the optional callback
      props.onRate?.(song.id, rating);
    } catch (error) {
      console.error("failed to rate song:", error);
      // Revert optimistic update on error
      const originalRating = songState.getRating(song.id);
      songState.updateRating(song.id, originalRating);
    } finally {
      setIsUpdating(false);
    }
  };

  if (!props.song) {
    return null;
  }

  return (
    <StarRatingCompact
      rating={getRating()}
      onRatingChange={handleRate}
      disabled={props.disabled || isUpdating()}
      size={props.size}
      class={props.class}
      selected={props.selected}
    />
  );
}
