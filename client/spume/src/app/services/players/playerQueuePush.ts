// phase 6: pushes local songs to a paired freqhole-player device.
//
// mirrors phase 4's "controller itself holds the blob" pattern: this
// device imports the song's bytes into its own midden node's blob store
// (making them fetchable by iroh-blobs verified streaming), then tells
// the player to pull from *this* node by blake3 hash.
//
// `getAudioURL()` already resolves every song storage backend (local
// opfs, remote p2p, remote http, blob-cached) into a fetchable url, so
// fetching that url + importing the bytes works regardless of where the
// song actually lives - no per-backend branching needed here.
//
// deliberately simple: no dedupe/hash-cache (import_blob is idempotent
// per content anyway), no release_blob/GC of imported blobs, video items
// are skipped (no video-over-freqhole-player support yet).

import { getMiddenNode } from "../../api/client";
import { getAudioURL } from "../../../music/services/storage/audioAccess";
import type { Song } from "../../../music/services/storage/types";
import { getPrimaryImageBlobId } from "../../../music/utils/images";
import { getBlob } from "../../../music/services/storage/blobs";
import { sendPlayerCommand } from "./playerPairingClient";
import type { RemoteMediaRef } from "./remotePlaybackControl";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/** resolves a song's cover art to something the paired player can display
 * directly - a data: url (embedded bytes) when the art is cached locally,
 * falling back to a plain remote url otherwise (best-effort; the player
 * may or may not be able to reach it). */
async function resolveArtworkUrl(song: Song): Promise<string | undefined> {
  const blobId = getPrimaryImageBlobId(song.images);
  if (blobId) {
    const blob = await getBlob(blobId);
    if (blob) return blobToDataUrl(blob);
  }
  const remote = song.images?.find((img) => img.is_primary) ?? song.images?.[0];
  return remote?.remote_url ?? undefined;
}

async function songToMediaRef(song: Song): Promise<RemoteMediaRef> {
  const node = await getMiddenNode();
  if (!node.import_blob) {
    throw new Error("this transport cannot make blobs available to a paired player");
  }
  const url = await getAudioURL(song);
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const blake3Hash = await node.import_blob(bytes);
  const artworkUrl = await resolveArtworkUrl(song);
  return {
    source_peer_addr: node.node_id(),
    blake3_hash: blake3Hash,
    size_bytes: bytes.byteLength,
    duration_ms: song.duration_seconds ? Math.round(song.duration_seconds * 1000) : undefined,
    mime_type: song.mime_type ?? "audio/mpeg",
    kind: "audio",
    title: song.title,
    artist: song.artist_name,
    artwork_url: artworkUrl,
  };
}

/** push a full queue of songs to a paired player, replacing whatever it
 * was playing. the first song starts playing immediately. */
export async function pushSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const items = await Promise.all(songs.map(songToMediaRef));
  await sendPlayerCommand(peerAddr, { type: "control", command: "replace_queue", items });
}
