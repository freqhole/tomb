// Audio Service with Functional Approach
// Uses SolidJS-style signals for reactive state management

import { createSignal } from "solid-js";
import type { Song, Playlist, AudioState } from "../types/playlist.js";
import { getAllSongs, loadSongAudioData } from "./indexedDBService.js";
import {
  loadStandaloneSongAudioData,
  songNeedsAudioData,
} from "./standaloneService.js";

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
const [loadingSongIds, setLoadingSongIds] = createSignal<Set<string>>(
  new Set()
);
const [selectedSongId, setSelectedSongId] = createSignal<string | null>(null);
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
  audioElement.addEventListener("loadstart", () => {
    setIsLoading(true);
    // Keep the loadingSongId from playSong function
  });
  audioElement.addEventListener("canplay", () => {
    setIsLoading(false);
    // Note: we don't clear loadingSongIds here as it's handled in playSong
  });
  audioElement.addEventListener("loadedmetadata", () => {
    const newDuration = audioElement?.duration || 0;
    setDuration(newDuration);
    setCurrentTime(0); // Ensure current time is reset
  });

  audioElement.addEventListener("timeupdate", () => {
    const newCurrentTime = audioElement?.currentTime || 0;
    setCurrentTime(newCurrentTime);
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
    // Clear all loading songs on audio error
    setLoadingSongIds(new Set());
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
async function updateMediaSession(): Promise<void> {
  if (!("mediaSession" in navigator)) return;

  const song = currentSong();
  const playlist = currentPlaylist();

  if (song) {
    // Get artwork first
    const artwork = await getMediaSessionArtwork(song, playlist);

    // Clear metadata first, then set it - sometimes helps with iOS Safari
    navigator.mediaSession.metadata = null;

    // Set metadata directly
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || "Unknown Artist",
      album: song.album || playlist?.title || "Unknown Album",
      artwork: artwork,
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

// Resize image if it's too large for iOS Safari MediaSession
async function resizeImageForMediaSession(
  imageData: ArrayBuffer,
  mimeType: string
): Promise<ArrayBuffer> {
  // If image is smaller than 500KB, use as-is
  if (imageData.byteLength < 500000) {
    return imageData;
  }

  return new Promise((resolve) => {
    const blob = new Blob([imageData], { type: mimeType });
    const img = new Image();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      // Resize to max 300x300 to keep file size reasonable
      const maxSize = 300;
      let { width, height } = img;

      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width *= ratio;
        height *= ratio;
      }

      canvas.width = width;
      canvas.height = height;

      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (resizedBlob) => {
            if (resizedBlob) {
              resizedBlob.arrayBuffer().then(resolve);
            } else {
              resolve(imageData); // Fallback to original
            }
          },
          mimeType,
          0.8
        );
      } else {
        resolve(imageData); // Fallback to original
      }
    };

    img.onerror = () => {
      resolve(imageData); // Fallback to original
    };

    img.src = URL.createObjectURL(blob);
  });
}

// Get artwork for Media Session
async function getMediaSessionArtwork(
  song: any,
  playlist: any
): Promise<MediaImage[]> {
  const artwork: MediaImage[] = [];

  // Try song image first (prefer thumbnail for MediaSession)
  const songImageData = song.thumbnailData || song.imageData;
  if (songImageData && song.imageType) {
    const resizedImageData = await resizeImageForMediaSession(
      songImageData,
      song.imageType
    );
    const blob = new Blob([resizedImageData], { type: song.imageType });
    const url = URL.createObjectURL(blob);
    // Add multiple sizes for iOS Safari compatibility
    artwork.push({
      src: url,
      sizes: "512x512",
      type: song.imageType,
    });
    artwork.push({
      src: url,
      sizes: "256x256",
      type: song.imageType,
    });
    artwork.push({
      src: url,
      sizes: "96x96",
      type: song.imageType,
    });
  }
  // Fallback to playlist image (prefer thumbnail for MediaSession)
  else {
    const playlistImageData = playlist?.thumbnailData || playlist?.imageData;
    if (playlistImageData && playlist?.imageType) {
      const resizedImageData = await resizeImageForMediaSession(
        playlistImageData,
        playlist.imageType
      );
      const blob = new Blob([resizedImageData], { type: playlist.imageType });
      const url = URL.createObjectURL(blob);
      // Add multiple sizes for iOS Safari compatibility
      artwork.push({
        src: url,
        sizes: "512x512",
        type: playlist.imageType,
      });
      artwork.push({
        src: url,
        sizes: "256x256",
        type: playlist.imageType,
      });
      artwork.push({
        src: url,
        sizes: "96x96",
        type: playlist.imageType,
      });
    } else {
      // No artwork available
    }
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
    // Add this song to loading set
    setLoadingSongIds((prev) => new Set([...prev, song.id]));

    // Clean up previous URL if exists
    if (audio.src && audio.src.startsWith("blob:")) {
      releaseAudioURL(audio.src);
    }

    // Reset time/duration immediately to prevent stale values
    setCurrentTime(0);
    setDuration(0);
    audio.currentTime = 0;

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
      // Check for standalone file path when using file:// protocol
      if (
        window.location.protocol === "file:" &&
        (song as any).standaloneFilePath
      ) {
        const filePath = (song as any).standaloneFilePath;
        audioURL = new URL(filePath, window.location.href).href;

        // Test if the file is accessible
        const testAudio = document.createElement("audio");
        testAudio.src = audioURL;
        testAudio.addEventListener("error", (e) => {
          console.error("❌ Audio file test failed:", e);
          console.error("❌ Audio error:", testAudio.error);
        });
        testAudio.load();
      } else {
        // First, always try to load from IndexedDB (cached data)
        let cachedURL = await loadSongAudioData(song.id);
        if (cachedURL) {
          audioURL = cachedURL;
        } else if ((song as any).standaloneFilePath) {
          // Song not cached yet, check if it needs loading in standalone mode
          const needsData = await songNeedsAudioData(song);
          if (needsData) {
            // Load and cache the song data
            const loadSuccess = await loadStandaloneSongAudioData(song.id);
            if (loadSuccess) {
              // Try to get the cached URL after loading
              cachedURL = await loadSongAudioData(song.id);
              if (cachedURL) {
                audioURL = cachedURL;
              }
            }
          }

          // If still no audioURL, use direct fetch as fallback
          if (!audioURL) {
            try {
              const response = await fetch((song as any).standaloneFilePath);
              if (response.ok) {
                const audioData = await response.arrayBuffer();
                const blob = new Blob([audioData], {
                  type: song.mimeType || "audio/mpeg",
                });
                audioURL = URL.createObjectURL(blob);
              }
            } catch (fetchError) {
              console.error("❌ Fallback fetch failed:", fetchError);
            }
          }
        }
      }
    }

    if (!audioURL) {
      throw new Error(
        `No audio source available for song: ${song.title}. Check that audio files are accessible.`
      );
    }

    // Only continue if this song is still the selected one
    if (selectedSongId() !== song.id) {
      // Song is loaded but user has moved on to a different song
      setLoadingSongIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(song.id);
        return newSet;
      });
      return;
    }

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

    // Remove song from loading set since it's now playing
    setLoadingSongIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(song.id);
      return newSet;
    });

    updateMediaSession();
  } catch (error) {
    console.error("Error playing song:", error);
    setIsLoading(false);
    setLoadingSongIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(song.id);
      return newSet;
    });
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
    setSelectedSongId(nextSong.id);
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
    setSelectedSongId(prevSong.id);
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
  loadingSongIds,
  selectedSongId,
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

// Helper to select a song to play (sets immediate UI feedback)
export function selectSong(songId: string): void {
  // Pause current audio immediately
  const audio = audioElement;
  if (audio) {
    audio.pause();
    setIsPlaying(false);
  }

  // Set this as the selected song
  setSelectedSongId(songId);
}
