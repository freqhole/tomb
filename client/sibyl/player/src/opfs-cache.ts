// opfs cache: chunk-level storage keyed by song id.
//
// directory layout in OPFS root (chosen for portability into freqhole):
//   /sibyl/songs/<song_id>/manifest.json
//   /sibyl/songs/<song_id>/chunks/<seq>.mp3
//
// writes happen inside a dedicated worker via
// `FileSystemSyncAccessHandle` (sync handle = much faster than the
// async createWritable() path used elsewhere in spume). reads are
// async-handle based so the main thread can drive playback without
// blocking.

import type { CachedSong, Manifest } from "./types.js";
import type { ChunkCache } from "./cache.js";

export class OpfsCache implements ChunkCache {
  private root: FileSystemDirectoryHandle;
  private worker?: Worker;
  private nextMsgId = 1;
  private pending = new Map<number, {
    resolve: () => void;
    reject: (e: Error) => void;
  }>();

  private constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  /** open `/sibyl/` under the OPFS root, creating it if needed.
   *
   * also spawns the chunk-write worker. failure to spawn the worker
   * is non-fatal \u2014 writes fall back to the main-thread async path.
   */
  static async open(): Promise<OpfsCache> {
    const opfs = await navigator.storage.getDirectory();
    const root = await opfs.getDirectoryHandle("sibyl", { create: true });
    await root.getDirectoryHandle("songs", { create: true });
    const cache = new OpfsCache(root);
    cache.spawnWorker();
    return cache;
  }

  private spawnWorker(): void {
    try {
      this.worker = new Worker(
        new URL("./opfs-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.addEventListener("message", (ev: MessageEvent) => {
        const r = ev.data as { id: number; ok: boolean; error?: string };
        const p = this.pending.get(r.id);
        if (!p) return;
        this.pending.delete(r.id);
        if (r.ok) p.resolve();
        else p.reject(new Error(r.error ?? "opfs worker error"));
      });
      this.worker.addEventListener("error", () => {
        // tear down so subsequent writes use the fallback path.
        this.worker = undefined;
        for (const p of this.pending.values()) {
          p.reject(new Error("opfs worker crashed"));
        }
        this.pending.clear();
      });
    } catch {
      this.worker = undefined;
    }
  }

  // -- manifest ----------------------------------------------------------

  async manifest(songId: string): Promise<Manifest | null> {
    const dir = await this.songDir(songId, false).catch(() => null);
    if (!dir) return null;
    try {
      const file = await dir.getFileHandle("manifest.json");
      const blob = await file.getFile();
      return JSON.parse(await blob.text()) as Manifest;
    } catch {
      return null;
    }
  }

  async writeManifest(m: Manifest): Promise<void> {
    const dir = await this.songDir(m.song_id, true);
    const fh = await dir.getFileHandle("manifest.json", { create: true });
    // simple async write — manifest is small.
    const w = await (fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> })
      .createWritable();
    await w.write(JSON.stringify(m));
    await w.close();
  }

  // -- chunk i/o ---------------------------------------------------------

  async hasChunk(songId: string, seq: number): Promise<boolean> {
    const dir = await this.chunksDir(songId, false).catch(() => null);
    if (!dir) return false;
    try {
      await dir.getFileHandle(chunkName(seq));
      return true;
    } catch {
      return false;
    }
  }

  async readChunk(songId: string, seq: number): Promise<Uint8Array | null> {
    const dir = await this.chunksDir(songId, false).catch(() => null);
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle(chunkName(seq));
      const blob = await fh.getFile();
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** write one chunk.
   *
   * preferred path: hand the bytes to the dedicated opfs worker,
   * which uses `FileSystemSyncAccessHandle` (fast, universally
   * available in worker context). if the worker isn't available
   * (spawn failed, crashed, or pre-spec runtime) we fall back to the
   * async `createWritable` path on the main thread. safari forbids
   * sync handles on the main thread, so the worker path is the only
   * sync-fast option there.
   */
  async writeChunk(songId: string, seq: number, bytes: Uint8Array): Promise<void> {
    if (this.worker) {
      const id = this.nextMsgId++;
      const promise = new Promise<void>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      });
      // transfer the underlying buffer to avoid the structured-clone
      // copy. caller must not retain `bytes` after this returns.
      this.worker.postMessage(
        { id, op: "write", songId, seq, bytes },
        [bytes.buffer as ArrayBuffer],
      );
      return promise;
    }

    // main-thread fallback.
    const dir = await this.chunksDir(songId, true);
    const fh = await dir.getFileHandle(chunkName(seq), { create: true });
    type SyncHandle = {
      write(buf: BufferSource, opts?: { at?: number }): number;
      truncate(n: number): void;
      flush(): void;
      close(): void;
    };
    type MaybeSync = {
      createSyncAccessHandle?: () => Promise<SyncHandle>;
    };
    const sync = (fh as unknown as MaybeSync).createSyncAccessHandle;
    if (typeof sync === "function") {
      const handle = await sync.call(fh as unknown as MaybeSync);
      try {
        handle.truncate(0);
        handle.write(bytes, { at: 0 });
        handle.flush();
      } finally {
        handle.close();
      }
      return;
    }
    const w = await (
      fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
    ).createWritable();
    try {
      await w.write(bytes);
    } finally {
      await w.close();
    }
  }

  // -- listing / management ---------------------------------------------

  async list(): Promise<CachedSong[]> {
    const songs: CachedSong[] = [];
    const songsDir = await this.root.getDirectoryHandle("songs");
    // FileSystemDirectoryHandle is async-iterable in chrome; for safari
    // we may need a polyfill, kept as todo for phase 3.
    for await (const [songId, handle] of (songsDir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >)) {
      if (handle.kind !== "directory") continue;
      try {
        const m = await this.manifest(songId);
        if (!m) continue;
        let bytes = 0;
        const chunksDir = await (handle as FileSystemDirectoryHandle)
          .getDirectoryHandle("chunks", { create: false })
          .catch(() => null);
        let chunkCount = 0;
        if (chunksDir) {
          for await (const [, ch] of (chunksDir as unknown as AsyncIterable<
            [string, FileSystemHandle]
          >)) {
            if (ch.kind === "file") {
              chunkCount++;
              bytes += (await (ch as FileSystemFileHandle).getFile()).size;
            }
          }
        }
        songs.push({
          song_id: songId,
          title: m.title,
          bytes,
          chunk_count: chunkCount,
          manifest: m,
        });
      } catch (e) {
        // an in-flight download may be racing with this iteration —
        // skip and keep going so a single transient failure doesn't
        // wipe the whole list.
        console.warn(`[sibyl] list: skipping ${songId}: ${(e as Error).message}`);
        continue;
      }
    }
    return songs;
  }

  async deleteSong(songId: string): Promise<void> {
    const songs = await this.root.getDirectoryHandle("songs");
    await (songs as unknown as { removeEntry(n: string, o?: { recursive: boolean }): Promise<void> })
      .removeEntry(songId, { recursive: true });
  }

  async clear(): Promise<void> {
    await (this.root as unknown as { removeEntry(n: string, o?: { recursive: boolean }): Promise<void> })
      .removeEntry("songs", { recursive: true });
    await this.root.getDirectoryHandle("songs", { create: true });
  }

  // -- internals ---------------------------------------------------------

  private async songDir(songId: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const songs = await this.root.getDirectoryHandle("songs", { create });
    return songs.getDirectoryHandle(songId, { create });
  }
  private async chunksDir(songId: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const dir = await this.songDir(songId, create);
    return dir.getDirectoryHandle("chunks", { create });
  }
}

function chunkName(seq: number): string {
  return `${seq.toString().padStart(8, "0")}.mp3`;
}
