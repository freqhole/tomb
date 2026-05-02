// ChunkCache adapter that talks to the sibyl tauri ipc dispatcher.
//
// mirrors `transport-tauri.ts`: the host app supplies an `IpcInvoke`
// (which internally calls `@tauri-apps/api/core::invoke`) and this
// adapter never touches `@tauri-apps/api` directly.
//
// rust side: `client/sibyl/src-tauri/src/cache.rs` writes into
// `<app_data_dir>/sibyl/cache/songs/<song_id>/`. used by the tauri
// build because webkit2gtk's OPFS lacks both `createSyncAccessHandle`
// and `createWritable`.

import type { ChunkCache } from "../src/cache.js";
import type { IpcInvoke, TauriCachedSongRow } from "../src/ipc.js";
import type { CachedSong, Manifest } from "../src/types.js";

export interface TauriCacheDeps {
  invoke: IpcInvoke;
}

export function makeTauriCache(deps: TauriCacheDeps): ChunkCache {
  const { invoke } = deps;

  return {
    async manifest(songId) {
      const r = await invoke({ kind: "cache_manifest", song_id: songId });
      if (r.kind !== "manifest") throw new Error("unexpected: " + r.kind);
      return r.manifest;
    },

    async writeManifest(m: Manifest) {
      const r = await invoke({ kind: "cache_write_manifest", manifest: m });
      if (r.kind !== "ok") throw new Error("unexpected: " + r.kind);
    },

    async hasChunk(songId, seq) {
      const r = await invoke({ kind: "cache_has_chunk", song_id: songId, seq });
      if (r.kind !== "has_chunk") throw new Error("unexpected: " + r.kind);
      return r.has;
    },

    async readChunk(songId, seq) {
      const r = await invoke({ kind: "cache_read_chunk", song_id: songId, seq });
      if (r.kind !== "chunk_bytes") throw new Error("unexpected: " + r.kind);
      return r.bytes ? new Uint8Array(r.bytes) : null;
    },

    async writeChunk(songId, seq, bytes) {
      // tauri json bridge serializes Vec<u8> as a number array. for
      // larger blobs we'd want the streaming `Channel` api, but chunk
      // sizes here are kilobytes — fine to copy.
      const r = await invoke({
        kind: "cache_write_chunk",
        song_id: songId,
        seq,
        bytes: Array.from(bytes),
      });
      if (r.kind !== "ok") throw new Error("unexpected: " + r.kind);
    },

    async list(): Promise<CachedSong[]> {
      const r = await invoke({ kind: "cache_list" });
      if (r.kind !== "cached_songs") throw new Error("unexpected: " + r.kind);
      return r.songs.map(rowToCachedSong);
    },

    async deleteSong(songId) {
      const r = await invoke({ kind: "cache_delete_song", song_id: songId });
      if (r.kind !== "ok") throw new Error("unexpected: " + r.kind);
    },

    async clear() {
      const r = await invoke({ kind: "cache_clear" });
      if (r.kind !== "ok") throw new Error("unexpected: " + r.kind);
    },
  };
}

function rowToCachedSong(row: TauriCachedSongRow): CachedSong {
  // bytes column on disk requires stat-ing every chunk; skip for now
  // (the panel only uses chunk_count + manifest presence anyway).
  // when freqhole pulls this in it can extend the rust list() to
  // return on-disk bytes if needed.
  const m: Manifest = row.manifest ?? {
    song_id: row.song_id,
    params: {
      sample_rate: 44_100,
      channels: 2,
      bitrate_kbps: 192,
      frames_per_chunk: 40,
    },
    chunks_have: row.have_chunks,
    title: undefined,
    created_at: 0,
  };
  return {
    song_id: row.song_id,
    title: m.title,
    bytes: 0,
    chunk_count: row.have_chunks.length,
    manifest: m,
  };
}
