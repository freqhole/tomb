/* @jsxImportSource solid-js */
import { SearchFieldSelector } from "./SearchFieldSelector.js";
import { SearchInput } from "./SearchInput.js";
import type { SearchField } from "./SearchFieldSelector.js";
import type { SearchInputProps } from "./SearchInput.js";

export interface SearchBarProps extends Omit<SearchInputProps, "class"> {
  /** Current selected search field */
  searchField?: string;
  /** Callback when search field changes */
  onSearchFieldChange?: (field: string) => void;
  /** Available search fields */
  searchFields?: SearchField[];
  /** Whether to show the field selector */
  showFieldSelector?: boolean;
  /** Additional CSS classes */
  class?: string;
}

const defaultSearchFields: SearchField[] = [
  { value: "all", label: "all", description: "search all fields" },
  { value: "title", label: "title", description: "search song titles" },
  { value: "artist", label: "artist", description: "search artist names" },
  { value: "album", label: "album", description: "search album names" },
  { value: "genre", label: "genre", description: "search genres" },
];

export function SearchBar(props: SearchBarProps) {
  const searchFields = () => props.searchFields || defaultSearchFields;
  const showFieldSelector = () => !!props.showFieldSelector;

  return (
    <div class={`search-bar ${props.class || ""}`}>
      <div class="flex items-stretch bg-black text-white border border-gray-600">
        {/* field selector */}
        {showFieldSelector() && (
          <SearchFieldSelector
            value={props.searchField}
            onChange={props.onSearchFieldChange}
            fields={searchFields()}
            disabled={props.disabled}
          />
        )}

        {/* search input */}
        <div class="relative flex-1">
          <SearchInput
            value={props.value}
            onInput={props.onInput}
            onSearch={props.onSearch}
            onFetchSuggestions={props.onFetchSuggestions}
            suggestions={props.suggestions}
            onSuggestionSelect={props.onSuggestionSelect}
            placeholder={props.placeholder}
            disabled={props.disabled}
            showSearchButton={props.showSearchButton}
            searchButtonText={props.searchButtonText}
            autoSearch={props.autoSearch}
            debounceMs={props.debounceMs}
            showSuggestions={props.showSuggestions}
            maxSuggestions={props.maxSuggestions}
            onClear={props.onClear}
            suggestionsLoading={props.suggestionsLoading}
            class="mb-0 flex-1 border-0"
          />
        </div>
      </div>
    </div>
  );
}

export default SearchBar;
