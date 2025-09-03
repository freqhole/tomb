import { createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import type { AdminMusicFilters } from "../../../lib/admin/admin-api.js";
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
  /** Search results */
  results: () => any[];
  /** Total results count */
  total: () => number;
  /** Search error */
  error: () => string | null;
  /** Whether currently searching */
  searching: () => boolean;
  /** Pagination info */
  pagination: () => {
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  /** Load next page */
  loadMore: () => Promise<void>;
  /** Go to specific page */
  goToPage: (page: number) => void;
  /** Set page size */
  setPageSize: (pageSize: number) => void;
  /** Add a single filter */
  addFilter: (key: string, value: any) => void;
  /** Remove a single filter */
  removeFilter: (key: string) => void;
  /** Set sort field and direction */
  setSort: (field: string, direction?: "asc" | "desc") => void;
  /** Current sort field */
  sortField: () => string | null;
  /** Current sort direction */
  sortDirection: () => "asc" | "desc" | null;
  /** Refresh search results */
  refresh: () => Promise<void>;
  /** Search suggestions from API */
  searchSuggestions: () => string[];
  /** Total count */
  totalCount: () => number;
}

/**
 * Enhanced music search hook using the backend search API
 *
 * This integrates with the complete backend search infrastructure including:
 * - 65+ search parameters
 * - Advanced filtering (null checking, ranges, arrays)
 * - Proper sorting with ASC/DESC support
 * - Pagination with total count
 * - Real-time suggestions
 * - Search presets
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

  // results state
  const [results, setResults] = createSignal<any[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [searching, setSearching] = createSignal(false);

  // pagination state
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageSize, setCurrentPageSize] = createSignal(20);

  // sort state
  const [sortField, setSortField] = createSignal<string | null>(null);
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc" | null>(
    null
  );

  // filter options state
  const [filterOptions, setFilterOptions] = createSignal<any>({});

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
      filters: { rating_is_null: true },
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
      filters: { file_formats: ["flac", "wav"] },
    },
  ];

  // debounced search function
  let searchTimeout: number | undefined;
  const debouncedSearch = () => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
      performSearch();
    }, 300);
  };

  // main search function
  const performSearch = async () => {
    try {
      setLoading(true);
      setSearching(true);
      setError(null);

      const searchParams = getSearchOptions();

      // call the music search API
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/search",
        { params: searchParams }
      );

      if (response && response.songs) {
        setResults(response.songs);
        setTotal(response.total_count || response.total || 0);
      } else if (Array.isArray(response)) {
        // handle direct array response
        setResults(response);
        setTotal(response.length);
      } else {
        setResults([]);
        setTotal(0);
      }
    } catch (err) {
      console.error("search error:", err);
      setError(err instanceof Error ? err.message : "search failed");
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setSearching(false);
    }
  };

  // load filter options
  const loadFilterOptions = async () => {
    try {
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/filter-options"
      );
      setFilterOptions(response || {});
    } catch (err) {
      console.warn("failed to load filter options:", err);
      setFilterOptions({});
    }
  };

  // load suggestions
  const loadSuggestions = async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/suggestions",
        { params: { q: query, limit: 8 } }
      );

      if (response && response.suggestions) {
        setSuggestions(response.suggestions.map((s: any) => s.text || s));
      } else if (Array.isArray(response)) {
        setSuggestions(response);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.warn("failed to load suggestions:", err);
      setSuggestions([]);
    }
  };

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
    setCurrentPage(1); // reset to first page when filters change
  };

  // clear all filters
  const clearFilters = () => {
    setFilters({});
    setSearchQuery("");
    setSelectedPreset(null);
    setCurrentPage(1);
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
    setCurrentPage(1);
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

    if (activeFilters.file_format) {
      parts.push(`format: ${activeFilters.file_format}`);
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
          activeFilters[key as keyof AdminMusicFilters] !== null &&
          (!Array.isArray(activeFilters[key as keyof AdminMusicFilters]) ||
            (activeFilters[key as keyof AdminMusicFilters] as any[]).length > 0)
      )
    );
  });

  // get search options for API calls
  const getSearchOptions = createMemo(() => {
    const options: AdminMusicFilters & { q?: string } = {
      ...filters(),
      page: currentPage(),
      page_size: pageSize(),
    };

    if (sortField()) {
      options.sort_by = sortField()!;
      options.sort_direction = sortDirection() || "asc";
    }

    if (searchQuery()) {
      options.q = searchQuery();
    }

    return options;
  });

  // pagination helpers
  const pagination = createMemo(() => {
    const totalItems = total();
    const size = pageSize();
    const page = currentPage();
    const totalPages = Math.ceil(totalItems / size);

    return {
      page,
      pageSize: size,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  });

  const loadMore = async () => {
    const pag = pagination();
    if (pag.hasNext) {
      setCurrentPage(pag.page + 1);
    }
  };

  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const setPageSize = (newPageSize: number) => {
    setCurrentPageSize(newPageSize);
    setCurrentPage(1); // reset to first page when changing page size
  };

  // filter helpers
  const addFilter = (key: string, value: any) => {
    updateFilters({ [key]: value });
  };

  const removeFilter = (key: string) => {
    const newFilters = { ...filters() };
    delete newFilters[key as keyof AdminMusicFilters];
    setFilters(newFilters);
  };

  // sort helpers
  const setSort = (field: string, direction: "asc" | "desc" = "asc") => {
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1); // reset to first page when sorting
  };

  // refresh function
  const refresh = async () => {
    await performSearch();
  };

  // reactive effects
  createEffect(() => {
    const query = searchQuery();
    if (query.length >= 2) {
      loadSuggestions(query);
    } else {
      setSuggestions([]);
    }
  });

  // trigger search when search params change
  createEffect(() => {
    const searchOptions = getSearchOptions();
    debouncedSearch();

    // notify parent of filter changes
    if (onFiltersChange) {
      onFiltersChange(searchOptions);
    }
  });

  // load filter options on mount
  createEffect(() => {
    loadFilterOptions();
  });

  // cleanup
  onCleanup(() => {
    clearTimeout(searchTimeout);
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
    filterOptions,
    loading,
    results,
    total,
    error,
    searching,
    pagination,
    loadMore,
    goToPage,
    setPageSize,
    addFilter,
    removeFilter,
    setSort,
    sortField,
    sortDirection,
    refresh,
    searchSuggestions: suggestions,
    totalCount: total,
  };
}
