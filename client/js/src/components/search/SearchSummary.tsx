/* @jsxImportSource solid-js */
import { For, Show } from "solid-js";

export interface SearchSummaryProps {
  /** Current search parameters/filters */
  filters: Record<string, any>;
  /** Function to generate human-readable filter summary */
  getSummary?: (filters: Record<string, any>) => string;
  /** Callback when individual filter is cleared */
  onClearFilter?: (key: string) => void;
  /** Callback when all filters are cleared */
  onClearAll?: () => void;
  /** Additional CSS classes */
  class?: string;
  /** Show individual filter chips */
  showFilterChips?: boolean;
  /** Show clear all button */
  showClearAll?: boolean;
  /** Custom label for the summary */
  label?: string;
}

export function SearchSummary(props: SearchSummaryProps) {
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

  // get active filter entries
  const activeFilters = () => {
    return Object.entries(props.filters).filter(([, value]) => {
      return (
        value !== undefined &&
        value !== null &&
        value !== "" &&
        value !== false &&
        (Array.isArray(value) ? value.length > 0 : true)
      );
    });
  };

  // format filter value for display
  const formatValue = (value: any): string => {
    if (Array.isArray(value)) {
      return value.join(", ");
    }
    if (typeof value === "boolean") {
      return value ? "yes" : "no";
    }
    return String(value);
  };

  // generate summary text
  const summaryText = () => {
    if (props.getSummary) {
      return props.getSummary(props.filters);
    }

    const active = activeFilters();
    if (active.length === 0) return "";

    return active
      .map(([key, value]) => `${key}: ${formatValue(value)}`)
      .join(", ");
  };

  return (
    <Show when={hasActiveFilters()}>
      <div class={`search-summary ${props.class || ""}`}>
        {/* summary text */}
        <Show when={!props.showFilterChips}>
          <div class="mb-4 px-4 py-2 bg-gray-900 text-gray-300 text-sm border border-gray-700">
            {props.label || "active filters"}: {summaryText()}
            <Show when={props.showClearAll && props.onClearAll}>
              <button
                onClick={() => props.onClearAll?.()}
                class="ml-2 text-magenta-400 hover:text-magenta-300 text-xs"
              >
                clear all
              </button>
            </Show>
          </div>
        </Show>

        {/* filter chips */}
        <Show when={props.showFilterChips}>
          <div class="mb-4">
            <div class="flex items-center gap-2 flex-wrap">
              <Show when={props.label}>
                <span class="text-gray-400 text-sm">{props.label}:</span>
              </Show>

              <For each={activeFilters()}>
                {([key, value]) => (
                  <div class="flex items-center gap-1 px-2 py-1 bg-magenta-600 text-white text-xs">
                    <span>
                      {key}: {formatValue(value)}
                    </span>
                    <Show when={props.onClearFilter}>
                      <button
                        onClick={() => props.onClearFilter?.(key)}
                        class="ml-1 text-magenta-200 hover:text-white"
                      >
                        ×
                      </button>
                    </Show>
                  </div>
                )}
              </For>

              <Show when={props.showClearAll && props.onClearAll}>
                <button
                  onClick={() => props.onClearAll?.()}
                  class="px-2 py-1 bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs"
                >
                  clear all
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

export default SearchSummary;
