// transport adapter that uses a wasm iroh node (vendored midden).
//
// the demo app (or freqhole) injects a midden module reference at
// construction time — the player package never directly imports
// `midden` or any wasm loader. when no midden is supplied, the
// transport degrades to a clear runtime error so the rest of the
// browser app (cache panel, ui wiring) still boots.

import type { ChunkTransport, RequestOpts } from "../src/transport.js";
import { decodeTicket } from "../src/ticket.js";

/**
 * minimal subset of the midden api the wasm transport needs.
 * mirrors what `client/sibyl/midden-rs` exports. defining it locally
 * keeps player core free of any midden import.
 */
export interface MiddenNodeLike {
  sibyl_download_chunks(
    iroh_ticket: string,
    have_chunks: Uint32Array,
    on_chunk: (seq: number, bytes: Uint8Array, chunks_total: number) => void,
  ): Promise<number>;
}

export interface WasmTransportDeps {
  /** vendored midden node (one per browser tab is plenty). omit to
   *  surface a "not wired" error when the user actually tries to
   *  fetch a ticket. */
  node?: MiddenNodeLike;
  /** optional logger for transport lifecycle events. */
  logger?: (msg: string) => void;
}

export function makeWasmTransport(deps: WasmTransportDeps = {}): ChunkTransport {
  const log = deps.logger ?? (() => {});

  return {
    async host(): Promise<{ ticket: string; songId: string }> {
      throw new Error(
        "wasm transport: host() not supported (browser cannot transcode)",
      );
    },

    async request(ticketStr: string, opts: RequestOpts) {
      const t = decodeTicket(ticketStr);
      const requestId = `wasm-${t.song_id}-${Date.now()}`;
      let canceled = false;

      if (!deps.node) {
        // run the request lazily so callers can still wire ui +
        // subscribe to the resulting error event.
        queueMicrotask(() => {
          if (canceled) return;
          opts.onError?.(
            new Error(
              "wasm transport: midden node not injected (build wasm via `make -C midden-rs build` and pass `node` to makeWasmTransport)",
            ),
          );
        });
        return { requestId, cancel: () => { canceled = true; } };
      }

      log(`[wasm-transport] request ${requestId} starting (have=${(opts.haveChunks ?? []).length} cached)`);
      const node = deps.node;
      const haveBuf = new Uint32Array(opts.haveChunks ?? []);
      let chunkCount = 0;
      let byteCount = 0;
      const startedAt = performance.now();
      void (async () => {
        try {
          await node.sibyl_download_chunks(
            t.iroh_ticket,
            haveBuf,
            (seq, bytes, chunks_total) => {
              if (canceled) return;
              chunkCount += 1;
              byteCount += bytes.byteLength;
              if (chunkCount === 1) {
                log(`[wasm-transport] first chunk in ${Math.round(performance.now() - startedAt)}ms (seq=${seq}, total=${chunks_total})`);
              } else if (chunkCount % 50 === 0) {
                log(`[wasm-transport] ${chunkCount}/${chunks_total} chunks (${(byteCount/1024).toFixed(0)} KB)`);
              }
              opts.onChunk({
                seq,
                bytes,
                frame_count: 0,
                chunks_total,
              });
            },
          );
          if (!canceled) {
            log(`[wasm-transport] complete: ${chunkCount} chunks, ${(byteCount/1024).toFixed(0)} KB in ${Math.round(performance.now() - startedAt)}ms`);
            opts.onComplete?.();
          }
        } catch (e) {
          if (!canceled) {
            log(`[wasm-transport] FAILED after ${chunkCount} chunks: ${(e as Error).message}`);
            opts.onError?.(e as Error);
          }
        }
      })();

      return { requestId, cancel: () => { canceled = true; } };
    },

    async nodeInfo() {
      return { nodeId: "wasm-iroh-node" };
    },
  };
}
