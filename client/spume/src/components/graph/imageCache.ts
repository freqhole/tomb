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
import { bump, gauge, timing } from "./perfLog";

// what we hand to canvas drawImage. we deliberately store the
// HTMLImageElement and not an ImageBitmap: we tried promoting
// to bitmap (createImageBitmap) for off-thread decode + eager
// GPU upload, but on webkit / tauri's WKWebView that path
// blocks the main thread for hundreds of ms per image and
// holds a GPU texture per cache entry — with 1k+ images the
// VRAM cost stalled paint. plain HTMLImageElement + decode()
// is consistently fast across engines and lets the browser
// upload lazily on first drawImage.
type DrawableImage = HTMLImageElement;

type Entry =
  | {
      state: "loading";
      promise: Promise<DrawableImage | null>;
      /** dedupe per-url ready listeners so repeated draws while the
       *  image is in-flight don't pile up hundreds of `.then()`
       *  callbacks (each draw attaches its own otherwise). a single
       *  Set keyed by fn reference keeps the listener count to the
       *  number of distinct callers — typically 1 per GraphCanvas. */
      listeners: Set<() => void>;
    }
  | { state: "ready"; image: DrawableImage }
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

// in-flight load concurrency cap. when the graph first paints with
// thousands of distinct album images, kicking `new Image(); img.src=
// ...` for all of them at once does three bad things:
//   1. saturates the browser's per-origin connection pool (http/1.1
//      caps at ~6, http/2 multiplexes but the server-side per-conn
//      handler queue still serializes work)
//   2. piles up thousands of pending `onload` / `decode` callbacks
//      that all fire in close succession when the burst lands,
//      stalling the main thread for hundreds of ms
//   3. any single slow / federation-timeout endpoint blocks every
//      slot it's holding — with no cap, a flaky peer can occupy
//      hundreds of connections for many seconds
// the cap defers `img.src = url` until a slot frees, so the burst
// becomes a steady trickle. listeners (`onReady`) still fire as
// soon as each image lands, so the user sees images stream in.
const MAX_INFLIGHT = 8;
let inFlight = 0;
const pending: Array<() => void> = [];

function acquireSlot(start: () => void): void {
  if (inFlight < MAX_INFLIGHT) {
    inFlight++;
    start();
  } else {
    pending.push(start);
    gauge("img.queue.depth", pending.length);
  }
}

function releaseSlot(): void {
  inFlight--;
  const next = pending.shift();
  if (next) {
    inFlight++;
    gauge("img.queue.depth", pending.length);
    next();
  }
}

// resolved-url memo: image identity → final url we should hand to
// `getImage`. populated by the async branches so subsequent draws
// short-circuit straight to the canvas image cache without re-walking
// the priority chain.
const _resolvedFor = new Map<string, string>();
const resolvedFor = {
  get(key: string): string | undefined {
    return _resolvedFor.get(key);
  },
  set(key: string, url: string): void {
    const prev = _resolvedFor.get(key);
    if (prev && prev !== url) {
      // a previously-resolved key now resolves to a different url —
      // typically means the underlying ImageMetadata gained a new
      // local/p2p source (OPFS hydration after a remote fetch) so
      // future draws will hit a fresh (loading) cache entry and the
      // user sees a brief placeholder flash. count it so we can see
      // how often it happens.
      bump("img.resolve.changed");
    }
    _resolvedFor.set(key, url);
  },
};

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
 * `onReady` when decoded. returns a drawable (ImageBitmap when supported,
 * HTMLImageElement otherwise) if already decoded.
 */
export function getImage(
  url: string,
  onReady?: () => void
): DrawableImage | null {
  const hit = cache.get(url);
  if (hit) {
    if (hit.state === "ready") {
      bump("img.cache.hit");
      return hit.image;
    }
    if (hit.state === "loading") {
      bump("img.cache.pending");
      if (onReady) {
        // Set-based dedupe: the same `requestDraw` reference from a
        // given GraphCanvas only registers once no matter how many
        // frames draw against this not-yet-ready image.
        hit.listeners.add(onReady);
      }
      return null;
    }
    bump("img.cache.error");
    return null;
  }
  bump("img.cache.miss");

  const img = new Image();
  img.decoding = "async";
  const listeners = new Set<() => void>();
  if (onReady) listeners.add(onReady);
  const fireReady = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // ignore listener failures — one bad onReady shouldn't take
        // down the whole queue.
      }
    }
    listeners.clear();
  };
  let loadStart = 0;
  const promise = new Promise<DrawableImage | null>((resolve) => {
    img.onload = () => {
      // await image.decode() so the FIRST drawImage() on the main
      // thread doesn't pay a synchronous decode cost — that decode
      // was the source of visible "flashes" / frame stalls right
      // after an image finished loading (especially common while
      // streaming many album thumbs at once).
      const finish = () => {
        cache.set(url, { state: "ready", image: img });
        timing("img.load", performance.now() - loadStart);
        bump("img.load.done");
        gauge("img.cache.size", cache.size);
        releaseSlot();
        resolve(img);
        fireReady();
      };
      const decodeOk =
        typeof (img as HTMLImageElement & { decode?: () => Promise<void> })
          .decode === "function";
      if (decodeOk) {
        img
          .decode()
          .then(finish)
          .catch(() => {
            // some browsers (or images served with restrictive headers)
            // refuse to decode async — still usable, fall back to the
            // sync path the browser takes on first drawImage().
            bump("img.decode.fail");
            finish();
          });
      } else {
        finish();
      }
    };
    img.onerror = () => {
      cache.set(url, { state: "error" });
      bump("img.load.error");
      releaseSlot();
      resolve(null);
      fireReady();
    };
  });
  cache.set(url, { state: "loading", promise, listeners });
  // defer `img.src = url` until a slot is available. browsers begin
  // the network request the moment `src` is assigned, so gating this
  // is what actually bounds simultaneous connections.
  acquireSlot(() => {
    loadStart = performance.now();
    img.src = url;
  });
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
): DrawableImage | null {
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
