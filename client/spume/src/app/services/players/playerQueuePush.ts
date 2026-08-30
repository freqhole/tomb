// pushes local songs and videos to a paired
// freqhole-player device.
//
// "controller itself holds the blob" pattern: this
// device imports the media's bytes into its own local blob store (making
// them fetchable by iroh-blobs verified streaming), then tells the player
// to pull from *this* node by blake3 hash. two transports, selected via
// isCharnelMode() (see importMediaBytes() below): wasm (browser midden
// node's own store) or charnel/tauri native (`p2p_import_blob_bytes`/
// `p2p_get_node_id`, the same iroh-blobs FsStore + pull model
// `CharnelTransport.ts` already uses for music/video uploads).
//
// `getAudioURL()`/`getVideoURL()` already resolve every storage backend
// (local opfs, remote p2p, remote http, blob-cached) into a fetchable url,
// so fetching that url + importing the bytes works regardless of where the
// media actually lives - no per-backend branching needed here.
//
// deliberately simple: no dedupe/hash-cache (import is idempotent per
// content anyway), no release_blob/GC of imported blobs.
//
// "cross-remote forwarding":
// for a song/video whose source remote (C) isn't this device's own library,
// songToMediaRef()/videoToMediaRef() first try tryBridgeToSourceRemote() -
// if this device is already an admin on C, it grants the player (A) direct
// trust on C via C's admin `peers_allow` command, then points the MediaRef
// straight at C instead of fetching+relaying the bytes through this device.
// falls back to the fetch-and-relay path below on any failure (not admin,
// remote_admin disabled, offline, etc.).

import { getClientForRemote, getMiddenNode, isCharnelAvailable } from "../../api/client";
import { adminClientFor } from "../../api/adminClient";
import { isCharnelMode } from "../charnel/mode";
import { fetchLocalNodeId, importBlobBytes } from "../charnel/commands";
import { getAudioURL } from "../../../music/services/storage/audioAccess";
import type { ImageMetadata, Song } from "../../../music/services/storage/types";
import { getBlob } from "../../../music/services/storage/blobs";
import { isValidHttpUrl, resolveBlobUrl } from "../../../music/services/storage/blobResolver";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { getRemoteById } from "../remotes/remoteManager";
import { isP2PRemote, type P2PRemote } from "../storage/schemas/remote";
import { sendPlayerCommand } from "./playerPairingClient";
import {
  applyRemoteStatusFromAck,
  type RemoteMediaRef,
  type RemoteStatus,
} from "./remotePlaybackControl";
import { getVideoURL } from "../../../video/services/videoBlobAccess";
import type { MediaItem, QueuedVideo } from "../storage/mediaItem";

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
 * whole queue's worth of art to a paired player stays cheap,
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
  return resolveImageArtwork(pickBestImage(getSongDisplayImages(song)));
}

/** video equivalent of resolveArtwork() above - the video domain has no
 * per-song-like `images[]` gallery used for primary display, just a single
 * flat `poster_blob_id` (mirrors how VideoCard/VideoDetailView etc. render
 * a video's thumbnail) - so this resolves that instead of picking from an
 * images array. local/opfs-imported videos have no `remote_server_id` to
 * resolve a blob through and are skipped for now (no artwork, not fatal -
 * the queue item just carries title/duration with no thumbnail). */
async function resolveVideoArtwork(video: QueuedVideo): Promise<ResolvedArtwork> {
  if (!video.poster_blob_id || !video.remote_server_id) return {};
  try {
    const url = await resolveBlobUrl(video.poster_blob_id, video.remote_server_id, "image");
    const res = await fetch(url);
    if (res.ok) return artworkFromBlob(await res.blob());
  } catch {
    // no artwork available - not fatal, the ref just won't carry art.
  }
  return {};
}

/** shared by resolveImageArtwork() (songs) and resolveVideoArtwork() above -
 * downscales/embeds a raw image blob as data urls (thumb + full). */
async function artworkFromBlob(blob: Blob): Promise<ResolvedArtwork> {
  const [fullUrl, thumbUrl] = await Promise.all([
    blobToDataUrl(blob),
    makeArtworkThumbDataUrl(blob),
  ]);
  return { thumbUrl: thumbUrl ?? fullUrl, fullUrl };
}

async function resolveImageArtwork(image: ImageMetadata | null): Promise<ResolvedArtwork> {
  if (!image) return {};

  if (image.local_blob_id) {
    const blob = await getBlob(image.local_blob_id);
    if (blob) return artworkFromBlob(blob);
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
      if (res.ok) return artworkFromBlob(await res.blob());
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
    return artworkFromBlob(await res.blob());
  } catch {
    return {};
  }
}

/** imports media bytes (song or video) into this device's local blob store
 * (charnel: native iroh-blobs FsStore via tauri; browser: the wasm midden
 * node's own store) and returns this device's own node id + the resulting
 * blake3 hash, so the player can be told to pull the bytes from us by hash. */
async function importMediaBytes(
  bytes: Uint8Array
): Promise<{ sourcePeerAddr: string; blake3Hash: string }> {
  if (isCharnelMode()) {
    const [nodeId, blake3Hash] = await Promise.all([
      fetchLocalNodeId(),
      importBlobBytes(bytesToBase64(bytes)),
    ]);
    if (!nodeId) throw new Error("charnel p2p node id unavailable - is federation enabled?");
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/playerQueuePush] importMediaBytes (charnel) ${bytes.byteLength}b -> blake3=${blake3Hash}, sourcePeerAddr=${nodeId}`
    );
    return { sourcePeerAddr: nodeId, blake3Hash };
  }
  const node = await getMiddenNode();
  if (!node.import_blob) {
    throw new Error("this transport cannot make blobs available to a paired player");
  }
  const blake3Hash = await node.import_blob(bytes);
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(
    `[debug/playerQueuePush] importMediaBytes (wasm) ${bytes.byteLength}b -> blake3=${blake3Hash}, sourcePeerAddr=${node.node_id()}`
  );
  return { sourcePeerAddr: node.node_id(), blake3Hash };
}

// step 8 (cross-remote forwarding): remote_id -> the P2P remote to point
// the player at directly, once bridged, shared across a single push/append
// call so a queue of many items from the same remote only attempts the
// admin bridge once, not once per item.
type BridgeCache = Map<string, Promise<P2PRemote | null>>;

/** step 8 (cross-remote forwarding, node A=player, B=this device, C=source
 * remote): if this device already has admin rights on the item's source
 * remote (C), grants the player (A) direct read-trust there via C's admin
 * `peers_allow` command, so A can pull the blob straight from C instead of
 * double-hopping through this device (the fetch-and-relay path below,
 * which remains the fallback and needs no admin rights at all). returns
 * null on any failure - not a P2P remote, not admin on C, remote_admin
 * disabled there, offline, etc. - callers fall back to relaying in that
 * case. */
async function tryBridgeToSourceRemote(
  remoteId: string,
  playerNodeId: string,
  cache: BridgeCache
): Promise<P2PRemote | null> {
  let pending = cache.get(remoteId);
  if (!pending) {
    pending = (async () => {
      try {
        const remote = await getRemoteById(remoteId);
        if (!remote || !isP2PRemote(remote)) return null;
        const client = await adminClientFor(remote);
        await client.dispatchOrThrow("peers_allow", { node_id: playerNodeId });
        return remote;
      } catch {
        return null;
      }
    })();
    cache.set(remoteId, pending);
  }
  return pending;
}

async function songToMediaRef(
  song: Song,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  if (song.remote_server_id && song.blake3) {
    const bridged = await tryBridgeToSourceRemote(song.remote_server_id, playerNodeId, bridgeCache);
    if (bridged) {
      const { thumbUrl, fullUrl } = await resolveArtwork(song);
      return {
        source_peer_addr: bridged.peer_addr,
        blake3_hash: song.blake3,
        size_bytes: song.file_size ?? undefined,
        duration_ms: song.duration_seconds ? Math.round(song.duration_seconds * 1000) : undefined,
        mime_type: song.mime_type ?? "audio/mpeg",
        kind: "audio",
        title: song.title,
        artist: song.artist_name,
        artwork_thumb_url: thumbUrl,
        artwork_full_url: fullUrl,
      };
    }
  }
  const url = await getAudioURL(song);
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { sourcePeerAddr, blake3Hash } = await importMediaBytes(bytes);
  const { thumbUrl, fullUrl } = await resolveArtwork(song);
  const ref: RemoteMediaRef = {
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
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] songToMediaRef built:`, ref);
  return ref;
}

/** video equivalent of songToMediaRef() above. `QueuedVideo` (the generated
 * `Video` type) has no stable mime-type field of its own (unlike `Song`) -
 * `res.blob().type`, read off the actual fetched bytes, is what
 * `syncVideoToLocal.ts`/`localImport.ts` already use for this same reason. */
async function videoToMediaRef(
  video: QueuedVideo,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  // step 8 (cross-remote forwarding) - videos carry no blake3/size of
  // their own (unlike Song), so the fast path needs one lightweight
  // blob_metadata round trip to C instead of a plain field read.
  if (video.remote_server_id && video.media_blob_id) {
    const bridged = await tryBridgeToSourceRemote(
      video.remote_server_id,
      playerNodeId,
      bridgeCache
    );
    if (bridged) {
      try {
        const client = await getClientForRemote(bridged);
        const metadata = await client.music.blobMetadata({ id: video.media_blob_id });
        if (metadata.success && metadata.data?.blake3) {
          const { thumbUrl, fullUrl } = await resolveVideoArtwork(video);
          return {
            source_peer_addr: bridged.peer_addr,
            blake3_hash: metadata.data.blake3,
            size_bytes: metadata.data.size ?? undefined,
            duration_ms: video.duration_seconds
              ? Math.round(video.duration_seconds * 1000)
              : undefined,
            mime_type: metadata.data.mime ?? "video/mp4",
            kind: "video",
            title: video.title,
            artwork_thumb_url: thumbUrl,
            artwork_full_url: fullUrl,
          };
        }
      } catch {
        // fall through to fetch-and-relay below
      }
    }
  }
  const url = await getVideoURL(video);
  const res = await fetch(url);
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { sourcePeerAddr, blake3Hash } = await importMediaBytes(bytes);
  const { thumbUrl, fullUrl } = await resolveVideoArtwork(video);
  const ref: RemoteMediaRef = {
    source_peer_addr: sourcePeerAddr,
    blake3_hash: blake3Hash,
    size_bytes: bytes.byteLength,
    duration_ms: video.duration_seconds ? Math.round(video.duration_seconds * 1000) : undefined,
    mime_type: blob.type || "video/mp4",
    kind: "video",
    title: video.title,
    artwork_thumb_url: thumbUrl,
    artwork_full_url: fullUrl,
  };
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] videoToMediaRef built:`, ref);
  return ref;
}

interface CommandAckLike {
  status?: RemoteStatus;
}

/** push a full queue of songs to a paired player, replacing whatever it
 * was playing. the first song starts playing immediately. */
export async function pushSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const items = await Promise.all(songs.map((song) => songToMediaRef(song, peerAddr, bridgeCache)));
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] pushSongsToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}

/** append songs to a paired player's existing queue, without disturbing
 * whatever it's currently playing. */
export async function appendSongsToPlayer(peerAddr: string, songs: Song[]): Promise<void> {
  if (songs.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const items = await Promise.all(songs.map((song) => songToMediaRef(song, peerAddr, bridgeCache)));
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] appendSongsToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}

/** push a full queue of videos to a paired player, replacing whatever it
 * was playing. */
export async function pushVideosToPlayer(peerAddr: string, videos: QueuedVideo[]): Promise<void> {
  if (videos.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const items = await Promise.all(
    videos.map((video) => videoToMediaRef(video, peerAddr, bridgeCache))
  );
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] pushVideosToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}

/** append videos to a paired player's existing queue, without disturbing
 * whatever it's currently playing. */
export async function appendVideosToPlayer(peerAddr: string, videos: QueuedVideo[]): Promise<void> {
  if (videos.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const items = await Promise.all(
    videos.map((video) => videoToMediaRef(video, peerAddr, bridgeCache))
  );
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] appendVideosToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}

/** kind-agnostic equivalent of songToMediaRef()/videoToMediaRef() above -
 * used by pushMediaToPlayer/appendMediaToPlayer for a mixed-kind queue. */
async function mediaItemToRef(
  item: MediaItem,
  playerNodeId: string,
  bridgeCache: BridgeCache
): Promise<RemoteMediaRef> {
  return item.kind === "song"
    ? songToMediaRef(item.song, playerNodeId, bridgeCache)
    : videoToMediaRef(item.video, playerNodeId, bridgeCache);
}

/** push a full queue of songs and/or videos (mixed-kind, order-preserving)
 * to a paired player, replacing whatever it was playing - used for the
 * initial "select this player as my playback target" hand-off, where the
 * local queue may be video-only, song-only, or a genuine mix (unlike
 * pushSongsToPlayer/pushVideosToPlayer above, which only ever send one
 * kind and so silently sent nothing at all for a video-only queue). */
export async function pushMediaToPlayer(peerAddr: string, items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const refs = await Promise.all(items.map((item) => mediaItemToRef(item, peerAddr, bridgeCache)));
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "replace_queue",
    items: refs,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] pushMediaToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}

/** append equivalent of pushMediaToPlayer() above. */
export async function appendMediaToPlayer(peerAddr: string, items: MediaItem[]): Promise<void> {
  if (items.length === 0) return;
  const bridgeCache: BridgeCache = new Map();
  const refs = await Promise.all(items.map((item) => mediaItemToRef(item, peerAddr, bridgeCache)));
  const ack = (await sendPlayerCommand(peerAddr, {
    type: "control",
    command: "append_queue",
    items: refs,
  })) as CommandAckLike;
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/playerQueuePush] appendMediaToPlayer(${peerAddr}) ack:`, ack);
  if (ack?.status) applyRemoteStatusFromAck(ack.status);
}
