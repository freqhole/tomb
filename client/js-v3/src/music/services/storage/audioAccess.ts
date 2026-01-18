// audio access abstraction - handles getting audio urls from various sources
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
  if (activeBlobURLs.has(song.song_id)) {
    const oldURL = activeBlobURLs.get(song.song_id)!;
    URL.revokeObjectURL(oldURL);
    activeBlobURLs.delete(song.song_id);
  }

  // local and downloaded files: read from opfs
  if (song.source_type === "local" || song.source_type === "downloaded") {
    if (!song.opfs_path) {
      throw new Error(`song has no opfs path: ${song.song_id}`);
    }

    try {
      console.log(`reading from opfs: ${song.opfs_path}`);
      const file = await readAudioFromOPFS(song.opfs_path);
      const url = URL.createObjectURL(file);
      activeBlobURLs.set(song.song_id, url);
      return url;
    } catch (error) {
      console.error(`failed to read from opfs:`, error);
      throw new Error(`failed to read audio file from opfs`);
    }
  }

  // remote files: return url directly (no blob url needed)
  if (song.source_type === "remote") {
    if (!song.source_url) {
      throw new Error(`remote song has no source url: ${song.song_id}`);
    }

    console.log(`streaming from remote url: ${song.source_url}`);
    return song.source_url;
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
