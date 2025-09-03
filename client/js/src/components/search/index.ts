// Search Components Export Index

export { SearchInput } from "./SearchInput.js";
export type { SearchInputProps, SearchSuggestion } from "./SearchInput.js";

export { SearchSuggestions } from "./SearchSuggestions.js";
export type { SearchSuggestionsProps } from "./SearchSuggestions.js";

export { SearchFilters } from "./SearchFilters.js";
export type {
  SearchFiltersProps,
  FilterOption,
  FilterField,
} from "./SearchFilters.js";

export { SearchPresets } from "./SearchPresets.js";
export type { SearchPresetsProps, SearchPreset } from "./SearchPresets.js";

export { SearchSummary } from "./SearchSummary.js";
export type { SearchSummaryProps } from "./SearchSummary.js";

export { SearchFieldSelector } from "./SearchFieldSelector.js";
export type {
  SearchFieldSelectorProps,
  SearchField,
} from "./SearchFieldSelector.js";

export { SearchSortControls } from "./SearchSortControls.js";
export type {
  SearchSortControlsProps,
  SortField,
} from "./SearchSortControls.js";

export { SearchAdvancedFilters } from "./SearchAdvancedFilters.js";
export type {
  SearchAdvancedFiltersProps,
  AdvancedFilterConfig,
} from "./SearchAdvancedFilters.js";

export { SearchBar } from "./SearchBar.js";
export type { SearchBarProps } from "./SearchBar.js";

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
export { useSearch } from "../../hooks/search/index.js";
export { useSearchAll } from "../../hooks/search/index.js";
export { useSearchData } from "../../hooks/search/index.js";
export { useSearchState } from "../../hooks/search/index.js";
export { useSearchSuggestions } from "../../hooks/search/index.js";

// Re-export search types
export type {
  SearchDomain,
  SearchOptions,
  MusicSearchOptions,
  SongsSearchOptions,
  SearchResult as ApiSearchResult,
  SearchResult,
  SongsSearchResult,
} from "../../lib/search/types.js";

/*
 * Composable Search Components - Usage Examples
 *
 * Simple search (just input with suggestions):
 * ```tsx
 * <SearchInput
 *   value={query}
 *   onInput={setQuery}
 *   onSearch={handleSearch}
 *   showSuggestions={true}
 * />
 * ```
 *
 * Search with quick presets:
 * ```tsx
 * <SearchInput {...searchProps} />
 * <SearchPresets
 *   presets={musicPresets}
 *   currentParams={filters}
 *   onPresetToggle={handlePresetToggle}
 * />
 * ```
 *
 * Full search experience:
 * ```tsx
 * <SearchInput {...searchProps} />
 * <SearchPresets {...presetProps} />
 * <SearchFilters
 *   filters={filters}
 *   filterFields={musicFilterFields}
 *   onFiltersChange={updateFilters}
 * />
 * <SearchSummary
 *   filters={filters}
 *   onClearAll={clearFilters}
 * />
 * ```
 *
 * All components follow dark theme design rules:
 * - Black, white, magenta color scheme
 * - No border-radius (border-radius: 0)
 * - Tailwind CSS classes
 * - Bottom margin on search input
 */
