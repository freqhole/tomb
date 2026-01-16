/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { FavoriteHeart } from "./FavoriteHeart";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSongState } from "../../services/songState";
import type { Song } from "../../../../lib/music/schemas/song";

export interface SongFavoriteHeartProps {
  song: Song | null | undefined;
  size?: "sm" | "md" | "lg";
  class?: string;
  onToggle?: (songId: string, isFavorite: boolean) => void;
  disabled?: boolean;
  readonly?: boolean;
}

/**
 * Smart favorite heart component that works with Song objects
 * Handles API calls and state management automatically
 */
export function SongFavoriteHeart(props: SongFavoriteHeartProps) {
  const [isUpdating, setIsUpdating] = createSignal(false);
  const events = useGlobalEvents();
  const songState = useSongState();

  // No automatic syncing - let parent components handle initial state sync

  const isFavorite = () => {
    if (!props.song) return false;
    // Use the state service to get the most up-to-date favorite status
    return songState.isFavorite(props.song.id);
  };

  const handleToggle = async (newFavoriteState: boolean) => {
    const song = props.song;
    if (!song || isUpdating()) return;

    try {
      setIsUpdating(true);

      // Optimistic update through state service
      songState.updateSong(song.id, { user_is_favorite: newFavoriteState });

      await apiClient.toggleSongFavorite(song.id, newFavoriteState);

      // Emit global events for state synchronization
      if (newFavoriteState) {
        events.emit("song:favorite", { song });
      } else {
        events.emit("song:unfavorite", { song });
      }

      // Also emit songs:updated event for components that listen to that
      const updatedSong = { ...song, user_is_favorite: newFavoriteState };
      events.emit("songs:updated", {
        songs: [updatedSong],
        operation: "single-update",
      });

      // Call the optional callback
      props.onToggle?.(song.id, newFavoriteState);
    } catch (error) {
      console.error("failed to toggle favorite:", error);
      // Revert optimistic update on error
      songState.updateSong(song.id, { user_is_favorite: !newFavoriteState });
    } finally {
      setIsUpdating(false);
    }
  };

  if (!props.song) {
    return null;
  }

  return (
    <FavoriteHeart
      isFavorite={isFavorite()}
      onToggle={handleToggle}
      disabled={props.disabled || isUpdating()}
      readonly={props.readonly}
      size={props.size}
      class={props.class}
    />
  );
}
