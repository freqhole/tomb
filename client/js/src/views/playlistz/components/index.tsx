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
} from "../services/indexedDBService.js";
import {
  cleanup as cleanupAudio,
  playSong,
  togglePlayback,
  audioState,
  refreshPlaylistQueue,
} from "../services/audioService.js";
import { deletePlaylist } from "../services/indexedDBService.js";
import {
  filterAudioFiles,
  processAudioFiles,
} from "../services/fileProcessingService.js";

import { cleanupTimeUtils } from "../utils/timeUtils.js";
import { createImageUrlFromData } from "../services/imageService.js";
import { PlaylistSidebar } from "./PlaylistSidebar.js";
import { SongRow } from "./SongRow.js";
import { SongEditModal } from "./SongEditModal.js";
import { PlaylistCoverModal } from "./PlaylistCoverModal.js";
import {
  addSongToPlaylist,
  removeSongFromPlaylist,
  getAllSongs,
  reorderSongs,
} from "../services/indexedDBService.js";

import type { Playlist } from "../types/playlist.js";

export function Playlistz() {
  // State
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
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

  // Direct signal subscription approach (bypass hook)
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);

  // Create and subscribe to query directly in component
  onMount(() => {
    const playlistQuery = createPlaylistsQuery();
    const unsubscribe = playlistQuery.subscribe((value) => {
      setPlaylists([...value]); // Force new array reference

      // Update selected playlist if it exists in the new data
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

  // Load playlist songs when selected playlist changes
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
        console.error("Error loading playlist songs:", err);
      }
    } else {
      setPlaylistSongs([]);
    }
  });

  // Cache for background image URLs to avoid recreating them
  const [imageUrlCache] = createSignal(new Map<string, string>());

  // Update background image based on currently playing song or selected playlist
  createEffect(() => {
    const currentSong = audioState.currentSong();
    const currentPlaylist = audioState.currentPlaylist();
    const selectedPl = selectedPlaylist();
    const cache = imageUrlCache();

    let newImageUrl: string | null = null;
    let cacheKey: string | null = null;

    // Priority 1: Use song's image if available (when playing)
    if (currentSong?.imageData && currentSong?.imageType) {
      cacheKey = `song-${currentSong.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = createImageUrlFromData(
          currentSong.imageData,
          currentSong.imageType
        );
        cache.set(cacheKey, newImageUrl);
      }
    }
    // Priority 2: Use current playlist's image if song has no image (when playing)
    else if (
      currentSong &&
      currentPlaylist?.imageData &&
      currentPlaylist?.imageType
    ) {
      cacheKey = `playlist-${currentPlaylist.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = createImageUrlFromData(
          currentPlaylist.imageData,
          currentPlaylist.imageType
        );
        cache.set(cacheKey, newImageUrl);
      }
    }
    // Priority 3: Use selected playlist's image (when not playing but playlist selected)
    else if (!currentSong && selectedPl?.imageData && selectedPl?.imageType) {
      cacheKey = `playlist-${selectedPl.id}`;
      if (cache.has(cacheKey)) {
        newImageUrl = cache.get(cacheKey)!;
      } else {
        newImageUrl = createImageUrlFromData(
          selectedPl.imageData,
          selectedPl.imageType
        );
        cache.set(cacheKey, newImageUrl);
      }
    }

    // Only update if URL actually changed
    const prevUrl = backgroundImageUrl();
    if (prevUrl !== newImageUrl) {
      setBackgroundImageUrl(newImageUrl);
    }
  });

  // Auto-clear errors after 5 seconds
  createEffect(() => {
    const errorMessage = error();
    if (errorMessage) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
    return undefined;
  });

  // Initialize database
  onMount(async () => {
    try {
      await setupDB();
      setIsInitialized(true);

      // Set up responsive behavior
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
      });
    } catch (err) {
      console.error("❌ Failed to initialize Playlistz:", err);
      setError(err instanceof Error ? err.message : "failed to initialize");
    }
  });

  // Keyboard event handlers for modals
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

  // Set up global keyboard listeners
  createEffect(() => {
    if (showImageModal() || showDeleteConfirm()) {
      document.addEventListener("keydown", handleKeyDown);
      onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    cleanupAudio();
    cleanupTimeUtils();

    // Clean up all cached background image URLs
    const cache = imageUrlCache();
    cache.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    cache.clear();

    // Clean up current background image URL
    const bgUrl = backgroundImageUrl();
    if (bgUrl && bgUrl.startsWith("blob:")) {
      URL.revokeObjectURL(bgUrl);
    }
  });

  // Enhanced drag type detection
  const detectDragType = (dataTransfer: DataTransfer | null) => {
    if (!dataTransfer) return { type: "unknown", hasAudio: false };

    const items = Array.from(dataTransfer.items || []);
    const files = Array.from(dataTransfer.files || []);

    // Priority 1: Check for song reordering (text/plain data indicates internal drag)
    const hasTextData = items.some((item) => item.type === "text/plain");
    if (hasTextData) {
      return { type: "song-reorder", hasAudio: false };
    }

    // Priority 2: Check for audio files
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
    if (audioFiles.length > 0) {
      return { type: "audio-files", hasAudio: true };
    }

    // Priority 3: Check for other files
    if (files.length > 0) {
      return { type: "non-audio-files", hasAudio: false };
    }

    return { type: "unknown", hasAudio: false };
  };

  // Global drag and drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const dragInfo = detectDragType(e.dataTransfer);

    // Only show drag overlay for actual file drops, not song reordering
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

    // Only hide overlay if leaving the root element
    if (e.target === e.currentTarget) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const dragInfo = detectDragType(e.dataTransfer);

    // Only handle file drops, ignore song reordering
    if (dragInfo.type === "song-reorder") {
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    const audioFiles = filterAudioFiles(files);
    if (audioFiles.length === 0) {
      // Provide contextual error messages
      if (dragInfo.type === "non-audio-files") {
        setError(
          "Only audio files can be added to playlists. Supported formats: MP3, WAV, M4A, FLAC, OGG"
        );
      } else {
        setError("No audio files found in the dropped items");
      }
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      let targetPlaylist = selectedPlaylist();

      // If no playlist is selected, create a new one
      if (!targetPlaylist) {
        targetPlaylist = await createPlaylist({
          title: "new playlist",
          description: `created from ${audioFiles.length} dropped file${audioFiles.length > 1 ? "s" : ""}`,
          songIds: [],
        });
        setSelectedPlaylist(targetPlaylist);
      }

      // Process files and add to playlist
      const results = await processAudioFiles(audioFiles);
      const successfulFiles = results.filter((r) => r.success);

      // Actually add the songs to the playlist in IndexedDB
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

      // Force refresh the selected playlist from database to get updated songIds
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
          `${errorCount} file${errorCount > 1 ? "s" : ""} could not be processed`
        );
      }
    } catch (err) {
      console.error("Error handling dropped files:", err);
      setError("failed to process dropped files");
    }
  };

  // Set up global drag and drop listeners
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

  // Handle creating new playlist
  const handleCreatePlaylist = async () => {
    try {
      const newPlaylist = await createPlaylist({
        title: "new playlist",
        description: "",
        songIds: [],
      });
      setSelectedPlaylist(newPlaylist);

      // Auto-collapse on mobile when playlist is selected
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

  // Handle playlist title/description updates with debouncing
  let saveTimeout: number | undefined;
  const handlePlaylistUpdate = async (updates: Partial<Playlist>) => {
    const current = selectedPlaylist();
    if (!current) return;

    // Update local state immediately for responsive UI
    const updated = { ...current, ...updates };
    setSelectedPlaylist(updated);

    // Debounce database saves
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

  // Audio player functions
  const handlePlaySong = async (song: any) => {
    try {
      // Check if this song is already the current song
      const currentSong = audioState.currentSong();
      if (currentSong?.id === song.id) {
        // If it's the same song, just toggle playback (resume/pause)
        togglePlayback();
      } else {
        // Different song, load and play it
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

      // Update audio queue if this playlist is currently active
      const currentPlaylist = audioState.currentPlaylist();
      if (currentPlaylist && currentPlaylist.id === playlist.id) {
        // Get updated playlist data and refresh queue
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
    // Update local playlist songs state
    setPlaylistSongs((prev) =>
      prev.map((song) => (song.id === updatedSong.id ? updatedSong : song))
    );

    // Force refresh the playlist songs from database
    const playlist = selectedPlaylist();
    if (playlist && playlist.songIds.length > 0) {
      try {
        const allSongs = await getAllSongs();
        const songs = allSongs.filter((song) =>
          playlist.songIds.includes(song.id)
        );
        setPlaylistSongs(songs);
      } catch (err) {
        console.error("Error refreshing songs:", err);
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

      // Refresh playlist to show new order
      const updatedPlaylists = await getAllPlaylists();
      const refreshedPlaylist = updatedPlaylists.find(
        (p) => p.id === playlist.id
      );
      if (refreshedPlaylist) {
        setSelectedPlaylist(refreshedPlaylist);

        // Update audio queue if this playlist is currently active
        const currentPlaylist = audioState.currentPlaylist();
        if (currentPlaylist && currentPlaylist.id === refreshedPlaylist.id) {
          await refreshPlaylistQueue(refreshedPlaylist);
        }
      }
    } catch (err) {
      console.error("❌ Error reordering songs:", err);
      setError("failed to reorder songs");
    }
  };

  const handlePauseSong = () => {
    // Use the new audio service
    togglePlayback();
  };

  // Image modal handlers
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

    // Add playlist image first if it exists
    if (playlist?.imageData && playlist?.imageType) {
      images.push({
        url: createImageUrlFromData(playlist.imageData, playlist.imageType),
        title: playlist.title,
      });
    }

    // Add song images
    playlistSongs().forEach((song) => {
      if (song.imageData && song.imageType) {
        images.push({
          url: createImageUrlFromData(song.imageData, song.imageType),
          title: song.title,
        });
      }
    });

    return images;
  };

  // Delete playlist handler
  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      await deletePlaylist(playlist.id);
      setSelectedPlaylist(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error("❌ Error deleting playlist:", err);
      setError("failed to delete playlist");
    }
  };

  return (
    <div class="relative h-screen bg-black text-white overflow-hidden">
      {/* Dynamic background image */}
      <Show when={backgroundImageUrl()}>
        <div
          class="absolute inset-0 bg-cover bg-top bg-no-repeat transition-opacity duration-1000 ease-out"
          style={{
            "background-image": `url(${backgroundImageUrl()})`,
            filter: "blur(3px) brightness(0.9)",
            "z-index": "0",
          }}
        />
        <div class="absolute inset-0 bg-black/20" style={{ "z-index": "1" }} />
      </Show>

      {/* Background pattern (when no song playing) */}
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

      {/* Loading state or main content */}
      <Show
        when={isInitialized()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-magenta-500 mb-4"></div>
              <p class="text-lg">loading playlistz...</p>
            </div>
          </div>
        }
      >
        {/* Main content with sidebar layout */}
        <div class="relative flex h-full" style={{ "z-index": "2" }}>
          {/* Left Sidebar */}
          <div
            class={`transition-all duration-300 ease-out overflow-hidden ${
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

          {/* Main Content Area */}
          <div
            class={`${isMobile() && !sidebarCollapsed() ? "hidden" : "flex-1"} flex flex-col h-full`}
          >
            <Show when={selectedPlaylist()}>
              {(playlist) => (
                <div
                  class={`flex-1 flex flex-col h-full ${isMobile() ? "p-2" : "p-6"}`}
                >
                  {/* Playlist Header */}
                  <div
                    class={`flex items-center justify-between ${isMobile() ? "p-2" : "mb-2 p-6"}`}
                  >
                    <div class="flex items-center gap-4 w-full">
                      <div class="flex-1">
                        <div class="bg-black bg-opacity-80">
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
                        <div class="mt-2 bg-black bg-opacity-80">
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

                        {/* Metadata row with song count, duration, and action buttons */}
                        <div
                          class={`mt-3 flex justify-between ${isMobile() ? "gap-3" : ""}`}
                        >
                          <div class="flex items-center gap-2">
                            {/* Sidebar Toggle Button (when collapsed) */}
                            <Show when={sidebarCollapsed()}>
                              <button
                                onClick={() => setSidebarCollapsed(false)}
                                class="p-2 text-magenta-200 hover:text-magenta-500 hover:bg-gray-800 transition-colors bg-black bg-opacity-80"
                                title="show playlist sidebar"
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
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </button>
                            </Show>
                            {/* Edit playlist image button */}
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

                            {/* Delete playlist button */}
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
                          </div>

                          <div
                            class={`flex items-center gap-4 text-sm text-magenta-500 bg-black bg-opacity-80 p-2 ${isMobile() ? "flex-wrap justify-center" : ""}`}
                          >
                            <span>
                              {playlist().songIds?.length || 0} song
                              {(playlist().songIds?.length || 0) !== 1
                                ? "s"
                                : ""}
                            </span>
                            <span>
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

                    {/* Playlist Cover Image */}
                    <div class={`${isMobile() ? "ml-2" : "ml-4"}`}>
                      <button
                        onClick={() => {
                          setModalImageIndex(0);
                          setShowImageModal(true);
                        }}
                        class="w-32 h-32 overflow-hidden bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors group"
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
                  </div>

                  {/* Songs List */}
                  <div class="flex-1 overflow-y-auto">
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
                              no songs yet
                            </div>
                            <p class="text-gray-400 mb-4">
                              drag and drop audio files here to add them to this
                              playlist
                            </p>
                            <div class="text-xs text-gray-500 space-y-1">
                              <div>playlist id: {playlist().id}</div>
                              <div>supported formats: mp3, wav, flac, aiff</div>
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

      {/* Global drag overlay */}
      <Show when={isDragOver()}>
        <div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div class="text-center">
            <div class="text-4xl mb-6 font-bold">drop zone</div>
            <h2 class="text-4xl font-light mb-4 text-magenta-400">
              drop your music here
            </h2>
            <p class="text-xl text-gray-300">
              release to add files to{" "}
              {selectedPlaylist()?.title || "a new playlist"}
            </p>
            <div class="mt-6 flex justify-center">
              <div class="px-4 py-2 bg-magenta-500 bg-opacity-20 border-2 border-magenta-500 border-dashed rounded-lg">
                <p class="text-magenta-300">
                  supports mp3, wav, flac, aiff, and more
                </p>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Error notification */}
      <Show when={error()}>
        <div class="fixed top-4 right-4 z-50">
          <div class="bg-red-500 text-white px-6 py-3 rounded-lg shadow-lg max-w-sm">
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

      {/* Modals */}
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

      {/* Image Modal */}
      <Show when={showImageModal()}>
        <div class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
          <button
            onClick={() => setShowImageModal(false)}
            class="fixed top-4 right-4 p-2 text-white hover:text-gray-300 bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full transition-colors z-60"
            title="close (ESC)"
          >
            <svg
              class="w-6 h-6"
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
                  <p class="text-lg mb-2">no images available</p>
                  <p class="text-sm text-gray-400">
                    add a playlist cover or songs with album art
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
                <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white text-center bg-black bg-opacity-50 px-4 py-2 rounded-lg">
                  <div class="text-sm font-medium">{currentImage.title}</div>
                  {images.length > 1 && (
                    <div class="text-xs text-gray-300 mt-1">
                      {modalImageIndex() + 1} of {images.length} (click or use
                      arrow keys to navigate)
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </Show>

      {/* Delete Confirmation Modal */}
      <Show when={showDeleteConfirm()}>
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-gray-800 p-6 rounded-lg border border-gray-600 max-w-md w-full mx-4">
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
