// the chunk transport interface — every transport implementation
// (tauri, wasm/midden, future webrtc/etc) implements this exact shape.
// the player core depends only on this type, never on a concrete impl.

import type { ChunkRecord } from "./types.js";

export type ChunkHandler = (chunk: ChunkRecord) => void;

export interface RequestOpts {
  onChunk: ChunkHandler;
  onComplete?: () => void;
  onError?: (err: Error) => void;
  /** chunks already cached locally; transport should skip them. */
  haveChunks?: number[];
}

export interface ChunkTransport {
  /** publish a local file as a sibyl-format collection. */
  host(opts: {
    sourcePath: string;
    songId?: string;
    title?: string;
  }): Promise<{ ticket: string; songId: string }>;

  /** subscribe to chunks for a ticket. returns a cancel handle. */
  request(
    ticket: string,
    opts: RequestOpts,
  ): Promise<{ requestId: string; cancel: () => void }>;

  /** identifier for the local node (logs/ui). */
  nodeInfo(): Promise<{ nodeId: string }>;
}
