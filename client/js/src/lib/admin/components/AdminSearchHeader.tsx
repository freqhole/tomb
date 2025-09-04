/* @jsxImportSource solid-js */
import { onCleanup, Show } from "solid-js";
import { ComponentEventRegistry } from "../event-registry.js";
import {
  SearchBar,
  SearchPresets,
  SearchSummary,
} from "../../../components/search/index.js";
import type {
  SearchSuggestion,
  SearchPreset,
  SearchField,
} from "../../../components/search/index.js";

export interface AdminSearchHeaderProps {
  /** Current search query */
  searchQuery: () => string;
  /** Update search query */
  onSearchChange: (query: string) => void;
  /** Execute search with current query */
  onSearchExecute?: (query: string) => void;
  /** Current filter state */
  filters: () => Record<string, any>;
  /** Update filters */
  onFiltersChange: (filters: Record<string, any>) => void;
  /** Clear all filters */
  onClearFilters: () => void;
  /** Whether advanced search is expanded */
  showAdvancedSearch: () => boolean;
  /** Toggle advanced search */
  onToggleAdvancedSearch: (show: boolean) => void;
  /** Search suggestions */
  suggestions?: () => SearchSuggestion[];
  /** Handle suggestion selection */
  onSuggestionSelect?: (suggestion: string) => void;
  /** Function to fetch suggestions */
  onFetchSuggestions?: (query: string) => Promise<SearchSuggestion[]>;
  /** Search presets */
  presets?: SearchPreset[];
  /** Apply preset */
  onPresetApply?: (preset: SearchPreset) => void;
  /** Function to check if preset is active */
  isPresetActive?: (preset: SearchPreset) => boolean;
  /** Available search fields */
  searchFields?: SearchField[];
  /** Current selected search field */
  searchField?: string;
  /** Callback when search field changes */
  onSearchFieldChange?: (field: string) => void;
  /** Whether search is loading */
  loading?: () => boolean;
  /** Total results count */
  resultsCount?: () => number;
  /** Active filters summary */
  filterSummary?: () => string;
  /** CSS class */
  className?: string;
}

/**
 * Generic admin search header with:
 * - Search input with suggestions
 * - Advanced filter toggle
 * - Filter presets
 * - Filter summary display
 * - Keyboard navigation
 */
export function AdminSearchHeader(props: AdminSearchHeaderProps) {
  const eventRegistry = new ComponentEventRegistry();

  // handle search execution
  const executeSearch = (query: string) => {
    if (props.onSearchExecute) {
      props.onSearchExecute(query);
    } else {
      props.onSearchChange(query);
    }
  };

  // handle preset application
  const handlePresetClick = (preset: SearchPreset) => {
    props.onPresetApply?.(preset);
  };

  // cleanup on unmount
  onCleanup(() => {
    eventRegistry.cleanup();
  });

  const hasActiveFilters = () => {
    const filters = props.filters();
    return Object.keys(filters).some(
      (key) =>
        filters[key] !== undefined &&
        filters[key] !== "" &&
        filters[key] !== null
    );
  };

  return (
    <div
      class={`admin-search-header bg-black border-b border-gray-800 ${props.className || ""}`}
    >
      {/* main search bar */}
      <div class="px-6 py-4">
        <div class="flex items-center space-x-4">
          {/* search bar container */}
          <div class="flex-1">
            <SearchBar
              value={props.searchQuery()}
              onInput={props.onSearchChange}
              onSearch={executeSearch}
              placeholder="search music library..."
              showSuggestions={true}
              suggestions={props.suggestions?.()}
              onFetchSuggestions={props.onFetchSuggestions}
              onSuggestionSelect={props.onSuggestionSelect}
              suggestionsLoading={props.loading?.()}
              searchFields={props.searchFields}
              searchField={props.searchField}
              onSearchFieldChange={props.onSearchFieldChange}
              class="mb-0"
            />
          </div>

          {/* advanced search toggle */}
          <button
            onClick={() =>
              props.onToggleAdvancedSearch(!props.showAdvancedSearch())
            }
            class={`px-4 py-2 text-sm font-medium transition-colors ${
              props.showAdvancedSearch()
                ? "bg-magenta-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
            title="toggle advanced search"
          >
            advanced
          </button>

          {/* clear filters button */}
          <Show when={hasActiveFilters()}>
            <button
              onClick={() => props.onClearFilters()}
              class="px-3 py-2 bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium transition-colors"
              title="clear all filters"
            >
              clear filters
            </button>
          </Show>
        </div>

        {/* search presets */}
        <Show when={props.presets && props.presets.length > 0}>
          <div class="mt-3">
            <SearchPresets
              presets={props.presets!}
              currentParams={props.filters()}
              onPresetToggle={handlePresetClick}
              isPresetActive={props.isPresetActive}
              label="quick filters:"
              showDescriptions={true}
            />
          </div>
        </Show>

        {/* filter summary and results count */}
        <Show when={props.filterSummary?.() || props.resultsCount?.()}>
          <div class="flex items-center justify-between mt-3 text-sm">
            <Show when={props.filterSummary?.()}>
              <SearchSummary
                filters={props.filters()}
                getSummary={props.filterSummary}
                class="flex-1"
              />
            </Show>
            <Show when={props.resultsCount?.() !== undefined}>
              <div class="text-gray-400">{props.resultsCount!()} results</div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
