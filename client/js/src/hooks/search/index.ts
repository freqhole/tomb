// Search Hooks - Phase 2: SolidJS Integration
// Export all search-related hooks for easy importing

export { useSearch } from "./useSearch.js";
export type { UseSearchProps, UseSearchReturn } from "./useSearch.js";

export { useSearchSuggestions } from "./useSearchSuggestions.js";
export type {
  UseSearchSuggestionsProps,
  UseSearchSuggestionsReturn,
} from "./useSearchSuggestions.js";

export { useSearchState } from "./useSearchState.js";
export type {
  SearchStateProps,
  SearchFilters,
  SearchState,
  SearchStateHook,
} from "./useSearchState.js";

export { useSearchData } from "./useSearchData.js";
export type { UseSearchDataProps, SearchDataReturn } from "./useSearchData.js";

export { useSearchAll } from "./useSearchAll.js";
export type { UseSearchAllProps, UseSearchAllReturn } from "./useSearchAll.js";

// Re-export search types for convenience
export type {
  SearchDomain,
  SearchResult,
  SongsSearchResult,
  SearchResultItem,
  SearchSuggestion,
  MusicSearchOptions,
  SongsSearchOptions,
  SuggestionsOptions,
} from "../../lib/search-types.js";
