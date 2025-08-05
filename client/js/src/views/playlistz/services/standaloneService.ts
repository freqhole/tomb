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
 * Validate that a song has valid audio data OR is properly set up for lazy loading
 */
function hasValidAudioData(song: any): boolean {
  // For lazy loading: song is valid if it has a standaloneFilePath (can be loaded on-demand)
  // OR if it already has audioData
  if (song.standaloneFilePath && song.mimeType) {
    return true; // Valid for lazy loading
  }

  // Traditional validation: has actual audio data
  return !!(song.audioData && song.audioData.byteLength > 0 && song.mimeType);
}

/**
 * Update songs and playlist efficiently in background
 */
async function updateExistingData(
  existingPlaylist: Playlist,
  playlistSongs: any[],
  playlistData: any
): Promise<{ updatedPlaylist: Playlist; updatedSongs: any[] }> {
  const updatedSongs = [];

  // Update all songs, checking for stale data more thoroughly
  for (let idx = 0; idx < playlistData.songs.length; idx++) {
    const songData = playlistData.songs[idx];
    const existingSong = playlistSongs.find((s) => s.id === songData.id);
    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;

    setStandaloneLoadingProgress({
      current: idx + 1,
      total: playlistData.songs.length,
      currentSong: songData.title,
      phase: "updating",
    });

    let song;
    const needsReload =
      !existingSong ||
      !hasValidAudioData(existingSong) ||
      existingSong.mimeType !== songData.mimeType ||
      !existingSong.standaloneFilePath ||
      existingSong.standaloneFilePath !== standaloneFilePath;

    if (needsReload) {
      // Create song for lazy loading (no audio data initially)
      song = createSongFromData(
        songData,
        idx,
        existingPlaylist.id,
        standaloneFilePath,
        undefined, // No audio data initially - lazy loading
        songData.mimeType || "audio/mpeg"
      );
    } else {
      // Keep existing valid song, just update metadata
      song = {
        ...existingSong,
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        standaloneFilePath,
        updatedAt: Date.now(),
      };

      // Update image if changed
      if (songData.imageBase64) {
        song.imageData = base64ToArrayBuffer(songData.imageBase64);
        song.imageType = songData.imageMimeType;
      }
    }

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });

    updatedSongs.push(song);
  }

  // Update playlist
  const updatedPlaylist = {
    ...existingPlaylist,
    title: playlistData.playlist.title,
    description: playlistData.playlist.description,
    songIds: playlistData.songs.map((s: any) => s.id),
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
  const virtualSongs: any[] = [];
  const finalSongIds: string[] = [];

  // Create placeholder songs for all songs first so UI shows complete list
  for (let i = 0; i < playlistData.songs.length; i++) {
    const songData = playlistData.songs[i];
    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;

    // Create song without audio data initially for lazy loading
    const song = createSongFromData(
      songData,
      i,
      finalPlaylist.id,
      standaloneFilePath,
      undefined, // No audio data initially - will be loaded on-demand
      songData.mimeType || "audio/mpeg"
    );

    virtualSongs.push(song);
    finalSongIds.push(song.id);
  }

  // Update playlist with all song IDs immediately for UI
  finalPlaylist.songIds = finalSongIds;
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  // Store placeholder songs in IndexedDB
  for (const song of virtualSongs) {
    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });
  }

  // In lazy loading mode, we don't pre-load any audio data
  // Songs will be loaded on-demand when played

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

      // Update songs and playlist data
      setStandaloneLoadingProgress({
        current: 0,
        total: playlistData.songs.length,
        currentSong: "checking for stale songs...",
        phase: "checking",
      });

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

    // Clear loading progress (if not already cleared by background tasks)
    setTimeout(() => setStandaloneLoadingProgress(null), 500);
  } catch (err) {
    console.error("Error initializing standalone playlist:", err);
    callbacks.setError("Failed to load standalone playlist");
    setStandaloneLoadingProgress(null);
  }
}

/**
 * Load audio data on-demand for a standalone song
 * Follows the same pattern as addSongToPlaylist but gets ArrayBuffer from network/file
 */
export async function loadStandaloneSongAudioData(
  songId: string
): Promise<boolean> {
  try {
    const db = await setupDB();
    const song = await db.get(SONGS_STORE, songId);

    if (!song) {
      console.error(`Song ${songId} not found in database`);
      return false;
    }

    // If song already has audio data, no need to load
    if (song.audioData && song.audioData.byteLength > 0) {
      return true;
    }

    // If no standalone file path, can't load
    if (!song.standaloneFilePath) {
      console.error(`Song ${songId} has no standalone file path`);
      return false;
    }

    // Skip caching for file:// protocol - songs work directly from disk
    if (window.location.protocol === "file:") {
      return true; // Return success but don't actually cache
    }

    // For http/https, actually cache the audio data
    const response = await fetch(song.standaloneFilePath);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }
    const audioData = await response.arrayBuffer();

    // Store in IndexedDB using the same pattern as addSongToPlaylist
    const updatedSong = {
      ...song,
      audioData, // Store audio as ArrayBuffer
      mimeType: song.mimeType || "audio/mpeg", // Ensure mimeType is set
      updatedAt: Date.now(),
    };

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: songId,
      updateFn: () => updatedSong,
    });

    return true;
  } catch (error) {
    console.error(
      `Error loading standalone song audio data for ${songId}:`,
      error
    );
    return false;
  }
}

/**
 * Check if a song needs audio data to be loaded
 */
export async function songNeedsAudioData(song: any): Promise<boolean> {
  // If no standalone file path, can't do on-demand loading
  if (!song.standaloneFilePath) {
    return false;
  }

  // Check the database directly for the most up-to-date audio data
  try {
    const db = await setupDB();
    const dbSong = await db.get(SONGS_STORE, song.id);

    if (!dbSong) {
      return false;
    }

    // Skip caching check for file:// protocol - always return false (no caching needed)
    if (window.location.protocol === "file:") {
      return false;
    }

    // For http/https, check if it has actual audio data
    return !dbSong.audioData || dbSong.audioData.byteLength === 0;
  } catch (error) {
    console.error(
      `Error checking song audio data status for ${song.id}:`,
      error
    );
    // Fallback to checking the in-memory song object
    return !!(
      song.standaloneFilePath &&
      (!song.audioData || song.audioData.byteLength === 0)
    );
  }
}

/**
 * Clear loading progress (useful for cleanup)
 */
export function clearStandaloneLoadingProgress() {
  setStandaloneLoadingProgress(null);
}
