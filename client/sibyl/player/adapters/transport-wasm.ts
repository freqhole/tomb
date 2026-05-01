// transport adapter that uses a wasm iroh node (vendored midden).
//
// this file is a stub for phase 4. it expects the demo app (or
// freqhole) to inject a midden module reference at construction time
// — the player package never directly imports `midden` or any wasm
// loader.

import type { ChunkTransport, RequestOpts } from "../src/transport.js";
import { decodeTicket } from "../src/ticket.js";

/**
 * minimal subset of the midden api the wasm transport needs.
 * mirrors what `client/sibyl/midden-rs` will export. defining it
 * locally keeps player core free of any midden import.
 */
export interface MiddenLike {
  download_verified_streaming(
    peer_addr: string,
    hash: string,
    on_chunk: (seq: number, bytes: Uint8Array) => void,
  ): Promise<void>;
}

export interface WasmTransportDeps {
  midden: MiddenLike;
}

export function makeWasmTransport(deps: WasmTransportDeps): ChunkTransport {
  return {
    async host(): Promise<{ ticket: string; songId: string }> {
      throw new Error("wasm transport: host() not supported (browser cannot transcode)");
    },

    async request(ticketStr: string, opts: RequestOpts) {
      const t = decodeTicket(ticketStr);
      // todo (phase 4): split ticket.iroh_ticket into (peer_addr, hash)
      // by calling a midden-side parser, then:
      //   await deps.midden.download_verified_streaming(peer_addr, hash, on_chunk)
      const requestId = `wasm-${t.song_id}-${Date.now()}`;
      let canceled = false;
      const _ = deps; // satisfy lint
      void (async () => {
        try {
          // placeholder; replaced in phase 4
          opts.onComplete?.();
        } catch (e) {
          if (!canceled) opts.onError?.(e as Error);
        }
      })();
      return {
        requestId,
        cancel: () => {
          canceled = true;
        },
      };
    },

    async nodeInfo() {
      return { nodeId: "wasm-iroh-node" };
    },
  };
}
