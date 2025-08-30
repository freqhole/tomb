/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Playlist } from "../types/playlist.js";
import {
  setupDB,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  removeSongFromPlaylist,
  reorderSongs,
  createPlaylistsQuery,
  createPlaylistSongsQuery,
  addSongToPlaylist,
} from "../services/indexedDBService.js";
import {
  refreshPlaylistQueue,
  audioState,
  stop,
} from "../services/audioService.js";
import { filterAudioFiles } from "../services/fileProcessingService.js";
import {
  parsePlaylistZip,
  downloadPlaylistAsZip,
} from "../services/playlistDownloadService.js";
import {
  cacheAudioFile,
  initializeOfflineSupport,
  updatePWAManifest,
} from "../services/offlineService.js";
import {
  initializeStandalonePlaylist,
  clearStandaloneLoadingProgress,
} from "../services/standaloneService.js";
import { getImageUrlForContext } from "../services/imageService.js";

export function usePlaylistManager() {
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [playlistSongs, setPlaylistSongs] = createSignal<any[]>([]);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // modal and UI state (consolidated from usePlaylistState)
  const [showPlaylistCover, setShowPlaylistCover] = createSignal(false);
  const [showImageModal, setShowImageModal] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [modalImageIndex, setModalImageIndex] = createSignal(0);

  // loading and operation state (consolidated from usePlaylistState)
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [isCaching, setIsCaching] = createSignal(false);
  const [allSongsCached, setAllSongsCached] = createSignal(false);

  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<
    string | null
  >(null);
  const [imageUrlCache] = createSignal(new Map<string, string>());

  // query mgmt
  let playlistsQueryUnsubscribe: (() => void) | null = null;
  let songsQueryUnsubscribe: (() => void) | null = null;

  // init the database and set up queries
  const initialize = async () => {
    try {
      setError(null);

      await setupDB();

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

      // check to init standalone mode (offline support)
      if ((window as any).STANDALONE_MODE) {
        await initializeOfflineSupport();
        await updatePWAManifest("Playlistz", undefined);

        // handle deferred playlist data from standalone initialization
        const deferredData = (window as any).DEFERRED_PLAYLIST_DATA;
        if (deferredData) {
          try {
            await initializeStandalonePlaylist(deferredData, {
              setSelectedPlaylist,
              setPlaylistSongs,
              setSidebarCollapsed: () => {}, // not used in this context
              setError,
            });
            delete (window as any).DEFERRED_PLAYLIST_DATA;
          } catch (err) {
            console.error("onoz! error initializing deferred playlist:", err);
            setError("failed to initialize playlist!");
          }
        }

        // done, clear loading ui
        clearStandaloneLoadingProgress();
      }

      // init offline support
      try {
        await initializeOfflineSupport();
      } catch (offlineError) {
        // prolly not https://
        console.warn("offline support initialization failed:", offlineError);
      }

      setIsInitialized(true);
    } catch (err) {
      console.error("onoz! error initializing playlist manager:", err);
      setError("failed to initialize playlist");
    }
  };

  const createNewPlaylist = async (title: string = "new playlist") => {
    try {
      setError(null);
      const playlist = await createPlaylist({
        title,
        description: "",
        songIds: [],
      });
      return playlist;
    } catch (err) {
      console.error("onoz! error creating playlist:", err);
      setError("failed to create new playlist!");
      return null;
    }
  };

  const handleFileDrop = async (files: FileList, targetPlaylistId?: string) => {
    try {
      setError(null);

      // is it a single zip file?
      if (files.length === 1 && files[0]?.name.toLowerCase().endsWith(".zip")) {
        const zipFile = files[0];
        const result = await parsePlaylistZip(zipFile);
        return result.playlist;
      }

      // only accept audio-like files
      const audioFiles = filterAudioFiles(Array.from(files));
      if (audioFiles.length === 0) {
        setError("no audio filez found!");
        return null;
      }

      // if no target playlist specified, create a new one!
      let playlistId = targetPlaylistId;
      if (!playlistId) {
        const newPlaylist = await createNewPlaylist("dropped filez");
        if (!newPlaylist) return null;
        playlistId = newPlaylist.id;
      }

      // add audio files to the new playlist
      for (const audioFile of audioFiles) {
        await addSongToPlaylist(playlistId, audioFile);
      }

      return playlistId;
    } catch (err) {
      console.error("o noz! error handling file drop:", err);
      setError("failed to process dropped files");
      return null;
    }
  };

  // load playlist songs when selected playlist changes using reactive queries
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

  // update background image based on currently playing song or selected playlist
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

  // update PWA manifest when playlist changes
  createEffect(() => {
    const playlist = selectedPlaylist();
    if (playlist) {
      updatePWAManifest(playlist.title, playlist);
    }
  });

  const getPlaylistById = (id: string): Playlist | undefined => {
    return playlists().find((p) => p.id === id);
  };

  const playlistExists = (id: string): boolean => {
    return playlists().some((p) => p.id === id);
  };

  const getPlaylistCount = (): number => {
    return playlists().length;
  };

  const searchPlaylists = (query: string): Playlist[] => {
    if (!query.trim()) return playlists();

    const lowercaseQuery = query.toLowerCase();
    return playlists().filter(
      (playlist) =>
        playlist.title.toLowerCase().includes(lowercaseQuery) ||
        (playlist.description || "").toLowerCase().includes(lowercaseQuery)
    );
  };

  const selectPlaylist = (playlist: Playlist | null) => {
    setSelectedPlaylist(playlist);
  };

  // CRUD stuff (consolidated from usePlaylistState)
  const handlePlaylistUpdate = async (updates: Partial<Playlist>) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);

      const updatedFields = {
        ...updates,
        updatedAt: Date.now(),
      };

      await updatePlaylist(playlist.id, updatedFields);

      // note: the reactive query should update the selectedPlaylist
    } catch (err) {
      console.error("onoz! error updating playlist:", err);
      setError("failed to update playlist!");
    }
  };

  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);

      // check if a song from this playlist is currently playing and stop it
      const currentSong = audioState.currentSong();
      if (currentSong && currentSong.playlistId === playlist.id) {
        stop();
      }

      await deletePlaylist(playlist.id);
      setSelectedPlaylist(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error("onoz! error deleting playlist:", err);
      setError("failed to delete playlist!");
    }
  };

  const handleDownloadPlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    setIsDownloading(true);
    try {
      setError(null);
      await downloadPlaylistAsZip(playlist, {
        includeMetadata: true,
        includeImages: true,
        generateM3U: true,
        includeHTML: true,
      });
    } catch (err) {
      console.error("onoz! error downloading playlist:", err);
      setError("failed to download playlist!");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRemoveSong = async (songId: string, onClose?: () => void) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);

      // check if the deleted song is currently playing and stop it
      const currentSong = audioState.currentSong();
      if (currentSong && currentSong.id === songId) {
        stop();
      }

      await removeSongFromPlaylist(playlist.id, songId);

      // close modal if callback provided (e.g. SongEditModal)
      if (onClose) {
        onClose();
      }

      // reactive queries should update the state automatically
    } catch (err) {
      console.error("onoz! error removing song from playlist:", err);
      setError("failed to remove song from playlist!");
    }
  };

  const handleReorderSongs = async (oldIndex: number, newIndex: number) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);
      await reorderSongs(playlist.id as string, oldIndex, newIndex);

      // manually refresh audio queue if this playlist is currently playing
      const currentPlaylist = audioState.currentPlaylist();
      if (currentPlaylist && currentPlaylist.id === playlist.id) {
        // manually create updated playlist with new song order
        const newSongIds = [...playlist.songIds];
        if (oldIndex >= 0 && oldIndex < newSongIds.length) {
          const [movedSong] = newSongIds.splice(oldIndex, 1);
          if (movedSong) {
            newSongIds.splice(newIndex, 0, movedSong);

            const updatedPlaylist = {
              ...playlist,
              songIds: newSongIds,
            };

            await refreshPlaylistQueue(updatedPlaylist);
          }
        }
      }
    } catch (err) {
      console.error("onoz! error reordering songz:", err);
      setError("failed to reorder songz");
    }
  };

  const handleCachePlaylist = async () => {
    const playlist = selectedPlaylist();
    const songs = playlistSongs();
    if (!playlist || songs.length === 0) return;

    setIsCaching(true);
    try {
      setError(null);

      // gotta cache 'em all!
      for (const song of songs) {
        if (song.audioData && song.id) {
          const blob = new Blob([song.audioData], {
            type: song.mimeType || "audio/mpeg",
          });
          const blobUrl = URL.createObjectURL(blob);
          try {
            await cacheAudioFile(blobUrl, song.title || "unknown song");
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }

      setAllSongsCached(true);
    } catch (err) {
      console.error("onoz! error caching playlist:", err);
      setError("failed to cache playlist for offline use!");
    } finally {
      setIsCaching(false);
    }
  };

  onMount(initialize);

  onCleanup(() => {
    if (playlistsQueryUnsubscribe) {
      playlistsQueryUnsubscribe();
    }
    if (songsQueryUnsubscribe) {
      songsQueryUnsubscribe();
    }

    // trash image URLz
    const cache = imageUrlCache();
    cache.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    cache.clear();
  });

  // auto clear error after some time
  createEffect(() => {
    const errorMsg = error();
    if (errorMsg) {
      const timeoutId = setTimeout(() => {
        setError(null);
      }, 10_000);

      onCleanup(() => clearTimeout(timeoutId));
    }
  });

  return {
    playlists,
    selectedPlaylist,
    playlistSongs,
    isInitialized,
    error,
    backgroundImageUrl,
    imageUrlCache,

    // modal and UI state
    showPlaylistCover,
    showImageModal,
    showDeleteConfirm,
    modalImageIndex,
    isDownloading,
    isCaching,
    allSongsCached,

    // setterz
    setSelectedPlaylist,
    setPlaylistSongs,
    setShowPlaylistCover,
    setShowImageModal,
    setShowDeleteConfirm,
    setModalImageIndex,

    // actionz
    initialize,
    createNewPlaylist,
    handleFileDrop,
    selectPlaylist,
    handlePlaylistUpdate,
    handleDeletePlaylist,
    handleDownloadPlaylist,
    handleRemoveSong,
    handleReorderSongs,
    handleCachePlaylist,

    // utilz
    getPlaylistById,
    playlistExists,
    getPlaylistCount,
    searchPlaylists,
  };
}
