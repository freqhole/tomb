// audio access abstraction - handles getting audio urls from various sources
import { createSignal } from "solid-js";
import { getCachedBlob, preCacheBlob } from "../cache/blobCache";
import { readAudioFromOPFS } from "../opfs/helpers";
import type { Song } from "./types";

// cache of active blob urls to prevent memory leaks
const activeBlobURLs = new Map<string, string>();

// track songs currently playing from a direct (non-cached) remote URL
// maps sha256 -> source_url so we can swap to cached version later
const directURLSongs = new Map<string, string>();

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
  console.log(
    `getting audio url for song: ${song.title} (source: ${song.source_type})`,
  );

  // cleanup previous url if exists
  if (activeBlobURLs.has(song.sha256)) {
    const oldURL = activeBlobURLs.get(song.sha256)!;
    URL.revokeObjectURL(oldURL);
    activeBlobURLs.delete(song.sha256);
  }
  directURLSongs.delete(song.sha256);
  removeFromDirectURLSet(song.sha256);

  // local and downloaded files: read from opfs
  if (song.source_type === "local" || song.source_type === "downloaded") {
    if (!song.opfs_path) {
      throw new Error(`song has no opfs path: ${song.sha256}`);
    }

    try {
      console.log(`reading from opfs: ${song.opfs_path}`);
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(song.sha256, url);
      return url;
    } catch (error) {
      console.error(`failed to read from opfs:`, error);
      throw new Error(`failed to read audio file from opfs`);
    }
  }

  // remote files: check cache first, then fall back to direct streaming URL
  if (song.source_type === "remote") {
    if (!song.source_url) {
      throw new Error(`remote song has no source url: ${song.sha256}`);
    }

    console.log(`checking cache for remote url: ${song.source_url}`);

    // try to get from cache
    const cachedResponse = await getCachedBlob(song.source_url);
    if (cachedResponse) {
      console.log(`using cached audio: ${song.source_url}`);
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      activeBlobURLs.set(song.sha256, url);
      return url;
    }

    // not cached: return direct URL for immediate streaming
    // the browser will handle range requests and buffering natively
    console.log(`streaming direct URL (not cached): ${song.source_url}`);
    directURLSongs.set(song.sha256, song.source_url);
    addToDirectURLSet(song.sha256);

    // start background caching so the song is available offline later
    void preCacheBlob(song.source_url, "audio");

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
  const sourceUrl = directURLSongs.get(sha256);
  if (!sourceUrl) return null; // not playing from direct URL

  const cached = await getCachedBlob(sourceUrl);
  if (!cached) return null; // not yet cached

  const blob = await cached.blob();
  const url = URL.createObjectURL(blob);

  // cleanup old blob URL if any
  if (activeBlobURLs.has(sha256)) {
    URL.revokeObjectURL(activeBlobURLs.get(sha256)!);
  }
  activeBlobURLs.set(sha256, url);
  directURLSongs.delete(sha256);
  removeFromDirectURLSet(sha256);

  console.log(`prepared cached URL swap for song: ${sha256}`);
  return url;
}

// cleanup audio url for a song
export function cleanupAudioURL(songId: string): void {
  if (activeBlobURLs.has(songId)) {
    const url = activeBlobURLs.get(songId)!;
    URL.revokeObjectURL(url);
    activeBlobURLs.delete(songId);
    console.log(`cleaned up audio url for song: ${songId}`);
  }
}

// cleanup all audio urls
export function cleanupAllAudioURLs(): void {
  for (const [songId, url] of activeBlobURLs.entries()) {
    URL.revokeObjectURL(url);
    console.log(`cleaned up audio url for song: ${songId}`);
  }
  activeBlobURLs.clear();
}

// re-create a blob URL from underlying storage (OPFS or API Cache)
// used when iOS revokes blob URLs after PWA suspension
export async function refreshBlobURL(song: Song): Promise<string | null> {
  console.log(`refreshing blob URL for song: ${song.title} (source: ${song.source_type})`);

  // cleanup old blob URL if exists
  if (activeBlobURLs.has(song.sha256)) {
    const oldURL = activeBlobURLs.get(song.sha256)!;
    URL.revokeObjectURL(oldURL);
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
      activeBlobURLs.set(song.sha256, url);
      console.log(`refreshed blob URL from OPFS: ${song.sha256}`);
      return url;
    } catch (error) {
      console.error(`failed to refresh from OPFS:`, error);
      return null;
    }
  }

  // remote: try API Cache first
  if (song.source_type === "remote" && song.source_url) {
    const cachedResponse = await getCachedBlob(song.source_url);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      activeBlobURLs.set(song.sha256, url);
      console.log(`refreshed blob URL from API Cache: ${song.sha256}`);
      return url;
    }
    // not in cache - fall back to remote URL (browser will handle it)
    console.log(`not in cache, falling back to remote URL: ${song.source_url}`);
    directURLSongs.set(song.sha256, song.source_url);
    addToDirectURLSet(song.sha256);
    return song.source_url;
  }

  console.error(`cannot refresh: unsupported source type: ${song.source_type}`);
  return null;
}
