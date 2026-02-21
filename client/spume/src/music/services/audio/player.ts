// audio player service for music playback
import { createSignal } from "solid-js";
import {
  appState,
  setCurrentSong,
} from "../../../app/services/storage/db";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { getDataSource } from "../../data";
import { preCacheNextSongs } from "../cache/blobCache";
import {
  canGoNext,
  canGoPrevious,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "../queue/queueState";
import {
  activeHistoryEntryId,
  markSongCompleted,
  recordTimeProgress,
} from "../queue/listenProgress";
import { stopServerSession } from "../queue/serverSession";
import { queueAnalyticsEvent } from "../analytics/analyticsQueue";
import { cleanupAudioURL, getAudioURL, isPlayingDirectURL, refreshBlobURL, trySwapToCachedURL } from "../storage/audioAccess";
import { getBlobObjectURL } from "../storage/blobs";
import type { ImageMetadata, Song } from "../storage/types";

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

// progress tracking state
let lastTimeUpdateValue = 0; // last known currentTime for delta calculation
let songCompletionRecorded = false; // prevent duplicate completion events per song
let isIntentionalReload = false; // suppress error handler during blob URL refresh

// initialize audio element
function initAudio(): HTMLAudioElement {
  if (audioElement) return audioElement;

  audioElement = new Audio();
  audioElement.volume = volume();
  
  // iOS-specific: hints to maintain background audio session
  audioElement.setAttribute('playsinline', '');
  audioElement.setAttribute('webkit-playsinline', '');

  // time update
  audioElement.addEventListener("timeupdate", () => {
    const ct = audioElement!.currentTime;
    setCurrentTime(ct);
    handlePreCacheNext();

    // record listen progress delta
    if (activeHistoryEntryId() && ct > lastTimeUpdateValue) {
      const delta = ct - lastTimeUpdateValue;
      // only record reasonable deltas (< 5s to avoid seek jumps)
      if (delta > 0 && delta < 5) {
        const state = appState();
        if (state) {
          const { queue, current_sha256 } = state;
          const songIdx = current_sha256
            ? queue.findIndex((s) => s.sha256 === current_sha256)
            : 0;
          const currentSong = queue[songIdx] ?? null;
          recordTimeProgress(delta, songIdx, ct, currentSong);
        }
      }
    }
    lastTimeUpdateValue = ct;

    // check for song completion (>90% listened)
    if (
      activeHistoryEntryId() &&
      !songCompletionRecorded &&
      audioElement!.duration > 0
    ) {
      const progress = ct / audioElement!.duration;
      if (progress >= 0.9) {
        songCompletionRecorded = true;
        const state = appState();
        if (state) {
          const { queue, current_sha256 } = state;
          const songIdx = current_sha256
            ? queue.findIndex((s) => s.sha256 === current_sha256)
            : 0;
          const currentSong = queue.find((s) => s.sha256 === current_sha256) ?? null;
          markSongCompleted(songIdx, currentSong);

          // queue a play_complete analytics event
          if (currentSong) {
            let targetBaseUrl: string | undefined;
            try {
            if (currentSong.source_url) {
              targetBaseUrl = new URL(currentSong.source_url).origin;
            }
          } catch {
            // non-parseable URL, skip base_url routing
          }
          void queueAnalyticsEvent("play_complete", {
            media_blob_id: currentSong.sha256,
            song_id: currentSong.id,
            target_remote_id: currentSong.remote_server_id ?? undefined,
            target_base_url: targetBaseUrl,
          });
        }
        }
      }
    }
  });

  // duration loaded
  audioElement.addEventListener("loadedmetadata", () => {
    setDuration(audioElement!.duration);
    updateMediaSession();
  });

  // playback started
  audioElement.addEventListener("play", () => {
    setIsPlaying(true);
    // only update media session if not in a loading state (avoid double-update)
    if (!isLoading()) {
      updateMediaSession();
    }
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

  // error during playback - skip to next song (unless we're intentionally reloading)
  audioElement.addEventListener("error", async () => {
    // ignore errors during intentional reload (stale blob URL errors)
    if (isIntentionalReload) {
      return;
    }
    
    const error = audioElement!.error;
    if (error) {
      console.error(
        `media error code: ${error.code}, message: ${error.message}`,
      );
    }
    // skip to next song on error
    await handleSongEnded();
  });

  // loading states
  audioElement.addEventListener("loadstart", () => {
    setIsLoading(true);
  });

  audioElement.addEventListener("waiting", () => {
    setIsLoading(true);
  });

  audioElement.addEventListener("canplay", () => {
    setIsLoading(false);
    updateMediaSession();
  });

  return audioElement;
}

// when returning to foreground, safe time to swap to cached version
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void trySwapCurrentSongToCached();
    }
  });
}

// get artwork URL for media session (async - may need to fetch from local storage)
async function getMediaSessionArtwork(song: Song): Promise<MediaImage[]> {
  const images = getSongDisplayImages(song);
  const bestImage = pickBestImage(images);
  if (!bestImage) return [];

  // prefer local blob if available
  if (bestImage.local_blob_id) {
    const objectUrl = await getBlobObjectURL(bestImage.local_blob_id);
    if (objectUrl) {
      return [
        { src: objectUrl, sizes: "512x512", type: "image/jpeg" },
        { src: objectUrl, sizes: "256x256", type: "image/jpeg" },
        { src: objectUrl, sizes: "96x96", type: "image/jpeg" },
      ];
    }
  }

  // fallback to remote URL
  if (bestImage.remote_url) {
    return [
      { src: bestImage.remote_url, sizes: "512x512", type: "image/jpeg" },
      { src: bestImage.remote_url, sizes: "256x256", type: "image/jpeg" },
      { src: bestImage.remote_url, sizes: "96x96", type: "image/jpeg" },
    ];
  }

  return [];
}

// update media session metadata and action handlers
async function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;

  const state = appState();
  if (!state) return;
  const {queue, current_sha256} = state;

  if (!current_sha256) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    return;
  }

  // check queue first to avoid fetching from wrong remote
  let song = queue.find((s) => s.sha256 === current_sha256);

  // fallback: fetch from current data source
  if (!song) {
    const dataSource = getDataSource();
    song = await dataSource.getSongById(current_sha256) ?? undefined;
  }

  if (!song) return;

  // get artwork for media session
  const artwork = await getMediaSessionArtwork(song);

  // clear metadata first, then set it (iOS Safari workaround)
  navigator.mediaSession.metadata = null;

  // don't prefix with "loading..." - iOS treats title changes as different tracks
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist_name,
    album: song.album_title,
    artwork,
  });

  // always reflect actual audio state, not our loading signal
  // iOS will release the session if we report "paused" too aggressively
  navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";

  // register action handlers (re-register on every update for iOS compatibility)
  navigator.mediaSession.setActionHandler("play", () => {
    void togglePlayback('mediaSession');
  });

  navigator.mediaSession.setActionHandler("pause", () => {
    pause();
  });

  navigator.mediaSession.setActionHandler("previoustrack", () => {
    // ignore during intentional reload to avoid cascade
    if (isIntentionalReload) {
      return;
    }
    void playPrevious();
  });

  navigator.mediaSession.setActionHandler("nexttrack", () => {
    // ignore during intentional reload to avoid cascade
    if (isIntentionalReload) {
      return;
    }
    void playNext();
  });

  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) {
      seek(details.seekTime);
    }
  });

  // update position state if we have valid duration
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
  if (!state) return;
  const {queue, current_sha256} = state;
  if (!current_sha256 || !queue.length) return;

  // pre-cache next ~30 minutes of songs
  console.log("pre-caching next songs (~30 min)");
  hasPreCachedNext = true;
  void preCacheNextSongs(current_sha256, queue, 30);
}

// swap from direct remote URL to cached blob URL while player is stopped
// only swaps when the player is NOT actively playing to avoid any audio interruption
// when forceWhilePlaying is true (e.g. seek), we pause briefly, swap, and resume
// triggered by: pause, waiting (network stall), seeked, visibilitychange (becoming visible)
async function trySwapCurrentSongToCached(forceWhilePlaying = false): Promise<void> {
  if (!audioElement) return;

  // don't swap while backgrounded - iOS can't handle src changes in background
  // the swap will happen when user returns to foreground (visibilitychange handler)
  if (document.visibilityState === 'hidden') return;

  const wasPlaying = !audioElement.paused;
  if (wasPlaying && !forceWhilePlaying) return;

  const state = appState();
  if (!state) return;
  const {current_sha256} = state;
  if (!current_sha256) return;

  // only attempt if the song is currently using a direct URL
  if (!isPlayingDirectURL(current_sha256)) return;

  const cachedURL = await trySwapToCachedURL(current_sha256);
  if (!cachedURL) return;

  // double-check same song before swapping
  const currentState = appState();
  if (!currentState || currentState.current_sha256 !== current_sha256) return;

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

  // reset time immediately so UI shows 0:00 while loading
  setCurrentTime(0);
  setDuration(0);
  
  // IMPORTANT: explicitly reset MediaSession position state to 0 for new track
  // iOS lock screen caches the position from the previous track and won't update
  // correctly unless we explicitly reset it here. Without this, skipping tracks
  // shows the previous song's position on the lock screen progress bar.
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setPositionState();  // clear position state
    } catch {
      // ignore errors - some browsers don't support this
    }
  }
  
  // note: don't call updateMediaSession() here - wait until we have actual song info

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

    // reset progress tracking for new song (before loading audio)
    lastTimeUpdateValue = 0;
    songCompletionRecorded = false;
    hasPreCachedNext = false;

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

// play/pause toggle - keep it simple like playlistz
// source: 'ui' = app controls, 'mediaSession' = lock screen/control center
export async function togglePlayback(source: 'ui' | 'mediaSession' = 'ui'): Promise<void> {
  const audio = initAudio();

  if (isPlaying()) {
    audio.pause();
  } else {
    try {
      // if no song loaded, start first in queue
      const state = appState();
      if (!state) return;
      const {queue, current_sha256} = state;
      if (!current_sha256 && queue.length) {
        await playSong(queue[0]);
        return;
      }
      
      // if no src (page reload), reload the song
      if (!audio.src && current_sha256) {
        const songInQueue = queue.find((s) => s.sha256 === current_sha256);
        if (songInQueue) {
          await playSong(songInQueue);
        } else {
          await playSong(current_sha256);
        }
        return;
      }
      
      // try to play directly first - this preserves iOS user gesture context
      // only reload blob URLs if play() actually fails
      try {
        await audio.play();
        return;
      } catch (playError) {
        // if it's a blob URL and play failed, the blob might be revoked by iOS
        // try to re-create the blob URL from cached data
        if (audio.src.startsWith('blob:') && current_sha256) {
          const savedPosition = audio.currentTime;
          
          const songInQueue = queue.find((s) => s.sha256 === current_sha256);
          if (songInQueue) {
            const freshURL = await refreshBlobURL(songInQueue);
            if (freshURL) {
              audio.src = freshURL;
              
              // wait for canplay before trying to play
              await new Promise<void>((resolve, reject) => {
                const onCanPlay = () => {
                  audio.removeEventListener('canplay', onCanPlay);
                  audio.removeEventListener('error', onError);
                  resolve();
                };
                const onError = () => {
                  audio.removeEventListener('canplay', onCanPlay);
                  audio.removeEventListener('error', onError);
                  reject(new Error('failed to load refreshed URL'));
                };
                audio.addEventListener('canplay', onCanPlay);
                audio.addEventListener('error', onError);
              });
              
              // restore position
              if (savedPosition > 0) {
                audio.currentTime = savedPosition;
              }
              
              // now play
              await audio.play();
              return;
            }
          }
          
          // fallback to full playSong if refresh failed
          isIntentionalReload = true;
          try {
            if (songInQueue) {
              await playSong(songInQueue);
            } else {
              await playSong(current_sha256);
            }
            if (savedPosition > 0 && audioElement) {
              audioElement.currentTime = savedPosition;
            }
          } finally {
            isIntentionalReload = false;
          }
          return;
        }
        
        // not a blob URL failure, re-throw
        throw playError;
      }
    } catch (error) {
      console.error("error toggling playback:", error);
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
  // don't skip during intentional reload
  if (isIntentionalReload) {
    return;
  }
  
  if (!canGoNext()) return;

  const state = appState();
  if (!state) return;
  const {queue, current_sha256} = state;
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
        void stopServerSession("completed");
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
  if (!state) return;
  const {queue, current_sha256} = state;
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
    // stop server session since queue is complete
    void stopServerSession("completed");
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
