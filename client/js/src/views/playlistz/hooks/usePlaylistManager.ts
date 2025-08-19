/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Playlist } from "../types/playlist.js";
import {
  setupDB,
  createPlaylist,
  createPlaylistsQuery,
  createPlaylistSongsQuery,
  addSongToPlaylist,
} from "../services/indexedDBService.js";
import { filterAudioFiles } from "../services/fileProcessingService.js";
import { parsePlaylistZip } from "../services/playlistDownloadService.js";
import {
  initializeStandalonePlaylist,
  clearStandaloneLoadingProgress,
} from "../services/standaloneService.js";
import {
  initializeOfflineSupport,
  updatePWAManifest,
} from "../services/offlineService.js";
import { audioState } from "../services/audioService.js";
import { getImageUrlForContext } from "../services/imageService.js";

export function usePlaylistManager() {
  // Playlists state
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [playlistSongs, setPlaylistSongs] = createSignal<any[]>([]);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Background image state
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<
    string | null
  >(null);
  const [imageUrlCache] = createSignal(new Map<string, string>());

  // Query management
  let playlistsQueryUnsubscribe: (() => void) | null = null;
  let songsQueryUnsubscribe: (() => void) | null = null;

  // Initialize the database and set up queries
  const initialize = async () => {
    try {
      setError(null);

      // Set up database
      await setupDB();

      // Set up playlist query with reactive subscription
      const playlistQuery = createPlaylistsQuery();
      playlistsQueryUnsubscribe = playlistQuery.subscribe((value) => {
        setPlaylists([...value]); // force new array reference

        // update selected playlist if it exists in the new data
        const current = selectedPlaylist();
        if (current) {
          const updated = value.find((p) => p.id === current.id);
          if (updated) {
            setSelectedPlaylist(updated);
          }
        }
      });

      // Initialize offline support for standalone mode
      if ((window as any).STANDALONE_MODE) {
        await initializeOfflineSupport();
        await updatePWAManifest("Playlistz", undefined);

        // Handle deferred playlist data from standalone initialization
        const deferredData = (window as any).DEFERRED_PLAYLIST_DATA;
        if (deferredData) {
          try {
            await initializeStandalonePlaylist(deferredData, {
              setSelectedPlaylist,
              setPlaylistSongs,
              setSidebarCollapsed: () => {}, // Not used in this context
              setError,
            });
            delete (window as any).DEFERRED_PLAYLIST_DATA;
          } catch (err) {
            console.error("Error initializing deferred playlist:", err);
            setError("Failed to initialize playlist");
          }
        }

        // Clear any loading progress
        clearStandaloneLoadingProgress();
      }

      // Initialize offline support
      try {
        await initializeOfflineSupport();
      } catch (offlineError) {
        console.warn("offline support initialization failed:", offlineError);
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
      if (files.length === 1 && files[0]?.name.toLowerCase().endsWith(".zip")) {
        const zipFile = files[0];
        const result = await parsePlaylistZip(zipFile);
        return result.playlist;
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

      // Add audio files to playlist
      for (const audioFile of audioFiles) {
        await addSongToPlaylist(playlistId, audioFile);
      }

      return playlistId;
    } catch (err) {
      console.error("Error handling file drop:", err);
      setError("Failed to process dropped files");
      return null;
    }
  };

  // Load playlist songs when selected playlist changes using reactive queries
  createEffect(() => {
    const playlist = selectedPlaylist();

    // cleanup previous songs query subscription
    if (songsQueryUnsubscribe) {
      songsQueryUnsubscribe();
      songsQueryUnsubscribe = null;
    }

    if (playlist && playlist.songIds.length > 0) {
      // create reactive query for this playlist's songs
      const songsQuery = createPlaylistSongsQuery(playlist.id);
      songsQueryUnsubscribe = songsQuery.subscribe((songs) => {
        // sort songs according to playlist order
        const sortedSongs = songs.sort((a, b) => {
          const indexA = playlist.songIds.indexOf(a.id);
          const indexB = playlist.songIds.indexOf(b.id);
          return indexA - indexB;
        });
        setPlaylistSongs(sortedSongs);
      });
    } else {
      setPlaylistSongs([]);
    }

    // cleanup songs query subscription on unmount
    onCleanup(() => {
      if (songsQueryUnsubscribe) {
        songsQueryUnsubscribe();
      }
    });
  });

  // Update background image based on currently playing song or selected playlist
  createEffect(() => {
    const currentSong = audioState.currentSong();
    const currentPlaylist = audioState.currentPlaylist();
    const selectedPl = selectedPlaylist();
    const cache = imageUrlCache();

    let newImageUrl: string | null = null;
    let cacheKey: string | null = null;

    // priority 1: use song's image if available (when playing)
    if (currentSong?.imageType) {
      cacheKey = `song-${currentSong.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = getImageUrlForContext(currentSong, "background");
        if (newImageUrl) {
          cache.set(cacheKey, newImageUrl);
        }
      }
    }
    // priority 2: use current playlist's image if song has no image (when playing)
    else if (currentSong && currentPlaylist?.imageType) {
      cacheKey = `playlist-${currentPlaylist.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = getImageUrlForContext(currentPlaylist, "background");
        if (newImageUrl) {
          cache.set(cacheKey, newImageUrl);
        }
      }
    }
    // priority 3: Use selected playlist's image (when not playing but playlist selected)
    else if (selectedPl?.imageType) {
      cacheKey = `playlist-${selectedPl.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = getImageUrlForContext(selectedPl, "background");
        if (newImageUrl) {
          cache.set(cacheKey, newImageUrl);
        }
      }
    }

    // only update if URL actually changed
    const prevUrl = backgroundImageUrl();
    if (prevUrl !== newImageUrl) {
      setBackgroundImageUrl(newImageUrl);
    }
  });

  // Update PWA manifest when playlist changes
  createEffect(() => {
    const playlist = selectedPlaylist();
    if (playlist) {
      updatePWAManifest(playlist.title, playlist);
    }
  });

  // Get playlist by ID
  const getPlaylistById = (id: string): Playlist | undefined => {
    return playlists().find((p) => p.id === id);
  };

  // Check if a playlist exists
  const playlistExists = (id: string): boolean => {
    return playlists().some((p) => p.id === id);
  };

  // Get total number of playlists
  const getPlaylistCount = (): number => {
    return playlists().length;
  };

  // Search playlists by title
  const searchPlaylists = (query: string): Playlist[] => {
    if (!query.trim()) return playlists();

    const lowercaseQuery = query.toLowerCase();
    return playlists().filter(
      (playlist) =>
        playlist.title.toLowerCase().includes(lowercaseQuery) ||
        (playlist.description || "").toLowerCase().includes(lowercaseQuery)
    );
  };

  // Select a playlist
  const selectPlaylist = (playlist: Playlist | null) => {
    setSelectedPlaylist(playlist);
  };

  // Initialize on mount
  onMount(initialize);

  // Cleanup on unmount
  onCleanup(() => {
    if (playlistsQueryUnsubscribe) {
      playlistsQueryUnsubscribe();
    }
    if (songsQueryUnsubscribe) {
      songsQueryUnsubscribe();
    }

    // Cleanup image URLs
    const cache = imageUrlCache();
    cache.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    cache.clear();
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
    selectedPlaylist,
    playlistSongs,
    isInitialized,
    error,
    backgroundImageUrl,
    imageUrlCache,

    // Setters
    setSelectedPlaylist,
    setPlaylistSongs,

    // Actions
    initialize,
    createNewPlaylist,
    handleFileDrop,
    selectPlaylist,

    // Utilities
    getPlaylistById,
    playlistExists,
    getPlaylistCount,
    searchPlaylists,
  };
}
