// audio access abstraction - handles getting audio urls from various sources
import { cacheBlob, getCachedBlob } from "../cache/blobCache";
import { readAudioFromOPFS } from "../opfs/helpers";
import type { Song } from "./types";

// cache of active blob urls to prevent memory leaks
const activeBlobURLs = new Map<string, string>();

// get audio url for playback
// handles opfs and remote urls
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

  // remote files: check cache first, then fetch and cache
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

    // fetch and cache
    console.log(`fetching and caching remote url: ${song.source_url}`);
    const response = await fetch(song.source_url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`failed to fetch remote audio: ${response.status}`);
    }

    // cache the response (clone it first since we need to use it twice)
    const responseClone = response.clone();
    void cacheBlob(song.source_url, responseClone, "audio");

    // create blob url from response
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    activeBlobURLs.set(song.sha256, url);
    return url;
  }

  throw new Error(`unsupported song source type: ${song.source_type}`);
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
