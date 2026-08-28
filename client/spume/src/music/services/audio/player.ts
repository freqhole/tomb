// audio player service for music playback
//
// **facade**: this module owns two backend references:
//
// 1. `htmlBackend` — always-allocated `HtmlAudioBackend` instance.
//    `selectBackend` may return this same instance as `activeBackend`
//    when the html backend is selected; otherwise it stays dormant
//    but allocated so the radio coordinator hook + facade have a
//    stable identity. *the facade should not call rich html-only
//    methods on it directly* — every public method on this module
//    routes through `activeBackend` via the wire interface
//    (`send` / `subscribe` / `snapshot` / `loadAndPlay`).
//
// 2. `activeBackend` — the runtime-selected `PlayerBackend` from
//    `selectBackend()`. all wire-format playback commands
//    (play / pause / seek / set_volume / next / previous / stop)
//    go through `activeBackend.send`. song-aware playback goes
//    through `activeBackend.loadAndPlay(song, options)`.
//    `swapPlayerBackend()` rebuilds it on config-changed events.
//
// **what to put here**: facade-level concerns only — the unified
// pause gate, public api preservation, side-effect installs (radio
// coordinator hook, android shim), queue-traversal logic, and the
// signal re-exports the rest of the app imports.
//
// **what NOT to put here**: anything that touches the `<audio>`
// element directly, dom event handlers, blob/url logic, document-
// level listeners, mediasession bookkeeping. those all live in
// `./backends/htmlAudio.ts` (or `./mediaSessionBridge.ts`).

import { HtmlAudioBackend } from "./backends/htmlAudio";
import { BackendPlaybackError, type PlayerBackend } from "./backend";
import { VideoBackend } from "../../../video/services/videoBackend";
import { selectBackend } from "./select";
import { registerStopMusic } from "../../../app/services/playbackCoordinator";
import { installPreCacheScheduler } from "../queue/preCacheScheduler";
import { installMediaSessionBridge, registerMediaActions } from "./mediaSessionBridge";
import { installPlaybackOrchestrator } from "./playbackOrchestrator";
import { bindActiveBackend } from "./playerStateSync";
import {
  currentTime,
  duration,
  isPlaying as isPlayingSignal,
  setPendingUpNextSha256,
} from "./playerState";
import { debug, warn } from "../../../utils/logger";
import { appState } from "../../../app/services/storage/db";
import {
  mediaItemKey,
  songToMediaItem,
  videoToMediaItem,
  type MediaItem,
  type QueuedVideo,
} from "../../../app/services/storage/mediaItem";
import { canGoNext, markPlaybackEnded } from "../queue/queueState";
import { stopServerSession } from "../queue/serverSession";
import { stopRadioForMusic } from "../../../app/services/playbackCoordinator";
import { getDataSource } from "../../data";
import { toggleSongFavoriteDirect } from "../../queries/favorites";
import { getMediaSessionArtwork } from "./mediaSessionArtwork";
import { resolveSongOrId } from "./facadeHelpers";

import type { Song } from "../storage/types";
// auto-advance past unplayable songs before giving up.
const PLAY_NEXT_MAX_ATTEMPTS = 5;
// per-song setup timeout for `playNext`.
const PLAY_SONG_TIMEOUT_MS = 20_000;

// `error_type`s emitted by `classifyMediaElementError` (see
// `audio/backend.ts`) for the native media error codes worth
// distinguishing in `bindAutoAdvance` below: NETWORK (2) is often a
// transient blip worth one retry; DECODE (3) is permanent (the file
// itself is bad) and should never retry.
const NETWORK_ELEMENT_ERROR_TYPES = new Set([
  "audio_element_error_network",
  "video_element_error_network",
]);
const DECODE_ELEMENT_ERROR_TYPES = new Set([
  "audio_element_error_decode",
  "video_element_error_decode",
]);
// delay before retrying a network-error track once, so a transient
// blip has a moment to clear before we hammer the same request again.
const NETWORK_RETRY_DELAY_MS = 1500;

// retry budget for `playNext` — caps how many times the queue will
// (non-userInitiated) `playSong` calls land but the resulting
// playback is paused immediately (or never started, via
// `autoPlay: false` on the backend) so any auto-load/up-next path
// doesn't override the user's explicit pause intent. cleared by
// user-initiated playback (play button, double-click song, new queue,
// `allowTimelineAutoplay()`).
let userExplicitlyPaused = false;

// install android lock-screen / media notification shim. no-op on
// non-android and non-tauri platforms. side-effect import.
import "./androidMediaSession";

// install the queue's pre-cache scheduler. observes currentTime /
// duration signals, fires `preCacheNextSongs` once per song at the
// 50% mark. backend-agnostic by design.
installPreCacheScheduler();

// install the playback orchestrator. observes currentTime / duration
// + appState and runs the per-tick app-level side effects (listen-
// history accumulation, queue-row progress fill, >=90% completion +
// analytics). backend-agnostic — works for both html and rodio.
installPlaybackOrchestrator();

// always-allocated. owns the `<audio>` element + dom handlers + the
// rich playback api (`playSong`, queue traversal, mediasession glue).
// also reused as the active backend itself when html is selected
// (selectBackend takes this instance and returns it for that case)
// so its dom events feed `playerStateSync` directly. a second
// HtmlAudioBackend would be a "ghost" — audio plays but its events
// reach nobody.
const htmlBackend = new HtmlAudioBackend();

// install the mediaSession bridge. owns navigator.mediaSession and
// translates playback signals onto the platform's lock-screen surface.
// the android `expectedend` watchdog dispatches to whichever backend
// registered itself via `registerWatchdog` (currently the html backend
// from its constructor).
installMediaSessionBridge();

// register player-facade callbacks + song lookup with the bridge.
// keeps the bridge from statically importing `player.ts` or
// `music/data` (both would form import cycles). function decls below
// are hoisted, so referencing them here is safe.
registerMediaActions(
  {
    togglePlayback,
    pause,
    playNext,
    playPrevious,
    seek,
    toggleFavorite: toggleCurrentSongFavorite,
  },
  async (id: string): Promise<Song | null> => {
    return (await getDataSource().getSongById(id)) ?? null;
  },
  getMediaSessionArtwork
);

// android lock-screen "favorite" button for regular (non-radio) queue
// playback. resolves the currently-playing song (queue first, falling
// back to the data source) and toggles its favorite status via the
// same data-source call the in-app heart button uses.
async function toggleCurrentSongFavorite(): Promise<void> {
  const state = appState();
  const sha256 = state?.current_sha256;
  if (!sha256) return;
  const queuedItem = state.queue.find((i) => i.kind === "song" && i.song.sha256 === sha256);
  const song =
    (queuedItem?.kind === "song" ? queuedItem.song : undefined) ??
    (await getDataSource().getSongById(sha256));
  if (!song) return;
  try {
    await toggleSongFavoriteDirect(song);
  } catch (err) {
    warn("player", "toggleCurrentSongFavorite failed:", err);
  }
}

// runtime-selected. either `htmlBackend` (same instance!) or a
// fresh `RodioBackend` / `DummyBackend`. callers should NEVER
// reach for `htmlBackend` directly when they could go through
// `activeBackend` — that's how we accidentally end up with two
// players running in parallel.
let activeBackend: PlayerBackend = selectBackend(htmlBackend);

// always-allocated singleton for video playback. constructed lazily-cheap
// (no dom work until first command), swapped into `activeBackend` only
// while the current queue item is a video — see `ensureBackendForKind`.
const videoBackend = new VideoBackend();

/** exposes the video backend's owned `<video>` element for `PlayerBar`'s
 * video-aware rendering (mini video + fullscreen toggle). */
export function getVideoElement(): HTMLVideoElement {
  return videoBackend.element();
}

/** true while the video backend is the active backend (i.e. a video is
 * the current queue item). */
export function isVideoBackendActive(): boolean {
  return activeBackend === videoBackend;
}

// playerStateSync is the single owner of the playback signals
// (`isPlaying`/`currentTime`/`duration`/`isLoading`). bind it to the
// active backend at boot, and re-bind whenever the backend swaps.
// without this, the signals never update and the UI stays frozen.
// auto-advance: every backend emits `kind: "ended"` when the current
// song finishes (html via its `<audio>.ended` dom listener; rodio via
// the supervisor). the facade subscribes once and runs unified queue
// traversal regardless of backend.
let autoAdvanceUnsubscribe: (() => void) | null = null;
// sha256/id of the track we've already retried once for a network
// element error — cleared implicitly once the current track changes
// (a new key never matches an old retry marker), so each track gets
// exactly one network retry before falling back to advancing the
// queue.
let networkRetriedKey: string | null = null;
function bindAutoAdvance(backend: PlayerBackend): void {
  if (autoAdvanceUnsubscribe) {
    try {
      autoAdvanceUnsubscribe();
    } catch {
      /* swallow */
    }
    autoAdvanceUnsubscribe = null;
  }
  autoAdvanceUnsubscribe = backend.subscribe((event) => {
    if (event.kind === "ended") {
      debug("player", `backend "${backend.kind}" ended — advancing queue`);
      void playNext();
      return;
    }
    if (event.kind === "error") {
      const errorType = event.detail?.error_type;
      const reason = event.detail?.detail ?? event.detail?.title ?? "unknown";

      // NETWORK element errors are often transient — retry the same
      // track once (after a short delay) before giving up on it.
      if (errorType && NETWORK_ELEMENT_ERROR_TYPES.has(errorType)) {
        const state = appState();
        const current = state?.current_sha256 ?? null;
        const item = current ? state?.queue.find((i) => mediaItemKey(i) === current) : undefined;
        if (current && item && networkRetriedKey !== current) {
          networkRetriedKey = current;
          warn(
            "player",
            `backend "${backend.kind}" network error — retrying current track once before advancing: ${reason}`
          );
          setTimeout(() => {
            void playMediaItem(item, { userInitiated: false }).catch((err) => {
              warn(
                "player",
                `backend "${backend.kind}" network-error retry failed, advancing queue: ${err instanceof Error ? err.message : err}`
              );
              void playNext();
            });
          }, NETWORK_RETRY_DELAY_MS);
          return;
        }
      }

      // playback errors are treated as "skip + try the next track" —
      // `playNext` has its own retry budget so a string of bad tracks
      // doesn't loop forever. DECODE errors are permanent (the file
      // itself is bad), so call that out distinctly rather than
      // implying a retry would help.
      if (errorType && DECODE_ELEMENT_ERROR_TYPES.has(errorType)) {
        warn(
          "player",
          `backend "${backend.kind}" decode error (file may be corrupted), not retrying — advancing queue: ${reason}`
        );
      } else {
        warn("player", `backend "${backend.kind}" error — advancing queue: ${reason}`);
      }
      void playNext();
      return;
    }
  });
}

bindActiveBackend(activeBackend);
bindAutoAdvance(activeBackend);

if (typeof console !== "undefined") {
  debug("player", `facade init: active backend = ${activeBackend.kind}`);
}

/**
 * re-evaluate `selectBackend()` and replace the active backend if
 * the chosen kind changed. wired into `App.tsx`'s `onConfigChanged`
 * handler so the wizard's rodio toggle takes effect.
 *
 * **safe disposal**: the previous active backend is disposed only
 * if it isn't `htmlBackend` — that instance is always-allocated and
 * shared with the rich-method path (visibilitychange listener, radio
 * coordinator hook, mediaSession watchdog). disposing it would tear
 * down the dom audio element callers may still be referencing.
 */
export async function swapPlayerBackend(): Promise<void> {
  const next = selectBackend(htmlBackend);
  if (next === activeBackend) {
    // exact same instance — nothing to swap or dispose.
    return;
  }
  if (next.kind === activeBackend.kind) {
    // same kind, different instance (only possible when both are
    // RodioBackend, which constructs anew each call). dispose the
    // candidate so we don't leak its tauri event listener.
    await next.dispose();
    return;
  }

  debug("player", `backend swap: ${activeBackend.kind} -> ${next.kind}`);

  // STOP whatever the previous backend was doing. without this,
  // swapping rodio -> html (or vice versa) leaves the previous
  // player audibly running until something else interrupts it.
  void activeBackend.send({ kind: "stop" });

  // dispose the previous active backend — but never dispose the
  // shared html instance. the rodio backend, on the other hand,
  // owns a tauri event listener that should be torn down.
  if (activeBackend !== htmlBackend) {
    void activeBackend.dispose();
  }
  activeBackend = next;
  // re-point the playback-signal mirror at the freshly-active backend
  // so the UI starts seeing events from the right source.
  bindActiveBackend(activeBackend);
  // re-attach the facade-level auto-advance bridge for the new backend.
  bindAutoAdvance(activeBackend);
}

/**
 * read accessor for diagnostics + future routing decisions.
 */
export function currentBackendKind(): PlayerBackend["kind"] {
  return activeBackend.kind;
}

// register pause hook so the radio service can interrupt us when a
// user tunes into a station. uses pause() (not stop()) so the queue
// position is preserved. the music queue itself is wiped by a
// separate handler registered from queue.ts — that prevents stray
// `ended`/`error` events from a previously-loaded song hijacking
// radio by traversing the queue.
registerStopMusic(() => {
  if (isPlayingSignal()) {
    userExplicitlyPaused = true;
    void activeBackend.send({ kind: "pause" });
  }
});

// =============================================================================
// public api — preserved from the pre-refactor module-level surface.
//
// **routing**: methods that take a `Song` (or otherwise need song-
// aware orchestration) route through `activeBackend.loadAndPlay`,
// which is the polymorphic entry point. wire-format methods
// (play/pause/seek/set_volume/stop/next/previous) route through
// `activeBackend.send` so the active backend (html or rodio) actually
// receives them.
//
// **pause gate**: lives at this level only. user-initiated playback
// clears it; explicit pause / radio-takeover sets it. the backend
// receives the result via the `autoPlay` option on `loadAndPlay`.
// =============================================================================

/**
 * ensure `activeBackend` is appropriate for the given media kind,
 * swapping (and stopping whatever was previously playing) if needed.
 * mirrors `swapPlayerBackend`'s teardown/rebind steps but triggers
 * automatically based on the media kind of the item about to play,
 * rather than a user settings change.
 */
function ensureBackendForKind(kind: "song" | "video"): PlayerBackend {
  if (kind === "video") {
    if (activeBackend.kind !== "video") {
      void activeBackend.send({ kind: "stop" });
      activeBackend = videoBackend;
      bindActiveBackend(activeBackend);
      bindAutoAdvance(activeBackend);
    }
    return activeBackend;
  }
  if (activeBackend.kind === "video") {
    void activeBackend.send({ kind: "stop" });
    activeBackend = selectBackend(htmlBackend);
    bindActiveBackend(activeBackend);
    bindAutoAdvance(activeBackend);
  }
  return activeBackend;
}

export async function playSong(
  songOrId: string | Song,
  options?: {
    userInitiated?: boolean;
    initialPosition?: number;
    initialDuration?: number;
  }
): Promise<void> {
  const userInitiated = !!options?.userInitiated;
  const song = await resolveSongOrId(songOrId);

  // user-initiated playback wins over any active radio session.
  // centralized here so every backend gets the same coexistence
  // behavior (silence radio + clear pause gate).
  if (userInitiated) {
    await stopRadioForMusic();
    userExplicitlyPaused = false;
  }

  // honor the pause gate on programmatic loads: tell the backend to
  // load + preload but not auto-play. user-initiated loads always
  // auto-play (the gate was just cleared).
  const autoPlay = userInitiated || !userExplicitlyPaused;

  try {
    const backend = ensureBackendForKind("song");
    await backend.loadAndPlay(songToMediaItem(song), { ...options, autoPlay });
  } catch (err) {
    if (
      err instanceof BackendPlaybackError &&
      activeBackend.kind === "rodio" &&
      err.error_type === "no_local_path"
    ) {
      // rodio can't stream remote files — it needs a path on disk.
      // surface this clearly so the user understands the toggle's
      // current limitation. no automatic fallback to html: that
      // would require multiplexing playerStateSync across both
      // backends and quickly spirals into the kind of complexity
      // this refactor is trying to avoid. phase 5 may revisit.
      warn(
        "player",
        `rodio cannot play "${song.title}" (${song.sha256.slice(0, 8)}) — no local path; disable rodio in settings to stream remote files`
      );
    }
    // make sure the pending-up-next spinner doesn't get stuck.
    setPendingUpNextSha256(null);
    throw err;
  }
}

/**
 * play a video item through the shared queue/player pipeline. mirrors
 * `playSong`'s pause-gate + radio-silencing semantics but routes
 * through the video backend instead of the runtime-selected audio
 * backend.
 */
export async function playVideo(
  video: QueuedVideo,
  options?: {
    userInitiated?: boolean;
    initialPosition?: number;
    initialDuration?: number;
  }
): Promise<void> {
  const userInitiated = !!options?.userInitiated;

  if (userInitiated) {
    await stopRadioForMusic();
    userExplicitlyPaused = false;
  }

  const autoPlay = userInitiated || !userExplicitlyPaused;

  try {
    const backend = ensureBackendForKind("video");
    await backend.loadAndPlay(videoToMediaItem(video), { ...options, autoPlay });
  } catch (err) {
    setPendingUpNextSha256(null);
    throw err;
  }
}

/** unified entry point for queue-index-driven playback — dispatches to
 * `playSong` or `playVideo` based on the item's kind. prefer this over
 * calling `playSong`/`playVideo` directly when playing from a queue
 * position, since queue items are `MediaItem`s. */
export async function playMediaItem(
  item: MediaItem,
  options?: {
    userInitiated?: boolean;
    initialPosition?: number;
    initialDuration?: number;
  }
): Promise<void> {
  if (item.kind === "song") {
    await playSong(item.song, options);
    return;
  }
  await playVideo(item.video, options);
}

export async function togglePlayback(source: "ui" | "mediaSession" = "ui"): Promise<void> {
  void source;

  // pause path: short-circuit, set the gate, send pause through the
  // wire interface. backend-agnostic.
  if (isPlayingSignal()) {
    userExplicitlyPaused = true;
    await activeBackend.send({ kind: "pause" });
    return;
  }

  // play path: silence radio + clear gate up-front so any pending
  // up-next loads honor the user's intent. `stopRadioForMusic()` is a
  // no-op when radio isn't active (see leaveRadio's guard) - it used to
  // unconditionally rewrite appState on every resume even when radio was
  // never involved.
  await stopRadioForMusic();
  userExplicitlyPaused = false;

  const snap = activeBackend.snapshot();

  // a track is loaded and paused — bare play resumes it. backends
  // handle their own quirks (the html backend re-creates iOS-revoked
  // blob URLs inside its play() handler before throwing).
  if (snap.state === "paused") {
    try {
      await activeBackend.send({ kind: "play" });
      return;
    } catch (e) {
      warn(
        "player",
        "resume failed, falling back to full load:",
        e instanceof Error ? e.message : e
      );
    }
  }

  // nothing playable loaded — pull current_sha256 (page-reload case)
  // or queue head, and route through `playSong` which handles loading.
  const state = appState();
  if (!state) {
    warn("player", "togglePlayback: no app state");
    return;
  }
  const { queue, current_sha256 } = state;
  const ct = currentTime();
  const dur = duration();
  const initialPosition = ct > 0 ? ct : undefined;
  const initialDuration = dur > 0 ? dur : undefined;

  if (current_sha256) {
    const currentItem = queue.find((i) => mediaItemKey(i) === current_sha256);
    if (currentItem) {
      await playMediaItem(currentItem, {
        userInitiated: true,
        initialPosition,
        initialDuration,
      });
      return;
    }
    // fallback: no matching queue item (e.g. queue was cleared but
    // current_sha256 still points at a song) — resolve by id.
    await playSong(current_sha256, {
      userInitiated: true,
      initialPosition,
      initialDuration,
    });
    return;
  }
  if (queue.length) {
    await playMediaItem(queue[0], { userInitiated: true });
    return;
  }
  warn("player", "togglePlayback: nothing to play (queue empty)");
}

export function pause(): void {
  userExplicitlyPaused = true;
  void activeBackend.send({ kind: "pause" });
}

// clear the explicit-pause gate for timeline radio transitions
// without triggering stopRadioForMusic() side effects. used by the
// radio queue adapter when about to load the next timeline song.
export function allowTimelineAutoplay(): void {
  userExplicitlyPaused = false;
}

export function stop(): void {
  void activeBackend.send({ kind: "stop" });
}

export async function play(): Promise<void> {
  // user explicitly wants to play — silence radio first regardless
  // of which backend is active.
  await stopRadioForMusic();
  userExplicitlyPaused = false;
  await activeBackend.send({ kind: "play" });
}

// resume already-loaded audio without stopping radio. used by
// timeline radio mode when the user explicitly presses play — the
// radio service is feeding a queue of songs into the same player so
// teardown would self-abort. backend-agnostic: just sends the play
// command through the wire surface, skipping `stopRadioForMusic`.
export function resumeLoadedAudioForRadio(): Promise<void> {
  userExplicitlyPaused = false;
  return activeBackend.send({ kind: "play" });
}

export function seek(seconds: number): void {
  // route through the active backend's wire surface. the html
  // backend's `send` switch maps `seek` to its rich `seek()` method,
  // so html still gets the immediate audio-element update via the
  // same code path.
  void activeBackend.send({ kind: "seek", ms: Math.round(seconds * 1000) });
}

export function setPlayerVolume(vol: number): void {
  // always update the html backend's audio element + the radio sink
  // mirror so the volume slider stays in sync with the html `<audio>`
  // even when rodio is active (the html backend may be re-activated
  // by a backend swap and we want its element pre-set).
  htmlBackend.setVolume(vol);
  // forward to the active backend's wire surface so rodio receives
  // it; when html is active this is a no-op (the call above already
  // touched the element).
  if (activeBackend !== htmlBackend) {
    void activeBackend.send({ kind: "set_volume", v: vol });
  }
}

// unified queue traversal. both backends emit `kind: "ended"` when a
// song finishes; the facade reacts once via `bindAutoAdvance`. each
// attempt is bounded so a hung load can't wedge the queue.
export async function playNext(): Promise<void> {
  // [radio-skip-debug] #3 — log queue/current state on every playNext.
  // if this fires with queue.length=0 around an admin skip, the
  // facade auto-advance is racing the radio adapter.
  const _dbgState = appState();
  debug(
    "player",
    `playNext: queueLen=${_dbgState?.queue.length ?? 0} current=${_dbgState?.current_sha256?.slice(0, 8) ?? null} canGoNext=${canGoNext()}`
  );
  if (!canGoNext()) {
    debug("player", "playNext: queue empty — marking playback ended");
    markPlaybackEnded();
    void stopServerSession("completed");
    return;
  }
  const state = appState();
  if (!state) return;
  const { queue, current_sha256 } = state;
  let currentIdx = current_sha256 ? queue.findIndex((i) => mediaItemKey(i) === current_sha256) : -1;

  let attempts = 0;
  while (currentIdx < queue.length - 1 && attempts < PLAY_NEXT_MAX_ATTEMPTS) {
    const nextIdx = currentIdx + 1;
    const nextItem = queue[nextIdx];
    attempts++;
    try {
      await Promise.race([
        playMediaItem(nextItem, { userInitiated: true }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`playMediaItem timed out after ${PLAY_SONG_TIMEOUT_MS}ms`)),
            PLAY_SONG_TIMEOUT_MS
          )
        ),
      ]);
      return;
    } catch (err) {
      const nextTitle = nextItem?.kind === "song" ? nextItem.song.title : nextItem?.video.title;
      warn(
        "player",
        `playNext: failed "${nextTitle}" idx=${nextIdx} attempt=${attempts}/${PLAY_NEXT_MAX_ATTEMPTS}: ${err instanceof Error ? err.message : err}`
      );
      currentIdx = nextIdx;
      if (nextIdx >= queue.length - 1) {
        warn("player", "playNext: end of queue, no playable songs found");
        markPlaybackEnded();
        void stopServerSession("completed");
        return;
      }
    }
  }
  warn(
    "player",
    `playNext: exceeded retry budget (${PLAY_NEXT_MAX_ATTEMPTS}) — no playable song found`
  );
}

export async function playPrevious(): Promise<void> {
  const state = appState();
  if (!state) return;
  const { queue, current_sha256 } = state;
  const currentIdx = current_sha256
    ? queue.findIndex((i) => mediaItemKey(i) === current_sha256)
    : -1;
  const prevIdx = currentIdx - 1;
  if (prevIdx >= 0) {
    await playMediaItem(queue[prevIdx], { userInitiated: true });
  }
}

export async function dispose(): Promise<void> {
  // dispose the active backend (full teardown). this is a no-op for
  // most app-lifetimes — the player tends to outlive any individual
  // view — but exists for tests + intentional shutdown paths.
  await activeBackend.dispose();
  // ensure the html backend's dom resources are also released even when
  // a different backend (rodio/dummy) is currently active.
  if (activeBackend !== htmlBackend) {
    await htmlBackend.dispose();
  }
  if (activeBackend !== videoBackend) {
    await videoBackend.dispose();
  }
}

// re-export signals from playerState for backward compatibility
export {
  currentTime,
  duration,
  isLoading,
  isPlaying,
  pendingUpNextSha256,
  volume,
  setVisualPosition,
  clearPendingUpNext,
} from "./playerState";
