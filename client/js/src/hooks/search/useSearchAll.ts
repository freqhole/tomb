import { createMemo } from "solid-js";
import type { ApiClient } from "../../lib/api-client.js";
import { useSearch } from "./useSearch.js";
import { useSearchSuggestions } from "./useSearchSuggestions.js";
import { useSearchState } from "./useSearchState.js";
import { useSearchData } from "./useSearchData.js";
import type { SearchDomain } from "../../lib/search/types.js";
import type { MediaBlob } from "../../lib/websocket-types.js";

export interface UseSearchAllProps {
  apiClient: ApiClient;
  initialQuery?: string;
  initialDomain?: SearchDomain;
  enableHistory?: boolean;
  enableSuggestions?: boolean;
  debounceMs?: number;
  autoSearch?: boolean;
  integrationMode?: "standalone" | "freqhole-integrated";
  webSocketItems?: () => MediaBlob[];
  onError?: (error: Error) => void;
}

export interface UseSearchAllReturn {
  // Search state and actions
  state: ReturnType<typeof useSearchState>;

  // Main search functionality
  search: ReturnType<typeof useSearch>;

  // Suggestions functionality
  suggestions: ReturnType<typeof useSearchSuggestions>;

  // Data processing
  data: ReturnType<typeof useSearchData>;

  // Combined actions
  performSearch: () => Promise<void>;
  performSongsSearch: () => Promise<void>;
  clearAll: () => void;

  // Combined computed state
  isActive: () => boolean;
  hasAnyResults: () => boolean;
  totalResultsCount: () => number;
  canPerformSearch: () => boolean;
}

/**
 * Comprehensive search hook that combines all search functionality
 *
 * This hook provides a unified interface for all search operations,
 * combining state management, search execution, suggestions, and data processing.
 */
export function useSearchAll(props: UseSearchAllProps): UseSearchAllReturn {
  // Initialize search state
  const state = useSearchState({
    initialQuery: props.initialQuery,
    initialDomain: props.initialDomain,
    enableHistory: props.enableHistory,
  });

  // Initialize main search functionality
  const search = useSearch({
    apiClient: props.apiClient,
    initialQuery: props.initialQuery,
    initialDomain: props.initialDomain,
    debounceMs: props.debounceMs,
    autoSearch: props.autoSearch,
    onError: props.onError,
  });

  // Initialize suggestions (if enabled)
  const suggestions = useSearchSuggestions({
    apiClient: props.apiClient,
    query: search.query,
    debounceMs: props.debounceMs,
    enabled: props.enableSuggestions,
    onError: props.onError,
  });

  // Initialize data processing
  const data = useSearchData({
    searchResults: search.results,
    songsResults: search.songsResults,
    searchState: state,
    integrationMode: props.integrationMode,
    webSocketItems: props.webSocketItems,
  });

  // Combined actions
  const performSearch = async () => {
    const query = state.query();
    const options = state.getMusicSearchOptions();

    // Add to history
    if (query.trim()) {
      state.addToHistory(query);
      state.setLastSearchQuery(query);
      state.setLastSearchDomain(state.domain());
    }

    // Synchronize the search hook's query with the state query
    search.setQuery(query);

    // Perform the search
    await search.search(options);
  };

  const performSongsSearch = async () => {
    const query = state.query();
    const options = state.getSongsSearchOptions();

    // Add to history
    if (query.trim()) {
      state.addToHistory(query);
      state.setLastSearchQuery(query);
      state.setLastSearchDomain(state.domain());
    }

    // Synchronize the search hook's query with the state query
    search.setQuery(query);

    // Perform the search
    await search.searchSongs(options);
  };

  const clearAll = () => {
    search.clearResults();
    suggestions.clearSuggestions();
    state.setQuery("");
    state.setCurrentPage(1);
  };

  // Combined computed state
  const isActive = createMemo(() => {
    return (
      search.loading() ||
      suggestions.loading() ||
      state.query().trim().length > 0
    );
  });

  const hasAnyResults = createMemo(() => {
    return search.hasResults() || data.hasResults();
  });

  const totalResultsCount = createMemo(() => {
    return data.searchStats().totalResults;
  });

  const canPerformSearch = createMemo(() => {
    return search.canSearch() && !search.loading();
  });

  return {
    // Individual hooks
    state,
    search,
    suggestions,
    data,

    // Combined actions
    performSearch,
    performSongsSearch,
    clearAll,

    // Combined computed state
    isActive,
    hasAnyResults,
    totalResultsCount,
    canPerformSearch,
  };
}

export default useSearchAll;
