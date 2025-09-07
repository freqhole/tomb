import { createContext, useContext, ParentComponent } from "solid-js";
import {
  useFreqholeSearch,
  type FreqholeSearchReturn,
} from "../hooks/useFreqholeSearch.js";
import { apiClient } from "../../../lib/api-client.js";

// Create search context
const SearchContext = createContext<FreqholeSearchReturn>();

/**
 * Freqhole Search Context Provider
 * Provides unified search functionality across the freqhole app
 */
export const SearchProvider: ParentComponent = (props) => {
  const searchApi = useFreqholeSearch(apiClient);

  return (
    <SearchContext.Provider value={searchApi}>
      {props.children}
    </SearchContext.Provider>
  );
};

/**
 * Hook to access search context
 * Must be used within SearchProvider
 */
export function useSearchContext(): FreqholeSearchReturn {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearchContext must be used within SearchProvider");
  }
  return context;
}

/**
 * Hook for search state only (read-only)
 * Useful for components that only need to display search state
 */
export function useSearchState() {
  const search = useSearchContext();

  return {
    query: search.searchQuery,
    hasResults: search.hasResults,
    loading: search.loading,
    error: search.error,
    totalCount: search.totalCount,
    activeTab: search.activeTab,
  };
}

/**
 * Hook for search actions only
 * Useful for components that only need to trigger search actions
 */
export function useSearchActions() {
  const search = useSearchContext();

  return {
    setSearchQuery: search.setSearchQuery,
    setActiveTab: search.setActiveTab,
    updateFilters: search.updateFilters,
    clearFilters: search.clearFilters,
    clear: search.clear,
    refresh: search.refresh,
    onSuggestionSelect: search.onSuggestionSelect,
  };
}

/**
 * Hook for search results only
 * Useful for components that only need to display results
 */
export function useSearchResults() {
  const search = useSearchContext();

  return {
    songs: search.songs,
    artists: search.artists,
    albums: search.albums,
    hasResults: search.hasResults,
    totalCount: search.totalCount,
    loading: search.loading,
    error: search.error,
    pagination: search.pagination,
    loadMore: search.loadMore,
  };
}
