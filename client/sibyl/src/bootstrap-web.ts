// browser build wiring. no `@tauri-apps/*` imports anywhere in this
// graph — main.ts dynamic-imports this module only when running
// outside a tauri shell. transport-wasm (midden) is the chunk
// transport here; rodio is replaced by webcodecs + audioworklet.

import {
  SibylPlayer,
  OpfsCache,
  WebcodecsPlayer,
  MP3_DEFAULT,
} from "@sibyl/player";
import { makeWasmTransport } from "@sibyl/player/adapters/transport-wasm";
// the wasm module is bundler-target output of `make -C midden-rs build`.
// vite resolves the `.wasm` import via wasm-pack's generated glue;
// no explicit init() needed for bundler target — the wasm is loaded
// when the first export is touched.
import { MiddenNode } from "sibyl-midden";

import { mountUi, type UiHandlers } from "./ui.js";

function log(msg: string): void {
  const el = document.getElementById("log");
  if (!el) return;
  el.textContent = `${new Date().toISOString().slice(11, 23)}  ${msg}\n${el.textContent ?? ""}`;
}

/** simple <input type=file> based picker. returns an object url so
 *  the rest of the app can treat it like a path. the host path is
 *  not actually meaningful in the web build (no ffmpeg); host buttons
 *  will be disabled until we have a wasm transcoder. */
async function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "audio/*";
    inp.addEventListener("change", () => {
      const f = inp.files?.[0];
      resolve(f ? URL.createObjectURL(f) : null);
    });
    inp.click();
  });
}

export async function boot(): Promise<void> {
  const cache = await OpfsCache.open();

  // initialize the wasm midden node. wasm-pack bundler-target glue
  // auto-loads the wasm on first export touch. node creation
  // negotiates a relay handshake; surface it in the log so the user
  // knows why "load + play" is briefly slow on first click.
  log("[midden] creating iroh node (waiting for relay)…");
  let node: MiddenNode | undefined;
  try {
    node = await MiddenNode.create();
    log(`[midden] node ready: ${node.node_id().slice(0, 16)}…`);
  } catch (e) {
    log(`[midden] node creation failed: ${(e as Error).message}`);
  }

  const transport = makeWasmTransport({ node, logger: log });
  const backend = new WebcodecsPlayer({
    params: MP3_DEFAULT,
    workletUrl: "/playback-worklet.js",
    logger: log,
  });
  const player = new SibylPlayer({ transport, cache, backend, logger: log });

  const handlers: UiHandlers = {
    pickFile,
    hostFile: (path) => player.hostFile(path),
    loadTicket: (t) => player.loadFromTicket(t),
    loadCached: (id) => player.loadFromCache(id),
    play: () => player.play(),
    pause: () => player.pause(),
    pauseDownload: () => player.pauseDownload(),
    resumeDownload: () => player.resumeDownload(),
    setVolume: (v) => player.setVolume(v),

    listCache: () => cache.list(),
    deleteCached: (id) => cache.deleteSong(id),
    clearCache: () => cache.clear(),

    log,
  };

  player.on((e) => {
    // log status/complete/error always; show first/last progress and
    // every 50th to confirm chunks are flowing without spamming.
    if (e.type === "status" || e.type === "complete" || e.type === "error") {
      log(`[player] ${JSON.stringify(e)}`);
    } else if (e.type === "progress") {
      const total = e.chunksTotal ?? 0;
      if (e.chunksHave === 1 || e.chunksHave === total || e.chunksHave % 50 === 0) {
        log(`[player] progress ${e.chunksHave}/${total}`);
      }
    }
  });

  const ui = mountUi(handlers);

  // browser cannot transcode (no native ffmpeg). disable host pick so
  // users get a clear signal instead of a transport-wasm error. peer
  // playback (downloading from a tauri host) still works.
  const pickBtn = document.getElementById("host-pick");
  if (pickBtn instanceof HTMLButtonElement) pickBtn.disabled = true;
  const hostStatus = document.getElementById("host-status");
  if (hostStatus) {
    hostStatus.textContent =
      "host disabled in browser (transcoding requires native ffmpeg \u2014 use the tauri app to host)";
  }

  let lastRefresh = 0;
  const refreshIfStale = (): void => {
    const now = performance.now();
    if (now - lastRefresh < 500) return;
    lastRefresh = now;
    void ui.refreshCache();
  };
  player.on((e) => {
    if (e.type === "progress") {
      ui.updateProgress(e.songId, e.chunksHave, e.chunksTotal);
      refreshIfStale();
    } else if (e.type === "complete") {
      void ui.refreshCache();
    } else if (e.type === "stats") {
      ui.updateStats(e);
    }
  });

  // best-effort: when the user navigates away or hides the tab,
  // flush the in-memory manifest so a reload resumes from the most
  // recent chunk. browsers don't await async work in pagehide, but
  // the OPFS write call posts to its dedicated worker (sync access
  // handle) which is fast enough that most flushes do land.
  // visibilitychange covers mobile/background-tab cases pagehide
  // misses.
  const flushOnExit = (): void => { void player.flush(); };
  window.addEventListener("pagehide", flushOnExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });

  log(
    `[sibyl] booted web (crossOriginIsolated=${
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
    } SAB=${typeof SharedArrayBuffer !== "undefined"})`,
  );
}
