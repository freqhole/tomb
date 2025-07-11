/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  QueueIcon,
  VolumeIcon,
  MusicIcon,
} from "../icons";
import { useMusicPlayer } from "../../context/FreqholeContext";
import { apiClient } from "../../../../lib/api-client";

export const Player = () => {
  const player = useMusicPlayer();

  return (
    <Show when={player.currentSong()}>
      <div class="fixed bottom-0 left-0 right-0 bg-black/50 backdrop-blur-xl p-4 flex items-center gap-6 z-50 animate-slideUp">
        {/* Song Info */}
        <div class="flex items-center gap-4 min-w-60">
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
            <h4 class="text-white font-medium text-base truncate m-0">
              {player.currentSong()?.title}
            </h4>
            <p class="text-white/70 font-light text-sm truncate m-0">
              {player.currentSong()?.artist || "Unknown Artist"}
            </p>
          </div>
        </div>

        {/* Player Controls */}
        <div class="flex items-center gap-3">
          <button
            class="w-11 h-11 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={player.playPrevious}
            disabled={!player.canGoPrevious()}
            title="Previous"
          >
            <PrevIcon />
          </button>
          <button
            class="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:from-primary-400 hover:to-primary-500 hover:scale-105"
            onClick={player.togglePlayback}
            title={player.isPlaying() ? "Pause" : "Play"}
          >
            {player.isPlaying() ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            class="w-11 h-11 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={player.playNext}
            disabled={!player.canGoNext()}
            title="Next"
          >
            <NextIcon />
          </button>
          <button
            class="w-11 h-11 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110"
            onClick={player.toggleQueue}
            title="Show Queue"
          >
            <QueueIcon />
          </button>
        </div>

        {/* Progress Bar */}
        <div class="flex items-center gap-3 flex-1 max-w-96">
          <span class="text-sm text-white/70 font-light min-w-10">
            {player.formatTime(player.currentTime())}
          </span>
          <div
            class="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-2 min-w-24"
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
          <span class="text-sm text-white/70 font-light min-w-10">
            {player.formatTime(player.duration())}
          </span>
        </div>

        {/* Volume Control */}
        <div class="flex items-center gap-2">
          <VolumeIcon class="text-white/70" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={player.volume()}
            onInput={(e) => {
              const newVolume = parseFloat(e.currentTarget.value);
              player.changeVolume(newVolume);
            }}
            class="w-24 h-1 bg-white/20 border-none rounded-full outline-none appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, rgb(217 70 239) 0%, rgb(217 70 239) ${player.volume() * 100}%, rgba(255,255,255,0.2) ${player.volume() * 100}%, rgba(255,255,255,0.2) 100%)`,
            }}
          />
        </div>

        {/* Loading/Error States */}
        <Show when={player.isLoading()}>
          <div class="flex items-center gap-2 text-white/60">
            <div class="w-4 h-4 border-2 border-white/30 border-t-primary-500 rounded-full animate-spin"></div>
          </div>
        </Show>

        <Show when={player.error()}>
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs">{player.error()}</span>
          </div>
        </Show>
      </div>
    </Show>
  );
};
