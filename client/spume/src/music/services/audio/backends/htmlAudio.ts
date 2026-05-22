// HtmlAudioBackend — owns the `<audio>` element, its dom event
// handlers, per-song state flags, iOS blob refresh, and swap-to-
// cached glue. this class IS the html implementation of
// `PlayerBackend`. `../player.ts` is a thin facade that delegates
// here via the wire interface (`send`/`subscribe`/`snapshot`/
// `loadAndPlay`/`dispose`).
//
// dom event handlers do not write to the playback signals
// (`isPlaying`/`currentTime`/`duration`/`isLoading`) directly; they
// emit `PlayerEvent`s and let `playerStateSync` translate. that
// makes this backend symmetric with `RodioBackend` — both emit
// events; one (the active one) drives the signals.
//
// app-level orchestration triggered by audio progress (analytics,
// listen history, pre-cache, queue-row fill) lives in
// `../playbackOrchestrator.ts`, which subscribes to the active
// backend's progress events. nothing app-level lives in here.
//
// navigator.mediaSession is owned by `../mediaSessionBridge.ts`. the
// android `expectedend` watchdog is registered with the bridge from
// the constructor via `registerWatchdog()`.
//
// **load command**: rodio's `PlayerCommand::Load { paths }` doesn't
// fit the html-element model, which takes a `Song` and resolves the
// blob/http url itself. callers should use `loadAndPlay()` (the
// public PlayerBackend method on this class) for the html backend;
// `send({ kind: "load", ... })` emits a structured error event.

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
import { resetPlaybackEnded } from "../../queue/queueState";
import {
  cleanupAudioURL,
  getAudioURL,
  isPlayingDirectURL,
  refreshBlobURL,
  trySwapToCachedURL,
} from "../../storage/audioAccess";
import type { Song } from "../../storage/types";
import { debug } from "../../../../utils/logger";
import { mirrorVolumeToRadio } from "../../../../app/services/playbackCoordinator";
import { registerWatchdog } from "../mediaSessionBridge";
import {
  isPlaying,
  pendingUpNextSha256,
  setPendingUpNextSha256,
  setVolume,
  volume,
} from "../playerState";

// option types preserved from the previous player.ts public api.
// shared with all backends via `LoadAndPlayOptions` in `../backend.ts`.
// the `autoPlay` flag is how the facade's pause gate is honored: false
// means load + preload but don't call `audio.play()`.

export class HtmlAudioBackend implements PlayerBackend {
  readonly kind: BackendKind = "html_audio";

  // dom + per-song state ----------------------------------------------------
  private audioElement: HTMLAudioElement | null = null;
  private currentSongId: string | null = null;
  // pending swap listener cleanup (removed when song changes)
  private pendingSwapCleanup: (() => void) | null = null;

  // mediasession ownership notes ------------------------------------------
  // navigator.mediaSession is owned by `mediaSessionBridge` (separate
  // module). this backend just emits playback state into
  // `playerState` signals; the bridge translates. external takeover
  // (radio etc.) is forwarded to the bridge via the bridge's exported
  // `setExternalMediaSession`/`clearExternalMediaSession` functions —
  // not via this class.

  // PlayerBackend wire-up --------------------------------------------------
  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = { ...emptySnapshot };
  private disposed = false;
  // visibilitychange listener handle — installed lazily in initAudio()
  // so we only touch document on platforms that have it. removed in
  // dispose().
  private visibilityListener: (() => void) | null = null;
  // android `expectedend` watchdog unregister handle. registered in
  // constructor, called on dispose so the bridge stops dispatching
  // here once the backend is gone.
  private unregisterWatchdog: (() => void) | null = null;

  constructor() {
    this.unregisterWatchdog = registerWatchdog(() =>
      this.expectedEndWatchdog(),
    );
  }

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
        // queue traversal lives at the facade. callers should invoke
        // `playNext()` from `audio/player.ts`, not send `next` through
        // the wire interface. emit a structured error so misuse is
        // visible.
        this.emit({
          kind: "error",
          detail: {
            error_type: "next_unsupported_via_wire",
            title: "Next Unsupported",
            detail:
              "the html backend doesn't traverse its queue from wire commands; " +
              "call playNext() on the facade (audio/player) instead.",
          },
        });
        return;
      case "previous":
        // see `next` above — same reason.
        this.emit({
          kind: "error",
          detail: {
            error_type: "previous_unsupported_via_wire",
            title: "Previous Unsupported",
            detail:
              "the html backend doesn't traverse its queue from wire commands; " +
              "call playPrevious() on the facade (audio/player) instead.",
          },
        });
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
              "use loadAndPlay() with a Song object, or switch " +
              "to the rodio backend in settings.",
          },
        });
        return;
      case "enqueue":
        // same paths-vs-Song mismatch as `load`. the html backend
        // manages its queue at the facade/queue-state layer, not via
        // wire commands; surface a structured error so misuse is
        // visible.
        this.emit({
          kind: "error",
          detail: {
            error_type: "enqueue_unsupported_in_html_backend",
            title: "Enqueue Unsupported",
            detail:
              "the html audio backend doesn't accept raw file paths; " +
              "use the queue facade (queueState/queueActions) or switch " +
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
    this.unregisterWatchdog?.();
    this.unregisterWatchdog = null;
    this.cleanup();
    this.listeners.clear();
    if (this.visibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
    }
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

  // PlayerBackend.loadAndPlay — load a song and (if autoPlay) start
  // playback. uses the pending "up next" pattern: UI stays on the current
  // song during download, only switches when download completes.
  //
  // `options.userInitiated` is informational only at this layer (the
  // facade has already cleared its pause gate + silenced radio). the
  // backend itself reads `options.autoPlay` to decide whether to call
  // audio.play() after loading.
  async loadAndPlay(
    song: Song,
    options?: LoadAndPlayOptions,
  ): Promise<void> {
    const audio = this.initAudio();

    // tracks whether we've already logged a contextual error for
    // this attempt. the outer catch below is a safety net for
    // unexpected throws — if we logged inline, it skips re-logging
    // (without resorting to fragile error-message string matching).
    let alreadyLogged = false;

    try {
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

      // set crossOrigin for direct remote URLs (needed for cookie auth on
      // cross-origin).
      if (audioURL.startsWith("http")) {
        audio.crossOrigin = "use-credentials";
      } else {
        audio.crossOrigin = "";
      }

      audio.src = audioURL;

      // resume from a saved position when requested (page-reload "play"
      // path passes the persisted appState position, radio adapter
      // passes the timeline elapsed). seek must happen after metadata
      // is loaded — assigning currentTime before that is a no-op on
      // most browsers.
      const initialPositionSec = options?.initialPosition ?? 0;
      if (initialPositionSec > 0) {
        const seekOnMetadata = () => {
          try {
            audio.currentTime = initialPositionSec;
          } catch {
            // ignore — invalid duration / browser quirk
          }
        };
        audio.addEventListener("loadedmetadata", seekOnMetadata, { once: true });
      }

      // honor the autoPlay flag (default true). the facade clears its
      // pause gate on user-initiated loads and passes autoPlay=true; on
      // programmatic loads (e.g. queue advance) the facade may pass
      // autoPlay=false to preload only.
      const shouldPlay = options?.autoPlay !== false;

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
        // autoPlay false — preload so it's ready when user hits play.
        audio.load();
        debug("player", `song ready (autoPlay=false) "${song.title}"`);
        this.emit({ kind: "state", state: "paused" });
      }
    } catch (error) {
      if (!alreadyLogged) {
        console.error(
          `[loadAndPlay] unexpected error for "${song.title}" (${song.sha256.slice(0, 8)}...)`,
          error,
        );
      }
      // make sure the UI doesn't get stuck in the loading state on
      // any error path.
      this.emit({ kind: "state", state: "stopped" });
      throw error;
    }
  }

  // play/pause toggle is the facade's responsibility — see
  // `audio/player.ts`. it dispatches via `send({ kind: "play" })`
  // / `send({ kind: "pause" })` and falls back to a full load via
  // `playSong(...)` when no track is currently loaded.

  pause(): void {
    const audio = this.initAudio();
    audio.pause();
  }

  // pause and reset to beginning. doesn't touch the facade's pause gate —
  // stop is for cleanup, not user intent.
  stop(): void {
    const audio = this.initAudio();
    audio.pause();
    audio.currentTime = 0;
    this.emit({ kind: "state", state: "stopped" });
    this.emit({ kind: "progress", ms: 0, total_ms: 0 });
  }

  // resume / start playback on the currently-loaded source. handles iOS
  // blob-revocation by re-creating the blob URL from cache and replaying.
  // pause-gate management + radio takeover are the facade's responsibility.
  async play(): Promise<void> {
    const audio = this.initAudio();
    try {
      await audio.play();
      return;
    } catch (playError) {
      // iOS may revoke blob URLs aggressively. attempt one re-create
      // from the cache for the currently-loaded song before giving up.
      if (!audio.src.startsWith("blob:")) throw playError;
      const state = appState();
      const current_sha256 = state?.current_sha256;
      if (!current_sha256) throw playError;
      const songInQueue = state?.queue.find((s) => s.sha256 === current_sha256);
      if (!songInQueue) throw playError;
      const freshURL = await refreshBlobURL(songInQueue);
      if (!freshURL) throw playError;
      const savedPosition = audio.currentTime;
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
    }
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
    // unified output volume regardless of which source is playing.
    // routed through the playback coordinator's `mirrorVolumeToRadio`
    // hook to dodge a circular import (radioService imports player
    // which imports htmlAudio).
    mirrorVolumeToRadio(clamped);
  }

  // play next song in queue (with retry logic for unplayable songs)
  // -- moved to the facade (audio/player.ts) in phase 4. the html
  // backend just emits `kind: "ended"` (or `kind: "error"`) on its
  // dom listeners; the facade subscribes via `bindAutoAdvance` and
  // calls the unified `playNext()` for both backends.

  // pause audio + clear src + cleanup current blob URL. private — only
  // called from `dispose()`. for full teardown, callers should use
  // `dispose()` (PlayerBackend interface).
  private cleanup(): void {
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
  // owned by `mediaSessionBridge` directly. callers should import
  // `setExternalMediaSession` / `clearExternalMediaSession` from
  // `../mediaSessionBridge`. no pass-throughs on the backend.

  // android `expectedend` watchdog. registered with `mediaSessionBridge`
  // via `registerWatchdog` in the constructor; the bridge invokes this
  // when the platform fires the action. checks audio-element specific
  // state (already-ended, near-end position) before advancing the queue.
  private expectedEndWatchdog(): void {
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
    // emit the ended event; facade's bindAutoAdvance will react and
    // call the unified `playNext()`.
    this.emit({ kind: "ended" });
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

    // when returning to foreground, swap any direct remote URL to the
    // cached blob version. installed once, lazily, alongside the audio
    // element so ssr/tests (no document) skip it cleanly. removed in
    // dispose().
    if (typeof document !== "undefined" && !this.visibilityListener) {
      const listener = (): void => {
        if (document.visibilityState === "visible") {
          void this.trySwapCurrentSongToCached();
        }
      };
      document.addEventListener("visibilitychange", listener);
      this.visibilityListener = listener;
    }

    // time update — emit a progress event; the per-tick app-level
    // side effects (listen-history, queue-row fill, >=90% completion)
    // are owned by `playbackOrchestrator`, which observes the same
    // signals `playerStateSync` writes from this event. that keeps
    // the orchestration backend-agnostic so rodio benefits too.
    audio.addEventListener("timeupdate", () => {
      const ct = audio.currentTime;
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      this.emit({
        kind: "progress",
        ms: Math.round(ct * 1000),
        total_ms: Math.round(dur * 1000),
      });
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
      // [radio-skip-debug] #2 — log when local audio reports natural end.
      // helps tell whether ended fires before/after radio Meta(B) on admin skip.
      console.info(
        "[radio-skip-debug] audio ended",
        "songId=", this.currentSongId,
        "src=", audio.src?.slice(0, 80) ?? null,
        "t=", Date.now(),
      );
      // facade's `bindAutoAdvance` reacts to this and runs queue
      // traversal for both backends.
      this.emit({ kind: "ended" });
    });

    // error during playback - skip to next song
    audio.addEventListener("error", () => {
      const error = audio.error;
      // [radio-skip-debug] #1 — log every audio.error with code + src snippet.
      // suspected to fire when broadcaster restarts encoder mid-skip.
      console.info(
        "[radio-skip-debug] audio error",
        "code=", error?.code ?? null,
        "songId=", this.currentSongId,
        "src=", audio.src?.slice(0, 80) ?? null,
        "t=", Date.now(),
      );
      if (error) {
        console.error(
          `media error code: ${error.code}, message: ${error.message}, src: ${audio.src?.slice(0, 120)}`,
        );
      }
      // surface as a structured error event — facade's auto-advance
      // bridge treats this the same way it treats `ended` (advance
      // the queue with a retry budget).
      this.emit({
        kind: "error",
        detail: {
          error_type: "audio_element_error",
          title: "Audio Element Error",
          detail: error
            ? `media error code: ${error.code}, message: ${error.message}`
            : "unknown <audio> element error",
        },
      });
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
