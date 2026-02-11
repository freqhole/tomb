// album art images from musicbrainz / cover art archive
// handles rate-limited async loading with per-image loading states and retry
import { createSignal, For, onCleanup, Show } from "solid-js";
import { error as errorLog } from "../../utils/logger";

// ── rate-limited image loader ──
// staggers requests to avoid overwhelming coverartarchive.org (which resets connections)

/** minimum delay between image load kicks (ms) */
const STAGGER_DELAY = 300;
/** max retries per image */
const MAX_RETRIES = 3;
/** delay before first retry (doubles each attempt) */
const RETRY_BASE_DELAY = 1000;

type ImageState = "pending" | "loading" | "loaded" | "error";

interface QueueEntry {
  url: string;
  resolve: (objectUrl: string) => void;
  reject: (err: Error) => void;
  retries: number;
}

// module-level queue so all image loads share the same rate limiter
let queue: QueueEntry[] = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const entry = queue.shift()!;
    try {
      const objectUrl = await fetchImageWithRetry(entry.url, entry.retries);
      entry.resolve(objectUrl);
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
    // stagger between requests
    if (queue.length > 0) {
      await sleep(STAGGER_DELAY);
    }
  }

  processing = false;
}

async function fetchImageWithRetry(url: string, maxRetries: number): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        errorLog(
          `image load failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`,
          url
        );
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("image load failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** queue an image URL for rate-limited loading. returns a blob object URL. */
function loadImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push({ url, resolve, reject, retries: MAX_RETRIES });
    processQueue();
  });
}

/** revoke a previously loaded object URL to free memory */
function revokeImage(objectUrl: string) {
  if (objectUrl.startsWith("blob:")) {
    URL.revokeObjectURL(objectUrl);
  }
}

// ── types & component ──

export interface AlbumArtImage {
  /** display URL for thumbnail (~250-500px) */
  thumbUrl: string;
  /** full-res URL for import */
  fullUrl: string;
  /** image type labels (e.g. "Front", "Back") */
  types: string[];
}

export interface MusicBrainzAlbumImagesProps {
  images: AlbumArtImage[];
  /** set of URLs currently being imported */
  importingUrls: Set<string>;
  /** set of URLs already imported */
  importedUrls: Set<string>;
  /** called when user wants to import an image by its full URL */
  onImport: (fullUrl: string) => void;
}

/** per-image reactive state for async loading */
function createImageState(thumbUrl: string) {
  const [state, setState] = createSignal<ImageState>("pending");
  const [objectUrl, setObjectUrl] = createSignal<string | null>(null);

  // kick off load
  setState("loading");
  loadImage(thumbUrl)
    .then((url) => {
      setObjectUrl(url);
      setState("loaded");
    })
    .catch(() => {
      setState("error");
    });

  // cleanup blob URL on dispose
  const cleanup = () => {
    const url = objectUrl();
    if (url) revokeImage(url);
  };

  return { state, objectUrl, cleanup };
}

export function MusicBrainzAlbumImages(props: MusicBrainzAlbumImagesProps) {
  return (
    <div class="p-3">
      <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
        album art ({props.images.length} {props.images.length === 1 ? "image" : "images"})
      </div>
      <div class="flex gap-3 overflow-x-auto pb-2">
        <For each={props.images}>
          {(image) => (
            <AlbumArtTile
              image={image}
              importingUrls={props.importingUrls}
              importedUrls={props.importedUrls}
              onImport={props.onImport}
            />
          )}
        </For>
      </div>
    </div>
  );
}

/** single image tile with its own loading state */
function AlbumArtTile(props: {
  image: AlbumArtImage;
  importingUrls: Set<string>;
  importedUrls: Set<string>;
  onImport: (fullUrl: string) => void;
}) {
  const { state, objectUrl, cleanup } = createImageState(props.image.thumbUrl);
  onCleanup(cleanup);

  const isImporting = () => props.importingUrls.has(props.image.fullUrl);
  const isImported = () => props.importedUrls.has(props.image.fullUrl);

  return (
    <div class="flex-shrink-0 group relative">
      {/* loading placeholder */}
      <Show when={state() === "loading" || state() === "pending"}>
        <div class="w-28 h-28 rounded bg-[var(--color-bg-base)] flex items-center justify-center">
          <span class="text-[10px] text-[var(--color-text-tertiary)] animate-pulse">
            loading...
          </span>
        </div>
      </Show>

      {/* error state */}
      <Show when={state() === "error"}>
        <div class="w-28 h-28 rounded bg-[var(--color-bg-base)] flex items-center justify-center">
          <span class="text-[10px] text-[var(--color-text-tertiary)]">failed to load</span>
        </div>
      </Show>

      {/* loaded image */}
      <Show when={state() === "loaded" && objectUrl()}>
        <img
          src={objectUrl()!}
          alt={props.image.types.join(", ") || "album art"}
          class="w-28 h-28 object-cover rounded bg-[var(--color-bg-base)]"
          classList={{ "opacity-50": isImporting() }}
        />
      </Show>

      {/* importing spinner overlay */}
      <Show when={isImporting()}>
        <div class="absolute inset-0 w-28 h-28 bg-black/60 flex items-center justify-center rounded">
          <span class="text-xs text-white animate-pulse">importing...</span>
        </div>
      </Show>

      {/* imported badge */}
      <Show when={isImported() && !isImporting()}>
        <div class="absolute top-1 right-1 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium">
          imported
        </div>
      </Show>

      <div class="text-xs text-[var(--color-text-tertiary)] mt-1 text-center">
        {props.image.types.join(", ") || "other"}
      </div>

      {/* import button on hover (only if loaded + not already imported) */}
      <Show when={state() === "loaded" && !isImported() && !isImporting()}>
        <button
          onClick={() => props.onImport(props.image.fullUrl)}
          class="absolute inset-0 w-28 h-28 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white font-medium rounded"
        >
          import
        </button>
      </Show>
    </div>
  );
}
