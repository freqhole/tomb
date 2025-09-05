/* @jsxImportSource solid-js */
import { onCleanup, Show } from "solid-js";
import { ComponentEventRegistry } from "../event-registry.js";
import { SearchBar, SearchPresets } from "../../../components/search/index.js";
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
  /** Current view mode */
  viewMode?: "compact" | "standard" | "detailed";
  /** Callback when view mode changes */
  onViewModeChange?: (mode: "compact" | "standard" | "detailed") => void;
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
    <div class={`admin-search-header bg-black ${props.className || ""}`}>
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
              showFieldSelector={false}
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

          {/* view mode toggle button */}
          <Show when={props.viewMode && props.onViewModeChange}>
            <button
              onClick={() => {
                const current = props.viewMode!;
                const modes: Array<"compact" | "standard" | "detailed"> = [
                  "compact",
                  "standard",
                  "detailed",
                ];
                const currentIndex = modes.indexOf(current);
                const nextIndex = (currentIndex + 1) % modes.length;
                const nextMode = modes[nextIndex];
                if (nextMode) {
                  props.onViewModeChange!(nextMode);
                }
              }}
              class="h-12 px-3 bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors border border-gray-600"
              title={`Current: ${props.viewMode} view - Click to cycle`}
            >
              {props.viewMode === "compact"
                ? "⊟"
                : props.viewMode === "standard"
                  ? "☰"
                  : "⊞"}
            </button>
          </Show>

          {/* advanced search toggle */}
          <button
            onClick={() =>
              props.onToggleAdvancedSearch(!props.showAdvancedSearch())
            }
            class={`h-12 px-4 text-sm font-medium transition-colors border border-gray-600 ${
              props.showAdvancedSearch()
                ? "bg-magenta-600 text-white border-magenta-600"
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
              class="h-12 px-3 bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium transition-colors border border-gray-600"
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

        {/* active filters, results count, and reset - all in one line */}
        <Show when={props.filterSummary?.() || props.resultsCount?.()}>
          <div class="flex items-center space-x-4 mt-3 text-sm">
            <Show
              when={
                props.filterSummary?.() && props.filterSummary!().trim() !== ""
              }
            >
              <span class="text-gray-300">
                active filters: {props.filterSummary!()}
              </span>
            </Show>
            <Show when={props.resultsCount?.() !== undefined}>
              <span class="text-gray-400">{props.resultsCount!()} results</span>
            </Show>
            <Show
              when={
                props.resultsCount!() > 0 ||
                props.searchQuery().trim() !== "" ||
                Object.keys(props.filters()).length > 0
              }
            >
              <button
                onClick={() => {
                  props.onSearchChange("");
                  props.onClearFilters();
                  // Execute search with empty query to refresh results
                  if (props.onSearchExecute) {
                    props.onSearchExecute("");
                  }
                }}
                class="text-xs text-magenta-400 hover:text-magenta-300 underline transition-colors"
              >
                reset
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
