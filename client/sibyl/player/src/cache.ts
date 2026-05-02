// ChunkCache: storage interface used by SibylPlayer for persisted
// chunks + manifest + cached-songs listing.
//
// adapters live alongside this file (browser: opfs-cache.ts; tauri:
// adapters/cache-tauri.ts). keeping the surface tiny so freqhole can
// drop in its own implementation when integrating sibyl.

import type { CachedSong, Manifest } from "./types.js";

export interface ChunkCache {
  manifest(songId: string): Promise<Manifest | null>;
  writeManifest(m: Manifest): Promise<void>;
  hasChunk(songId: string, seq: number): Promise<boolean>;
  readChunk(songId: string, seq: number): Promise<Uint8Array | null>;
  writeChunk(songId: string, seq: number, bytes: Uint8Array): Promise<void>;
  list(): Promise<CachedSong[]>;
  deleteSong(songId: string): Promise<void>;
  clear(): Promise<void>;
}
