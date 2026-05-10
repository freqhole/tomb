// post-sync image transfer.
//
// after `/api/sync/album` (or song-by-blake3, or playlist) returns a dest
// entity id, this helper walks each source-side image, pulls its bytes
// over the source's transport, and re-uploads to the dest via the
// existing `POST /api/upload/image` endpoint — the same one every other
// image-management flow uses.
//
// this decouples image transfer from the sync json envelope: images are
// no longer inlined as base64 on sync requests. dest gets each image via
// a normal upload call, which already handles dedupe by sha256 and
// conversion/association jobs.
//
// per-image errors are logged and skipped; they never fail the send.

import type { Transport } from "freqhole-api-client";
import type { ImageMetadata } from "../storage/types";
import { debug, info, warn } from "../../../utils/logger";

export type ImageEntityType = "album" | "song" | "playlist" | "artist";

export interface UploadImagesResult {
  attempted: number;
  uploaded: number;
  skipped: number;
  failed: number;
}

/**
 * shared cache for source-image bytes within a single send run.
 *
 * keyed by source `remote_blob_id`, so the same physical image (e.g. an
 * embedded album cover that surfaces both as `album.images` and as
 * `song.images` for every track) is fetched from the source ONCE per send,
 * even when uploaded to multiple dest entities.
 *
 * callers create one cache per `sendToRemote` invocation and pass it into
 * each `uploadImagesToDest` call.
 */
export interface ImageBlobCache {
  get(blobId: string): { bytes: Uint8Array; mime: string } | undefined;
  set(blobId: string, value: { bytes: Uint8Array; mime: string }): void;
}

export function createImageBlobCache(): ImageBlobCache {
  const m = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    get: (id) => m.get(id),
    set: (id, v) => {
      m.set(id, v);
    },
  };
}

/**
 * fetch each image from the source and upload to dest as a normal
 * /api/upload/image call with associate_with pointing at `entityId`.
 *
 * - images without `remote_blob_id` are skipped (no source-side id to
 *   pull from).
 * - images whose `remote_blob_id` is in `skipBlobIds` are skipped (used
 *   to drop song-cover entries that are byte-identical to the album
 *   cover, avoiding duplicate associations on the dest).
 * - bytes are pulled through `imageCache` so the same source blob is
 *   fetched at most once per send run.
 * - the first image (or the one flagged `is_primary` on the source) is
 *   uploaded with `is_primary: true`.
 * - returns aggregated counts for logging.
 */
export async function uploadImagesToDest(opts: {
  sourceTransport: Transport;
  destTransport: Transport;
  entityType: ImageEntityType;
  entityId: string;
  images: ImageMetadata[] | undefined;
  logPrefix: string;
  imageCache?: ImageBlobCache;
  skipBlobIds?: Set<string>;
}): Promise<UploadImagesResult> {
  const {
    sourceTransport,
    destTransport,
    entityType,
    entityId,
    images,
    logPrefix,
    imageCache,
    skipBlobIds,
  } = opts;
  const result: UploadImagesResult = {
    attempted: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
  };
  if (!images || images.length === 0) {
    debug("uploadImagesToDest", `${logPrefix} no images to upload for ${entityType} ${entityId}`);
    return result;
  }

  const anyPrimary = images.some((i) => i.is_primary);
  info(
    "uploadImagesToDest",
    `${logPrefix} uploading ${images.length} image(s) to dest for ${entityType} ${entityId}`,
  );

  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    const blobId = img.remote_blob_id;
    if (!blobId) {
      result.skipped += 1;
      debug(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] skipped — no remote_blob_id`,
      );
      continue;
    }
    if (skipBlobIds?.has(blobId)) {
      result.skipped += 1;
      debug(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] skipped — blob ${blobId} already covered by a higher-level entity (e.g. album cover)`,
      );
      continue;
    }
    result.attempted += 1;

    // 1. pull bytes from source via its transport (with per-send cache).
    let bytes: Uint8Array;
    let mimeType: string;
    const cached = imageCache?.get(blobId);
    if (cached) {
      bytes = cached.bytes;
      mimeType = cached.mime;
      debug(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] cache hit for source blob ${blobId} (${bytes.byteLength}b)`,
      );
    } else {
      try {
        debug(
          "uploadImagesToDest",
          `${logPrefix} [img ${idx}] fetching source blob ${blobId}`,
        );
        const blob = await sourceTransport.fetchBlob(blobId);
        // copy into a fresh ArrayBuffer-backed view so Blob/FormData is happy
        // across all worker/threadpool combinations.
        bytes = new Uint8Array(blob.data.byteLength);
        bytes.set(blob.data);
        mimeType = blob.contentType || "image/jpeg";
        imageCache?.set(blobId, { bytes, mime: mimeType });
        debug(
          "uploadImagesToDest",
          `${logPrefix} [img ${idx}] got ${bytes.byteLength}b (${mimeType})`,
        );
      } catch (e) {
        result.failed += 1;
        warn(
          "uploadImagesToDest",
          `${logPrefix} [img ${idx}] source fetchBlob failed for ${blobId}: ${String(e)}`,
        );
        continue;
      }
    }

    // 2. upload to dest via /api/upload/image (multipart).
    const isPrimary = anyPrimary ? !!img.is_primary : idx === 0;
    const filename = filenameForMime(mimeType, idx);
    try {
      const fd = new FormData();
      // cast the buffer to ArrayBuffer — `bytes.buffer` may be typed as
      // `ArrayBufferLike` (union with SharedArrayBuffer) which Blob's
      // `BlobPart` doesn't accept in strict mode.
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      fd.append("file", new Blob([ab], { type: mimeType }), filename);
      fd.append(
        "associate_with",
        JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          is_primary: isPrimary,
        }),
      );
      debug(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] POST /api/upload/image (primary=${isPrimary}, ${bytes.byteLength}b)`,
      );
      const resp = await destTransport.upload("/api/upload/image", fd);
      if (resp.status < 200 || resp.status >= 300) {
        result.failed += 1;
        warn(
          "uploadImagesToDest",
          `${logPrefix} [img ${idx}] upload http ${resp.status}: ${resp.body}`,
        );
        continue;
      }
      let parsed: {
        success?: boolean;
        data?: { blob_id?: string; existing?: boolean };
        errors?: Array<{ detail?: string }>;
      } = {};
      try {
        parsed = JSON.parse(resp.body);
      } catch {
        // non-json body; treat as success if status is 2xx.
      }
      if (parsed.success === false) {
        result.failed += 1;
        warn(
          "uploadImagesToDest",
          `${logPrefix} [img ${idx}] upload failed: ${parsed.errors?.[0]?.detail ?? resp.body}`,
        );
        continue;
      }
      result.uploaded += 1;
      info(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] uploaded blob_id=${parsed.data?.blob_id ?? "?"} existing=${parsed.data?.existing ?? "?"}`,
      );
    } catch (e) {
      result.failed += 1;
      warn(
        "uploadImagesToDest",
        `${logPrefix} [img ${idx}] upload threw: ${String(e)}`,
      );
    }
  }

  info(
    "uploadImagesToDest",
    `${logPrefix} ${entityType} ${entityId} images: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.failed} failed`,
  );
  return result;
}

function filenameForMime(mime: string, idx: number): string {
  const ext =
    mime === "image/png" ? "png" :
    mime === "image/webp" ? "webp" :
    mime === "image/gif" ? "gif" :
    mime === "image/avif" ? "avif" :
    "jpg";
  return `image-${idx}.${ext}`;
}
