/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { ComponentEventRegistry } from "../event-registry.js";
import { SearchSuggestions } from "../../../components/search/SearchSuggestions.js";

export interface SearchPreset {
  id: string;
  label: string;
  filters: Record<string, any>;
  icon?: string;
}

export interface AdminSearchHeaderProps {
  /** Current search query */
  searchQuery: () => string;
  /** Update search query */
  onSearchChange: (query: string) => void;
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
  suggestions?: () => string[];
  /** Handle suggestion selection */
  onSuggestionSelect?: (suggestion: string) => void;
  /** Search presets */
  presets?: SearchPreset[];
  /** Apply preset */
  onPresetApply?: (preset: SearchPreset) => void;
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
  const [searchFocused, setSearchFocused] = createSignal(false);
  const [showSuggestions, setShowSuggestions] = createSignal(false);
  const [inputValue, setInputValue] = createSignal(props.searchQuery());

  let searchInputRef: HTMLInputElement | undefined;

  // handle input value changes without immediate search
  const handleSearchInput = (value: string) => {
    setInputValue(value);
    setShowSuggestions(true);
  };

  // handle search execution
  const executeSearch = () => {
    props.onSearchChange(inputValue());
    setShowSuggestions(false);
  };

  // setup search input events
  const setupSearchEvents = () => {
    if (!searchInputRef) return;

    eventRegistry.register(searchInputRef, "focus", () => {
      setSearchFocused(true);
      if (
        inputValue().length > 1 &&
        props.suggestions &&
        props.suggestions().length > 0
      ) {
        console.log(
          "AdminSearchHeader: showing suggestions on focus, count:",
          props.suggestions().length
        );
        setShowSuggestions(true);
      }
    });

    eventRegistry.register(searchInputRef, "blur", () => {
      // delay hiding suggestions to allow clicks
      setTimeout(() => {
        setSearchFocused(false);
      }, 150);
    });

    eventRegistry.register(searchInputRef, "keydown", (event: Event) => {
      const keyEvent = event as KeyboardEvent;

      // Handle various keyboard events
      if (keyEvent.key === "Enter") {
        // Execute search on Enter
        keyEvent.preventDefault();
        executeSearch();
      } else if (keyEvent.key === "Escape") {
        if (showSuggestions()) {
          keyEvent.preventDefault();
          setShowSuggestions(false);
        } else if (props.showAdvancedSearch()) {
          keyEvent.preventDefault();
          props.onToggleAdvancedSearch(false);
        } else {
          keyEvent.preventDefault();
          setInputValue("");
          props.onSearchChange("");
          searchInputRef?.blur();
        }
      }
    });
  };

  // setup advanced search panel events
  const setupAdvancedSearchEvents = () => {
    if (!props.showAdvancedSearch()) return;

    eventRegistry.register(document, "keydown", (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === "Escape" && !searchFocused()) {
        props.onToggleAdvancedSearch(false);
        keyEvent.preventDefault();
      }
    });
  };

  // cleanup advanced search events
  const cleanupAdvancedSearchEvents = () => {
    // ComponentEventRegistry will handle cleanup on component unmount
  };

  // Execute search when explicit searching is needed
  const handleSearchButtonClick = () => {
    executeSearch();
  };

  // handle preset application
  const handlePresetClick = (preset: SearchPreset) => {
    props.onPresetApply?.(preset);
  };

  // reactive effects
  createEffect(() => {
    if (props.showAdvancedSearch()) {
      setupAdvancedSearchEvents();
    } else {
      cleanupAdvancedSearchEvents();
    }
  });

  // Track suggestions and query changes
  createEffect(() => {
    const suggestions = props.suggestions?.() || [];
    console.log(
      "AdminSearchHeader: suggestions changed, count:",
      suggestions.length
    );

    if (suggestions.length === 0) {
      setShowSuggestions(false);
    } else if (inputValue().length > 1) {
      setShowSuggestions(true);
    }
  });

  // Keep input value in sync with external search query
  createEffect(() => {
    setInputValue(props.searchQuery());
  });

  // mount/cleanup
  onMount(() => {
    setupSearchEvents();
  });

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
          {/* search input container */}
          <div class="flex-1 relative">
            <div class="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={inputValue()}
                onInput={(e) => handleSearchInput(e.target.value)}
                placeholder="search music library..."
                class="w-full bg-gray-900 text-white px-4 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none"
                autocomplete="off"
              />

              {/* search icon or loading spinner */}
              <button
                onClick={handleSearchButtonClick}
                class="absolute right-3 top-1/2 transform -translate-y-1/2 bg-transparent border-none cursor-pointer p-0"
                title="search"
                aria-label="search"
              >
                <Show
                  when={props.loading?.()}
                  fallback={
                    <svg
                      class="w-4 h-4 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  }
                >
                  <div class="animate-spin h-4 w-4 border border-magenta-500 border-t-transparent"></div>
                </Show>
              </button>
            </div>

            {/* search suggestions */}
            <SearchSuggestions
              query={inputValue()}
              suggestions={props.suggestions?.() || []}
              onSuggestionSelect={(suggestion) => {
                setInputValue(suggestion);
                executeSearch(); // Execute search with the selected suggestion
                props.onSuggestionSelect?.(suggestion);
                setShowSuggestions(false);
              }}
              show={
                showSuggestions() &&
                props.suggestions &&
                props.suggestions().length > 0
              }
              loading={props.loading?.()}
              showLoading={true}
              onBlur={() => setShowSuggestions(false)}
              class="bg-black border-gray-700 text-gray-300"
              position="bottom"
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
          <div class="flex items-center space-x-2 mt-3">
            <span class="text-xs text-gray-400 mr-2">quick filters:</span>
            {props.presets!.map((preset) => (
              <button
                onClick={() => handlePresetClick(preset)}
                class="px-2 py-1 bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs font-medium transition-colors"
                title={preset.label}
              >
                {preset.icon && <span class="mr-1">{preset.icon}</span>}
                {preset.label}
              </button>
            ))}
          </div>
        </Show>

        {/* filter summary and results count */}
        <Show when={props.filterSummary?.() || props.resultsCount?.()}>
          <div class="flex items-center justify-between mt-3 text-sm">
            <Show when={props.filterSummary?.()}>
              <div class="text-gray-400">
                active filters:{" "}
                <span class="text-magenta-400">{props.filterSummary!()}</span>
              </div>
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
