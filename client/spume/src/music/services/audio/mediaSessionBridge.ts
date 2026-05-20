// mediaSession bridge.
//
// **what**: owns `navigator.mediaSession` for music playback. observes
// playback signals (`isPlaying`, `currentTime`, `duration`) and the
// active song from `appState`, and pushes metadata + position state
// onto the platform's lock-screen / control-center surface. backends
// never touch `navigator.mediaSession` directly — they just emit
// signals/events and this module translates.
//
// **why a separate module**: keeps the html backend focused on dom
// audio, and gives the future rodio backend a free ride — its
// progress events update the same `playerState` signals this bridge
// observes, so the lock-screen "just works" regardless of which
// backend is active.
//
// **external takeover** (radio): the radio service calls
// `setExternalMediaSession()` to install live-stream metadata + its
// own action handlers. while the external owner is active, the
// bridge backs off and doesn't overwrite metadata / handlers from
// the song queue. when the radio service calls
// `clearExternalMediaSession()`, the bridge re-asserts the song
// queue's session.
//
// **why action handlers call back into player.ts via dynamic import**:
// avoids a static import cycle (`player.ts` imports this module to
// install it; this module needs to invoke `togglePlayback` etc).
// dynamic import is invoked lazily inside the callback so the cycle
// only resolves at runtime.

import { createEffect, createRoot, on } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { getDataSource } from "../../data";
import { debug } from "../../../utils/logger";
import { getMediaSessionArtwork } from "../audio/mediaSessionArtwork";
import {
  currentTime,
  duration,
  isPlaying,
} from "../audio/playerState";

export interface ExternalMediaSessionOptions {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  isPlaying: boolean;
  isLive?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
}

let installed = false;

// while true, an external source (e.g. radio) owns the session. the
// bridge backs off and won't overwrite metadata or action handlers
// from the song queue path.
let externalActive = false;

// last `current_sha256` we observed in the metadata effect. used to
// detect track transitions so we can defensively reclaim the session
// from any stale external owner — song playback always wins on a
// real track change.
let lastSeenCurrentSha256: string | null = null;

// suppress action handlers during intentional reload (blob URL refresh
// in the html backend). the html backend toggles this flag via
// `setIsIntentionalReload()` so prev/next don't cascade while the
// reload is in flight.
let intentionalReloadActive = false;

// remember the last android `expectedend` watchdog hook so we can
// re-register it on every metadata refresh (iOS / chromium quirk:
// some action handlers get cleared when metadata is replaced).
type ExpectedEndCallback = () => void;
let expectedEndCallback: ExpectedEndCallback | null = null;

/**
 * register an android `expectedend` watchdog. backends call this from
 * their constructor and unregister on `dispose()`. only the most
 * recent registration is active. the bridge installs the action
 * handler unconditionally at install time — it dispatches to the
 * currently-registered callback (or no-ops if none).
 */
export function registerWatchdog(fn: ExpectedEndCallback): () => void {
  expectedEndCallback = fn;
  return () => {
    if (expectedEndCallback === fn) expectedEndCallback = null;
  };
}

/**
 * install the mediaSession bridge. idempotent — subsequent calls are
 * no-ops. invoked from the player facade at module init.
 */
export function installMediaSessionBridge(): void {
  if (installed) return;
  installed = true;

  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }

  createRoot(() => {
    // metadata + action handlers — refresh whenever the active song
    // changes. async because we resolve artwork via the data source.
    createEffect(
      on(
        () => appState()?.current_sha256 ?? null,
        () => void refreshMetadata(),
      ),
    );

    // playback state — flip `playbackState` between "playing" /
    // "paused" without re-fetching metadata. cheap, fires on every
    // play/pause toggle.
    createEffect(
      on(isPlaying, (playing) => {
        if (externalActive) return;
        if (!("mediaSession" in navigator)) return;
        if (!appState()?.current_sha256) return;
        navigator.mediaSession.playbackState = playing ? "playing" : "paused";
      }),
    );

    // position state — feeds the lock-screen scrubber. update lazily;
    // mediaSession spec recommends updating on seek/significant change
    // rather than every tick, but most platforms tolerate per-tick fine.
    createEffect(
      on([currentTime, duration], ([t, d]) => {
        if (externalActive) return;
        if (!("mediaSession" in navigator)) return;
        if (!appState()?.current_sha256) return;
        if (!Number.isFinite(d) || d <= 0) return;
        try {
          navigator.mediaSession.setPositionState({
            duration: d as number,
            playbackRate: 1.0,
            position: t as number,
          });
        } catch {
          // some browsers reject the call when metadata isn't yet set.
        }
      }),
    );
  });
}

/**
 * external playback source (e.g. live radio) takes over the session.
 * when `isLive` is true we explicitly clear position state and seek
 * handlers so platforms render non-seekable controls.
 */
export function setExternalMediaSession(
  options: ExternalMediaSessionOptions,
): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  externalActive = true;

  console.info(
    "[mediaSessionBridge] setExternalMediaSession:",
    "title:",
    options.title,
    "artist:",
    options.artist,
    "isPlaying:",
    options.isPlaying,
  );

  const artwork = options.artworkUrl
    ? ([
        { src: options.artworkUrl, sizes: "96x96", type: "image/jpeg" },
        { src: options.artworkUrl, sizes: "128x128", type: "image/jpeg" },
        { src: options.artworkUrl, sizes: "192x192", type: "image/jpeg" },
        { src: options.artworkUrl, sizes: "256x256", type: "image/jpeg" },
        { src: options.artworkUrl, sizes: "384x384", type: "image/jpeg" },
        { src: options.artworkUrl, sizes: "512x512", type: "image/jpeg" },
      ] as MediaImage[])
    : undefined;

  // clear metadata first, then set it (iOS Safari workaround)
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: options.title,
    artist: options.artist,
    album: options.album,
    artwork,
  });

  navigator.mediaSession.playbackState = options.isPlaying
    ? "playing"
    : "paused";

  navigator.mediaSession.setActionHandler("play", options.onPlay ?? null);
  navigator.mediaSession.setActionHandler("pause", options.onPause ?? null);
  navigator.mediaSession.setActionHandler(
    "nexttrack",
    options.onNextTrack ?? null,
  );
  navigator.mediaSession.setActionHandler(
    "previoustrack",
    options.onPreviousTrack ?? null,
  );

  if (options.isLive) {
    navigator.mediaSession.setActionHandler("seekto", null);
    try {
      navigator.mediaSession.setPositionState();
    } catch {
      // ignore on browsers that don't fully implement position state
    }
  }
}

/**
 * release external ownership and re-assert the song queue's session.
 */
export function clearExternalMediaSession(): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  externalActive = false;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
  navigator.mediaSession.setActionHandler("play", null);
  navigator.mediaSession.setActionHandler("pause", null);
  navigator.mediaSession.setActionHandler("nexttrack", null);
  navigator.mediaSession.setActionHandler("previoustrack", null);
  navigator.mediaSession.setActionHandler("seekto", null);
  try {
    navigator.mediaSession.setPositionState();
  } catch {
    // ignore on browsers that don't fully implement position state
  }
  // re-install the song-queue handlers / metadata so the lock-screen
  // controls keep working after radio (or any other external owner)
  // releases the session.
  void refreshMetadata();
}

/**
 * the html backend toggles this when it's intentionally reloading a
 * blob URL — the prev/next handlers no-op while it's true so a
 * misfired media-key press during reload doesn't cascade.
 */
export function setIsIntentionalReload(active: boolean): void {
  intentionalReloadActive = active;
}

/**
 * is an external owner currently controlling the session? useful for
 * backends that want to suppress their own metadata pushes while
 * radio (etc.) has ownership.
 */
export function isExternalSessionActive(): boolean {
  return externalActive;
}

// ---------------------------------------------------------------------------
// internal — metadata refresh
// ---------------------------------------------------------------------------

async function refreshMetadata(): Promise<void> {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  const state = appState();
  if (!state) return;
  const { queue, current_sha256 } = state;

  // defensive: if the active song id changed, music playback has
  // advanced — reclaim the media session from any stale external owner.
  if (current_sha256 && current_sha256 !== lastSeenCurrentSha256) {
    externalActive = false;
  }
  lastSeenCurrentSha256 = current_sha256 ?? null;

  // skip local song queue metadata when an external source has the
  // session.
  if (externalActive) return;

  if (!current_sha256) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
    return;
  }

  // check queue first to avoid fetching from wrong remote
  let song = queue.find((s) => s.sha256 === current_sha256);
  if (!song) {
    const dataSource = getDataSource();
    song = (await dataSource.getSongById(current_sha256)) ?? undefined;
  }
  if (!song) return;

  const artwork = await getMediaSessionArtwork(song);

  // clear metadata first, then set it (iOS Safari workaround). don't
  // prefix with "loading..." — iOS treats title changes as different
  // tracks.
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist_name,
    album: song.album_title,
    artwork,
  });

  // always reflect actual audio state, not our loading signal. iOS
  // will release the session if we report "paused" too aggressively.
  navigator.mediaSession.playbackState = isPlaying() ? "playing" : "paused";

  // re-register action handlers (re-register on every metadata update
  // for iOS compatibility). lazy-import the facade to dodge the cycle.
  const player = await import("../audio/player");

  navigator.mediaSession.setActionHandler("play", () => {
    void player.togglePlayback("mediaSession");
  });
  navigator.mediaSession.setActionHandler("pause", () => player.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => {
    if (intentionalReloadActive) return;
    void player.playPrevious();
  });
  navigator.mediaSession.setActionHandler("nexttrack", () => {
    if (intentionalReloadActive) return;
    void player.playNext();
  });
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) player.seek(details.seekTime);
  });

  // android plugin "expectedend" watchdog. fires shortly after the
  // expected end of the current track when the webview has throttled
  // js (screen-off / doze) and the audio `ended` event didn't fire
  // on time. ignored if the audio backend already advanced on its own.
  // the handler is installed unconditionally and dispatches to the
  // currently-registered callback (set via `registerWatchdog`).
  try {
    navigator.mediaSession.setActionHandler(
      "expectedend" as MediaSessionAction,
      () => {
        if (intentionalReloadActive) return;
        if (!expectedEndCallback) return;
        debug("player", "expectedend watchdog firing — invoking callback");
        expectedEndCallback();
      },
    );
  } catch {
    // some browsers reject unknown action names; safe to ignore.
  }

  // position state if we have valid duration
  if (duration() > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: duration(),
        playbackRate: 1.0,
        position: currentTime(),
      });
    } catch {
      // ignore
    }
  }
}
