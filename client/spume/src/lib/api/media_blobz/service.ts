// mirrors grimoire/src/media_blobz/service.rs's get_media_blob() -
// browser-side, backed by spume's own `Song`/`LocalVideoRow` stores
// (media blobs are 1:1 with their owning entity in the browser library,
// unlike grimoire's separate media_blobz table) instead of grimoire's
// media_blobz table. shared across domains on the wire (videoBlobAccess.ts
// already calls `client.music.blobMetadata()` for video blobs too), so
// this checks both stores.

import type { BlobMetadataResponse } from "@freqhole/api-client";
import { getSongByBlake3, getSongBySha256 } from "../../../music/services/storage/db/songs";
import type { Song } from "../../../music/services/storage/types";
import { readAudioFromOPFS } from "../../../music/services/opfs/helpers";
import { getVideoByBlake3 } from "../../../video/services/storage/db/videos";
import { readVideoFromOPFS } from "../../../video/services/opfs/helpers";
import { getBlob } from "../../../music/services/storage/blobs";
import { ensureBlobServable } from "../blobServing";

function blobIdFor(song: Song): string {
  return song.blake3 ?? song.sha256;
}

/** looks a song/video up by the same id `crud/query.ts`'s
 * `songToQueryResult`/`videoToQueryResult` hands out as `media_blob_id`
 * (blake3, or sha256 for pre-blake3-backfill songs - video has no sha256
 * concept, blake3-only). syncSongToLocal()'s and syncVideoToLocal()'s
 * browser-mode paths always call this route right before fetching the
 * blob by hash, so this is the guaranteed checkpoint to stage it for
 * iroh-blobs serving. */
export async function getMediaBlob(id: string): Promise<BlobMetadataResponse | null> {
  const song = (await getSongByBlake3(id)) ?? (await getSongBySha256(id));
  if (song) {
    if (song.opfs_path) {
      await ensureBlobServable(blobIdFor(song), () => readAudioFromOPFS(song.opfs_path!));
    }
    return {
      id: blobIdFor(song),
      sha256: song.sha256,
      size: song.file_size ?? undefined,
      mime: song.mime_type ?? undefined,
      filename: song.file_name ?? undefined,
      blob_type: "original",
      blake3: song.blake3 ?? undefined,
    };
  }

  const video = await getVideoByBlake3(id);
  if (video) {
    if (video.opfs_path) {
      const opfsPath = video.opfs_path;
      await ensureBlobServable(id, () => readVideoFromOPFS(opfsPath));
    }
    return {
      id,
      // video has no sha256 concept (blake3-only identity, see
      // LocalVideoRow.blake3's field comment) - reuse blake3 here since
      // no caller compares a video's blob metadata sha256 meaningfully.
      sha256: id,
      size: video.file_size ?? undefined,
      mime: video.mime_type ?? undefined,
      filename: video.file_name ?? undefined,
      blob_type: "original",
      blake3: id,
    };
  }

  // not a song/video's own audio/video blob - an album art/artist/
  // waveform image is staged separately (see lib/api/images.ts's
  // stageAndMapImages, which advertises an image's `local_blob_id` as
  // its wire `blob_id`) and lives in the generic local blob store, not
  // keyed to any song/video row. a remote peer resolving a pushed song's
  // artwork calls this same route for that id - without this fallback it
  // 404s here even though `ensureBlobServable` already staged the bytes
  // for the primary iroh-blobs transfer.
  const image = await getBlob(id);
  if (image) {
    await ensureBlobServable(id, () => Promise.resolve(image));
    return {
      id,
      sha256: id,
      size: image.size,
      mime: image.type || undefined,
      filename: undefined,
      blob_type: "thumbnail",
      blake3: id,
    };
  }

  return null;
}

// chunked to avoid maximum-call-stack on String.fromCharCode for large
// files - mirrors playerQueuePush.ts's bytesToBase64 (same reasoning: a
// single `String.fromCharCode(...bytes)` spread blows the call stack
// well before real audio-file sizes).
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export interface BlobDataResponse {
  id: string;
  mime?: string;
  data: string; // base64
}

/** browser counterpart of grimoire's `build_blob_data_response()` - the
 * fallback `GET /api/blobs/{id}/data` route `WasmTransport.fetchBlob()`
 * calls when the primary iroh-blobs verified-streaming download (via
 * blake3) either isn't attempted (no blake3 known yet) or fails. base64
 * JSON is only ever a fallback for this route, same as grimoire's own -
 * the primary transfer path (`download_verified`/`download_verified_
 * streaming`, see `importMediaBytes`/`ensureBlobServable`) never buffers
 * a whole file as base64. `null` if this device has no song/video
 * matching `id` (blake3, or sha256 for pre-blake3-backfill songs). */
export async function getData(id: string): Promise<BlobDataResponse | null> {
  const song = (await getSongByBlake3(id)) ?? (await getSongBySha256(id));
  if (song) {
    if (!song.opfs_path) return null;
    const file = await readAudioFromOPFS(song.opfs_path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { id: blobIdFor(song), mime: song.mime_type ?? file.type, data: bytesToBase64(bytes) };
  }

  const video = await getVideoByBlake3(id);
  if (video) {
    if (!video.opfs_path) return null;
    const file = await readVideoFromOPFS(video.opfs_path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { id, mime: video.mime_type ?? file.type, data: bytesToBase64(bytes) };
  }

  // image blob (album art/artist/waveform) - see getMediaBlob's identical
  // fallback above for why this doesn't live in the song/video stores.
  const image = await getBlob(id);
  if (image) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    return { id, mime: image.type || undefined, data: bytesToBase64(bytes) };
  }

  return null;
}
