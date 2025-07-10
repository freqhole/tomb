/* @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";
import { Song } from "./useQueue";

export interface UsePlayerOptions {
  volume?: number;
  onSongEnd?: () => void;
  onSongStart?: (song: Song) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onVolumeChange?: (volume: number) => void;
}

export const usePlayer = (options: UsePlayerOptions = {}) => {
  const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(options.volume || 0.5);
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Initialize audio element
  onMount(() => {
    const audio = new Audio();
    setAudioElement(audio);

    // Set initial volume
    audio.volume = volume();

    // Audio event listeners
    const handleLoadStart = () => {
      setIsLoading(true);
      setError(null);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
      setDuration(audio.duration || 0);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      options.onTimeUpdate?.(audio.currentTime, audio.duration || 0);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      options.onPlayStateChange?.(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
      options.onPlayStateChange?.(false);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      options.onSongEnd?.();
    };

    const handleError = (e: Event) => {
      setIsLoading(false);
      setIsPlaying(false);
      setError("Failed to load audio");
      console.error("Audio error:", e);
    };

    const handleVolumeChange = () => {
      setVolume(audio.volume);
      options.onVolumeChange?.(audio.volume);
    };

    // Attach event listeners
    audio.addEventListener("loadstart", handleLoadStart);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("volumechange", handleVolumeChange);

    // Cleanup
    onCleanup(() => {
      audio.removeEventListener("loadstart", handleLoadStart);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("volumechange", handleVolumeChange);
      audio.pause();
      audio.src = "";
    });
  });

  // Play a specific song
  const playSong = (song: Song) => {
    const audio = audioElement();
    if (!audio) return;

    setCurrentSong(song);
    setError(null);
    setIsLoading(true);

    audio.src = `http://localhost:8080/api/blobs/${song.media_blob_id}`;
    audio.volume = volume();

    audio.play()
      .then(() => {
        setIsPlaying(true);
        options.onSongStart?.(song);
      })
      .catch((err) => {
        setError("Failed to play song");
        setIsPlaying(false);
        setIsLoading(false);
        console.error("Play error:", err);
      });
  };

  // Toggle play/pause
  const togglePlayback = () => {
    const audio = audioElement();
    if (!audio) return;

    if (isPlaying()) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        setError("Failed to play");
        console.error("Play error:", err);
      });
    }
  };

  // Seek to a specific time (percentage 0-100)
  const seekTo = (percentage: number) => {
    const audio = audioElement();
    if (!audio || !duration()) return;

    const seekTime = (percentage / 100) * duration();
    audio.currentTime = seekTime;
    setCurrentTime(seekTime);
  };

  // Seek to specific time in seconds
  const seekToTime = (seconds: number) => {
    const audio = audioElement();
    if (!audio || !duration()) return;

    const clampedTime = Math.max(0, Math.min(seconds, duration()));
    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  };

  // Change volume (0-1)
  const changeVolume = (newVolume: number) => {
    const audio = audioElement();
    if (!audio) return;

    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    audio.volume = clampedVolume;
    setVolume(clampedVolume);
  };

  // Mute/unmute
  const toggleMute = () => {
    const audio = audioElement();
    if (!audio) return;

    if (audio.volume > 0) {
      audio.volume = 0;
    } else {
      audio.volume = volume();
    }
  };

  // Format time helper
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "0:00";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Stop playback
  const stop = () => {
    const audio = audioElement();
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Get current progress as percentage
  const getProgress = () => {
    const dur = duration();
    const cur = currentTime();
    if (dur <= 0) return 0;
    return (cur / dur) * 100;
  };

  // Check if audio is ready to play
  const isReady = () => {
    const audio = audioElement();
    return audio && audio.readyState >= 2; // HAVE_CURRENT_DATA
  };

  return {
    // State
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isLoading,
    error,
    audioElement,

    // Actions
    playSong,
    togglePlayback,
    seekTo,
    seekToTime,
    changeVolume,
    toggleMute,
    stop,

    // Utilities
    formatTime,
    getProgress,
    isReady,

    // Setters (for external control)
    setCurrentSong,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setVolume,
  };
};
