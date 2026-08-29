// phase 6: pushes local songs to a paired freqhole-player device.
//
// mirrors phase 4's "controller itself holds the blob" pattern: this
// device imports the song's bytes into its own local blob store (making
// them fetchable by iroh-blobs verified streaming), then tells the player
// to pull from *this* node by blake3 hash. two transports, selected via
// isCharnelMode() (see importSongBytes() below): wasm (browser midden
// node's own store) or charnel/tauri native (`p2p_import_blob_bytes`/
// `p2p_get_node_id`, the same iroh-blobs FsStore + pull model
// `CharnelTransport.ts` already uses for music/video uploads).
//
// `getAudioURL()` already resolves every song storage backend (local
// opfs, remote p2p, remote http, blob-cached) into a fetchable url, so
// fetching that url + importing the bytes works regardless of where the
// song actually lives - no per-backend branching needed here.
//
// deliberately simple: no dedupe/hash-cache (import is idempotent per
// content anyway), no release_blob/GC of imported blobs, video items are
// skipped (no video-over-freqhole-player support yet).

import { getMiddenNode, isCharnelAvailable } from "../../api/client";
import { isCharnelMode } from "../charnel/mode";
import { fetchLocalNodeId, importBlobBytes } from "../charnel/commands";
import { getAudioURL } from "../../../music/services/storage/audioAccess";
import type { Song } from "../../../music/services/storage/types";
import { getBlob } from "../../../music/services/storage/blobs";
import { isValidHttpUrl, resolveBlobUrl } from "../../../music/services/storage/blobResolver";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { sendPlayerCommand } from "./playerPairingClient";
import type { RemoteMediaRef } from "./remotePlaybackControl";

function bytesToBase64(bytes: Uint8Array): string {
  // chunked to avoid maximum-call-stack on String.fromCharCode for big arrays.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

const ARTWORK_THUMB_MAX_DIM = 96;

/** downscales an image blob to a small jpeg data url for queue-row-sized
 * thumbnails - keeps the per-song thumbnail payload small so syncing a
 * whole queue's worth of art to a paired player (phase 6+/14) stays cheap,
 * distinct from the full-size art used for the player's own now-playing
 * view. returns undefined (caller falls back to the full-size art) if the
 * source isn't decodable as an image or canvas isn't available. */
async function makeArtworkThumbDataUrl(blob: Blob): Promise<string | undefined> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, ARTWORK_THUMB_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return undefined;
  }
}

interface ResolvedArtwork {
  thumbUrl?: string;
  fullUrl?: string;
}

/** resolves a song's cover art to something the paired player can display
 * directly - both a small thumbnail (for queue rows, synced cheaply to
 * every client) and the full-size image (for the player's own now-playing
 * view) - a data: url (embedded bytes) whenever the art is only reachable
 * from this device (cached locally, or - charnel/tauri's local library
 * case - a `remote_url` that's actually this device's own embedded-grimoire
 * sidecar on localhost, which the *player* device can never reach), falling
 * back to passing a real remote http(s) url through as-is for BOTH sizes
 * (cheaper: the player fetches it directly instead of a giant embedded
 * data url; no bytes on hand locally to downscale from in that case).
 * mirrors the same localhost safeguard already used by
 * blobResolver.ts/MediaThumbnail.tsx for spume's own image rendering.
 *
 * uses getSongDisplayImages()/pickBestImage() (utils/images.ts) rather than
 * raw song.images - many songs have no song-level image at all (only their
 * album does), and song-level "original"-typed images are often actually
 * mistyped waveforms, so skipping the album-image fallback (the original
 * bug here) silently produced no artwork for most charnel/local songs. */
async function resolveArtwork(song: Song): Promise<ResolvedArtwork> {
  const image = pickBestImage(getSongDisplayImages(song));
  if (!image) return {};

  const fromBlob = async (blob: Blob): Promise<ResolvedArtwork> => {
    const [fullUrl, thumbUrl] = await Promise.all([
      blobToDataUrl(blob),
      makeArtworkThumbDataUrl(blob),
    ]);
    return { thumbUrl: thumbUrl ?? fullUrl, fullUrl };
  };

  if (image.local_blob_id) {
    const blob = await getBlob(image.local_blob_id);
    if (blob) return fromBlob(blob);
  }

  // charnel/tauri-managed local-library images have no local_blob_id (that
  // store is wasm-only) and no remote_url either - getBlobHttpUrl() in
  // remoteSource.ts intentionally returns undefined for charnel-managed
  // remotes ("tauri-managed remotes don't run an http server"). the only
  // way to reach the bytes is remote_blob_id/remote_server_id, resolved
  // through this device's own transport - which for a charnel remote hands
  // back an asset://... or blob: url that's only valid in *this* webview,
  // so fetch it ourselves and embed the bytes, same as the remote_url
  // localhost-safeguard path below.
  if (image.remote_blob_id && image.remote_server_id) {
    try {
      const url = await resolveBlobUrl(image.remote_blob_id, image.remote_server_id, "image");
      const res = await fetch(url);
      if (res.ok) return fromBlob(await res.blob());
    } catch {
      // fall through to the remote_url handling below
    }
  }

  const remoteUrl = image.remote_url;
  if (!remoteUrl) return {};

  const isLocalOnly = isCharnelAvailable() && remoteUrl.includes("localhost");
  if (isValidHttpUrl(remoteUrl) && !isLocalOnly) return { thumbUrl: remoteUrl, fullUrl: remoteUrl };

  // only this device can reach this url (charnel's own localhost sidecar,
  // or a relative/non-http url) - fetch the bytes ourselves and embed them.
  try {
    const res = await fetch(remoteUrl);
    if (!res.ok) return {};
    return fromBlob(await res.blob());
  } catch {
    return {};
  }
}

/** imports the song's bytes into this device's local blob store (charnel:
 * native iroh-blobs FsStore via tauri; browser: the wasm midden node's own
 * store) and returns this device's own node id + the resulting blake3 hash,
 * so the player can be told to pull the bytes from us by hash. */
async function importSongBytes(
  bytes: Uint8Array
): Promise<{ sourcePeerAddr: string; blake3Hash: string }> {
  if (isCharnelMode()) {
    const [nodeId, blake3Hash] = await Promise.all([
      fetchLocalNodeId(),
      importBlobBytes(bytesToBase64(bytes)),
    ]);
    if (!nodeId) throw new Error("charnel p2p node id unavailable - is federation enabled?");
    return { sourcePeerAddr: nodeId, blake3Hash };
  }
  const node = await getMiddenNode();
  if (!node.import_blob) {
    throw new Error("this transport cannot make blobs available to a paired player");
  }
  const blake3Hash = await node.import_blob(bytes);
  return { sourcePeerAddr: node.node_id(), blake3Hash };
}

async function songToMediaRef(song: Song): Promise<RemoteMediaRef> {
  const url = await getAudioURL(song);
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { sourcePeerAddr, blake3Hash } = await importSongBytes(bytes);
  const { thumbUrl, fullUrl } = await resolveArtwork(song);
  return {
    source_peer_addr: sourcePeerAddr,
    blake3_hash: blake3Hash,
    size_bytes: bytes.byteLength,
    duration_ms: song.duration_seconds ? Math.round(song.duration_seconds * 1000) : undefined,
    mime_type: song.mime_type ?? "audio/mpeg",
    kind: "audio",
    title: song.title,
    artist: song.artist_name,
    artwork_thumb_url: thumbUrl,
    artwork_full_url: fullUrl,
  };
}

/** push a full queue of songs to a paired player, replacing whatever it
 * was playing. the first song starts playing immediately. */
export async function pushSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const items = await Promise.all(songs.map(songToMediaRef));
  await sendPlayerCommand(peerAddr, { type: "control", command: "replace_queue", items });
}

/** append songs to a paired player's existing queue, without disturbing
 * whatever it's currently playing. */
export async function appendSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const items = await Promise.all(songs.map(songToMediaRef));
  await sendPlayerCommand(peerAddr, { type: "control", command: "append_queue", items });
}
