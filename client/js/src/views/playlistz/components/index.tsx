/* @jsxImportSource solid-js */
import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";

import {
  setupDB,
  createPlaylist,
  createPlaylistsQuery,
  updatePlaylist,
  getAllPlaylists,
  deletePlaylist,
  addSongToPlaylist,
  removeSongFromPlaylist,
  getAllSongs,
  reorderSongs,
} from "../services/indexedDBService.js";
import {
  cleanup as cleanupAudio,
  playSong,
  togglePlayback,
  audioState,
  refreshPlaylistQueue,
  selectSong,
} from "../services/audioService.js";
import {
  filterAudioFiles,
  processAudioFiles,
} from "../services/fileProcessingService.js";
import { cleanupTimeUtils } from "../utils/timeUtils.js";
import {
  createImageUrlFromData,
  getImageUrlForContext,
} from "../services/imageService.js";
import {
  downloadPlaylistAsZip,
  parsePlaylistZip,
} from "../services/playlistDownloadService.js";

import { PlaylistSidebar } from "./PlaylistSidebar.js";
import { SongRow } from "./SongRow.js";
import { SongEditModal } from "./SongEditModal.js";
import { PlaylistCoverModal } from "./PlaylistCoverModal.js";
import {
  initializeStandalonePlaylist,
  standaloneLoadingProgress,
  clearStandaloneLoadingProgress,
  loadStandaloneSongAudioData,
  songNeedsAudioData,
  setStandaloneLoadingProgress,
} from "../services/standaloneService.js";
import {
  initializeOfflineSupport,
  cacheAudioFile,
  updatePWAManifest,
} from "../services/offlineService.js";

import type { Playlist } from "../types/playlist.js";

// global fn registration for standalone mode
if ((window as any).STANDALONE_MODE) {
  // define the fn early so it's available for HTML initialization
  (window as any).initializeStandalonePlaylist = function (playlistData: any) {
    // store the data and defer to the real function when it's ready
    (window as any).DEFERRED_PLAYLIST_DATA = playlistData;
  };
}

export function Playlistz() {
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    (window as any).STANDALONE_MODE || false
  );
  const [isMobile, setIsMobile] = createSignal(false);
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<
    string | null
  >(null);

  const [editingSong, setEditingSong] = createSignal<any | null>(null);
  const [showPlaylistCover, setShowPlaylistCover] = createSignal(false);
  const [showImageModal, setShowImageModal] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [playlistSongs, setPlaylistSongs] = createSignal<any[]>([]);
  const [modalImageIndex, setModalImageIndex] = createSignal(0);
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [isCaching, setIsCaching] = createSignal(false);
  const [allSongsCached, setAllSongsCached] = createSignal(false);

  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

  // create and subscribe to query directly in component
  onMount(() => {
    const playlistQuery = createPlaylistsQuery();
    const unsubscribe = playlistQuery.subscribe((value) => {
      setPlaylists([...value]); // force new array reference

      // update selected playlist if it existz in the new data
      const current = selectedPlaylist();
      if (current) {
        const updated = value.find((p) => p.id === current.id);
        if (
          updated &&
          JSON.stringify(updated.songIds) !== JSON.stringify(current.songIds)
        ) {
          setSelectedPlaylist(updated);
        }
      }
    });

    onCleanup(unsubscribe);
  });

  // load playlist songz when selected playlist changez
  createEffect(async () => {
    const playlist = selectedPlaylist();
    if (playlist && playlist.songIds.length > 0) {
      try {
        const allSongs = await getAllSongs();
        const songs = allSongs.filter((song) =>
          playlist.songIds.includes(song.id)
        );
        setPlaylistSongs(songs);
      } catch (err) {
        console.error("error loading playlist songz:", err);
      }
    } else {
      setPlaylistSongs([]);
    }
  });

  // cache for background image URLz to avoid recreating them
  const [imageUrlCache] = createSignal(new Map<string, string>());

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
        newImageUrl = getImageUrlForContext(
          currentSong.thumbnailData,
          currentSong.imageData,
          currentSong.imageType,
          "background"
        );
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
        newImageUrl = getImageUrlForContext(
          currentPlaylist.thumbnailData,
          currentPlaylist.imageData,
          currentPlaylist.imageType,
          "background"
        );
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
        newImageUrl = getImageUrlForContext(
          selectedPl.thumbnailData,
          selectedPl.imageData,
          selectedPl.imageType,
          "background"
        );
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

  // auto-clear errorz after 5 secondz, i guess.
  createEffect(() => {
    const errorMessage = error();
    if (errorMessage) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  });

  onMount(async () => {
    // init standalone mode function immediately
    (window as any).initializeStandalonePlaylist = (playlistData: any) => {
      initializeStandalonePlaylist(playlistData, {
        setSelectedPlaylist,
        setPlaylistSongs,
        setSidebarCollapsed,
        setError,
      });
    };

    // check if deferred data from early initialization
    if ((window as any).DEFERRED_PLAYLIST_DATA) {
      await initializeStandalonePlaylist(
        (window as any).DEFERRED_PLAYLIST_DATA,
        {
          setSelectedPlaylist,
          setPlaylistSongs,
          setSidebarCollapsed,
          setError,
        }
      );
      delete (window as any).DEFERRED_PLAYLIST_DATA;
    }

    try {
      await setupDB();

      // try to init offline support
      try {
        const currentPlaylist = selectedPlaylist();
        await initializeOfflineSupport(currentPlaylist?.title);
      } catch (offlineError) {
        console.warn("offline support initialization failed:", offlineError);
      }

      setIsInitialized(true);

      // responsive shit
      const checkMobile = () => {
        const mobile = window.innerWidth < 900;
        setIsMobile(mobile);
        if (mobile && selectedPlaylist()) {
          setSidebarCollapsed(true);
        }
      };

      checkMobile();
      window.addEventListener("resize", checkMobile);

      onCleanup(() => {
        window.removeEventListener("resize", checkMobile);
        clearStandaloneLoadingProgress();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to initialize");
    }
  });

  // update PWA manifest when playlist changez
  createEffect(() => {
    const playlist = selectedPlaylist();
    if (playlist) {
      updatePWAManifest(playlist.title);
    }
  });

  // keyboard event handlerz for modalz
  const handleKeyDown = (e: KeyboardEvent) => {
    if (showImageModal()) {
      if (e.key === "Escape") {
        setShowImageModal(false);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevImage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNextImage();
      }
    } else if (showDeleteConfirm() && e.key === "Escape") {
      setShowDeleteConfirm(false);
    }
  };

  // set up global keyboard listener
  createEffect(() => {
    if (showImageModal() || showDeleteConfirm()) {
      document.addEventListener("keydown", handleKeyDown);
      onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
    }
  });

  // unmount stuff, i guess.
  onCleanup(() => {
    cleanupAudio();
    cleanupTimeUtils();

    // purge all cached background image URLs
    const cache = imageUrlCache();
    cache.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    cache.clear();

    // purge current background image URL
    const bgUrl = backgroundImageUrl();
    if (bgUrl && bgUrl.startsWith("blob:")) {
      URL.revokeObjectURL(bgUrl);
    }
  });

  // get a better drag!
  const detectDragType = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return { type: "unknown", hasAudio: false };

    const items = Array.from(dataTransfer.items || []);
    const files = Array.from(dataTransfer.files || []);

    // priority 1: check for song reordering (text/plain data indicates internal drag)
    const hasTextData = items.some((item) => item.type === "text/plain");
    if (hasTextData) {
      return { type: "song-reorder", hasAudio: false };
    }

    // priority 2: Check for audio filez
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
    if (audioFiles.length > 0) {
      return { type: "audio-files", hasAudio: true };
    }

    // priority 3: check for other filez
    if (files.length > 0) {
      return { type: "non-audio-files", hasAudio: false };
    }

    return { type: "unknown", hasAudio: false };
  };

  // global drag'n'drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dragInfo = detectDragType(e.dataTransfer);

    // only show drag overlay for actual file drops, not song reordering
    if (dragInfo.type === "audio-files") {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // only hide overlay if leaving the root element
    if (e.target === e.currentTarget) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const dragInfo = detectDragType(e.dataTransfer);

    // only handle file dropz, ignore song reordering
    if (dragInfo.type === "song-reorder") {
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    // check for ZIP files first
    const zipFiles = Array.from(files).filter(
      (file) =>
        file.type === "application/zip" ||
        file.name.toLowerCase().endsWith(".zip")
    );

    if (zipFiles.length > 0) {
      // handle ZIP file upload
      try {
        for (const zipFile of zipFiles) {
          const { playlist: playlistData, songs: songsData } =
            await parsePlaylistZip(zipFile);

          // check if a playlist with the same name and songz already existz
          const existingPlaylist = playlists().find(
            (p) =>
              p.title === playlistData.title &&
              p.songIds.length === songsData.length
          );

          if (existingPlaylist) {
            setError(`playlist "${playlistData.title}" already existz`);
            setTimeout(() => setError(null), 3000);
            continue;
          }

          // create new playlist
          const newPlaylist = await createPlaylist(playlistData);

          // add songs to the playlist
          for (const songData of songsData) {
            // create a File object from the audio data for compatibility
            const audioBlob = new Blob([songData.audioData!], {
              type: songData.mimeType,
            });
            const audioFile = new File(
              [audioBlob],
              songData.originalFilename ||
                `${songData.artist} - ${songData.title}`,
              { type: songData.mimeType }
            );

            await addSongToPlaylist(newPlaylist.id, audioFile, {
              title: songData.title,
              artist: songData.artist,
              album: songData.album,
              duration: songData.duration,
              imageData: songData.imageData,
              imageType: songData.imageType,
            });
          }

          // select the newly created playlist
          setSelectedPlaylist(newPlaylist);
        }
        return;
      } catch (err) {
        console.error("error processing ZIP file:", err);
        setError("failed to import playlist from ZIP file");
        setTimeout(() => setError(null), 3000);
        return;
      }
    }

    const audioFiles = filterAudioFiles(files);
    if (audioFiles.length === 0) {
      // provide contextual error messages
      if (dragInfo.type === "non-audio-files") {
        setError(
          "only audio filez and ZIP playlist filez can be added. supported formatz: MP3, WAV, M4A, FLAC, OGG, ZIP"
        );
      } else {
        setError(
          "no audio filez or ZIP playlist filez found in the dropped item(z)"
        );
      }
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      let targetPlaylist = selectedPlaylist();

      // if no playlist is selected, create a new one!
      if (!targetPlaylist) {
        targetPlaylist = await createPlaylist({
          title: "new playlist",
          description: `created from ${audioFiles.length} dropped file${audioFiles.length > 1 ? "z" : ""}`,
          songIds: [],
        });
        setSelectedPlaylist(targetPlaylist);
      }

      // process files and add to playlist
      const results = await processAudioFiles(audioFiles);
      const successfulFiles = results.filter((r) => r.success);

      // add the songs to the playlist in idb
      for (const result of successfulFiles) {
        if (result.song) {
          await addSongToPlaylist(targetPlaylist.id, result.song.file!, {
            title: result.song.title,
            artist: result.song.artist,
            album: result.song.album,
            duration: result.song.duration,
            imageData: result.song.imageData,
            imageType: result.song.imageType,
          });
        }
      }

      // force refresh the selected playlist from idb to get updated songIdz
      const updatedPlaylists = playlists();
      const refreshedPlaylist = updatedPlaylists.find(
        (p) => p.id === targetPlaylist.id
      );
      if (refreshedPlaylist) {
        setSelectedPlaylist(refreshedPlaylist);
      }

      if (results.some((r) => !r.success)) {
        const errorCount = results.filter((r) => !r.success).length;
        setError(
          `${errorCount} file${errorCount > 1 ? "z" : ""} could not be processed`
        );
      }
    } catch (err) {
      console.error("Error handling dropped files:", err);
      setError("failed to process dropped files");
    }
  };

  // global drag'n'drop listenerz
  createEffect(() => {
    if (!isInitialized()) return;

    const root = document.documentElement;

    root.addEventListener("dragenter", handleDragEnter);
    root.addEventListener("dragover", handleDragOver);
    root.addEventListener("dragleave", handleDragLeave);
    root.addEventListener("drop", handleDrop);

    onCleanup(() => {
      root.removeEventListener("dragenter", handleDragEnter);
      root.removeEventListener("dragover", handleDragOver);
      root.removeEventListener("dragleave", handleDragLeave);
      root.removeEventListener("drop", handleDrop);
    });
  });

  // handle creating new playlist
  const handleCreatePlaylist = async () => {
    try {
      const newPlaylist = await createPlaylist({
        title: "new playlist",
        description: "",
        songIds: [],
      });
      setSelectedPlaylist(newPlaylist);

      // collapse on mobile when playlist is selected
      if (isMobile()) {
        setSidebarCollapsed(true);
      }
    } catch (err) {
      console.error("❌ Error creating playlist:", err);
      setError(
        err instanceof Error ? err.message : "failed to create playlist"
      );
    }
  };

  // handle playlist title/description updatez with debouncing
  let saveTimeout: number | undefined;
  const handlePlaylistUpdate = async (updates: Partial<Playlist>) => {
    const current = selectedPlaylist();
    if (!current) return;

    // update local state immediately
    const updated = { ...current, ...updates };
    setSelectedPlaylist(updated);

    // debounce database save(z)
    clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(async () => {
      try {
        await updatePlaylist(current.id, updates);
      } catch (err) {
        console.error("❌ Failed to save playlist:", err);
        setError("failed to save changes");
      }
    }, 1000);
  };

  // audio player fnz
  const handlePlaySong = async (song: any) => {
    try {
      // so check if this song is already the current song
      const currentSong = audioState.currentSong();
      if (currentSong?.id === song.id) {
        // if it's the same song, just toggle playback (resume/pause)
        togglePlayback();
      } else {
        // different song - immediately select it for UI feedback, then load
        selectSong(song.id);

        const currentPlaylist = selectedPlaylist();
        if (currentPlaylist) {
          await playSong(song, currentPlaylist);
        } else {
          await playSong(song);
        }
      }
    } catch (err) {
      console.error("❌ Error playing song:", err);
      setError("failed to play song");
    }
  };

  const handleRemoveSong = async (songId: string) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await removeSongFromPlaylist(playlist.id, songId);

      // update audio queue if this playlist is currently active
      const currentPlaylist = audioState.currentPlaylist();
      if (currentPlaylist && currentPlaylist.id === playlist.id) {
        // get updated playlist data and refresh queue
        const updatedPlaylists = await getAllPlaylists();
        const refreshedPlaylist = updatedPlaylists.find(
          (p) => p.id === playlist.id
        );
        if (refreshedPlaylist) {
          await refreshPlaylistQueue(refreshedPlaylist);
        }
      }
    } catch (err) {
      console.error("❌ Error removing song:", err);
      setError("failed to remove song");
    }
  };

  const handleEditSong = async (song: any) => {
    setEditingSong(song);
  };

  const handleSongSaved = async (updatedSong: any) => {
    // update local playlist songz state
    setPlaylistSongs((prev) =>
      prev.map((song) => (song.id === updatedSong.id ? updatedSong : song))
    );

    // force refresh the playlist songz from idb
    const playlist = selectedPlaylist();
    if (playlist && playlist.songIds.length > 0) {
      try {
        const allSongs = await getAllSongs();
        const songs = allSongs.filter((song) =>
          playlist.songIds.includes(song.id)
        );
        setPlaylistSongs(songs);
      } catch (err) {
        console.error("error refreshing songs:", err);
      }
    }
  };

  const handlePlaylistCoverSaved = (updatedPlaylist: any) => {
    setSelectedPlaylist(updatedPlaylist);
  };

  const handleReorderSongs = async (fromIndex: number, toIndex: number) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await reorderSongs(playlist.id, fromIndex, toIndex);

      // refresh playlist to show new order
      const updatedPlaylists = await getAllPlaylists();
      const refreshedPlaylist = updatedPlaylists.find(
        (p) => p.id === playlist.id
      );
      if (refreshedPlaylist) {
        setSelectedPlaylist(refreshedPlaylist);

        // update audio queue if this playlist is currently active
        const currentPlaylist = audioState.currentPlaylist();
        if (currentPlaylist && currentPlaylist.id === refreshedPlaylist.id) {
          await refreshPlaylistQueue(refreshedPlaylist);
        }
      }
    } catch (err) {
      console.error("error reordering songs:", err);
      setError("failed to reorder songz");
    }
  };

  const handlePauseSong = () => {
    // use the audio service
    togglePlayback();
  };

  // image modal handlerz
  const handleNextImage = () => {
    const images = getModalImages();
    if (images.length > 0) {
      setModalImageIndex((prev) => (prev + 1) % images.length);
    }
  };

  const handlePrevImage = () => {
    const images = getModalImages();
    if (images.length > 0) {
      setModalImageIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  const getModalImages = () => {
    const playlist = selectedPlaylist();
    const images: { url: string; title: string }[] = [];

    // add playlist image first if it existz
    if (playlist?.imageType) {
      const url = getImageUrlForContext(
        playlist.thumbnailData,
        playlist.imageData,
        playlist.imageType,
        "modal"
      );
      if (url) {
        images.push({
          url,
          title: playlist.title,
        });
      }
    }

    // add song imagez
    playlistSongs().forEach((song) => {
      if (song.imageType) {
        const url = getImageUrlForContext(
          song.thumbnailData,
          song.imageData,
          song.imageType,
          "modal"
        );
        if (url) {
          images.push({
            url,
            title: song.title,
          });
        }
      }
    });

    return images;
  };

  // delete playlist handler
  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await deletePlaylist(playlist.id);
      setSelectedPlaylist(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error("rrror deleting playlist:", err);
      setError("failed to delete playlist");
    }
  };

  // download playlist handler
  const handleDownloadPlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    setIsDownloading(true);
    try {
      await downloadPlaylistAsZip(playlist, {
        includeMetadata: true,
        includeImages: true,
        generateM3U: true,
        includeHTML: true,
      });
    } catch (err) {
      setError("failed to download playlist");
    } finally {
      setIsDownloading(false);
    }
  };

  // refresh playlist songs from database
  const refreshPlaylistSongs = async () => {
    const playlist = selectedPlaylist();
    if (playlist && playlist.songIds.length > 0) {
      try {
        const allSongs = await getAllSongs();
        const songs = allSongs.filter((song) =>
          playlist.songIds.includes(song.id)
        );
        setPlaylistSongs(songs);
      } catch (err) {
        console.error("Error refreshing playlist songs:", err);
      }
    }
  };

  // check if all songs are cached
  const checkAllSongsCached = async () => {
    const songs = playlistSongs();
    if (songs.length === 0) {
      setAllSongsCached(false);
      return;
    }

    // for file:// protocol, consider all songs as "cached" since they work directly
    if (window.location.protocol === "file:") {
      setAllSongsCached(true);
      return;
    }

    // check each song to see if it needs audio data
    let allCached = true;
    for (const song of songs) {
      const needsData = await songNeedsAudioData(song);
      if (needsData) {
        allCached = false;
        break;
      }
    }
    setAllSongsCached(allCached);
  };

  // check cache status when playlist songs change
  createEffect(() => {
    const songs = playlistSongs();
    if (songs.length > 0) {
      checkAllSongsCached();
    }
  });

  // cache playlist for offline use
  const handleCachePlaylist = async () => {
    const playlist = selectedPlaylist();
    const songs = playlistSongs();
    if (!playlist || songs.length === 0) return;

    setIsCaching(true);

    // show loading progress
    setStandaloneLoadingProgress({
      current: 0,
      total: songs.length,
      currentSong: "preparing...",
      phase: "checking",
    });

    try {
      let cached = 0;
      let failed = 0;
      let loaded = 0;
      const totalSongs = songs.length;

      for (let i = 0; i < songs.length; i++) {
        const song = songs[i];

        // update progress
        setStandaloneLoadingProgress({
          current: i + 1,
          total: totalSongs,
          currentSong: song.title,
          phase: "updating",
        });

        // first, check if this is a standalone song that needs audio data loading
        if (await songNeedsAudioData(song)) {
          try {
            const loadSuccess = await loadStandaloneSongAudioData(song.id);
            if (loadSuccess) {
              loaded++;
              cached++; // in standalone mode, loading IS caching
            } else {
              failed++;
              continue;
            }
          } catch (error) {
            failed++;
            continue;
          }
        } else {
          // song already has audio data cached
          cached++;
        }

        // for service worker caching (when not in standalone mode)
        if (!(window as any).STANDALONE_MODE) {
          if (song.blobUrl) {
            try {
              await cacheAudioFile(song.blobUrl, song.title);
            } catch (error) {
              // service worker caching failed, but we still count as cached in IndexedDB
            }
          } else if (song.audioData) {
            try {
              const blob = new Blob([song.audioData], {
                type: song.mimeType || "audio/mpeg",
              });
              const blobUrl = URL.createObjectURL(blob);
              await cacheAudioFile(blobUrl, song.title);
              URL.revokeObjectURL(blobUrl);
            } catch (error) {
              // service worker caching failed, but we still count as cached in IndexedDB 🤷
            }
          }
        }
      }

      // refresh the playlist to show updated audio data
      if (loaded > 0) {
        await refreshPlaylistSongs();
        // recheck cache status after refresh
        await checkAllSongsCached();
      }

      if (failed > 0 && cached === 0) {
        setError(
          `failed to cache any songz for offline use (${failed} of ${totalSongs} failed)`
        );
      } else if (failed > 0) {
        console.warn(
          `cached ${cached} of ${totalSongs} songz (${failed} failed)`
        );
      } else if (cached > 0) {
        // songz were cached successfully
      }
    } catch (err) {
      setError("failed to cache playlist for offline use");
    } finally {
      setIsCaching(false);
      // clear loading progress
      setTimeout(() => setStandaloneLoadingProgress(null), 500);
    }
  };

  return (
    <div
      class={`relative bg-black text-white ${isMobile() ? "min-h-screen" : "h-screen overflow-hidden"}`}
    >
      {/* background image cover */}
      <Show when={backgroundImageUrl()}>
        <div
          class="absolute inset-0 bg-cover bg-top bg-no-repeat transition-opacity duration-1000 ease-out"
          style={{
            "background-image": `url(${backgroundImageUrl()})`,
            filter: "blur(3px) contrast(3) brightness(0.4)",
            "z-index": "0",
          }}
        />
        <div class="absolute inset-0 bg-black/20" style={{ "z-index": "1" }} />
      </Show>

      {/* background pattern (when no song playing) */}
      <Show when={!backgroundImageUrl()}>
        <div
          class="absolute inset-0 opacity-5"
          style={{
            "background-image":
              "radial-gradient(circle at 25% 25%, #ff00ff 2px, transparent 2px)",
            "background-size": "50px 50px",
            "z-index": "0",
          }}
        />
      </Show>

      {/* standalone loading progress (strip at the bottom) */}
      <Show when={standaloneLoadingProgress()}>
        <div
          class="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700 p-3"
          style={{ "z-index": "9999" }}
        >
          <div class="max-w-4xl mx-auto">
            <div class="flex items-center gap-4">
              <div class="w-1/2">
                <div class="flex items-center justify-between text-xs text-gray-300 mb-1">
                  <span>{standaloneLoadingProgress()!.phase}</span>
                  <span>
                    {standaloneLoadingProgress()!.current} /{" "}
                    {standaloneLoadingProgress()!.total}
                  </span>
                </div>
                <div class="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    class="bg-magenta-500 h-1.5 rounded-full transition-all duration-300"
                    style={{
                      width: `${
                        (standaloneLoadingProgress()!.current /
                          standaloneLoadingProgress()!.total) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>
              <div class="text-right min-w-0 flex-1">
                <div class="text-xs text-gray-300 truncate max-w-48">
                  {standaloneLoadingProgress()!.currentSong}
                </div>
                <div class="text-xs text-gray-500">
                  {standaloneLoadingProgress()!.phase === "initializing"
                    ? "loading..."
                    : "updating..."}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* loading state or main content */}
      <Show
        when={isInitialized()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 mb-4"></div>
              <p class="text-lg">loading playlistz...</p>
            </div>
          </div>
        }
      >
        {/* main content wrapper with sidebar layout */}
        <div
          class={`relative flex ${isMobile() ? "min-h-screen" : "h-full"}`}
          style={{ "z-index": "2" }}
        >
          {/* left side nav */}
          <div
            class={`transition-all duration-300 ease-out ${isMobile() ? "" : "overflow-hidden"} ${
              sidebarCollapsed()
                ? "w-0 opacity-0"
                : isMobile()
                  ? "w-full opacity-100"
                  : "w-80 opacity-100"
            }`}
          >
            <div
              class={`${isMobile() ? "w-full" : "w-80"} h-full transform transition-transform duration-300 ease-out ${
                sidebarCollapsed() ? "-translate-x-full" : "translate-x-0"
              }`}
            >
              <PlaylistSidebar
                playlists={playlists()}
                selectedPlaylist={selectedPlaylist()}
                onPlaylistSelect={(playlist) => {
                  setSelectedPlaylist(playlist);
                  // Auto-collapse on mobile when playlist is selected
                  if (isMobile()) {
                    setSidebarCollapsed(true);
                  }
                }}
                onCreatePlaylist={handleCreatePlaylist}
                isLoading={false}
                onCollapse={() => setSidebarCollapsed(true)}
                collapsed={sidebarCollapsed()}
                isMobile={isMobile()}
              />
            </div>
          </div>

          {/* main playlist content */}
          <div
            class={`${isMobile() && !sidebarCollapsed() ? "hidden" : "flex-1"} flex flex-col ${isMobile() ? "" : "h-full"}`}
          >
            <Show when={selectedPlaylist()}>
              {(playlist) => (
                <div
                  class={`flex-1 flex flex-col ${isMobile() ? "p-2" : "h-full p-6"}`}
                >
                  {/* Playlist Header */}
                  <div
                    class={`flex items-center justify-between ${isMobile() ? "p-2 flex-col" : "mb-2 p-6"}`}
                  >
                    {/* playlist cover image for mobile */}
                    <div class={`${isMobile() ? "" : "hidden"}`}>
                      <button
                        onClick={() => {
                          setModalImageIndex(0);
                          setShowImageModal(true);
                        }}
                        class="w-full h-full overflow-hidden hover:bg-gray-900 flex items-center justify-center transition-colors group"
                        title="view playlist images"
                      >
                        <Show
                          when={playlist().imageData && playlist().imageType}
                          fallback={
                            <div class="text-center">
                              <svg
                                width="100"
                                height="100"
                                viewBox="0 0 100 100"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M50 81L25 31L75 31L60.7222 68.1429L50 81Z"
                                  fill="#FF00FF"
                                />
                              </svg>
                            </div>
                          }
                        >
                          <img
                            src={createImageUrlFromData(
                              playlist().imageData!,
                              playlist().imageType!
                            )}
                            alt="playlist cover"
                            class="w-full h-full object-cover"
                          />
                        </Show>
                      </button>
                    </div>

                    <div class="flex items-center gap-4 w-full">
                      <div class="flex-1">
                        <div class={`bg-black bg-opacity-80`}>
                          <input
                            type="text"
                            value={playlist().title}
                            onInput={(e) => {
                              handlePlaylistUpdate({
                                title: e.currentTarget.value,
                              });
                            }}
                            class="text-3xl font-bold text-white bg-transparent border-none outline-none focus:bg-gray-800 px-2 py-1 rounded w-full"
                            placeholder="playlist title"
                          />
                        </div>
                        <div class={`mt-2 bg-black bg-opacity-80`}>
                          <input
                            type="text"
                            value={playlist().description || ""}
                            placeholder="add description..."
                            onInput={(e) => {
                              handlePlaylistUpdate({
                                description: e.currentTarget.value,
                              });
                            }}
                            class="text-white bg-transparent border-none focus:bg-gray-800 px-2 py-1 rounded w-full"
                          />
                        </div>

                        {/* metadata row with song count, duration, and action buttonz */}
                        <div
                          class={`mt-3 flex justify-between ${isMobile() ? "gap-3" : ""}`}
                        >
                          <div class="flex items-center gap-2">
                            {/* edit playlist image button */}
                            <button
                              onClick={() => setShowPlaylistCover(true)}
                              class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors bg-black bg-opacity-80"
                              title="change playlist cover"
                            >
                              <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>

                            {/* download playlist .zip button */}
                            <Show when={window.location.protocol !== "file:"}>
                              <button
                                onClick={handleDownloadPlaylist}
                                disabled={isDownloading()}
                                class="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="download playlist as zip"
                              >
                                <Show
                                  when={!isDownloading()}
                                  fallback={
                                    <svg
                                      class="w-4 h-4 animate-spin"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                      />
                                    </svg>
                                  }
                                >
                                  <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      stroke-width="2"
                                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                                    />
                                  </svg>
                                </Show>
                              </button>
                            </Show>

                            {/* delete playlist button */}
                            <button
                              onClick={() => setShowDeleteConfirm(true)}
                              class="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80"
                              title="delete playlist"
                            >
                              <svg
                                class="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>

                            {/* save offline button */}
                            <Show
                              when={
                                (window as any).STANDALONE_MODE &&
                                window.location.protocol !== "file:"
                              }
                            >
                              <Show when={!allSongsCached()}>
                                <button
                                  onClick={handleCachePlaylist}
                                  disabled={
                                    isCaching() || playlistSongs().length === 0
                                  }
                                  class="ml-4 p-2 text-gray-400 hover:text-magenta-400 hover:bg-gray-700 transition-colors bg-black bg-opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="download songz for offline use"
                                >
                                  <Show
                                    when={!isCaching()}
                                    fallback={
                                      <svg
                                        class="w-4 h-4 animate-spin"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="2"
                                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                        />
                                      </svg>
                                    }
                                  >
                                    SAVE OFFLINE
                                  </Show>
                                </button>
                              </Show>
                            </Show>
                          </div>

                          <div
                            class={`flex items-center text-sm ${isMobile() ? "flex-wrap justify-end" : ""}`}
                          >
                            <span class="bg-black bg-opacity-80 p-2">
                              {playlist().songIds?.length || 0} song
                              {(playlist().songIds?.length || 0) !== 1
                                ? "z"
                                : ""}
                            </span>
                            <span class="bg-black bg-opacity-80 p-2">
                              {(() => {
                                const totalSeconds = playlistSongs().reduce(
                                  (total, song) => total + (song.duration || 0),
                                  0
                                );
                                const hours = Math.floor(totalSeconds / 3600);
                                const minutes = Math.floor(
                                  (totalSeconds % 3600) / 60
                                );
                                const seconds = Math.floor(totalSeconds % 60);
                                return hours > 0
                                  ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
                                  : `${minutes}:${seconds.toString().padStart(2, "0")}`;
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* playlist cover image */}
                    <div class={`${isMobile() ? "hidden" : "ml-4"}`}>
                      <button
                        onClick={() => {
                          setModalImageIndex(0);
                          setShowImageModal(true);
                        }}
                        class="w-32 h-32 overflow-hidden hover:bg-gray-900 flex items-center justify-center transition-colors group"
                        title="view playlist imagez"
                      >
                        <Show
                          when={playlist().imageData && playlist().imageType}
                          fallback={
                            <div class="text-center">
                              <svg
                                width="100"
                                height="100"
                                viewBox="0 0 100 100"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M50 81L25 31L75 31L60.7222 68.1429L50 81Z"
                                  fill="#FF00FF"
                                />
                              </svg>
                            </div>
                          }
                        >
                          <img
                            src={createImageUrlFromData(
                              playlist().imageData!,
                              playlist().imageType!
                            )}
                            alt="playlist cover"
                            class="w-full h-full object-cover"
                          />
                        </Show>
                      </button>
                    </div>
                  </div>

                  {/* songz list */}
                  <div
                    class={`${isMobile() ? "flex-1" : "flex-1 overflow-y-auto"}`}
                  >
                    <div
                      class={`${isMobile() ? "space-y-1" : "p-6 space-y-2"}`}
                    >
                      <Show
                        when={
                          playlist().songIds && playlist().songIds.length > 0
                        }
                        fallback={
                          <div class="text-center py-16">
                            <div class="text-gray-400 text-xl mb-4">
                              no songz yet
                            </div>
                            <p class="text-gray-400 mb-4">
                              drag and drop audio filez (or a .zip file!) here
                              to add them to this playlist
                            </p>
                            <div class="text-xs text-gray-500 space-y-1">
                              <div>playlist id: {playlist().id}</div>
                              <div>
                                supported formatz: mp3, wav, flac, aiff, ogg,
                                mp4
                              </div>
                            </div>
                          </div>
                        }
                      >
                        <For each={playlist().songIds}>
                          {(songId, index) => (
                            <SongRow
                              songId={songId}
                              index={index()}
                              showRemoveButton={true}
                              onRemove={handleRemoveSong}
                              onPlay={handlePlaySong}
                              onPause={handlePauseSong}
                              onEdit={handleEditSong}
                              onReorder={handleReorderSongs}
                            />
                          )}
                        </For>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>

      {/* sidebar toggle button */}
      <div
        class={`fixed "top-0" inset-0 bg-black bg-opacity-80 flex items-center justify-center z-10 transition-all duration-300 ease-in-out w-10 h-10 ${sidebarCollapsed() ? "left-0" : isMobile() ? "left-[calc(100vw-40px)]" : "left-72"}`}
      >
        <button
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          class="p-2 text-magenta-200 hover:text-magenta-500 hover:bg-gray-800 transition-colors bg-black bg-opacity-80"
          title={`${sidebarCollapsed() ? "show" : "hide"} playlist sidebar`}
        >
          <svg
            class={`w-8 h-8 transform transition-transform duration-600 ease-in-out ${sidebarCollapsed() ? "rotate-0" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* drag'n'drop overlay */}
      <Show when={isDragOver()}>
        <div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div class="text-center">
            <div class="text-4xl mb-6 font-bold">drop zone</div>
            <h2 class="text-4xl font-light mb-4 text-magenta-400">
              drop your filez here
            </h2>
            <p class="text-xl text-gray-300">
              release to add filez to{" "}
              {selectedPlaylist()?.title || "a new playlist"}
            </p>
          </div>
        </div>
      </Show>

      {/* error notificationz */}
      <Show when={error()}>
        <div class="fixed top-4 right-4 z-50">
          <div class="bg-red-500 text-white px-6 py-3 shadow-lg max-w-sm">
            <div class="flex items-center">
              <div class="flex-shrink-0">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
              <div class="ml-3">
                <p class="text-sm font-medium">{error()}</p>
              </div>
              <div class="ml-4 flex-shrink-0">
                <button
                  onClick={() => setError(null)}
                  class="text-white hover:text-gray-200 focus:outline-none"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* modalz */}
      <Show when={editingSong()}>
        <SongEditModal
          song={editingSong()!}
          isOpen={!!editingSong()}
          onClose={() => setEditingSong(null)}
          onSave={handleSongSaved}
        />
      </Show>

      <Show when={showPlaylistCover()}>
        <PlaylistCoverModal
          playlist={selectedPlaylist()!}
          playlistSongs={playlistSongs()}
          isOpen={showPlaylistCover()}
          onClose={() => setShowPlaylistCover(false)}
          onSave={handlePlaylistCoverSaved}
        />
      </Show>

      {/* image carousel modal */}
      <Show when={showImageModal()}>
        <div class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
          <button
            onClick={() => setShowImageModal(false)}
            class="absolute top-6 right-4 z-51 hover:text-magenta-500"
            title="close (ESC)"
          >
            <svg
              class="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          {(() => {
            const images = getModalImages();
            const currentImage = images[modalImageIndex()];

            if (!currentImage) {
              return (
                <div class="text-white text-center">
                  <p class="text-lg mb-2">no imagez available</p>
                  <p class="text-sm text-gray-400">
                    add a playlist cover or songz with album art
                  </p>
                </div>
              );
            }

            return (
              <div class="relative w-full h-full flex items-center justify-center p-4">
                <button
                  onClick={handleNextImage}
                  class="absolute inset-0 cursor-pointer z-50"
                  title="next image"
                />
                <img
                  src={currentImage.url}
                  alt={currentImage.title}
                  class="w-full h-full object-contain pointer-events-none"
                />
                <div class="absolute top-4 right-16 text-white text-center bg-black bg-opacity-50 p-3">
                  <div class="text-sm font-medium">
                    {currentImage.title}{" "}
                    {images.length > 1 && (
                      <span class="text-xs text-gray-300 mt-1">
                        ({modalImageIndex() + 1} of {images.length})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </Show>

      {/* delete confirmation modal */}
      <Show when={showDeleteConfirm()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-gray-800 p-6 border border-gray-600 max-w-md w-full mx-4">
            <h3 class="text-lg font-semibold text-white mb-4">
              delete playlist
            </h3>
            <p class="text-gray-300 mb-6">
              are you sure you want to delete "{selectedPlaylist()?.title}"? no
              take-backz!
            </p>
            <div class="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                class="px-4 py-2 text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                cancel
              </button>
              <button
                onClick={handleDeletePlaylist}
                class="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
              >
                delete
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
