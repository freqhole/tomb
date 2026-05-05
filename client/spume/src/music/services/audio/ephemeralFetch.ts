// ephemeral blob fetch + cleanup for the rodio backend's
// `sync_queue_to_local = false` path.
//
// rodio decodes from a fs path (it can't stream http urls), so when
// the user has chosen NOT to populate their library on play, we
// still need to land the audio bytes on disk somewhere. these
// helpers wrap the matching tauri commands in
// `client/charnel/src-tauri/src/ephemeral_blob_commands.rs`, which
// write to `<fetch_dir>/_ephemeral/<blake3>.<ext>` and never touch
// the sqlite library tables.
//
// lifecycle (called from rodioBackend):
//   - on backend init: `reconcileEphemeralWithQueue(queue.blake3s)`
//     (deletes orphan files for songs no longer queued, seeds the
//     ui signal from survivors).
//   - on each `loadAndPlay` (sync OFF path): fetch the new song
//     (idempotent — rust returns the existing path if already on
//     disk). do NOT delete the previous song's file; it stays as
//     long as the song is in the queue.
//   - on queue mutations: re-reconcile against the new queue.
//   - on explicit user-initiated purge: `purgeEphemeralAll()`.
//
// rationale: the underline indicator should reflect "is this song
// available locally?" — and that answer must survive app restart for
// any song still in the persisted queue.
//
// safety: the tauri commands themselves enforce path-prefix +
// filename-pattern + symlink checks, so even a buggy caller here
// cannot delete a file outside `<fetch_dir>/_ephemeral/`.

import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isP2PRemote } from "../../../app/services/storage/schemas/remote";
import {
  clearEphemeralOnDisk,
  markEphemeralOnDisk,
  setEphemeralOnDiskBlake3s,
  unmarkEphemeralOnDisk,
} from "../download";
import type { Song } from "../storage/types";

/// what we need to remember about a song we just fetched, so we can
/// clean it up later. `blake3`+`ext` are what the rust deleter
/// actually needs to find the file on disk; `blake3` is also the
/// key the ui uses to flip its "available offline" indicator.
interface EphemeralEntry {
  blake3: string;
  ext: string;
}

/// shape of one entry returned by the rust `list_ephemeral_blobs` /
/// `reconcile_ephemeral_dir` commands. mirrors `EphemeralFileInfo`
/// in `client/charnel/src-tauri/src/ephemeral_blob_commands.rs`.
interface EphemeralFileInfo {
  blake3: string;
  ext: string;
}

interface EphemeralReconcileResult {
  kept: EphemeralFileInfo[];
  deleted: number;
}

/// extract a usable filename extension for `<blake3>.<ext>`. mirrors
/// the rust `detect_extension` logic but only the bits that matter
/// here: strip from filename if reasonable, else fall back to mime.
function extensionForSong(song: Song): string {
  const fromName = song.file_name?.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length >= 1 && fromName.length <= 5 && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }
  const mime = (song.mime_type ?? "").toLowerCase();
  switch (mime) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/ogg":
    case "audio/vorbis":
      return "ogg";
    case "audio/opus":
      return "opus";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/aac":
    case "audio/x-aac":
      return "aac";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/m4a":
      return "m4a";
    default:
      return "mp3";
  }
}

/// fetch a remote song into `<fetch_dir>/_ephemeral/` and return its
/// fs path. throws on any failure (caller is rodio's loadAndPlay,
/// which translates to a `BackendPlaybackError`).
export async function fetchEphemeralForSong(song: Song): Promise<{
  path: string;
  entry: EphemeralEntry;
}> {
  if (!song.blake3) {
    throw new Error("song missing blake3 (cannot fetch ephemerally)");
  }
  if (!song.remote_server_id) {
    throw new Error("song missing remote_server_id (cannot fetch ephemerally)");
  }

  const remote = await getRemoteById(song.remote_server_id);
  if (!remote) {
    throw new Error(`remote ${song.remote_server_id} not found`);
  }
  if (!isP2PRemote(remote)) {
    // ephemeral fetch only supports p2p remotes today. http-only
    // remotes would need a separate `reqwest::get` path on the rust
    // side; rodio + http-only is rare enough that we punt for now.
    throw new Error(
      `ephemeral fetch requires a p2p remote (${remote.name} is http-only). enable "sync queue to local" or disable rodio.`,
    );
  }

  const ext = extensionForSong(song);
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string>("fetch_ephemeral_blob", {
    peerAddr: remote.peer_addr,
    blake3: song.blake3,
    ext,
  });

  // light up the "available offline" UI affordance for this song.
  // tracked in-memory + reconciled on startup against the queue (see
  // `downloadState.ephemeralOnDiskBlake3s` and `reconcileEphemeralWithQueue`).
  markEphemeralOnDisk(song.blake3);

  return {
    path,
    entry: { blake3: song.blake3, ext },
  };
}

/// fire-and-forget delete of one ephemeral file. errors are logged
/// but never re-thrown — cleanup must not break playback.
export async function deleteEphemeral(entry: EphemeralEntry): Promise<void> {
  // optimistic UI clear: drop the underline immediately so the row
  // doesn't lie about offline-availability while the rust delete runs.
  unmarkEphemeralOnDisk(entry.blake3);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_ephemeral_blob", {
      blake3: entry.blake3,
      ext: entry.ext,
    });
  } catch (e) {
    console.warn(
      `[ephemeralFetch] delete failed for ${entry.blake3.slice(0, 8)}.${entry.ext}:`,
      e,
    );
  }
}

/// nuke everything in `<fetch_dir>/_ephemeral/`. errors logged +
/// swallowed. only called from explicit "purge ephemeral cache" user
/// actions — the normal lifecycle uses `reconcileEphemeralWithQueue`
/// instead so songs still in the queue survive across restarts.
export async function purgeEphemeralAll(): Promise<void> {
  // clear UI tracking eagerly — even if the rust purge fails partially,
  // the next playback will re-mark each song as it gets re-fetched.
  clearEphemeralOnDisk();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const deleted = await invoke<number>("purge_ephemeral_dir");
    if (deleted > 0) {
      console.info(`[ephemeralFetch] purged ${deleted} stale ephemeral file(s)`);
    }
  } catch (e) {
    console.warn(`[ephemeralFetch] purge failed:`, e);
  }
}

/// reconcile `<fetch_dir>/_ephemeral/` against the current queue:
/// delete any file whose blake3 isn't in `keepBlake3s`, then seed
/// the ui's on-disk signal from the survivors. called on backend
/// init (so the underline indicator is populated immediately at
/// startup) and whenever the queue mutates (so removed-from-queue
/// songs get cleaned up promptly).
///
/// errors are logged + swallowed; reconcile is best-effort.
export async function reconcileEphemeralWithQueue(
  keepBlake3s: Iterable<string>,
): Promise<void> {
  const keep = Array.from(new Set<string>(keepBlake3s));
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<EphemeralReconcileResult>(
      "reconcile_ephemeral_dir",
      { keepBlake3s: keep },
    );
    setEphemeralOnDiskBlake3s(result.kept.map((f) => f.blake3));
    if (result.deleted > 0) {
      console.info(
        `[ephemeralFetch] reconcile: kept ${result.kept.length}, deleted ${result.deleted}`,
      );
    }
  } catch (e) {
    console.warn(`[ephemeralFetch] reconcile failed:`, e);
  }
}

/// list every ephemeral file currently on disk and seed the ui
/// signal from it. cheaper alternative to `reconcileEphemeralWithQueue`
/// when the caller doesn't want to delete anything (e.g. early at
/// startup before the queue has loaded).
export async function refreshEphemeralOnDiskFromDisk(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const files = await invoke<EphemeralFileInfo[]>("list_ephemeral_blobs");
    setEphemeralOnDiskBlake3s(files.map((f) => f.blake3));
  } catch (e) {
    console.warn(`[ephemeralFetch] list failed:`, e);
  }
}
