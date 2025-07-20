// Audio Service with Functional Approach
// Uses SolidJS-style signals for reactive state management

import { createSignal } from 'solid-js';
import type { Song, Playlist, AudioState } from '../types/playlist.js';

// Audio state signals
const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
const [currentPlaylist, setCurrentPlaylist] = createSignal<Playlist | null>(null);
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [currentIndex, setCurrentIndex] = createSignal(0);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);

// Single audio element for the entire app
let audioElement: HTMLAudioElement | null = null;

// Initialize audio element
function initializeAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;

  audioElement = new Audio();
  audioElement.volume = volume();
  audioElement.preload = 'metadata';

  // Event listeners
  audioElement.addEventListener('loadstart', () => setIsLoading(true));
  audioElement.addEventListener('canplay', () => setIsLoading(false));
  audioElement.addEventListener('loadedmetadata', () => {
    setDuration(audioElement?.duration || 0);
  });

  audioElement.addEventListener('timeupdate', () => {
    setCurrentTime(audioElement?.currentTime || 0);
  });

  audioElement.addEventListener('play', () => setIsPlaying(true));
  audioElement.addEventListener('pause', () => setIsPlaying(false));
  audioElement.addEventListener('ended', () => {
    setIsPlaying(false);
    playNext();
  });

  audioElement.addEventListener('error', (e) => {
    console.error('Audio error:', e);
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

// Play a specific song
export async function playSong(song: Song, playlist?: Playlist): Promise<void> {
  const audio = initializeAudio();

  try {
    // Clean up previous URL if exists
    if (audio.src && audio.src.startsWith('blob:')) {
      releaseAudioURL(audio.src);
    }

    setIsLoading(true);
    setCurrentSong(song);

    if (playlist) {
      setCurrentPlaylist(playlist);
      const index = playlist.songIds.indexOf(song.id);
      setCurrentIndex(index >= 0 ? index : 0);
    }

    // Create blob URL from file
    const audioURL = createAudioURL(song.file);
    audio.src = audioURL;

    await audio.play();

  } catch (error) {
    console.error('Error playing song:', error);
    setIsLoading(false);
    throw error;
  }
}

// Play entire playlist starting from specific index
export async function playPlaylist(playlist: Playlist, songs: Song[], startIndex = 0): Promise<void> {
  if (!songs.length || startIndex >= songs.length) return;

  setCurrentPlaylist(playlist);
  setCurrentIndex(startIndex);

  const song = songs[startIndex];
  if (song) {
    await playSong(song, playlist);
  }
}

// Play next song in playlist
export async function playNext(): Promise<void> {
  const playlist = currentPlaylist();
  if (!playlist) return;

  const nextIndex = currentIndex() + 1;

  // Get songs for the playlist (this would need to be passed in or fetched)
  // For now, we'll emit an event that components can listen to
  window.dispatchEvent(new CustomEvent('audio:playNext', {
    detail: {
      playlistId: playlist.id,
      nextIndex
    }
  }));
}

// Play previous song in playlist
export async function playPrevious(): Promise<void> {
  const playlist = currentPlaylist();
  if (!playlist) return;

  const prevIndex = Math.max(0, currentIndex() - 1);

  window.dispatchEvent(new CustomEvent('audio:playPrevious', {
    detail: {
      playlistId: playlist.id,
      prevIndex
    }
  }));
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
    console.error('Error toggling playback:', error);
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
    if (audio.src && audio.src.startsWith('blob:')) {
      releaseAudioURL(audio.src);
    }
    audio.src = '';
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
  };
}

// Format time for display
export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '0:00';

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Export state getters for components to use
export const audioState = {
  currentSong,
  currentPlaylist,
  isPlaying,
  currentTime,
  duration,
  volume,
  currentIndex,
  isLoading,
};

// Cleanup function
export function cleanup(): void {
  stop();

  const audio = audioElement;
  if (audio) {
    // Remove all event listeners
    audio.removeEventListener('loadstart', () => {});
    audio.removeEventListener('canplay', () => {});
    audio.removeEventListener('loadedmetadata', () => {});
    audio.removeEventListener('timeupdate', () => {});
    audio.removeEventListener('play', () => {});
    audio.removeEventListener('pause', () => {});
    audio.removeEventListener('ended', () => {});
    audio.removeEventListener('error', () => {});
  }

  audioElement = null;
}

// Helper to check if audio is supported
export function isAudioSupported(file: File): boolean {
  return file.type.startsWith('audio/');
}

// Helper to get supported audio formats
export function getSupportedFormats(): string[] {
  const audio = document.createElement('audio');
  const formats = [
    'audio/mpeg',    // MP3
    'audio/wav',     // WAV
    'audio/ogg',     // OGG
    'audio/aac',     // AAC
    'audio/mp4',     // M4A
    'audio/flac',    // FLAC
    'audio/aiff',    // AIFF
    'audio/x-aiff',  // AIF
  ];

  return formats.filter(format => audio.canPlayType(format) !== '');
}
