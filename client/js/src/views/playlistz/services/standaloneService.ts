import { createSignal } from "solid-js";
import {
  setupDB,
  DB_NAME,
  PLAYLISTS_STORE,
  SONGS_STORE,
} from "./indexedDBService.js";
import { mutateAndNotify } from "./indexedDBService.js";
import { triggerSongUpdateWithOptions } from "./songReactivity.js";
import type { Playlist } from "../types/playlist.js";

// Loading progress signal
const [standaloneLoadingProgress, setStandaloneLoadingProgress] = createSignal<{
  current: number;
  total: number;
  currentSong: string;
  phase: "initializing" | "checking" | "updating" | "complete" | "reloading";
} | null>(null);

// Export the signal and setter for UI components to use
export { standaloneLoadingProgress, setStandaloneLoadingProgress };

// Track which images are currently being loaded to prevent duplicates
const loadingImages = new Set<string>();

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
    needsImageLoad: true,
    imageFilePath: "",
    sha: songData.sha, // Include SHA from standalone data
  };

  // Set song image metadata for file-based loading
  if (songData.imageExtension && songData.imageMimeType) {
    song.imageType = songData.imageMimeType;
    song.needsImageLoad = true;
    song.imageFilePath = `data/${songData.safeFilename?.replace(/\.[^.]+$/, "") || songData.originalFilename?.replace(/\.[^.]+$/, "")}-cover${songData.imageExtension}`;
  }

  return song;
}

/**
 * smart update function that preserves audio data when sha matches
 */
async function smartUpdatePlaylistWithSongs(
  existingPlaylist: Playlist | null,
  existingSongs: any[],
  playlistData: any
): Promise<{ playlist: Playlist; songs: any[] }> {
  // create or update playlist
  const playlistToUpdate = {
    id: playlistData.playlist.id,
    title: playlistData.playlist.title,
    description: playlistData.playlist.description,
    rev: playlistData.playlist.rev || 0,
    songIds: [],
    imageData: undefined as ArrayBuffer | undefined,
    thumbnailData: undefined as ArrayBuffer | undefined,
    imageType: undefined as string | undefined,
    needsImageLoad: true,
    imageFilePath: undefined as string | undefined,
  };

  // set playlist image metadata for loading from file
  if (
    playlistData.playlist.imageExtension &&
    playlistData.playlist.imageMimeType
  ) {
    playlistToUpdate.imageType = playlistData.playlist.imageMimeType;
    playlistToUpdate.needsImageLoad = true;
    playlistToUpdate.imageFilePath = `data/playlist-cover${playlistData.playlist.imageExtension}`;
  }

  const finalPlaylist: Playlist = {
    ...playlistToUpdate,
    createdAt: existingPlaylist?.createdAt || Date.now(),
    updatedAt: Date.now(),
    songIds: [],
  };

  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  // smart song updating: preserve audio data when sha matches
  const updatedSongs: any[] = [];
  const finalSongIds: string[] = [];

  for (let i = 0; i < playlistData.songs.length; i++) {
    const songData = playlistData.songs[i];
    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;

    setStandaloneLoadingProgress({
      current: i + 1,
      total: playlistData.songs.length,
      currentSong: songData.title,
      phase: "reloading",
    });

    // check if this song already exists
    const existingSong = existingSongs.find((s) => s.id === songData.id);

    let finalSong;

    if (
      existingSong &&
      existingSong.sha &&
      songData.sha &&
      existingSong.sha === songData.sha
    ) {
      // sha matches - preserve existing audio data but update metadata
      finalSong = {
        ...existingSong,
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        duration: songData.duration,
        position: i,
        originalFilename: songData.originalFilename,
        fileSize: songData.fileSize,
        mimeType: songData.mimeType || existingSong.mimeType,
        standaloneFilePath,
        updatedAt: Date.now(),
        sha: songData.sha, // keep the sha
      };

      // update image metadata if changed
      if (songData.imageExtension && songData.imageMimeType) {
        finalSong.imageType = songData.imageMimeType;
        finalSong.needsImageLoad = true;
        finalSong.imageFilePath = `data/${songData.safeFilename?.replace(/\.[^.]+$/, "") || songData.originalFilename?.replace(/\.[^.]+$/, "")}-cover${songData.imageExtension}`;
      }
    } else {
      // sha different or missing - create new song without audio data (lazy loading)
      finalSong = createSongFromData(
        songData,
        i,
        finalPlaylist.id,
        standaloneFilePath,
        undefined, // no audio data initially - will be loaded on-demand
        songData.mimeType || "audio/mpeg"
      );
    }

    updatedSongs.push(finalSong);
    finalSongIds.push(finalSong.id);

    // store song in indexeddb
    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: finalSong.id,
      updateFn: () => finalSong,
    });
  }

  // update playlist with all song ids
  finalPlaylist.songIds = finalSongIds;
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  return { playlist: finalPlaylist, songs: updatedSongs };
}

/**
 * create a new playlist with all songs (used for first-time loading)
 */
async function createNewPlaylist(
  playlistData: any
): Promise<{ playlist: Playlist; songs: any[] }> {
  // create playlist using service function to trigger reactive updates
  const playlistToCreate = {
    id: playlistData.playlist.id, // Override the auto-generated ID
    title: playlistData.playlist.title,
    description: playlistData.playlist.description,
    songIds: [],
    imageData: undefined as ArrayBuffer | undefined,
    thumbnailData: undefined as ArrayBuffer | undefined,
    imageType: undefined as string | undefined,
    needsImageLoad: true,
    imageFilePath: undefined as string | undefined,
  };

  // set playlist image metadata for loading from file
  if (
    playlistData.playlist.imageExtension &&
    playlistData.playlist.imageMimeType
  ) {
    playlistToCreate.imageType = playlistData.playlist.imageMimeType;
    playlistToCreate.needsImageLoad = true;
    playlistToCreate.imageFilePath = `data/playlist-cover${playlistData.playlist.imageExtension}`;
  }

  // manually store playlist using mutateandnotify to trigger reactive updates
  const finalPlaylist: Playlist = {
    ...playlistToCreate,
    id: playlistData.playlist.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rev: playlistData.playlist.rev || 0,
    songIds: [],
  };

  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  // create and store songs
  const virtualSongs: any[] = [];
  const finalSongIds: string[] = [];

  // create placeholder songs for all songs first so ui shows complete list
  for (let i = 0; i < playlistData.songs.length; i++) {
    const songData = playlistData.songs[i];
    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;

    // create song without audio data initially for lazy loading
    const song = createSongFromData(
      songData,
      i,
      finalPlaylist.id,
      standaloneFilePath,
      undefined, // no audio data initially - will be loaded on-demand
      songData.mimeType || "audio/mpeg"
    );

    virtualSongs.push(song);
    finalSongIds.push(song.id);
  }

  // update playlist with all song ids immediately for ui
  finalPlaylist.songIds = finalSongIds;
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  // store placeholder songs in indexeddb
  for (const song of virtualSongs) {
    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });
  }

  // in lazy loading mode, we don't pre-load any audio data
  // songs will be loaded on-demand when played

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
    // Validate input data
    if (!playlistData || !playlistData.playlist || !playlistData.songs) {
      console.error(
        "Error initializing standalone playlist: Invalid playlist data"
      );
      callbacks.setError("Invalid playlist data provided");
      return;
    }

    // Validate callbacks
    if (!callbacks.setError || typeof callbacks.setError !== "function") {
      throw new Error("callbacks.setError is not a function");
    }
    if (
      !callbacks.setPlaylistSongs ||
      typeof callbacks.setPlaylistSongs !== "function"
    ) {
      throw new Error("callbacks.setPlaylistSongs is not a function");
    }

    // Show loading progress
    setStandaloneLoadingProgress({
      current: 0,
      total: playlistData.songs.length,
      currentSong: "initializing...",
      phase: "initializing",
    });

    // Check if playlist with this ID already exists
    let db;
    try {
      db = await setupDB();
    } catch (error) {
      console.error("Error initializing standalone playlist:", error);
      callbacks.setError("Failed to load playlist - database setup failed");
      return;
    }

    const existingPlaylist = await db.get(
      PLAYLISTS_STORE,
      playlistData.playlist.id
    );

    let finalPlaylist: Playlist;
    let finalSongs: any[];

    if (existingPlaylist) {
      // check if playlist revision has changed and needs full reload
      const existingRev = existingPlaylist.rev || 0;
      const incomingRev = playlistData.playlist.rev || 0;
      const needsFullReload = incomingRev > existingRev;

      if (needsFullReload) {
        // load existing songs for this playlist
        const existingSongs = await db.getAll(SONGS_STORE);
        const playlistSongs = existingSongs.filter(
          (song: any) => song.playlistId === existingPlaylist.id
        );

        // smart update that preserves audio data when sha matches
        setStandaloneLoadingProgress({
          current: 0,
          total: playlistData.songs.length,
          currentSong: "updating playlist revision...",
          phase: "reloading",
        });

        const { playlist, songs } = await smartUpdatePlaylistWithSongs(
          existingPlaylist,
          playlistSongs,
          playlistData
        );
        finalPlaylist = playlist;
        finalSongs = songs;
      } else {
        // rev hasn't changed, so playlist and songs are identical
        // just use existing data without any processing
        const existingSongs = await db.getAll(SONGS_STORE);
        const playlistSongs = existingSongs.filter(
          (song: any) => song.playlistId === existingPlaylist.id
        );

        finalPlaylist = existingPlaylist;
        finalSongs = playlistSongs;
      }
    } else {
      const { playlist, songs } = await createNewPlaylist(playlistData);
      finalPlaylist = playlist;
      finalSongs = songs;
    }

    // Count successfully loaded songs
    const songsWithoutAudio = finalSongs.filter(
      (song) => !song.audioData && !song.standaloneFilePath
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

    // Load images in background after playlist is initialized
    setTimeout(
      () => loadStandaloneImages(finalPlaylist, finalSongs, callbacks),
      1000
    );
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
  // Check the database directly for the most up-to-date audio data
  try {
    const db = await setupDB();
    const dbSong = await db.get(SONGS_STORE, song.id);

    if (!dbSong) {
      return true; // song doesn't exist, needs data
    }

    // Skip caching check for file:// protocol - always return false (no caching needed)
    if (window.location.protocol === "file:") {
      return false;
    }

    // Check if it has actual audio data (raw blob data)
    return !dbSong.audioData || dbSong.audioData.byteLength === 0;
  } catch (error) {
    console.error(
      `Error checking song audio data status for ${song.id}:`,
      error
    );
    return true; // assume needs data on error
  }
}

/**
 * Load images from files into IndexedDB for standalone mode
 */
async function loadStandaloneImages(
  playlist: Playlist,
  songs: any[],
  callbacks: {
    setSelectedPlaylist: (playlist: Playlist) => void;
    setPlaylistSongs: (songs: any[]) => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    setError: (error: string) => void;
  }
): Promise<void> {
  // For file:// protocol, images work directly from paths, no need to load into IndexedDB
  // For HTTP/HTTPS, load images from files into IndexedDB
  if (window.location.protocol === "file:") {
    return;
  }

  try {
    // Load playlist image if needed
    if (
      playlist.needsImageLoad &&
      playlist.imageFilePath &&
      !playlist.imageData
    ) {
      const updatedPlaylist = await loadImageIntoIndexedDB(playlist, true);
      if (updatedPlaylist) {
        // Update the selectedPlaylist signal to trigger UI reactivity
        callbacks.setSelectedPlaylist(updatedPlaylist);
      }
    }

    // Load song images if needed
    let songsUpdated = false;
    for (const song of songs) {
      if (song.needsImageLoad && song.imageFilePath && !song.imageData) {
        const updatedSong = await loadImageIntoIndexedDB(song, false);
        if (updatedSong) {
          songsUpdated = true;
        }
      }
    }

    // If any songs were updated, refresh the playlistSongs signal for carousel
    if (songsUpdated) {
      try {
        const db = await setupDB();
        const allSongs = await db.getAll(SONGS_STORE);
        const updatedPlaylistSongs = allSongs
          .filter((song: any) => playlist.songIds.includes(song.id))
          .sort((a, b) => {
            const indexA = playlist.songIds.indexOf(a.id);
            const indexB = playlist.songIds.indexOf(b.id);
            return indexA - indexB;
          });
        callbacks.setPlaylistSongs(updatedPlaylistSongs);
      } catch (error) {
        console.warn(
          "Error refreshing playlist songs after image loading:",
          error
        );
      }
    }
  } catch (error) {
    console.warn("Error loading standalone images:", error);
  }
}

/**
 * Load a single image file into IndexedDB
 */
async function loadImageIntoIndexedDB(
  item: any,
  isPlaylist: boolean
): Promise<any> {
  try {
    // Double-check that we actually need to load this image
    if (item.imageData && item.imageData.byteLength > 0) {
      return; // Already has image data
    }

    // Check if this image is already being loaded
    if (loadingImages.has(item.imageFilePath)) {
      return null; // Already loading
    }

    // Mark as loading
    loadingImages.add(item.imageFilePath);

    // For file:// protocol, load image from file path
    const response = await fetch(item.imageFilePath);
    if (!response.ok) {
      console.warn(`Failed to load image: ${item.imageFilePath}`);
      loadingImages.delete(item.imageFilePath);
      return null;
    }

    const imageData = await response.arrayBuffer();

    // Update the item with loaded image data
    const updatedItem = {
      ...item,
      imageData,
      needsImageLoad: false,
      updatedAt: Date.now(),
    };

    const storeName = isPlaylist ? PLAYLISTS_STORE : SONGS_STORE;

    await mutateAndNotify({
      dbName: DB_NAME,
      storeName,
      key: item.id,
      updateFn: () => updatedItem,
    });

    // Trigger reactivity to update UI (specific song only to prevent flickering)
    if (!isPlaylist) {
      triggerSongUpdateWithOptions({
        songId: item.id,
        type: "edit",
        specificOnly: true,
      });
    }
    // For playlists, mutateAndNotify should automatically trigger reactivity

    // Remove from loading set
    loadingImages.delete(item.imageFilePath);

    return updatedItem;
  } catch (error) {
    console.warn(`Error loading image for ${item.id}:`, error);
    loadingImages.delete(item.imageFilePath);
    return null;
  }
}

/**
 * Clear loading progress (useful for cleanup)
 */
export function clearStandaloneLoadingProgress() {
  setStandaloneLoadingProgress(null);
}
