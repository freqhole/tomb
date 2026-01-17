// audio player service for music playback
import { createSignal } from "solid-js";
import {
  appState,
  setCurrentSong,
  setQueue,
} from "../../../app/services/storage/db";
import { getSongById } from "../storage/db";
import type { MusicSong } from "../storage/types";

// player state signals
const [isPlaying, setIsPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [duration, setDuration] = createSignal(0);
const [volume, setVolume] = createSignal(1.0);
const [isLoading, setIsLoading] = createSignal(false);

// audio element (singleton)
let audioElement: HTMLAudioElement | null = null;

// current audio url (for cleanup)
let currentAudioURL: string | null = null;

// initialize audio element
function initAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;

  audioElement = new Audio();
  audioElement.volume = volume();

  // time update
  audioElement.addEventListener("timeupdate", () => {
    setCurrentTime(audioElement!.currentTime);
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

  const song = await getSongById(state.current_song_id);
  if (!song) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
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

// create audio url from song
async function createAudioURL(song: MusicSong): Promise<string> {
  console.log("createAudioURL called with song:", {
    id: song.id,
    title: song.title,
    source_type: song.source_type,
    has_audio_blob: !!song.audio_blob,
    audio_blob_type: song.audio_blob?.constructor?.name,
    has_opfs_path: !!song.opfs_path,
    has_source_url: !!song.source_url,
  });

  if (song.source_type === "local" && song.audio_blob) {
    // create url from stored blob
    console.log("creating url from audio_blob");
    return URL.createObjectURL(song.audio_blob);
  }

  if (song.source_type === "downloaded" && song.opfs_path) {
    // TODO: read from OPFS when implemented
    throw new Error("opfs playback not yet implemented");
  }

  if (song.source_type === "remote" && song.source_url) {
    // stream from remote url
    return song.source_url;
  }

  throw new Error("unable to create audio url for song");
}

// play a specific song
export async function playSong(songId: string): Promise<void> {
  const audio = initAudio();
  setIsLoading(true);

  try {
    // get song from database
    const song = await getSongById(songId);
    if (!song) {
      throw new Error(`song not found: ${songId}`);
    }

    // cleanup previous audio url
    if (currentAudioURL) {
      URL.revokeObjectURL(currentAudioURL);
      currentAudioURL = null;
    }

    // create new audio url
    const audioURL = await createAudioURL(song);
    currentAudioURL = audioURL;

    // load and play
    audio.src = audioURL;
    await audio.play();

    // update app state
    await setCurrentSong(songId);

    setIsLoading(false);
  } catch (error) {
    console.error("failed to play song:", error);
    setIsLoading(false);
    throw error;
  }
}

// play/pause toggle
export async function togglePlayback(): Promise<void> {
  const audio = initAudio();

  if (isPlaying()) {
    pause();
  } else {
    // if no song is playing, play first in queue
    const state = appState();
    if (!state?.current_song_id && state?.queue.length) {
      await playSong(state.queue[0]);
    } else if (state?.current_song_id) {
      await audio.play();
    }
  }
}

// pause playback
export function pause(): void {
  const audio = initAudio();
  audio.pause();
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

// play next song in queue
export async function playNext(): Promise<void> {
  const state = appState();
  if (!state?.queue.length) return;

  const currentId = state.current_song_id;
  const currentIdx = currentId ? state.queue.indexOf(currentId) : -1;
  const nextIdx = currentIdx + 1;

  if (nextIdx < state.queue.length) {
    await playSong(state.queue[nextIdx]);
  }
}

// play previous song in queue
export async function playPrevious(): Promise<void> {
  const state = appState();
  if (!state?.queue.length) return;

  const currentId = state.current_song_id;
  const currentIdx = currentId ? state.queue.indexOf(currentId) : -1;
  const prevIdx = currentIdx - 1;

  if (prevIdx >= 0) {
    await playSong(state.queue[prevIdx]);
  }
}

// handle song ended
async function handleSongEnded(): Promise<void> {
  await playNext();
}

// add songs to queue and play first
export async function playQueue(songIds: string[]): Promise<void> {
  if (songIds.length === 0) return;

  await setQueue(songIds);
  await playSong(songIds[0]);
}

// add song to end of queue
export async function addToQueue(songId: string): Promise<void> {
  const state = appState();
  const currentQueue = state?.queue || [];
  await setQueue([...currentQueue, songId]);
}

// cleanup
export function cleanup(): void {
  if (audioElement) {
    audioElement.pause();
    audioElement.src = "";
  }

  if (currentAudioURL) {
    URL.revokeObjectURL(currentAudioURL);
    currentAudioURL = null;
  }
}

// export signals
export { currentTime, duration, isLoading, isPlaying, volume };
