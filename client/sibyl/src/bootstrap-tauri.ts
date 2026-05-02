// tauri build wiring. all `@tauri-apps/*` imports live here so the
// web bundle can be tree-shaken clean. main.ts dynamic-imports this
// module only when running inside a tauri shell.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  SibylPlayer,
  RodioPlayer,
  type IpcInvoke,
  type SibylRequest,
  type SibylResponse,
} from "@sibyl/player";
import { makeTauriTransport } from "@sibyl/player/adapters/transport-tauri";
import { makeTauriCache } from "@sibyl/player/adapters/cache-tauri";

import { mountUi, type UiHandlers } from "./ui.js";

const invoke: IpcInvoke = async (req: SibylRequest): Promise<SibylResponse> => {
  return (await tauriInvoke("sibyl_call", { req })) as SibylResponse;
};

async function subscribe<T>(
  event: "sibyl://chunk" | "sibyl://status",
  handler: (payload: T) => void,
): Promise<() => void> {
  const un = await listen<T>(event, (e) => handler(e.payload));
  return un;
}

function log(msg: string): void {
  const el = document.getElementById("log");
  if (!el) return;
  el.textContent = `${new Date().toISOString().slice(11, 23)}  ${msg}\n${el.textContent ?? ""}`;
}

export async function boot(): Promise<void> {
  // disk cache via ipc — webkit2gtk's OPFS lacks both
  // createSyncAccessHandle and createWritable, so we cannot use
  // OpfsCache here. rust writes into <app_data_dir>/sibyl/cache/.
  const cache = makeTauriCache({ invoke });
  const transport = makeTauriTransport({ invoke, subscribe });
  const backend = new RodioPlayer(invoke);
  const player = new SibylPlayer({ transport, cache, backend, logger: log });

  const handlers: UiHandlers = {
    pickFile: () =>
      openDialog({
        multiple: false,
        filters: [
          { name: "audio", extensions: ["mp3", "flac", "wav", "m4a", "ogg", "opus"] },
        ],
      }) as Promise<string | null>,

    hostFile: (path) => player.hostFile(path),
    loadTicket: (t) => player.loadFromTicket(t),
    // tauri rodio plays a path. assemble cached chunks into a single
    // file then hand it to rodio (the player's chunk-fed playback
    // path only exists for the webcodecs backend).
    loadCached: async (id) => {
      const r = await invoke({ kind: "cache_assemble_song", song_id: id });
      if (r.kind !== "assembled_path") {
        throw new Error(`assemble: unexpected response ${r.kind}`);
      }
      const r2 = await invoke({ kind: "rodio_load", paths: [r.path] });
      if (r2.kind !== "rodio_total_secs") {
        throw new Error(`rodio: load returned ${r2.kind}`);
      }
    },
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

  // log only the chunky lifecycle events; chunk/progress/stats fire
  // hundreds of times per song and would drown out anything useful.
  player.on((e) => {
    if (e.type === "status" || e.type === "complete" || e.type === "error") {
      log(`[player] ${JSON.stringify(e)}`);
    }
  });

  const ui = mountUi(handlers);

  // hook player events back into the cached-songs panel + progress
  // bar. throttle refreshCache to avoid hammering opfs on every chunk.
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
      // tauri rodio decodes a path, not a chunk stream. assemble the
      // cached chunks into one mp3 and load it. rodio handles play
      // automatically once `rodio_load` returns.
      void (async () => {
        try {
          const r = await invoke({
            kind: "cache_assemble_song",
            song_id: e.songId,
          });
          if (r.kind !== "assembled_path") {
            log(`assemble: unexpected response ${r.kind}`);
            return;
          }
          const r2 = await invoke({ kind: "rodio_load", paths: [r.path] });
          if (r2.kind === "rodio_total_secs") {
            log(`rodio: loaded ${r.path} (${r2.secs.toFixed(1)}s)`);
          } else {
            log(`rodio: load returned ${r2.kind}`);
          }
        } catch (err) {
          log(`assemble/play error: ${(err as Error).message}`);
        }
      })();
    } else if (e.type === "stats") {
      ui.updateStats(e);
    }
  });

  // host transcode progress: emitted by the rust host loop while
  // ffmpeg is still chewing through the source. shows up in the host
  // status row before the ticket is ready.
  type HostProgress = {
    kind: "host_progress";
    song_id: string;
    chunks_published: number;
  };
  type HostComplete = {
    kind: "host_complete";
    song_id: string;
    chunks_total: number;
  };
  type PeerError = { kind: "peer_error"; request_id: string; error: string };
  void subscribe<HostProgress | HostComplete | PeerError>(
    "sibyl://status",
    (p) => {
      if (p.kind === "host_progress") {
        ui.updateHostProgress(p.song_id, p.chunks_published);
      } else if (p.kind === "host_complete") {
        ui.updateHostProgress(p.song_id, p.chunks_total);
        log(`host complete: ${p.song_id} (${p.chunks_total} chunks)`);
      } else if (p.kind === "peer_error") {
        log(`peer error (${p.request_id}): ${p.error}`);
      }
    },
  );

  log(
    `[sibyl] booted tauri (crossOriginIsolated=${
      typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
    } SAB=${typeof SharedArrayBuffer !== "undefined"})`,
  );

  // flush manifest on window hide/close so a tauri restart resumes
  // from the latest chunk we wrote.
  const flushOnExit = (): void => { void player.flush(); };
  window.addEventListener("pagehide", flushOnExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });
}
