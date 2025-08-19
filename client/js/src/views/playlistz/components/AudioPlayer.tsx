/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  audioState,
  togglePlayback,
  playQueueIndex,
  loadPlaylistQueue,
} from "../services/audioService.js";
import type { Playlist } from "../types/playlist.js";

interface AudioPlayerProps {
  playlist?: Playlist;
  size?: string;
}

export function AudioPlayer(props: AudioPlayerProps) {
  const handleClick = async () => {
    try {
      const currentSong = audioState.currentSong();
      const queue = audioState.playlistQueue();

      // If there's a current song, toggle playback
      if (currentSong) {
        await togglePlayback();
      }
      // If no current song but there's a queue, start playing first song
      else if (queue.length > 0) {
        await playQueueIndex(0);
      }
      // If no queue but we have a playlist prop, load its queue
      else if (props.playlist && props.playlist.songIds.length > 0) {
        await loadPlaylistQueue(props.playlist);
        await playQueueIndex(0);
      }
    } catch (error) {
      console.error("Error in AudioPlayer:", error);
    }
  };

  // Check if current song is loading (mirrors SongRow logic)
  const isCurrentlyLoading = () => {
    const currentSong = audioState.currentSong();
    return currentSong && audioState.loadingSongIds().has(currentSong.id);
  };

  return (
    <button
      onClick={handleClick}
      class={`inline-flex items-center justify-center ${props.size || "w-12 h-12"} bg-magenta-500 hover:bg-magenta-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-full text-white transition-colors mx-2`}
    >
      <Show
        when={isCurrentlyLoading()}
        fallback={
          <Show
            when={audioState.isPlaying()}
            fallback={
              <svg class="w-10 h-10 ml-0.5" fill="#eeddee" viewBox="0 0 20 20">
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
