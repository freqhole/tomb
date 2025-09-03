/* @jsxImportSource solid-js */
import { Show, For } from "solid-js";
import {
  FilterDropdown,
  FilterRange,
  FilterTags,
  FilterToggle,
  FilterDateRange,
  FilterText,
} from "../../lib/components/filters/FilterComponents.js";

export interface AdvancedFilterConfig {
  type: "text" | "dropdown" | "range" | "tags" | "toggle" | "date";
  key: string;
  label: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  supportsExact?: boolean;
  availableTags?: Array<{ value: string; label: string; count?: number }>;
  description?: string;
}

export interface SearchAdvancedFiltersProps {
  /** Whether the advanced filters are visible */
  visible: boolean;
  /** Current filter values */
  filters: Record<string, any>;
  /** Callback when filters change */
  onFiltersChange: (key: string, value: any) => void;
  /** Callback when exact match toggle changes */
  onExactChange?: (key: string, exact: boolean) => void;
  /** Filter configurations */
  filterConfigs: AdvancedFilterConfig[];
  /** Additional CSS classes */
  class?: string;
  /** Whether filters are loading */
  loading?: boolean;
}

export function SearchAdvancedFilters(props: SearchAdvancedFiltersProps) {
  const renderFilter = (config: AdvancedFilterConfig) => {
    const currentValue = props.filters[config.key];
    const exactKey = `${config.key}_exact`;
    const exactValue = props.filters[exactKey];

    switch (config.type) {
      case "text":
        return (
          <FilterText
            label={config.label}
            value={currentValue}
            placeholder={config.placeholder || `search by ${config.label}`}
            supportsExact={config.supportsExact}
            exactMatch={exactValue}
            onValueChange={(value) => props.onFiltersChange(config.key, value)}
            onExactChange={
              config.supportsExact && props.onExactChange
                ? (exact) => props.onExactChange!(exactKey, exact)
                : undefined
            }
          />
        );

      case "dropdown":
        return (
          <FilterDropdown
            label={config.label}
            value={currentValue}
            options={config.options || []}
            placeholder={config.placeholder || `select ${config.label}`}
            onSelect={(value) => props.onFiltersChange(config.key, value)}
          />
        );

      case "range":
        const rangeValue = Array.isArray(currentValue) ? currentValue : [null, null];
        return (
          <FilterRange
            label={config.label}
            minValue={rangeValue[0]}
            maxValue={rangeValue[1]}
            min={config.min}
            max={config.max}
            placeholder={{
              min: `min ${config.label}`,
              max: `max ${config.label}`
            }}
            onChange={(range) => {
              const newValue = [range.min, range.max].filter(v => v !== null);
              props.onFiltersChange(config.key, newValue.length > 0 ? newValue : null);
            }}
          />
        );

      case "tags":
        return (
          <div class="md:col-span-2">
            <FilterTags
              label={config.label}
              selectedTags={currentValue}
              availableTags={config.availableTags || []}
              placeholder={config.placeholder || `add ${config.label}`}
              onTagsChange={(tags) => props.onFiltersChange(config.key, tags)}
            />
          </div>
        );

      case "toggle":
        return (
          <FilterToggle
            label={config.label}
            checked={currentValue}
            onToggle={(checked) => props.onFiltersChange(config.key, checked)}
          />
        );

      case "date":
        const dateValue = Array.isArray(currentValue) ? currentValue : [null, null];
        return (
          <FilterDateRange
            label={config.label}
            startDate={dateValue[0]}
            endDate={dateValue[1]}
            onChange={(range) => {
              const newValue = [range.start, range.end].filter(v => v !== null);
              props.onFiltersChange(config.key, newValue.length > 0 ? newValue : null);
            }}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Show when={props.visible}>
      <div class={`search-advanced-filters ${props.class || ""}`}>
        <Show when={props.loading}>
          <div class="p-6 text-center">
            <div class="animate-spin h-4 w-4 border border-magenta-500 border-t-transparent mx-auto mb-2"></div>
            <span class="text-gray-400 text-sm">loading filters...</span>
          </div>
        </Show>

        <Show when={!props.loading}>
          <div class="p-4 bg-gray-900">
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <For each={props.filterConfigs}>
                {(config) => (
                  <div class="space-y-2">
                    {renderFilter(config)}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}

export default SearchAdvancedFilters;
