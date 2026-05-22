// async image cache for canvas-rendered album thumbnails.
// the cache is per-url and shared across all graph instances on the page.
// nodes that have no image draw a text tile instead.

type Entry =
  | { state: "loading"; promise: Promise<HTMLImageElement | null> }
  | { state: "ready"; image: HTMLImageElement }
  | { state: "error" };

const cache = new Map<string, Entry>();

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
  img.crossOrigin = "anonymous";
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
