import { ApiClient } from "../../../lib/api-client.js";
import { createAdminData } from "../../useAdminData.js";
import { musicAdminConfig } from "../../../lib/music/admin/music-admin-config.js";
import type { AdminSong } from "../../../lib/admin/admin-api.js";
import { createSelection } from "../../../lib/admin/selection.js";
import { createSignal, createMemo } from "solid-js";
import type { UnifiedSearchParams } from "../../search/useUnifiedSearch.js";

/**
 * Music-specific admin data hook
 *
 * Extends the generic admin data hook with music-specific functionality:
 * - Music API integration
 * - Song-specific filtering
 * - Metadata validation
 * - Audio playback integration
 */
export function createMusicAdminData(apiClient: ApiClient) {
  // Create the base admin data system
  const adminData = createAdminData<AdminSong>(apiClient, musicAdminConfig);

  // Create selection system for songs
  const selection = createSelection<AdminSong>();

  // Music-specific state
  const [viewMode, setViewMode] = createSignal<
    "compact" | "standard" | "detailed"
  >("standard");
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [searchTerm, setSearchTerm] = createSignal("");

  // Extended grid state with selection
  const musicGridState = createMemo(() => ({
    ...adminData.gridState(),
    selectedIds: selection.selectedIds(),
    viewMode: viewMode(),
    playingId: playingId(),
  }));

  /**
   * Search songs by text (legacy method - use search system directly for new code)
   */
  const searchSongs = (term: string) => {
    setSearchTerm(term);
    adminData.updateFilters({ q: term }, true);
  };

  /**
   * Clear search
   */
  const clearSearch = () => {
    setSearchTerm("");
    const currentFilters = adminData.filters();
    const { q, title_search, ...filtersWithoutSearch } = currentFilters;
    adminData.updateFilters(filtersWithoutSearch, true);
  };

  /**
   * Filter by favorites
   */
  const filterFavorites = (favoritesOnly: boolean) => {
    adminData.updateFilters({ is_favorite: favoritesOnly });
  };

  /**
   * Filter by artist
   */
  const filterByArtist = (artist: string) => {
    adminData.updateFilters({ artist }, true);
  };

  /**
   * Filter by album
   */
  const filterByAlbum = (album: string) => {
    adminData.updateFilters({ album }, true);
  };

  /**
   * Filter by genre
   */
  const filterByGenre = (genre: string) => {
    adminData.updateFilters({ genre }, true);
  };

  /**
   * Filter by year
   */
  const filterByYear = (year: number) => {
    adminData.updateFilters({ year }, true);
  };

  /**
   * Filter by rating range
   */
  const filterByRating = (minRating?: number, maxRating?: number) => {
    adminData.updateFilters({
      rating_min: minRating,
      rating_max: maxRating,
    });
  };

  /**
   * Apply complex filters with unified search parameters
   */
  const applyAdvancedFilters = (filters: Partial<UnifiedSearchParams>) => {
    adminData.updateFilters(filters, true);
  };

  /**
   * Update a single song
   */
  const updateSong = async (songId: string, updates: Partial<AdminSong>) => {
    try {
      const response = await apiClient.makeRequest(
        "PUT",
        `/api/media/songs/${songId}`,
        {
          data: updates,
          headers: { "Content-Type": "application/json" },
        }
      );

      // No refresh needed - the UI will update optimistically
      // and the next search will include the updated data
      return response;
    } catch (error) {
      console.error("failed to update song:", error);
      throw error;
    }
  };

  /**
   * Bulk update selected songs
   */
  const bulkUpdateSelected = async (updates: Partial<AdminSong>) => {
    const selectedItems = selection.actions.getSelectedItems(adminData.items());
    if (selectedItems.length === 0) {
      throw new Error("No songs selected");
    }

    try {
      const response = await apiClient.makeRequest(
        "PUT",
        "/api/media/songs/bulk",
        {
          data: {
            song_ids: selectedItems.map((song) => song.id),
            updates,
          },
          headers: { "Content-Type": "application/json" },
        }
      );

      // Refresh data and clear selection
      adminData.refresh();
      selection.actions.clearSelection();

      return response;
    } catch (error) {
      console.error("failed to bulk update songs:", error);
      throw error;
    }
  };

  /**
   * Delete selected songs
   */
  const deleteSelected = async () => {
    const selectedItems = selection.actions.getSelectedItems(adminData.items());
    if (selectedItems.length === 0) {
      throw new Error("no songs selected");
    }

    try {
      const response = await apiClient.makeRequest(
        "DELETE",
        "/api/media/songs/bulk",
        {
          data: {
            song_ids: selectedItems.map((song) => song.id),
          },
          headers: { "Content-Type": "application/json" },
        }
      );

      // Refresh data and clear selection
      adminData.refresh();
      selection.actions.clearSelection();

      return response;
    } catch (error) {
      console.error("failed to delete songs:", error);
      throw error;
    }
  };

  /**
   * Toggle favorite status for selected songs
   */
  const toggleFavoriteSelected = async () => {
    const selectedItems = selection.actions.getSelectedItems(adminData.items());
    if (selectedItems.length === 0) {
      throw new Error("no songs selected");
    }

    // Determine new favorite status (if any are not favorited, favorite all; otherwise unfavorite all)
    const anyNotFavorited = selectedItems.some((song) => !song.is_favorite);
    const newFavoriteStatus = anyNotFavorited;

    return bulkUpdateSelected({ is_favorite: newFavoriteStatus });
  };

  /**
   * Set rating for selected songs
   */
  const rateSelected = async (rating: number) => {
    if (rating < 0 || rating > 5) {
      throw new Error("rating must be between 0 and 5");
    }

    return bulkUpdateSelected({ rating });
  };

  /**
   * Add tags to selected songs
   */
  const addTagsToSelected = async (tags: string[]) => {
    const selectedItems = selection.actions.getSelectedItems(adminData.items());
    if (selectedItems.length === 0) {
      throw new Error("no songs selected");
    }

    // For each song, merge new tags with existing ones
    // TODO: Implement batch update with different data per song
    // For now, use simple bulk update (this will overwrite all songs with same tags)
    return bulkUpdateSelected({ tags });
  };

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyboardShortcut = (shortcut: string, event: KeyboardEvent) => {
    switch (shortcut) {
      case "ctrl+a":
        selection.actions.selectAll(adminData.items());
        event.preventDefault();
        break;

      case "escape":
        selection.actions.clearSelection();
        event.preventDefault();
        break;

      case "delete":
        if (selection.actions.getSelectedCount() > 0) {
          // TODO: show confirmation dialog
          deleteSelected();
          event.preventDefault();
        }
        break;

      case "ctrl+f":
        // TODO: focus search input
        event.preventDefault();
        break;

      case "ctrl+r":
        adminData.refresh();
        event.preventDefault();
        break;

      case "f":
        if (selection.actions.getSelectedCount() > 0) {
          toggleFavoriteSelected();
          event.preventDefault();
        }
        break;

      case "1":
      case "2":
      case "3":
      case "4":
      case "5":
        if (selection.actions.getSelectedCount() > 0) {
          rateSelected(parseInt(shortcut));
          event.preventDefault();
        }
        break;

      case "0":
        if (selection.actions.getSelectedCount() > 0) {
          rateSelected(0);
          event.preventDefault();
        }
        break;

      case "ctrl+1":
        setViewMode("compact");
        event.preventDefault();
        break;

      case "ctrl+2":
        setViewMode("standard");
        event.preventDefault();
        break;

      case "ctrl+3":
        setViewMode("detailed");
        event.preventDefault();
        break;

      default:
        // Unhandled shortcut
        break;
    }
  };

  /**
   * Handle song item click with selection logic
   */
  const handleSongClick = (song: AdminSong, event: MouseEvent) => {
    selection.handleItemClick(song.id, event, adminData.items());
  };

  /**
   * Handle double-click to play song
   */
  const handleSongDoubleClick = (song: AdminSong) => {
    setPlayingId(song.id);
    // TODO: integrate with audio player
  };

  return {
    // Core admin data
    ...adminData,

    // Selection system
    selection,

    // Music-specific state
    musicGridState,
    viewMode,
    setViewMode,
    playingId,
    setPlayingId,
    searchTerm,

    // Music-specific actions
    searchSongs,
    clearSearch,
    filterFavorites,
    filterByArtist,
    filterByAlbum,
    filterByGenre,
    filterByYear,
    filterByRating,
    applyAdvancedFilters,

    // Song operations
    updateSong,
    bulkUpdateSelected,
    deleteSelected,
    toggleFavoriteSelected,
    rateSelected,
    addTagsToSelected,

    // Event handlers
    handleKeyboardShortcut,
    handleSongClick,
    handleSongDoubleClick,

    // Computed values
    selectedSongs: createMemo(() =>
      selection.actions.getSelectedItems(adminData.items())
    ),
    hasSelection: createMemo(() => selection.actions.getSelectedCount() > 0),
    isFiltered: createMemo(() => {
      const filters = adminData.filters();
      // check if any non-default filters are active
      const defaultParams = {
        page: 1,
        page_size: 20,
        sort_by: "created_at",
        sort_direction: "desc",
        songs_only: true,
      };

      return Object.entries(filters).some(([key, value]) => {
        if (key in defaultParams) {
          return false; // ignore default parameters
        }

        return (
          value !== undefined &&
          value !== null &&
          value !== "" &&
          (!Array.isArray(value) || value.length > 0)
        );
      });
    }),
  };
}

/**
 * Type for the music admin data hook return value
 */
export type MusicAdminData = ReturnType<typeof createMusicAdminData>;
