import { createSignal } from "solid-js";
import {
  setupDB,
  DB_NAME,
  PLAYLISTS_STORE,
  SONGS_STORE,
} from "./indexedDBService.js";
import { mutateAndNotify } from "./indexedDBService.js";
import type { Playlist } from "../types/playlist.js";

// Loading progress signal
const [standaloneLoadingProgress, setStandaloneLoadingProgress] = createSignal<{
  current: number;
  total: number;
  currentSong: string;
  phase: "initializing" | "checking" | "updating" | "complete";
} | null>(null);

// Export the signal for UI components to use
export { standaloneLoadingProgress };

/**
 * Helper function to convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Load audio data for a song based on the current protocol
 */
async function loadSongAudioData(
  songData: any,
  standaloneFilePath: string
): Promise<{
  audioData?: ArrayBuffer;
  mimeType: string;
}> {
  let audioData: ArrayBuffer | undefined;
  let mimeType = "audio/mpeg";

  try {
    // Check if we're using file:// protocol
    if (window.location.protocol === "file:") {
      // For file:// protocol, we'll skip loading audio data into IndexedDB
      // and let the audio service handle file:// URLs directly
      audioData = undefined;

      // Try to determine mime type from file extension
      const ext = standaloneFilePath.split(".").pop()?.toLowerCase();
      mimeType =
        ext === "mp3"
          ? "audio/mpeg"
          : ext === "m4a"
            ? "audio/mp4"
            : ext === "wav"
              ? "audio/wav"
              : ext === "ogg"
                ? "audio/ogg"
                : ext === "flac"
                  ? "audio/flac"
                  : "audio/mpeg";
    } else {
      // Use fetch for http/https URLs
      const response = await fetch(standaloneFilePath);

      if (response.ok) {
        audioData = await response.arrayBuffer();
        mimeType = response.headers.get("Content-Type") || mimeType;
      } else {
        console.error(
          `❌ Failed to fetch audio for ${songData.title}: ${response.status} ${response.statusText}`
        );
        console.error(`❌ Response headers:`, [...response.headers.entries()]);
        console.warn(`⚠️ Continuing without audio data for ${songData.title}`);
      }
    }
  } catch (error) {
    console.error(`❌ Error loading audio for ${songData.title}:`, error);
    console.error(
      `❌ Error type: ${error instanceof Error ? error.constructor.name : typeof error}`
    );
    if (error instanceof TypeError) {
      console.error(`❌ This might be a CORS or network error`);
    }
    console.warn(`⚠️ Continuing without audio data for ${songData.title}`);
  }

  return { audioData, mimeType };
}

/**
 * Create a song object from playlist data
 */
function createSongFromData(
  songData: any,
  index: number,
  playlistId: string,
  standaloneFilePath: string,
  audioData?: ArrayBuffer,
  mimeType: string = "audio/mpeg"
) {
  const song = {
    id: songData.id,
    title: songData.title,
    artist: songData.artist,
    album: songData.album,
    duration: songData.duration,
    position: index,
    mimeType: mimeType,
    originalFilename: songData.originalFilename,
    fileSize: songData.fileSize,
    audioData: audioData,
    blobUrl: undefined,
    file: undefined,
    imageData: undefined as ArrayBuffer | undefined,
    thumbnailData: undefined as ArrayBuffer | undefined,
    imageType: undefined as string | undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    playlistId: playlistId,
    // Always store standalone file path for potential file:// usage
    standaloneFilePath: standaloneFilePath,
  };

  // Set song image from base64 data
  if (songData.imageBase64) {
    song.imageData = base64ToArrayBuffer(songData.imageBase64);
    song.imageType = songData.imageMimeType;
  }

  return song;
}

/**
 * Check if data has changed for songs and playlist
 */
function hasDataChanged(existing: any, incoming: any): boolean {
  if (!existing || !incoming) return true;

  // Check basic metadata
  if (
    existing.title !== incoming.title ||
    existing.artist !== incoming.artist ||
    existing.album !== incoming.album ||
    existing.description !== incoming.description
  ) {
    return true;
  }

  // Check if image data changed (compare base64)
  if (existing.imageBase64 !== incoming.imageBase64) {
    return true;
  }

  return false;
}

/**
 * Update songs and playlist efficiently in background
 */
async function updateExistingData(
  existingPlaylist: Playlist,
  playlistSongs: any[],
  playlistData: any
): Promise<{ updatedPlaylist: Playlist; updatedSongs: any[] }> {
  const updatedSongs = [...playlistSongs];
  let playlistChanged = false;

  // Check if playlist metadata changed
  if (hasDataChanged(existingPlaylist, playlistData.playlist)) {
    playlistChanged = true;
  }

  // Update songs in background (don't block initial display)
  setTimeout(async () => {
    setStandaloneLoadingProgress({
      current: 0,
      total: playlistData.songs.length,
      currentSong: "updating...",
      phase: "updating",
    });

    for (let idx = 0; idx < playlistData.songs.length; idx++) {
      const songData = playlistData.songs[idx];
      const existingSong = playlistSongs.find((s) => s.id === songData.id);

      setStandaloneLoadingProgress({
        current: idx + 1,
        total: playlistData.songs.length,
        currentSong: songData.title,
        phase: "updating",
      });

      if (existingSong && hasDataChanged(existingSong, songData)) {
        // Update song metadata
        const updatedSong = {
          ...existingSong,
          title: songData.title,
          artist: songData.artist,
          album: songData.album,
          updatedAt: Date.now(),
        };

        // Update image if changed
        if (songData.imageBase64) {
          updatedSong.imageData = base64ToArrayBuffer(songData.imageBase64);
          updatedSong.imageType = songData.imageMimeType;
        }

        await mutateAndNotify({
          dbName: DB_NAME,
          storeName: SONGS_STORE,
          key: updatedSong.id,
          updateFn: () => updatedSong,
        });
      }
    }

    // Clear progress when done
    setStandaloneLoadingProgress(null);
  }, 100);

  // Update playlist if changed
  if (playlistChanged) {
    const updatedPlaylist = {
      ...existingPlaylist,
      title: playlistData.playlist.title,
      description: playlistData.playlist.description,
      updatedAt: Date.now(),
    };

    if (playlistData.playlist.imageBase64) {
      updatedPlaylist.imageData = base64ToArrayBuffer(
        playlistData.playlist.imageBase64
      );
      updatedPlaylist.imageType = playlistData.playlist.imageMimeType;
    }

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: PLAYLISTS_STORE,
      key: updatedPlaylist.id,
      updateFn: () => updatedPlaylist,
    });

    return { updatedPlaylist, updatedSongs };
  }

  return { updatedPlaylist: existingPlaylist, updatedSongs };
}

/**
 * Create a new playlist with all songs
 */
async function createNewPlaylist(
  playlistData: any
): Promise<{ playlist: Playlist; songs: any[] }> {
  // Create playlist using service function to trigger reactive updates
  const playlistToCreate = {
    id: playlistData.playlist.id, // Override the auto-generated ID
    title: playlistData.playlist.title,
    description: playlistData.playlist.description,
    songIds: [],
    imageData: undefined as ArrayBuffer | undefined,
    thumbnailData: undefined as ArrayBuffer | undefined,
    imageType: undefined as string | undefined,
  };

  // Set playlist image from base64 data
  if (playlistData.playlist.imageBase64) {
    playlistToCreate.imageData = base64ToArrayBuffer(
      playlistData.playlist.imageBase64
    );
    playlistToCreate.imageType = playlistData.playlist.imageMimeType;
  }

  // Manually store playlist using mutateAndNotify to trigger reactive updates
  const finalPlaylist: Playlist = {
    ...playlistToCreate,
    id: playlistData.playlist.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    songIds: [],
  };

  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  // Create and store songs
  const virtualSongs = [];
  const finalSongIds: string[] = [];

  // Load first few songs immediately for quick playback
  const immediateLoadCount = Math.min(3, playlistData.songs.length);

  for (let i = 0; i < immediateLoadCount; i++) {
    const songData = playlistData.songs[i];
    setStandaloneLoadingProgress({
      current: i + 1,
      total: immediateLoadCount,
      currentSong: songData.title,
      phase: "initializing",
    });

    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;
    const { audioData, mimeType } = await loadSongAudioData(
      songData,
      standaloneFilePath
    );

    const song = createSongFromData(
      songData,
      i,
      finalPlaylist.id,
      standaloneFilePath,
      audioData,
      mimeType
    );

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });

    virtualSongs.push(song);
    finalSongIds.push(song.id);
  }

  // Load remaining songs in background
  if (playlistData.songs.length > immediateLoadCount) {
    setTimeout(async () => {
      for (let i = immediateLoadCount; i < playlistData.songs.length; i++) {
        const songData = playlistData.songs[i];
        setStandaloneLoadingProgress({
          current: i + 1 - immediateLoadCount,
          total: playlistData.songs.length - immediateLoadCount,
          currentSong: songData.title,
          phase: "updating",
        });

        const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;
        const { audioData, mimeType } = await loadSongAudioData(
          songData,
          standaloneFilePath
        );

        const song = createSongFromData(
          songData,
          i,
          finalPlaylist.id,
          standaloneFilePath,
          audioData,
          mimeType
        );

        await mutateAndNotify({
          dbName: DB_NAME,
          storeName: SONGS_STORE,
          key: song.id,
          updateFn: () => song,
        });

        finalSongIds.push(song.id);
      }

      // Update playlist with all song IDs
      await mutateAndNotify({
        dbName: DB_NAME,
        storeName: PLAYLISTS_STORE,
        key: finalPlaylist.id,
        updateFn: () => ({ ...finalPlaylist, songIds: finalSongIds }),
      });

      setStandaloneLoadingProgress(null);
    }, 100);
  }

  // Update playlist with final song IDs
  finalPlaylist.songIds = finalSongIds;
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  return { playlist: finalPlaylist, songs: virtualSongs };
}

/**
 * Initialize standalone playlist from embedded data
 */
export async function initializeStandalonePlaylist(
  playlistData: any,
  callbacks: {
    setSelectedPlaylist: (playlist: Playlist) => void;
    setPlaylistSongs: (songs: any[]) => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    setError: (error: string) => void;
  }
): Promise<void> {
  try {
    // Show loading progress
    setStandaloneLoadingProgress({
      current: 0,
      total: playlistData.songs.length,
      currentSong: "initializing...",
      phase: "initializing",
    });

    // Check if playlist with this ID already exists
    const db = await setupDB();
    const existingPlaylist = await db.get(
      PLAYLISTS_STORE,
      playlistData.playlist.id
    );

    let finalPlaylist: Playlist;
    let finalSongs: any[];

    if (existingPlaylist) {
      // Load existing songs for this playlist
      const existingSongs = await db.getAll(SONGS_STORE);
      const playlistSongs = existingSongs.filter(
        (song: any) => song.playlistId === existingPlaylist.id
      );

      // For file:// protocol, ensure existing songs have standaloneFilePath
      if (window.location.protocol === "file:") {
        for (const song of playlistSongs) {
          if (!(song as any).standaloneFilePath) {
            const songData = playlistData.songs.find(
              (s: any) => s.id === song.id
            );
            if (songData) {
              const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;
              (song as any).standaloneFilePath = standaloneFilePath;

              await mutateAndNotify({
                dbName: DB_NAME,
                storeName: SONGS_STORE,
                key: song.id,
                updateFn: () => song,
              });
            }
          }
        }
      }

      // Check for changes and update accordingly
      const { updatedPlaylist, updatedSongs } = await updateExistingData(
        existingPlaylist,
        playlistSongs,
        playlistData
      );

      finalPlaylist = updatedPlaylist;
      finalSongs = updatedSongs;
    } else {
      const { playlist, songs } = await createNewPlaylist(playlistData);
      finalPlaylist = playlist;
      finalSongs = songs;
    }

    // Count successfully loaded songs
    const songsWithoutAudio = finalSongs.filter(
      (song) => !song.audioData && !(song as any).standaloneFilePath
    );

    if (songsWithoutAudio.length > 0) {
      console.warn(
        `   ⚠️ ${songsWithoutAudio.length} songs failed to load audio data:`
      );
      songsWithoutAudio.forEach((song) =>
        console.warn(`      - ${song.title}`)
      );

      // Show user notification about failed songs
      if (
        songsWithoutAudio.length === finalSongs.length &&
        window.location.protocol !== "file:"
      ) {
        callbacks.setError(
          `All songs failed to load. This usually means the audio files are missing or the playlist needs to be served from a web server.`
        );
      } else if (
        songsWithoutAudio.length > 0 &&
        window.location.protocol !== "file:"
      ) {
        // Continue silently for file:// protocol
      }
    }

    // Set up the playlist and songs for display
    callbacks.setSelectedPlaylist(finalPlaylist);
    callbacks.setPlaylistSongs(finalSongs);

    // Auto-collapse sidebar when loading standalone playlist
    callbacks.setSidebarCollapsed(true);

    // Clear loading progress (if not already cleared by background tasks)
    setTimeout(() => setStandaloneLoadingProgress(null), 500);
  } catch (err) {
    console.error("Error initializing standalone playlist:", err);
    callbacks.setError("Failed to load standalone playlist");
    setStandaloneLoadingProgress(null);
  }
}

/**
 * Clear loading progress (useful for cleanup)
 */
export function clearStandaloneLoadingProgress() {
  setStandaloneLoadingProgress(null);
}
