// shared image inlining for the `/api/sync/*-by-blake3` routes.
//
// grimoire's `SyncImageRef` carries either inline bytes (base64 + sha256) or
// a bare sha256 the destination is expected to already have. both the song
// and video sync paths build these the same way: fetch each image's bytes
// from the source transport, hash, encode.

import type { Transport } from "@freqhole/api-client";
import { debug, warn } from "../../../utils/logger";

/** shape sent to grimoire for each image, matching `SyncImageRef`. a null
 * `data_base64` means "look this up by sha256 on the destination". */
export interface SyncImageRefBody {
  content_sha256: string;
  data_base64: string | null;
  mime_type: string;
  is_primary: boolean;
  blob_type: string | null;
}

/** transport-agnostic description of one image to inline. callers map their
 * own image shape (music's `ImageMetadata.remote_blob_id`, video's
 * `images[].blob_id`) onto this. */
export interface InlinableImage {
  blobId: string | null | undefined;
  isPrimary: boolean;
  blobType: string | null | undefined;
}

/** per-image-bytes cache keyed by source blob id, so an album cover that
 * appears both as song.images[k] AND song.album_images[k] across many tracks
 * is fetched once. */
export type InlineImageCache = Map<string, { sha256: string; b64: string; mime: string }>;

export function bytesToBase64(bytes: Uint8Array): string {
  // chunked to avoid maximum-call-stack on String.fromCharCode for big arrays.
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", ab);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * fetch each image's bytes from the source transport and build inline
 * `SyncImageRef` payloads (sha256 + base64). per-image fetch failures are
 * skipped (logged as warn) so a missing blob never blocks the sync itself.
 */
export async function inlineImagesForSync(
  images: InlinableImage[] | undefined,
  sourceTransport: Transport,
  cache: InlineImageCache,
  logPrefix: string
): Promise<SyncImageRefBody[]> {
  if (!images || images.length === 0) return [];
  const out: SyncImageRefBody[] = [];
  const anyPrimary = images.some((i) => i.isPrimary);
  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    const blobId = img.blobId;
    if (!blobId) {
      debug("syncImages", `${logPrefix} [img ${idx}] no blob id, skipping`);
      continue;
    }
    let entry = cache.get(blobId);
    if (!entry) {
      try {
        const blob = await sourceTransport.fetchBlob(blobId);
        const bytes = new Uint8Array(blob.data.byteLength);
        bytes.set(blob.data);
        const sha256 = await sha256Hex(bytes);
        entry = {
          sha256,
          b64: bytesToBase64(bytes),
          mime: blob.contentType || "image/jpeg",
        };
        cache.set(blobId, entry);
        debug(
          "syncImages",
          `${logPrefix} [img ${idx}] fetched source blob ${blobId.slice(0, 8)} (${bytes.byteLength}b, ${entry.mime}, sha=${sha256.slice(0, 8)})`
        );
      } catch (e) {
        warn(
          "syncImages",
          `${logPrefix} [img ${idx}] fetchBlob failed for ${blobId}: ${String(e)}`
        );
        continue;
      }
    }
    out.push({
      content_sha256: entry.sha256,
      data_base64: entry.b64,
      mime_type: entry.mime,
      is_primary: anyPrimary ? img.isPrimary : idx === 0,
      blob_type: img.blobType ?? "original",
    });
  }
  return out;
}
