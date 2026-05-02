// dedicated worker that owns `FileSystemSyncAccessHandle` writes for
// the opfs chunk cache. on safari (and chromium prior to v108) sync
// handles are forbidden on the main thread; on the worker thread they
// are universally available and ~5\u201310x faster than `createWritable()`.
//
// protocol (over postMessage):
//
//   { id, op: "write", songId, seq, bytes }   \u2192 { id, ok: true }
//                                              \u2192 { id, ok: false, error }
//   { id, op: "ping" }                          \u2192 { id, ok: true }
//
// the worker is single-purpose; `OpfsCache` owns it and serializes
// requests by id. reads stay on the main thread (async file handles
// are non-blocking and let playback drive without ipc round-trips).

/// <reference lib="webworker" />

interface WriteMsg {
  id: number;
  op: "write";
  songId: string;
  seq: number;
  bytes: Uint8Array;
}
interface PingMsg {
  id: number;
  op: "ping";
}
type InMsg = WriteMsg | PingMsg;

type SyncHandle = {
  write(buf: BufferSource, opts?: { at?: number }): number;
  truncate(n: number): void;
  flush(): void;
  close(): void;
};
type MaybeSync = {
  createSyncAccessHandle?: () => Promise<SyncHandle>;
};

function chunkName(seq: number): string {
  return `${seq.toString().padStart(8, "0")}.mp3`;
}

async function chunksDir(songId: string): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  const root = await opfs.getDirectoryHandle("sibyl", { create: true });
  const songs = await root.getDirectoryHandle("songs", { create: true });
  const song = await songs.getDirectoryHandle(songId, { create: true });
  return song.getDirectoryHandle("chunks", { create: true });
}

async function writeChunk(
  songId: string,
  seq: number,
  bytes: Uint8Array,
): Promise<void> {
  const dir = await chunksDir(songId);
  const fh = await dir.getFileHandle(chunkName(seq), { create: true });
  const sync = (fh as unknown as MaybeSync).createSyncAccessHandle;
  if (typeof sync !== "function") {
    // worker context lacks sync access handles too \u2014 fall back to the
    // async path so we don't break older runtimes.
    const w = await (
      fh as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }
    ).createWritable();
    try {
      await w.write(bytes);
    } finally {
      await w.close();
    }
    return;
  }
  const handle = await sync.call(fh as unknown as MaybeSync);
  try {
    handle.truncate(0);
    handle.write(bytes, { at: 0 });
    handle.flush();
  } finally {
    handle.close();
  }
}

self.addEventListener("message", async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    if (msg.op === "ping") {
      (self as unknown as { postMessage(m: unknown): void }).postMessage({
        id: msg.id,
        ok: true,
      });
      return;
    }
    if (msg.op === "write") {
      await writeChunk(msg.songId, msg.seq, msg.bytes);
      (self as unknown as { postMessage(m: unknown): void }).postMessage({
        id: msg.id,
        ok: true,
      });
      return;
    }
  } catch (e) {
    (self as unknown as { postMessage(m: unknown): void }).postMessage({
      id: msg.id,
      ok: false,
      error: (e as Error).message,
    });
  }
});
