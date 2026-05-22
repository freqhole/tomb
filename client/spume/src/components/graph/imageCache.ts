// async image cache for canvas-rendered album thumbnails.
// the cache is per-url and shared across all graph instances on the page.
// nodes that have no image draw a text tile instead.
//
// resolution goes through the same primitives MediaImage uses
// (`resolveImageUrlSync` + `resolveBlobUrl`) so local opfs blobs, p2p
// cached blobs, charnel-managed remotes and plain http remotes all
// work the same way. crucially we do NOT set `crossOrigin` on the
// underlying `<img>` element: the canvas only draws (never reads back
// pixels), and requiring CORS headers would break every server that
// does not opt in.

import {
  isP2PRemoteSync,
  isValidHttpUrl,
  resolveBlobUrl,
  resolveImageUrlSync,
  type ThumbnailSize,
} from "../../music/services/storage/blobResolver";
import { isCharnelManagedRemoteSync } from "../../music/services/storage/transportCache";
import type { ImageMetadata } from "../../music/services/storage/types";

type Entry =
  | { state: "loading"; promise: Promise<HTMLImageElement | null> }
  | { state: "ready"; image: HTMLImageElement }
  | { state: "error" };

const cache = new Map<string, Entry>();

// resolution-in-flight tracker so multiple draws for the same album
// don't all kick off the same `resolveBlobUrl` async lookup.
const resolving = new Set<string>();

const DEFAULT_THUMB: ThumbnailSize = 200;

/** append `/thumb/:size` to plain http urls; leave blob:/data:/asset:
 *  urls untouched (they are concrete object refs). */
function withThumb(url: string, size: ThumbnailSize | undefined): string {
  if (!size) return url;
  const lower = url.toLowerCase();
  if (
    lower.startsWith("blob:") ||
    lower.startsWith("data:") ||
    lower.startsWith("asset://")
  ) {
    return url;
  }
  return `${url}/thumb/${size}`;
}

/**
 * get an image synchronously if cached, otherwise kick off a load and call
 * `onReady` when decoded. returns the image element if already decoded.
 */
export function getImage(
  url: string,
  onReady?: () => void
): HTMLImageElement | null {
  const hit = cache.get(url);
  if (hit) {
    if (hit.state === "ready") return hit.image;
    if (hit.state === "loading" && onReady) {
      void hit.promise.then(() => onReady());
    }
    return null;
  }

  const img = new Image();
  img.decoding = "async";
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    img.onload = () => {
      cache.set(url, { state: "ready", image: img });
      resolve(img);
      if (onReady) onReady();
    };
    img.onerror = () => {
      cache.set(url, { state: "error" });
      resolve(null);
      if (onReady) onReady();
    };
  });
  cache.set(url, { state: "loading", promise });
  img.src = url;
  return null;
}

/**
 * canonical blob-image loader for graph nodes. mirrors `MediaImage`'s
 * resolution order:
 *   1. local opfs blob (via `resolveImageUrlSync`)
 *   2. cached p2p / charnel blob (also via `resolveImageUrlSync`)
 *   3. valid http url
 *   4. async fetch via `resolveBlobUrl` for p2p / charnel / unknown
 *      transports — caller is notified via `onReady` once the blob
 *      object url lands in the cache so the canvas can redraw.
 *
 * returns the decoded `<img>` if a usable url is already cached;
 * otherwise null (and triggers any needed async work).
 */
export function getImageFor(
  image: ImageMetadata | null | undefined,
  thumbSize: ThumbnailSize | undefined = DEFAULT_THUMB,
  onReady?: () => void
): HTMLImageElement | null {
  if (!image) return null;

  // (1) sync resolution covers local opfs + cached p2p + plain http.
  const syncUrl = resolveImageUrlSync(image);
  if (syncUrl) {
    // only append `/thumb/:size` for plain http urls; blob/data urls
    // are concrete and have no thumb endpoint.
    return getImage(withThumb(syncUrl, thumbSize), onReady);
  }

  // (2) need an async lookup: only meaningful when we have a remote
  // blob id + remote server id to ask through the transport layer.
  if (image.remote_blob_id && image.remote_server_id) {
    const isP2P = isP2PRemoteSync(image.remote_server_id);
    const isCharnel = isCharnelManagedRemoteSync(image.remote_server_id);
    // plain http remote with a usable url: just use `getImage` directly.
    if (
      isP2P === false &&
      !isCharnel &&
      isValidHttpUrl(image.remote_url)
    ) {
      return getImage(withThumb(image.remote_url!, thumbSize), onReady);
    }
    // p2p / charnel / unknown: kick off the async transport fetch.
    const key = `${image.remote_server_id}/${image.remote_blob_id}/thumb/${thumbSize ?? 0}`;
    if (!resolving.has(key)) {
      resolving.add(key);
      void resolveBlobUrl(
        image.remote_blob_id,
        image.remote_server_id,
        "image",
        undefined,
        thumbSize
      )
        .then((url) => {
          // prime the canvas image cache, then notify the caller.
          getImage(url, onReady);
        })
        .catch(() => {
          if (onReady) onReady();
        })
        .finally(() => {
          resolving.delete(key);
        });
    }
    return null;
  }

  // (3) last resort: plain http url with no blob ids at all.
  if (isValidHttpUrl(image.remote_url)) {
    return getImage(withThumb(image.remote_url!, thumbSize), onReady);
  }

  return null;
}

/** preload a batch of urls; resolves once all settle. */
export function preloadImages(urls: string[]): Promise<void> {
  return Promise.allSettled(
    urls.map(
      (u) =>
        new Promise<void>((resolve) => {
          getImage(u, resolve);
          // resolve immediately if already cached / errored
          const hit = cache.get(u);
          if (hit && hit.state !== "loading") resolve();
        })
    )
  ).then(() => undefined);
}

export function clearImageCache(): void {
  cache.clear();
}
