/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { StarRating } from "./StarRating";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSongState } from "../../services/songState";
import type { Song } from "../../../../lib/music/schemas/song";

export interface SongStarRatingProps {
  song: Song | null | undefined;
  size?: "sm" | "md" | "lg";
  class?: string;
  onRate?: (songId: string, rating: number) => void;
  disabled?: boolean;
  readonly?: boolean;
}

/**
 * Smart star rating component that works with Song objects
 * Handles API calls and state management automatically
 */
export function SongStarRating(props: SongStarRatingProps) {
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

    // Use 0 to represent "no rating" instead of null
    const finalRating = rating;

    console.log(
      `🎵 Rating change: "${song.title}" from ${getRating()} to ${finalRating} (input: ${rating})`
    );
    console.log(
      `🎵 Will send to API: ${finalRating === 0 ? "CLEAR RATING (0)" : `SET TO ${finalRating}`}`
    );

    try {
      setIsUpdating(true);

      // Optimistic update through state service
      songState.updateRating(song.id, finalRating);

      console.log(`🎵 API call: rateSong(${song.id}, ${finalRating})`);
      const result = await apiClient.rateSong(song.id, finalRating);
      console.log(`🎵 API response:`, result);
      console.log(`🎵 Server returned rating: ${result.rating}`);

      // Check if the server actually cleared the rating
      if (
        finalRating === 0 &&
        result.rating !== null &&
        result.rating !== undefined
      ) {
        console.warn(
          `🎵 WARNING: Tried to clear rating but server returned: ${result.rating}`
        );
      }

      // Emit global event for state synchronization
      events.emit("song:rating-updated", {
        songId: song.id,
        rating: finalRating,
      });

      // Call the optional callback
      props.onRate?.(song.id, finalRating);

      console.log(`🎵 Rated "${song.title}" with ${finalRating} stars`);
    } catch (error) {
      console.error("Failed to rate song:", error);
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
    <StarRating
      rating={getRating()}
      onRatingChange={handleRate}
      disabled={props.disabled || isUpdating()}
      readonly={props.readonly}
      size={props.size}
      class={props.class}
    />
  );
}
