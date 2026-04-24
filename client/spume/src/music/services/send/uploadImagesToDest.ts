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
 * fetch each image from the source and upload to dest as a normal
 * /api/upload/image call with associate_with pointing at `entityId`.
 *
 * - images without `remote_blob_id` are skipped (no source-side id to
 *   pull from).
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
}): Promise<UploadImagesResult> {
  const { sourceTransport, destTransport, entityType, entityId, images, logPrefix } = opts;
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
    result.attempted += 1;

    // 1. pull bytes from source via its transport.
    let bytes: Uint8Array;
    let mimeType: string;
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
