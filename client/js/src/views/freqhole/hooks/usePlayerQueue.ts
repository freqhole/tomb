/* @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";

export interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration_seconds?: number;
  thumbnail_blob_id?: string;
  media_blob_id: string;
}

export interface QueueItem {
  song: Song;
  id: string;
}

export interface PlaylistSong {
  position: number;
  song: Song;
  added_at: string;
}

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  is_collaborative: boolean;
  song_count?: number;
  created_at: string;
}

export interface ArtistSummary {
  artist: string;
  song_count: number;
  album_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
}

export interface Album {
  album: string;
  artist: string;
  year?: number;
  track_count: number;
  disc_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
  album_thumbnail_id?: string;
}

export interface UsePlayerQueueOptions {
  initialVolume?: number;
  autoPlay?: boolean;
  autoNext?: boolean;
  apiBaseUrl?: string;
  onSongEnd?: () => void;
  onSongStart?: (song: Song) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onQueueChange?: (queue: QueueItem[]) => void;
}

export const usePlayerQueue = (options: UsePlayerQueueOptions = {}) => {
  const apiBaseUrl = options.apiBaseUrl || "http://localhost:8080";
  // Player state
  const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(options.initialVolume || 0.5);
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement | null>(
    null
  );
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Queue state
  const [playQueue, setPlayQueue] = createSignal<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);
  const [showQueue, setShowQueue] = createSignal(false);

  // Initialize audio element
  onMount(() => {
    const audio = new Audio();
    setAudioElement(audio);
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

      // Auto-play next song if enabled
      if (options.autoNext !== false) {
        playNext();
      }
    };

    const handleError = (e: Event) => {
      setIsLoading(false);
      setIsPlaying(false);
      setError("Failed to load audio");
      console.error("Audio error:", e);
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
      audio.pause();
      audio.src = "";
    });
  });

  // Format time helper
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Play a specific song
  const playSong = (song: Song, addToQueueIfEmpty = true) => {
    const audio = audioElement();
    if (!audio) return;

    setCurrentSong(song);
    setError(null);
    setIsLoading(true);

    audio.src = `${apiBaseUrl}/api/blobs/${song.media_blob_id}`;
    audio.volume = volume();

    audio
      .play()
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

    // Add to queue if empty
    if (addToQueueIfEmpty && playQueue().length === 0) {
      const queueItem: QueueItem = {
        song,
        id: `queue-${song.id}-${Date.now()}`,
      };
      setPlayQueue([queueItem]);
      setCurrentQueueIndex(0);
      options.onQueueChange?.([queueItem]);
    }
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

  // Change volume (0-1)
  const changeVolume = (newVolume: number) => {
    const audio = audioElement();
    if (!audio) return;

    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    audio.volume = clampedVolume;
    setVolume(clampedVolume);
  };

  // Seek to specific time in seconds
  const seekToTime = (seconds: number) => {
    const audio = audioElement();
    if (!audio || !duration()) return;

    const clampedTime = Math.max(0, Math.min(seconds, duration()));
    audio.currentTime = clampedTime;
    setCurrentTime(clampedTime);
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

  // Stop playback
  const stop = () => {
    const audio = audioElement();
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Play next song in queue
  const playNext = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex < queue.length - 1) {
      setCurrentQueueIndex(currentIndex + 1);
      const nextSong = queue[currentIndex + 1];
      if (nextSong) {
        playSong(nextSong.song, false);
      }
    }
  };

  // Play previous song in queue
  const playPrevious = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex > 0) {
      setCurrentQueueIndex(currentIndex - 1);
      const prevSong = queue[currentIndex - 1];
      if (prevSong) {
        playSong(prevSong.song, false);
      }
    }
  };

  // Move to next song in queue (without playing)
  const moveToNext = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex < queue.length - 1) {
      setCurrentQueueIndex(currentIndex + 1);
      return queue[currentIndex + 1];
    }
    return null;
  };

  // Move to previous song in queue (without playing)
  const moveToPrevious = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex > 0) {
      setCurrentQueueIndex(currentIndex - 1);
      return queue[currentIndex - 1];
    }
    return null;
  };

  // Add song to queue
  const addToQueue = (song: Song) => {
    const existingItem = playQueue().find((item) => item.song.id === song.id);
    if (existingItem) return;

    const queueItem: QueueItem = {
      song,
      id: `queue-${song.id}-${Date.now()}`,
    };
    const newQueue = [...playQueue(), queueItem];
    setPlayQueue(newQueue);
    options.onQueueChange?.(newQueue);
  };

  // Remove song from queue
  const removeFromQueue = (queueId: string) => {
    const newQueue = playQueue().filter((item) => item.id !== queueId);
    setPlayQueue(newQueue);
    options.onQueueChange?.(newQueue);
  };

  // Clear queue
  const clearQueue = () => {
    setPlayQueue([]);
    setCurrentQueueIndex(0);
    options.onQueueChange?.([]);
  };

  // Jump to specific queue index (with playing)
  const jumpToIndex = (index: number) => {
    const queue = playQueue();
    if (index >= 0 && index < queue.length) {
      setCurrentQueueIndex(index);
      const song = queue[index];
      if (song) {
        playSong(song.song, false);
      }
    }
  };

  // Jump to specific index in queue (without playing)
  const jumpToIndexSilent = (index: number) => {
    const queue = playQueue();
    if (index >= 0 && index < queue.length) {
      setCurrentQueueIndex(index);
      return queue[index];
    }
    return null;
  };

  // Set queue from playlist
  const setQueueFromPlaylist = (playlist: Playlist, songs: PlaylistSong[]) => {
    const newQueue: QueueItem[] = songs.map(
      (item: PlaylistSong, index: number) => ({
        song: item.song,
        id: `playlist-${playlist.id}-${index}`,
      })
    );
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    options.onQueueChange?.(newQueue);

    if (newQueue.length > 0 && newQueue[0]) {
      playSong(newQueue[0].song, false);
    }
  };

  // Add song to queue if empty (for single song play)
  const addToQueueIfEmpty = (song: Song) => {
    if (playQueue().length === 0) {
      const queueItem: QueueItem = {
        song,
        id: `queue-${song.id}-${Date.now()}`,
      };
      setPlayQueue([queueItem]);
      setCurrentQueueIndex(0);
      options.onQueueChange?.([queueItem]);
    }
  };

  // Set queue from artist songs
  const setQueueFromArtist = (artist: ArtistSummary, songs: Song[]) => {
    const newQueue: QueueItem[] = songs.map((song: Song, index: number) => ({
      song,
      id: `artist-${artist.artist}-${index}`,
    }));
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    options.onQueueChange?.(newQueue);

    if (newQueue.length > 0 && newQueue[0]) {
      playSong(newQueue[0].song, false);
    }
  };

  // Set queue from album songs
  const setQueueFromAlbum = (album: Album, songs: Song[]) => {
    const newQueue: QueueItem[] = songs.map((song: Song, index: number) => ({
      song,
      id: `album-${album.album}-${index}`,
    }));
    setPlayQueue(newQueue);
    setCurrentQueueIndex(0);
    options.onQueueChange?.(newQueue);

    if (newQueue.length > 0 && newQueue[0]) {
      playSong(newQueue[0].song, false);
    }
  };

  // Queue utilities
  const canGoNext = () => {
    return currentQueueIndex() < playQueue().length - 1;
  };

  const canGoPrevious = () => {
    return currentQueueIndex() > 0;
  };

  const getCurrentQueueItem = () => {
    const queue = playQueue();
    const index = currentQueueIndex();
    return queue[index] || null;
  };

  const toggleQueue = () => {
    setShowQueue(!showQueue());
  };

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
    // Player state
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isLoading,
    error,
    audioElement,

    // Queue state
    playQueue,
    currentQueueIndex,
    showQueue,

    // Player actions
    playSong,
    togglePlayback,
    seekTo,
    seekToTime,
    changeVolume,
    toggleMute,
    stop,
    playNext,
    playPrevious,

    // Queue actions
    addToQueue,
    removeFromQueue,
    clearQueue,
    jumpToIndex,
    jumpToIndexSilent,
    moveToNext,
    moveToPrevious,
    setQueueFromPlaylist,
    setQueueFromArtist,
    setQueueFromAlbum,
    addToQueueIfEmpty,
    toggleQueue,

    // Utilities
    formatTime,
    getProgress,
    isReady,
    canGoNext,
    canGoPrevious,
    getCurrentQueueItem,

    // Setters (for external control)
    setShowQueue,
    setCurrentQueueIndex,
    setVolume,
    setCurrentSong,
    setIsPlaying,
    setCurrentTime,
    setDuration,
  };
};
