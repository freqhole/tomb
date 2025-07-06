import { createSignal } from "solid-js";
import type {
  SearchDomain,
  MusicSearchOptions,
  SongsSearchOptions,
  SortBy,
} from "../../lib/search-types.js";

export interface SearchStateProps {
  initialQuery?: string;
  initialDomain?: SearchDomain;
  enableHistory?: boolean;
  maxHistoryItems?: number;
}

const DEFAULT_PANEL_WIDTH = 300;
const DEFAULT_MAX_HISTORY = 50;

// Search filter configuration
export interface SearchFilters {
  artist: string;
  album: string;
  genre: string;
  year: number | null;
  rating_min: number | null;
  rating_max: number | null;
  favorites_only: boolean;
}

// Search state interface
export interface SearchState {
  query: string;
  domain: SearchDomain;
  filters: SearchFilters;
  history: string[];

  // UI state
  isSearchPanelOpen: boolean;
  searchPanelWidth: number;
  isFiltersPanelOpen: boolean;
  filtersPanelWidth: number;

  // Results state
  lastSearchQuery: string;
  lastSearchDomain: SearchDomain;

  // Pagination state
  currentPage: number;
  pageSize: number;

  // Sort state
  sortBy: string;
  sortDirection: "asc" | "desc";
}

export interface SearchStateHook {
  // Query state
  query: () => string;
  setQuery: (query: string) => void;

  // Domain state
  domain: () => SearchDomain;
  setDomain: (domain: SearchDomain) => void;

  // Filter state
  filters: () => SearchFilters;
  setFilters: (filters: SearchFilters) => void;
  updateFilter: (key: keyof SearchFilters, value: any) => void;
  clearFilters: () => void;

  // History state
  searchHistory: () => string[];
  addToHistory: (query: string) => void;
  removeFromHistory: (query: string) => void;
  clearHistory: () => void;

  // UI state - Search panel
  isSearchPanelOpen: () => boolean;
  setIsSearchPanelOpen: (open: boolean) => void;
  toggleSearchPanel: () => void;
  searchPanelWidth: () => number;
  setSearchPanelWidth: (width: number) => void;

  // UI state - Filters panel
  isFiltersPanelOpen: () => boolean;
  setIsFiltersPanelOpen: (open: boolean) => void;
  toggleFiltersPanel: () => void;
  filtersPanelWidth: () => number;
  setFiltersPanelWidth: (width: number) => void;

  // Results state
  lastSearchQuery: () => string;
  setLastSearchQuery: (query: string) => void;
  lastSearchDomain: () => SearchDomain;
  setLastSearchDomain: (domain: SearchDomain) => void;

  // Pagination state
  currentPage: () => number;
  setCurrentPage: (page: number) => void;
  pageSize: () => number;
  setPageSize: (size: number) => void;

  // Sort state
  sortBy: () => string;
  setSortBy: (sortBy: string) => void;
  sortDirection: () => "asc" | "desc";
  setSortDirection: (direction: "asc" | "desc") => void;
  toggleSortDirection: () => void;

  // Helper methods
  getMusicSearchOptions: () => MusicSearchOptions;
  getSongsSearchOptions: () => SongsSearchOptions;
  reset: () => void;
  hasActiveFilters: () => boolean;
  getFilterCount: () => number;
}

// Default values
const defaultFilters: SearchFilters = {
  artist: "",
  album: "",
  genre: "",
  year: null,
  rating_min: null,
  rating_max: null,
  favorites_only: false,
};

/**
 * Search state hook that provides state management for search functionality
 *
 * This hook manages all search-related state including query, domain, filters,
 * history, pagination, sorting, and UI state. It does not use localStorage
 * to maintain a clean, ephemeral state for each session.
 */
export function useSearchState(props: SearchStateProps = {}): SearchStateHook {
  // Initialize signals with default values
  const [query, setQuery] = createSignal(props.initialQuery || "");
  const [domain, setDomain] = createSignal<SearchDomain>(
    props.initialDomain || "music"
  );
  const [filters, setFilters] = createSignal<SearchFilters>({
    ...defaultFilters,
  });

  // History management
  const maxHistoryItems = props.maxHistoryItems || DEFAULT_MAX_HISTORY;
  const [searchHistory, setSearchHistory] = createSignal<string[]>([]);

  // UI state
  const [isSearchPanelOpen, setIsSearchPanelOpen] = createSignal(false);
  const [searchPanelWidth, setSearchPanelWidth] =
    createSignal(DEFAULT_PANEL_WIDTH);
  const [isFiltersPanelOpen, setIsFiltersPanelOpen] = createSignal(false);
  const [filtersPanelWidth, setFiltersPanelWidth] =
    createSignal(DEFAULT_PANEL_WIDTH);

  // Results state
  const [lastSearchQuery, setLastSearchQuery] = createSignal("");
  const [lastSearchDomain, setLastSearchDomain] =
    createSignal<SearchDomain>("music");

  // Pagination state
  const [currentPage, setCurrentPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(20);

  // Sort state
  const [sortBy, setSortBy] = createSignal("relevance");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
    "desc"
  );

  // Filter management
  const updateFilter = (key: keyof SearchFilters, value: any) => {
    const current = filters();
    const updated = { ...current, [key]: value };
    setFilters(updated);
  };

  const clearFilters = () => {
    setFilters({ ...defaultFilters });
  };

  // History management
  const addToHistory = (queryText: string) => {
    if (!props.enableHistory) return;

    const trimmed = queryText.trim();
    if (!trimmed) return;

    const currentHistory = searchHistory();
    const filtered = currentHistory.filter((item) => item !== trimmed);
    const updated = [trimmed, ...filtered].slice(0, maxHistoryItems);

    setSearchHistory(updated);
  };

  const removeFromHistory = (queryText: string) => {
    if (!props.enableHistory) return;

    const currentHistory = searchHistory();
    const filtered = currentHistory.filter((item) => item !== queryText);
    setSearchHistory(filtered);
  };

  const clearHistory = () => {
    setSearchHistory([]);
  };

  // UI state helpers
  const toggleSearchPanel = () => {
    setIsSearchPanelOpen(!isSearchPanelOpen());
  };

  const toggleFiltersPanel = () => {
    setIsFiltersPanelOpen(!isFiltersPanelOpen());
  };

  const toggleSortDirection = () => {
    setSortDirection(sortDirection() === "asc" ? "desc" : "asc");
  };

  // Helper methods
  const getMusicSearchOptions = (): MusicSearchOptions => {
    const currentFilters = filters();
    return {
      q: query(),
      artist: currentFilters.artist || undefined,
      album: currentFilters.album || undefined,
      genre: currentFilters.genre || undefined,
      year: currentFilters.year || undefined,
      rating_min: currentFilters.rating_min || undefined,
      rating_max: currentFilters.rating_max || undefined,
      favorites_only: currentFilters.favorites_only || undefined,
      page: currentPage(),
      page_size: pageSize(),
      sort_by: sortBy() as SortBy,
      sort_direction: sortDirection(),
    };
  };

  const getSongsSearchOptions = (): SongsSearchOptions => {
    const currentFilters = filters();
    return {
      q: query(),
      artist: currentFilters.artist || undefined,
      album: currentFilters.album || undefined,
      genre: currentFilters.genre || undefined,
      year: currentFilters.year || undefined,
      rating_min: currentFilters.rating_min || undefined,
      rating_max: currentFilters.rating_max || undefined,
      favorites_only: currentFilters.favorites_only || undefined,
      page: currentPage(),
      page_size: pageSize(),
      sort_by: sortBy() as SortBy,
      sort_direction: sortDirection(),
    };
  };

  const hasActiveFilters = (): boolean => {
    const currentFilters = filters();
    return (
      currentFilters.artist !== "" ||
      currentFilters.album !== "" ||
      currentFilters.genre !== "" ||
      currentFilters.year !== null ||
      currentFilters.rating_min !== null ||
      currentFilters.rating_max !== null ||
      currentFilters.favorites_only !== false
    );
  };

  const getFilterCount = (): number => {
    const currentFilters = filters();
    let count = 0;
    if (currentFilters.artist) count++;
    if (currentFilters.album) count++;
    if (currentFilters.genre) count++;
    if (currentFilters.year !== null) count++;
    if (currentFilters.rating_min !== null) count++;
    if (currentFilters.rating_max !== null) count++;
    if (currentFilters.favorites_only) count++;
    return count;
  };

  const reset = () => {
    setQuery("");
    setDomain("music");
    setFilters({ ...defaultFilters });
    setCurrentPage(1);
    setSortBy("relevance");
    setSortDirection("desc");
    setLastSearchQuery("");
    setLastSearchDomain("music");
  };

  return {
    // Query state
    query,
    setQuery,

    // Domain state
    domain,
    setDomain,

    // Filter state
    filters,
    setFilters,
    updateFilter,
    clearFilters,

    // History state
    searchHistory,
    addToHistory,
    removeFromHistory,
    clearHistory,

    // UI state - Search panel
    isSearchPanelOpen,
    setIsSearchPanelOpen,
    toggleSearchPanel,
    searchPanelWidth,
    setSearchPanelWidth,

    // UI state - Filters panel
    isFiltersPanelOpen,
    setIsFiltersPanelOpen,
    toggleFiltersPanel,
    filtersPanelWidth,
    setFiltersPanelWidth,

    // Results state
    lastSearchQuery,
    setLastSearchQuery,
    lastSearchDomain,
    setLastSearchDomain,

    // Pagination state
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,

    // Sort state
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    toggleSortDirection,

    // Helper methods
    getMusicSearchOptions,
    getSongsSearchOptions,
    reset,
    hasActiveFilters,
    getFilterCount,
  };
}

export default useSearchState;
