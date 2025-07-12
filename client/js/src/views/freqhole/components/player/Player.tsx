/* @jsxImportSource solid-js */
import { Show, onMount, onCleanup, createSignal, createEffect } from "solid-js";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  QueueIcon,
  VolumeIcon,
  MusicIcon,
} from "../icons";
import { usePlayer, useQueue, useLayout, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { apiClient } from "../../../../lib/api-client";

export const Player = () => {
  const [player] = usePlayer();
  const [queue] = useQueue();
  const [layout] = useLayout();
  const events = useGlobalEvents();

  // Audio element and state
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement | null>(
    null
  );

  // Player state management
  const isPlaying = () => player.isPlaying;
  const currentSong = () => player.currentSong;
  const volume = () => player.volume;
  const currentTime = () => player.currentTime;
  const duration = () => player.duration;
  const queueOpen = () => layout.queueOpen;

  // Helper functions
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getProgress = (): number => {
    if (!duration() || !currentTime()) return 0;
    return (currentTime() / duration()) * 100;
  };

  // Player controls
  const togglePlayback = () => {
    if (!currentSong()) return;

    if (isPlaying()) {
      storeActions.setPlayerState({ isPlaying: false });
    } else {
      storeActions.setPlayerState({ isPlaying: true });
    }
  };

  const playNext = () => {
    events.emit("queue:next", {});
  };

  const playPrevious = () => {
    events.emit("queue:previous", {});
  };

  const toggleQueue = () => {
    storeActions.toggleQueue();
  };

  const changeVolume = (newVolume: number) => {
    storeActions.setVolume(newVolume);
    events.emit("player:volume", { volume: newVolume });
  };

  const seekTo = (percentage: number) => {
    const audio = audioElement();
    if (!audio || !duration()) return;

    const newTime = (percentage / 100) * duration();
    audio.currentTime = newTime;
    storeActions.setCurrentTime(newTime);
  };

  const seekToTime = (time: number) => {
    const audio = audioElement();
    if (!audio) return;

    audio.currentTime = time;
    storeActions.setCurrentTime(time);
  };

  // Queue helpers
  const canGoPrevious = () => queue.currentIndex > 0;
  const canGoNext = () => queue.currentIndex < queue.items.length - 1;
  const queueLength = () => queue.items.length;

  // Initialize audio element
  onMount(() => {
    const audio = new Audio();
    setAudioElement(audio);

    // Audio event listeners
    audio.addEventListener("loadedmetadata", () => {
      storeActions.setPlayerState({ duration: audio.duration });
    });

    audio.addEventListener("timeupdate", () => {
      storeActions.setCurrentTime(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      storeActions.setPlayerState({ isPlaying: false });
      playNext(); // Auto-play next song
    });

    audio.addEventListener("error", () => {
      console.error("Audio playback error");
      storeActions.setPlayerState({ isPlaying: false });
    });

    return () => {
      audio.pause();
      audio.src = "";
      audio.remove();
    };
  });

  // Watch for current song changes and load audio
  createEffect(() => {
    const song = currentSong();
    const audio = audioElement();

    if (song && audio) {
      console.log("🎵 Loading audio for song:", song.title);
      audio.pause(); // Stop any currently playing audio
      audio.src = `${apiClient.getBaseUrl()}/api/blobs/${song.media_blob_id}`;
      audio.volume = volume();

      // Wait for the audio to load before playing
      if (isPlaying()) {
        audio.addEventListener(
          "canplay",
          () => {
            audio.play().catch((err) => {
              console.error("Failed to play audio:", err);
              storeActions.setPlayerState({ isPlaying: false });
            });
          },
          { once: true }
        );
      }
    }
  });

  // Watch for play/pause state changes (but not when song changes)
  createEffect(() => {
    const audio = audioElement();
    const song = currentSong();
    const playing = isPlaying();

    if (!audio || !song) return;

    // Only handle play/pause if audio is already loaded for this song
    if (audio.src && audio.src.includes(song.media_blob_id)) {
      if (playing && audio.paused) {
        audio.play().catch((err) => {
          console.error("Failed to play audio:", err);
          storeActions.setPlayerState({ isPlaying: false });
        });
      } else if (!playing && !audio.paused) {
        audio.pause();
      }
    }
  });

  // Watch for volume changes
  createEffect(() => {
    const audio = audioElement();
    if (audio) {
      audio.volume = volume();
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    const audio = audioElement();
    if (audio) {
      audio.pause();
      audio.src = "";
    }
  });

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
          togglePlayback();
          break;
        case "KeyQ":
          e.preventDefault();
          toggleQueue();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) {
            playPrevious();
          } else {
            // Seek backward 10 seconds
            const newTime = Math.max(0, currentTime() - 10);
            seekToTime(newTime);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            playNext();
          } else {
            // Seek forward 10 seconds
            const newTime = Math.min(duration(), currentTime() + 10);
            seekToTime(newTime);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <Show when={currentSong()}>
      <div class="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl p-4 flex items-center gap-6 z-50 border-t border-magenta-800/30">
        {/* Song Info */}
        <div class="flex items-center gap-4 min-w-60">
          <div class="w-12 h-12 flex-shrink-0">
            <Show
              when={currentSong()?.thumbnail_blob_id}
              fallback={
                <div class="w-12 h-12 bg-gradient-to-br from-magenta-800 to-magenta-900 rounded flex items-center justify-center text-magenta-400">
                  <MusicIcon />
                </div>
              }
            >
              <img
                src={`${apiClient.getBaseUrl()}/api/blobs/${currentSong()?.thumbnail_blob_id}`}
                alt={currentSong()?.title}
                class="w-12 h-12 rounded object-cover"
              />
            </Show>
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-white font-medium text-base truncate m-0">
              {currentSong()?.title}
            </h4>
            <p class="text-magenta-300 font-light text-sm truncate m-0">
              {currentSong()?.artist || "Unknown Artist"}
            </p>
          </div>
        </div>

        {/* Player Controls */}
        <div class="flex items-center gap-3">
          <button
            class="w-10 h-10 rounded-full bg-magenta-950/50 text-magenta-300 border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-magenta-600/30 hover:text-white hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={playPrevious}
            disabled={!canGoPrevious()}
            title="Previous (Shift + ←)"
          >
            <PrevIcon />
          </button>
          <button
            class="w-12 h-12 rounded-full bg-magenta-600 hover:bg-magenta-500 text-black border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-105"
            onClick={togglePlayback}
            title={`${isPlaying() ? "Pause" : "Play"} (Space)`}
          >
            {isPlaying() ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            class="w-10 h-10 rounded-full bg-magenta-950/50 text-magenta-300 border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-magenta-600/30 hover:text-white hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            onClick={playNext}
            disabled={!canGoNext()}
            title="Next (Shift + →)"
          >
            <NextIcon />
          </button>
          <button
            class={`w-10 h-10 rounded-full border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:scale-110 relative ${
              queueOpen()
                ? "bg-magenta-600 text-black hover:bg-magenta-500"
                : "bg-magenta-950/50 text-magenta-300 hover:bg-magenta-600/30 hover:text-white"
            }`}
            onClick={toggleQueue}
            title={`${queueOpen() ? "Hide" : "Show"} Queue (Q)`}
          >
            <QueueIcon />
            {queueLength() > 0 && (
              <span class="absolute -top-1 -right-1 bg-magenta-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                {queueLength()}
              </span>
            )}
          </button>
        </div>

        {/* Progress Bar */}
        <div class="flex items-center gap-3 flex-1 max-w-96">
          <span
            class="text-sm text-magenta-300 font-light min-w-10"
            title="Current time"
          >
            {formatTime(currentTime())}
          </span>
          <div
            class="flex-1 h-1.5 bg-magenta-800/50 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-2 min-w-24"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const percentage = ((e.clientX - rect.left) / rect.width) * 100;
              seekTo(percentage);
            }}
          >
            <div
              class="h-full bg-gradient-to-r from-magenta-500 to-magenta-600 transition-all duration-100 rounded-full"
              style={{
                width: `${getProgress()}%`,
              }}
            ></div>
          </div>
          <span
            class="text-sm text-magenta-300 font-light min-w-10"
            title="Total duration"
          >
            {formatTime(duration())}
          </span>
        </div>

        {/* Volume Control */}
        <div class="flex items-center gap-2">
          <VolumeIcon className="text-magenta-300" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume()}
            onInput={(e) => {
              const newVolume = parseFloat(e.currentTarget.value);
              changeVolume(newVolume);
            }}
            class="w-24 h-1 bg-magenta-800/50 border-none rounded-full outline-none appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, rgb(217 70 239) 0%, rgb(217 70 239) ${volume() * 100}%, rgba(139, 69, 19, 0.5) ${volume() * 100}%, rgba(139, 69, 19, 0.5) 100%)`,
            }}
          />
        </div>
      </div>
    </Show>
  );
};
