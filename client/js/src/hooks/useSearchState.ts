import { createSignal } from "solid-js";
import type {
  SearchDomain,
  MusicSearchOptions,
  SongsSearchOptions,
} from "../lib/search-types.js";

export interface SearchStateProps {
  initialQuery?: string;
  initialDomain?: SearchDomain;
  enableHistory?: boolean;
  maxHistoryItems?: number;
}

const STORAGE_KEY = "search-state";
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

// Load state from localStorage
function loadState(): Partial<SearchState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Save state to localStorage
function saveState(updates: Partial<SearchState>) {
  try {
    const current = loadState();
    const updated = { ...current, ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
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

  // Pagination state
  currentPage: () => number;
  setCurrentPage: (page: number) => void;
  pageSize: () => number;
  setPageSize: (size: number) => void;
  nextPage: () => void;
  prevPage: () => void;

  // Sort state
  sortBy: () => string;
  setSortBy: (field: string) => void;
  sortDirection: () => "asc" | "desc";
  setSortDirection: (direction: "asc" | "desc") => void;
  handleSort: (field: string, direction: "asc" | "desc") => void;

  // Last search tracking
  lastSearchQuery: () => string;
  setLastSearchQuery: (query: string) => void;
  lastSearchDomain: () => SearchDomain;
  setLastSearchDomain: (domain: SearchDomain) => void;

  // Utility functions
  loadState: () => Partial<SearchState>;
  saveState: (updates: Partial<SearchState>) => void;
  resetState: () => void;

  // Computed options for API calls
  getMusicSearchOptions: () => MusicSearchOptions;
  getSongsSearchOptions: () => SongsSearchOptions;
}

export function useSearchState(props: SearchStateProps): SearchStateHook {
  const initialState = loadState();

  // Core search state
  const [query, setQuery] = createSignal<string>(
    props.initialQuery || initialState.query || ""
  );
  const [domain, setDomain] = createSignal<SearchDomain>(
    props.initialDomain || initialState.domain || "music"
  );

  // Filter state
  const [filters, setFilters] = createSignal<SearchFilters>(
    initialState.filters || {
      artist: "",
      album: "",
      genre: "",
      year: null,
      rating_min: null,
      rating_max: null,
      favorites_only: false,
    }
  );

  // History state
  const [searchHistory, setSearchHistory] = createSignal<string[]>(
    initialState.history || []
  );

  // UI state - Search panel
  const [isSearchPanelOpen, setIsSearchPanelOpen] = createSignal<boolean>(
    initialState.isSearchPanelOpen || false
  );
  const [searchPanelWidth, setSearchPanelWidth] = createSignal<number>(
    initialState.searchPanelWidth || DEFAULT_PANEL_WIDTH
  );

  // UI state - Filters panel
  const [isFiltersPanelOpen, setIsFiltersPanelOpen] = createSignal<boolean>(
    initialState.isFiltersPanelOpen || false
  );
  const [filtersPanelWidth, setFiltersPanelWidth] = createSignal<number>(
    initialState.filtersPanelWidth || DEFAULT_PANEL_WIDTH
  );

  // Pagination state
  const [currentPage, setCurrentPage] = createSignal<number>(
    initialState.currentPage || 1
  );
  const [pageSize, setPageSize] = createSignal<number>(
    initialState.pageSize || 20
  );

  // Sort state
  const [sortBy, setSortBy] = createSignal<string>(
    initialState.sortBy || "relevance"
  );
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
    initialState.sortDirection || "desc"
  );

  // Last search tracking
  const [lastSearchQuery, setLastSearchQuery] = createSignal<string>(
    initialState.lastSearchQuery || ""
  );
  const [lastSearchDomain, setLastSearchDomain] = createSignal<SearchDomain>(
    initialState.lastSearchDomain || "music"
  );

  // Filter update function
  const updateFilter = (key: keyof SearchFilters, value: any) => {
    const current = filters();
    const updated = { ...current, [key]: value };
    setFilters(updated);

    // Save to localStorage
    saveState({ filters: updated });
  };

  // Clear filters function
  const clearFilters = () => {
    const clearedFilters: SearchFilters = {
      artist: "",
      album: "",
      genre: "",
      year: null,
      rating_min: null,
      rating_max: null,
      favorites_only: false,
    };
    setFilters(clearedFilters);
    saveState({ filters: clearedFilters });
  };

  // History management
  const addToHistory = (queryText: string) => {
    if (!props.enableHistory) return;

    const trimmed = queryText.trim();
    if (!trimmed) return;

    const current = searchHistory();
    const maxItems = props.maxHistoryItems || DEFAULT_MAX_HISTORY;

    // Remove if already exists
    const filtered = current.filter((item) => item !== trimmed);

    // Add to beginning and limit length
    const updated = [trimmed, ...filtered].slice(0, maxItems);

    setSearchHistory(updated);
    saveState({ history: updated });
  };

  const removeFromHistory = (queryText: string) => {
    const current = searchHistory();
    const updated = current.filter((item) => item !== queryText);
    setSearchHistory(updated);
    saveState({ history: updated });
  };

  const clearHistory = () => {
    setSearchHistory([]);
    saveState({ history: [] });
  };

  // Panel toggle functions
  const toggleSearchPanel = () => {
    const newState = !isSearchPanelOpen();
    setIsSearchPanelOpen(newState);
    saveState({ isSearchPanelOpen: newState });
  };

  const toggleFiltersPanel = () => {
    const newState = !isFiltersPanelOpen();
    setIsFiltersPanelOpen(newState);
    saveState({ isFiltersPanelOpen: newState });
  };

  // Pagination functions
  const nextPage = () => {
    const newPage = currentPage() + 1;
    setCurrentPage(newPage);
    saveState({ currentPage: newPage });
  };

  const prevPage = () => {
    const newPage = Math.max(1, currentPage() - 1);
    setCurrentPage(newPage);
    saveState({ currentPage: newPage });
  };

  // Sort handling
  const handleSort = (field: string, direction: "asc" | "desc") => {
    setSortBy(field);
    setSortDirection(direction);
    saveState({ sortBy: field, sortDirection: direction });
  };

  // Reset state function
  const resetState = () => {
    setQuery("");
    setDomain("music");
    clearFilters();
    setCurrentPage(1);
    setSortBy("relevance");
    setSortDirection("desc");
    setIsSearchPanelOpen(false);
    setIsFiltersPanelOpen(false);

    // Don't clear history on reset
    saveState({
      query: "",
      domain: "music",
      filters: {
        artist: "",
        album: "",
        genre: "",
        year: null,
        rating_min: null,
        rating_max: null,
        favorites_only: false,
      },
      currentPage: 1,
      sortBy: "relevance",
      sortDirection: "desc",
      isSearchPanelOpen: false,
      isFiltersPanelOpen: false,
    });
  };

  // Computed options for API calls
  const getMusicSearchOptions = (): MusicSearchOptions => {
    const currentFilters = filters();
    const options: MusicSearchOptions = {
      q: query(),
      page: currentPage(),
      page_size: pageSize(),
      sort_by: sortBy() as any,
      sort_direction: sortDirection(),
    };

    // Add non-empty filters
    if (currentFilters.artist) options.artist = currentFilters.artist;
    if (currentFilters.album) options.album = currentFilters.album;
    if (currentFilters.genre) options.genre = currentFilters.genre;
    if (currentFilters.year) options.year = currentFilters.year;
    if (currentFilters.rating_min)
      options.rating_min = currentFilters.rating_min;
    if (currentFilters.rating_max)
      options.rating_max = currentFilters.rating_max;
    if (currentFilters.favorites_only)
      options.favorites_only = currentFilters.favorites_only;

    return options;
  };

  const getSongsSearchOptions = (): SongsSearchOptions => {
    const currentFilters = filters();
    const options: SongsSearchOptions = {
      q: query(),
      page: currentPage(),
      page_size: pageSize(),
      sort_by: sortBy() as any,
      sort_direction: sortDirection(),
    };

    // Add non-empty filters
    if (currentFilters.artist) options.artist = currentFilters.artist;
    if (currentFilters.album) options.album = currentFilters.album;
    if (currentFilters.genre) options.genre = currentFilters.genre;
    if (currentFilters.year) options.year = currentFilters.year;
    if (currentFilters.rating_min)
      options.rating_min = currentFilters.rating_min;
    if (currentFilters.rating_max)
      options.rating_max = currentFilters.rating_max;
    if (currentFilters.favorites_only)
      options.favorites_only = currentFilters.favorites_only;

    return options;
  };

  // Auto-save state changes
  const saveStateWrapper = (updates: Partial<SearchState>) => {
    saveState(updates);
  };

  // Enhanced setters that auto-save
  const setQueryWithSave = (newQuery: string) => {
    setQuery(newQuery);
    saveState({ query: newQuery });
  };

  const setDomainWithSave = (newDomain: SearchDomain) => {
    setDomain(newDomain);
    saveState({ domain: newDomain });
  };

  const setFiltersWithSave = (newFilters: SearchFilters) => {
    setFilters(newFilters);
    saveState({ filters: newFilters });
  };

  const setSearchPanelWidthWithSave = (width: number) => {
    setSearchPanelWidth(width);
    saveState({ searchPanelWidth: width });
  };

  const setFiltersPanelWidthWithSave = (width: number) => {
    setFiltersPanelWidth(width);
    saveState({ filtersPanelWidth: width });
  };

  const setCurrentPageWithSave = (page: number) => {
    setCurrentPage(page);
    saveState({ currentPage: page });
  };

  const setPageSizeWithSave = (size: number) => {
    setPageSize(size);
    saveState({ pageSize: size });
  };

  const setSortByWithSave = (field: string) => {
    setSortBy(field);
    saveState({ sortBy: field });
  };

  const setSortDirectionWithSave = (direction: "asc" | "desc") => {
    setSortDirection(direction);
    saveState({ sortDirection: direction });
  };

  const setLastSearchQueryWithSave = (queryText: string) => {
    setLastSearchQuery(queryText);
    saveState({ lastSearchQuery: queryText });
  };

  const setLastSearchDomainWithSave = (searchDomain: SearchDomain) => {
    setLastSearchDomain(searchDomain);
    saveState({ lastSearchDomain: searchDomain });
  };

  const setIsSearchPanelOpenWithSave = (open: boolean) => {
    setIsSearchPanelOpen(open);
    saveState({ isSearchPanelOpen: open });
  };

  const setIsFiltersPanelOpenWithSave = (open: boolean) => {
    setIsFiltersPanelOpen(open);
    saveState({ isFiltersPanelOpen: open });
  };

  return {
    // Core state
    query,
    setQuery: setQueryWithSave,
    domain,
    setDomain: setDomainWithSave,

    // Filter state
    filters,
    setFilters: setFiltersWithSave,
    updateFilter,
    clearFilters,

    // History state
    searchHistory,
    addToHistory,
    removeFromHistory,
    clearHistory,

    // UI state - Search panel
    isSearchPanelOpen,
    setIsSearchPanelOpen: setIsSearchPanelOpenWithSave,
    toggleSearchPanel,
    searchPanelWidth,
    setSearchPanelWidth: setSearchPanelWidthWithSave,

    // UI state - Filters panel
    isFiltersPanelOpen,
    setIsFiltersPanelOpen: setIsFiltersPanelOpenWithSave,
    toggleFiltersPanel,
    filtersPanelWidth,
    setFiltersPanelWidth: setFiltersPanelWidthWithSave,

    // Pagination state
    currentPage,
    setCurrentPage: setCurrentPageWithSave,
    pageSize,
    setPageSize: setPageSizeWithSave,
    nextPage,
    prevPage,

    // Sort state
    sortBy,
    setSortBy: setSortByWithSave,
    sortDirection,
    setSortDirection: setSortDirectionWithSave,
    handleSort,

    // Last search tracking
    lastSearchQuery,
    setLastSearchQuery: setLastSearchQueryWithSave,
    lastSearchDomain,
    setLastSearchDomain: setLastSearchDomainWithSave,

    // Utility functions
    loadState,
    saveState: saveStateWrapper,
    resetState,

    // Computed options
    getMusicSearchOptions,
    getSongsSearchOptions,
  };
}

export default useSearchState;
