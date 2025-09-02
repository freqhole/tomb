/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";
import type { AdminMusicFilters } from "../admin-api.js";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterConfig {
  key: keyof AdminMusicFilters;
  label: string;
  type:
    | "text"
    | "select"
    | "multi-select"
    | "range"
    | "date-range"
    | "rating"
    | "boolean";
  options?: FilterOption[];
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface AdvancedFilterPanelProps {
  /** Current filter values */
  filters: () => AdminMusicFilters;
  /** Update filters */
  onFiltersChange: (filters: Partial<AdminMusicFilters>) => void;
  /** Filter configurations */
  filterConfigs: FilterConfig[];
  /** Filter options data */
  filterOptions?: () => any;
  /** Whether panel is visible */
  visible: () => boolean;
  /** Close panel */
  onClose: () => void;
  /** CSS class */
  className?: string;
}

/**
 * Advanced filter panel with configurable filter components
 */
export function AdvancedFilterPanel(props: AdvancedFilterPanelProps) {
  const [activeTab, setActiveTab] = createSignal("basic");

  // handle filter update
  const updateFilter = (key: keyof AdminMusicFilters, value: any) => {
    props.onFiltersChange({ [key]: value });
  };

  // get current filter value
  const getFilterValue = (key: keyof AdminMusicFilters) => {
    return props.filters()[key];
  };

  // render text input
  const renderTextInput = (config: FilterConfig) => (
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-300">
        {config.label}
      </label>
      <input
        type="text"
        value={(getFilterValue(config.key) as string) || ""}
        onInput={(e) => updateFilter(config.key, e.target.value || undefined)}
        placeholder={config.placeholder}
        class="w-full bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
      />
    </div>
  );

  // render select dropdown
  const renderSelect = (config: FilterConfig) => (
    <div class="space-y-2">
      <label class="block text-sm font-medium text-gray-300">
        {config.label}
      </label>
      <select
        value={(getFilterValue(config.key) as string) || ""}
        onChange={(e) => updateFilter(config.key, e.target.value || undefined)}
        class="w-full bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
      >
        <option value="">all {config.label.toLowerCase()}</option>
        <For each={config.options || []}>
          {(option) => (
            <option value={option.value}>
              {option.label} {option.count ? `(${option.count})` : ""}
            </option>
          )}
        </For>
      </select>
    </div>
  );

  // render multi-select with checkboxes
  const renderMultiSelect = (config: FilterConfig) => {
    const currentValues = (getFilterValue(config.key) as string[]) || [];

    const toggleValue = (value: string) => {
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      updateFilter(config.key, newValues.length > 0 ? newValues : undefined);
    };

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
        </label>
        <div class="max-h-32 overflow-y-auto space-y-1 border border-gray-700 bg-gray-900 p-2">
          <For each={config.options || []}>
            {(option) => (
              <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-800 p-1">
                <input
                  type="checkbox"
                  checked={currentValues.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                  class="text-magenta-500 bg-gray-900 border-gray-700 focus:ring-magenta-500"
                />
                <span class="text-sm text-gray-300">
                  {option.label} {option.count ? `(${option.count})` : ""}
                </span>
              </label>
            )}
          </For>
        </div>
      </div>
    );
  };

  // render range input (min/max)
  const renderRange = (config: FilterConfig) => {
    const minKey = `${config.key}_min` as keyof AdminMusicFilters;
    const maxKey = `${config.key}_max` as keyof AdminMusicFilters;
    const minValue = (getFilterValue(minKey) as number) || "";
    const maxValue = (getFilterValue(maxKey) as number) || "";

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
        </label>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={minValue}
            onInput={(e) =>
              updateFilter(
                minKey,
                e.target.value ? Number(e.target.value) : undefined
              )
            }
            placeholder={`min ${config.min || ""}`}
            min={config.min}
            max={config.max}
            class="bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
          />
          <input
            type="number"
            value={maxValue}
            onInput={(e) =>
              updateFilter(
                maxKey,
                e.target.value ? Number(e.target.value) : undefined
              )
            }
            placeholder={`max ${config.max || ""}`}
            min={config.min}
            max={config.max}
            class="bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
          />
        </div>
      </div>
    );
  };

  // render rating selector
  const renderRating = (config: FilterConfig) => {
    const currentRating = getFilterValue(config.key) as number;

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
        </label>
        <div class="flex items-center space-x-1">
          <For each={[0, 1, 2, 3, 4, 5]}>
            {(rating) => (
              <button
                onClick={() =>
                  updateFilter(
                    config.key,
                    rating === currentRating ? undefined : rating
                  )
                }
                class={`text-lg transition-colors ${
                  currentRating === rating
                    ? "text-yellow-400"
                    : rating === 0
                      ? "text-gray-600 hover:text-gray-500"
                      : "text-gray-600 hover:text-yellow-300"
                }`}
                title={rating === 0 ? "unrated" : `${rating} stars`}
              >
                {rating === 0 ? "none" : rating}
              </button>
            )}
          </For>
          <Show when={currentRating !== undefined}>
            <button
              onClick={() => updateFilter(config.key, undefined)}
              class="ml-2 text-xs text-gray-400 hover:text-gray-300"
            >
              clear
            </button>
          </Show>
        </div>
      </div>
    );
  };

  // render boolean toggle
  const renderBoolean = (config: FilterConfig) => {
    const currentValue = getFilterValue(config.key) as boolean;

    return (
      <div class="space-y-2">
        <label class="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={currentValue === true}
            onChange={(e) =>
              updateFilter(config.key, e.target.checked ? true : undefined)
            }
            class="text-magenta-500 bg-gray-900 border-gray-700 focus:ring-magenta-500"
          />
          <span class="text-sm font-medium text-gray-300">{config.label}</span>
        </label>
      </div>
    );
  };

  // render date range
  const renderDateRange = (config: FilterConfig) => {
    const afterKey = `${config.key}_after` as keyof AdminMusicFilters;
    const beforeKey = `${config.key}_before` as keyof AdminMusicFilters;
    const afterValue = (getFilterValue(afterKey) as string) || "";
    const beforeValue = (getFilterValue(beforeKey) as string) || "";

    return (
      <div class="space-y-2">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
        </label>
        <div class="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={afterValue ? afterValue.split("T")[0] : ""}
            onChange={(e) =>
              updateFilter(
                afterKey,
                e.target.value ? e.target.value + "T00:00:00.000Z" : undefined
              )
            }
            class="bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
            placeholder="from date"
          />
          <input
            type="date"
            value={beforeValue ? beforeValue.split("T")[0] : ""}
            onChange={(e) =>
              updateFilter(
                beforeKey,
                e.target.value ? e.target.value + "T23:59:59.999Z" : undefined
              )
            }
            class="bg-gray-900 text-white px-3 py-2 border border-gray-700 focus:border-magenta-500 focus:outline-none text-sm"
            placeholder="to date"
          />
        </div>
      </div>
    );
  };

  // render filter component based on type
  const renderFilter = (config: FilterConfig) => {
    switch (config.type) {
      case "text":
        return renderTextInput(config);
      case "select":
        return renderSelect(config);
      case "multi-select":
        return renderMultiSelect(config);
      case "range":
        return renderRange(config);
      case "rating":
        return renderRating(config);
      case "boolean":
        return renderBoolean(config);
      case "date-range":
        return renderDateRange(config);
      default:
        return (
          <div class="text-red-400 text-sm">
            unsupported filter type: {config.type}
          </div>
        );
    }
  };

  // group filters by category
  const basicFilters = () =>
    props.filterConfigs.filter((f) =>
      ["artist", "album", "genre", "year"].includes(f.key as string)
    );

  const metadataFilters = () =>
    props.filterConfigs.filter((f) =>
      ["rating", "is_favorite", "tags", "format"].includes(f.key as string)
    );

  const dateFilters = () =>
    props.filterConfigs.filter((f) =>
      ["created", "modified"].includes(f.key as string)
    );

  return (
    <Show when={props.visible()}>
      <div
        class={`advanced-filter-panel bg-gray-800 border-b border-gray-700 ${props.className || ""}`}
      >
        <div class="px-6 py-4">
          {/* header */}
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-medium text-white">advanced filters</h3>
            <button
              onClick={() => props.onClose()}
              class="text-gray-400 hover:text-white text-xl"
              title="close advanced filters"
            >
              close
            </button>
          </div>

          {/* filter tabs */}
          <div class="flex space-x-1 mb-4">
            {["basic", "metadata", "dates"].map((tab) => (
              <button
                onClick={() => setActiveTab(tab)}
                class={`px-3 py-1 text-sm font-medium transition-colors ${
                  activeTab() === tab
                    ? "bg-magenta-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* filter content */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Show when={activeTab() === "basic"}>
              <For each={basicFilters()}>
                {(config) => renderFilter(config)}
              </For>
            </Show>

            <Show when={activeTab() === "metadata"}>
              <For each={metadataFilters()}>
                {(config) => renderFilter(config)}
              </For>
            </Show>

            <Show when={activeTab() === "dates"}>
              <For each={dateFilters()}>{(config) => renderFilter(config)}</For>
            </Show>
          </div>

          {/* filter actions */}
          <div class="flex items-center justify-between mt-6 pt-4 border-t border-gray-700">
            <div class="text-sm text-gray-400">
              {Object.keys(props.filters()).length} active filters
            </div>
            <div class="flex space-x-2">
              <button
                onClick={() => props.onFiltersChange({})}
                class="px-3 py-2 bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm font-medium transition-colors"
              >
                clear all
              </button>
              <button
                onClick={() => props.onClose()}
                class="px-3 py-2 bg-magenta-600 text-white hover:bg-magenta-700 text-sm font-medium transition-colors"
              >
                apply filters
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
