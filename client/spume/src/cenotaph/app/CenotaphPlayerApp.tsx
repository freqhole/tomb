// spume's `#/player` route (phase 6): turns this browser tab into a
// remote-controllable playback target. NOT a separate build/deploy - just
// a normal route inside spume's hash router, rendered by AppLayout with
// its own chrome (TopNav/PlayerBar/sidebar) hidden. renders a full-screen
// pairing QR until a controller pairs, then hands the screen over to
// cenotaph's own `mediaPlaybackBackend` (its dedicated `<video>` element,
// reused verbatim - same instance the accept loop's command dispatcher
// already drives via `acceptModeBootstrap.ts`/`createPlayerConnectionHandler`).
//
// visual design mirrors player.freqhole.net's own former App.tsx pairing
// screen pixel-for-pixel (now abandoned, no rewire - see
// docs/cenotaph-migration-plan.md phase 5 - kept only as a reference for
// this fresh, spume-native component).

import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  activityRamp,
  broadcastPresence,
  commandInFlight,
  connectedControllers,
  currentPin,
  currentSession,
  develMode,
  downloadProgress,
  engineError,
  engineState,
  installConsoleCapture,
  loadDevelMode,
  mediaElement,
  mediaKind,
  nowPlaying,
  pause as pausePlayback,
  playbackDuration,
  playbackPosition,
  removeFromQueue as engineRemoveFromQueue,
  resume as resumePlayback,
  retryPlayback,
  setDevelMode,
  skip as skipTrack,
  stop as stopPlayback,
  upcomingQueue,
  type MediaPlaybackNode,
} from "../index";
import { spumeTrustStore } from "../adapters/trustStoreAdapter";
import { getMiddenNode } from "../../app/api/client";
import {
  getCharnelNodeId,
  getCharnelPlayerPairingEnabled,
  initCharnelPlaybackAcceptMode,
  setCharnelPlayerPairingEnabled,
  setCharnelPlayerSessionActive,
} from "../adapters/charnelAcceptBridge";
import { pendingQueuePreviews } from "../adapters/charnelPlaybackAdapter";

import { appState, getLocalLibraryName } from "../../app/services/storage/db";
import {
  remotePlaybackEnabled,
  setPlayerRouteMounted,
  setRemotePlaybackEnabled,
} from "../adapters/remoteModeSettings";
import { PlayerDebugOverlay } from "./PlayerDebugOverlay";
import { PlayerSettingsPanel } from "./PlayerSettingsPanel";
import { renderPlayerQr } from "./renderPairingQr";
import { isCharnelMode } from "../../app/services/charnel/mode";
import {
  currentTime as realCurrentTime,
  duration as realDuration,
  isPlaying as realIsPlaying,
} from "../../music/services/audio/playerState";
import {
  pause as realPause,
  play as realPlay,
  playNext as realPlayNext,
  getVideoElement,
  isVideoWindowActive,
} from "../../music/services/audio/player";
import {
  clearQueue as clearRealQueue,
  removeFromQueue as realRemoveFromQueue,
} from "../../music/services/queue/queue";
import {
  mediaItemKey,
  mediaItemSubtitle,
  mediaItemTitle,
} from "../../app/services/storage/mediaItem";
import { getSongDisplayImages } from "../../utils/images";
import { isTouchDevice } from "../../utils/isMobile";
import MediaImage from "../../components/media/MediaImage";
import { VideoMiniPlayer } from "../../components/player/VideoMiniPlayer";
import type { ImageMetadata } from "../../music/services/storage/types";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** true when this device is a charnel build - in that case,
 * `initCharnelPlaybackAcceptMode()` drives spume's real player
 * (`charnelPlaybackAdapter.ts`, delegating to spume's own
 * `player.ts`/`select.ts`, which already picks rodio vs html5 `<audio>`
 * on its own) instead of cenotaph's own `<video>`/`<audio>` engine, so
 * this component reads spume's own reactive state (queue/now-playing/
 * position/playing) rather than cenotaph's `engineState`/`nowPlaying`/
 * etc., which would otherwise sit stale (never updated - nothing drives
 * cenotaph's internal signals in this mode). not gated on rodio - the
 * adapter works with either playback backend. */
function usingRealPlayer(): boolean {
  return isCharnelMode();
}

export function CenotaphPlayerApp() {
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [nodeId, setNodeId] = createSignal<string | undefined>(undefined);
  // the qr overlay's spinning logo - speed is driven via this element's
  // live Animation.playbackRate (see the effect below), not via inline
  // `animation-duration` (see that effect's own doc comment for why).
  let spinLogoRef: HTMLImageElement | undefined;
  // `undefined` while still checking (charnel only - always `true`
  // elsewhere, see the effect below). `false` means `[player_pairing].
  // enabled` is off in charnel-config.toml - no other peer can pair with
  // this device at all yet, so the qr/pin ui below is replaced with a
  // "turn this on first" gate instead of rendering a pairing code nobody
  // can actually use.
  const [pairingConfigEnabled, setPairingConfigEnabled] = createSignal<boolean | undefined>(
    isCharnelMode() ? undefined : true
  );
  const [enablingPairing, setEnablingPairing] = createSignal(false);
  // kept (not just its id) so the skip button can drive the next download.
  const [middenNode, setMiddenNode] = createSignal<MediaPlaybackNode | null>(null);
  // no trusted controllers yet => the pin currently shown is this
  // player's admin-bootstrap invite (see docs/player-peer-trust-bridge-plan.md).
  const [controllers, { refetch: refetchControllers }] = createResource(
    spumeTrustStore.listTrustedControllers
  );
  const isAdminBootstrapPin = () =>
    (controllers()?.length ?? 0) === 0 || currentSession()?.admin_grant_pending === true;

  // playerConnectionHandler.ts pushes a fresh session into currentSession()
  // whenever a peer pairs (including the admin-bootstrap redemption, which
  // also rotates the pin) - refetch the trusted-controllers list on the
  // same trigger so isAdminBootstrapPin() above isn't left reading a stale,
  // pre-pairing controller count.
  createEffect(() => {
    currentSession();
    void refetchControllers();
  });

  // drives the qr overlay's spin speed via the Web Animations API rather
  // than rewriting the css `animation-duration` inline on every tick -
  // mutating that property resets a running css animation back to its
  // start, and this recalculates on every activityRamp() tick (every
  // 100ms while ramping down), which looked "wonky"/stuttery instead of
  // a smooth spin. `playbackRate` scales the SAME running animation
  // without touching its current position.
  createEffect(() => {
    const duration = 0.6 + 2.4 * (commandInFlight() ? 0 : (activityRamp() ?? 1));
    const anim = spinLogoRef?.getAnimations()[0];
    if (anim) anim.playbackRate = 1 / duration;
  });

  onMount(() => {
    document.body.appendChild(mediaElement);
    installConsoleCapture();
    void loadDevelMode();

    // step 6 (docs/player-peer-trust-bridge-plan.md): announce presence to
    // any paired controller holding an open subscribe stream, mirroring
    // acceptModeBootstrap.ts's own "active" definition (remote playback
    // toggled on, and mounted on /player - this component only ever
    // renders there at all). "stopped" fires on unmount too (SPA
    // navigation away from /player), but Solid's onCleanup does NOT run on
    // an actual tab close/reload/crash - only on Solid itself disposing
    // the component - so a real "pagehide" listener below covers that case
    // separately (best-effort: lib/midden's wasm api has no node/endpoint-
    // level close()/shutdown() binding, only a per-stream one already used
    // elsewhere, so this is just a fire-and-forget write to already-open
    // subscribe streams during unload, not a guaranteed flush - a crash or
    // force-quit still falls back to remoteTargetOffline()'s timeout).
    // charnel also needs the SAME "active" boolean mirrored into grimoire's
    // `player_session` global (a no-op outside charnel mode) - that's what
    // `server_info`/`/api/hello`'s `player_device` field actually reads on
    // that side (health.rs), and nothing previously called it, so a
    // controller scanning this device's pairing qr always saw a plain,
    // already-added remote instead of a player to pair with.
    createEffect(() => {
      const active = remotePlaybackEnabled();
      broadcastPresence({
        type: "presence",
        state: active ? "active" : "stopped",
      });
      void setCharnelPlayerSessionActive(active);
    });
    setPlayerRouteMounted(true);
    onCleanup(() => {
      broadcastPresence({ type: "presence", state: "stopped" });
      setPlayerRouteMounted(false);
      void setCharnelPlayerSessionActive(false);
    });

    const onPageHide = () => broadcastPresence({ type: "presence", state: "stopped" });
    window.addEventListener("pagehide", onPageHide);
    onCleanup(() => window.removeEventListener("pagehide", onPageHide));

    // "s" toggles settings, "d" toggles devel mode (console-log debug
    // overlay), escape closes settings - "s"/"d" ignored while typing in a
    // form field (e.g. the device name input inside settings itself).
    const onKeyDown = (e: KeyboardEvent) => {
      // while the "not accepting connections" fallback is up, a tv remote
      // has no pointer to click the enable button with - any key (not just
      // enter/space on the focused button itself) turns it on instead.
      if (showPairingScreen() && !remotePlaybackEnabled()) {
        setRemotePlaybackEnabled(true);
        return;
      }
      if (e.key === "Escape") {
        if (settingsOpen()) setSettingsOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === "s" || e.key === "S") {
        setSettingsOpen((open) => !open);
        return;
      }
      if (e.key === "d" || e.key === "D") void setDevelMode(!develMode());
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));

    void (async () => {
      try {
        if (isCharnelMode()) {
          const enabled = await getCharnelPlayerPairingEnabled();
          setPairingConfigEnabled(enabled);
          if (!enabled) return;
          await loadCharnelPairingUi();
          return;
        }
        const node = await getMiddenNode();
        setNodeId(node.node_id());
        // getMiddenNode()'s declared type marks playback methods optional (it
        // also models tauri's smaller charnel surface) but this branch only
        // ever runs against the real wasm node, where they're always present.
        setMiddenNode(node as unknown as MediaPlaybackNode);
        const dataUrl = await renderPlayerQr({
          node_id: node.node_id(),
          name: getLocalLibraryName(),
          role: "player_remote",
        });
        setQrDataUrl(dataUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  });

  /** starts the native accept loop and renders the qr - charnel only,
   * split out of the mount effect so `handleEnablePlayerPairing` below
   * can also call it right after flipping the config on, without needing
   * a route remount. */
  async function loadCharnelPairingUi(): Promise<void> {
    await initCharnelPlaybackAcceptMode();
    const id = await getCharnelNodeId();
    setNodeId(id);
    const dataUrl = await renderPlayerQr({
      node_id: id,
      name: getLocalLibraryName(),
      role: "player_remote",
    });
    setQrDataUrl(dataUrl);
  }

  /** flips `[player_pairing].enabled` on live (no app restart - see
   * `player_pairing_set_enabled`'s doc comment) and immediately proceeds
   * to load the qr/pin ui, so the "turn this on" button feels instant
   * rather than needing the user to navigate away and back. */
  async function handleEnablePlayerPairing(): Promise<void> {
    if (enablingPairing()) return;
    setEnablingPairing(true);
    try {
      await setCharnelPlayerPairingEnabled(true);
      setPairingConfigEnabled(true);
      await loadCharnelPairingUi();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnablingPairing(false);
    }
  }

  // the qr+pin pairing screen is the only ui a brand-new (not-yet-trusted)
  // device has to discover this player at all - it must reappear once a
  // session's queue empties back out, not just before the very first
  // session ever starts. stop() (playbackEngine.ts) leaves engineState()
  // at "stopped" (not "idle") once the queue drains, so checking only for
  // "idle" here left the pairing screen permanently hidden after the
  // first-ever session ended. when the real (rodio/gst) player is
  // driving playback instead, cenotaph's own engineState()/nowPlaying()
  // never change (nothing feeds them in that mode) - read spume's own
  // queue state instead.
  const showPairingScreen = () => {
    if (isCharnelMode() && pairingConfigEnabled() === false) return false;
    return usingRealPlayer()
      ? (appState()?.queue.length ?? 0) === 0
      : (engineState() === "idle" || engineState() === "stopped") && nowPlaying() === null;
  };

  /** unifies cenotaph's own now-playing state with spume's real player
   * state (when `usingRealPlayer()`) into one shape the JSX below reads
   * from, so it doesn't need two parallel copies of the same markup. `null`
   * hides the now-playing section entirely (nothing queued, or a command is
   * in flight). `isVideo` tells the JSX to swap the artwork slot for the
   * shared `<video>` element (via `VideoMiniPlayer`'s inline variant)
   * instead - unless the gst window is showing it instead (linux + rodio),
   * in which case that OS-level window is the actual display and this
   * slot stays empty, matching how the mini player skips its own inline
   * video too (see AppLayout.tsx's `isVideoWindowActive()` check).
   * `artworkImages`/`artworkUrl` are both passed straight to `MediaImage`
   * below, which resolves whichever is present (real player: the song's
   * own images array; cenotaph engine: the already-resolved
   * `artwork_full_url`). */
  const nowPlayingView = () => {
    if (usingRealPlayer()) {
      const state = appState();
      const pending = pendingQueuePreviews();
      if ((!state || state.queue.length === 0) && pending.length === 0) return null;

      // pending previews (see charnelPlaybackAdapter.ts's own doc comment)
      // show up immediately, before their network/db resolve finishes - a
      // replace_queue push starts from an empty real queue, so its first
      // pending item stands in for "now playing" (loading) until it
      // resolves; an append_queue push (queue already has a real current
      // item) just tacks its pending items onto queueRest instead.
      const pendingAsQueueRest = pending.map((p) => ({
        key: p.key,
        title: p.title,
        artist: p.artist,
        durationSeconds: p.durationSeconds,
        removeIndex: undefined as number | undefined,
        pending: true as const,
      }));

      if (!state || state.queue.length === 0) {
        const [first, ...rest] = pendingAsQueueRest;
        return {
          isVideo: false,
          artworkImages: undefined as ImageMetadata[] | undefined,
          artworkUrl: undefined as string | undefined,
          title: first?.title ?? "resolving\u2026",
          artist: first?.artist ?? "",
          positionSeconds: 0,
          durationSeconds: first?.durationSeconds ?? 0,
          isPlaying: false,
          loading: true,
          queueRest: rest,
        };
      }

      const idx = state.current_sha256
        ? state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256)
        : 0;
      const ordered = idx >= 0 ? state.queue.slice(idx) : state.queue;
      const current = ordered[0];
      if (!current) return null;
      return {
        isVideo: current.kind === "video",
        artworkImages: current.kind === "song" ? getSongDisplayImages(current.song) : undefined,
        artworkUrl: undefined as string | undefined,
        title: mediaItemTitle(current),
        artist: mediaItemSubtitle(current) ?? "",
        positionSeconds: realCurrentTime(),
        durationSeconds: realDuration(),
        isPlaying: realIsPlaying(),
        loading: false,
        queueRest: [
          ...ordered.slice(1).map((i, restIdx) => ({
            key: mediaItemKey(i),
            title: mediaItemTitle(i),
            artist: mediaItemSubtitle(i) ?? undefined,
            durationSeconds:
              i.kind === "song"
                ? (i.song.duration_seconds ?? undefined)
                : (i.video.duration_seconds ?? undefined),
            // full-array index (0 = currently playing) - matches
            // queue.ts's removeFromQueue(index) convention.
            removeIndex: (idx >= 0 ? idx : 0) + 1 + restIdx,
            pending: false as const,
          })),
          ...pendingAsQueueRest,
        ],
      };
    }
    if (mediaKind() !== "audio" || commandInFlight()) return null;
    const item = nowPlaying();
    if (!item) return null;
    return {
      isVideo: false,
      artworkImages: undefined as ImageMetadata[] | undefined,
      artworkUrl: item.artwork_full_url,
      title: item.title ?? "unknown title",
      artist: item.artist ?? "",
      positionSeconds: playbackPosition(),
      durationSeconds: item.duration_ms ? item.duration_ms / 1000 : playbackDuration(),
      isPlaying: engineState() === "playing",
      loading: false,
      queueRest: upcomingQueue()
        .slice(1)
        .map((q, restIdx) => ({
          key: q.blake3_hash,
          title: q.title ?? q.blake3_hash.slice(0, 12),
          artist: q.artist,
          durationSeconds: q.duration_ms ? q.duration_ms / 1000 : undefined,
          // full-array index (0 = currently playing) - matches
          // playbackEngine.ts's removeFromQueue(node, index) convention.
          removeIndex: 1 + restIdx,
          pending: false as const,
        })),
    };
  };

  /** removes one queue entry by its full-array/engine index (see
   * `nowPlayingView()`'s `removeIndex` field) - routes to spume's real
   * queue for `usingRealPlayer()`, cenotaph's own engine otherwise. */
  const handleRemoveQueueItem = (index: number) => {
    if (usingRealPlayer()) {
      void realRemoveFromQueue(index);
      return;
    }
    const node = middenNode();
    if (node) void engineRemoveFromQueue(node, index);
  };

  return (
    <div class="flex h-screen flex-col items-center justify-center gap-6 overflow-y-auto bg-black p-6 text-center text-white">
      <Show when={develMode()}>
        <PlayerDebugOverlay />
      </Show>

      <button
        type="button"
        class="fixed top-4 right-4 z-[1700] text-xs text-neutral-500"
        onClick={() => setSettingsOpen(true)}
        data-testid="settings-toggle"
      >
        settings
      </button>

      <Show when={settingsOpen()}>
        <PlayerSettingsPanel onClose={() => setSettingsOpen(false)} nodeId={nodeId()} />
      </Show>

      <Show when={connectedControllers().length > 0}>
        <div
          class="fixed top-10 right-4 z-[1700] max-w-[40vw] text-right text-xs text-neutral-500"
          data-testid="connected-controllers"
        >
          <For each={connectedControllers()}>
            {(c, i) => (
              <span>
                {i() > 0 ? ", " : ""}
                {c.display_name}
              </span>
            )}
          </For>
        </div>
      </Show>

      {/* charnel-only: `[player_pairing].enabled` is off in
          charnel-config.toml - no other peer can pair with this device
          at all, so there's nothing useful to show (a qr/pin nobody could
          ever redeem). offer to turn it on right here instead of sending
          the user off to hunt through a config file - takes effect
          immediately, no app restart (see `handleEnablePlayerPairing`). */}
      <Show when={pairingConfigEnabled() === false}>
        <div
          class="relative z-[1700] flex max-w-2xl flex-col items-center gap-10"
          data-testid="player-pairing-disabled"
        >
          <p class="text-[clamp(1.25rem,4vmin,2rem)] text-neutral-400">
            you need to turn on player pairing before other peers can connect.
          </p>
          <button
            type="button"
            class="rounded-lg bg-white px-8 py-5 text-[clamp(1.25rem,4vmin,2rem)] font-semibold text-black disabled:opacity-60"
            disabled={enablingPairing()}
            onClick={() => void handleEnablePlayerPairing()}
            data-testid="enable-player-pairing-button"
          >
            {enablingPairing() ? "turning on\u2026" : "turn on player pairing"}
          </button>
        </div>
      </Show>

      <Show when={showPairingScreen()}>
        <Show
          when={remotePlaybackEnabled()}
          fallback={
            <div class="flex max-w-5xl flex-col items-center gap-16">
              <p class="text-[clamp(1.5rem,5vmin,3rem)] text-neutral-400">
                this device isn't accepting player connections yet.
              </p>
              <button
                type="button"
                ref={(el) => el.focus()}
                class="rounded-lg bg-white px-10 py-6 text-[clamp(1.5rem,5vmin,3rem)] font-semibold text-black"
                onClick={() => setRemotePlaybackEnabled(true)}
                data-testid="enable-remote-playback-button"
              >
                press any key to enable
              </button>
            </div>
          }
        >
          <Show
            when={qrDataUrl()}
            fallback={<p class="text-neutral-400">{error() ?? "initializing p2p node..."}</p>}
          >
            {(url) => (
              <div class="relative h-[min(70vmin,900px)] w-[min(70vmin,900px)] shrink-0">
                <img
                  src={url()}
                  alt="pairing qr code"
                  class="h-full w-full"
                  data-testid="pairing-qr"
                />
                {/* animatable overlay on top of the baked-in static logo -
                  spins while a command is in flight or briefly after (see
                  cenotaph's activityIndicator.ts), otherwise hidden,
                  revealing the static logo underneath. speed is driven via
                  `playbackRate` (see the effect below), not by rewriting
                  `animation-duration` inline every tick - that resets the
                  css animation back to 0deg on every change, which made the
                  spin look "wonky"/stuttery given how often the ramp
                  recalculates (every 100ms, see activityIndicator.ts). */}
                <Show when={commandInFlight() || activityRamp() !== null}>
                  <div
                    class="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-black"
                    style={{ width: "28.6%", height: "28.6%" }}
                    data-testid="pairing-qr-loading"
                  >
                    <img
                      ref={(el) => (spinLogoRef = el)}
                      src="/freqhole.svg"
                      alt=""
                      class="spin-ramp"
                      style={{ width: "77%", height: "77%" }}
                    />
                  </div>
                </Show>
              </div>
            )}
          </Show>
          <p
            class="shrink-0 font-mono text-[clamp(2rem,9vmin,6rem)] tracking-widest"
            data-testid="pairing-pin"
          >
            {currentPin()}
          </p>
          <Show when={isAdminBootstrapPin()}>
            <p
              class="shrink-0 text-xs tracking-widest text-amber-400 uppercase"
              data-testid="admin-bootstrap-badge"
            >
              this code grants admin access
            </p>
          </Show>
        </Show>
      </Show>

      {/* now playing: album art (or inline video), title/artist, time,
          transport controls, and the rest of the queue - mirrors
          player.freqhole.net's former App.tsx now-playing view (see this
          file's header comment). hidden while a command is in flight (see
          playbackEngine.ts's own showPairingView note in the prior
          prototype) so it doesn't flash stale info between queue replace/
          append commands.
          when `usingRealPlayer()`, everything below reads spume's own
          queue/playback state instead of cenotaph's engineState()/
          nowPlaying()/etc. (which never change in that mode - nothing
          feeds them, see charnelPlaybackAdapter.ts) - see `nowPlayingView()`
          just above. a playing video renders inline here (the same shared
          `<video>` element normal spume playback uses, via
          `VideoMiniPlayer`'s inline variant) UNLESS the gst window is
          showing it instead (linux + rodio) - that's its own OS-level
          surface and already the actual display, so this slot stays empty
          then (docs/linux-video-window-plan.md). */}
      <Show when={nowPlayingView()}>
        {(view) => (
          <div
            class="relative z-[1700] flex w-full max-w-md flex-col items-center gap-4"
            data-testid="now-playing"
          >
            <Show
              when={view().isVideo}
              fallback={
                <Show
                  when={(view().artworkImages?.length ?? 0) > 0 || view().artworkUrl}
                  fallback={
                    <div
                      class="flex h-64 w-64 items-center justify-center rounded-lg bg-neutral-800"
                      classList={{ "animate-pulse": view().loading }}
                      data-testid="artwork-fallback"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        class="h-20 w-20 text-neutral-600"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </div>
                  }
                >
                  <MediaImage
                    images={view().artworkImages}
                    imageUrl={view().artworkUrl}
                    alt=""
                    domainType="song"
                    showFallback={false}
                    class="h-64 w-64 rounded-lg object-cover shadow-lg"
                  />
                </Show>
              }
            >
              <Show when={!isVideoWindowActive()}>
                <div class="h-64 w-64 rounded-lg" data-testid="inline-video">
                  <VideoMiniPlayer videoElement={getVideoElement()} variant="inline" />
                </div>
              </Show>
            </Show>

            <p class="text-xl font-semibold" data-testid="now-playing-title">
              {view().title}
            </p>
            <p class="text-sm text-neutral-400" data-testid="now-playing-artist">
              {view().artist}
            </p>
            <Show
              when={!view().loading}
              fallback={
                <p class="font-mono text-xs text-neutral-500" data-testid="now-playing-time">
                  resolving…
                </p>
              }
            >
              <p class="font-mono text-xs text-neutral-500" data-testid="now-playing-time">
                {formatTime(view().positionSeconds)} / {formatTime(view().durationSeconds)}
              </p>
            </Show>

            <div class="flex items-center gap-8" data-testid="playback-controls">
              <button
                type="button"
                class="text-3xl leading-none"
                onClick={() =>
                  usingRealPlayer()
                    ? view().isPlaying
                      ? realPause()
                      : void realPlay()
                    : engineState() === "playing"
                      ? pausePlayback()
                      : resumePlayback()
                }
                data-testid="play-pause-button"
              >
                {view().isPlaying ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                class="text-3xl leading-none"
                onClick={() =>
                  usingRealPlayer()
                    ? void realPlayNext()
                    : middenNode() && void skipTrack(middenNode()!)
                }
                data-testid="skip-button"
              >
                ⏭
              </button>
            </div>

            {/* wrapping div gives the hover-only button ample hover
                area (not just the text itself) - hover has no touch
                equivalent, so touch devices show it always instead of
                hiding it behind an unreachable hover state (same pattern
                as VideoMiniPlayer.tsx's controls). */}
            <div class="group flex w-full justify-center py-2">
              <button
                type="button"
                class="text-xs text-neutral-500 transition-opacity"
                classList={{
                  "opacity-100": isTouchDevice(),
                  "opacity-0 group-hover:opacity-100": !isTouchDevice(),
                }}
                onClick={() => (usingRealPlayer() ? void clearRealQueue() : stopPlayback())}
                data-testid="clear-queue-button"
              >
                clear queue
              </button>
            </div>

            <Show when={view().queueRest.length > 0}>
              <ul
                class="mt-4 w-full max-w-md text-left text-sm text-neutral-400"
                data-testid="queue-list"
              >
                <For each={view().queueRest}>
                  {(queued) => (
                    <li
                      class="group flex items-center justify-between gap-2 truncate border-b border-neutral-800 py-1"
                      classList={{ "opacity-60 italic": queued.pending }}
                      data-testid={queued.pending ? "queue-item-pending" : "queue-item"}
                    >
                      <span class="truncate">
                        {queued.title}
                        <Show when={queued.artist}> — {queued.artist}</Show>
                      </span>
                      <span class="flex shrink-0 items-center gap-2">
                        <Show
                          when={!queued.pending}
                          fallback={<span class="font-mono text-xs">resolving…</span>}
                        >
                          <Show when={queued.durationSeconds !== undefined}>
                            <span class="font-mono text-xs">
                              {formatTime(queued.durationSeconds!)}
                            </span>
                          </Show>
                          <button
                            type="button"
                            class="text-neutral-500 transition-opacity hover:text-neutral-300"
                            classList={{
                              "opacity-100": isTouchDevice(),
                              "opacity-0 group-hover:opacity-100": !isTouchDevice(),
                            }}
                            onClick={() => handleRemoveQueueItem(queued.removeIndex!)}
                            aria-label={`remove ${queued.title} from queue`}
                            data-testid="queue-item-remove"
                          >
                            ✕
                          </button>
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>

      {/* browser blocked play() from starting without a user gesture on this
          tab (common right after loading /player/ fresh, before anyone's
          clicked/tapped anything here) - mirrors player.freqhole.net's
          former App.tsx "tap to start playback" overlay. */}
      <Show when={!usingRealPlayer() && engineState() === "blocked"}>
        <div
          class="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center"
          data-testid="playback-blocked"
        >
          <p class="text-lg">
            playback is ready, but the browser blocked it from starting on its own
          </p>
          <button
            type="button"
            class="rounded-lg bg-white px-6 py-3 text-lg font-semibold text-black"
            onClick={() => void retryPlayback()}
            data-testid="resume-playback"
          >
            tap to start playback
          </button>
        </div>
      </Show>

      {/* buffering: a large centered comet-tail ring (same conic-gradient
          palette as QueuePlayerTargetRow's "connecting" ring) + a big,
          easy-to-read-from-across-the-room percentage, rather than the
          small always-there corner text this used to be. */}
      <Show when={!usingRealPlayer() && engineState() === "buffering"}>
        <div
          class="pointer-events-none fixed inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/60"
          data-testid="buffering-indicator"
        >
          <div class="relative h-40 w-40 rounded-full">
            <div
              class="absolute inset-0 rounded-full"
              style={{
                background:
                  "conic-gradient(from 0deg, transparent 0%, #ec489920 6%, #ec489940 12%, #ec489980 20%, #ec4899cc 28%, #ec4899 38%, #c026d3 55%, #a855f7 70%, #a855f7 86%, transparent 88%)",
                mask: "radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 8px))",
                "-webkit-mask":
                  "radial-gradient(farthest-side, transparent calc(100% - 8px), black calc(100% - 8px))",
                animation: "spin 1.5s linear infinite",
              }}
            />
          </div>
          <Show when={downloadProgress() !== null}>
            <p class="font-mono text-[clamp(3rem,10vmin,7rem)] font-bold tabular-nums">
              {Math.round((downloadProgress() ?? 0) * 100)}%
            </p>
          </Show>
        </div>
      </Show>

      <Show when={!usingRealPlayer() && engineError()}>
        <div class="pointer-events-none fixed bottom-4 left-4 z-10 text-sm text-red-400">
          {engineError()}
        </div>
      </Show>
    </div>
  );
}
