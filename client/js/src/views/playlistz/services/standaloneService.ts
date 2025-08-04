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

  console.log(
    `🎵 Loading audio data for: ${songData.title} from ${standaloneFilePath}`
  );
  console.log(`🎵 Current location: ${window.location.href}`);
  console.log(
    `🎵 Constructed URL: ${new URL(standaloneFilePath, window.location.href).href}`
  );

  try {
    // Check if we're using file:// protocol
    if (window.location.protocol === "file:") {
      console.log(
        `🎵 Using file:// protocol, skipping audio data loading for now`
      );
      console.log(
        `🎵 Song will use direct file path for playback: ${standaloneFilePath}`
      );

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
      console.log(
        `🎵 Fetch response status: ${response.status} ${response.statusText}`
      );

      if (response.ok) {
        audioData = await response.arrayBuffer();
        mimeType = response.headers.get("Content-Type") || mimeType;
        console.log(
          `✅ Successfully fetched ${audioData.byteLength} bytes for: ${songData.title} (${mimeType})`
        );
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
 * Add missing songs to an existing playlist
 */
async function addMissingSongs(
  existingPlaylist: Playlist,
  playlistSongs: any[],
  missingSongs: any[]
): Promise<{ updatedPlaylist: Playlist; updatedSongs: any[] }> {
  console.log(`🎵 Adding ${missingSongs.length} missing songs...`);

  // Update progress for missing songs
  setStandaloneLoadingProgress({
    current: 0,
    total: missingSongs.length,
    currentSong: "Adding missing songs...",
  });

  const newSongIds = [...existingPlaylist.songIds];
  const updatedPlaylistSongs = [...playlistSongs];

  for (let idx = 0; idx < missingSongs.length; idx++) {
    const songData = missingSongs[idx];

    // Update progress
    setStandaloneLoadingProgress({
      current: idx + 1,
      total: missingSongs.length,
      currentSong: songData.title,
    });

    const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;
    const { audioData, mimeType } = await loadSongAudioData(
      songData,
      standaloneFilePath
    );

    const song = createSongFromData(
      songData,
      playlistSongs.length + idx,
      existingPlaylist.id,
      standaloneFilePath,
      audioData,
      mimeType
    );

    // Store new song
    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });

    updatedPlaylistSongs.push(song);
    newSongIds.push(song.id);
    console.log("💾 Added new song:", song.title);
  }

  // Update playlist with new song IDs
  const updatedPlaylist = {
    ...existingPlaylist,
    songIds: newSongIds,
    updatedAt: Date.now(),
  };

  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: updatedPlaylist.id,
    updateFn: () => updatedPlaylist,
  });

  console.log(`🎵 Added ${missingSongs.length} new songs to existing playlist`);

  return { updatedPlaylist, updatedSongs: updatedPlaylistSongs };
}

/**
 * Create a new playlist with all songs
 */
async function createNewPlaylist(
  playlistData: any
): Promise<{ playlist: Playlist; songs: any[] }> {
  console.log("🎵 Creating new standalone playlist...");

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
    console.log("🖼️ Set playlist image from base64 data");
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
  const db = await setupDB();

  for (let i = 0; i < playlistData.songs.length; i++) {
    const songData = playlistData.songs[i];

    // Update progress
    setStandaloneLoadingProgress({
      current: i + 1,
      total: playlistData.songs.length,
      currentSong: songData.title,
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

    // Store song using mutateAndNotify to trigger reactive updates
    await mutateAndNotify({
      dbName: DB_NAME,
      storeName: SONGS_STORE,
      key: song.id,
      updateFn: () => song,
    });

    virtualSongs.push(song);
    finalSongIds.push(song.id);
    console.log(
      `💾 Added song: ${song.title} (${audioData ? "with audio data" : "WITHOUT audio data"})`
    );

    // Verify the song was stored with audio data
    if (audioData) {
      try {
        const storedSong = await db.get(SONGS_STORE, song.id);
        if (storedSong && storedSong.audioData) {
          console.log(
            `✅ Verified: ${song.title} stored with ${storedSong.audioData.byteLength} bytes`
          );
        } else {
          console.error(
            `❌ Verification failed: ${song.title} not properly stored`
          );
        }
      } catch (verifyError) {
        console.error(
          `❌ Error verifying storage for ${song.title}:`,
          verifyError
        );
      }
    }
  }

  // Update playlist with final song IDs
  finalPlaylist.songIds = finalSongIds;
  await mutateAndNotify({
    dbName: DB_NAME,
    storeName: PLAYLISTS_STORE,
    key: finalPlaylist.id,
    updateFn: () => finalPlaylist,
  });

  console.log("💾 Playlist saved with reactive updates:", finalPlaylist);

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
      currentSong: "Initializing...",
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
      console.log(
        "🎵 Playlist already exists, loading existing:",
        existingPlaylist.title
      );

      // Load existing songs for this playlist
      const existingSongs = await db.getAll(SONGS_STORE);
      const playlistSongs = existingSongs.filter(
        (song: any) => song.playlistId === existingPlaylist.id
      );

      // For file:// protocol, ensure existing songs have standaloneFilePath
      if (window.location.protocol === "file:") {
        for (const song of playlistSongs) {
          if (!(song as any).standaloneFilePath) {
            // Find matching song in playlist data to get the path
            const songData = playlistData.songs.find(
              (s: any) => s.id === song.id
            );
            if (songData) {
              const standaloneFilePath = `data/${songData.safeFilename || songData.originalFilename}`;
              (song as any).standaloneFilePath = standaloneFilePath;

              // Update the song in IndexedDB
              await mutateAndNotify({
                dbName: DB_NAME,
                storeName: SONGS_STORE,
                key: song.id,
                updateFn: () => song,
              });

              console.log(
                `🔧 Added standaloneFilePath to existing song: ${song.title}`
              );
            }
          }
        }
      }

      // Check if all expected songs exist and add missing ones
      const expectedSongCount = playlistData.songs.length;
      const actualSongCount = playlistSongs.length;

      if (actualSongCount !== expectedSongCount) {
        console.log(
          `🎵 Song count mismatch: expected ${expectedSongCount}, found ${actualSongCount}. Adding missing songs.`
        );

        // Find missing songs by comparing IDs
        const existingSongIds = new Set(playlistSongs.map((song) => song.id));
        const missingSongs = playlistData.songs.filter(
          (songData: any) => !existingSongIds.has(songData.id)
        );

        const { updatedPlaylist, updatedSongs } = await addMissingSongs(
          existingPlaylist,
          playlistSongs,
          missingSongs
        );

        finalPlaylist = updatedPlaylist;
        finalSongs = updatedSongs;
      } else {
        console.log("🎵 Existing standalone playlist loaded (no new songs)");
        finalPlaylist = existingPlaylist;
        finalSongs = playlistSongs;
      }
    } else {
      const { playlist, songs } = await createNewPlaylist(playlistData);
      finalPlaylist = playlist;
      finalSongs = songs;
    }

    // Count successfully loaded songs
    const songsWithAudio = finalSongs.filter((song) => song.audioData);
    const songsWithFilePaths = finalSongs.filter(
      (song) => (song as any).standaloneFilePath
    );
    const songsWithoutAudio = finalSongs.filter(
      (song) => !song.audioData && !(song as any).standaloneFilePath
    );

    console.log("🎵 Standalone initialization complete:");
    console.log(`   Protocol: ${window.location.protocol}`);
    console.log(`   Location: ${window.location.href}`);

    if (window.location.protocol === "file:") {
      console.log(
        `   ✅ ${songsWithAudio.length} songs loaded with audio data (IndexedDB)`
      );
      console.log(
        `   🎵 ${songsWithFilePaths.length} songs using file:// paths (direct file access)`
      );

      // Debug individual songs
      finalSongs.forEach((song, index) => {
        console.log(`   Song ${index + 1}: ${song.title}`);
        console.log(`     - Has audioData: ${!!song.audioData}`);
        console.log(
          `     - Has standaloneFilePath: ${!!(song as any).standaloneFilePath}`
        );
        if ((song as any).standaloneFilePath) {
          console.log(`     - FilePath: ${(song as any).standaloneFilePath}`);
          const fullUrl = new URL(
            (song as any).standaloneFilePath,
            window.location.href
          ).href;
          console.log(`     - Full URL: ${fullUrl}`);
        }
      });
    } else {
      console.log(
        `   ✅ ${songsWithAudio.length} songs loaded with audio data`
      );
    }

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
        console.info(
          `ℹ️ Playlist loaded successfully. ${songsWithAudio.length} songs are playable, ${songsWithoutAudio.length} songs could not be loaded.`
        );
      }
    }

    // Set up the playlist and songs for display
    callbacks.setSelectedPlaylist(finalPlaylist);
    callbacks.setPlaylistSongs(finalSongs);

    // Auto-collapse sidebar when loading standalone playlist
    callbacks.setSidebarCollapsed(true);

    // Clear loading progress
    setStandaloneLoadingProgress(null);

    console.log("🎵 Standalone playlist loaded from embedded data");
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
