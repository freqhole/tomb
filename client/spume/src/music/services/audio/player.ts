// audio player service for music playback
import {
  appState,
  setCurrentSong,
} from "../../../app/services/storage/db";
import { getDataSource } from "../../data";
import { preCacheNextSongs } from "../cache/blobCache";
import { preCacheNextP2PSongs } from "../storage/blobResolver";
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
import { updateQueueItemProgress } from "../queue/queueProgress";
import { stopServerSession } from "../queue/serverSession";
import { queueAnalyticsEvent } from "../analytics/analyticsQueue";
import { cleanupAudioURL, getAudioURL, isPlayingDirectURL, refreshBlobURL, trySwapToCachedURL } from "../storage/audioAccess";
import type { Song } from "../storage/types";
import { debug } from "../../../utils/logger";
import { getMediaSessionArtwork } from "./mediaSessionArtwork";
// install android lock-screen / media notification shim.
// no-op on non-android and non-tauri platforms.
import "./androidMediaSession";
import {
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  volume,
  setVolume,
  isLoading,
  setIsLoading,
  pendingUpNextSha256,
  setPendingUpNextSha256,
  setVisualPosition,
  clearPendingUpNext,
} from "./playerState";

// track if user explicitly paused the player
// when true, pending "up next" songs will load but not auto-play
// cleared when user explicitly initiates playback (play button, double-click song, new queue)
let userExplicitlyPaused = false;

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

    // update queue item progress for visual fill
    if (audioElement!.duration > 0) {
      const progress = ct / audioElement!.duration;
      const state = appState();
      if (state?.current_sha256) {
        const currentSong = state.queue.find((s) => s.sha256 === state.current_sha256);
        if (currentSong?.queue_entry_id) {
          updateQueueItemProgress(currentSong.queue_entry_id, progress);
        }
      }
    }

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
            media_blob_id: currentSong.media_blob_id ?? currentSong.sha256,
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
        `media error code: ${error.code}, message: ${error.message}, src: ${audioElement!.src?.slice(0, 120)}`,
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

  // custom action emitted by the android plugin: a native-side watchdog
  // fires shortly after the expected end of the current track. used as a
  // backup trigger to advance the queue when the webview has throttled
  // js execution (screen-off / doze) and the `<audio>` `ended` event
  // didn't fire on time. ignored if the audio element already ended on
  // its own (the common case).
  try {
    navigator.mediaSession.setActionHandler(
      "expectedend" as MediaSessionAction,
      () => {
        if (isIntentionalReload) return;
        const a = audioElement;
        if (!a) return;
        // already handled by the native `ended` event — nothing to do.
        if (a.ended) return;
        // if we're not supposed to be playing, the watchdog is stale.
        if (!isPlaying()) return;
        // sanity check: only auto-advance if we're actually near the end.
        // protects against bad duration metadata triggering early advance.
        const dur = a.duration;
        if (Number.isFinite(dur) && dur > 0 && a.currentTime < dur - 2) {
          debug(
            "player",
            `expectedend ignored — currentTime=${a.currentTime.toFixed(2)} duration=${dur.toFixed(2)}`,
          );
          return;
        }
        debug("player", "expectedend watchdog firing — advancing queue");
        void handleSongEnded();
      },
    );
  } catch {
    // some browsers reject unknown action names; safe to ignore.
  }

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

  // pre-cache next ~30 minutes of songs (HTTP + P2P)
  debug("player", "pre-caching next songs (~30 min)");
  hasPreCachedNext = true;
  void preCacheNextSongs(current_sha256, queue, 30);
  void preCacheNextP2PSongs(current_sha256, queue, 30);
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

  debug("player", `swapped to cached URL at ${savedTime.toFixed(1)}s (player stopped)`);
}

// play a specific song
// uses pending "up next" pattern: UI stays on current song during download,
// only switches when download completes.
// options.userInitiated: true when user explicitly starts playback (play button, double-click, new queue)
//   - clears userExplicitlyPaused flag and auto-plays when ready
//   - false/undefined: respects userExplicitlyPaused flag (won't auto-play if user paused)
// options.initialPosition: seek to this position after load (also sets visual time immediately to avoid flash)
export async function playSong(
  songOrId: string | Song,
  options?: { userInitiated?: boolean; initialPosition?: number; initialDuration?: number }
): Promise<void> {
  const audio = initAudio();

  // if user explicitly initiated this playback, clear the pause flag
  if (options?.userInitiated) {
    userExplicitlyPaused = false;
  }

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

    // mark this song as pending "up next"
    // UI will show spinner but keep current song info
    setPendingUpNextSha256(song.sha256);
    debug("player", `pending up next: "${song.title}" (${song.sha256.slice(0, 8)}...)`);

    // NOTE: we intentionally don't pre-cache here when user clicks a song
    // pre-caching is handled by:
    // 1. queue setup (playQueue/addToQueue) - when songs first enter queue
    // 2. >50% playback trigger - rolling pre-cache as user listens
    // this prevents chaos when user skips around the queue rapidly

    // get audio url using abstraction (this can be slow for P2P downloads)
    let audioURL: string;
    try {
      audioURL = await getAudioURL(song);
    } catch (urlError) {
      console.error(
        `[playSong] getAudioURL failed for "${song.title}" (${song.sha256.slice(0, 8)}...):`,
        urlError instanceof Error ? urlError.message : urlError
      );
      // clear pending state on failure
      if (pendingUpNextSha256() === song.sha256) {
        setPendingUpNextSha256(null);
      }
      throw urlError;
    }

    // verify this song is still the pending one
    // user may have selected a different song while we were downloading
    if (pendingUpNextSha256() !== song.sha256) {
      debug("player", `aborting playSong - user switched to different song during download`);
      return;
    }

    // download complete! now update the current song state
    // clear pending state first (so UI doesn't show double-loading)
    setPendingUpNextSha256(null);

    // cleanup previous audio url and any pending swap listener
    // but only if switching to a different song - if replaying the same song,
    // getAudioURL() may have reused/recreated the blob URL we'd be cleaning up
    if (currentSongId && currentSongId !== song.sha256) {
      cleanupAudioURL(currentSongId);
    }
    if (pendingSwapCleanup) {
      pendingSwapCleanup();
      pendingSwapCleanup = null;
    }

    // set loading state while we load the audio element
    setIsLoading(true);

    // reset time for new song (or use initial position if resuming)
    setCurrentTime(options?.initialPosition ?? 0);
    setDuration(options?.initialDuration ?? 0);

    // IMPORTANT: explicitly reset MediaSession position state to 0 for new track
    // iOS lock screen caches the position from the previous track and won't update
    // correctly unless we explicitly reset it here.
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setPositionState();
      } catch {
        // ignore errors - some browsers don't support this
      }
    }

    // update app state - now PlayerBar will show the new song
    await setCurrentSong(song.sha256);

    currentSongId = song.sha256;

    // reset progress tracking for new song
    lastTimeUpdateValue = 0;
    songCompletionRecorded = false;
    hasPreCachedNext = false;

    // set crossOrigin for direct remote URLs (needed for cookie auth on cross-origin)
    if (audioURL.startsWith("http")) {
      audio.crossOrigin = "use-credentials";
    } else {
      audio.crossOrigin = "";
    }

    // load audio
    audio.src = audioURL;

    // decide whether to auto-play:
    // - if user explicitly paused, don't auto-play (just load)
    // - otherwise, auto-play
    const shouldPlay = !userExplicitlyPaused;

    if (shouldPlay) {
      try {
        await audio.play();
        // reset playback ended flag since we're playing now
        resetPlaybackEnded();
      } catch (playError) {
        console.error(
          `[playSong] audio.play() failed for "${song.title}" (${song.sha256.slice(0, 8)}...):`,
          playError instanceof Error ? playError.message : playError,
          `URL type: ${audioURL.startsWith("blob:") ? "blob" : audioURL.startsWith("http") ? "http" : "other"}`
        );
        setIsLoading(false);
        throw playError;
      }
    } else {
      // user explicitly paused - load audio but don't play
      // preload so it's ready when user hits play
      audio.load();
      debug("player", `song ready but user paused - not auto-playing "${song.title}"`);
    }

    setIsLoading(false);
  } catch (error) {
    // catch-all for any other unexpected errors
    if (!(error instanceof Error) || !error.message.includes("playSong")) {
      console.error(
        `[playSong] unexpected error for "${(typeof songOrId === "string" ? songOrId : songOrId.title)}"`,
        error
      );
    }
    setIsLoading(false);
    throw error;
  }
}

// play/pause toggle - keep it simple like playlistz
// source: 'ui' = app controls, 'mediaSession' = lock screen/control center
export async function togglePlayback(_source: 'ui' | 'mediaSession' = 'ui'): Promise<void> {
  const audio = initAudio();

  if (isPlaying()) {
    // user explicitly paused - set flag so pending songs don't auto-play
    userExplicitlyPaused = true;
    audio.pause();
  } else {
    // user explicitly wants to play - clear pause flag
    userExplicitlyPaused = false;
    try {
      // if no song loaded, start first in queue
      const state = appState();
      if (!state) return;
      const {queue, current_sha256} = state;
      if (!current_sha256 && queue.length) {
        await playSong(queue[0], { userInitiated: true });
        return;
      }
      
      // if no src (page reload), reload the song
      if (!audio.src && current_sha256) {
        const savedPosition = currentTime(); // get the restored position from setVisualPosition
        const savedDuration = duration(); // save duration too
        const songInQueue = queue.find((s) => s.sha256 === current_sha256);
        if (songInQueue) {
          await playSong(songInQueue, { 
            userInitiated: true, 
            initialPosition: savedPosition,
            initialDuration: savedDuration,
          });
        } else {
          await playSong(current_sha256, { 
            userInitiated: true,
            initialPosition: savedPosition,
            initialDuration: savedDuration,
          });
        }
        // seek to the restored position - audio is ready after playSong returns
        if (savedPosition > 0) {
          seek(savedPosition);
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
              await playSong(songInQueue, { userInitiated: true });
            } else {
              await playSong(current_sha256, { userInitiated: true });
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
  // user explicitly paused - set flag so pending songs don't auto-play
  userExplicitlyPaused = true;
  audio.pause();
}

// stop playback (pause and reset to beginning)
export function stop(): void {
  const audio = initAudio();
  audio.pause();
  audio.currentTime = 0;
  setIsPlaying(false);
  setCurrentTime(0);
  // don't set userExplicitlyPaused here - stop is for cleanup, not user intent
}

// play
export async function play(): Promise<void> {
  const audio = initAudio();
  // user explicitly wants to play - clear pause flag
  userExplicitlyPaused = false;
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

  // hard cap on per-song setup so a hung getAudioURL or audio.play()
  // can't wedge the whole queue while the screen is off. 20s is enough
  // for slow p2p downloads but bounded enough that we recover and try
  // the next song reliably.
  const PLAY_SONG_TIMEOUT_MS = 20_000;

  while (currentIdx < queue.length - 1 && attempts < maxAttempts) {
    const nextIdx = currentIdx + 1;
    const nextSong = queue[nextIdx];
    attempts++;

    try {
      await Promise.race([
        playSong(nextSong),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`playSong timed out after ${PLAY_SONG_TIMEOUT_MS}ms`)),
            PLAY_SONG_TIMEOUT_MS,
          ),
        ),
      ]);
      return; // success!
    } catch (error) {
      console.warn(
        `[playNext] failed to play "${nextSong?.title}" at index ${nextIdx} (attempt ${attempts}/${maxAttempts}):`,
        error instanceof Error ? error.message : error,
      );
      currentIdx = nextIdx; // move to next song
      // if this was the last song, stop trying
      if (nextIdx >= queue.length - 1) {
        console.error("[playNext] reached end of queue, no playable songs found");
        markPlaybackEnded();
        void stopServerSession("completed");
        return;
      }
    }
  }

  console.error(`[playNext] exceeded max attempts (${maxAttempts}) to find playable song`);
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

  // clear pending state
  setPendingUpNextSha256(null);
}

// re-export signals and functions from playerState for backward compatibility
export {
  currentTime,
  duration,
  isLoading,
  isPlaying,
  pendingUpNextSha256,
  volume,
  setVisualPosition,
  clearPendingUpNext,
};
