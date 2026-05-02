// transport adapter that uses the sibyl tauri ipc dispatcher
// (`sibyl_call`) plus tauri events (`sibyl://chunk`).
//
// the `IpcInvoke` and `EventSubscribe` adapters are passed in by the
// host application — this file never imports `@tauri-apps/api`.

import type { ChunkTransport, RequestOpts } from "../src/transport.js";
import type { IpcInvoke, EventSubscribe } from "../src/ipc.js";

interface ChunkEventPayload {
  request_id: string;
  seq: number;
  bytes: number[] | Uint8Array;
  chunks_total?: number;
}

export interface TauriTransportDeps {
  invoke: IpcInvoke;
  subscribe: EventSubscribe;
}

export function makeTauriTransport(deps: TauriTransportDeps): ChunkTransport {
  const { invoke, subscribe } = deps;

  return {
    async host({ sourcePath, songId, title }) {
      const r = await invoke({
        kind: "host_file",
        path: sourcePath,
        song_id: songId,
        title,
      });
      if (r.kind !== "ticket") throw new Error("unexpected response: " + r.kind);
      return { ticket: r.ticket, songId: r.song_id };
    },

    async request(ticket, opts: RequestOpts) {
      const r = await invoke({
        kind: "request_ticket",
        ticket,
        have_chunks: opts.haveChunks ?? [],
      });
      if (r.kind !== "request_started") {
        throw new Error("unexpected response: " + r.kind);
      }
      const requestId = r.request_id;

      const unsub = await subscribe<ChunkEventPayload>(
        "sibyl://chunk",
        (p) => {
          if (p.request_id !== requestId) return;
          const bytes = p.bytes instanceof Uint8Array
            ? p.bytes
            : new Uint8Array(p.bytes);
          opts.onChunk({
            seq: p.seq,
            bytes,
            // frame count is decoded later from the bytes themselves
            frame_count: 0,
            chunks_total: p.chunks_total,
          });
        },
      );

      return {
        requestId,
        cancel: () => {
          void invoke({ kind: "cancel_request", request_id: requestId });
          unsub();
        },
      };
    },

    async nodeInfo() {
      const r = await invoke({ kind: "node_info" });
      if (r.kind !== "node_info") throw new Error("unexpected: " + r.kind);
      return { nodeId: r.node_id };
    },
  };
}
