/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { ComponentEventRegistry } from "../event-registry.js";

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
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
    createSignal(-1);

  let searchInputRef: HTMLInputElement | undefined;
  let suggestionsRef: HTMLDivElement | undefined;

  // debounced search handler
  let searchTimeout: number | undefined;
  const handleSearchInput = (value: string) => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(() => {
      props.onSearchChange(value);
    }, 300);
  };

  // setup search input events
  const setupSearchEvents = () => {
    if (!searchInputRef) return;

    eventRegistry.register(searchInputRef, "focus", () => {
      setSearchFocused(true);
      if (props.suggestions && props.suggestions().length > 0) {
        setShowSuggestions(true);
      }
    });

    eventRegistry.register(searchInputRef, "blur", () => {
      // delay hiding suggestions to allow clicks
      setTimeout(() => {
        setSearchFocused(false);
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
      }, 150);
    });

    eventRegistry.register(searchInputRef, "keydown", (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      const suggestions = props.suggestions?.() || [];

      switch (keyEvent.key) {
        case "Enter":
          keyEvent.preventDefault();
          if (selectedSuggestionIndex() >= 0 && suggestions.length > 0) {
            const suggestion = suggestions[selectedSuggestionIndex()];
            if (suggestion) {
              props.onSuggestionSelect?.(suggestion);
              setShowSuggestions(false);
            }
          }
          break;

        case "Escape":
          keyEvent.preventDefault();
          if (props.showAdvancedSearch()) {
            props.onToggleAdvancedSearch(false);
          } else if (showSuggestions()) {
            setShowSuggestions(false);
          } else {
            props.onSearchChange("");
            searchInputRef?.blur();
          }
          break;

        case "ArrowDown":
          if (suggestions.length > 0) {
            keyEvent.preventDefault();
            setShowSuggestions(true);
            setSelectedSuggestionIndex((prev) =>
              prev < suggestions.length - 1 ? prev + 1 : prev
            );
          }
          break;

        case "ArrowUp":
          if (suggestions.length > 0) {
            keyEvent.preventDefault();
            setShowSuggestions(true);
            setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
          }
          break;

        default:
          // show suggestions on typing
          if (keyEvent.key.length === 1) {
            setTimeout(() => {
              if (props.suggestions && props.suggestions().length > 0) {
                setShowSuggestions(true);
                setSelectedSuggestionIndex(-1);
              }
            }, 100);
          }
          break;
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

  // handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    props.onSuggestionSelect?.(suggestion);
    setShowSuggestions(false);
    searchInputRef?.focus();
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

  createEffect(() => {
    const suggestions = props.suggestions?.() || [];
    if (suggestions.length === 0) {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  });

  // mount/cleanup
  onMount(() => {
    setupSearchEvents();
  });

  onCleanup(() => {
    clearTimeout(searchTimeout);
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
                value={props.searchQuery()}
                onInput={(e) => handleSearchInput(e.target.value)}
                placeholder="search music library..."
                class="w-full bg-gray-900 text-white px-4 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none"
                autocomplete="off"
              />

              {/* search icon or loading spinner */}
              <div class="absolute right-3 top-1/2 transform -translate-y-1/2">
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
              </div>
            </div>

            {/* search suggestions */}
            <Show
              when={
                showSuggestions() &&
                props.suggestions &&
                props.suggestions().length > 0
              }
            >
              <div
                ref={suggestionsRef}
                class="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 border-t-0 z-50 max-h-60 overflow-y-auto"
              >
                {props.suggestions!().map((suggestion, index) => (
                  <div
                    class={`px-4 py-2 cursor-pointer hover:bg-gray-700 ${
                      selectedSuggestionIndex() === index ? "bg-gray-700" : ""
                    }`}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    <div class="text-white text-sm">{suggestion}</div>
                  </div>
                ))}
              </div>
            </Show>
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
