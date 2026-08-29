import { createResource, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { getPlayerNode } from "./midden/node";
import { startAcceptLoop } from "./midden/acceptLoop";
import { currentPin } from "./pairing/pinStore";
import { renderPlayerQr } from "./qr/qrCode";
import {
  nowPlaying,
  upcomingQueue,
  mediaKind,
  mediaElement,
  engineState,
  downloadProgress,
  retryPlayback,
  playbackPosition,
  playbackDuration,
  queueItemStatus,
  pause as pausePlayback,
  resume as resumePlayback,
  skip as skipTrack,
} from "./playback/playbackEngine";
import { connectedControllers } from "./control/connectedControllers";
import { commandInFlight } from "./control/dispatcher";
import { activityRamp } from "./control/activityIndicator";
import {
  radioState,
  radioNowPlaying,
  radioStationId,
  radioListenerCount,
} from "./playback/radioClient";
import { deviceName, loadDeviceName } from "./settings/deviceNameStore";
import { develMode, loadDevelMode, setDevelMode } from "./settings/develModeStore";
import { installConsoleCapture } from "./debug/consoleCapture";
import DebugOverlay from "./debug/DebugOverlay";
import SettingsPanel from "./settings/SettingsPanel";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  onMount(() => {
    installConsoleCapture();
    void loadDeviceName();
    void loadDevelMode();

    // "s" toggles settings open/closed, "d" toggles devel mode (console-log
    // debug overlay), escape closes settings - "s"/"d" are both ignored while
    // typing in a form field (e.g. the device name input inside settings
    // itself); escape always closes, even from a form field, since that's
    // the conventional "back out" key.
    const onKeyDown = (e: KeyboardEvent) => {
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
  });

  const [node] = createResource(async () => {
    const playerNode = await getPlayerNode();
    startAcceptLoop(playerNode);
    return playerNode;
  });

  const [qrDataUrl] = createResource(
    () => (node() ? ({ playerNode: node()!, name: deviceName() } as const) : undefined),
    async ({ playerNode, name }) =>
      renderPlayerQr({
        node_id: playerNode.node_id(),
        name,
        role: "player_remote",
      }),
  );

  // `nowPlaying()` flips true the instant playItem() starts (before any
  // media has actually loaded - see playbackEngine.ts's playItem), so
  // gating the pairing/qr view on `!nowPlaying()` alone unmounted it (and
  // the activity spinner along with it) before the spinner ever got a
  // chance to render for a fresh play/append/replace command. keep it
  // mounted through the rest of that in-flight command too - see the
  // matching `!commandInFlight()` guard on the audio now-playing view
  // below, which keeps the two mutually exclusive.
  const showPairingView = () => !nowPlaying() || commandInFlight();

  return (
    <div class="h-screen flex flex-col items-center justify-center gap-6 p-6 text-center overflow-y-auto">
      {/* video playback surface; stays in the DOM (just hidden) for audio so
          the same <video> element keeps driving playback. the video itself
          is `position: fixed` and sized directly from JS to the visual
          viewport (see playbackEngine.ts's applyViewportSize) - this div
          just supplies the black backdrop, stacking, and hide toggle.
          always full window, even in devel mode - DebugOverlay renders on
          top (own higher z-index, semi-transparent background) instead of
          shrinking the video into a side panel. */}
      <div
        class="fixed inset-0 z-50 bg-black"
        classList={{ hidden: !(nowPlaying() && mediaKind() === "video") }}
        data-testid="video-overlay"
      >
        {mediaElement}
      </div>

      <Show when={develMode()}>
        <DebugOverlay />
      </Show>

      <button
        type="button"
        class="fixed top-4 right-4 z-30 text-neutral-500 text-xs"
        onClick={() => setSettingsOpen(true)}
        data-testid="settings-toggle"
      >
        settings
      </button>

      <Show when={connectedControllers().length > 0}>
        <div
          class="fixed top-10 right-4 z-30 text-xs text-neutral-500 text-right max-w-[40vw]"
          data-testid="connected-controllers"
        >
          connected:{" "}
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

      {/* autoplay was blocked by the browser - needs a real user gesture to resume. */}
      <Show when={engineState() === "blocked"}>
        <div class="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p class="text-lg">
            playback is ready, but the browser blocked it from starting on its own
          </p>
          <button
            type="button"
            class="px-6 py-3 rounded-lg bg-white text-black text-lg font-semibold"
            onClick={() => void retryPlayback()}
            data-testid="resume-playback"
          >
            tap to start playback
          </button>
        </div>
      </Show>

      {/* buffering / download progress, shown regardless of audio vs video kind. */}
      <Show when={engineState() === "buffering"}>
        <div
          class="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-black/80 rounded-lg px-4 py-2 text-sm"
          data-testid="buffering-indicator"
        >
          <Show when={downloadProgress() !== null} fallback={<p>buffering...</p>}>
            <p>downloading... {Math.round((downloadProgress() ?? 0) * 100)}%</p>
          </Show>
        </div>
      </Show>
      <Show when={settingsOpen()}>
        <SettingsPanel onClose={() => setSettingsOpen(false)} nodeId={node()?.node_id()} />
      </Show>

      <Show when={showPairingView()}>
        {/* note commenting out device name for a bit, will come back, soon */}
        {/* <h1 class="text-2xl font-semibold">{deviceName()}</h1> */}

        <Show when={node.loading}>
          <p class="text-sm text-neutral-400">initializing p2p node...</p>
        </Show>

        <Show when={node()}>
          <Show when={qrDataUrl()}>
            {(url) => (
              <div class="relative w-[min(70vmin,900px)] h-[min(70vmin,900px)] shrink-0">
                <img
                  src={url()}
                  alt="pairing qr code"
                  class="w-full h-full"
                  data-testid="pairing-qr"
                />
                {/* the logo baked into the qr's center (see qrCode.ts) is a
                    static raster composite - it can't be animated directly.
                    layer an identical-looking, independently-animatable
                    overlay exactly on top of it instead: same backing
                    square + same logo asset, spun via css. visible while a
                    command is in flight (full speed, see dispatcher.ts's
                    commandInFlight) or for IDLE_TIMEOUT_MS after the last
                    real client command (see activityIndicator.ts) -
                    ramping down smoothly rather than snapping straight to
                    hidden, so a paired-but-idle controller that never
                    queues anything eventually goes fully quiet again.
                    hidden otherwise, revealing the static baked-in logo
                    underneath. */}
                <Show when={commandInFlight() || activityRamp() !== null}>
                  <div
                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black flex items-center justify-center"
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
            class="font-mono tracking-widest shrink-0 text-[clamp(2rem,9vmin,6rem)]"
            data-testid="pairing-pin"
          >
            {currentPin()}
          </p>
        </Show>
      </Show>

      <Show when={mediaKind() === "audio" && !commandInFlight() ? nowPlaying() : null}>
        {(item) => (
          <div class="flex flex-col items-center gap-4 w-full max-w-md" data-testid="now-playing">
            <Show
              when={item().artwork_full_url}
              fallback={
                <div
                  class="w-64 h-64 rounded-lg bg-neutral-800 flex items-center justify-center"
                  data-testid="artwork-fallback"
                >
                  <svg
                    viewBox="0 0 24 24"
                    class="w-20 h-20 text-neutral-600"
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
                <img src={url()} alt="" class="w-64 h-64 rounded-lg object-cover shadow-lg" />
              )}
            </Show>

            <p class="text-xl font-semibold" data-testid="now-playing-title">
              {item().title ?? "unknown title"}
            </p>
            <p class="text-sm text-neutral-400" data-testid="now-playing-artist">
              {item().artist ?? ""}
            </p>
            <p class="text-xs text-neutral-500 font-mono" data-testid="now-playing-time">
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
                onClick={() => node() && void skipTrack(node()!)}
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
                    <li class="flex items-center justify-between gap-2 truncate py-1 border-b border-neutral-800">
                      <span class="truncate">
                        {queued.title ?? queued.blake3_hash.slice(0, 12)}
                        <Show when={queued.artist}> — {queued.artist}</Show>
                      </span>
                      <Show when={queued.duration_ms}>
                        {(ms) => {
                          const status = () => queueItemStatus().get(queued.blake3_hash);
                          return (
                            <span class="shrink-0 flex flex-col items-end gap-0.5">
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
                                <span class="w-8 h-0.5 overflow-hidden rounded-full bg-neutral-700">
                                  <span class="block w-full h-full bg-neutral-400 animate-[bounce-bar_2s_ease-in-out_infinite]" />
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

      <Show when={!nowPlaying() && radioState() !== "idle"}>
        <div class="flex flex-col items-center gap-2" data-testid="radio-panel">
          <p class="text-xs uppercase tracking-widest text-neutral-500" data-testid="radio-state">
            radio - {radioState()}
          </p>
          <Show when={radioStationId()}>
            {(id) => <p class="text-sm text-neutral-400">{id()}</p>}
          </Show>
          <Show when={radioNowPlaying()}>
            {(np) => (
              <>
                <p class="text-xl font-semibold" data-testid="radio-title">
                  {np().title}
                </p>
                <Show when={np().artist}>
                  <p class="text-sm text-neutral-400">{np().artist}</p>
                </Show>
              </>
            )}
          </Show>
          <Show when={radioListenerCount() !== null}>
            <p class="text-xs text-neutral-500">{radioListenerCount()} listening</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
