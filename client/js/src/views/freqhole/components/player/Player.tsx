/* @jsxImportSource solid-js */
import { Show, onMount, onCleanup } from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  QueueIcon,
  VolumeIcon,
  MusicIcon,
  ArrowDownIcon,
} from "../icons";
import { useMusicPlayer } from "../../context/FreqholeContext";
import { apiClient } from "../../../../lib/api-client";

export const Player = () => {
  const player = useMusicPlayer();

  // Keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          player.togglePlayback();
          break;
        case "KeyQ":
          e.preventDefault();
          player.toggleQueue();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            player.playPrevious();
          } else {
            // Seek backward 10 seconds
            const currentTime = player.currentTime();
            const newTime = Math.max(0, currentTime - 10);
            player.seekToTime(newTime);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            player.playNext();
          } else {
            // Seek forward 10 seconds
            const currentTime = player.currentTime();
            const duration = player.duration();
            const newTime = Math.min(duration, currentTime + 10);
            player.seekToTime(newTime);
          }
          break;
        case "KeyM":
          e.preventDefault();
          player.toggleMiniPlayer();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <Show when={player.currentSong() && !player.miniPlayerMode()}>
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
            title="Previous (Shift + ←)"
          >
            <PrevIcon />
          </button>
          <button
            class="w-12 h-12 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:from-primary-400 hover:to-primary-500 hover:scale-105"
            onClick={player.togglePlayback}
            title={`${player.isPlaying() ? "Pause" : "Play"} (Space)`}
          >
            {player.isPlaying() ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            class="w-11 h-11 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={player.playNext}
            disabled={!player.canGoNext()}
            title="Next (Shift + →)"
          >
            <NextIcon />
          </button>
          <button
            class={`w-11 h-11 rounded-full text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-110 relative ${
              player.showQueue()
                ? "bg-primary-500/80 hover:bg-primary-500"
                : "bg-white/10 hover:bg-white/20"
            }`}
            onClick={player.toggleQueue}
            title={`${player.showQueue() ? "Hide" : "Show"} Queue (Q)`}
          >
            <QueueIcon />
            {player.playQueue().length > 0 && (
              <span class="absolute -top-1 -right-1 bg-primary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium queue-badge">
                {player.playQueue().length}
              </span>
            )}
          </button>
          <button
            class="w-11 h-11 rounded-full bg-white/10 text-white border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-white/20 hover:scale-110"
            onClick={player.toggleMiniPlayer}
            title="Switch to mini player (M)"
          >
            <ArrowDownIcon />
          </button>
        </div>

        {/* Progress Bar */}
        <div class="flex items-center gap-3 flex-1 max-w-96">
          <span
            class="text-sm text-white/70 font-light min-w-10"
            title="Current time"
          >
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
          <span
            class="text-sm text-white/70 font-light min-w-10"
            title="Total duration"
          >
            {player.formatTime(player.duration())}
          </span>
        </div>

        {/* Volume Control */}
        <div class="flex items-center gap-2">
          <VolumeIcon className="text-white/70" />
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
