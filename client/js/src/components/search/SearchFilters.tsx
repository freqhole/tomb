/* @jsxImportSource solid-js */
import { createSignal, For, Show, createEffect } from "solid-js";

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
  onFiltersChange?: (filters: Record<string, any> | null) => void;
  /** Available filter options */
  filterOptions?: {
    genres?: FilterOption[];
    types?: FilterOption[];
    [key: string]: FilterOption[] | undefined;
  };
  /** Quick filter suggestions */
  quickFilters?: Array<{
    key: string;
    value: any;
    label: string;
    description?: string;
    category: string;
  }>;
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

  const [localQuery, setLocalQuery] = createSignal("");

  // Sync local query with external filters
  createEffect(() => {
    const currentQuery = currentFilters().query || "";
    setLocalQuery(currentQuery);
  });

  // Get current filters
  // Parse current filters into display format
  const currentFilters = () => {
    if (useInternal && searchState) {
      const filters = searchState.filters();
      return {
        query: searchState.query(),
        genre: filters.genre || "",
        year: filters.year || "",
        rating_min: filters.rating_min || "",
        rating_max: filters.rating_max || "",
        favorites_only: filters.favorites_only || false,
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
            // For clearing, we want to set it to the default value, not delete
            if (filterKey === "favorites_only") {
              newFilters[filterKey] = false;
            } else {
              delete newFilters[filterKey];
            }
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
        // For clearing, we want to set it to the default value, not delete
        if (filterKey === "favorites_only") {
          newFilters[filterKey] = false;
        } else {
          delete newFilters[filterKey];
        }
      } else {
        newFilters[filterKey] = value;
      }

      props.onFiltersChange?.(newFilters);
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
      // Set to default/empty values instead of null
      const clearedFilters = {
        query: "",
        genre: "",
        artist: "",
        year: "",
        rating_min: "",
        rating_max: "",
        favorites_only: false,
        sortBy: "",
        sortOrder: "",
      };
      props.onFiltersChange?.(clearedFilters);
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
        value !== false &&
        !(key === "sortBy" && value === "") &&
        !(key === "sortOrder" && value === "") &&
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
        value !== false &&
        !(key === "sortBy" && value === "") &&
        !(key === "sortOrder" && value === "") &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    }).length;
  };

  // Quick filter suggestions (use props or defaults)
  const quickFilters = () =>
    props.quickFilters || [
      {
        key: "favorites_only",
        value: true,
        label: "Favorites",
        category: "favorites",
      },
      {
        key: "rating_min",
        value: 4,
        label: "High Rated (4+)",
        category: "rating",
      },
      {
        key: "rating_min",
        value: 3,
        label: "Good Rated (3+)",
        category: "rating",
      },
    ];

  // Search type options
  const searchTypes = [
    {
      value: "websearch",
      label: "Web Search",
      description: "Natural language with operators",
    },
    {
      value: "plainto",
      label: "Plain Text",
      description: "Simple text matching",
    },
    { value: "phrase", label: "Phrase", description: "Exact phrase matching" },
  ];

  // Sort options
  const sortOptions = [
    { value: "", label: "No Sorting" },
    { value: "relevance", label: "Relevance" },
    { value: "created_at", label: "Date Created" },
    { value: "title", label: "Title" },
    { value: "artist", label: "Artist" },
    { value: "album", label: "Album" },
    { value: "rating", label: "Rating" },
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

          <div class="search-filters__simple">
            {/* Query Filter */}
            <Show when={props.showQueryInput !== false}>
              <div class="search-filters__group">
                <label class="search-filters__label">
                  Search Query
                  <input
                    type="text"
                    class="search-filters__input"
                    value={localQuery()}
                    onInput={(e) => {
                      setLocalQuery(e.currentTarget.value);
                    }}
                    onBlur={(e) => {
                      const newFilters = { ...currentFilters() };
                      newFilters.query = e.currentTarget.value;
                      props.onFiltersChange?.(newFilters);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const newFilters = { ...currentFilters() };
                        newFilters.query = e.currentTarget.value;
                        props.onFiltersChange?.(newFilters);
                      }
                    }}
                    placeholder="Enter search terms..."
                  />
                </label>
              </div>
            </Show>

            {/* Quick Filters */}
            <div class="search-filters__group">
              <label class="search-filters__label">Quick Filters</label>

              {/* Favorites & Rating Quick Filters */}
              <div class="search-filters__quick-category">
                <h5 class="search-filters__category-title">
                  Favorites & Rating
                </h5>
                <div class="search-filters__quick-filters">
                  <For
                    each={quickFilters().filter(
                      (f) =>
                        f.category === "favorites" || f.category === "rating"
                    )}
                  >
                    {(filter) => (
                      <button
                        class={`search-filters__quick-filter ${
                          currentFilters()[filter.key] === filter.value
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          const newFilters = { ...currentFilters() };
                          const currentValue = currentFilters()[filter.key];
                          if (currentValue === filter.value) {
                            // Toggle off - reset to default
                            newFilters[filter.key] =
                              filter.key === "favorites_only" ? false : "";
                          } else {
                            // Toggle on
                            newFilters[filter.key] = filter.value;
                          }
                          props.onFiltersChange?.(newFilters);
                        }}
                        type="button"
                        title={filter.description}
                      >
                        {filter.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              {/* Genre Quick Filters */}
              <div class="search-filters__quick-category">
                <h5 class="search-filters__category-title">Genres</h5>
                <div class="search-filters__quick-filters">
                  <For
                    each={quickFilters().filter((f) => f.category === "genre")}
                  >
                    {(filter) => (
                      <button
                        class={`search-filters__quick-filter ${
                          currentFilters()[filter.key] === filter.value
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          const newFilters = { ...currentFilters() };
                          const currentValue = currentFilters()[filter.key];
                          if (currentValue === filter.value) {
                            // Toggle off - reset to default
                            newFilters[filter.key] = "";
                          } else {
                            // Toggle on
                            newFilters[filter.key] = filter.value;
                          }
                          props.onFiltersChange?.(newFilters);
                        }}
                        type="button"
                        title={filter.description}
                      >
                        {filter.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              {/* Time & Features Quick Filters */}
              <div class="search-filters__quick-category">
                <h5 class="search-filters__category-title">Time & Features</h5>
                <div class="search-filters__quick-filters">
                  <For
                    each={quickFilters().filter(
                      (f) => f.category === "time" || f.category === "features"
                    )}
                  >
                    {(filter) => (
                      <button
                        class={`search-filters__quick-filter ${
                          currentFilters()[filter.key] === filter.value
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          const newFilters = { ...currentFilters() };
                          const currentValue = currentFilters()[filter.key];
                          if (currentValue === filter.value) {
                            // Toggle off - reset to default
                            newFilters[filter.key] = "";
                          } else {
                            // Toggle on
                            newFilters[filter.key] = filter.value;
                          }
                          props.onFiltersChange?.(newFilters);
                        }}
                        type="button"
                        title={filter.description}
                      >
                        {filter.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>

            {/* Genre Filter */}
            <Show when={props.filterOptions?.genres}>
              <div class="search-filters__group">
                <label class="search-filters__label">Genre</label>
                <select
                  class="search-filters__select"
                  value={currentFilters().genre || ""}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    const newFilters = { ...currentFilters() };
                    if (value === "") {
                      newFilters.genre = "";
                    } else {
                      newFilters.genre = value;
                    }
                    props.onFiltersChange?.(newFilters);
                  }}
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
                  type="text"
                  class="search-filters__input"
                  value={currentFilters().year || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    if (value === "" || !isNaN(Number(value))) {
                      const newFilters = { ...currentFilters() };
                      newFilters.year = value === "" ? "" : Number(value);
                      props.onFiltersChange?.(newFilters);
                    }
                  }}
                  placeholder="Year (e.g. 2023)"
                />
                <input
                  type="text"
                  class="search-filters__input"
                  value={currentFilters().key_signature || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    handleFilterChange("key_signature", value || null);
                  }}
                  placeholder="Key (e.g. C, Am)"
                />
                <input
                  type="text"
                  class="search-filters__input"
                  value={currentFilters().bpm_min || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    if (value === "" || !isNaN(Number(value))) {
                      handleFilterChange(
                        "bpm_min",
                        value === "" ? null : Number(value)
                      );
                    }
                  }}
                  placeholder="Min BPM"
                />
              </div>
            </div>

            {/* Rating Filter */}
            <div class="search-filters__group">
              <label class="search-filters__label">Rating</label>
              <div class="search-filters__range">
                <input
                  type="text"
                  class="search-filters__input search-filters__input--small"
                  value={currentFilters().rating_min || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    if (
                      value === "" ||
                      (!isNaN(Number(value)) &&
                        Number(value) >= 1 &&
                        Number(value) <= 5)
                    ) {
                      const newFilters = { ...currentFilters() };
                      newFilters.rating_min = value === "" ? "" : Number(value);
                      props.onFiltersChange?.(newFilters);
                    }
                  }}
                  placeholder="Min"
                />
                <span class="search-filters__range-separator">to</span>
                <input
                  type="text"
                  class="search-filters__input search-filters__input--small"
                  value={currentFilters().rating_max || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    if (
                      value === "" ||
                      (!isNaN(Number(value)) &&
                        Number(value) >= 1 &&
                        Number(value) <= 5)
                    ) {
                      const newFilters = { ...currentFilters() };
                      newFilters.rating_max = value === "" ? "" : Number(value);
                      props.onFiltersChange?.(newFilters);
                    }
                  }}
                  placeholder="Max"
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
                  onChange={(e) => {
                    const newFilters = { ...currentFilters() };
                    newFilters.favorites_only = e.currentTarget.checked;
                    props.onFiltersChange?.(newFilters);
                  }}
                />
                Show favorites only
              </label>
            </div>

            {/* Search Type */}
            <div class="search-filters__group">
              <label class="search-filters__label">Search Type</label>
              <select
                class="search-filters__select"
                value={currentFilters().search_type || "websearch"}
                onChange={(e) =>
                  handleFilterChange("search_type", e.currentTarget.value)
                }
              >
                <For each={searchTypes}>
                  {(type) => (
                    <option value={type.value} title={type.description}>
                      {type.label}
                    </option>
                  )}
                </For>
              </select>
            </div>

            {/* Sort Options */}
            <div class="search-filters__group">
              <label class="search-filters__label">Sort By</label>
              <select
                class="search-filters__select"
                value={currentFilters().sortBy || ""}
                onChange={(e) => {
                  const newFilters = { ...currentFilters() };
                  newFilters.sortBy = e.currentTarget.value;
                  props.onFiltersChange?.(newFilters);
                }}
              >
                <For each={sortOptions}>
                  {(option) => (
                    <option value={option.value}>{option.label}</option>
                  )}
                </For>
              </select>
            </div>

            {/* Sort Direction */}
            <div class="search-filters__group">
              <label class="search-filters__label">Sort Direction</label>
              <select
                class="search-filters__select"
                value={currentFilters().sortOrder || ""}
                onChange={(e) => {
                  const newFilters = { ...currentFilters() };
                  newFilters.sortOrder = e.currentTarget.value;
                  props.onFiltersChange?.(newFilters);
                }}
              >
                <option value="">No Direction</option>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>

          {/* Active Filters Display */}
          <Show when={hasActiveFilters()}>
            <div class="search-filters__active">
              <label class="search-filters__label">Active Filters</label>
              <div class="search-filters__active-list">
                <For each={Object.entries(currentFilters())}>
                  {([key, value]) => (
                    <Show
                      when={
                        value !== undefined &&
                        value !== null &&
                        value !== "" &&
                        value !== false &&
                        !(key === "sortBy" && value === "") &&
                        !(key === "sortOrder" && value === "") &&
                        !(Array.isArray(value) && value.length === 0)
                      }
                    >
                      <div class="search-filters__active-chip">
                        <span class="search-filters__active-key">{key}:</span>
                        <span class="search-filters__active-value">
                          {String(value)}
                        </span>
                        <button
                          class="search-filters__active-remove"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Directly update the filters object and call onFiltersChange
                            const newFilters = { ...currentFilters() };
                            if (key === "favorites_only") {
                              newFilters[key] = false;
                            } else {
                              newFilters[key] = "";
                            }
                            props.onFiltersChange?.(newFilters);
                          }}
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
          font-size: 16px;
          font-weight: 600;
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
          padding: 6px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: white;
          cursor: pointer;
          font-size: 12px;
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



        .search-filters__group {
          margin-bottom: 16px;
        }

        .search-filters__label {
          display: block;
          margin-bottom: 4px;
          font-size: 14px;
          font-weight: 500;
        }

        .search-filters__input,
        .search-filters__select,
        .search-filters__textarea {
          width: 100%;
          padding: 6px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
        }

        .search-filters__input:focus,
        .search-filters__select:focus,
        .search-filters__textarea:focus {
          border-color: #000;
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

        .search-filters__quick-category {
          margin-bottom: 1rem;
        }

        .search-filters__quick-category:last-child {
          margin-bottom: 0;
        }

        .search-filters__category-title {
          font-size: 12px;
          font-weight: 500;
          color: black;
          margin: 0 0 0.5rem 0;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .search-filters__quick-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .search-filters__quick-filter {
          padding: 4px 8px;
          border: 1px solid #ccc;
          border-radius: 12px;
          background: white;
          cursor: pointer;
          font-size: 12px;
        }

        .search-filters__quick-filter.active {
          background: black;
          color: white;
          border-color: black;
        }

        .search-filters__manual-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .search-filters__input--small {
          width: 60px;
          flex: 0 0 60px;
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
          background: black;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
        }

        .search-filters__active-key {
          opacity: 0.8;
          color: white !important;
        }

        .search-filters__active-value {
          font-weight: 500;
          color: white !important;
        }

        .search-filters__active-remove {
          background: rgba(255, 255, 255, 0.3);
          border: none;
          color: white;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
        }

        .search-filters__active-remove:hover {
          background: rgba(255, 255, 255, 0.5);
        }


      `}</style>
    </div>
  );
}
