// Search Hooks - Phase 2: SolidJS Integration
// Export all search-related hooks for easy importing

// Music domain-specific hooks and utilities
export * as Music from "./music/index.js";

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
} from "../../lib/search/types.js";

// Re-export music filter types for convenience
export type {
  FilterOption,
  AllFiltersResponse,
  DefaultFilterOptions,
  UseMusicFiltersProps,
  UseMusicFiltersReturn,
} from "./music/index.js";

// Re-export music filter utilities
export { useMusicFilters, createMusicFilterClient } from "./music/index.js";
