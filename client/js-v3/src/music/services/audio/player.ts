// audio player service for music playback
import { createSignal } from "solid-js";
import {
  appState,
  setCurrentSong,
  setQueue,
} from "../../../app/services/storage/db";
import { getDataSource } from "../../data";
import { preCacheNextSongs } from "../cache/blobCache";
import { cleanupAudioURL, getAudioURL } from "../storage/audioAccess";
import type { Song } from "../storage/types";

// player state signals
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);

// track if we've pre-cached the next song
let hasPreCachedNext = false;

// computed signals for next/prev availability
const canGoNext = () => {
  const state = appState();
  if (!state?.queue.length) return false;
  const currentId = state.current_song_id;
  const currentIdx = currentId
    ? state.queue.findIndex((s) => s.song_id === currentId)
    : -1;
  return currentIdx >= 0 && currentIdx < state.queue.length - 1;
};

const canGoPrevious = () => {
  const state = appState();
  if (!state?.queue.length) return false;
  const currentId = state.current_song_id;
  const currentIdx = currentId
    ? state.queue.findIndex((s) => s.song_id === currentId)
    : -1;
  return currentIdx > 0;
};

// audio element (singleton)
let audioElement: HTMLAudioElement | null = null;

// current song id (for cleanup)
let currentSongId: string | null = null;

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

  const state = appState();
  if (!state?.current_song_id) {
    navigator.mediaSession.metadata = null;
    return;
  }

  // check queue first to avoid fetching from wrong remote
  let song = state.queue.find((s) => s.song_id === state.current_song_id);

  // fallback: fetch from current data source
  if (!song) {
    const dataSource = getDataSource();
    song = await dataSource.getSongById(state.current_song_id);
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

  const state = appState();
  if (!state?.current_song_id || !state.queue.length) return;

  // pre-cache next ~30 minutes of songs
  console.log("pre-caching next songs (~30 min)");
  hasPreCachedNext = true;
  void preCacheNextSongs(state.current_song_id, state.queue, 30);
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
    await setCurrentSong(song.song_id);

    // cleanup previous audio url
    if (currentSongId) {
      cleanupAudioURL(currentSongId);
    }

    // get audio url using abstraction
    const audioURL = await getAudioURL(song);
    currentSongId = song.song_id;

    // load and play
    audio.src = audioURL;
    await audio.play();

    // reset pre-cache flag for new song
    hasPreCachedNext = false;

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
      const state = appState();
      if (!state?.current_song_id && state?.queue.length) {
        await playSong(state.queue[0]);
      } else if (state?.current_song_id) {
        // if audio src is empty (page reload), reload the song
        if (!audio.src) {
          // check if song is in queue first (avoid remote fetch)
          const songInQueue = state.queue.find(
            (s) => s.song_id === state.current_song_id,
          );
          if (songInQueue) {
            await playSong(songInQueue);
          } else {
            await playSong(state.current_song_id);
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
export async function playNext(): Promise<void> {
  if (!canGoNext()) return;

  const state = appState();
  const currentId = state.current_song_id;
  let currentIdx = currentId
    ? state.queue.findIndex((s) => s.song_id === currentId)
    : -1;

  // try to play next songs until one works or we run out
  const maxAttempts = 5; // prevent infinite loop
  let attempts = 0;

  while (currentIdx < state.queue.length - 1 && attempts < maxAttempts) {
    const nextIdx = currentIdx + 1;
    attempts++;

    try {
      await playSong(state.queue[nextIdx]);
      return; // success!
    } catch (error) {
      console.warn(
        `failed to play song at index ${nextIdx}, trying next...`,
        error,
      );
      currentIdx = nextIdx; // move to next song
      // if this was the last song, stop trying
      if (nextIdx >= state.queue.length - 1) {
        console.error("reached end of queue, no playable songs found");
        return;
      }
    }
  }

  console.error("exceeded max attempts to find playable song");
}

// play previous song in queue
export async function playPrevious(): Promise<void> {
  if (!canGoPrevious()) return;

  const state = appState();
  const currentId = state.current_song_id;
  const currentIdx = currentId
    ? state.queue.findIndex((s) => s.song_id === currentId)
    : -1;
  const prevIdx = currentIdx - 1;

  await playSong(state.queue[prevIdx]);
}

// handle song ended (auto-advance to next)
async function handleSongEnded(): Promise<void> {
  // playNext has built-in retry logic
  await playNext();
}

// add songs to queue and play first
export async function playQueue(songs: Song[]): Promise<void> {
  if (songs.length === 0) return;

  await setQueue(songs);
  await playSong(songs[0].song_id);
}

// add song to end of queue
export async function addToQueue(song: Song): Promise<void> {
  const state = appState();
  const currentQueue = state?.queue || [];
  await setQueue([...currentQueue, song]);
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

// export signals
export {
  canGoNext,
  canGoPrevious,
  currentTime,
  duration,
  isLoading,
  isPlaying,
  volume,
};
