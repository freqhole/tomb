/* @jsxImportSource solid-js */
import {
  Show,
  onMount,
  onCleanup,
  createSignal,
  createEffect,
  untrack,
} from "solid-js";
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
import { SongFavoriteHeart } from "../ui";
import { useSongState } from "../../services/songState";
import { useMusicAnalytics } from "../../../../hooks/music/useMusicAnalytics";

// Media Session API helper
const updateMediaSession = (song: any, isPlaying: boolean) => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album,
      artwork: song.thumbnail_blob_id
        ? [
            {
              src: `${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`,
              sizes: "300x300",
              type: "image/jpeg",
            },
          ]
        : [],
    });

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }
};

// Page title helper
const updatePageTitle = (song: any, isPlaying: boolean) => {
  if (song) {
    document.title = `${isPlaying ? "▷ " : ""}${song.title} - ${song.artist} | F R E Q H O L E`;
  } else {
    document.title = "F R E Q H O L E";
  }
};

export const Player = () => {
  const [player] = usePlayer();
  const [queue] = useQueue();
  const [layout] = useLayout();
  const events = useGlobalEvents();
  const songState = useSongState();
  const analytics = useMusicAnalytics({ enableDebugLogs: true });

  // Configure analytics with proper base URL
  analytics.initializeSession(apiClient.getBaseUrl());

  // Audio element and state
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement | null>(
    null
  );
  const [showVolumeSlider, setShowVolumeSlider] = createSignal(false);
  const [volumeHideTimeout, setVolumeHideTimeout] = createSignal<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [lastLoadedSongId, setLastLoadedSongId] = createSignal<string | null>(
    null
  );

  // Player state management
  const isPlaying = () => player.isPlaying;
  const currentSong = () => player.currentSong;
  const volume = () => player.volume;
  const currentTime = () => player.currentTime;
  const duration = () => player.duration;
  const queueOpen = () => layout.queueOpen;

  // Get current song with synced state
  const getCurrentSong = () => {
    const song = currentSong();
    if (!song) return null;
    return songState.getUpdatedSong(song);
  };

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
    // Track partial play before switching songs
    const song = currentSong();
    const audio = audioElement();
    if (song && audio) {
      analytics.trackPlayPartial(
        song.media_blob_id,
        {
          isPlaying: isPlaying(),
          currentTime: audio.currentTime,
          duration: audio.duration,
          volume: audio.volume,
          progress: audio.duration > 0 ? audio.currentTime / audio.duration : 0,
        },
        song.id
      );
    }
    events.emit("queue:next", {});
  };

  const playPrevious = () => {
    // Track partial play before switching songs
    const song = currentSong();
    const audio = audioElement();
    if (song && audio) {
      analytics.trackPlayPartial(
        song.media_blob_id,
        {
          isPlaying: isPlaying(),
          currentTime: audio.currentTime,
          duration: audio.duration,
          volume: audio.volume,
          progress: audio.duration > 0 ? audio.currentTime / audio.duration : 0,
        },
        song.id
      );
    }
    events.emit("queue:previous", {});
  };

  const toggleQueue = () => {
    storeActions.toggleQueue();
  };

  const changeVolume = (newVolume: number) => {
    storeActions.setVolume(newVolume);
  };

  const showVolumeControls = () => {
    const timeout = volumeHideTimeout();
    if (timeout) {
      clearTimeout(timeout);
      setVolumeHideTimeout(null);
    }
    setShowVolumeSlider(true);
  };

  const hideVolumeControls = () => {
    const timeout = setTimeout(() => {
      setShowVolumeSlider(false);
      setVolumeHideTimeout(null);
    }, 300);
    setVolumeHideTimeout(timeout);
  };

  const seekTo = (percentage: number) => {
    const audio = audioElement();
    if (!audio || !duration()) return;

    const oldTime = audio.currentTime;
    const newTime = (percentage / 100) * duration();

    // Track seek event
    const song = currentSong();
    if (song) {
      analytics.trackSeek(song.media_blob_id, oldTime, newTime, song.id);
    }

    audio.currentTime = newTime;
    storeActions.setCurrentTime(newTime);
  };

  const seekToTime = (time: number) => {
    const audio = audioElement();
    if (!audio) return;

    const oldTime = audio.currentTime;

    // Track seek event
    const song = currentSong();
    if (song) {
      analytics.trackSeek(song.media_blob_id, oldTime, time, song.id);
    }

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
      // Add analytics progress tracking
      const song = currentSong();
      if (song) {
        analytics.trackProgress(
          song.media_blob_id,
          audio.currentTime,
          audio.duration
        );
      }
    });

    audio.addEventListener("ended", () => {
      storeActions.setPlayerState({ isPlaying: false });
      // Track completion before moving to next song
      const song = currentSong();
      if (song) {
        analytics.trackPlayComplete(
          song.media_blob_id,
          {
            isPlaying: false,
            currentTime: audio.currentTime,
            duration: audio.duration,
            volume: audio.volume,
            progress:
              audio.duration > 0 ? audio.currentTime / audio.duration : 0,
          },
          song.id
        );
      }
      playNext(); // Auto-play next song
    });

    audio.addEventListener("playing", () => {
      // set up media session when audio starts playing
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", () => {
          storeActions.setPlayerState({ isPlaying: true });
        });

        navigator.mediaSession.setActionHandler("pause", () => {
          storeActions.setPlayerState({ isPlaying: false });
        });

        navigator.mediaSession.setActionHandler("previoustrack", () => {
          playPrevious();
        });

        navigator.mediaSession.setActionHandler("nexttrack", () => {
          playNext();
        });

        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (details.seekTime) {
            seekToTime(details.seekTime);
          }
        });

        // explicitly disable seek handlers to prioritize track navigation on ios
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);

        navigator.mediaSession.playbackState = "playing";
      }
    });

    // set initial paused state
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "paused";
    }

    return () => {
      audio.pause();
      audio.src = "";

      // cleanup media session
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
      }
    };
  });

  // Watch for current song changes and load audio (ONLY track song changes)
  createEffect(() => {
    const song = currentSong();
    const audio = audioElement();

    if (song && audio) {
      // Only proceed if this is actually a different song
      if (lastLoadedSongId() === song.id) {
        return;
      }
      setLastLoadedSongId(song.id);

      audio.pause(); // Stop any currently playing audio
      audio.currentTime = 0; // Reset to beginning for new songs only
      audio.src = `${apiClient.getBaseUrl()}/api/blobs/${song.media_blob_id}`;

      // Set volume without tracking it (use untrack to prevent reactivity)
      const currentVol = untrack(() => volume());
      audio.volume = currentVol;

      // Wait for the audio to load before playing (only for new songs)
      const shouldPlay = untrack(() => isPlaying());
      if (shouldPlay) {
        audio.addEventListener(
          "canplay",
          () => {
            audio
              .play()
              .then(() => {
                // Track play start when audio actually starts
                analytics.trackPlayStart(
                  song.media_blob_id,
                  {
                    isPlaying: true,
                    currentTime: audio.currentTime,
                    duration: audio.duration,
                    volume: audio.volume,
                    progress: 0,
                  },
                  song.id
                );
              })
              .catch((err) => {
                console.error("failed to play audio:", err);
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

    // Update page title and media session metadata
    updatePageTitle(song, playing);
    updateMediaSession(song, playing);

    // Only handle play/pause if audio is already loaded for this song
    if (audio.src && audio.src.includes(song.media_blob_id)) {
      if (playing && audio.paused) {
        // Resume from current position, don't restart
        audio
          .play()
          .then(() => {
            // Track play start when resuming
            analytics.trackPlayStart(
              song.media_blob_id,
              {
                isPlaying: true,
                currentTime: audio.currentTime,
                duration: audio.duration,
                volume: audio.volume,
                progress:
                  audio.duration > 0 ? audio.currentTime / audio.duration : 0,
              },
              song.id
            );
          })
          .catch((err) => {
            console.error("failed to play audio:", err);
            storeActions.setPlayerState({ isPlaying: false });
          });
      } else if (!playing && !audio.paused) {
        // Track partial play when pausing
        analytics.trackPlayPartial(
          song.media_blob_id,
          {
            isPlaying: false,
            currentTime: audio.currentTime,
            duration: audio.duration,
            volume: audio.volume,
            progress:
              audio.duration > 0 ? audio.currentTime / audio.duration : 0,
          },
          song.id
        );
        audio.pause();
      }
    }
  });

  // Watch for volume changes (separate from song loading)
  createEffect(() => {
    const vol = volume();
    const audio = audioElement();
    if (audio && audio.src) {
      // Only update volume if audio is already loaded
      audio.volume = vol;
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    const audio = audioElement();
    if (audio) {
      audio.pause();
      audio.src = "";
    }

    // Clear volume timeout
    const timeout = volumeHideTimeout();
    if (timeout) {
      clearTimeout(timeout);
      setVolumeHideTimeout(null);
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
      <div class="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-xl p-4 z-50 border-t border-magenta-800/30">
        {/* Desktop Layout */}
        <div class="hidden md:flex items-center gap-6">
          {/* Song Info - Expanded */}
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <div class="w-12 h-12 flex-shrink-0">
              <Show
                when={getCurrentSong()?.thumbnail_blob_id}
                fallback={
                  <div class="w-12 h-12 bg-gradient-to-br from-magenta-800 to-magenta-900 rounded flex items-center justify-center text-magenta-400">
                    <MusicIcon />
                  </div>
                }
              >
                <img
                  src={`${apiClient.getBaseUrl()}/api/blobs/${getCurrentSong()?.thumbnail_blob_id}`}
                  alt={getCurrentSong()?.title}
                  class="w-12 h-12 rounded object-cover"
                />
              </Show>
            </div>
            <div class="flex-shrink-0">
              <SongFavoriteHeart
                song={getCurrentSong()}
                size="md"
                class="opacity-80 hover:opacity-100"
              />
            </div>
            {/*<div class="flex-shrink-0">
              <SongStarRating
                song={getCurrentSong()}
                size="sm"
                class="opacity-80 hover:opacity-100"
              />
            </div>*/}
            <div class="flex-1 min-w-0">
              <h4 class="text-white font-medium text-base truncate m-0">
                {getCurrentSong()?.title}
              </h4>
              <p class="text-gray-300 font-light text-sm truncate m-0">
                {getCurrentSong()?.artist}
              </p>
            </div>
          </div>

          {/* Player Controls - Fixed Right */}
          <div class="flex items-center gap-3 flex-shrink-0">
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
          </div>

          {/* Progress Bar - Fixed Width */}
          <div class="flex items-center gap-3 w-80 flex-shrink-0">
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

          {/* Volume Control - Fixed Right */}
          <div
            class="relative flex items-center flex-shrink-0"
            onMouseEnter={showVolumeControls}
            onMouseLeave={hideVolumeControls}
          >
            <button
              class="p-2 rounded-full hover:bg-magenta-600/30 transition-colors"
              onClick={() => setShowVolumeSlider(!showVolumeSlider())}
              title={`Volume: ${Math.round(volume() * 100)}%`}
            >
              <VolumeIcon className="text-magenta-300 hover:text-white transition-colors" />
            </button>

            <Show when={showVolumeSlider()}>
              <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-xl border border-magenta-800/30 rounded-lg p-3 w-16 shadow-lg">
                <div class="flex flex-col items-center gap-3 h-32">
                  <span class="text-xs text-magenta-300 font-medium">
                    {Math.round(volume() * 100)}%
                  </span>
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
                    class="flex-1 w-1.5 bg-magenta-800/50 border-none rounded-full outline-none appearance-none cursor-pointer hover:w-2 transition-all"
                    style={{
                      background: `linear-gradient(to top, rgb(217 70 239) 0%, rgb(217 70 239) ${volume() * 100}%, rgba(139, 69, 19, 0.5) ${volume() * 100}%, rgba(139, 69, 19, 0.5) 100%)`,
                      "writing-mode": "bt-lr" as any,
                      "-webkit-appearance": "slider-vertical",
                    }}
                  />
                </div>
                {/* Tooltip arrow */}
                <div class="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-magenta-800/30"></div>
              </div>
            </Show>
          </div>

          {/* Queue Toggle - Last Item */}
          <div class="flex items-center flex-shrink-0">
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
        </div>

        {/* Mobile Layout */}
        <div class="md:hidden">
          {/* Top Row: Song Info + Controls */}
          <div class="flex items-center gap-4 mb-3">
            {/* Song Info */}
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <div class="w-10 h-10 flex-shrink-0">
                <Show
                  when={getCurrentSong()?.thumbnail_blob_id}
                  fallback={
                    <div class="w-10 h-10 bg-gradient-to-br from-magenta-800 to-magenta-900 rounded flex items-center justify-center text-magenta-400">
                      <MusicIcon />
                    </div>
                  }
                >
                  <img
                    src={`${apiClient.getBaseUrl()}/api/blobs/${getCurrentSong()?.thumbnail_blob_id}`}
                    alt={getCurrentSong()?.title}
                    class="w-10 h-10 rounded object-cover"
                  />
                </Show>
              </div>
              <div class="flex-shrink-0">
                <SongFavoriteHeart
                  song={getCurrentSong()}
                  size="sm"
                  class="opacity-80 hover:opacity-100"
                />
              </div>
              {/*<div class="flex-shrink-0">
                <SongStarRating
                  song={getCurrentSong()}
                  size="sm"
                  class="opacity-80 hover:opacity-100"
                />
              </div>*/}
              <div class="flex-1 min-w-0">
                <h4 class="text-white font-medium text-sm truncate m-0">
                  {getCurrentSong()?.title}
                </h4>
                <p class="text-gray-300 font-light text-xs truncate m-0">
                  {getCurrentSong()?.artist || "Unknown Artist"}
                </p>
              </div>
            </div>

            {/* Controls */}
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                class="w-8 h-8 rounded-full bg-magenta-950/50 text-magenta-300 border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-magenta-600/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={playPrevious}
                disabled={!canGoPrevious()}
                title="Previous"
              >
                <PrevIcon />
              </button>
              <button
                class="w-10 h-10 rounded-full bg-magenta-600 hover:bg-magenta-500 text-black border-none cursor-pointer transition-all duration-300 flex items-center justify-center"
                onClick={togglePlayback}
                title={`${isPlaying() ? "Pause" : "Play"}`}
              >
                {isPlaying() ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                class="w-8 h-8 rounded-full bg-magenta-950/50 text-magenta-300 border-none cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-magenta-600/30 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={playNext}
                disabled={!canGoNext()}
                title="Next"
              >
                <NextIcon />
              </button>

              {/* Volume Control */}
              <div
                class="relative flex items-center"
                onMouseEnter={showVolumeControls}
                onMouseLeave={hideVolumeControls}
              >
                <button
                  class="p-1.5 rounded-full hover:bg-magenta-600/30 transition-colors"
                  onClick={() => setShowVolumeSlider(!showVolumeSlider())}
                  title={`Volume: ${Math.round(volume() * 100)}%`}
                >
                  <VolumeIcon className="text-magenta-300 hover:text-white transition-colors w-4 h-4" />
                </button>

                <Show when={showVolumeSlider()}>
                  <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-xl border border-magenta-800/30 rounded-lg p-3 w-16 shadow-lg">
                    <div class="flex flex-col items-center gap-3 h-32">
                      <span class="text-xs text-magenta-300 font-medium">
                        {Math.round(volume() * 100)}%
                      </span>
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
                        class="flex-1 w-1.5 bg-magenta-800/50 border-none rounded-full outline-none appearance-none cursor-pointer hover:w-2 transition-all"
                        style={{
                          background: `linear-gradient(to top, rgb(217 70 239) 0%, rgb(217 70 239) ${volume() * 100}%, rgba(139, 69, 19, 0.5) ${volume() * 100}%, rgba(139, 69, 19, 0.5) 100%)`,
                          "writing-mode": "bt-lr" as any,
                          "-webkit-appearance": "slider-vertical",
                        }}
                      />
                    </div>
                    {/* Tooltip arrow */}
                    <div class="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-magenta-800/30"></div>
                  </div>
                </Show>
              </div>

              {/* Queue Toggle */}
              <button
                class={`w-8 h-8 rounded-full border-none cursor-pointer transition-all duration-300 flex items-center justify-center relative ${
                  queueOpen()
                    ? "bg-magenta-600 text-black hover:bg-magenta-500"
                    : "bg-magenta-950/50 text-magenta-300 hover:bg-magenta-600/30 hover:text-white"
                }`}
                onClick={toggleQueue}
                title={`${queueOpen() ? "Hide" : "Show"} Queue`}
              >
                <QueueIcon />
                {queueLength() > 0 && (
                  <span class="absolute -top-1 -right-1 bg-magenta-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-medium text-xs">
                    {queueLength()}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Bottom Row: Progress Bar */}
          <div class="flex items-center gap-3">
            <span
              class="text-xs text-magenta-300 font-light min-w-8"
              title="Current time"
            >
              {formatTime(currentTime())}
            </span>
            <div
              class="flex-1 h-1.5 bg-magenta-800/50 rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:h-2"
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
              class="text-xs text-magenta-300 font-light min-w-8"
              title="Total duration"
            >
              {formatTime(duration())}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};
