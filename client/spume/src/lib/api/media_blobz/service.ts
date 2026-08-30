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

  return null;
}
