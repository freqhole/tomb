import { createContext, useContext, JSX, ParentComponent } from "solid-js";
import { ApiClient } from "../../lib/api-client.js";
import { createMusicUserData, type MusicUserData } from "./useMusicUserData.js";

/**
 * Context for user-specific music data and preferences
 */
const MusicUserContext = createContext<MusicUserData>();

/**
 * Props for the MusicUserProvider
 */
interface MusicUserProviderProps {
  apiClient: ApiClient;
  children: JSX.Element;
}

/**
 * Provider component for music user context
 *
 * Provides user-specific music functionality throughout the app:
 * - User preferences (favorites, ratings)
 * - Personal collections
 * - Preference synchronization
 * - User-aware operations
 */
export const MusicUserProvider: ParentComponent<MusicUserProviderProps> = (props) => {
  const musicUserData = createMusicUserData(props.apiClient);

  return (
    <MusicUserContext.Provider value={musicUserData}>
      {props.children}
    </MusicUserContext.Provider>
  );
};

/**
 * Hook to access music user context
 *
 * @returns MusicUserData instance
 * @throws Error if used outside of MusicUserProvider
 */
export function useMusicUser(): MusicUserData {
  const context = useContext(MusicUserContext);
  if (!context) {
    throw new Error("useMusicUser must be used within a MusicUserProvider");
  }
  return context;
}

/**
 * Hook to access specific user preference functions
 *
 * Convenience hook that extracts commonly used preference functions
 */
export function useMusicUserPreferences() {
  const musicUser = useMusicUser();

  return {
    // preference queries
    isFavorite: musicUser.isFavorite,
    getUserRating: musicUser.getUserRating,
    getUserPreference: musicUser.getUserPreference,

    // preference actions
    toggleFavorite: musicUser.toggleFavorite,
    rateSong: musicUser.rateSong,
    updatePreference: musicUser.updatePreference,

    // bulk actions
    bulkToggleFavorite: musicUser.bulkToggleFavorite,
    bulkRateSongs: musicUser.bulkRateSongs,

    // state
    isLoading: musicUser.isLoading,
    error: musicUser.error,

    // collections
    getFavoriteSongs: musicUser.getFavoriteSongs,
    getHighlyRatedSongs: musicUser.getHighlyRatedSongs,

    // statistics
    getPreferenceStats: musicUser.getPreferenceStats,
    hasPreferences: musicUser.hasPreferences,
    hasFavorites: musicUser.hasFavorites,
    hasRatings: musicUser.hasRatings,
  };
}

/**
 * Hook for keyboard shortcuts related to user preferences
 */
export function useMusicUserShortcuts() {
  const musicUser = useMusicUser();

  return {
    handleKeyboardShortcut: musicUser.handleKeyboardShortcut,
  };
}

/**
 * Hook for user preference filters
 */
export function useMusicUserFilters() {
  const musicUser = useMusicUser();

  return {
    // filter state
    showFavoritesOnly: musicUser.showFavoritesOnly,
    setShowFavoritesOnly: musicUser.setShowFavoritesOnly,
    minRating: musicUser.minRating,
    setMinRating: musicUser.setMinRating,
    maxRating: musicUser.maxRating,
    setMaxRating: musicUser.setMaxRating,

    // filtered data
    getFilteredSongs: musicUser.getFilteredSongs,
  };
}
