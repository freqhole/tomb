/**
 * platform-aware media URL resolution for audio and video playback.
 *
 * handles the platform differences that affect <audio> and <video> elements:
 *
 * - **browser mode**: creates blob: URLs from OPFS data via skein-blob-store.
 *   works everywhere because blob: is a standard web API.
 *
 * - **macOS Tauri**: uses asset:// protocol URLs via convertFileSrc().
 *   supports range requests for efficient streaming of large files.
 *
 * - **Linux Tauri (WebKitGTK)**: asset:// URLs don't work in <audio>/<video>
 *   elements on WebKitGTK. workaround: fetch the file via asset:// protocol,
 *   then create a blob: object URL from the response. this matches the
 *   pattern used in CharnelLocalTransport.ts for the spume/charnel app.
 *
 * blob URL lifecycle: only one media blob URL is kept at a time per category
 * (audio vs video) to avoid memory bloat. previous URLs are revoked when a
 * new one is created.
 */

import { isTauriMode } from "../p2p/tauri-transport";

const TAG = "[media-urls]";

// ---------------------------------------------------------------------------
// platform detection
// ---------------------------------------------------------------------------

/**
 * detect Linux WebKitGTK — the Tauri webview engine on Linux.
 * asset:// URLs don't work for <audio>/<video> elements on this platform.
 * cached at module level since the user agent doesn't change at runtime.
 */
const isLinuxWebKit = typeof navigator !== "undefined" && navigator.userAgent.includes("Linux");

// ---------------------------------------------------------------------------
// blob URL lifecycle management
// ---------------------------------------------------------------------------

/**
 * tracked media blob URLs, one per category.
 * we revoke the previous URL when creating a new one to avoid memory leaks.
 * separate slots for audio and video so playing audio doesn't revoke video.
 */
const mediaBlobSlots: Record<string, { blobId: string; url: string } | null> = {
  audio: null,
  video: null,
};

/**
 * general-purpose media blob URL cache for blob: URLs that should persist
 * for the page session (e.g. browser-mode OPFS blobs). these are NOT
 * revoked on replacement — they're revoked on page unload.
 */
const sessionBlobCache = new Map<string, string>();
let beforeUnloadRegistered = false;

function ensureBeforeUnloadCleanup(): void {
  if (beforeUnloadRegistered) return;
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", () => {
    // revoke all session-cached blob URLs
    for (const url of sessionBlobCache.values()) {
      URL.revokeObjectURL(url);
    }
    sessionBlobCache.clear();

    // revoke tracked media slot URLs
    for (const key of Object.keys(mediaBlobSlots)) {
      const slot = mediaBlobSlots[key];
      if (slot) {
        URL.revokeObjectURL(slot.url);
        mediaBlobSlots[key] = null;
      }
    }
  });
  beforeUnloadRegistered = true;
}

// ---------------------------------------------------------------------------
// tauri helpers (lazily imported to avoid bundling in browser builds)
// ---------------------------------------------------------------------------

type PeersMap = Record<string, { nodeId: string }>;

/** lazy-import and cache convertFileSrc from @tauri-apps/api/core */
let _convertFileSrc: ((path: string) => string) | null = null;

async function getConvertFileSrc(): Promise<(path: string) => string> {
  if (_convertFileSrc) return _convertFileSrc;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  _convertFileSrc = convertFileSrc;
  return convertFileSrc;
}

/** lazy-import and cache invoke from @tauri-apps/api/core */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvokeFn = (cmd: string, args?: any) => Promise<any>;

let _invoke: InvokeFn | null = null;

async function getInvoke(): Promise<InvokeFn> {
  if (_invoke) return _invoke;
  const { invoke } = await import("@tauri-apps/api/core");
  _invoke = invoke as unknown as InvokeFn;
  return _invoke;
}

// ---------------------------------------------------------------------------
// internal: resolve blob to a local filesystem path (tauri only)
// ---------------------------------------------------------------------------

interface BlobPathInfo {
  path: string;
  mime?: string;
}

async function getBlobLocalPath(blobId: string): Promise<BlobPathInfo | null> {
  if (!isTauriMode()) return null;

  try {
    const invoke = await getInvoke();
    const response = (await invoke("api_call", {
      path: `/api/blobs/${blobId}/path`,
      body: {},
    })) as { success: boolean; data?: { path?: string; mime?: string } };

    if (!response.success || !response.data?.path) {
      return null;
    }

    return { path: response.data.path, mime: response.data.mime };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// internal: create a blob: URL by fetching via asset:// protocol
// ---------------------------------------------------------------------------

/**
 * fetch a file via the tauri asset:// protocol and return a blob: object URL.
 * used on Linux WebKitGTK where asset:// can't be used directly in media elements.
 *
 * the `category` parameter controls which slot is used for lifecycle management:
 * creating a new blob URL in a slot revokes the previous one in that slot.
 */
async function createMediaBlobUrl(
  blobId: string,
  localPath: string,
  mime: string | undefined,
  category: "audio" | "video"
): Promise<string> {
  const convertFileSrc = await getConvertFileSrc();

  // revoke previous URL in this category to free memory
  const prev = mediaBlobSlots[category];
  if (prev) {
    URL.revokeObjectURL(prev.url);
    mediaBlobSlots[category] = null;
  }

  const assetUrl = convertFileSrc(localPath);
  const resp = await fetch(assetUrl);
  const arrayBuffer = await resp.arrayBuffer();

  // use the known mime type, fall back to response content-type, then a sensible default
  const blobMime =
    mime ?? resp.headers.get("content-type") ?? (category === "audio" ? "audio/mpeg" : "video/mp4");

  const blob = new Blob([arrayBuffer], { type: blobMime });
  const objectUrl = URL.createObjectURL(blob);

  mediaBlobSlots[category] = { blobId, url: objectUrl };
  return objectUrl;
}

// ---------------------------------------------------------------------------
// internal: get blob URL from OPFS (browser mode)
// ---------------------------------------------------------------------------

async function getBlobUrlFromOpfs(blobId: string): Promise<string | null> {
  // check session cache first
  const cached = sessionBlobCache.get(blobId);
  if (cached) return cached;

  try {
    const { getBlobObjectURL } = await import("../storage/skein-blob-store");
    const url = await getBlobObjectURL(blobId);
    if (url) {
      ensureBeforeUnloadCleanup();
      sessionBlobCache.set(blobId, url);
    }
    return url;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// internal: get blob as data URL from tauri (base64 fallback)
// ---------------------------------------------------------------------------

async function getBlobDataUrl(blobId: string): Promise<string | null> {
  if (!isTauriMode()) return null;

  try {
    const invoke = await getInvoke();
    const response = (await invoke("api_call", {
      path: `/api/blobs/${blobId}/data`,
      body: {},
    })) as { success: boolean; data?: { data?: string; mime?: string } };

    if (!response.success || !response.data?.data || !response.data?.mime) {
      return null;
    }

    return `data:${response.data.mime};base64,${response.data.data}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface MediaUrlOptions {
  /** hint for the media category — controls blob URL slot management */
  category?: "audio" | "video";
  /** connected canvas peers for P2P fallback */
  peers?: PeersMap;
  /** known MIME type (avoids guessing) */
  mime?: string;
}

/**
 * get a playable URL for a media blob.
 *
 * tries sources in priority order:
 * 1. tauri asset:// URL (macOS) or blob: from asset:// fetch (Linux WebKitGTK)
 * 2. OPFS blob: URL (browser mode)
 * 3. base64 data: URL from tauri IPC (tauri fallback)
 * 4. P2P fetch from canvas peers (either mode)
 *
 * returns null if the blob can't be resolved from any source.
 */
export async function getMediaPlaybackUrl(
  blobId: string,
  options: MediaUrlOptions = {}
): Promise<string | null> {
  const { category = "audio", mime } = options;

  ensureBeforeUnloadCleanup();

  // ---- tauri mode: prefer local filesystem path ----

  if (isTauriMode()) {
    const pathInfo = await getBlobLocalPath(blobId);

    if (pathInfo) {
      // on Linux WebKitGTK, asset:// doesn't work for media elements —
      // fetch the file via asset:// and create a blob: URL instead
      if (isLinuxWebKit) {
        try {
          const url = await createMediaBlobUrl(
            blobId,
            pathInfo.path,
            mime ?? pathInfo.mime,
            category
          );
          return url;
        } catch (err) {
          console.warn(TAG, "linux blob URL fallback failed:", err);
          // fall through to other approaches
        }
      } else {
        // macOS / Windows: asset:// URLs work natively
        try {
          const convertFileSrc = await getConvertFileSrc();
          return convertFileSrc(pathInfo.path);
        } catch (err) {
          console.warn(TAG, "convertFileSrc failed:", err);
          // fall through
        }
      }
    }

    // tauri fallback: base64 data URL from IPC
    const dataUrl = await getBlobDataUrl(blobId);
    if (dataUrl) return dataUrl;
  }

  // ---- browser mode: OPFS blob URL ----

  if (!isTauriMode()) {
    const opfsUrl = await getBlobUrlFromOpfs(blobId);
    if (opfsUrl) return opfsUrl;
  }

  // ---- P2P fallback: fetch from canvas peers ----

  if (options.peers) {
    try {
      // delegate to file-utils getFullBlobDataUrl which already has
      // the P2P fetch logic. lazy import to avoid circular dependency.
      const { getFullBlobDataUrl } = await import("../widgets/file-utils");
      const peerUrl = await getFullBlobDataUrl(blobId, options.peers);
      if (peerUrl) return peerUrl;
    } catch (err) {
      console.warn(TAG, "P2P fallback failed:", err);
    }
  }

  return null;
}

/**
 * revoke a previously created media blob URL and clear its slot.
 * safe to call even if no URL exists for the given category.
 */
export function revokeMediaUrl(category: "audio" | "video"): void {
  const slot = mediaBlobSlots[category];
  if (slot) {
    URL.revokeObjectURL(slot.url);
    mediaBlobSlots[category] = null;
  }
}

/**
 * revoke all tracked media blob URLs (both audio and video slots).
 * does NOT clear the session cache — those are cleaned up on page unload.
 */
export function revokeAllMediaUrls(): void {
  revokeMediaUrl("audio");
  revokeMediaUrl("video");
}

/**
 * check whether we're on Linux WebKitGTK (where asset:// media is broken).
 * exposed for testing and conditional UI logic.
 */
export function isLinuxWebKitGTK(): boolean {
  return isLinuxWebKit;
}
