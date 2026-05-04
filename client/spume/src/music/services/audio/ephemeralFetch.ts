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
//   - on backend init: `purgeEphemeralAll()` (catches any leftovers
//     from a previous crash).
//   - on each `loadAndPlay` (sync OFF path): delete the previous
//     song's ephemeral file, then fetch the new one.
//   - on stop / clear: delete current.
//   - on dispose: `purgeEphemeralAll()`.
//
// safety: the tauri commands themselves enforce path-prefix +
// filename-pattern + symlink checks, so even a buggy caller here
// cannot delete a file outside `<fetch_dir>/_ephemeral/`.

import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { isP2PRemote } from "../../../app/services/storage/schemas/remote";
import type { Song } from "../storage/types";

/// what we need to remember about a song we just fetched, so we can
/// clean it up later. `sha256` is the cache key (matches the player's
/// notion of "current song"); `blake3`+`ext` are what the rust
/// deleter actually needs to find the file on disk.
interface EphemeralEntry {
  sha256: string;
  blake3: string;
  ext: string;
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

  return {
    path,
    entry: { sha256: song.sha256, blake3: song.blake3, ext },
  };
}

/// fire-and-forget delete of one ephemeral file. errors are logged
/// but never re-thrown — cleanup must not break playback.
export async function deleteEphemeral(entry: EphemeralEntry): Promise<void> {
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

/// nuke everything in `<fetch_dir>/_ephemeral/`. called on backend
/// init (defensive; catches crash leftovers) and on dispose. errors
/// logged + swallowed.
export async function purgeEphemeralAll(): Promise<void> {
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
