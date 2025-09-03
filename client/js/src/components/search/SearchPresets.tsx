/* @jsxImportSource solid-js */
import { For, Show } from "solid-js";

export interface SearchPreset {
  id: string;
  label: string;
  params: Record<string, any>;
  description?: string;
  icon?: string;
  category?: string;
}

export interface SearchPresetsProps {
  /** Array of preset configurations */
  presets: SearchPreset[];
  /** Current search parameters to check active state */
  currentParams: Record<string, any>;
  /** Callback when preset is toggled */
  onPresetToggle: (preset: SearchPreset) => void;
  /** Function to check if preset is currently active */
  isPresetActive?: (preset: SearchPreset, currentParams: Record<string, any>) => boolean;
  /** Maximum number of presets to show */
  maxVisible?: number;
  /** Additional CSS classes */
  class?: string;
  /** Label for the presets section */
  label?: string;
  /** Whether to show preset descriptions on hover */
  showDescriptions?: boolean;
}

export function SearchPresets(props: SearchPresetsProps) {
  // default function to check if preset is active
  const defaultIsActive = (preset: SearchPreset, currentParams: Record<string, any>) => {
    return Object.entries(preset.params).every(([key, value]) => {
      return currentParams[key] === value;
    });
  };

  const isActive = props.isPresetActive || defaultIsActive;

  // limit visible presets if specified
  const visiblePresets = () => {
    const maxVisible = props.maxVisible;
    return maxVisible ? props.presets.slice(0, maxVisible) : props.presets;
  };

  return (
    <div class={`search-presets ${props.class || ""}`}>
      {/* label */}
      <Show when={props.label}>
        <span class="text-gray-400 text-sm mr-2">{props.label}</span>
      </Show>

      {/* preset buttons */}
      <div class="flex flex-wrap gap-2 items-center">
        <For each={visiblePresets()}>
          {(preset) => (
            <button
              onClick={() => props.onPresetToggle(preset)}
              class={`px-3 py-2 text-sm transition-colors ${
                isActive(preset, props.currentParams)
                  ? "bg-magenta-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
              title={props.showDescriptions ? preset.description : undefined}
            >
              {preset.icon && <span class="mr-1">{preset.icon}</span>}
              {preset.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export default SearchPresets;
