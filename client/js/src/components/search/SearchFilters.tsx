/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";

import { useSearchState } from "../../hooks/useSearchState.js";

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
    artists?: FilterOption[];
    years?: FilterOption[];
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
}

export function SearchFilters(props: SearchFiltersProps) {
  const useInternal = props.useInternalState !== false;

  // Use internal state or external state
  const searchState = useInternal ? useSearchState({}) : null;

  const [isExpanded, setIsExpanded] = createSignal(
    props.startExpanded !== false
  );

  // Get current filters
  const currentFilters = () => {
    if (useInternal && searchState) {
      const filters = searchState.filters();
      return {
        query: searchState.query(),
        genre: filters.genre,
        artist: filters.artist,
        yearFrom: filters.year,
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
        case "artist":
          searchState.updateFilter("artist", value);
          break;
        case "yearFrom":
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

  // Handle multi-select filter change
  const handleMultiSelectChange = (
    filterKey: string,
    value: string,
    checked: boolean
  ) => {
    const currentValues = currentFilters()[filterKey] || [];
    let newValues: string[];

    if (checked) {
      newValues = [...currentValues, value];
    } else {
      newValues = currentValues.filter((v: string) => v !== value);
    }

    handleFilterChange(filterKey, newValues.length > 0 ? newValues : undefined);
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
                        when={props.showCounts && option.count !== undefined}
                      >
                        ({option.count})
                      </Show>
                    </option>
                  )}
                </For>
              </select>
            </div>
          </Show>

          {/* Artist Filter */}
          <Show when={props.filterOptions?.artists}>
            <div class="search-filters__group">
              <label class="search-filters__label">Artist</label>
              <select
                class="search-filters__select"
                value={currentFilters().artist || ""}
                onChange={(e) =>
                  handleFilterChange("artist", e.currentTarget.value)
                }
              >
                <option value="">All Artists</option>
                <For each={props.filterOptions?.artists}>
                  {(option) => (
                    <option value={option.value}>
                      {option.label}
                      <Show
                        when={props.showCounts && option.count !== undefined}
                      >
                        ({option.count})
                      </Show>
                    </option>
                  )}
                </For>
              </select>
            </div>
          </Show>

          {/* Year Range Filter */}
          <div class="search-filters__group">
            <label class="search-filters__label">Year</label>
            <div class="search-filters__range">
              <input
                type="number"
                class="search-filters__input"
                value={currentFilters().yearFrom || ""}
                onInput={(e) =>
                  handleFilterChange("yearFrom", e.currentTarget.value)
                }
                placeholder="Year"
                min="1900"
                max="2024"
              />
            </div>
          </div>

          {/* Type Filter (Multi-select) */}
          <Show when={props.filterOptions?.types}>
            <div class="search-filters__group">
              <label class="search-filters__label">Type</label>
              <div class="search-filters__checkboxes">
                <For each={props.filterOptions?.types}>
                  {(option) => (
                    <label class="search-filters__checkbox-label">
                      <input
                        type="checkbox"
                        class="search-filters__checkbox"
                        checked={(currentFilters().types || []).includes(
                          option.value
                        )}
                        onChange={(e) =>
                          handleMultiSelectChange(
                            "types",
                            option.value,
                            e.currentTarget.checked
                          )
                        }
                      />
                      {option.label}
                      <Show
                        when={props.showCounts && option.count !== undefined}
                      >
                        <span class="search-filters__option-count">
                          ({option.count})
                        </span>
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>

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
                  handleFilterChange("favorites_only", e.currentTarget.checked)
                }
              />
              Favorites Only
            </label>
          </div>

          {/* Sort Options */}
          <div class="search-filters__group">
            <label class="search-filters__label">Sort By</label>
            <select
              class="search-filters__select"
              value={currentFilters().sortBy || "relevance"}
              onChange={(e) =>
                handleFilterChange("sortBy", e.currentTarget.value)
              }
            >
              <option value="relevance">Relevance</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="duration">Duration</option>
              <option value="created">Date Created</option>
            </select>
          </div>

          {/* Sort Order */}
          <div class="search-filters__group">
            <label class="search-filters__label">Sort Order</label>
            <select
              class="search-filters__select"
              value={currentFilters().sortOrder || "desc"}
              onChange={(e) =>
                handleFilterChange("sortOrder", e.currentTarget.value)
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </div>
      </Show>

      <style>{`
        .search-filters {
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          background: white;
        }

        .search-filters__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #e0e0e0;
          background-color: #f8f9fa;
        }

        .search-filters__title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #333;
        }

        .search-filters__count {
          color: #666;
          font-weight: normal;
          font-size: 14px;
        }

        .search-filters__actions {
          display: flex;
          gap: 8px;
        }

        .search-filters__clear-button,
        .search-filters__toggle-button {
          padding: 4px 8px;
          border: 1px solid #ccc;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .search-filters__clear-button:hover,
        .search-filters__toggle-button:hover {
          border-color: #007bff;
          background-color: #f8f9fa;
        }

        .search-filters__loading {
          padding: 16px;
          text-align: center;
          color: #666;
        }

        .search-filters__content {
          padding: 16px;
        }

        .search-filters__group {
          margin-bottom: 16px;
        }

        .search-filters__group:last-child {
          margin-bottom: 0;
        }

        .search-filters__label {
          display: block;
          margin-bottom: 4px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }

        .search-filters__input,
        .search-filters__select {
          width: 100%;
          padding: 6px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-filters__input:focus,
        .search-filters__select:focus {
          border-color: #007bff;
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

        .search-filters__checkboxes {
          display: flex;
          flex-direction: column;
          gap: 8px;
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

        .search-filters__option-count {
          color: #666;
          font-size: 12px;
          margin-left: 4px;
        }
      `}</style>
    </div>
  );
}

export default SearchFilters;
