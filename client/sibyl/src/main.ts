// sibyl demo app entry point. **scaffolding** — disposable wiring.
// the real player logic lives in `@sibyl/player`.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  SibylPlayer,
  OpfsCache,
  WebcodecsPlayer,
  RodioPlayer,
  type IpcInvoke,
  type SibylRequest,
  type SibylResponse,
  MP3_DEFAULT,
} from "@sibyl/player";
import { makeTauriTransport } from "@sibyl/player/adapters/transport-tauri";

import { mountUi, type UiHandlers } from "./ui.js";

// -- detect whether we're in tauri or pure browser ------------------------

const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;

// -- build the IpcInvoke + EventSubscribe adapters ------------------------

const invoke: IpcInvoke = async (req: SibylRequest): Promise<SibylResponse> => {
  return (await tauriInvoke("sibyl_call", { req })) as SibylResponse;
};

const subscribe = async <T>(
  event: "sibyl://chunk" | "sibyl://status",
  handler: (payload: T) => void,
): Promise<() => void> => {
  const un = await listen<T>(event, (e) => handler(e.payload));
  return un;
};

// -- pick playback backend ------------------------------------------------
// tauri build → rodio (webkit2gtk has no AudioDecoder)
// web build   → webcodecs

async function buildPlayer(): Promise<SibylPlayer> {
  const cache = await OpfsCache.open();
  const transport = makeTauriTransport({ invoke, subscribe });

  const backend = isTauri
    ? new RodioPlayer(invoke)
    : new WebcodecsPlayer({
        params: MP3_DEFAULT,
        workletUrl: "/playback-worklet.js",
      });

  return new SibylPlayer({
    transport,
    cache,
    backend,
    logger: (m) => log(m),
  });
}

// -- ui glue --------------------------------------------------------------

function log(msg: string): void {
  const el = document.getElementById("log");
  if (!el) return;
  el.textContent = `${new Date().toISOString().slice(11, 23)}  ${msg}\n${el.textContent ?? ""}`;
}

window.addEventListener("DOMContentLoaded", async () => {
  const player = await buildPlayer();
  const cache = await OpfsCache.open();

  const handlers: UiHandlers = {
    pickFile: () =>
      openDialog({
        multiple: false,
        filters: [{ name: "audio", extensions: ["mp3", "flac", "wav", "m4a", "ogg", "opus"] }],
      }) as Promise<string | null>,

    hostFile: (path) => player.hostFile(path),
    loadTicket: (t) => player.loadFromTicket(t),
    loadCached: (id) => player.loadFromCache(id),
    play: () => player.play(),
    pause: () => player.pause(),
    setVolume: (v) => player.setVolume(v),

    listCache: () => cache.list(),
    deleteCached: (id) => cache.deleteSong(id),
    clearCache: () => cache.clear(),

    log,
  };

  player.on((e) => log(`event: ${JSON.stringify(e)}`));

  mountUi(handlers);
  log(
    `[sibyl] booted (tauri=${isTauri} crossOriginIsolated=${
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
    } SAB=${typeof SharedArrayBuffer !== "undefined"})`,
  );
});
