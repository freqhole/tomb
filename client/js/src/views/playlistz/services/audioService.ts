// Audio Service with Functional Approach
// Uses SolidJS-style signals for reactive state management

import { createSignal } from "solid-js";
import type { Song, Playlist, AudioState } from "../types/playlist.js";
import { getAllSongs } from "./indexedDBService.js";

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

  audioElement.addEventListener("play", () => setIsPlaying(true));
  audioElement.addEventListener("pause", () => setIsPlaying(false));
  audioElement.addEventListener("ended", () => {
    setIsPlaying(false);
    handleSongEnded();
  });

  audioElement.addEventListener("error", (e) => {
    console.error("Audio error:", e);
    setIsPlaying(false);
    setIsLoading(false);
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

// Load playlist into queue
export async function loadPlaylistQueue(playlist: Playlist): Promise<void> {
  try {
    console.log(`🎵 Loading playlist queue: ${playlist.title}`);

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

    console.log(`📝 Queue loaded with ${playlistSongs.length} songs`);
  } catch (error) {
    console.error("Error loading playlist queue:", error);
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
  console.log("🔚 Song ended, checking for auto-advance");

  const nextSong = getNextSong();

  if (nextSong) {
    console.log(`⏭️ Auto-advancing to: ${nextSong.title}`);
    await playNext();
  } else {
    console.log("🔚 Reached end of queue");
    // Stay on last song but stop playing
    setIsPlaying(false);
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
      await loadPlaylistQueue(playlist);
      const queue = playlistQueue();
      const index = queue.findIndex((queueSong) => queueSong.id === song.id);
      setCurrentIndex(index >= 0 ? index : 0);
    }

    // Use song's blobUrl if available, otherwise create from file
    let audioURL = song.blobUrl;
    if (!audioURL && song.file) {
      audioURL = createAudioURL(song.file);
    }

    if (!audioURL) {
      throw new Error("No audio source available for song");
    }

    audio.src = audioURL;
    await audio.play();
  } catch (error) {
    console.error("Error playing song:", error);
    setIsLoading(false);
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
    console.log("⏭️ No queue available for next song");
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
    console.log("⏭️ Reached end of queue");
    return;
  }

  const nextSong = queue[nextIndex];
  if (nextSong) {
    console.log(
      `⏭️ Playing next: ${nextSong.title} (${nextIndex + 1}/${queue.length})`
    );
    setCurrentIndex(nextIndex);
    await playSong(nextSong);
  }
}

// Play previous song in playlist
export async function playPrevious(): Promise<void> {
  const queue = playlistQueue();
  const currentIdx = currentIndex();

  if (queue.length === 0 || currentIdx <= 0) {
    console.log("⏮️ No previous song available");
    return;
  }

  const prevIndex = currentIdx - 1;
  const prevSong = queue[prevIndex];

  if (prevSong) {
    console.log(
      `⏮️ Playing previous: ${prevSong.title} (${prevIndex + 1}/${queue.length})`
    );
    setCurrentIndex(prevIndex);
    await playSong(prevSong);
  }
}

// Toggle play/pause
export async function togglePlayback(): Promise<void> {
  const audio = audioElement;
  if (!audio) return;

  try {
    if (isPlaying()) {
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
  console.log(`🔁 Repeat mode set to: ${mode}`);
}

// Toggle repeat mode
export function toggleRepeatMode(): "none" | "one" | "all" {
  const current = repeatMode();
  const modes: ("none" | "one" | "all")[] = ["none", "one", "all"];
  const nextIndex = (modes.indexOf(current) + 1) % modes.length;
  const nextMode = modes[nextIndex] as "none" | "one" | "all";
  setRepeatModeValue(nextMode);
  console.log(`🔁 Repeat mode toggled to: ${nextMode}`);
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
    console.log(`⚠️ Invalid queue index: ${index}`);
    return;
  }

  const song = queue[index];
  if (song) {
    console.log(
      `🎵 Playing queue song ${index + 1}/${queue.length}: ${song.title}`
    );
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
