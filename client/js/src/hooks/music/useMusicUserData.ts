import { ApiClient } from "../../lib/api-client.js";
import { createSignal, createMemo } from "solid-js";
import type {
  Song,
  SongWithUserPreferences,
  UpdateUserPreferenceRequest,
  BulkUpdateUserPreferencesRequest,
  UserPreferenceResponse,
  BulkUserPreferenceResponse,
} from "../../lib/music/types.js";

/**
 * User-specific music data hook
 *
 * Provides user-centric music functionality:
 * - User preferences (favorites, ratings)
 * - Personal song collections
 * - Preference synchronization
 * - User-aware search and filtering
 */
export function createMusicUserData(apiClient: ApiClient) {
  // User preference state
  const [userPreferences, setUserPreferences] = createSignal<
    Map<string, UserPreferenceResponse>
  >(new Map());
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // User-specific filters
  const [showFavoritesOnly, setShowFavoritesOnly] = createSignal(false);
  const [minRating, setMinRating] = createSignal<number | null>(null);
  const [maxRating, setMaxRating] = createSignal<number | null>(null);

  // Songs with user context
  const [songsWithUserPrefs, setSongsWithUserPrefs] = createSignal<
    SongWithUserPreferences[]
  >([]);

  /**
   * Get user preference for a specific song
   */
  const getUserPreference = (songId: string): UserPreferenceResponse | null => {
    return userPreferences().get(songId) || null;
  };

  /**
   * Check if user has favorited a song
   */
  const isFavorite = (songId: string): boolean => {
    const pref = getUserPreference(songId);
    return pref?.is_favorite || false;
  };

  /**
   * Get user rating for a song
   */
  const getUserRating = (songId: string): number | null => {
    const pref = getUserPreference(songId);
    return pref?.rating || null;
  };

  /**
   * Update preference for a single song
   */
  const updatePreference = async (
    songId: string,
    request: UpdateUserPreferenceRequest
  ): Promise<UserPreferenceResponse> => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await apiClient.updateSongPreferences(songId, request);

      // update local state
      setUserPreferences((prev) => {
        const updated = new Map(prev);
        updated.set(songId, response);
        return updated;
      });

      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      setError(`failed to update preference: ${errorMessage}`);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Bulk update preferences for multiple songs
   */
  const bulkUpdatePreferences = async (
    request: BulkUpdateUserPreferencesRequest
  ): Promise<BulkUserPreferenceResponse> => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await apiClient.bulkUpdateUserPreferences(request);

      // update local state
      setUserPreferences((prev) => {
        const updated = new Map(prev);
        response.updated_preferences.forEach((pref: UserPreferenceResponse) => {
          updated.set(pref.song_id, pref);
        });
        return updated;
      });

      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      setError(`failed to bulk update preferences: ${errorMessage}`);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Toggle favorite status for a song
   */
  const toggleFavorite = async (
    songId: string
  ): Promise<UserPreferenceResponse> => {
    const currentlyFavorite = isFavorite(songId);
    return updatePreference(songId, {
      is_favorite: !currentlyFavorite,
    });
  };

  /**
   * Set rating for a song
   */
  const rateSong = async (
    songId: string,
    rating: number | null
  ): Promise<UserPreferenceResponse> => {
    if (rating !== null && (rating < 1 || rating > 5)) {
      throw new Error("rating must be between 1 and 5");
    }

    return updatePreference(songId, {
      rating: rating || undefined,
    });
  };

  /**
   * Bulk toggle favorite for multiple songs
   */
  const bulkToggleFavorite = async (
    songIds: string[],
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse> => {
    return bulkUpdatePreferences({
      song_ids: songIds,
      updates: { is_favorite: isFavorite },
    });
  };

  /**
   * Bulk rate multiple songs
   */
  const bulkRateSongs = async (
    songIds: string[],
    rating: number | null
  ): Promise<BulkUserPreferenceResponse> => {
    if (rating !== null && (rating < 1 || rating > 5)) {
      throw new Error("rating must be between 1 and 5");
    }

    return bulkUpdatePreferences({
      song_ids: songIds,
      updates: { rating: rating || undefined },
    });
  };

  /**
   * Get user's favorite songs
   */
  const getFavoriteSongs = (): SongWithUserPreferences[] => {
    return songsWithUserPrefs().filter((song) => song.user_is_favorite);
  };

  /**
   * Get user's highly rated songs (4+ stars)
   */
  const getHighlyRatedSongs = (): SongWithUserPreferences[] => {
    return songsWithUserPrefs().filter(
      (song) => song.user_rating !== null && song.user_rating >= 4
    );
  };

  /**
   * Get songs filtered by user preferences
   */
  const getFilteredSongs = (): SongWithUserPreferences[] => {
    let filtered = songsWithUserPrefs();

    if (showFavoritesOnly()) {
      filtered = filtered.filter((song) => song.user_is_favorite);
    }

    if (minRating() !== null) {
      filtered = filtered.filter(
        (song) => song.user_rating !== null && song.user_rating >= minRating()!
      );
    }

    if (maxRating() !== null) {
      filtered = filtered.filter(
        (song) => song.user_rating !== null && song.user_rating <= maxRating()!
      );
    }

    return filtered;
  };

  /**
   * Get user's preference statistics
   */
  const getPreferenceStats = createMemo(() => {
    const prefs = Array.from(userPreferences().values());
    const favoriteCount = prefs.filter((p) => p.is_favorite).length;
    const ratedCount = prefs.filter((p) => p.rating !== null).length;
    const avgRating =
      ratedCount > 0
        ? prefs
            .filter((p) => p.rating !== null)
            .reduce((sum, p) => sum + p.rating!, 0) / ratedCount
        : 0;

    return {
      totalPreferences: prefs.length,
      favoriteCount,
      ratedCount,
      avgRating: Math.round(avgRating * 100) / 100,
    };
  });

  /**
   * Clear all user preferences (local state only)
   */
  const clearPreferences = () => {
    setUserPreferences(new Map());
    setSongsWithUserPrefs([]);
  };

  /**
   * Refresh user preferences from server
   */
  const refreshPreferences = async () => {
    try {
      setError(null);
      setIsLoading(true);

      // todo: implement getUserPreferences endpoint
      // for now, preferences are loaded when individual songs are queried
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown error";
      setError(`failed to refresh preferences: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Convenience method to convert regular song to song with user preferences
   */
  const enrichSongWithUserPrefs = (song: Song): SongWithUserPreferences => {
    const pref = getUserPreference(song.id);
    return {
      ...song,
      user_is_favorite: pref?.is_favorite || false,
      user_rating: pref?.rating || null,
      preference_updated_at: pref?.updated_at || null,
    };
  };

  /**
   * Handle keyboard shortcuts for user actions
   */
  const handleKeyboardShortcut = (
    shortcut: string,
    event: KeyboardEvent,
    currentSongId?: string
  ) => {
    if (!currentSongId) return;

    switch (shortcut) {
      case "f":
        toggleFavorite(currentSongId);
        event.preventDefault();
        break;

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        rateSong(currentSongId, parseInt(shortcut));
        event.preventDefault();
        break;

      case "0":
        rateSong(currentSongId, null);
        event.preventDefault();
        break;

      default:
        // unhandled shortcut
        break;
    }
  };

  // computed values
  const hasPreferences = createMemo(() => userPreferences().size > 0);
  const hasFavorites = createMemo(() => getFavoriteSongs().length > 0);
  const hasRatings = createMemo(() =>
    Array.from(userPreferences().values()).some((p) => p.rating !== null)
  );

  return {
    // state
    userPreferences,
    isLoading,
    error,
    songsWithUserPrefs,

    // filters
    showFavoritesOnly,
    setShowFavoritesOnly,
    minRating,
    setMinRating,
    maxRating,
    setMaxRating,

    // preference queries
    getUserPreference,
    isFavorite,
    getUserRating,
    getFavoriteSongs,
    getHighlyRatedSongs,
    getFilteredSongs,
    getPreferenceStats,

    // preference mutations
    updatePreference,
    bulkUpdatePreferences,
    toggleFavorite,
    rateSong,
    bulkToggleFavorite,
    bulkRateSongs,

    // utilities
    enrichSongWithUserPrefs,
    clearPreferences,
    refreshPreferences,
    handleKeyboardShortcut,

    // computed values
    hasPreferences,
    hasFavorites,
    hasRatings,
  };
}

/**
 * Type for the user music data hook return value
 */
export type MusicUserData = ReturnType<typeof createMusicUserData>;
