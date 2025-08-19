/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Playlist } from "../types/playlist.js";
import {
  setupDB,
  createPlaylist,
  createPlaylistsQuery,
  getAllPlaylists,
  addSongToPlaylist,
} from "../services/indexedDBService.js";
import {
  filterAudioFiles,
  processAudioFiles,
} from "../services/fileProcessingService.js";
import {
  parsePlaylistZip,
} from "../services/playlistDownloadService.js";
import {
  initializeStandalonePlaylist,
  clearStandaloneLoadingProgress,
} from "../services/standaloneService.js";
import {
  initializeOfflineSupport,
  updatePWAManifest,
} from "../services/offlineService.js";

export function usePlaylistManager() {
  // Playlists state
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Query management
  let playlistsQueryUnsubscribe: (() => void) | null = null;

  // Initialize the database and set up queries
  const initialize = async () => {
    try {
      setError(null);

      // Set up database
      await setupDB();

      // Set up playlist query
      const { data: playlistsSignal, unsubscribe } = createPlaylistsQuery();
      playlistsQueryUnsubscribe = unsubscribe;

      // Subscribe to playlist changes
      createEffect(() => {
        const playlistData = playlistsSignal();
        setPlaylists(playlistData);
      });

      // Initialize offline support for standalone mode
      if ((window as any).STANDALONE_MODE) {
        await initializeOfflineSupport();
        await updatePWAManifest();

        // Handle deferred playlist data from standalone initialization
        const deferredData = (window as any).DEFERRED_PLAYLIST_DATA;
        if (deferredData) {
          try {
            await initializeStandalonePlaylist(deferredData);
            delete (window as any).DEFERRED_PLAYLIST_DATA;
          } catch (err) {
            console.error("Error initializing deferred playlist:", err);
            setError("Failed to initialize playlist");
          }
        }

        // Clear any loading progress
        clearStandaloneLoadingProgress();
      }

      setIsInitialized(true);
    } catch (err) {
      console.error("Error initializing playlist manager:", err);
      setError("Failed to initialize playlist manager");
    }
  };

  // Create a new playlist
  const createNewPlaylist = async (title: string = "New Playlist") => {
    try {
      setError(null);
      const playlist = await createPlaylist({
        title,
        description: "",
        songIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return playlist;
    } catch (err) {
      console.error("Error creating playlist:", err);
      setError("Failed to create playlist");
      return null;
    }
  };

  // Handle file drops (audio files or zip files)
  const handleFileDrop = async (files: FileList, targetPlaylistId?: string) => {
    try {
      setError(null);

      // Check if it's a single zip file
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
        const playlist = await parsePlaylistZip(files[0]);
        return playlist;
      }

      // Filter for audio files
      const audioFiles = filterAudioFiles(Array.from(files));
      if (audioFiles.length === 0) {
        setError("No valid audio files found");
        return null;
      }

      // If no target playlist specified, create a new one
      let playlistId = targetPlaylistId;
      if (!playlistId) {
        const newPlaylist = await createNewPlaylist("Dropped Files");
        if (!newPlaylist) return null;
        playlistId = newPlaylist.id;
      }

      // Process and add audio files to playlist
      const processedSongs = await processAudioFiles(audioFiles);

      for (const songData of processedSongs) {
        await addSongToPlaylist(playlistId, songData);
      }

      return playlistId;
    } catch (err) {
      console.error("Error handling file drop:", err);
      setError("Failed to process dropped files");
      return null;
    }
  };

  // Get playlist by ID
  const getPlaylistById = (id: string): Playlist | undefined => {
    return playlists().find(p => p.id === id);
  };

  // Check if a playlist exists
  const playlistExists = (id: string): boolean => {
    return playlists().some(p => p.id === id);
  };

  // Get total number of playlists
  const getPlaylistCount = (): number => {
    return playlists().length;
  };

  // Search playlists by title
  const searchPlaylists = (query: string): Playlist[] => {
    if (!query.trim()) return playlists();

    const lowercaseQuery = query.toLowerCase();
    return playlists().filter(playlist =>
      playlist.title.toLowerCase().includes(lowercaseQuery) ||
      (playlist.description || "").toLowerCase().includes(lowercaseQuery)
    );
  };

  // Initialize on mount
  onMount(() => {
    initialize();
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (playlistsQueryUnsubscribe) {
      playlistsQueryUnsubscribe();
    }
  });

  // Clear error after some time
  createEffect(() => {
    const errorMsg = error();
    if (errorMsg) {
      const timeoutId = setTimeout(() => {
        setError(null);
      }, 5000);

      onCleanup(() => clearTimeout(timeoutId));
    }
  });

  return {
    // State
    playlists,
    isInitialized,
    error,

    // Actions
    initialize,
    createNewPlaylist,
    handleFileDrop,

    // Utilities
    getPlaylistById,
    playlistExists,
    getPlaylistCount,
    searchPlaylists,
  };
}
