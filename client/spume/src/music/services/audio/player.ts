// audio player service for music playback
//
// **facade**: this module owns two backend references:
//
// 1. `htmlBackend` — always-allocated `HtmlAudioBackend` instance.
//    every "rich" public method (`playSong`, `togglePlayback`,
//    `pause`, `play`, `seek`, `setPlayerVolume`, `playNext`,
//    `playPrevious`, `cleanup`, mediasession takeover, etc.) routes
//    here. these methods accept domain objects (`Song`) that don't
//    fit the wire `PlayerCommand` interface, so they stay html-only
//    until phase 4 lands a `Song -> path` adapter on `RodioBackend`.
//
// 2. `activeBackend` — the runtime-selected `PlayerBackend` from
//    `selectBackend()`. used for any future code that talks to the
//    backend through the wire interface (`send` + `subscribe`).
//    `swapPlayerBackend()` rebuilds it on config-changed events.
//    today, with the rich-method path still html-only, swapping is
//    mostly diagnostic — it lets us verify wiring + log which
//    backend the user has selected. phase 4 will start routing rich
//    methods through `activeBackend` when it's a `RodioBackend`.
//
// **what to put here**: facade-level concerns only — public api
// preservation, side-effect installs (radio coordinator hook,
// android shim, visibilitychange swap), and the signal re-exports
// the rest of the app imports.
//
// **what NOT to put here**: anything that touches the `<audio>`
// element directly, dom event handlers, blob/url logic, queue
// traversal, mediasession bookkeeping. those all live in
// `./backends/htmlAudio.ts`.

import {
  HtmlAudioBackend,
  type ExternalMediaSessionOptions,
} from "./backends/htmlAudio";
import { BackendPlaybackError, type PlayerBackend } from "./backend";
import { selectBackend } from "./select";
import { registerStopMusic } from "../../../app/services/playbackCoordinator";
import { installPreCacheScheduler } from "../queue/preCacheScheduler";
import { installMediaSessionBridge } from "./mediaSessionBridge";
import { bindActiveBackend } from "./playerStateSync";
import {
  currentTime,
  isPlaying as isPlayingSignal,
  setPendingUpNextSha256,
} from "./playerState";
import { resolveSongOrId } from "./facadeHelpers";
import { appState } from "../../../app/services/storage/db";
import type { Song } from "../storage/types";

// install android lock-screen / media notification shim. no-op on
// non-android and non-tauri platforms. side-effect import.
import "./androidMediaSession";

// install the queue's pre-cache scheduler. observes currentTime /
// duration signals, fires `preCacheNextSongs` once per song at the
// 50% mark. backend-agnostic by design.
installPreCacheScheduler();

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
// the android `expectedend` watchdog needs audio-element-aware
// sanity checks, so we route it through the html backend.
installMediaSessionBridge({
  onExpectedEnd: () => htmlBackend.expectedEndWatchdog(),
});

// runtime-selected. either `htmlBackend` (same instance!) or a
// fresh `RodioBackend` / `DummyBackend`. callers should NEVER
// reach for `htmlBackend` directly when they could go through
// `activeBackend` — that's how we accidentally end up with two
// players running in parallel.
let activeBackend: PlayerBackend = selectBackend(htmlBackend);

// playerStateSync is the single owner of the playback signals
// (`isPlaying`/`currentTime`/`duration`/`isLoading`). bind it to the
// active backend at boot, and re-bind whenever the backend swaps.
// without this, the signals never update and the UI stays frozen.
bindActiveBackend(activeBackend);

if (typeof console !== "undefined") {
  console.info(`[player] facade init: active backend = ${activeBackend.kind}`);
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

  console.info(
    `[player] backend swap: ${activeBackend.kind} -> ${next.kind}`,
  );

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
}

/**
 * read accessor for diagnostics + future routing decisions.
 */
export function currentBackendKind(): PlayerBackend["kind"] {
  return activeBackend.kind;
}

// register pause hook so the radio service can interrupt us when a
// user tunes into a station. uses pause() (not stop()) so the queue
// position is preserved.
registerStopMusic(() => htmlBackend.markUserPausedAndPause());

// when returning to foreground, safe time to swap to cached version.
// installed at the facade so we don't add document-level listeners
// from inside the backend constructor (keeps tests/ssr clean).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      htmlBackend.swapToCachedFromVisibility();
    }
  });
}

// =============================================================================
// public api — preserved from the pre-refactor module-level surface.
//
// **routing**: methods that take a `Song` (or otherwise need song-
// aware orchestration) route through `activeBackend.loadAndPlay`,
// which is the polymorphic entry point. wire-format methods
// (seek/setVolume) route through `activeBackend.send` so the active
// backend (html or rodio) actually receives them.
//
// methods that are inherently html-element specific (queue
// traversal that depends on the dom audio element, swap-to-cached,
// the iOS reload dance) still route through `htmlBackend`. that's
// fine: those methods are no-ops on rodio because rodio doesn't
// have an `<audio>` element to manage.
// =============================================================================

export async function playSong(
  songOrId: string | Song,
  options?: {
    userInitiated?: boolean;
    initialPosition?: number;
    initialDuration?: number;
  },
): Promise<void> {
  // resolve the song up front so both backends get a Song object.
  // the html backend can also accept a string id (its `playSong`
  // does the same resolution internally), but the rodio path needs
  // the materialized Song to extract `media_blob_id`.
  const song = await resolveSongOrId(songOrId);

  try {
    await activeBackend.loadAndPlay(song, options);
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
      console.warn(
        `[player] rodio cannot play "${song.title}" — blob has no local path. ` +
          `disable the rodio toggle in settings to stream remote files.`,
      );
    }
    // make sure the pending-up-next spinner doesn't get stuck.
    setPendingUpNextSha256(null);
    throw err;
  }
}

export async function togglePlayback(
  source: "ui" | "mediaSession" = "ui",
): Promise<void> {
  if (activeBackend === htmlBackend) {
    return htmlBackend.togglePlayback(source);
  }
  // rodio path: simple play/pause toggle, falling back to loading
  // from the queue when nothing is loaded.
  const snap = activeBackend.snapshot();
  const state = appState();
  console.info(
    `[player] togglePlayback (rodio): isPlaying=${isPlayingSignal()} snap.state=${snap.state ?? "null"} queue.len=${state?.queue?.length ?? 0} current=${state?.current_sha256?.slice(0, 8) ?? "null"}`,
  );
  if (isPlayingSignal()) {
    await activeBackend.send({ kind: "pause" });
    return;
  }
  // need to start playing. if the supervisor has a track loaded,
  // a bare play resumes it. otherwise pull current_sha256 (or the
  // queue head) and route through `playSong` which handles loading.
  if (snap.state === "paused") {
    await activeBackend.send({ kind: "play" });
    return;
  }
  if (!state) {
    console.warn(`[player] togglePlayback: no app state, bailing`);
    return;
  }
  const { queue, current_sha256 } = state;
  if (current_sha256) {
    const currentSong = queue.find((s) => s.sha256 === current_sha256);
    if (currentSong) {
      // currentTime() carries the visual position restored by
      // reconnectProgressTracking on page load (or the live
      // position if we're mid-session). pass it through so rodio
      // resumes where the html backend would have.
      const initialPosition = currentTime();
      console.info(
        `[player] togglePlayback: loading current sha=${current_sha256.slice(0, 8)} "${currentSong.title}" @ ${initialPosition.toFixed(1)}s`,
      );
      await playSong(currentSong, {
        userInitiated: true,
        initialPosition: initialPosition > 0 ? initialPosition : undefined,
      });
      return;
    }
    console.warn(
      `[player] togglePlayback: current_sha256=${current_sha256.slice(0, 8)} not in queue, falling back to queue[0]`,
    );
  }
  if (queue.length) {
    console.info(
      `[player] togglePlayback: no current, loading queue[0]=${queue[0].sha256.slice(0, 8)} "${queue[0].title}"`,
    );
    await playSong(queue[0], { userInitiated: true });
  } else {
    console.warn(
      `[player] togglePlayback: nothing to play (queue empty, no current_sha256)`,
    );
  }
}

export function pause(): void {
  // route through the active backend's wire surface so rodio gets
  // it too. the html backend's `send` switch maps `pause` to its
  // rich `pause()` method (which sets `userExplicitlyPaused`).
  void activeBackend.send({ kind: "pause" });
}

// clear the explicit-pause gate for timeline radio transitions
// without triggering stopRadioForMusic() side effects.
// html-only: the rodio supervisor doesn't have an equivalent gate.
export function allowTimelineAutoplay(): void {
  htmlBackend.allowTimelineAutoplay();
}

export function stop(): void {
  void activeBackend.send({ kind: "stop" });
}

export async function play(): Promise<void> {
  // wire surface; the html backend's `send` maps `play` to its
  // rich `play()` (which calls stopRadioForMusic + clears the
  // user-paused gate).
  await activeBackend.send({ kind: "play" });
}

// resume already-loaded audio without stopping radio. used by
// timeline radio mode when the user explicitly presses play.
// html-only by design — the rodio path doesn't currently coexist
// with the radio source.
export function resumeLoadedAudioForRadio(): Promise<void> {
  return htmlBackend.resumeLoadedAudioForRadio();
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

export async function playNext(): Promise<void> {
  if (activeBackend === htmlBackend) {
    return htmlBackend.playNext();
  }
  // rodio path: facade-level queue traversal. no retry-on-unplayable
  // logic yet — if the next song reports `no_local_path`, the user
  // sees the warn from `playSong` and the queue stops. phase 6 may
  // add retry/skip parity.
  const state = appState();
  if (!state) return;
  const { queue, current_sha256 } = state;
  const currentIdx = current_sha256
    ? queue.findIndex((s) => s.sha256 === current_sha256)
    : -1;
  const nextIdx = currentIdx + 1;
  if (nextIdx < queue.length) {
    await playSong(queue[nextIdx], { userInitiated: true });
  }
}

export async function playPrevious(): Promise<void> {
  if (activeBackend === htmlBackend) {
    return htmlBackend.playPrevious();
  }
  const state = appState();
  if (!state) return;
  const { queue, current_sha256 } = state;
  const currentIdx = current_sha256
    ? queue.findIndex((s) => s.sha256 === current_sha256)
    : -1;
  const prevIdx = currentIdx - 1;
  if (prevIdx >= 0) {
    await playSong(queue[prevIdx], { userInitiated: true });
  }
}

export function cleanup(): void {
  // tear down the html dom audio element + cleanup blob URLs.
  // always called — the html backend may be the active one or a
  // dormant fallback, but its dom resources are real either way.
  htmlBackend.cleanup();
  // also stop the active backend if it's something else (rodio).
  if (activeBackend !== htmlBackend) {
    void activeBackend.send({ kind: "stop" });
  }
}

// update lock-screen/control-center metadata from an external
// playback source (e.g. live radio managed outside the local song
// queue). when `isLive` is true we intentionally clear position
// state and seek handlers so platforms render non-seekable controls.
export function setExternalMediaSession(
  options: ExternalMediaSessionOptions,
): void {
  htmlBackend.setExternalMediaSession(options);
}

export function clearExternalMediaSession(): void {
  htmlBackend.clearExternalMediaSession();
}

export type { ExternalMediaSessionOptions } from "./backends/htmlAudio";

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
