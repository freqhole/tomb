// media session artwork resolution
// separate file to avoid circular dependency with blobResolver

import { resolveBlobUrl } from "../storage/blobResolver";
import { getBlobObjectURL } from "../storage/blobs";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { debug } from "../../../utils/logger";
import type { Song } from "../storage/types";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { readVideoPosterFromOPFS } from "../../../video/services/opfs/helpers";

// get artwork URL for media session (async - may need to fetch from local storage or P2P)
export async function getMediaSessionArtwork(song: Song): Promise<MediaImage[]> {
  const images = getSongDisplayImages(song);
  const bestImage = pickBestImage(images);
  if (!bestImage) return [];

  // helper to create MediaImage array from a URL
  const makeArtwork = (src: string): MediaImage[] => [
    { src, sizes: "512x512", type: "image/jpeg" },
    { src, sizes: "256x256", type: "image/jpeg" },
    { src, sizes: "96x96", type: "image/jpeg" },
  ];

  // priority 1: local blob if available (OPFS/cache)
  if (bestImage.local_blob_id) {
    const objectUrl = await getBlobObjectURL(bestImage.local_blob_id);
    if (objectUrl) {
      return makeArtwork(objectUrl);
    }
  }

  // priority 2: remote blob via P2P/Tauri transport (resolveBlobUrl handles caching)
  if (bestImage.remote_blob_id && bestImage.remote_server_id) {
    try {
      const url = await resolveBlobUrl(
        bestImage.remote_blob_id,
        bestImage.remote_server_id,
        "image"
      );
      if (url) {
        return makeArtwork(url);
      }
    } catch (err) {
      debug("mediaSession", "failed to resolve P2P artwork:", err);
      // fall through to remote_url
    }
  }

  // priority 3: remote URL (HTTP servers)
  if (bestImage.remote_url) {
    return makeArtwork(bestImage.remote_url);
  }

  return [];
}

/**
 * best-effort: resolve a song's cover art to a `file://` path on disk, for
 * the OS media session (`mediaSessionBridge.ts`'s push to
 * `media_session_set_track`) - unlike the browser's own
 * `navigator.mediaSession`, the OS media widget needs a real file, not a
 * same-process `blob:` URL.
 *
 * priority 1: `local_blob_id` already on disk in grimoire's blob store -
 * resolved directly via `resolve_blob_path`, no byte-copying needed.
 * priority 2: whatever `getMediaSessionArtwork` above already knows how
 * to fetch (P2P remote / HTTP) for the in-app session - fetched and
 * written to a real file via the same `write_media_session_artwork`
 * command the video poster path below uses, rather than a third
 * resolution mechanism. returns `null` (not an error) if nothing
 * resolves either way.
 */
export async function getLocalArtworkFilePath(song: Song): Promise<string | null> {
  const images = getSongDisplayImages(song);
  const bestImage = pickBestImage(images);
  const blobId = bestImage?.local_blob_id;
  if (blobId) {
    try {
      // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ path: string }>("resolve_blob_path", { blobId });
      if (result.path) return toFileUrl(result.path);
    } catch {
      // fall through to the P2P/HTTP fallback below.
    }
  }

  const remoteUrl = (await getMediaSessionArtwork(song))[0]?.src;
  if (!remoteUrl) return null;
  try {
    const bytes = new Uint8Array(await (await fetch(remoteUrl)).arrayBuffer());
    return await writeBytesForOsMediaSession(bytes);
  } catch (err) {
    debug("mediaSession", "failed to fetch remote artwork for OS media session:", err);
    return null;
  }
}

/**
 * a raw filesystem path handed straight to `file://${path}` produces an
 * invalid/unparseable URI the instant the path contains a space (or any
 * other character a URI must percent-encode) - which on macOS is the
 * common case, not the exception (`~/Library/Application Support/...`).
 * `encodeURI` leaves `/` alone (it's a URI structural character, not
 * data) while still escaping everything that needs it.
 */
function toFileUrl(path: string): string {
  return `file://${encodeURI(path)}`;
}

/**
 * write image bytes to a real file for the OS media session (which needs
 * an actual `file://` path, unlike the browser's own
 * `navigator.mediaSession` - see `getLocalArtworkFilePath`'s doc comment)
 * via the `write_media_session_artwork` tauri command, and return its
 * `file://` path. shared by both artwork paths below rather than each
 * duplicating the same invoke() call.
 */
async function writeBytesForOsMediaSession(bytes: Uint8Array): Promise<string | null> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  const diskPath = await invoke<string>("write_media_session_artwork", {
    bytes: Array.from(bytes),
  });
  return diskPath ? toFileUrl(diskPath) : null;
}

/**
 * same as `getLocalArtworkFilePath`, but for a video's poster - which,
 * unlike song artwork, has no path Rust can reach at all (it lives in
 * OPFS for local videos, browser-sandboxed storage, not grimoire's blob
 * store). priority 1: read the local OPFS poster (via
 * `readVideoPosterFromOPFS`, same as `getMediaSessionArtworkForVideo`
 * below). priority 2: same P2P/HTTP fallback `getMediaSessionArtworkForVideo`
 * already resolves for remote videos - fetched and written to disk the
 * same way `getLocalArtworkFilePath`'s remote fallback does, via the
 * shared `writeBytesForOsMediaSession`. same "best-effort, `null` on any
 * failure" contract.
 */
export async function getLocalPosterFilePathForVideo(video: QueuedVideo): Promise<string | null> {
  const path = video.poster_opfs_path ?? null;
  if (path) {
    try {
      const file = await readVideoPosterFromOPFS(path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await writeBytesForOsMediaSession(bytes);
    } catch (err) {
      debug("mediaSession", "failed to write local video poster for OS media session:", err);
      // fall through to the remote fallback below.
    }
  }

  const remoteUrl = (await getMediaSessionArtworkForVideo(video))[0]?.src;
  if (!remoteUrl) return null;
  try {
    const bytes = new Uint8Array(await (await fetch(remoteUrl)).arrayBuffer());
    return await writeBytesForOsMediaSession(bytes);
  } catch (err) {
    debug("mediaSession", "failed to fetch remote video poster for OS media session:", err);
    return null;
  }
}

// video posters aren't stored in the blob store's object-url cache the way
// local song artwork is (they live at an arbitrary OPFS path), so cache the
// single most-recently-resolved local poster ourselves to avoid re-reading
// OPFS and leaking object urls on every media-session metadata refresh.
let lastLocalPosterPath: string | null = null;
let lastLocalPosterUrl: string | null = null;

/** get artwork URLs for media session for the currently-playing video. */
export async function getMediaSessionArtworkForVideo(video: QueuedVideo): Promise<MediaImage[]> {
  const makeArtwork = (src: string): MediaImage[] => [
    { src, sizes: "512x512", type: "image/jpeg" },
    { src, sizes: "256x256", type: "image/jpeg" },
    { src, sizes: "96x96", type: "image/jpeg" },
  ];

  if (video.source_type === "local") {
    const path = video.poster_opfs_path ?? null;
    if (!path) return [];
    if (path === lastLocalPosterPath && lastLocalPosterUrl) {
      return makeArtwork(lastLocalPosterUrl);
    }
    try {
      const file = await readVideoPosterFromOPFS(path);
      if (lastLocalPosterUrl) URL.revokeObjectURL(lastLocalPosterUrl);
      lastLocalPosterUrl = URL.createObjectURL(file);
      lastLocalPosterPath = path;
      return makeArtwork(lastLocalPosterUrl);
    } catch (err) {
      debug("mediaSession", "failed to read local video poster:", err);
      return [];
    }
  }

  // remote: same P2P/tauri transport resolution the song path uses.
  if (video.poster_blob_id && video.remote_server_id) {
    try {
      const url = await resolveBlobUrl(video.poster_blob_id, video.remote_server_id, "image");
      if (url) return makeArtwork(url);
    } catch (err) {
      debug("mediaSession", "failed to resolve remote video poster:", err);
    }
  }

  return [];
}
