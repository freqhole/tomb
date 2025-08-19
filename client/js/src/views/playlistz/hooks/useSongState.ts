/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import type { Song } from "../types/playlist.js";
import {
  updateSong,
} from "../services/indexedDBService.js";
import {
  playSong,
  togglePlayback,
  audioState,
} from "../services/audioService.js";

export function useSongState() {
  // Song editing state
  const [editingSong, setEditingSong] = createSignal<Song | null>(null);

  // Error state
  const [error, setError] = createSignal<string | null>(null);

  // Handle song editing
  const handleEditSong = (song: Song) => {
    setEditingSong(song);
  };

  // Handle song save after editing
  const handleSongSaved = async (updatedSong: Song) => {
    try {
      setError(null);
      await updateSong(updatedSong.id, updatedSong);
      setEditingSong(null);
    } catch (err) {
      console.error("Error saving song:", err);
      setError("Failed to save song changes");
    }
  };

  // Handle song play
  const handlePlaySong = async (song: Song) => {
    try {
      setError(null);
      await playSong(song);
    } catch (err) {
      console.error("Error playing song:", err);
      setError("Failed to play song");
    }
  };

  // Handle song pause
  const handlePauseSong = async () => {
    try {
      setError(null);
      await togglePlayback();
    } catch (err) {
      console.error("Error pausing song:", err);
      setError("Failed to pause song");
    }
  };

  // Check if a song is currently playing
  const isSongPlaying = (songId: string) => {
    const currentSong = audioState.currentSong();
    return currentSong?.id === songId && audioState.isPlaying();
  };

  // Check if a song is currently selected (but maybe paused)
  const isSongSelected = (songId: string) => {
    const currentSong = audioState.currentSong();
    return currentSong?.id === songId;
  };

  return {
    // State
    editingSong,
    error,

    // Setters
    setEditingSong,

    // Actions
    handleEditSong,
    handleSongSaved,
    handlePlaySong,
    handlePauseSong,

    // Utilities
    isSongPlaying,
    isSongSelected,
  };
}
