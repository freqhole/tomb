import { createSignal, createMemo, onMount } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import type { AdminMusicFilters } from "../../../lib/admin/admin-api.js";
import type { SearchPreset } from "../../../components/search/index.js";
import { useStandardDelayedLoading } from "../../useDelayedLoading.js";
import { getMusicFilterSummary } from "../../../lib/music/admin/music-unified-search.js";

export interface MusicSearchState {
  query: string;
  filters: AdminMusicFilters;
  showAdvancedSearch: boolean;
  selectedPreset: string | null;
  searchField: string | null;
}

export interface MusicSearchReturn {
  /** Current search state */
  searchState: () => MusicSearchState;
  /** Search query */
  searchQuery: () => string;
  /** Update search query */
  setSearchQuery: (query: string, executeSearch?: boolean) => void;
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
  suggestions: () => Array<{
    text: string;
    category: string;
    highlight?: string;
  }>;
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
  /** Current search field */
  searchField: () => string | null;
  /** Set search field */
  setSearchField: (field: string) => void;
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
  /** Set sort field and direction */
  setSort: (field: string | null, direction?: "asc" | "desc" | null) => void;
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
 * Simple, explicit music search hook with no reactive chaos
 */
export function useMusicSearch(apiClient: ApiClient): MusicSearchReturn {
  // === CORE STATE ===
  const [searchQuery, setSearchQuerySignal] = createSignal("");
  const [filters, setFiltersSignal] = createSignal<AdminMusicFilters>({});
  const [showAdvancedSearch, setShowAdvancedSearch] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<string | null>(null);
  const [suggestions, setSuggestions] = createSignal<
    Array<{ text: string; category: string; highlight?: string }>
  >([]);
  const [searchField, setSearchFieldSignal] = createSignal<string | null>(
    "all"
  );

  // === RESULTS STATE ===
  const [results, setResults] = createSignal<any[]>([]);
  const [total, setTotal] = createSignal(0);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // === DELAYED LOADING STATE ===
  const delayedLoading = useStandardDelayedLoading();

  // === PAGINATION STATE ===
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageSize] = createSignal(100);

  // === SORT STATE ===
  // What the server is actually sorting by (from sort_applied in response)
  const [sortField, setSortField] = createSignal<string | null>(null);
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc" | null>(
    null
  );
  // What the user explicitly requested (for UI cycling logic)
  const [userRequestedField, setUserRequestedField] = createSignal<
    string | null
  >(null);
  const [userRequestedDirection, setUserRequestedDirection] = createSignal<
    "asc" | "desc" | null
  >(null);

  // === FILTER OPTIONS STATE ===
  const [filterOptions, setFilterOptions] = createSignal<any>({});

  // === PRESETS ===
  const presets: SearchPreset[] = [
    { id: "favorites", label: "favorites", params: { is_favorite: true } },
    {
      id: "recent",
      label: "recent",
      params: {
        created_after: new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    },
    { id: "unrated", label: "unrated", params: { rating_is_null: true } },
    { id: "high-rated", label: "highly rated", params: { rating_min: 4 } },
    {
      id: "no-artwork",
      label: "no artwork",
      params: { has_thumbnail: false },
    },
    {
      id: "lossless",
      label: "lossless",
      params: { file_formats: ["flac", "wav"] },
    },
  ];

  // === COMPUTED VALUES ===
  const searchState = createMemo(() => ({
    query: searchQuery(),
    filters: filters(),
    showAdvancedSearch: showAdvancedSearch(),
    selectedPreset: selectedPreset(),
    searchField: searchField(),
  }));

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

  const hasActiveFilters = createMemo(() => {
    const activeFilters = filters();
    const query = searchQuery();
    const excludedKeys = ["page", "page_size", "sort_by", "sort_direction"];

    return (
      query.length > 0 ||
      Object.keys(activeFilters).some(
        (key) =>
          !excludedKeys.includes(key) &&
          activeFilters[key as keyof AdminMusicFilters] !== undefined &&
          activeFilters[key as keyof AdminMusicFilters] !== "" &&
          activeFilters[key as keyof AdminMusicFilters] !== null &&
          (!Array.isArray(activeFilters[key as keyof AdminMusicFilters]) ||
            (activeFilters[key as keyof AdminMusicFilters] as any[]).length > 0)
      )
    );
  });

  const filterSummary = createMemo(() => {
    const params = {
      q: searchQuery(),
      ...filters(),
    };
    return getMusicFilterSummary(params);
  });

  // === CORE FUNCTIONS ===

  /**
   * Build search parameters for API call
   */
  const buildSearchParams = (page = currentPage()) => {
    const params: any = {
      ...filters(),
      page,
      page_size: pageSize(),
    };

    if (sortField() && sortDirection()) {
      params.sort_by = sortField();
      params.sort_direction = sortDirection();
    }

    if (searchQuery()) {
      params.q = searchQuery();

      // Add search fields as array - API client will handle multiple parameters
      const currentField = searchField();
      if (currentField && currentField !== "all") {
        params.search_fields = [currentField];
      }
    }

    return params;
  };

  /**
   * Perform search API call
   */
  const performSearch = async (pageToLoad = 1, append = false) => {
    try {
      setLoading(true);
      delayedLoading.startLoading();
      setError(null);

      const params = buildSearchParams(pageToLoad);

      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/search",
        { params }
      );

      let newSongs: any[] = [];
      let serverTotal = 0;

      if (response?.songs) {
        newSongs = response.songs;
        serverTotal = response.total_count || response.total || 0;
      } else if (Array.isArray(response)) {
        newSongs = response;
        serverTotal = response.length;
      }

      // Extract actual sort from server response
      if (response?.sort_applied) {
        const actualSortField = response.sort_applied.primary_field;
        const actualSortDirection = response.sort_applied.primary_direction;

        setSortField(actualSortField);
        setSortDirection(actualSortDirection as "asc" | "desc");
      }

      setTotal(serverTotal);

      if (append && pageToLoad > 1) {
        // Append for infinite scroll
        const existing = results();
        const combined = [...existing, ...newSongs];
        setResults(combined);
      } else {
        // Replace for new search
        setResults(newSongs);
      }

      setCurrentPage(pageToLoad);
    } catch (err) {
      console.error("music search: API error", err);
      setError(err instanceof Error ? err.message : "search failed");
      if (!append) {
        setResults([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
      delayedLoading.stopLoading();
    }
  };

  /**
   * Load filter options from API
   */
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

  /**
   * Load suggestions from API
   */
  const loadSuggestions = async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/suggestions",
        {
          params: { field: "all", partial: query, page_size: 8 },
        }
      );

      if (response?.suggestions && Array.isArray(response.suggestions)) {
        // Process suggestions like useUnifiedSearch does
        const processedSuggestions = response.suggestions.map(
          (suggestion: any) => ({
            text: suggestion.value || suggestion.query || String(suggestion),
            category: suggestion.suggestion_type || "suggestion",
            highlight: suggestion.highlight,
          })
        );
        setSuggestions(processedSuggestions);
      } else {
        setSuggestions([]);
      }

      // Log final suggestions state with delay
    } catch (err) {
      console.warn("music search: failed to load suggestions:", err);
      setSuggestions([]);
    }
  };

  // === PUBLIC API ===

  const setSearchQuery = (query: string, executeSearch: boolean = false) => {
    setSearchQuerySignal(query);
    setCurrentPage(1);

    // Always load suggestions for display in the flyout, but only if query is long enough
    if (query.length >= 2) {
      loadSuggestions(query);
    } else {
      setSuggestions([]);
    }

    // Only perform search if explicitly requested
    if (executeSearch) {
      performSearch(1, false); // New search, don't append
    }
  };

  const updateFilters = (updates: Partial<AdminMusicFilters>) => {
    setFiltersSignal((prev) => ({ ...prev, ...updates }));
    setSelectedPreset(null);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const clearFilters = () => {
    setFiltersSignal({});
    setSearchQuerySignal("");
    setSelectedPreset(null);
    setSortField(null);
    setSortDirection(null);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const applyPreset = (preset: SearchPreset) => {
    setFiltersSignal(preset.params as AdminMusicFilters);
    setSelectedPreset(preset.id);
    setShowAdvancedSearch(false);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const onSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion, true); // Execute search when selecting a suggestion
  };

  const setSort = (
    field: string | null,
    direction: "asc" | "desc" | null = "asc"
  ) => {
    // Always track what the user requested for cycling logic
    setUserRequestedField(field);
    setUserRequestedDirection(direction);

    if (
      (field === null && direction === null) ||
      (field !== null && direction === null)
    ) {
      // Reset to server default - clear client sort state and let server apply its default
      setSortField(null);
      setSortDirection(null);
    } else if (field && direction) {
      setSortField(field);
      setSortDirection(direction);
    }

    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const loadMore = async () => {
    const pag = pagination();
    if (!pag.hasNext || loading()) {
      return;
    }

    const nextPage = currentPage() + 1;
    await performSearch(nextPage, true); // Append results
  };

  const refresh = async () => {
    setCurrentPage(1);
    await performSearch(1, false); // New search, don't append
  };

  const setSearchField = (field: string) => {
    setSearchFieldSignal(field);
    // Reload suggestions if there's a current query
    const query = searchQuery();
    if (query.length >= 2) {
      loadSuggestions(query);
    }
    // Don't automatically trigger search - let the UI decide
  };

  // === INITIALIZATION ===
  onMount(async () => {
    await loadFilterOptions();
    await performSearch(1, false); // Initial load
  });

  // === RETURN API ===
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
    filterOptions,
    loading: delayedLoading.showLoading,
    results,
    total,
    error,
    searching: delayedLoading.showLoading, // alias
    pagination,
    loadMore,
    setSort,
    sortField: () => userRequestedField(), // Use user-requested for UI cycling
    sortDirection: () => userRequestedDirection(), // Use user-requested for UI cycling
    refresh,
    searchSuggestions: () => suggestions().map((s) => s.text), // alias for compatibility
    totalCount: total, // alias
    searchField,
    setSearchField,
  };
}
