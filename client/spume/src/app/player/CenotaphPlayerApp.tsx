// spume's `/player/` route (phase 6): turns this browser tab into a
// remote-controllable playback target. NOT a separate build/deploy - just
// a pathname branch inside spume's normal `index.tsx` bootstrap (see that
// file). renders a full-screen pairing QR until a controller pairs, then
// hands the screen over to cenotaph's own `mediaPlaybackBackend` (its
// dedicated `<video>` element, reused verbatim - same instance the accept
// loop's command dispatcher already drives via
// `acceptModeBootstrap.ts`/`createPlayerConnectionHandler`).
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
  queueItemStatus,
  resume as resumePlayback,
  retryPlayback,
  setDevelMode,
  skip as skipTrack,
  upcomingQueue,
  type MediaPlaybackNode,
} from "@freqhole/cenotaph";
import { spumeTrustStore } from "../services/remotePlayback/trustStoreAdapter";
import { getMiddenNode } from "../api/client";

import { getLocalLibraryName } from "../services/storage/db";
import {
  remotePlaybackEnabled,
  setRemotePlaybackEnabled,
} from "../services/remotePlayback/remoteModeSettings";
import { PlayerDebugOverlay } from "./PlayerDebugOverlay";
import { PlayerSettingsPanel } from "./PlayerSettingsPanel";
import { renderPlayerQr } from "./renderPairingQr";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function CenotaphPlayerApp() {
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [nodeId, setNodeId] = createSignal<string | undefined>(undefined);
  // kept (not just its id) so the skip button can drive the next download.
  const [middenNode, setMiddenNode] = createSignal<MediaPlaybackNode | null>(null);
  // no trusted controllers yet => the pin currently shown is this
  // player's admin-bootstrap invite (see docs/player-peer-trust-bridge-plan.md).
  const [controllers] = createResource(spumeTrustStore.listTrustedControllers);
  const isAdminBootstrapPin = () =>
    (controllers()?.length ?? 0) === 0 || currentSession()?.admin_grant_pending === true;

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
    createEffect(() => {
      broadcastPresence({
        type: "presence",
        state: remotePlaybackEnabled() ? "active" : "stopped",
      });
    });
    onCleanup(() => broadcastPresence({ type: "presence", state: "stopped" }));

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

  const showPairingScreen = () => engineState() === "idle" && nowPlaying() === null;

  return (
    <div class="flex h-screen flex-col items-center justify-center gap-6 overflow-y-auto bg-black p-6 text-center text-white">
      <Show when={develMode()}>
        <PlayerDebugOverlay />
      </Show>

      <button
        type="button"
        class="fixed top-4 right-4 z-30 text-xs text-neutral-500"
        onClick={() => setSettingsOpen(true)}
        data-testid="settings-toggle"
      >
        settings
      </button>

      <Show when={settingsOpen()}>
        <PlayerSettingsPanel onClose={() => setSettingsOpen(false)} nodeId={nodeId()} />
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
                  revealing the static logo underneath. */}
                <Show when={commandInFlight() || activityRamp() !== null}>
                  <div
                    class="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-black"
                    style={{ width: "28.6%", height: "28.6%" }}
                    data-testid="pairing-qr-loading"
                  >
                    <img
                      src="/freqhole.svg"
                      alt=""
                      class="spin-ramp"
                      style={{
                        width: "77%",
                        height: "77%",
                        "animation-duration": `${0.6 + 2.4 * (commandInFlight() ? 0 : (activityRamp() ?? 1))}s`,
                      }}
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

      {/* now playing: album art, title/artist, time, transport controls,
          and the rest of the queue - mirrors player.freqhole.net's former
          App.tsx now-playing view (see this file's header comment). hidden
          while a command is in flight (see playbackEngine.ts's own
          showPairingView note in the prior prototype) so it doesn't flash
          stale info between queue replace/append commands. */}
      <Show when={mediaKind() === "audio" && !commandInFlight() ? nowPlaying() : null}>
        {(item) => (
          <div class="flex w-full max-w-md flex-col items-center gap-4" data-testid="now-playing">
            <Show
              when={item().artwork_full_url}
              fallback={
                <div
                  class="flex h-64 w-64 items-center justify-center rounded-lg bg-neutral-800"
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
              {(url) => (
                <img src={url()} alt="" class="h-64 w-64 rounded-lg object-cover shadow-lg" />
              )}
            </Show>

            <p class="text-xl font-semibold" data-testid="now-playing-title">
              {item().title ?? "unknown title"}
            </p>
            <p class="text-sm text-neutral-400" data-testid="now-playing-artist">
              {item().artist ?? ""}
            </p>
            <p class="font-mono text-xs text-neutral-500" data-testid="now-playing-time">
              {formatTime(playbackPosition())} /{" "}
              {formatTime(item().duration_ms ? item().duration_ms! / 1000 : playbackDuration())}
            </p>

            <div class="flex items-center gap-8" data-testid="playback-controls">
              <button
                type="button"
                class="text-3xl leading-none"
                onClick={() => (engineState() === "playing" ? pausePlayback() : resumePlayback())}
                data-testid="play-pause-button"
              >
                {engineState() === "playing" ? "⏸" : "▶"}
              </button>
              <button
                type="button"
                class="text-3xl leading-none"
                onClick={() => middenNode() && void skipTrack(middenNode()!)}
                data-testid="skip-button"
              >
                ⏭
              </button>
            </div>

            <Show when={upcomingQueue().length > 1}>
              <ul
                class="mt-4 w-full max-w-md text-left text-sm text-neutral-400"
                data-testid="queue-list"
              >
                <For each={upcomingQueue().slice(1)}>
                  {(queued) => (
                    <li class="flex items-center justify-between gap-2 truncate border-b border-neutral-800 py-1">
                      <span class="truncate">
                        {queued.title ?? queued.blake3_hash.slice(0, 12)}
                        <Show when={queued.artist}> — {queued.artist}</Show>
                      </span>
                      <Show when={queued.duration_ms}>
                        {(ms) => {
                          const status = () => queueItemStatus().get(queued.blake3_hash);
                          return (
                            <span class="flex shrink-0 flex-col items-end gap-0.5">
                              <span
                                class="font-mono text-xs"
                                classList={{ underline: status() === "ready" }}
                              >
                                {formatTime(ms() / 1000)}
                              </span>
                              {/* mirrors spume's queue-sidebar "loading underline" indicator -
                                  see QueueSongRow.tsx - while a queued item is being prefetched
                                  in the background. */}
                              <Show when={status() === "loading"}>
                                <span class="h-0.5 w-8 overflow-hidden rounded-full bg-neutral-700">
                                  <span class="block h-full w-full animate-[bounce-bar_2s_ease-in-out_infinite] bg-neutral-400" />
                                </span>
                              </Show>
                            </span>
                          );
                        }}
                      </Show>
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
      <Show when={engineState() === "blocked"}>
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
      <Show when={engineState() === "buffering"}>
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

      <Show when={engineError()}>
        <div class="pointer-events-none fixed bottom-4 left-4 z-10 text-sm text-red-400">
          {engineError()}
        </div>
      </Show>
    </div>
  );
}
