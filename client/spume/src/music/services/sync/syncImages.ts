// shared image referencing for the `/api/sync/*-by-blake3` routes.
//
// grimoire's `SyncImageRef` carries only a blake3 hash + metadata - never
// raw bytes. the destination pulls the actual blob from `source_node_id`
// (the same peer named in the parent sync request) via the same
// iroh-blobs verified-streaming mechanism used for the main audio/video
// blob. this file's job is just to resolve each image's blake3 hash - via
// a cheap metadata lookup (no bytes fetched client-side) for an already-
// known blob id, or by staging raw bytes into this device's own P2P-
// servable store for the one case (`inlineRawUrlForSync`) where there's no
// blob id to look up at all.

import { FreqholeClient } from "@freqhole/api-client";
import type { Transport } from "@freqhole/api-client";
import { getMiddenNode } from "../../../app/api/client";
import { debug, warn } from "../../../utils/logger";

/** shape sent to grimoire for each image, matching `SyncImageRef`. */
export interface SyncImageRefBody {
  blake3: string;
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

/** per-image metadata cache keyed by source blob id, so an album cover that
 * appears both as song.images[k] AND song.album_images[k] across many tracks
 * is looked up once. */
export type InlineImageCache = Map<string, { blake3: string; mime: string }>;

/** maps a spume-side `ImageMetadata[]` (music's `RemoteSong.images`/
 * `.album_images`, etc) onto `inlineImagesForSync`'s transport-agnostic
 * `InlinableImage[]` shape. */
export function toInlinableImages(
  images:
    | Array<{
        remote_blob_id?: string | null;
        is_primary?: boolean | null;
        blob_type?: string | null;
      }>
    | undefined
): InlinableImage[] {
  return (images ?? []).map((img) => ({
    blobId: img.remote_blob_id,
    isPrimary: !!img.is_primary,
    blobType: img.blob_type,
  }));
}

/**
 * resolve each image's blake3 hash (+ mime type) from the source transport's
 * blob metadata - a single small JSON round trip per image, no bytes ever
 * fetched or re-encoded client-side. per-image lookup failures, or a blob
 * with no blake3 computed yet, are skipped (logged as warn) so a missing/
 * not-yet-hashed blob never blocks the sync itself.
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
  const client = new FreqholeClient(sourceTransport);
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
        const result = await client.music.blobMetadata({ id: blobId });
        if (!result.success) {
          warn(
            "syncImages",
            `${logPrefix} [img ${idx}] blob_metadata lookup failed for ${blobId}: ${String(result.error)}`
          );
          continue;
        }
        const meta = result.data;
        if (!meta.blake3) {
          warn(
            "syncImages",
            `${logPrefix} [img ${idx}] blob ${blobId.slice(0, 8)} has no blake3 yet, skipping`
          );
          continue;
        }
        entry = { blake3: meta.blake3, mime: meta.mime || "image/jpeg" };
        cache.set(blobId, entry);
        debug(
          "syncImages",
          `${logPrefix} [img ${idx}] resolved source blob ${blobId.slice(0, 8)} -> blake3=${entry.blake3.slice(0, 8)} (${entry.mime})`
        );
      } catch (e) {
        warn(
          "syncImages",
          `${logPrefix} [img ${idx}] blob_metadata lookup failed for ${blobId}: ${String(e)}`
        );
        continue;
      }
    }
    out.push({
      blake3: entry.blake3,
      mime_type: entry.mime,
      is_primary: anyPrimary ? img.isPrimary : idx === 0,
      blob_type: img.blobType ?? "original",
    });
  }
  return out;
}

/** resolves a single already-resolved image url with no source-transport
 * blob-id lookup - used for artwork that arrived over the
 * `freqhole-player/1` control wire (`RemoteMediaRef.artwork_*_url` - see
 * `mediaRefResolve.ts`), which is a resolved url/data-url already, not a
 * blob id on any transport `inlineImagesForSync` above could look up.
 *
 * there's no peer that already serves this content by hash (it's an
 * arbitrary external url, not a grimoire blob), so unlike every other path
 * in this file this DOES fetch the bytes client-side - but instead of
 * embedding them in the sync payload, it stages them into this device's
 * own midden node (`import_blob`, which computes + returns the real
 * blake3), making them P2P-servable, then returns just that hash like
 * everything else. no base64 ever reaches grimoire. if midden isn't
 * available on this transport, the image is skipped rather than falling
 * back to inlining bytes. */
export async function inlineRawUrlForSync(
  url: string | undefined,
  isPrimary: boolean,
  blobType: string
): Promise<SyncImageRefBody | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      warn("syncImages", `inlineRawUrlForSync: fetch failed (${res.status})`);
      return undefined;
    }
    const blob = await res.blob();
    const node = await getMiddenNode();
    if (!node.import_blob) {
      warn("syncImages", "inlineRawUrlForSync: no local P2P store to stage into, skipping");
      return undefined;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const blake3 = await node.import_blob(bytes);
    return {
      blake3,
      mime_type: blob.type || "image/jpeg",
      is_primary: isPrimary,
      blob_type: blobType,
    };
  } catch (err) {
    warn("syncImages", "inlineRawUrlForSync failed:", err);
    return undefined;
  }
}
