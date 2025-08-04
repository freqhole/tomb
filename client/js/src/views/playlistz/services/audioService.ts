// Audio Service with Functional Approach
// Uses SolidJS-style signals for reactive state management

import { createSignal } from "solid-js";
import type { Song, Playlist, AudioState } from "../types/playlist.js";
import { getAllSongs, loadSongAudioData } from "./indexedDBService.js";

// Audio state signals
const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
const [currentPlaylist, setCurrentPlaylist] = createSignal<Playlist | null>(
  null
);
const [playlistQueue, setPlaylistQueue] = createSignal<Song[]>([]);
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [currentIndex, setCurrentIndex] = createSignal(-1);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);
const [repeatMode, setRepeatMode] = createSignal<"none" | "one" | "all">(
  "none"
);
const [isShuffled, setIsShuffled] = createSignal(false);

// Single audio element for the entire app
let audioElement: HTMLAudioElement | null = null;

// Initialize audio element
function initializeAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;

  audioElement = new Audio();
  audioElement.volume = volume();
  audioElement.preload = "metadata";

  // Event listeners
  audioElement.addEventListener("loadstart", () => setIsLoading(true));
  audioElement.addEventListener("canplay", () => setIsLoading(false));
  audioElement.addEventListener("loadedmetadata", () => {
    setDuration(audioElement?.duration || 0);
  });

  audioElement.addEventListener("timeupdate", () => {
    setCurrentTime(audioElement?.currentTime || 0);
  });

  audioElement.addEventListener("play", () => {
    setIsPlaying(true);
    updateMediaSession();
  });
  audioElement.addEventListener("pause", () => {
    setIsPlaying(false);
    updateMediaSession();
  });
  audioElement.addEventListener("ended", () => {
    setIsPlaying(false);
    handleSongEnded();
  });

  audioElement.addEventListener("error", (e) => {
    console.error("Audio error:", e);
    setIsPlaying(false);
    setIsLoading(false);
    updatePageTitle();
  });

  return audioElement;
}

// Create blob URL from File
function createAudioURL(file: File): string {
  return URL.createObjectURL(file);
}

// Clean up blob URL
function releaseAudioURL(url: string): void {
  URL.revokeObjectURL(url);
}

// Update page title with currently playing song
function updatePageTitle(): void {
  const song = currentSong();

  if (song) {
    document.title = `${song.title} - ${song.artist || "Unknown Artist"} | PLAYLISTZ`;
  } else {
    document.title = "P L A Y L I S T Z";
  }
}

// Update Media Session API for OS integration
function updateMediaSession(): void {
  if (!("mediaSession" in navigator)) return;

  const song = currentSong();
  const playlist = currentPlaylist();

  if (song) {
    // Set metadata
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || "Unknown Artist",
      album: song.album || playlist?.title || "Unknown Album",
      artwork: getMediaSessionArtwork(song, playlist),
    });

    // Set playback state
    navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";

    // Set action handlers
    navigator.mediaSession.setActionHandler("play", () => {
      togglePlayback();
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      togglePlayback();
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      playPrevious();
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      playNext();
    });

    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        seek(details.seekTime);
      }
    });

    // Update position state
    const duration = audioState.duration();
    const currentTime = audioState.currentTime();

    if (duration > 0) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: currentTime,
      });
    }
  } else {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  }

  updatePageTitle();
}

// Get artwork for Media Session
function getMediaSessionArtwork(song: any, playlist: any): MediaImage[] {
  const artwork: MediaImage[] = [];

  // Try song image first
  if (song.imageData && song.imageType) {
    const blob = new Blob([song.imageData], { type: song.imageType });
    const url = URL.createObjectURL(blob);
    artwork.push({
      src: url,
      sizes: "300x300",
      type: song.imageType,
    });
  }
  // Fallback to playlist image
  else if (playlist?.imageData && playlist?.imageType) {
    const blob = new Blob([playlist.imageData], { type: playlist.imageType });
    const url = URL.createObjectURL(blob);
    artwork.push({
      src: url,
      sizes: "300x300",
      type: playlist.imageType,
    });
  }

  return artwork;
}

// Load playlist into queue
export async function loadPlaylistQueue(playlist: Playlist): Promise<void> {
  try {
    const allSongs = await getAllSongs();
    const playlistSongs = allSongs
      .filter((song) => playlist.songIds.includes(song.id))
      .sort(
        (a, b) =>
          playlist.songIds.indexOf(a.id) - playlist.songIds.indexOf(b.id)
      );

    setPlaylistQueue(playlistSongs);
    setCurrentPlaylist(playlist);
    setCurrentIndex(-1); // No song selected yet
  } catch (error) {
    console.error("Error loading playlist queue:", error);
    throw error;
  }
}

// Refresh playlist queue while maintaining current song position
export async function refreshPlaylistQueue(playlist: Playlist): Promise<void> {
  try {
    const currentSong = audioState.currentSong();
    const allSongs = await getAllSongs();
    const playlistSongs = allSongs
      .filter((song) => playlist.songIds.includes(song.id))
      .sort(
        (a, b) =>
          playlist.songIds.indexOf(a.id) - playlist.songIds.indexOf(b.id)
      );

    setPlaylistQueue(playlistSongs);
    setCurrentPlaylist(playlist);

    // Update current index to match new position of currently playing song
    if (currentSong) {
      const newIndex = playlistSongs.findIndex(
        (song) => song.id === currentSong.id
      );
      setCurrentIndex(newIndex >= 0 ? newIndex : -1);
    }
  } catch (error) {
    console.error("Error refreshing playlist queue:", error);
    throw error;
  }
}

// Get the next song in queue
function getNextSong(): Song | null {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  if (queue.length === 0) return null;

  const repeat = repeatMode();

  if (repeat === "one") {
    // Repeat current song
    return currentIdx >= 0 ? queue[currentIdx] || null : null;
  }

  const nextIdx = currentIdx + 1;

  if (nextIdx < queue.length) {
    return queue[nextIdx] || null;
  }

  if (repeat === "all") {
    // Loop back to first song
    return queue[0] || null;
  }

  // No repeat, end of queue
  return null;
}

// Get the previous song in queue
function getPreviousSong(): Song | null {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  if (queue.length === 0 || currentIdx <= 0) return null;

  return queue[currentIdx - 1] || null;
}

// Handle song ended - auto-advance logic
async function handleSongEnded(): Promise<void> {
  const nextSong = getNextSong();

  if (nextSong) {
    await playNext();
  } else {
    // Stay on last song but stop playing
    setIsPlaying(false);
    updateMediaSession();
  }
}

// Play a specific song
export async function playSong(song: Song, playlist?: Playlist): Promise<void> {
  const audio = initializeAudio();

  try {
    // Clean up previous URL if exists
    if (audio.src && audio.src.startsWith("blob:")) {
      releaseAudioURL(audio.src);
    }

    setIsLoading(true);
    setCurrentSong(song);

    if (playlist) {
      // Only reload queue if it's a different playlist or queue is empty
      const currentPl = currentPlaylist();
      if (
        !currentPl ||
        currentPl.id !== playlist.id ||
        playlistQueue().length === 0
      ) {
        await loadPlaylistQueue(playlist);
      }
      const queue = playlistQueue();
      const index = queue.findIndex((queueSong) => queueSong.id === song.id);
      setCurrentIndex(index >= 0 ? index : 0);
    }

    // Try to get audio URL in order of preference:
    // 1. Existing blobUrl from song
    // 2. Create from file if available
    // 3. Load from IndexedDB on-demand
    let audioURL = song.blobUrl;

    if (!audioURL && song.file) {
      audioURL = createAudioURL(song.file);
    }

    if (!audioURL) {
      // Check for standalone mode with relative file path
      if ((window as any).STANDALONE_MODE && (song as any).standaloneFilePath) {
        audioURL = (song as any).standaloneFilePath;
        console.log("🎵 Using standalone file path:", audioURL);

        // Test if file is accessible
        try {
          if (!audioURL) {
            throw new Error("Audio URL is undefined");
          }
          const testResponse = await fetch(audioURL);
          console.log(
            "🎵 File accessibility test:",
            testResponse.status,
            testResponse.statusText
          );
          if (!testResponse.ok) {
            console.error("❌ File not accessible:", audioURL);
          }
        } catch (error) {
          console.error("❌ Error testing file access:", error);
        }
      } else {
        // Load audio data on-demand from IndexedDB
        const loadedURL = await loadSongAudioData(song.id);
        if (loadedURL) {
          audioURL = loadedURL;
        }
      }
    }

    if (!audioURL) {
      throw new Error("No audio source available for song");
    }

    console.log("🎵 Setting audio.src to:", audioURL);
    audio.src = audioURL;

    // Add error event listener to catch loading issues
    audio.addEventListener(
      "error",
      (e) => {
        console.error("❌ Audio loading error:", e);
        console.error("❌ Audio error details:", audio.error);
      },
      { once: true }
    );

    await audio.play();
    updateMediaSession();
  } catch (error) {
    console.error("Error playing song:", error);
    setIsLoading(false);
    updatePageTitle();
    throw error;
  }
}

// Play entire playlist starting from specific index
export async function playPlaylist(
  playlist: Playlist,
  startIndex = 0
): Promise<void> {
  await loadPlaylistQueue(playlist);

  const queue = playlistQueue();
  if (!queue.length || startIndex >= queue.length || startIndex < 0) return;

  const song = queue[startIndex];
  if (song) {
    setCurrentIndex(startIndex);
    await playSong(song, playlist);
  }
}

// Play next song in playlist
export async function playNext(): Promise<void> {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  if (queue.length === 0) {
    return;
  }

  const repeat = repeatMode();
  let nextIndex: number;

  if (repeat === "one") {
    // Repeat current song
    nextIndex = currentIdx;
  } else if (currentIdx + 1 < queue.length) {
    // Normal next song
    nextIndex = currentIdx + 1;
  } else if (repeat === "all") {
    // Loop back to first song
    nextIndex = 0;
  } else {
    // End of queue, no repeat
    return;
  }

  const nextSong = queue[nextIndex];
  if (nextSong) {
    setCurrentIndex(nextIndex);
    await playSong(nextSong, currentPlaylist() || undefined);
  }
}

// Play previous song in playlist
export async function playPrevious(): Promise<void> {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  if (queue.length === 0 || currentIdx <= 0) {
    return;
  }

  const prevIndex = currentIdx - 1;
  const prevSong = queue[prevIndex];

  if (prevSong) {
    setCurrentIndex(prevIndex);
    await playSong(prevSong, currentPlaylist() || undefined);
  }
}

// Toggle play/pause
export async function togglePlayback(): Promise<void> {
  const audio = audioElement;
  if (!audio) {
    return;
  }

  try {
    const currentlyPlaying = isPlaying();

    if (currentlyPlaying) {
      audio.pause();
    } else {
      await audio.play();
    }
  } catch (error) {
    console.error("Error toggling playback:", error);
  }
}

// Pause playback
export function pause(): void {
  const audio = audioElement;
  if (audio && !audio.paused) {
    audio.pause();
  }
}

// Stop playback and reset
export function stop(): void {
  const audio = audioElement;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    if (audio.src && audio.src.startsWith("blob:")) {
      releaseAudioURL(audio.src);
    }
    audio.src = "";
  }

  setCurrentSong(null);
  setCurrentPlaylist(null);
  setIsPlaying(false);
  setCurrentTime(0);
  setDuration(0);
  setCurrentIndex(0);
  updatePageTitle();
}

// Seek to specific time
export function seek(time: number): void {
  const audio = audioElement;
  if (audio && !isNaN(audio.duration)) {
    audio.currentTime = Math.max(0, Math.min(time, audio.duration));
  }
}

// Set volume (0 to 1)
export function setAudioVolume(newVolume: number): void {
  const clampedVolume = Math.max(0, Math.min(1, newVolume));
  setVolume(clampedVolume);

  const audio = audioElement;
  if (audio) {
    audio.volume = clampedVolume;
  }
}

// Set repeat mode
export function setRepeatModeValue(mode: "none" | "one" | "all"): void {
  setRepeatMode(mode);
}

// Toggle repeat mode
export function toggleRepeatMode(): "none" | "one" | "all" {
  const current = repeatMode();
  const modes: ("none" | "one" | "all")[] = ["none", "one", "all"];
  const nextIndex = (modes.indexOf(current) + 1) % modes.length;
  const nextMode = modes[nextIndex] as "none" | "one" | "all";
  setRepeatModeValue(nextMode);
  return nextMode;
}

// Get queue info
export function getQueueInfo() {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  return {
    length: queue.length,
    currentIndex: currentIdx,
    hasNext: getNextSong() !== null,
    hasPrevious: getPreviousSong() !== null,
    currentSong: currentIdx >= 0 ? queue[currentIdx] : null,
    nextSong: getNextSong(),
    previousSong: getPreviousSong(),
  };
}

// Jump to specific song in queue
export async function playQueueIndex(index: number): Promise<void> {
  const queue = playlistQueue();

  if (index < 0 || index >= queue.length) {
    return;
  }

  const song = queue[index];
  if (song) {
    setCurrentIndex(index);
    await playSong(song);
  }
}

// Get current audio state
export function getAudioState(): AudioState {
  return {
    currentSong: currentSong(),
    currentPlaylist: currentPlaylist(),
    isPlaying: isPlaying(),
    currentTime: currentTime(),
    duration: duration(),
    volume: volume(),
    currentIndex: currentIndex(),
    queue: playlistQueue(),
    repeatMode: repeatMode(),
    isShuffled: isShuffled(),
    isLoading: isLoading(),
  };
}

// Format time for display
export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00";

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Export state getters for components to use
export const audioState = {
  currentSong,
  currentPlaylist,
  playlistQueue,
  isPlaying,
  currentTime,
  duration,
  volume,
  currentIndex,
  isLoading,
  repeatMode,
  isShuffled,
};

// Cleanup function
export function cleanup(): void {
  stop();

  const audio = audioElement;
  if (audio) {
    // Remove all event listeners
    audio.removeEventListener("loadstart", () => {});
    audio.removeEventListener("canplay", () => {});
    audio.removeEventListener("loadedmetadata", () => {});
    audio.removeEventListener("timeupdate", () => {});
    audio.removeEventListener("play", () => {});
    audio.removeEventListener("pause", () => {});
    audio.removeEventListener("ended", () => {});
    audio.removeEventListener("error", () => {});
  }

  audioElement = null;

  // Clear queue state
  setPlaylistQueue([]);
  setCurrentIndex(-1);
  setRepeatMode("none");
  setIsShuffled(false);
}

// Helper to check if audio is supported
export function isAudioSupported(file: File): boolean {
  return file.type.startsWith("audio/");
}

// Helper to get supported audio formats
export function getSupportedFormats(): string[] {
  const audio = document.createElement("audio");
  const formats = [
    "audio/mpeg", // MP3
    "audio/wav", // WAV
    "audio/ogg", // OGG
    "audio/aac", // AAC
    "audio/mp4", // M4A
    "audio/flac", // FLAC
    "audio/aiff", // AIFF
    "audio/x-aiff", // AIF
  ];

  return formats.filter((format) => audio.canPlayType(format) !== "");
}
