/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  audioState,
  togglePlayback,
  playPlaylist,
} from "../services/audioService.js";
import type { Playlist } from "../types/playlist.js";

interface AudioPlayerProps {
  playlist?: Playlist;
  size?: string;
}

export function AudioPlayer(props: AudioPlayerProps) {
  const handleClick = async () => {
    try {
      if (!props.playlist || props.playlist.songIds.length === 0) {
        return;
      }

      const currentPlaylist = audioState.currentPlaylist();
      const isPlaying = audioState.isPlaying();
      const isCurrentPlaylist =
        currentPlaylist && currentPlaylist.id === props.playlist.id;

      // if this playlist is currently playing, toggle playback
      if (isCurrentPlaylist && isPlaying) {
        await togglePlayback();
      }
      // otherwise, play this playlist
      else {
        await playPlaylist(props.playlist);
      }
    } catch (error) {
      console.error("error in audio player:", error);
    }
  };

  // check if current song is loading (mirrorz SongRow logic)
  const isCurrentlyLoading = () => {
    const currentSong = audioState.currentSong();
    return (
      currentSong?.id === audioState.selectedSongId() && audioState.isLoading()
    );
  };

  // check if this playlist is currently playing
  const isThisPlaylistPlaying = () => {
    if (!props.playlist) return false;

    const currentPlaylist = audioState.currentPlaylist();
    const isPlaying = audioState.isPlaying();

    return (
      isPlaying && currentPlaylist && currentPlaylist.id === props.playlist.id
    );
  };

  return (
    <button
      onClick={handleClick}
      class={`inline-flex items-center justify-center ${props.size || "w-12 h-12"} disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full text-white hover:text-magenta-200 transition-colors mx-2 ${isThisPlaylistPlaying() ? "bg-magenta-500" : "hover:bg-magenta-500"}`}
    >
      <Show
        when={isCurrentlyLoading()}
        fallback={
          <Show
            when={isThisPlaylistPlaying()}
            fallback={
              <svg
                class="w-10 h-10 ml-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-opacity="1.0"
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clip-rule="evenodd"
                />
              </svg>
            }
          >
            <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                clip-rule="evenodd"
              />
            </svg>
          </Show>
        }
      >
        <svg
          class="w-6 h-6 animate-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </Show>
    </button>
  );
}
