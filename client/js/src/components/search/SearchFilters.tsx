/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";

import { useSearchState } from "../../hooks/search/index.js";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface SearchFiltersProps {
  /** Whether to use internal search state hook */
  useInternalState?: boolean;
  /** External filters (when not using internal state) */
  filters?: Record<string, any>;
  /** External filter change handler (when not using internal state) */
  onFiltersChange?: (filters: Record<string, any>) => void;
  /** Available filter options */
  filterOptions?: {
    genres?: FilterOption[];
    types?: FilterOption[];
    [key: string]: FilterOption[] | undefined;
  };
  /** Whether filters are loading */
  loading?: boolean;
  /** Additional CSS classes */
  class?: string;
  /** Whether to show filter counts */
  showCounts?: boolean;
  /** Whether to start expanded */
  startExpanded?: boolean;
  /** Whether to show the expand/collapse toggle */
  showToggle?: boolean;
  /** Whether to show the query input field */
  showQueryInput?: boolean;
  /** Whether to show structured search mode */
  showStructured?: boolean;
}

export function SearchFilters(props: SearchFiltersProps) {
  const useInternal = props.useInternalState !== false;
  const searchState = useInternal ? useSearchState({}) : null;

  const [isExpanded, setIsExpanded] = createSignal(
    props.startExpanded !== false
  );
  const [searchMode, setSearchMode] = createSignal<"simple" | "structured">(
    "simple"
  );
  const [structuredQuery, setStructuredQuery] = createSignal("");

  // Get current filters
  const currentFilters = () => {
    if (useInternal && searchState) {
      const filters = searchState.filters();
      return {
        query: searchState.query(),
        genre: filters.genre,
        year: filters.year,
        rating_min: filters.rating_min,
        rating_max: filters.rating_max,
        favorites_only: filters.favorites_only,
        types: [],
        sortBy: searchState.sortBy(),
        sortOrder: searchState.sortDirection(),
      };
    }
    return props.filters || {};
  };

  // Handle filter change
  const handleFilterChange = (filterKey: string, value: any) => {
    if (useInternal && searchState) {
      // Update internal state
      switch (filterKey) {
        case "query":
          searchState.setQuery(value);
          break;
        case "genre":
          searchState.updateFilter("genre", value);
          break;
        case "year":
          searchState.updateFilter("year", value ? parseInt(value) : null);
          break;
        case "rating_min":
          searchState.updateFilter(
            "rating_min",
            value ? parseInt(value) : null
          );
          break;
        case "rating_max":
          searchState.updateFilter(
            "rating_max",
            value ? parseInt(value) : null
          );
          break;
        case "favorites_only":
          searchState.updateFilter("favorites_only", value);
          break;
        case "sortBy":
          searchState.setSortBy(value);
          break;
        case "sortOrder":
          searchState.setSortDirection(value);
          break;
        default:
          // For filters not directly supported, update external state
          const newFilters = { ...currentFilters() };
          if (value === "" || value === null || value === undefined) {
            delete newFilters[filterKey];
          } else {
            newFilters[filterKey] = value;
          }
          props.onFiltersChange?.(newFilters);
          break;
      }
    } else {
      // Update external state
      const newFilters = { ...currentFilters() };

      if (value === "" || value === null || value === undefined) {
        delete newFilters[filterKey];
      } else {
        newFilters[filterKey] = value;
      }

      props.onFiltersChange?.(newFilters);
    }
  };

  // Handle structured query parsing
  const parseStructuredQuery = (query: string) => {
    const filters: Record<string, any> = {};
    const parts = query.split(/\s+/);

    parts.forEach((part) => {
      const match = part.match(/^(\w+):(.+)$/);
      if (match) {
        const [, key, value] = match;
        // Handle different value types
        if (key && value) {
          if (value === "true") filters[key] = true;
          else if (value === "false") filters[key] = false;
          else if (!isNaN(Number(value))) filters[key] = Number(value);
          else filters[key] = value;
        }
      }
    });

    return filters;
  };

  // Handle structured query change
  const handleStructuredQueryChange = (query: string) => {
    setStructuredQuery(query);
    if (searchMode() === "structured") {
      const filters = parseStructuredQuery(query);
      props.onFiltersChange?.(filters);
    }
  };

  // Handle clear all filters
  const handleClearAll = () => {
    if (useInternal && searchState) {
      searchState.setQuery("");
      searchState.clearFilters();
      searchState.setSortBy("relevance");
      searchState.setSortDirection("desc");
    } else {
      props.onFiltersChange?.({});
    }
    setStructuredQuery("");
  };

  // Check if any filters are active
  const hasActiveFilters = () => {
    const filters = currentFilters();
    return Object.keys(filters).some((key) => {
      const value = filters[key];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    });
  };

  // Get active filter count
  const activeFilterCount = () => {
    const filters = currentFilters();
    return Object.keys(filters).filter((key) => {
      const value = filters[key];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    }).length;
  };

  // Quick filter suggestions
  const quickFilters = [
    { key: "favorites_only", value: true, label: "Favorites" },
    { key: "rating_min", value: 4, label: "High Rated (4+)" },
    { key: "rating_min", value: 3, label: "Good Rated (3+)" },
  ];

  return (
    <div class={`search-filters ${props.class || ""}`}>
      <div class="search-filters__header">
        <h3 class="search-filters__title">
          Filters
          <Show when={activeFilterCount() > 0}>
            <span class="search-filters__count">({activeFilterCount()})</span>
          </Show>
        </h3>

        <div class="search-filters__actions">
          <Show when={hasActiveFilters()}>
            <button
              class="search-filters__clear-button"
              onClick={handleClearAll}
              type="button"
            >
              Clear All
            </button>
          </Show>

          <Show when={props.showToggle !== false}>
            <button
              class="search-filters__toggle-button"
              onClick={() => setIsExpanded(!isExpanded())}
              type="button"
              aria-expanded={isExpanded()}
            >
              {isExpanded() ? "Collapse" : "Expand"}
            </button>
          </Show>
        </div>
      </div>

      <Show when={props.loading}>
        <div class="search-filters__loading">Loading filters...</div>
      </Show>

      <Show when={!props.loading && (isExpanded() || hasActiveFilters())}>
        <div class="search-filters__content">
          {/* Mode Toggle */}
          <Show when={props.showStructured !== false}>
            <div class="search-filters__mode-toggle">
              <button
                class={`search-filters__mode-button ${searchMode() === "simple" ? "active" : ""}`}
                onClick={() => setSearchMode("simple")}
                type="button"
              >
                Simple
              </button>
              <button
                class={`search-filters__mode-button ${searchMode() === "structured" ? "active" : ""}`}
                onClick={() => setSearchMode("structured")}
                type="button"
              >
                Structured
              </button>
            </div>
          </Show>

          <Show when={searchMode() === "simple"}>
            <div class="search-filters__simple">
              {/* Query Filter */}
              <Show when={props.showQueryInput !== false}>
                <div class="search-filters__group">
                  <label class="search-filters__label">
                    Search Query
                    <input
                      type="text"
                      class="search-filters__input"
                      value={currentFilters().query || ""}
                      onInput={(e) =>
                        handleFilterChange("query", e.currentTarget.value)
                      }
                      placeholder="Enter search terms..."
                    />
                  </label>
                </div>
              </Show>

              {/* Quick Filters */}
              <div class="search-filters__group">
                <label class="search-filters__label">Quick Filters</label>
                <div class="search-filters__quick-filters">
                  <For each={quickFilters}>
                    {(filter) => (
                      <button
                        class={`search-filters__quick-filter ${
                          currentFilters()[filter.key] === filter.value
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          const currentValue = currentFilters()[filter.key];
                          const newValue =
                            currentValue === filter.value ? null : filter.value;
                          handleFilterChange(filter.key, newValue);
                        }}
                        type="button"
                      >
                        {filter.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              {/* Genre Filter */}
              <Show when={props.filterOptions?.genres}>
                <div class="search-filters__group">
                  <label class="search-filters__label">Genre</label>
                  <select
                    class="search-filters__select"
                    value={currentFilters().genre || ""}
                    onChange={(e) =>
                      handleFilterChange("genre", e.currentTarget.value)
                    }
                  >
                    <option value="">All Genres</option>
                    <For each={props.filterOptions?.genres}>
                      {(option) => (
                        <option value={option.value}>
                          {option.label}
                          <Show
                            when={
                              props.showCounts && option.count !== undefined
                            }
                          >
                            ({option.count})
                          </Show>
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </Show>

              {/* Manual Filters */}
              <div class="search-filters__group">
                <label class="search-filters__label">Manual Filters</label>
                <div class="search-filters__manual-grid">
                  <input
                    type="text"
                    class="search-filters__input"
                    value={currentFilters().genre || ""}
                    onInput={(e) =>
                      handleFilterChange("genre", e.currentTarget.value)
                    }
                    placeholder="Genre (e.g. jazz, rock)"
                  />
                  <input
                    type="number"
                    class="search-filters__input"
                    value={currentFilters().year || ""}
                    onInput={(e) =>
                      handleFilterChange("year", e.currentTarget.value)
                    }
                    placeholder="Year (e.g. 2023)"
                  />
                </div>
              </div>

              {/* Rating Filter */}
              <div class="search-filters__group">
                <label class="search-filters__label">Rating</label>
                <div class="search-filters__range">
                  <input
                    type="number"
                    class="search-filters__input search-filters__input--small"
                    value={currentFilters().rating_min || ""}
                    onInput={(e) =>
                      handleFilterChange("rating_min", e.currentTarget.value)
                    }
                    placeholder="Min"
                    min="1"
                    max="5"
                  />
                  <span class="search-filters__range-separator">to</span>
                  <input
                    type="number"
                    class="search-filters__input search-filters__input--small"
                    value={currentFilters().rating_max || ""}
                    onInput={(e) =>
                      handleFilterChange("rating_max", e.currentTarget.value)
                    }
                    placeholder="Max"
                    min="1"
                    max="5"
                  />
                </div>
              </div>

              {/* Favorites Filter */}
              <div class="search-filters__group">
                <label class="search-filters__checkbox-label">
                  <input
                    type="checkbox"
                    class="search-filters__checkbox"
                    checked={currentFilters().favorites_only || false}
                    onChange={(e) =>
                      handleFilterChange(
                        "favorites_only",
                        e.currentTarget.checked
                      )
                    }
                  />
                  Show favorites only
                </label>
              </div>
            </div>
          </Show>

          <Show when={searchMode() === "structured"}>
            <div class="search-filters__structured">
              <div class="search-filters__group">
                <label class="search-filters__label">
                  Structured Query
                  <textarea
                    class="search-filters__textarea"
                    value={structuredQuery()}
                    onInput={(e) =>
                      handleStructuredQueryChange(e.currentTarget.value)
                    }
                    placeholder="e.g. genre:jazz rating_min:4 favorites_only:true"
                    rows={3}
                  />
                </label>
                <div class="search-filters__help">
                  Use key:value format. Examples: genre:jazz, rating_min:4,
                  year:2023, favorites_only:true
                </div>
              </div>
            </div>
          </Show>

          {/* Active Filters Display */}
          <Show when={hasActiveFilters()}>
            <div class="search-filters__active">
              <label class="search-filters__label">Active Filters</label>
              <div class="search-filters__active-list">
                <For each={Object.entries(currentFilters())}>
                  {([key, value]) => (
                    <Show
                      when={
                        value !== undefined && value !== null && value !== ""
                      }
                    >
                      <div class="search-filters__active-chip">
                        <span class="search-filters__active-key">{key}:</span>
                        <span class="search-filters__active-value">
                          {String(value)}
                        </span>
                        <button
                          class="search-filters__active-remove"
                          onClick={() => handleFilterChange(key, null)}
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    </Show>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <style>{`
        .search-filters {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .search-filters__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .search-filters__title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #333;
        }

        .search-filters__count {
          color: #666;
          font-weight: normal;
          margin-left: 8px;
        }

        .search-filters__actions {
          display: flex;
          gap: 8px;
        }

        .search-filters__clear-button,
        .search-filters__toggle-button {
          padding: 4px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          cursor: pointer;
          font-size: 12px;
        }

        .search-filters__clear-button {
          background: #dc3545;
          color: white;
          border-color: #dc3545;
        }

        .search-filters__loading {
          text-align: center;
          padding: 16px;
          color: #666;
        }

        .search-filters__content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .search-filters__mode-toggle {
          display: flex;
          gap: 4px;
          background: #f5f5f5;
          padding: 4px;
          border-radius: 4px;
        }

        .search-filters__mode-button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
        }

        .search-filters__mode-button.active {
          background: #007bff;
          color: white;
        }

        .search-filters__group {
          margin-bottom: 16px;
        }

        .search-filters__label {
          display: block;
          margin-bottom: 4px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .search-filters__input,
        .search-filters__select,
        .search-filters__textarea {
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
        }

        .search-filters__input:focus,
        .search-filters__select:focus,
        .search-filters__textarea:focus {
          border-color: #007bff;
        }

        .search-filters__textarea {
          font-family: monospace;
          resize: vertical;
        }

        .search-filters__help {
          margin-top: 4px;
          font-size: 12px;
          color: #666;
        }

        .search-filters__quick-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .search-filters__quick-filter {
          padding: 4px 8px;
          border: 1px solid #ccc;
          border-radius: 16px;
          background: white;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .search-filters__quick-filter.active {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }

        .search-filters__manual-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .search-filters__input--small {
          width: auto;
          flex: 1;
        }

        .search-filters__range {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-filters__range-separator {
          color: #666;
          font-size: 14px;
        }

        .search-filters__checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          cursor: pointer;
        }

        .search-filters__checkbox {
          margin: 0;
        }

        .search-filters__active-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .search-filters__active-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          background: #007bff;
          color: white;
          padding: 4px 8px;
          border-radius: 16px;
          font-size: 12px;
        }

        .search-filters__active-key {
          opacity: 0.8;
        }

        .search-filters__active-value {
          font-weight: 500;
        }

        .search-filters__active-remove {
          background: rgba(255, 255, 255, 0.2);
          border: none;
          color: white;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
        }
      `}</style>
    </div>
  );
}
