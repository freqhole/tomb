import { createSignal, createMemo, createEffect } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import type { AdminMusicFilters } from "../../../lib/admin/admin-api.js";
import { useMusicFilters } from "../../search/music/useMusicFilters.js";
import type { SearchPreset } from "../../../lib/admin/components/AdminSearchHeader.js";

export interface MusicSearchState {
  query: string;
  filters: AdminMusicFilters;
  showAdvancedSearch: boolean;
  selectedPreset: string | null;
}

export interface MusicSearchReturn {
  /** Current search state */
  searchState: () => MusicSearchState;
  /** Search query */
  searchQuery: () => string;
  /** Update search query */
  setSearchQuery: (query: string) => void;
  /** Current filters */
  filters: () => AdminMusicFilters;
  /** Update filters */
  updateFilters: (updates: Partial<AdminMusicFilters>) => void;
  /** Clear all filters */
  clearFilters: () => void;
  /** Advanced search visibility */
  showAdvancedSearch: () => boolean;
  /** Toggle advanced search */
  setShowAdvancedSearch: (show: boolean) => void;
  /** Search suggestions */
  suggestions: () => string[];
  /** Handle suggestion selection */
  onSuggestionSelect: (suggestion: string) => void;
  /** Search presets */
  presets: SearchPreset[];
  /** Apply preset */
  applyPreset: (preset: SearchPreset) => void;
  /** Filter summary text */
  filterSummary: () => string;
  /** Whether any filters are active */
  hasActiveFilters: () => boolean;
  /** Get search options for API */
  getSearchOptions: () => AdminMusicFilters & { q?: string };
  /** Clear search but keep filters */
  clearSearch: () => void;
  /** Filter options for UI components */
  filterOptions: () => any;
  /** Loading state */
  loading: () => boolean;
}

/**
 * Music-specific search logic that bridges existing music hooks to admin interface
 */
export function useMusicSearch(
  apiClient: ApiClient,
  onFiltersChange?: (filters: AdminMusicFilters & { q?: string }) => void
): MusicSearchReturn {
  // core search state
  const [searchQuery, setSearchQuery] = createSignal("");
  const [filters, setFilters] = createSignal<AdminMusicFilters>({});
  const [showAdvancedSearch, setShowAdvancedSearch] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<string | null>(null);
  const [suggestions, setSuggestions] = createSignal<string[]>([]);

  // integrate with existing music filters hook
  const musicFilters = useMusicFilters({
    apiClient,
    autoFetch: true,
    minCount: 1,
    limit: 100,
  });

  // search presets for quick filtering
  const presets: SearchPreset[] = [
    {
      id: "favorites",
      label: "favorites",
      filters: { is_favorite: true },
    },
    {
      id: "recent",
      label: "recent",
      filters: {
        created_after: new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    },
    {
      id: "unrated",
      label: "unrated",
      filters: { rating: 0 },
    },
    {
      id: "high-rated",
      label: "highly rated",
      filters: { rating_min: 4 },
    },
    {
      id: "no-artwork",
      label: "no artwork",
      filters: { has_thumbnail: false },
    },
    {
      id: "lossless",
      label: "lossless",
      filters: { format: "flac" },
    },
  ];

  // combined search state
  const searchState = createMemo(
    (): MusicSearchState => ({
      query: searchQuery(),
      filters: filters(),
      showAdvancedSearch: showAdvancedSearch(),
      selectedPreset: selectedPreset(),
    })
  );

  // update filters helper
  const updateFilters = (updates: Partial<AdminMusicFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
    setSelectedPreset(null); // clear preset when manually updating filters
  };

  // clear all filters
  const clearFilters = () => {
    setFilters({});
    setSearchQuery("");
    setSelectedPreset(null);
  };

  // clear search but keep filters
  const clearSearch = () => {
    setSearchQuery("");
  };

  // apply preset
  const applyPreset = (preset: SearchPreset) => {
    setFilters(preset.filters as AdminMusicFilters);
    setSelectedPreset(preset.id);
    setShowAdvancedSearch(false);
  };

  // handle suggestion selection
  const onSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
  };

  // generate filter summary text
  const filterSummary = createMemo(() => {
    const activeFilters = filters();
    const query = searchQuery();
    const parts: string[] = [];

    if (query) {
      parts.push(`search: "${query}"`);
    }

    if (activeFilters.is_favorite) {
      parts.push("favorites only");
    }

    if (activeFilters.artist) {
      parts.push(`artist: ${activeFilters.artist}`);
    }

    if (activeFilters.album) {
      parts.push(`album: ${activeFilters.album}`);
    }

    if (activeFilters.genre) {
      parts.push(`genre: ${activeFilters.genre}`);
    }

    if (activeFilters.year) {
      parts.push(`year: ${activeFilters.year}`);
    }

    if (activeFilters.year_min && activeFilters.year_max) {
      parts.push(`years: ${activeFilters.year_min}-${activeFilters.year_max}`);
    } else if (activeFilters.year_min) {
      parts.push(`year >= ${activeFilters.year_min}`);
    } else if (activeFilters.year_max) {
      parts.push(`year <= ${activeFilters.year_max}`);
    }

    if (activeFilters.rating_min && activeFilters.rating_max) {
      parts.push(
        `rating: ${activeFilters.rating_min}-${activeFilters.rating_max} stars`
      );
    } else if (activeFilters.rating_min) {
      parts.push(`rating >= ${activeFilters.rating_min} stars`);
    } else if (activeFilters.rating_max) {
      parts.push(`rating <= ${activeFilters.rating_max} stars`);
    } else if (activeFilters.rating !== undefined) {
      parts.push(`rating: ${activeFilters.rating} stars`);
    }

    if (activeFilters.format) {
      parts.push(`format: ${activeFilters.format}`);
    }

    if (activeFilters.has_thumbnail === false) {
      parts.push("no artwork");
    }

    if (activeFilters.tags && activeFilters.tags.length > 0) {
      parts.push(`tags: ${activeFilters.tags.join(", ")}`);
    }

    if (activeFilters.created_after) {
      const date = new Date(activeFilters.created_after);
      parts.push(`added after ${date.toLocaleDateString()}`);
    }

    if (activeFilters.created_before) {
      const date = new Date(activeFilters.created_before);
      parts.push(`added before ${date.toLocaleDateString()}`);
    }

    return parts.join(", ");
  });

  // check if any filters are active
  const hasActiveFilters = createMemo(() => {
    const activeFilters = filters();
    const query = searchQuery();

    return (
      query.length > 0 ||
      Object.keys(activeFilters).some(
        (key) =>
          activeFilters[key as keyof AdminMusicFilters] !== undefined &&
          activeFilters[key as keyof AdminMusicFilters] !== "" &&
          activeFilters[key as keyof AdminMusicFilters] !== null
      )
    );
  });

  // get search options for API calls
  const getSearchOptions = createMemo(() => {
    const options: AdminMusicFilters & { q?: string } = { ...filters() };

    if (searchQuery()) {
      options.q = searchQuery();
    }

    return options;
  });

  // generate search suggestions based on current query and available filter data
  createEffect(() => {
    const query = searchQuery().toLowerCase();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const filterData = musicFilters.filterData();
    if (!filterData) {
      setSuggestions([]);
      return;
    }

    const newSuggestions: string[] = [];

    // suggest artists
    filterData.artists
      ?.filter((artist) => artist.value.toLowerCase().includes(query))
      ?.slice(0, 3)
      ?.forEach((artist) => newSuggestions.push(artist.value));

    // suggest from artists (albums not available in AllFiltersResponse)
    // could add album suggestions if API is extended

    // suggest genres
    filterData.genres
      ?.filter((genre) => genre.value.toLowerCase().includes(query))
      ?.slice(0, 2)
      ?.forEach((genre) => newSuggestions.push(genre.value));

    setSuggestions(newSuggestions.slice(0, 8)); // limit to 8 suggestions
  });

  // notify parent of filter changes
  createEffect(() => {
    const searchOptions = getSearchOptions();
    if (onFiltersChange) {
      onFiltersChange(searchOptions);
    }
  });

  return {
    searchState,
    searchQuery,
    setSearchQuery,
    filters,
    updateFilters,
    clearFilters,
    showAdvancedSearch,
    setShowAdvancedSearch,
    suggestions,
    onSuggestionSelect,
    presets,
    applyPreset,
    filterSummary,
    hasActiveFilters,
    getSearchOptions,
    clearSearch,
    filterOptions: musicFilters.filterOptions,
    loading: musicFilters.loading,
  };
}
