// HtmlAudioBackend — owns the `<audio>` element, its dom event
// handlers, per-song state flags, iOS blob refresh, swap-to-cached
// glue, and the navigator.mediaSession bookkeeping that historically
// lived at module scope in `../player.ts`. this class IS the html
// implementation of `PlayerBackend`. `../player.ts` is now a thin
// facade that delegates here.
//
// **what changed in this refactor**: phase 4a of the player.ts ->
// PlayerBackend extraction. the dom event handlers no longer write
// to the playback signals (`isPlaying`/`currentTime`/`duration`/
// `isLoading`); they emit `PlayerEvent`s and let `playerStateSync`
// translate. that makes this backend symmetric with `RodioBackend`
// — both emit events; one (the active one) drives the signals.
//
// **what's still mixed in**: the timeupdate handler still reaches
// into queue / analytics / pre-cache helpers directly. those are
// app-level orchestration that happen to be triggered by audio
// progress; phase 5 may extract them into a `playbackOrchestrator`
// module that subscribes to the active backend's progress events
// instead.
//
// **load command**: rodio's `PlayerCommand::Load { paths }` doesn't
// fit the html-element model, which takes a `Song` and resolves the
// blob/http url itself. callers should use `playSong()` (the public
// method on this class, also re-exported from `../player.ts`) for
// the html backend; `send({ kind: "load", ... })` emits a structured
// error event.

import type {
  PlayerCommand,
  PlayerEvent,
  PlayerSnapshot,
} from "freqhole-api-client";
import {
  emptySnapshot,
  type BackendKind,
  type LoadAndPlayOptions,
  type PlayerBackend,
  type PlayerEventListener,
  type Unsubscribe,
} from "../backend";
import {
  appState,
  setCurrentSong,
} from "../../../../app/services/storage/db";
import { getDataSource } from "../../../data";
import {
  canGoNext,
  canGoPrevious,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "../../queue/queueState";
import {
  activeHistoryEntryId,
  markSongCompleted,
  recordTimeProgress,
} from "../../queue/listenProgress";
import { updateQueueItemProgress } from "../../queue/queueProgress";
import { stopServerSession } from "../../queue/serverSession";
import { queueAnalyticsEvent } from "../../analytics/analyticsQueue";
import {
  cleanupAudioURL,
  getAudioURL,
  isPlayingDirectURL,
  refreshBlobURL,
  trySwapToCachedURL,
} from "../../storage/audioAccess";
import type { Song } from "../../storage/types";
import { debug } from "../../../../utils/logger";
import {
  clearExternalMediaSession as bridgeClearExternal,
  setExternalMediaSession as bridgeSetExternal,
  setIsIntentionalReload,
  type ExternalMediaSessionOptions as BridgeExternalOptions,
} from "../mediaSessionBridge";
import { stopRadioForMusic } from "../../../../app/services/playbackCoordinator";
import {
  currentTime,
  duration,
  isPlaying,
  pendingUpNextSha256,
  setPendingUpNextSha256,
  setVolume,
  volume,
} from "../playerState";

// option types preserved from the previous player.ts public api.
export interface PlaySongOptions {
  userInitiated?: boolean;
  initialPosition?: number;
  initialDuration?: number;
}

export type ExternalMediaSessionOptions = BridgeExternalOptions;

// hard cap on per-song setup so a hung getAudioURL or audio.play()
// can't wedge the whole queue while the screen is off. 20s is enough
// for slow p2p downloads but bounded enough that we recover and try
// the next song reliably.
const PLAY_SONG_TIMEOUT_MS = 20_000;
const PLAY_NEXT_MAX_ATTEMPTS = 5;

export class HtmlAudioBackend implements PlayerBackend {
  readonly kind: BackendKind = "html_audio";

  // dom + per-song state ----------------------------------------------------
  private audioElement: HTMLAudioElement | null = null;
  private currentSongId: string | null = null;
  // pending swap listener cleanup (removed when song changes)
  private pendingSwapCleanup: (() => void) | null = null;
  // last known currentTime for delta calculation (listen progress)
  private lastTimeUpdateValue = 0;
  // prevent duplicate completion events per song
  private songCompletionRecorded = false;
  // suppress error handler during blob URL refresh
  private isIntentionalReload = false;
  // user explicitly paused the player. when true, pending "up next"
  // songs will load but not auto-play. cleared when user explicitly
  // initiates playback (play button, double-click song, new queue).
  private userExplicitlyPaused = false;

  // mediasession ownership notes ------------------------------------------
  // navigator.mediaSession is owned by `mediaSessionBridge` (separate
  // module). this backend just emits playback state into
  // `playerState` signals; the bridge translates. external takeover
  // (radio etc.) is forwarded to the bridge via
  // `setExternalMediaSession()` / `clearExternalMediaSession()`.

  // PlayerBackend wire-up --------------------------------------------------
  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = { ...emptySnapshot };
  private disposed = false;

  // PlayerBackend interface ================================================

  async send(command: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("html_audio backend: send called after dispose");
    }

    switch (command.kind) {
      case "play":
        await this.play();
        return;
      case "pause":
        this.pause();
        return;
      case "stop":
        this.stop();
        return;
      case "next":
        await this.playNext();
        return;
      case "previous":
        await this.playPrevious();
        return;
      case "seek":
        // rodio reports + accepts position in milliseconds; the html
        // path uses seconds. round-trip via division.
        this.seek(command.ms / 1000);
        return;
      case "set_volume":
        this.setVolume(command.v);
        return;
      case "status":
        // emit the cached snapshot back through the event stream so the
        // caller observes a fresh state event.
        this.emit({ kind: "state", state: this.snap.state ?? "stopped" });
        return;
      case "load":
        // paths-vs-Song mismatch — see file header. emit a structured
        // error event rather than silently dropping.
        this.emit({
          kind: "error",
          detail: {
            error_type: "load_unsupported_in_html_backend",
            title: "Load Unsupported",
            detail:
              "the html audio backend doesn't accept raw file paths; " +
              "use playSong()/loadSong() with a Song object, or switch " +
              "to the rodio backend in settings.",
          },
        });
        return;
      default: {
        // exhaustiveness check — if a new variant lands in grimoire and
        // we forget here, ts will surface it.
        const _exhaustive: never = command;
        void _exhaustive;
      }
    }
  }

  subscribe(listener: PlayerEventListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PlayerSnapshot {
    return this.snap;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanup();
    this.listeners.clear();
    if (this.audioElement) {
      try {
        this.audioElement.removeAttribute("src");
      } catch {
        // ignore
      }
      this.audioElement = null;
    }
  }

  // public methods used by the facade ======================================

  // PlayerBackend.loadAndPlay — for the html backend this is just an
  // alias for the existing rich `playSong` method, which already
  // accepts a Song and the same options shape.
  async loadAndPlay(song: Song, options?: LoadAndPlayOptions): Promise<void> {
    return this.playSong(song, options);
  }

  // play a specific song. uses pending "up next" pattern: UI stays on
  // current song during download, only switches when download completes.
  // options.userInitiated: true when user explicitly starts playback
  //   (play button, double-click, new queue) — clears userExplicitlyPaused.
  // options.initialPosition: seek to this position after load.
  async playSong(
    songOrId: string | Song,
    options?: PlaySongOptions,
  ): Promise<void> {
    const audio = this.initAudio();

    // user-initiated playback wins over any active radio session.
    if (options?.userInitiated) {
      await stopRadioForMusic();
      // belt-and-suspenders: explicitly release external ownership of
      // the media session. `stopRadioForMusic()` should cause
      // `clearExternalMediaSession()` via the playbackMode effect, but
      // solid effect timing isn't guaranteed before the next bridge
      // refresh runs.
      bridgeClearExternal();
      this.userExplicitlyPaused = false;
    }

    // tracks whether we've already logged a contextual error for
    // this attempt. the outer catch below is a safety net for
    // unexpected throws — if we logged inline, it skips re-logging
    // (without resorting to fragile error-message string matching).
    let alreadyLogged = false;

    try {
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

      // mark this song as pending "up next" — UI shows spinner but keeps
      // current song info.
      setPendingUpNextSha256(song.sha256);
      debug(
        "player",
        `pending up next: "${song.title}" (${song.sha256.slice(0, 8)}...)`,
      );

      // NOTE: we intentionally don't pre-cache here when user clicks a song.
      // pre-caching is handled by:
      // 1. queue setup (playQueue/addToQueue) - when songs first enter queue
      // 2. >50% playback trigger - rolling pre-cache as user listens

      let audioURL: string;
      try {
        audioURL = await getAudioURL(song);
      } catch (urlError) {
        console.error(
          `[playSong] getAudioURL failed for "${song.title}" (${song.sha256.slice(0, 8)}...):`,
          urlError instanceof Error ? urlError.message : urlError,
        );
        alreadyLogged = true;
        if (pendingUpNextSha256() === song.sha256) {
          setPendingUpNextSha256(null);
        }
        throw urlError;
      }

      // verify this song is still the pending one — user may have
      // selected a different song while we were downloading.
      if (pendingUpNextSha256() !== song.sha256) {
        debug(
          "player",
          "aborting playSong - user switched to different song during download",
        );
        return;
      }

      // download complete! clear pending state first.
      setPendingUpNextSha256(null);

      // cleanup previous audio url and any pending swap listener — but
      // only if switching to a different song (replaying the same song
      // may have reused/recreated the blob URL we'd be cleaning up).
      if (this.currentSongId && this.currentSongId !== song.sha256) {
        cleanupAudioURL(this.currentSongId);
      }
      if (this.pendingSwapCleanup) {
        this.pendingSwapCleanup();
        this.pendingSwapCleanup = null;
      }

      // emit a synthetic loading state so the UI shows a spinner
      // before the dom `loadstart` event has a chance to fire (which
      // it will, but the iOS WebKit timing isn't reliable enough to
      // bet the player UI on).
      this.emit({ kind: "state", state: "loading" });
      this.emit({
        kind: "progress",
        ms: Math.round((options?.initialPosition ?? 0) * 1000),
        total_ms: Math.round((options?.initialDuration ?? 0) * 1000),
      });

      // explicitly reset MediaSession position state to 0 for new track.
      // iOS lock screen caches the position from the previous track and
      // won't update correctly unless we explicitly reset it here.
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.setPositionState();
        } catch {
          // ignore — some browsers don't support this
        }
      }

      // update app state — PlayerBar will now show the new song.
      await setCurrentSong(song.sha256);

      this.currentSongId = song.sha256;
      this.lastTimeUpdateValue = 0;
      this.songCompletionRecorded = false;

      // set crossOrigin for direct remote URLs (needed for cookie auth on
      // cross-origin).
      if (audioURL.startsWith("http")) {
        audio.crossOrigin = "use-credentials";
      } else {
        audio.crossOrigin = "";
      }

      audio.src = audioURL;

      // decide whether to auto-play:
      // - if user explicitly paused, just load (don't play)
      // - otherwise, auto-play
      const shouldPlay = !this.userExplicitlyPaused;

      if (shouldPlay) {
        try {
          await audio.play();
          resetPlaybackEnded();
        } catch (playError) {
          console.error(
            `[playSong] audio.play() failed for "${song.title}" (${song.sha256.slice(0, 8)}...):`,
            playError instanceof Error ? playError.message : playError,
            `URL type: ${audioURL.startsWith("blob:") ? "blob" : audioURL.startsWith("http") ? "http" : "other"}`,
          );
          alreadyLogged = true;
          // play failed — emit a state derived from the audio element
          // so the UI clears the loading spinner without lying about
          // playback.
          this.emit({
            kind: "state",
            state: audio.paused
              ? audio.currentTime > 0
                ? "paused"
                : "stopped"
              : "playing",
          });
          throw playError;
        }
      } else {
        // user explicitly paused — preload so it's ready when user hits play.
        audio.load();
        debug(
          "player",
          `song ready but user paused - not auto-playing "${song.title}"`,
        );
        this.emit({ kind: "state", state: "paused" });
      }
    } catch (error) {
      if (!alreadyLogged) {
        console.error(
          `[playSong] unexpected error for "${typeof songOrId === "string" ? songOrId : songOrId.title}"`,
          error,
        );
      }
      // make sure the UI doesn't get stuck in the loading state on
      // any error path.
      this.emit({ kind: "state", state: "stopped" });
      throw error;
    }
  }

  // play/pause toggle. source: 'ui' = app controls,
  // 'mediaSession' = lock screen / control center.
  async togglePlayback(_source: "ui" | "mediaSession" = "ui"): Promise<void> {
    const audio = this.initAudio();

    if (isPlaying()) {
      // user explicitly paused - set flag so pending songs don't auto-play
      this.userExplicitlyPaused = true;
      audio.pause();
      return;
    }

    // user explicitly wants to play - silence radio and clear pause flag
    await stopRadioForMusic();
    this.userExplicitlyPaused = false;
    try {
      const state = appState();
      if (!state) return;
      const { queue, current_sha256 } = state;

      // if no song loaded, start first in queue
      if (!current_sha256 && queue.length) {
        await this.playSong(queue[0], { userInitiated: true });
        return;
      }

      // if no src (page reload), reload the song
      if (!audio.src && current_sha256) {
        const savedPosition = currentTime();
        const savedDuration = duration();
        const songInQueue = queue.find((s) => s.sha256 === current_sha256);
        if (songInQueue) {
          await this.playSong(songInQueue, {
            userInitiated: true,
            initialPosition: savedPosition,
            initialDuration: savedDuration,
          });
        } else {
          await this.playSong(current_sha256, {
            userInitiated: true,
            initialPosition: savedPosition,
            initialDuration: savedDuration,
          });
        }
        if (savedPosition > 0) this.seek(savedPosition);
        return;
      }

      // try to play directly first - this preserves iOS user gesture
      // context. only reload blob URLs if play() actually fails.
      try {
        await audio.play();
        return;
      } catch (playError) {
        // if it's a blob URL and play failed, the blob might be revoked
        // by iOS — try to re-create the blob URL from cached data.
        if (audio.src.startsWith("blob:") && current_sha256) {
          const savedPosition = audio.currentTime;
          const songInQueue = queue.find((s) => s.sha256 === current_sha256);
          if (songInQueue) {
            const freshURL = await refreshBlobURL(songInQueue);
            if (freshURL) {
              audio.src = freshURL;
              await new Promise<void>((resolve, reject) => {
                const onCanPlay = () => {
                  audio.removeEventListener("canplay", onCanPlay);
                  audio.removeEventListener("error", onError);
                  resolve();
                };
                const onError = () => {
                  audio.removeEventListener("canplay", onCanPlay);
                  audio.removeEventListener("error", onError);
                  reject(new Error("failed to load refreshed URL"));
                };
                audio.addEventListener("canplay", onCanPlay);
                audio.addEventListener("error", onError);
              });
              if (savedPosition > 0) audio.currentTime = savedPosition;
              await audio.play();
              return;
            }
          }

          // fallback to full playSong if refresh failed
          this.setIntentionalReload(true);
          try {
            if (songInQueue) {
              await this.playSong(songInQueue, { userInitiated: true });
            } else {
              await this.playSong(current_sha256, { userInitiated: true });
            }
            if (savedPosition > 0 && this.audioElement) {
              this.audioElement.currentTime = savedPosition;
            }
          } finally {
            this.setIntentionalReload(false);
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

  pause(): void {
    const audio = this.initAudio();
    // user explicitly paused - set flag so pending songs don't auto-play
    this.userExplicitlyPaused = true;
    audio.pause();
  }

  // explicit pause from radio coordinator. sets the flag so any pending
  // "up next" load doesn't auto-play, but doesn't trigger any radio side
  // effects (radio service is the caller).
  markUserPausedAndPause(): void {
    try {
      const audio = this.audioElement;
      if (audio && !audio.paused) {
        this.userExplicitlyPaused = true;
        audio.pause();
      }
    } catch (e) {
      debug("player", "markUserPausedAndPause failed:", e);
    }
  }

  // clear the explicit-pause gate for timeline radio transitions without
  // triggering stopRadioForMusic() side effects.
  allowTimelineAutoplay(): void {
    this.userExplicitlyPaused = false;
  }

  // pause and reset to beginning. doesn't touch userExplicitlyPaused —
  // stop is for cleanup, not user intent.
  stop(): void {
    const audio = this.initAudio();
    audio.pause();
    audio.currentTime = 0;
    this.emit({ kind: "state", state: "stopped" });
    this.emit({ kind: "progress", ms: 0, total_ms: 0 });
  }

  async play(): Promise<void> {
    const audio = this.initAudio();
    // user explicitly wants to play - clear pause flag and silence radio
    await stopRadioForMusic();
    this.userExplicitlyPaused = false;
    await audio.play();
  }

  // resume already-loaded audio without stopping radio. used by timeline
  // radio mode when the user explicitly presses play.
  async resumeLoadedAudioForRadio(): Promise<void> {
    const audio = this.initAudio();
    this.userExplicitlyPaused = false;
    await audio.play();
  }

  // seek to position (in seconds)
  seek(seconds: number): void {
    const audio = this.initAudio();
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || 0));
  }

  // set volume (0-1)
  setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolume(clamped);
    this.snap = { ...this.snap, volume: clamped };
    const audio = this.initAudio();
    audio.volume = clamped;

    // mirror the volume onto the radio sink so the slider acts as a
    // unified output volume regardless of which source is playing. lazy
    // import to dodge the circular dep (radioService imports from music).
    void import("../../../../app/services/radio/radioService")
      .then((m) => m.setRadioVolume(clamped))
      .catch(() => {
        // radio service unavailable (e.g. tests); ignore.
      });
  }

  // play next song in queue (with retry logic for unplayable songs)
  async playNext(): Promise<void> {
    // don't skip during intentional reload
    if (this.isIntentionalReload) return;
    if (!canGoNext()) return;

    const state = appState();
    if (!state) return;
    const { queue, current_sha256 } = state;
    let currentIdx = current_sha256
      ? queue.findIndex((s) => s.sha256 === current_sha256)
      : -1;

    let attempts = 0;

    while (
      currentIdx < queue.length - 1 &&
      attempts < PLAY_NEXT_MAX_ATTEMPTS
    ) {
      const nextIdx = currentIdx + 1;
      const nextSong = queue[nextIdx];
      attempts++;

      try {
        await Promise.race([
          this.playSong(nextSong),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `playSong timed out after ${PLAY_SONG_TIMEOUT_MS}ms`,
                  ),
                ),
              PLAY_SONG_TIMEOUT_MS,
            ),
          ),
        ]);
        return; // success!
      } catch (error) {
        console.warn(
          `[playNext] failed to play "${nextSong?.title}" at index ${nextIdx} (attempt ${attempts}/${PLAY_NEXT_MAX_ATTEMPTS}):`,
          error instanceof Error ? error.message : error,
        );
        currentIdx = nextIdx;
        if (nextIdx >= queue.length - 1) {
          console.error(
            "[playNext] reached end of queue, no playable songs found",
          );
          markPlaybackEnded();
          void stopServerSession("completed");
          return;
        }
      }
    }

    console.error(
      `[playNext] exceeded max attempts (${PLAY_NEXT_MAX_ATTEMPTS}) to find playable song`,
    );
  }

  // play previous song in queue
  async playPrevious(): Promise<void> {
    if (!canGoPrevious()) return;
    const state = appState();
    if (!state) return;
    const { queue, current_sha256 } = state;
    const currentIdx = current_sha256
      ? queue.findIndex((s) => s.sha256 === current_sha256)
      : -1;
    const prevIdx = currentIdx - 1;
    await this.playSong(queue[prevIdx]);
  }

  // pause audio + clear src + cleanup current blob URL. doesn't destroy
  // the backend (use `dispose()` for that).
  cleanup(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = "";
    }
    if (this.currentSongId) {
      cleanupAudioURL(this.currentSongId);
      this.currentSongId = null;
    }
    setPendingUpNextSha256(null);
  }

  // mediasession external takeover (radio etc.) ============================
  //
  // delegated to `mediaSessionBridge`. the backend keeps these methods
  // on its public surface so existing callers (radio service, queue
  // facade) don't break, but they're thin pass-throughs.

  setExternalMediaSession(options: ExternalMediaSessionOptions): void {
    bridgeSetExternal(options);
  }

  clearExternalMediaSession(): void {
    bridgeClearExternal();
  }

  // android `expectedend` watchdog. invoked by `mediaSessionBridge`
  // when the platform fires the action. checks audio-element specific
  // state (already-ended, near-end position) before advancing the queue.
  expectedEndWatchdog(): void {
    if (this.isIntentionalReload) return;
    const a = this.audioElement;
    if (!a) return;
    // already handled by the native `ended` event — nothing to do.
    if (a.ended) return;
    // if we're not supposed to be playing, the watchdog is stale.
    if (!isPlaying()) return;
    // sanity check: only auto-advance if we're actually near end.
    const dur = a.duration;
    if (Number.isFinite(dur) && dur > 0 && a.currentTime < dur - 2) {
      debug(
        "player",
        `expectedend ignored — currentTime=${a.currentTime.toFixed(2)} duration=${dur.toFixed(2)}`,
      );
      return;
    }
    debug("player", "expectedend watchdog firing — advancing queue");
    void this.handleSongEnded();
  }

  // public swap entry for the visibilitychange listener (installed by the
  // facade so we don't add document-level listeners from inside the
  // backend constructor — keeps tests/ssr clean).
  swapToCachedFromVisibility(): void {
    void this.trySwapCurrentSongToCached();
  }

  // dom + helpers (private) ================================================

  private initAudio(): HTMLAudioElement {
    if (this.audioElement) return this.audioElement;

    const audio = new Audio();
    this.audioElement = audio;
    audio.volume = volume();

    // iOS-specific: hints to maintain background audio session
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");

    // time update
    audio.addEventListener("timeupdate", () => {
      const ct = audio.currentTime;
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      this.emit({
        kind: "progress",
        ms: Math.round(ct * 1000),
        total_ms: Math.round(dur * 1000),
      });

      // record listen progress delta
      if (activeHistoryEntryId() && ct > this.lastTimeUpdateValue) {
        const delta = ct - this.lastTimeUpdateValue;
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
      this.lastTimeUpdateValue = ct;

      // update queue item progress for visual fill
      if (audio.duration > 0) {
        const progress = ct / audio.duration;
        const state = appState();
        if (state?.current_sha256) {
          const currentSong = state.queue.find(
            (s) => s.sha256 === state.current_sha256,
          );
          if (currentSong?.queue_entry_id) {
            updateQueueItemProgress(currentSong.queue_entry_id, progress);
          }
        }
      }

      // check for song completion (>90% listened)
      if (
        activeHistoryEntryId() &&
        !this.songCompletionRecorded &&
        audio.duration > 0
      ) {
        const progress = ct / audio.duration;
        if (progress >= 0.9) {
          this.songCompletionRecorded = true;
          const state = appState();
          if (state) {
            const { queue, current_sha256 } = state;
            const songIdx = current_sha256
              ? queue.findIndex((s) => s.sha256 === current_sha256)
              : 0;
            const currentSong =
              queue.find((s) => s.sha256 === current_sha256) ?? null;
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
    audio.addEventListener("loadedmetadata", () => {
      this.emit({
        kind: "progress",
        ms: Math.round(audio.currentTime * 1000),
        total_ms: Number.isFinite(audio.duration)
          ? Math.round(audio.duration * 1000)
          : 0,
      });
    });

    // playback started
    audio.addEventListener("play", () => {
      this.emit({ kind: "state", state: "playing" });
    });

    // playback paused
    audio.addEventListener("pause", () => {
      // distinguish "stopped" (currentTime reset to 0) from "paused"
      // (mid-track) so the ui can render the right control hint.
      this.emit({
        kind: "state",
        state: audio.currentTime > 0 ? "paused" : "stopped",
      });
      // try swapping direct URL to cached version while paused
      void this.trySwapCurrentSongToCached();
    });

    // network stall - audio is waiting for data. good opportunity to
    // swap to cached version if available.
    audio.addEventListener("waiting", () => {
      void this.trySwapCurrentSongToCached();
    });

    // seek completed - swap even if playing (brief pause-swap-resume)
    audio.addEventListener("seeked", () => {
      void this.trySwapCurrentSongToCached(true);
    });

    // song ended
    audio.addEventListener("ended", () => {
      this.emit({ kind: "ended" });
      void this.handleSongEnded();
    });

    // error during playback - skip to next song (unless intentional reload)
    audio.addEventListener("error", () => {
      // ignore errors during intentional reload (stale blob URL errors)
      if (this.isIntentionalReload) return;
      const error = audio.error;
      if (error) {
        console.error(
          `media error code: ${error.code}, message: ${error.message}, src: ${audio.src?.slice(0, 120)}`,
        );
      }
      void this.handleSongEnded();
    });

    // loading states. `loadstart` and `waiting` both indicate the
    // backend is fetching/buffering; `canplay` clears it. when canplay
    // fires we don't know whether the user wanted play or pause, so
    // emit a state derived from the audio element itself.
    audio.addEventListener("loadstart", () => {
      this.emit({ kind: "state", state: "loading" });
    });
    audio.addEventListener("waiting", () => {
      this.emit({ kind: "state", state: "loading" });
    });
    audio.addEventListener("canplay", () => {
      this.emit({
        kind: "state",
        state: audio.paused
          ? audio.currentTime > 0
            ? "paused"
            : "stopped"
          : "playing",
      });
    });

    return audio;
  }

  // mediaSession metadata + action-handler registration is owned by
  // `mediaSessionBridge`. it observes `appState().current_sha256`,
  // `isPlaying`, `currentTime`, and `duration` directly, so this
  // backend doesn't need to push anything explicitly.

  // toggle the intentional-reload flag in lockstep with the bridge so
  // platform media-key handlers correctly suppress prev/next during
  // blob URL refresh.
  private setIntentionalReload(active: boolean): void {
    this.isIntentionalReload = active;
    setIsIntentionalReload(active);
  }

  // pre-cache scheduling lives in `queue/preCacheScheduler.ts`. it
  // observes the same `currentTime`/`duration` signals this backend
  // updates, so the trigger logic stays backend-agnostic.

  // swap from direct remote URL to cached blob URL while player is
  // stopped. only swaps when the player is NOT actively playing to avoid
  // any audio interruption. when forceWhilePlaying is true (e.g. seek),
  // we pause briefly, swap, and resume. triggered by: pause, waiting
  // (network stall), seeked, visibilitychange (becoming visible).
  private async trySwapCurrentSongToCached(
    forceWhilePlaying = false,
  ): Promise<void> {
    if (!this.audioElement) return;
    const audio = this.audioElement;

    // don't swap while backgrounded - iOS can't handle src changes in
    // background. the swap happens when user returns to foreground
    // (visibilitychange handler).
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    const wasPlaying = !audio.paused;
    if (wasPlaying && !forceWhilePlaying) return;

    const state = appState();
    if (!state) return;
    const { current_sha256 } = state;
    if (!current_sha256) return;

    // only attempt if the song is currently using a direct URL
    if (!isPlayingDirectURL(current_sha256)) return;

    const cachedURL = await trySwapToCachedURL(current_sha256);
    if (!cachedURL) return;

    // double-check same song before swapping
    const currentState = appState();
    if (!currentState || currentState.current_sha256 !== current_sha256) {
      return;
    }

    // save current position before swapping src
    const savedTime = audio.currentTime;
    const swapSongId = current_sha256;

    // clean up any previous swap listener
    if (this.pendingSwapCleanup) {
      this.pendingSwapCleanup();
      this.pendingSwapCleanup = null;
    }

    // swap to cached blob URL (same-origin, no crossOrigin needed)
    if (wasPlaying) audio.pause();
    audio.crossOrigin = "";
    audio.src = cachedURL;

    // restore position once media is loadable, but only for the right song
    const restorePosition = () => {
      if (this.audioElement && this.currentSongId === swapSongId) {
        this.audioElement.currentTime = savedTime;
        if (wasPlaying) void this.audioElement.play();
      }
      this.audioElement?.removeEventListener("loadedmetadata", restorePosition);
      if (this.pendingSwapCleanup === cleanup) {
        this.pendingSwapCleanup = null;
      }
    };
    const cleanup = () => {
      this.audioElement?.removeEventListener("loadedmetadata", restorePosition);
    };
    this.pendingSwapCleanup = cleanup;
    audio.addEventListener("loadedmetadata", restorePosition);

    debug(
      "player",
      `swapped to cached URL at ${savedTime.toFixed(1)}s (player stopped)`,
    );
  }

  // handle song ended (auto-advance to next)
  private async handleSongEnded(): Promise<void> {
    if (!canGoNext()) {
      // queue has ended - set flag so we know to autoplay when new
      // songs are added
      markPlaybackEnded();
      // stop server session since queue is complete
      void stopServerSession("completed");
      return;
    }
    // playNext has built-in retry logic
    await this.playNext();
  }

  // PlayerEvent emit — updates the cached snapshot then notifies
  // every subscriber. backends are the source of truth for
  // `PlayerEvent`s; `playerStateSync` mirrors them onto the playback
  // signals so the rest of the app stays oblivious to which backend
  // is active.
  private emit(ev: PlayerEvent): void {
    this.applyToSnapshot(ev);
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        // listener errors must not break event distribution.
      }
    }
  }

  // mirror of grimoire's `PlayerSnapshot::apply`. keep in sync with
  // grimoire/src/player/control.rs.
  private applyToSnapshot(event: PlayerEvent): void {
    switch (event.kind) {
      case "state":
        this.snap = { ...this.snap, state: event.state };
        return;
      case "progress":
        this.snap = {
          ...this.snap,
          position_ms: event.ms,
          total_ms: event.total_ms,
        };
        return;
      case "track_changed":
        this.snap = { ...this.snap, current_index: event.index };
        return;
      case "ended":
        this.snap = { ...this.snap, position_ms: 0, current_index: null };
        return;
      case "error":
      case "backend_down":
      case "backend_up":
        return;
    }
  }
}
