/* @jsxImportSource solid-js */
import { createSignal, createEffect, onCleanup } from "solid-js";
import type { Playlist, Song } from "../types/playlist.js";
import {
  updatePlaylist,
  deletePlaylist,
  getAllSongs,
  removeSongFromPlaylist,
  reorderSongs,
} from "../services/indexedDBService.js";
import { downloadPlaylistAsZip } from "../services/playlistDownloadService.js";
import { cacheAudioFile } from "../services/offlineService.js";

export function usePlaylistState(initialPlaylist: Playlist | null = null) {
  // Core playlist state
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(
    initialPlaylist
  );
  const [playlistSongs, setPlaylistSongs] = createSignal<Song[]>([]);

  // Modal and UI state
  const [showPlaylistCover, setShowPlaylistCover] = createSignal(false);
  const [showImageModal, setShowImageModal] = createSignal(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [modalImageIndex, setModalImageIndex] = createSignal(0);

  // Loading and operation state
  const [isDownloading, setIsDownloading] = createSignal(false);
  const [isCaching, setIsCaching] = createSignal(false);
  const [allSongsCached, setAllSongsCached] = createSignal(false);

  // Error state
  const [error, setError] = createSignal<string | null>(null);

  // Refresh playlist songs from database
  const refreshPlaylistSongs = async () => {
    const playlist = selectedPlaylist();
    if (playlist && playlist.songIds.length > 0) {
      try {
        const allSongs = await getAllSongs();
        const songs = allSongs
          .filter((song) => playlist.songIds.includes(song.id))
          .sort((a, b) => {
            const indexA = playlist.songIds.indexOf(a.id);
            const indexB = playlist.songIds.indexOf(b.id);
            return indexA - indexB;
          });
        setPlaylistSongs(songs);
      } catch (err) {
        console.error("Error refreshing playlist songs:", err);
        setError("Failed to refresh playlist songs");
      }
    } else {
      setPlaylistSongs([]);
    }
  };

  // Handle playlist updates
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

      // Update local state
      const updatedPlaylist: Playlist = {
        ...playlist,
        ...updatedFields,
      };

      setSelectedPlaylist(updatedPlaylist);
    } catch (err) {
      console.error("Error updating playlist:", err);
      setError("Failed to update playlist");
    }
  };

  // Handle playlist deletion
  const handleDeletePlaylist = async () => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);
      await deletePlaylist(playlist.id);
      setSelectedPlaylist(null);
      setShowDeleteConfirm(false);
    } catch (err) {
      console.error("Error deleting playlist:", err);
      setError("Failed to delete playlist");
    }
  };

  // Handle playlist download
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
      console.error("Error downloading playlist:", err);
      setError("Failed to download playlist");
    } finally {
      setIsDownloading(false);
    }
  };

  // Handle song removal from playlist
  const handleRemoveSong = async (songId: string) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);
      await removeSongFromPlaylist(playlist.id, songId);

      // Update local playlist state
      const updatedSongIds = playlist.songIds.filter((id) => id !== songId);
      const updatedPlaylist: Playlist = {
        ...playlist,
        songIds: updatedSongIds,
        updatedAt: Date.now(),
      };

      setSelectedPlaylist(updatedPlaylist);
      await refreshPlaylistSongs();
    } catch (err) {
      console.error("Error removing song from playlist:", err);
      setError("Failed to remove song from playlist");
    }
  };

  // Handle song reordering
  const handleReorderSongs = async (oldIndex: number, newIndex: number) => {
    const playlist = selectedPlaylist();
    if (!playlist) return;

    try {
      setError(null);
      await reorderSongs(playlist.id as string, oldIndex, newIndex);

      // Update local state
      const newSongIds = [...playlist.songIds];
      const [removed] = newSongIds.splice(oldIndex, 1);
      if (removed) {
        newSongIds.splice(newIndex, 0, removed);
      }

      const updatedPlaylist: Playlist = {
        ...playlist,
        songIds: newSongIds,
        updatedAt: Date.now(),
      };

      setSelectedPlaylist(updatedPlaylist);
      await refreshPlaylistSongs();
    } catch (err) {
      console.error("Error reordering songs:", err);
      setError("Failed to reorder songs");
    }
  };

  // Handle playlist caching for offline use
  const handleCachePlaylist = async () => {
    const playlist = selectedPlaylist();
    const songs = playlistSongs();
    if (!playlist || songs.length === 0) return;

    setIsCaching(true);
    try {
      setError(null);

      // Cache all songs in the playlist
      for (const song of songs) {
        if (song.audioData && song.id) {
          // Create blob URL for caching
          const blob = new Blob([song.audioData], {
            type: song.mimeType || "audio/mpeg",
          });
          const blobUrl = URL.createObjectURL(blob);
          try {
            await cacheAudioFile(blobUrl, song.title || "Unknown Song");
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }
      }

      setAllSongsCached(true);
    } catch (err) {
      console.error("Error caching playlist:", err);
      setError("Failed to cache playlist for offline use");
    } finally {
      setIsCaching(false);
    }
  };

  // Auto-refresh playlist songs when selected playlist changes
  createEffect(() => {
    const playlist = selectedPlaylist();
    if (playlist) {
      refreshPlaylistSongs();
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
    selectedPlaylist,
    playlistSongs,
    showPlaylistCover,
    showImageModal,
    showDeleteConfirm,
    modalImageIndex,
    isDownloading,
    isCaching,
    allSongsCached,
    error,

    // Setters
    setSelectedPlaylist,
    setPlaylistSongs,
    setShowPlaylistCover,
    setShowImageModal,
    setShowDeleteConfirm,
    setModalImageIndex,

    // Actions
    refreshPlaylistSongs,
    handlePlaylistUpdate,
    handleDeletePlaylist,
    handleDownloadPlaylist,
    handleRemoveSong,
    handleReorderSongs,
    handleCachePlaylist,
  };
}
