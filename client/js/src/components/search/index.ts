// Search Components Export Index

export { SearchBox } from "./SearchBox.js";
export type { SearchBoxProps } from "./SearchBox.js";

export { SearchSuggestions } from "./SearchSuggestions.js";
export type { SearchSuggestionsProps } from "./SearchSuggestions.js";

export { SearchFilters } from "./SearchFilters.js";
export type { SearchFiltersProps, FilterOption } from "./SearchFilters.js";

export {
  SearchProvider,
  useSearchContext,
  useOptionalSearchContext,
} from "./SearchContext.js";
export type {
  SearchProviderProps,
  SearchContextValue,
} from "./SearchContext.js";

// Re-export search hooks for convenience
export { useSearch } from "../../hooks/useSearch.js";
export { useSearchAll } from "../../hooks/useSearchAll.js";
export { useSearchData } from "../../hooks/useSearchData.js";
export { useSearchState } from "../../hooks/useSearchState.js";
export { useSearchSuggestions } from "../../hooks/useSearchSuggestions.js";

// Re-export search types
export type {
  SearchDomain,
  SearchOptions,
  MusicSearchOptions,
  SongsSearchOptions,
  SearchResult as ApiSearchResult,
  SearchResult,
  SongsSearchResult,
} from "../../lib/search-types.js";
