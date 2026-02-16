// audio player service for music playback
import { createSignal } from "solid-js";
import {
  appState,
  setCurrentSong,
} from "../../../app/services/storage/db";
import { getDataSource } from "../../data";
import { preCacheNextSongs } from "../cache/blobCache";
import {
  canGoNext,
  canGoPrevious,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "./queueState";
import { cleanupAudioURL, getAudioURL, isPlayingDirectURL, trySwapToCachedURL } from "../storage/audioAccess";
import type { Song } from "../storage/types";

// player state signals
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);

// track if we've pre-cached the next song
let hasPreCachedNext = false;

// audio element (singleton)
let audioElement: HTMLAudioElement | null = null;

// current song id (for cleanup)
let currentSongId: string | null = null;

// pending swap listener cleanup (removed when song changes)
let pendingSwapCleanup: (() => void) | null = null;

// initialize audio element
function initAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;

  audioElement = new Audio();
  audioElement.volume = volume();

  // time update
  audioElement.addEventListener("timeupdate", () => {
    setCurrentTime(audioElement!.currentTime);
    handlePreCacheNext();
  });

  // duration loaded
  audioElement.addEventListener("loadedmetadata", () => {
    setDuration(audioElement!.duration);
    updateMediaSession();
  });

  // playback started
  audioElement.addEventListener("play", () => {
    setIsPlaying(true);
    updateMediaSession();
  });

  // playback paused
  audioElement.addEventListener("pause", () => {
    setIsPlaying(false);
    updateMediaSession();

    // try swapping direct URL to cached version while paused
    void trySwapCurrentSongToCached();
  });

  // network stall - audio is waiting for data
  // good opportunity to swap to cached version if available
  audioElement.addEventListener("waiting", () => {
    void trySwapCurrentSongToCached();
  });

  // seek completed - swap even if playing (brief pause-swap-resume)
  audioElement.addEventListener("seeked", () => {
    void trySwapCurrentSongToCached(true);
  });

  // song ended
  audioElement.addEventListener("ended", async () => {
    await handleSongEnded();
  });

  // error during playback - skip to next song
  audioElement.addEventListener("error", async (e) => {
    console.error("audio playback error:", e);
    const error = audioElement.error;
    if (error) {
      console.error(
        `media error code: ${error.code}, message: ${error.message}`,
      );
    }
    // skip to next song on error
    await handleSongEnded();
  });

  // loading states
  audioElement.addEventListener("waiting", () => {
    setIsLoading(true);
  });

  audioElement.addEventListener("canplay", () => {
    setIsLoading(false);
  });

  // setup media session handlers
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => {
      play();
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      pause();
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      playNext();
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      playPrevious();
    });

    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        seek(details.seekTime);
      }
    });
  }

  return audioElement;
}

// update media session metadata
async function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const {queue, current_sha256} = appState();
  if (!current_sha256) {
    navigator.mediaSession.metadata = null;
    return;
  }

  // check queue first to avoid fetching from wrong remote
  let song = queue.find((s) => s.sha256 === current_sha256);

  // fallback: fetch from current data source
  if (!song) {
    const dataSource = getDataSource();
    song = await dataSource.getSongById(current_sha256);
  }

  if (!song) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist_name,
    album: song.album_title,
    artwork: [],
  });

  // update playback state
  navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";

  // update position state
  if (duration() > 0) {
    navigator.mediaSession.setPositionState({
      duration: duration(),
      playbackRate: 1.0,
      position: currentTime(),
    });
  }
}

// pre-cache next songs when current song is >50% played (rolling 30-min cache)
function handlePreCacheNext() {
  if (hasPreCachedNext) return;
  if (!audioElement) return;

  const progress = audioElement.currentTime / audioElement.duration;
  if (progress < 0.5) return;

  const {queue, current_sha256} = appState();
  if (!current_sha256 || !queue.length) return;

  // pre-cache next ~30 minutes of songs
  console.log("pre-caching next songs (~30 min)");
  hasPreCachedNext = true;
  void preCacheNextSongs(current_sha256, queue, 30);
}

// swap from direct remote URL to cached blob URL while player is stopped
// only swaps when the player is NOT actively playing to avoid any audio interruption
// when forceWhilePlaying is true (e.g. seek), we pause briefly, swap, and resume
// triggered by: pause, waiting (network stall), seeked
async function trySwapCurrentSongToCached(forceWhilePlaying = false): Promise<void> {
  if (!audioElement) return;

  const wasPlaying = !audioElement.paused;
  if (wasPlaying && !forceWhilePlaying) return;

  const {current_sha256} = appState();
  if (!current_sha256) return;

  // only attempt if the song is currently using a direct URL
  if (!isPlayingDirectURL(current_sha256)) return;

  const cachedURL = await trySwapToCachedURL(current_sha256);
  if (!cachedURL) return;

  // double-check same song before swapping
  if (appState().current_sha256 !== current_sha256) return;

  // save current position before swapping src
  const savedTime = audioElement.currentTime;
  const swapSongId = current_sha256;

  // clean up any previous swap listener
  if (pendingSwapCleanup) {
    pendingSwapCleanup();
    pendingSwapCleanup = null;
  }

  // swap to cached blob URL (same-origin, no crossOrigin needed)
  if (wasPlaying) {
    audioElement.pause();
  }
  audioElement.crossOrigin = "";
  audioElement.src = cachedURL;

  // restore position once media is loadable, but only for the right song
  const restorePosition = () => {
    if (audioElement && currentSongId === swapSongId) {
      audioElement.currentTime = savedTime;
      if (wasPlaying) {
        void audioElement.play();
      }
    }
    audioElement?.removeEventListener("loadedmetadata", restorePosition);
    if (pendingSwapCleanup === cleanup) {
      pendingSwapCleanup = null;
    }
  };
  const cleanup = () => {
    audioElement?.removeEventListener("loadedmetadata", restorePosition);
  };
  pendingSwapCleanup = cleanup;
  audioElement.addEventListener("loadedmetadata", restorePosition);

  console.log(`swapped to cached URL at ${savedTime.toFixed(1)}s (player stopped)`);
}

// play a specific song
export async function playSong(songOrId: string | Song): Promise<void> {
  const audio = initAudio();
  setIsLoading(true);

  try {
    // get song - either use provided Song object or fetch by id
    let song: Song;
    if (typeof songOrId === "string") {
      const dataSource = getDataSource();
      const fetchedSong = await dataSource.getSongById(songOrId);
      if (!fetchedSong) {
        throw new Error(`song not found: ${songOrId}`);
      }
      song = fetchedSong;
    } else {
      song = songOrId;
    }

    // update app state first (before loading audio)
    // this ensures media session gets correct song when events fire
    await setCurrentSong(song.sha256);

    // cleanup previous audio url and any pending swap listener
    if (currentSongId) {
      cleanupAudioURL(currentSongId);
    }
    if (pendingSwapCleanup) {
      pendingSwapCleanup();
      pendingSwapCleanup = null;
    }

    // get audio url using abstraction
    const audioURL = await getAudioURL(song);
    currentSongId = song.sha256;

    // set crossOrigin for direct remote URLs (needed for cookie auth on cross-origin)
    // blob: and opfs-backed URLs are same-origin and don't need this
    if (audioURL.startsWith("http")) {
      audio.crossOrigin = "use-credentials";
    } else {
      audio.crossOrigin = "";
    }

    // load and play
    audio.src = audioURL;
    await audio.play();

    // reset pre-cache flag for new song
    hasPreCachedNext = false;

    // reset playback ended flag since we're playing now
    resetPlaybackEnded();

    setIsLoading(false);
  } catch (error) {
    console.error("failed to play song:", error);
    setIsLoading(false);
    // don't throw - let caller decide whether to skip to next
    throw error;
  }
}

// play/pause toggle
export async function togglePlayback(): Promise<void> {
  const audio = initAudio();

  if (isPlaying()) {
    pause();
  } else {
    try {
      setIsLoading(true);
      // if no song is playing, play first in queue
      const {queue, current_sha256} = appState();
      if (!current_sha256 && queue.length) {
        await playSong(queue[0]);
      } else if (current_sha256) {
        // if audio src is empty (page reload), reload the song
        if (!audio.src) {
          // check if song is in queue first (avoid remote fetch)
          const songInQueue = queue.find(
            (s) => s.sha256 === current_sha256,
          );
          if (songInQueue) {
            await playSong(songInQueue);
          } else {
            await playSong(current_sha256);
          }
        } else {
          await audio.play();
        }
      }
      setIsLoading(false);
    } catch (error) {
      console.error("failed to toggle playback:", error);
      setIsLoading(false);
    }
  }
}

// pause playback
export function pause(): void {
  const audio = initAudio();
  audio.pause();
}

// stop playback (pause and reset to beginning)
export function stop(): void {
  const audio = initAudio();
  audio.pause();
  audio.currentTime = 0;
  setIsPlaying(false);
  setCurrentTime(0);
}

// play
export async function play(): Promise<void> {
  const audio = initAudio();
  await audio.play();
}

// seek to position (in seconds)
export function seek(seconds: number): void {
  const audio = initAudio();
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || 0));
}

// set volume (0-1)
export function setPlayerVolume(vol: number): void {
  const clampedVolume = Math.max(0, Math.min(1, vol));
  setVolume(clampedVolume);

  const audio = initAudio();
  audio.volume = clampedVolume;
}

// play next song in queue (with retry logic for unplayable songs)
// if queue is empty/finished and autoplay is desired, this can be extended
export async function playNext(): Promise<void> {
  if (!canGoNext()) return;

  const {queue, current_sha256} = appState();
  const currentId = current_sha256;
  let currentIdx = currentId
    ? queue.findIndex((s) => s.sha256 === currentId)
    : -1;

  // try to play next songs until one works or we run out
  const maxAttempts = 5; // prevent infinite loop
  let attempts = 0;

  while (currentIdx < queue.length - 1 && attempts < maxAttempts) {
    const nextIdx = currentIdx + 1;
    attempts++;

    try {
      await playSong(queue[nextIdx]);
      return; // success!
    } catch (error) {
      console.warn(
        `failed to play song at index ${nextIdx}, trying next...`,
        error,
      );
      currentIdx = nextIdx; // move to next song
      // if this was the last song, stop trying
      if (nextIdx >= queue.length - 1) {
        console.error("reached end of queue, no playable songs found");
        markPlaybackEnded();
        return;
      }
    }
  }

  console.error("exceeded max attempts to find playable song");
}

// play previous song in queue
export async function playPrevious(): Promise<void> {
  if (!canGoPrevious()) return;

  const {queue, current_sha256} = appState();
  const currentId = current_sha256;
  const currentIdx = currentId
    ? queue.findIndex((s) => s.sha256 === currentId)
    : -1;
  const prevIdx = currentIdx - 1;

  await playSong(queue[prevIdx]);
}

// handle song ended (auto-advance to next)
async function handleSongEnded(): Promise<void> {
  // check if there's a next song before calling playNext
  if (!canGoNext()) {
    // queue has ended - set flag so we know to autoplay when new songs are added
    markPlaybackEnded();
    return;
  }

  // playNext has built-in retry logic
  await playNext();
}

// cleanup
export function cleanup(): void {
  if (audioElement) {
    audioElement.pause();
    audioElement.src = "";
  }

  if (currentSongId) {
    cleanupAudioURL(currentSongId);
    currentSongId = null;
  }
}

// re-export signals
export {
  currentTime,
  duration,
  isLoading,
  isPlaying,
  volume,
};
