/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  MusicIcon,
  ExpandIcon,
} from "../icons";
import { useMusicPlayer } from "../../context/FreqholeContext";
import { apiClient } from "../../../../lib/api-client";

export const MiniPlayer = () => {
  const player = useMusicPlayer();

  return (
    <Show when={player.currentSong() && player.miniPlayerMode()}>
      <div class="fixed bottom-4 right-4 w-80 bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg p-4 z-40 animate-slideUp shadow-2xl">
        {/* Header with expand button */}
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-white text-sm font-medium m-0">Now Playing</h4>
          <div class="flex items-center gap-2">
            <button
              class="bg-white/10 border-none text-white p-1.5 rounded cursor-pointer transition-all duration-300 hover:bg-white/20 hover:scale-110"
              onClick={player.toggleMiniPlayer}
              title="Expand to full player"
            >
              <ExpandIcon />
            </button>
          </div>
        </div>

        {/* Song Info */}
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 flex-shrink-0">
            <Show
              when={player.currentSong()?.thumbnail_blob_id}
              fallback={
                <div class="w-12 h-12 bg-gradient-to-br from-gray-600 to-gray-700 rounded flex items-center justify-center text-white/30">
                  <MusicIcon />
                </div>
              }
            >
              <img
                src={`${apiClient.getBaseUrl()}/api/blobs/${player.currentSong()?.thumbnail_blob_id}`}
                alt={player.currentSong()?.title}
                class="w-12 h-12 rounded object-cover"
              />
            </Show>
          </div>
          <div class="flex-1 min-w-0">
            <h5 class="text-white font-medium text-sm truncate m-0">
              {player.currentSong()?.title}
            </h5>
            <p class="text-white/70 font-light text-xs truncate m-0">
              {player.currentSong()?.artist || "Unknown Artist"}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div class="mb-4">
          <div
            class="w-full h-1 bg-white/20 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-1.5"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percentage = ((e.clientX - rect.left) / rect.width) * 100;
              player.seekTo(percentage);
            }}
          >
            <div
              class="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-100 rounded-full"
              style={{
                width: `${player.getProgress()}%`,
              }}
            ></div>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-xs text-white/60">
              {player.formatTime(player.currentTime())}
            </span>
            <span class="text-xs text-white/60">
              {player.formatTime(player.duration())}
            </span>
          </div>
        </div>

        {/* Mini Controls */}
        <div class="flex items-center justify-center gap-2">
          <button
            class="w-8 h-8 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={player.playPrevious}
            disabled={!player.canGoPrevious()}
            title="Previous"
          >
            <PrevIcon className="w-4 h-4" />
          </button>
          <button
            class="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:from-primary-400 hover:to-primary-500 hover:scale-105"
            onClick={player.togglePlayback}
            title={player.isPlaying() ? "Pause" : "Play"}
          >
            {player.isPlaying() ? (
              <PauseIcon className="w-5 h-5" />
            ) : (
              <PlayIcon className="w-5 h-5" />
            )}
          </button>
          <button
            class="w-8 h-8 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={player.playNext}
            disabled={!player.canGoNext()}
            title="Next"
          >
            <NextIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Loading/Error States */}
        <Show when={player.isLoading()}>
          <div class="flex items-center justify-center mt-2">
            <div class="w-3 h-3 border-2 border-white/30 border-t-primary-500 rounded-full animate-spin"></div>
          </div>
        </Show>

        <Show when={player.error()}>
          <div class="mt-2">
            <span class="text-red-400 text-xs block text-center truncate">
              {player.error()}
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
};
