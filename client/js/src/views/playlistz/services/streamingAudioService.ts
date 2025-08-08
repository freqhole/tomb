// Streaming Audio Service
// Handles efficient audio streaming with parallel caching to IndexedDB

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
    // For http/https URLs, return the direct URL for immediate streaming
    // The browser will handle progressive download/streaming automatically
    const blobUrl = standaloneFilePath;

    // Start background download and caching to IndexedDB
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
 * Downloads and caches audio file in the background
 */
export async function downloadAndCacheAudio(
  song: Song,
  standaloneFilePath: string,
  onProgress?: ProgressCallback
): Promise<boolean> {
  try {
    // Check if already cached to avoid duplicate downloads
    const db = await setupDB();
    const existingSong = await db.get(SONGS_STORE, song.id);

    if (existingSong?.audioData && existingSong.audioData.byteLength > 0) {
      return true; // Already cached
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

    // Combine chunks into ArrayBuffer
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = new ArrayBuffer(totalLength);
    const uint8View = new Uint8Array(audioData);

    let offset = 0;
    for (const chunk of chunks) {
      uint8View.set(chunk, offset);
      offset += chunk.length;
    }

    // Store in IndexedDB
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
 * Checks if a song is currently being downloaded/cached
 */
const activeDownloads = new Map<string, Promise<boolean>>();

export function isSongDownloading(songId: string): boolean {
  return activeDownloads.has(songId);
}

/**
 * Wrapper that tracks active downloads to prevent duplicates
 */
export async function downloadSongIfNeeded(
  song: Song,
  standaloneFilePath: string,
  onProgress?: ProgressCallback
): Promise<boolean> {
  // Check if already downloading
  const existingDownload = activeDownloads.get(song.id);
  if (existingDownload) {
    return existingDownload;
  }

  // Check if already cached
  try {
    const db = await setupDB();
    const existingSong = await db.get(SONGS_STORE, song.id);

    if (existingSong?.audioData && existingSong.audioData.byteLength > 0) {
      return true; // Already cached
    }
  } catch (error) {
    console.error("Error checking cache status:", error);
  }

  // Start new download
  const downloadPromise = downloadAndCacheAudio(
    song,
    standaloneFilePath,
    onProgress
  );

  activeDownloads.set(song.id, downloadPromise);

  // Clean up when done
  downloadPromise.finally(() => {
    activeDownloads.delete(song.id);
  });

  return downloadPromise;
}
