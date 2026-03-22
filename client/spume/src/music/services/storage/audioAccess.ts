// audio access abstraction - handles getting audio urls from various sources
import { createSignal } from "solid-js";
import { getCachedBlob, preCacheBlob } from "../cache/blobCache";
import { addToLoadingSet, updateLoadingProgress, removeFromLoadingSet } from "../download";
import { readAudioFromOPFS } from "../opfs/helpers";
import type { Song } from "./types";
import { debug } from "../../../utils/logger";
import { resolveBlobUrl, isP2PRemote, usesBlobResolver, revokeBlobUrl } from "./blobResolver";
import type { BlobProgressCallback } from "freqhole-api-client";

// cache of active blob urls to prevent memory leaks
// stores {url, remoteId, blobId} so we can properly cleanup from blobResolver too
const activeBlobURLs = new Map<string, { url: string; remoteId: string | null; blobId: string | null }>();

// track songs currently playing from a direct (non-cached) remote URL
// maps sha256 -> { sourceUrl, remoteId } so we can swap to cached version later
const directURLSongs = new Map<string, { sourceUrl: string; remoteId: string }>();

// reactive signal tracking which sha256s are playing from direct URL
const [directURLSet, setDirectURLSet] = createSignal<Set<string>>(new Set());

function addToDirectURLSet(sha256: string): void {
  setDirectURLSet((prev) => {
    const next = new Set(prev);
    next.add(sha256);
    return next;
  });
}

function removeFromDirectURLSet(sha256: string): void {
  setDirectURLSet((prev) => {
    if (!prev.has(sha256)) return prev;
    const next = new Set(prev);
    next.delete(sha256);
    return next;
  });
}

// get audio url for playback
// handles opfs, cached remote, and direct remote streaming
export async function getAudioURL(song: Song): Promise<string> {
  debug(
    "audioAccess",
    `getting audio url for song: ${song.title} (source: ${song.source_type})`,
  );

  // cleanup previous url if exists
  if (activeBlobURLs.has(song.sha256)) {
    const entry = activeBlobURLs.get(song.sha256)!;
    URL.revokeObjectURL(entry.url);
    // also remove from blobResolver's store for P2P songs
    // use the stored blobId (not sha256) to match the cache key
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(song.sha256);
  }
  directURLSongs.delete(song.sha256);
  removeFromDirectURLSet(song.sha256);

  // local, downloaded, and synced files: read from opfs
  if (song.source_type === "local" || song.source_type === "downloaded" || song.source_type === "synced") {
    if (!song.opfs_path) {
      throw new Error(`song has no opfs path: ${song.sha256}`);
    }

    try {
      debug("audioAccess", `reading from opfs: ${song.opfs_path}`);
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(song.sha256, { url, remoteId: null, blobId: null });
      return url;
    } catch (error) {
      console.error(`failed to read from opfs:`, error);
      throw new Error(`failed to read audio file from opfs`);
    }
  }

  // remote files: check cache first, then fall back to direct streaming URL
  if (song.source_type === "remote") {
    // check if this remote uses blobResolver (P2P or Tauri-managed)
    if (song.remote_server_id && await usesBlobResolver(song.remote_server_id)) {
      debug("audioAccess", `using blobResolver for remote song: ${song.sha256}`);
      
      // track loading state for UI feedback
      addToLoadingSet(song.sha256);
      updateLoadingProgress(song.sha256, null); // indeterminate until we get total size
      
      try {
        // use blobResolver which handles P2P/Tauri transports and caching
        // pass progress callback for 0-100% loading indicator
        const onProgress: BlobProgressCallback = (received, total) => {
          if (total > 0) {
            updateLoadingProgress(song.sha256, received / total);
          }
        };
        // use media_blob_id (short blob ID) for server lookup, fall back to sha256
        // pass blake3 for verified streaming via iroh-blobs (6th param, 5th is thumbnailSize)
        const blobId = song.media_blob_id ?? song.sha256;
        const url = await resolveBlobUrl(blobId, song.remote_server_id, "audio", onProgress, undefined, song.blake3 ?? undefined);
        activeBlobURLs.set(song.sha256, { url, remoteId: song.remote_server_id, blobId });
        return url;
      } catch (error) {
        console.error(`failed to fetch audio via blobResolver:`, error);
        throw new Error(`failed to fetch audio from remote`);
      } finally {
        removeFromLoadingSet(song.sha256);
      }
    }

    // HTTP remote: use direct URL approach
    if (!song.source_url) {
      throw new Error(`remote song has no source url: ${song.sha256}`);
    }
    if (!song.remote_server_id) {
      throw new Error(`remote song has no remote_server_id: ${song.sha256}`);
    }

    debug("audioAccess", `checking cache for remote url: ${song.source_url}`);

    // try to get from cache (keyed by remoteId + sha256)
    const cachedResponse = await getCachedBlob(song.remote_server_id, song.sha256);
    if (cachedResponse) {
      debug("audioAccess", `CACHE HIT - using cached audio for: ${song.sha256.slice(0, 8)}...`);
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      // for HTTP cache, blobId is sha256 (cache is keyed by sha256)
      activeBlobURLs.set(song.sha256, { url, remoteId: song.remote_server_id, blobId: song.sha256 });
      return url;
    }

    // not cached: return direct URL for immediate streaming
    debug("audioAccess", `CACHE MISS - streaming direct URL for: ${song.sha256.slice(0, 8)}...`);
    directURLSongs.set(song.sha256, { sourceUrl: song.source_url, remoteId: song.remote_server_id });
    addToDirectURLSet(song.sha256);

    // start background caching so the song is available offline later
    void preCacheBlob(song.source_url, "audio", song.remote_server_id, song.sha256);

    return song.source_url;
  }

  throw new Error(`unsupported song source type: ${song.source_type}`);
}

// check if a song is playing from a direct (non-cached) URL
export function isPlayingDirectURL(sha256: string): boolean {
  return directURLSongs.has(sha256);
}

// reactive version for UI binding
export function isPlayingDirectURLReactive(sha256: string | undefined): boolean {
  if (!sha256) return false;
  return directURLSet().has(sha256);
}

// attempt to swap a direct-URL song to its cached version
// returns the new blob URL if swap is possible, null otherwise
export async function trySwapToCachedURL(sha256: string): Promise<string | null> {
  const entry = directURLSongs.get(sha256);
  if (!entry) return null; // not playing from direct URL

  const cached = await getCachedBlob(entry.remoteId, sha256);
  if (!cached) return null; // not yet cached

  const blob = await cached.blob();
  const url = URL.createObjectURL(blob);

  // cleanup old blob URL if any
  if (activeBlobURLs.has(sha256)) {
    const oldEntry = activeBlobURLs.get(sha256)!;
    URL.revokeObjectURL(oldEntry.url);
    if (oldEntry.remoteId && oldEntry.blobId) {
      revokeBlobUrl(oldEntry.blobId, oldEntry.remoteId);
    }
  }
  // for HTTP cache swap, blobId is sha256
  activeBlobURLs.set(sha256, { url, remoteId: entry.remoteId, blobId: sha256 });
  directURLSongs.delete(sha256);
  removeFromDirectURLSet(sha256);

  debug("audioAccess", `prepared cached URL swap for song: ${sha256}`);
  return url;
}

// cleanup audio url for a song
export function cleanupAudioURL(songId: string): void {
  if (activeBlobURLs.has(songId)) {
    const entry = activeBlobURLs.get(songId)!;
    URL.revokeObjectURL(entry.url);
    // also remove from blobResolver's store for P2P songs
    // use the stored blobId to match the cache key
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(songId);
    debug("audioAccess", `cleaned up audio url for song: ${songId}`);
  }
}

// cleanup all audio urls
export function cleanupAllAudioURLs(): void {
  for (const [songId, entry] of activeBlobURLs.entries()) {
    URL.revokeObjectURL(entry.url);
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    debug("audioAccess", `cleaned up audio url for song: ${songId}`);
  }
  activeBlobURLs.clear();
}

// re-create a blob URL from underlying storage (OPFS or API Cache)
// used when iOS revokes blob URLs after PWA suspension
export async function refreshBlobURL(song: Song): Promise<string | null> {
  debug("audioAccess", `refreshing blob URL for song: ${song.title} (source: ${song.source_type})`);

  // cleanup old blob URL if exists
  if (activeBlobURLs.has(song.sha256)) {
    const entry = activeBlobURLs.get(song.sha256)!;
    URL.revokeObjectURL(entry.url);
    if (entry.remoteId && entry.blobId) {
      revokeBlobUrl(entry.blobId, entry.remoteId);
    }
    activeBlobURLs.delete(song.sha256);
  }

  // local/downloaded: re-read from OPFS
  if (song.source_type === "local" || song.source_type === "downloaded") {
    if (!song.opfs_path) {
      console.error(`cannot refresh: song has no opfs path: ${song.sha256}`);
      return null;
    }
    try {
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(song.sha256, { url, remoteId: null, blobId: null });
      debug("audioAccess", `refreshed blob URL from OPFS: ${song.sha256}`);
      return url;
    } catch (error) {
      console.error(`failed to refresh from OPFS:`, error);
      return null;
    }
  }

  // remote: try API Cache first (or use P2P resolver)
  if (song.source_type === "remote") {
    // P2P remotes: use blobResolver
    if (song.remote_server_id && await isP2PRemote(song.remote_server_id)) {
      try {
        // use media_blob_id (short blob ID) for server lookup, fall back to sha256
        // pass blake3 for verified streaming via iroh-blobs
        const blobId = song.media_blob_id ?? song.sha256;
        const url = await resolveBlobUrl(blobId, song.remote_server_id, "audio", undefined, undefined, song.blake3 ?? undefined);
        activeBlobURLs.set(song.sha256, { url, remoteId: song.remote_server_id, blobId });
        debug("audioAccess", `refreshed blob URL from P2P: ${song.sha256}`);
        return url;
      } catch (error) {
        console.error(`failed to refresh P2P blob:`, error);
        return null;
      }
    }

    // HTTP remotes: use cache
    if (song.source_url && song.remote_server_id) {
      const cachedResponse = await getCachedBlob(song.remote_server_id, song.sha256);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        const url = URL.createObjectURL(blob);
        // for HTTP cache, blobId is sha256
        activeBlobURLs.set(song.sha256, { url, remoteId: song.remote_server_id, blobId: song.sha256 });
        debug("audioAccess", `refreshed blob URL from API Cache: ${song.sha256}`);
        return url;
      }
      // not in cache - fall back to remote URL (browser will handle it)
      debug("audioAccess", `not in cache, falling back to remote URL: ${song.source_url}`);
      directURLSongs.set(song.sha256, { sourceUrl: song.source_url, remoteId: song.remote_server_id });
      addToDirectURLSet(song.sha256);
      return song.source_url;
    }
  }

  console.error(`cannot refresh: unsupported source type: ${song.source_type}`);
  return null;
}
