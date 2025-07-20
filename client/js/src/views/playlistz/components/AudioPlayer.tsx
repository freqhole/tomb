/* @jsxImportSource solid-js */
import { createSignal, Show, createEffect } from "solid-js";
import {
  audioState,
  togglePlayback,
  seek,
  formatTime,
} from "../services/audioService.js";

export function AudioPlayer() {
  const [showPlayer, setShowPlayer] = createSignal(false);

  // Show player when there's a current song
  createEffect(() => {
    setShowPlayer(!!audioState.currentSong());
  });

  const handleProgressClick = (e: MouseEvent) => {
    const progressBar = e.currentTarget as HTMLElement;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    const newTime = percentage * audioState.duration();
    seek(newTime);
  };

  return (
    <Show when={showPlayer()}>
      <div class="h-20 bg-gray-900 bg-opacity-95 border-t border-gray-700 px-6 flex items-center">
        {/* Current song info */}
        <div class="flex items-center min-w-0 flex-1">
          <Show when={audioState.currentSong()}>
            {(song) => (
              <>
                {/* Song thumbnail */}
                <div class="w-12 h-12 bg-gray-700 rounded mr-4 overflow-hidden flex-shrink-0">
                  <Show
                    when={song().image}
                    fallback={
                      <div class="w-full h-full flex items-center justify-center text-gray-400">
                        <svg
                          class="w-6 h-6"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.369 4.369 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                        </svg>
                      </div>
                    }
                  >
                    <img
                      src={song().image}
                      alt={song().title}
                      class="w-full h-full object-cover"
                    />
                  </Show>
                </div>

                {/* Song details */}
                <div class="min-w-0 flex-1">
                  <h4 class="text-white text-sm font-medium truncate">
                    {song().title}
                  </h4>
                  <p class="text-gray-400 text-xs truncate">{song().artist}</p>
                </div>
              </>
            )}
          </Show>
        </div>

        {/* Controls */}
        <div class="flex items-center space-x-4 mx-8">
          {/* Previous */}
          <button
            class="text-gray-400 hover:text-white transition-colors"
            title="Previous track"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={togglePlayback}
            class="w-10 h-10 bg-magenta-500 hover:bg-magenta-600 rounded-full flex items-center justify-center text-white transition-colors"
          >
            <Show
              when={audioState.isPlaying()}
              fallback={
                <svg
                  class="w-5 h-5 ml-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clip-rule="evenodd"
                  />
                </svg>
              }
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
            </Show>
          </button>

          {/* Next */}
          <button
            class="text-gray-400 hover:text-white transition-colors"
            title="Next track"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0010 6v2.798L4.555 5.168z" />
            </svg>
          </button>
        </div>

        {/* Progress and time */}
        <div class="flex items-center space-x-4 min-w-0 flex-1">
          {/* Current time */}
          <span class="text-xs text-gray-400 flex-shrink-0">
            {formatTime(audioState.currentTime())}
          </span>

          {/* Progress bar */}
          <div
            class="flex-1 h-1 bg-gray-600 rounded-full cursor-pointer group"
            onClick={handleProgressClick}
          >
            <div
              class="h-full bg-magenta-500 rounded-full transition-all group-hover:bg-magenta-400"
              style={{
                width: `${
                  audioState.duration() > 0
                    ? (audioState.currentTime() / audioState.duration()) * 100
                    : 0
                }%`,
              }}
            />
          </div>

          {/* Duration */}
          <span class="text-xs text-gray-400 flex-shrink-0">
            {formatTime(audioState.duration())}
          </span>
        </div>
      </div>
    </Show>
  );
}
