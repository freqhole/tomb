/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterField {
  key: string;
  label: string;
  type: "text" | "select" | "multi-select" | "range" | "boolean" | "date";
  placeholder?: string;
  options?: FilterOption[];
  min?: number;
  max?: number;
  supportsExact?: boolean;
}

export interface SearchFiltersProps {
  /** Current filter values */
  filters: Record<string, any>;
  /** Update filters callback */
  onFiltersChange: (filters: Record<string, any>) => void;
  /** Clear all filters callback */
  onClearFilters: () => void;
  /** Filter field configurations */
  filterFields: FilterField[];
  /** Available filter options (for selects) */
  filterOptions?: Record<string, FilterOption[]>;
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
  /** Quick filter presets */
  quickFilters?: Array<{
    key: string;
    value: any;
    label: string;
    description?: string;
    category?: string;
  }>;
}

export function SearchFilters(props: SearchFiltersProps) {
  const [isExpanded, setIsExpanded] = createSignal(
    props.startExpanded !== false
  );

  // handle filter change
  const handleFilterChange = (filterKey: string, value: any) => {
    const newFilters = { ...props.filters };

    if (value === "" || value === null || value === undefined) {
      delete newFilters[filterKey];
    } else {
      newFilters[filterKey] = value;
    }

    props.onFiltersChange(newFilters);
  };

  // check if any filters are active
  const hasActiveFilters = () => {
    return Object.keys(props.filters).some((key) => {
      const value = props.filters[key];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== false &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    });
  };

  // get active filter count
  const activeFilterCount = () => {
    return Object.keys(props.filters).filter((key) => {
      const value = props.filters[key];
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== false &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    }).length;
  };

  // apply quick filter (toggle on/off)
  const applyQuickFilter = (filter: any) => {
    const newFilters = { ...props.filters };

    // Check if this filter is already active with the same value
    const currentValue = props.filters[filter.key];
    const isActive =
      currentValue === filter.value ||
      (Array.isArray(currentValue) &&
        Array.isArray(filter.value) &&
        JSON.stringify(currentValue) === JSON.stringify(filter.value));

    if (isActive) {
      // Toggle off - remove the filter
      delete newFilters[filter.key];
    } else {
      // Toggle on - set the filter
      newFilters[filter.key] = filter.value;
    }

    props.onFiltersChange(newFilters);
  };

  // render filter field based on type
  const renderFilterField = (field: FilterField) => {
    const currentValue = props.filters[field.key] || "";
    const options = props.filterOptions?.[field.key] || field.options || [];

    switch (field.type) {
      case "text":
        return (
          <input
            type="text"
            value={currentValue}
            onInput={(e) => handleFilterChange(field.key, e.target.value)}
            placeholder={field.placeholder || `enter ${field.label}`}
            class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-500 focus:outline-none"
          />
        );

      case "select":
        return (
          <select
            value={currentValue}
            onChange={(e) => handleFilterChange(field.key, e.target.value)}
            class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white focus:border-magenta-500 focus:outline-none"
          >
            <option value="">all {field.label}</option>
            <For each={options}>
              {(option) => (
                <option value={option.value}>
                  {option.label}
                  {props.showCounts && option.count && ` (${option.count})`}
                </option>
              )}
            </For>
          </select>
        );

      case "multi-select":
        const selectedValues = Array.isArray(currentValue) ? currentValue : [];
        return (
          <div class="space-y-2 max-h-32 overflow-y-auto">
            <For each={options}>
              {(option) => (
                <label class="flex items-center space-x-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option.value)}
                    onChange={(e) => {
                      const newValues = e.target.checked
                        ? [...selectedValues, option.value]
                        : selectedValues.filter((v) => v !== option.value);
                      handleFilterChange(
                        field.key,
                        newValues.length > 0 ? newValues : null
                      );
                    }}
                    class="text-magenta-500 bg-gray-800 border-gray-600"
                  />
                  <span class="text-white">
                    {option.label}
                    {props.showCounts && option.count && (
                      <span class="text-gray-400 ml-1">({option.count})</span>
                    )}
                  </span>
                </label>
              )}
            </For>
          </div>
        );

      case "range":
        const [min, max] = Array.isArray(currentValue)
          ? currentValue
          : [null, null];
        return (
          <div class="flex space-x-2">
            <input
              type="number"
              value={min || ""}
              onInput={(e) => {
                const newMin = e.target.value ? parseInt(e.target.value) : null;
                handleFilterChange(
                  field.key,
                  [newMin, max].filter((v) => v !== null)
                );
              }}
              placeholder={`min ${field.label}`}
              min={field.min}
              max={field.max}
              class="flex-1 px-2 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-500 focus:outline-none text-sm"
            />
            <input
              type="number"
              value={max || ""}
              onInput={(e) => {
                const newMax = e.target.value ? parseInt(e.target.value) : null;
                handleFilterChange(
                  field.key,
                  [min, newMax].filter((v) => v !== null)
                );
              }}
              placeholder={`max ${field.label}`}
              min={field.min}
              max={field.max}
              class="flex-1 px-2 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-500 focus:outline-none text-sm"
            />
          </div>
        );

      case "boolean":
        return (
          <label class="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={currentValue === true}
              onChange={(e) =>
                handleFilterChange(field.key, e.target.checked || null)
              }
              class="text-magenta-500 bg-gray-800 border-gray-600"
            />
            <span class="text-white text-sm">{field.label}</span>
          </label>
        );

      case "date":
        return (
          <input
            type="date"
            value={currentValue}
            onChange={(e) => handleFilterChange(field.key, e.target.value)}
            class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white focus:border-magenta-500 focus:outline-none"
          />
        );

      default:
        return null;
    }
  };

  return (
    <div class={`bg-gray-900 border-b border-gray-800 ${props.class || ""}`}>
      {/* header */}
      <div class="px-6 py-3 flex items-center justify-between">
        <h3 class="text-white font-medium">
          filters
          <Show when={activeFilterCount() > 0}>
            <span class="text-magenta-400 ml-2">({activeFilterCount()})</span>
          </Show>
        </h3>

        <div class="flex items-center space-x-2">
          <Show when={hasActiveFilters()}>
            <button
              onClick={() => props.onClearFilters()}
              class="px-3 py-1 bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm transition-colors"
              type="button"
            >
              clear all
            </button>
          </Show>

          <Show when={props.showToggle !== false}>
            <button
              onClick={() => setIsExpanded(!isExpanded())}
              class="px-3 py-1 bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm transition-colors"
              type="button"
              aria-expanded={isExpanded()}
            >
              {isExpanded() ? "collapse" : "expand"}
            </button>
          </Show>
        </div>
      </div>

      <Show when={props.loading}>
        <div class="px-6 py-4 text-center">
          <div class="animate-spin h-4 w-4 border border-magenta-500 border-t-transparent mx-auto mb-2"></div>
          <span class="text-gray-400 text-sm">loading filters...</span>
        </div>
      </Show>

      <Show when={!props.loading && (isExpanded() || hasActiveFilters())}>
        <div class="px-6 pb-4">
          {/* quick filters */}
          <Show when={props.quickFilters && props.quickFilters.length > 0}>
            <div class="mb-4">
              <div class="text-xs text-gray-400 uppercase tracking-wider mb-2">
                quick filters
              </div>
              <div class="flex flex-wrap gap-2">
                <For each={props.quickFilters}>
                  {(filter) => {
                    // Check if this filter is currently active
                    const currentValue = props.filters[filter.key];
                    const isActive =
                      currentValue === filter.value ||
                      (Array.isArray(currentValue) &&
                        Array.isArray(filter.value) &&
                        JSON.stringify(currentValue) ===
                          JSON.stringify(filter.value));

                    return (
                      <button
                        onClick={() => applyQuickFilter(filter)}
                        class={`px-2 py-1 text-xs transition-colors ${
                          isActive
                            ? "bg-magenta-600 text-white hover:bg-magenta-700"
                            : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                        }`}
                        title={filter.description}
                      >
                        {filter.label}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>

          {/* filter fields */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={props.filterFields}>
              {(field) => (
                <div class="space-y-2">
                  <label class="block text-sm font-medium text-gray-300">
                    {field.label}
                  </label>
                  {renderFilterField(field)}
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default SearchFilters;
