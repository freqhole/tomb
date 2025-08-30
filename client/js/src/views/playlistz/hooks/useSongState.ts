/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import type { Song } from "../types/playlist.js";
import { updateSong } from "../services/indexedDBService.js";
import {
  playSong,
  togglePlayback,
  audioState,
} from "../services/audioService.js";

export function useSongState() {
  const [editingSong, setEditingSong] = createSignal<Song | null>(null);

  const [error, setError] = createSignal<string | null>(null);

  const handleEditSong = (song: Song) => {
    setEditingSong(song);
  };

  // handle song update after editing
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

  const handlePlaySong = async (song: Song) => {
    try {
      setError(null);
      await playSong(song);
    } catch (err) {
      console.error("Error playing song:", err);
      setError("Failed to play song");
    }
  };

  const handlePauseSong = async () => {
    try {
      setError(null);
      await togglePlayback();
    } catch (err) {
      console.error("Error pausing song:", err);
      setError("Failed to pause song");
    }
  };

  const isSongPlaying = (songId: string) => {
    const currentSong = audioState.currentSong();
    return currentSong?.id === songId && audioState.isPlaying();
  };

  // is song currently selected (but maybe paused)
  const isSongSelected = (songId: string) => {
    const currentSong = audioState.currentSong();
    return currentSong?.id === songId;
  };

  return {
    editingSong,
    error,

    // setterz
    setEditingSong,

    // actionz
    handleEditSong,
    handleSongSaved,
    handlePlaySong,
    handlePauseSong,

    // utilz
    isSongPlaying,
    isSongSelected,
  };
}
