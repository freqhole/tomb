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
  getCachedP2PBlobUrl,
  isP2PRemoteSync,
  isValidHttpUrl,
  resolveBlobUrl,
  type ThumbnailSize,
} from "../../music/services/storage/blobResolver";
import {
  getBlobObjectURL,
  getCachedBlobObjectURL,
} from "../../music/services/storage/blobs";
import { isCharnelManagedRemoteSync } from "../../music/services/storage/transportCache";
import type { ImageMetadata } from "../../music/services/storage/types";

type Entry =
  | { state: "loading"; promise: Promise<HTMLImageElement | null> }
  | { state: "ready"; image: HTMLImageElement }
  | { state: "error" };

const cache = new Map<string, Entry>();

// resolution-in-flight tracker so multiple draws for the same album
// don't all kick off the same async lookup.
const resolving = new Set<string>();

// negative cache: keys that have already been tried and failed.
// without this every redraw would re-issue the same OPFS / transport
// lookup forever (the local opfs read in particular thrashes hard when
// an image carries a `local_blob_id` that is only resolvable through
// the charnel-managed remote — see MediaImage's fall-through comment).
const failed = new Set<string>();

// resolved-url memo: image identity → final url we should hand to
// `getImage`. populated by the async branches so subsequent draws
// short-circuit straight to the canvas image cache without re-walking
// the priority chain.
const resolvedFor = new Map<string, string>();

function imageKey(img: ImageMetadata, size: ThumbnailSize | undefined): string {
  return [
    img.local_blob_id ?? "",
    img.remote_server_id ?? "",
    img.remote_blob_id ?? "",
    img.remote_url ?? "",
    size ?? 0,
  ].join("|");
}

const DEFAULT_THUMB: ThumbnailSize = 200;

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

  // fast path: we have already resolved this image once.
  const memoKey = imageKey(image, thumbSize);
  const memoed = resolvedFor.get(memoKey);
  if (memoed) return getImage(memoed, onReady);

  // (1) local opfs blob. mirror MediaImage: try sync cache first, then
  // an async `getBlobObjectURL`. if the lookup fails (charnel-managed
  // blobs live in sqlite, not opfs), mark the key as failed and fall
  // through to the remote branch — do NOT keep retrying every redraw.
  if (image.local_blob_id) {
    const cached = getCachedBlobObjectURL(image.local_blob_id);
    if (cached) {
      const url = cached;
      resolvedFor.set(memoKey, url);
      return getImage(url, onReady);
    }
    const key = `local:${image.local_blob_id}`;
    if (!failed.has(key)) {
      if (!resolving.has(key)) {
        resolving.add(key);
        void getBlobObjectURL(image.local_blob_id)
          .then((url) => {
            if (url) {
              resolvedFor.set(memoKey, url);
              getImage(url, onReady);
            } else {
              failed.add(key);
              if (onReady) onReady();
            }
          })
          .catch(() => {
            failed.add(key);
            if (onReady) onReady();
          })
          .finally(() => {
            resolving.delete(key);
          });
      }
      // local lookup still pending — don't kick off a parallel remote
      // fetch yet; wait for the opfs read to settle.
      return null;
    }
    // local is known-bad for this blob id: fall through to remote.
  }

  // (2) remote with server id — check the in-memory p2p cache first,
  // then either use a plain http url directly or kick off an async
  // transport fetch.
  if (image.remote_blob_id && image.remote_server_id) {
    const p2pCached = getCachedP2PBlobUrl(
      image.remote_blob_id,
      image.remote_server_id
    );
    if (p2pCached) {
      resolvedFor.set(memoKey, p2pCached);
      return getImage(p2pCached, onReady);
    }
    const isP2P = isP2PRemoteSync(image.remote_server_id);
    const isCharnel = isCharnelManagedRemoteSync(image.remote_server_id);
    if (
      isP2P === false &&
      !isCharnel &&
      isValidHttpUrl(image.remote_url)
    ) {
      // foreign http url — use as-is. /thumb/:size is a charnel-server
      // convention and breaks arbitrary origins (picsum, etc.).
      const url = image.remote_url!;
      resolvedFor.set(memoKey, url);
      return getImage(url, onReady);
    }
    const key = `remote:${image.remote_server_id}/${image.remote_blob_id}/${thumbSize ?? 0}`;
    if (!failed.has(key) && !resolving.has(key)) {
      resolving.add(key);
      void resolveBlobUrl(
        image.remote_blob_id,
        image.remote_server_id,
        "image",
        undefined,
        thumbSize
      )
        .then((url) => {
          resolvedFor.set(memoKey, url);
          getImage(url, onReady);
        })
        .catch(() => {
          failed.add(key);
          if (onReady) onReady();
        })
        .finally(() => {
          resolving.delete(key);
        });
    }
    return null;
  }

  // (3) last resort: plain http url with no blob ids at all (storybook
  // mocks, externally-hosted art). use the url verbatim — /thumb/:size
  // is a charnel-server convention and would break arbitrary origins.
  if (isValidHttpUrl(image.remote_url)) {
    const url = image.remote_url!;
    resolvedFor.set(memoKey, url);
    return getImage(url, onReady);
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
