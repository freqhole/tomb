import { createSignal } from "solid-js";
import { apiClient } from "../../../lib/api-client";
import type {
  UserPreferenceResponse,
  BulkUserPreferenceResponse,
  PlaylistPreferenceResponse,
  AlbumFavoriteStatusResponse,
} from "../../../lib/music/schemas";

/**
 * User preferences service for freqhole view
 * Handles rating and favorite operations with optimistic updates
 */
export function createUserPreferences() {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Song preference operations
  const toggleSongFavorite = async (
    songId: string,
    currentFavorite: boolean
  ): Promise<UserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.toggleSongFavorite(
        songId,
        !currentFavorite
      );
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to toggle favorite";
      setError(errorMessage);
      console.error(
        "[userPreferences] API error - failed to toggle song favorite:",
        err
      );
      console.error("[userPreferences] error details:", {
        songId,
        currentFavorite,
        targetFavorite: !currentFavorite,
        error: err,
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const rateSong = async (
    songId: string,
    rating: number | null
  ): Promise<UserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.rateSong(songId, rating);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to rate song";
      setError(errorMessage);
      console.error("[userPreferences] API error - failed to rate song:", err);
      console.error("[userPreferences] error details:", {
        songId,
        rating,
        error: err,
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Bulk song preference operations
  const bulkToggleFavorite = async (
    songIds: string[],
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.bulkToggleFavorite(songIds, isFavorite);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to bulk toggle favorites";
      setError(errorMessage);
      console.error("[userPreferences] failed to bulk toggle favorites:", err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const bulkRateSongs = async (
    songIds: string[],
    rating: number | null
  ): Promise<BulkUserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.bulkRateSongs(songIds, rating);

      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to bulk rate songs";
      setError(errorMessage);
      console.error("[userPreferences] failed to bulk rate songs:", err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Playlist preference operations
  const togglePlaylistFavorite = async (
    playlistId: string,
    currentFavorite: boolean
  ): Promise<PlaylistPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.updatePlaylistPreference(
        playlistId,
        !currentFavorite
      );
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "failed to toggle playlist favorite";
      setError(errorMessage);
      console.error(
        "[userPreferences] failed to toggle playlist favorite:",
        err
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const bulkFavoritePlaylistSongs = async (
    playlistId: string,
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.bulkFavoritePlaylistSongs(
        playlistId,
        isFavorite
      );

      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "failed to bulk favorite playlist songs";
      setError(errorMessage);
      console.error(
        "[userPreferences] failed to bulk favorite playlist songs:",
        err
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Album preference operations
  const bulkFavoriteAlbum = async (
    album: string,
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.bulkFavoriteAlbum(album, isFavorite);

      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "failed to bulk favorite album";
      setError(errorMessage);
      console.error("[userPreferences] failed to bulk favorite album:", err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const getAlbumFavoriteStatus = async (
    album: string
  ): Promise<AlbumFavoriteStatusResponse | null> => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await apiClient.getAlbumFavoriteStatus(album);
      return result;
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "failed to get album favorite status";
      setError(errorMessage);
      console.error(
        "[userPreferences] failed to get album favorite status:",
        err
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard shortcut handlers
  const handleKeyboardShortcut = (
    key: string,
    selectedSongs: any[]
  ): boolean => {
    if (selectedSongs.length === 0) return false;

    switch (key) {
      case "f":
        // Toggle favorite for selected songs
        const songIds = selectedSongs.map((song) => song.id);
        const anyNotFavorited = selectedSongs.some(
          (song) => !song.user_is_favorite
        );
        bulkToggleFavorite(songIds, anyNotFavorited);
        return true;

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        // Rate selected songs
        const rating = parseInt(key);
        const ratingIds = selectedSongs.map((song) => song.id);
        bulkRateSongs(ratingIds, rating);
        return true;

      case "0":
        // Clear rating for selected songs
        const clearIds = selectedSongs.map((song) => song.id);
        bulkRateSongs(clearIds, null);
        return true;

      default:
        return false;
    }
  };

  return {
    // State
    isLoading,
    error,

    // Song preferences
    toggleSongFavorite,
    rateSong,
    bulkToggleFavorite,
    bulkRateSongs,

    // Playlist preferences
    togglePlaylistFavorite,
    bulkFavoritePlaylistSongs,

    // Album preferences
    bulkFavoriteAlbum,
    getAlbumFavoriteStatus,

    // Keyboard shortcuts
    handleKeyboardShortcut,
  };
}

export type UserPreferencesService = ReturnType<typeof createUserPreferences>;
