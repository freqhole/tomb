import { createSignal, createMemo, onMount } from "solid-js";
import type { ApiClient } from "../../../lib/api-client.js";
import type { AdminMusicFilters } from "../../../lib/admin/admin-api.js";
import type { SearchPreset } from "../../../lib/admin/components/AdminSearchHeader.js";
import { useStandardDelayedLoading } from "../../useDelayedLoading.js";

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
 * Simple, explicit music search hook with no reactive chaos
 */
export function useMusicSearch(apiClient: ApiClient): MusicSearchReturn {
  // === CORE STATE ===
  const [searchQuery, setSearchQuerySignal] = createSignal("");
  const [filters, setFiltersSignal] = createSignal<AdminMusicFilters>({});
  const [showAdvancedSearch, setShowAdvancedSearch] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<string | null>(null);
  const [suggestions, setSuggestions] = createSignal<string[]>([]);

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
  const [sortField, setSortField] = createSignal<string | null>("created_at");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc" | null>(
    "desc"
  );

  // === FILTER OPTIONS STATE ===
  const [filterOptions, setFilterOptions] = createSignal<any>({});

  // === PRESETS ===
  const presets: SearchPreset[] = [
    { id: "favorites", label: "favorites", filters: { is_favorite: true } },
    {
      id: "recent",
      label: "recent",
      filters: {
        created_after: new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
    },
    { id: "unrated", label: "unrated", filters: { rating_is_null: true } },
    { id: "high-rated", label: "highly rated", filters: { rating_min: 4 } },
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

  // === COMPUTED VALUES ===
  const searchState = createMemo(() => ({
    query: searchQuery(),
    filters: filters(),
    showAdvancedSearch: showAdvancedSearch(),
    selectedPreset: selectedPreset(),
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
    const activeFilters = filters();
    const query = searchQuery();
    const parts: string[] = [];

    if (query) parts.push(`search: "${query}"`);
    if (activeFilters.is_favorite) parts.push("favorites only");
    if (activeFilters.artist) parts.push(`artist: ${activeFilters.artist}`);
    if (activeFilters.album) parts.push(`album: ${activeFilters.album}`);
    if (activeFilters.genre) parts.push(`genre: ${activeFilters.genre}`);
    if (activeFilters.year) parts.push(`year: ${activeFilters.year}`);
    if (activeFilters.year_min && activeFilters.year_max) {
      parts.push(`years: ${activeFilters.year_min}-${activeFilters.year_max}`);
    } else if (activeFilters.year_min) {
      parts.push(`year >= ${activeFilters.year_min}`);
    } else if (activeFilters.year_max) {
      parts.push(`year <= ${activeFilters.year_max}`);
    }

    return parts.join(", ");
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

    if (sortField()) {
      params.sort_by = sortField();
      params.sort_direction = sortDirection() || "asc";
    }

    if (searchQuery()) {
      params.q = searchQuery();
    }

    return params;
  };

  /**
   * Perform search API call
   */
  const performSearch = async (pageToLoad = 1, append = false) => {
    console.log(
      `music search: performSearch(page=${pageToLoad}, append=${append})`
    );

    try {
      setLoading(true);
      delayedLoading.startLoading();
      setError(null);

      const params = buildSearchParams(pageToLoad);
      console.log("music search: API request", params);

      const response = await apiClient.makeRequest<any>(
        "GET",
        "/api/music/search",
        { params }
      );
      console.log("music search: API response", response);

      let newSongs: any[] = [];
      let serverTotal = 0;

      if (response?.songs) {
        newSongs = response.songs;
        serverTotal = response.total_count || response.total || 0;
      } else if (Array.isArray(response)) {
        newSongs = response;
        serverTotal = response.length;
      }

      setTotal(serverTotal);

      if (append && pageToLoad > 1) {
        // Append for infinite scroll
        const existing = results();
        const combined = [...existing, ...newSongs];
        setResults(combined);
        console.log(
          `music search: appended ${newSongs.length} songs, total now ${combined.length}`
        );
      } else {
        // Replace for new search
        setResults(newSongs);
        console.log(`music search: replaced with ${newSongs.length} songs`);
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
          params: { q: query, limit: 8 },
        }
      );

      if (response?.suggestions) {
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

  // === PUBLIC API ===

  const setSearchQuery = (query: string) => {
    console.log("music search: setSearchQuery", query);
    setSearchQuerySignal(query);
    setCurrentPage(1);
    loadSuggestions(query);
    performSearch(1, false); // New search, don't append
  };

  const updateFilters = (updates: Partial<AdminMusicFilters>) => {
    console.log("music search: updateFilters", updates);
    setFiltersSignal((prev) => ({ ...prev, ...updates }));
    setSelectedPreset(null);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const clearFilters = () => {
    console.log("music search: clearFilters");
    setFiltersSignal({});
    setSearchQuerySignal("");
    setSelectedPreset(null);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const applyPreset = (preset: SearchPreset) => {
    console.log("music search: applyPreset", preset.id);
    setFiltersSignal(preset.filters as AdminMusicFilters);
    setSelectedPreset(preset.id);
    setShowAdvancedSearch(false);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const onSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
  };

  const setSort = (field: string, direction: "asc" | "desc" = "asc") => {
    console.log("music search: setSort", { field, direction });
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1);
    performSearch(1, false); // New search, don't append
  };

  const loadMore = async () => {
    const pag = pagination();
    if (!pag.hasNext || loading()) {
      console.log("music search: loadMore skipped", {
        hasNext: pag.hasNext,
        loading: loading(),
      });
      return;
    }

    const nextPage = currentPage() + 1;
    console.log("music search: loadMore to page", nextPage);
    await performSearch(nextPage, true); // Append results
  };

  const refresh = async () => {
    console.log("music search: refresh");
    setCurrentPage(1);
    await performSearch(1, false); // New search, don't append
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
    sortField,
    sortDirection,
    refresh,
    searchSuggestions: suggestions, // alias
    totalCount: total, // alias
  };
}
