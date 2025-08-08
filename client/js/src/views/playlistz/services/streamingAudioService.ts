// streaming audio service
// handles efficient audio streaming with parallel caching to indexeddb

import {
  setupDB,
  SONGS_STORE,
  mutateAndNotify,
  DB_NAME,
} from "./indexedDBService.js";
import type { Song } from "../types/playlist.js";

interface StreamingDownloadResult {
  blobUrl: string;
  downloadPromise: Promise<boolean>;
}

interface DownloadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Downloads audio file with streaming, providing immediate blob URL for playback
 * while simultaneously caching to IndexedDB
 */
export async function streamAudioWithCaching(
  song: Song,
  standaloneFilePath: string,
  onProgress?: ProgressCallback
): Promise<StreamingDownloadResult> {
  try {
    // for http/https urls, return the direct url for immediate streaming
    // the browser will handle progressive download/streaming automatically
    const blobUrl = standaloneFilePath;

    // start background download and caching to indexeddb
    const downloadPromise = downloadAndCacheAudio(
      song,
      standaloneFilePath,
      onProgress
    );

    return {
      blobUrl,
      downloadPromise,
    };
  } catch (error) {
    console.error("Error in streamAudioWithCaching:", error);
    throw error;
  }
}

/**
 * downloads and caches audio file in the background
 */
export async function downloadAndCacheAudio(
  song: Song,
  standaloneFilePath: string,
  onProgress?: ProgressCallback
): Promise<boolean> {
  try {
    // check if already cached to avoid duplicate downloads
    const db = await setupDB();
    const existingSong = await db.get(SONGS_STORE, song.id);

    if (existingSong?.audioData && existingSong.audioData.byteLength > 0) {
      return true; // already cached
    }

    const response = await fetch(standaloneFilePath);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (value) {
        loaded += value.length;
        chunks.push(value);

        if (onProgress && total > 0) {
          onProgress({
            loaded,
            total,
            percentage: Math.round((loaded / total) * 100),
          });
        }
      }
    }

    // combine chunks into arraybuffer
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new ArrayBuffer(totalLength);
    const uint8View = new Uint8Array(audioData);

    let offset = 0;
    for (const chunk of chunks) {
      uint8View.set(chunk, offset);
      offset += chunk.length;
    }

    // store in indexeddb
    const mimeType =
      song.mimeType || response.headers.get("content-type") || "audio/mpeg";
    const updatedSong = {
      ...song,
      audioData,
      mimeType,
      updatedAt: Date.now(),
    };

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => updatedSong,
    });

    return true;
  } catch (error) {
    console.error(`Error downloading and caching audio for ${song.id}:`, error);
    return false;
  }
}

/**
 * checks if a song is currently being downloaded/cached
 */
const activeDownloads = new Map<string, Promise<boolean>>();

export function isSongDownloading(songId: string): boolean {
  return activeDownloads.has(songId);
}

/**
 * wrapper that tracks active downloads to prevent duplicates
 */
export async function downloadSongIfNeeded(
  song: Song,
  standaloneFilePath: string,
  onProgress?: ProgressCallback
): Promise<boolean> {
  // check if already downloading
  const existingDownload = activeDownloads.get(song.id);
  if (existingDownload) {
    return existingDownload;
  }

  // check if already cached
  try {
    const db = await setupDB();
    const existingSong = await db.get(SONGS_STORE, song.id);

    if (existingSong?.audioData && existingSong.audioData.byteLength > 0) {
      return true; // already cached
    }
  } catch (error) {
    console.error("Error checking cache status:", error);
  }

  // start new download
  const downloadPromise = downloadAndCacheAudio(
    song,
    standaloneFilePath,
    onProgress
  );

  activeDownloads.set(song.id, downloadPromise);

  // clean up when done
  downloadPromise.finally(() => {
    activeDownloads.delete(song.id);
  });

  return downloadPromise;
}
