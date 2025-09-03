import { For, Show, createSignal, createMemo } from "solid-js";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterDropdownProps {
  label: string;
  value?: string | string[];
  options: FilterOption[];
  placeholder?: string;
  multiple?: boolean;
  onSelect: (value: string | string[] | undefined) => void;
  class?: string;
}

export function FilterDropdown(props: FilterDropdownProps) {
  const [isOpen, setIsOpen] = createSignal(false);

  const selectedLabels = createMemo(() => {
    if (!props.value) return props.placeholder || "select option";
    if (Array.isArray(props.value)) {
      if (props.value.length === 0)
        return props.placeholder || "select options";
      if (props.value.length === 1) {
        const option = props.options.find((o) => o.value === props.value![0]);
        return option?.label || props.value![0];
      }
      return `${props.value.length} selected`;
    }
    const option = props.options.find((o) => o.value === props.value);
    return option?.label || props.value || "";
  });

  const handleSelect = (optionValue: string) => {
    if (props.multiple) {
      const currentValues = Array.isArray(props.value) ? props.value : [];
      const newValues = currentValues.includes(optionValue)
        ? currentValues.filter((v) => v !== optionValue)
        : [...currentValues, optionValue];
      props.onSelect(newValues.length > 0 ? newValues : undefined);
    } else {
      props.onSelect(props.value === optionValue ? undefined : optionValue);
      setIsOpen(false);
    }
  };

  const isSelected = (optionValue: string) => {
    if (Array.isArray(props.value)) {
      return props.value.includes(optionValue);
    }
    return props.value === optionValue;
  };

  return (
    <div class={`${props.class || ""}`}>
      <label class="block text-sm font-medium text-white mb-2">
        {props.label}
      </label>
      <div class="relative">
        <button
          class="w-full bg-black border border-white text-white px-3 py-2 text-left hover:bg-gray-900 flex justify-between items-center"
          onClick={() => setIsOpen(!isOpen())}
        >
          <span class="truncate">{selectedLabels()}</span>
          <span
            class={`transform transition-transform ${isOpen() ? "rotate-180" : ""}`}
          >
            ▼
          </span>
        </button>
        <Show when={isOpen()}>
          <div class="absolute z-50 w-full mt-1 bg-black border border-white max-h-60 overflow-y-auto">
            <For each={props.options}>
              {(option) => (
                <button
                  class={`w-full px-3 py-2 text-left hover:bg-gray-900 flex justify-between items-center ${
                    isSelected(option.value)
                      ? "bg-gray-800 text-magenta-400"
                      : "text-white"
                  }`}
                  onClick={() => handleSelect(option.value)}
                >
                  <span class="truncate">{option.label}</span>
                  <div class="flex items-center gap-2">
                    <Show when={option.count !== undefined}>
                      <span class="text-gray-400 text-xs">
                        ({option.count})
                      </span>
                    </Show>
                    <Show when={props.multiple && isSelected(option.value)}>
                      <span class="text-magenta-400">✓</span>
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface FilterRangeProps {
  label: string;
  minValue?: number;
  maxValue?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: { min?: string; max?: string };
  formatter?: (value: number) => string;
  parser?: (value: string) => number;
  onChange: (range: { min?: number; max?: number }) => void;
  class?: string;
}

export function FilterRange(props: FilterRangeProps) {
  const handleMinChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value
      ? props.parser
        ? props.parser(target.value)
        : Number(target.value)
      : undefined;
    props.onChange({ min: value, max: props.maxValue });
  };

  const handleMaxChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value
      ? props.parser
        ? props.parser(target.value)
        : Number(target.value)
      : undefined;
    props.onChange({ min: props.minValue, max: value });
  };

  const formatValue = (value: number | undefined) => {
    if (value === undefined || value === null) return "";
    return props.formatter ? props.formatter(value) : String(value);
  };

  return (
    <div class={`${props.class || ""}`}>
      <label class="block text-sm font-medium text-white mb-2">
        {props.label}
      </label>
      <div class="flex items-center gap-2">
        <input
          type="number"
          class="flex-1 bg-black border border-white text-white px-3 py-2 placeholder-gray-500 hover:border-gray-300 focus:border-magenta-400 focus:outline-none"
          value={formatValue(props.minValue)}
          onInput={handleMinChange}
          placeholder={props.placeholder?.min || "min"}
          min={props.min}
          max={props.max}
          step={props.step}
        />
        <span class="text-white">–</span>
        <input
          type="number"
          class="flex-1 bg-black border border-white text-white px-3 py-2 placeholder-gray-500 hover:border-gray-300 focus:border-magenta-400 focus:outline-none"
          value={formatValue(props.maxValue)}
          onInput={handleMaxChange}
          placeholder={props.placeholder?.max || "max"}
          min={props.min}
          max={props.max}
          step={props.step}
        />
      </div>
    </div>
  );
}

export interface FilterTagsProps {
  label: string;
  selectedTags?: string[];
  availableTags?: FilterOption[];
  placeholder?: string;
  mode?: "all" | "any" | "exclude";
  onTagsChange: (tags: string[] | undefined) => void;
  onModeChange?: (mode: "all" | "any" | "exclude") => void;
  class?: string;
}

export function FilterTags(props: FilterTagsProps) {
  const [inputValue, setInputValue] = createSignal("");
  const [isOpen, setIsOpen] = createSignal(false);

  const filteredTags = createMemo(() => {
    const input = inputValue().toLowerCase();
    if (!input) return props.availableTags || [];
    return (props.availableTags || []).filter(
      (tag) =>
        tag.label.toLowerCase().includes(input) &&
        !(props.selectedTags || []).includes(tag.value)
    );
  });

  const handleAddTag = (tagValue: string) => {
    const currentTags = props.selectedTags || [];
    if (!currentTags.includes(tagValue)) {
      const newTags = [...currentTags, tagValue];
      props.onTagsChange(newTags.length > 0 ? newTags : undefined);
    }
    setInputValue("");
    setIsOpen(false);
  };

  const handleRemoveTag = (tagValue: string) => {
    const currentTags = props.selectedTags || [];
    const newTags = currentTags.filter((tag) => tag !== tagValue);
    props.onTagsChange(newTags.length > 0 ? newTags : undefined);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && inputValue().trim()) {
      e.preventDefault();
      handleAddTag(inputValue().trim());
    } else if (
      e.key === "Backspace" &&
      !inputValue() &&
      props.selectedTags?.length
    ) {
      const lastTag = props.selectedTags[props.selectedTags.length - 1];
      if (lastTag) {
        handleRemoveTag(lastTag);
      }
    }
  };

  return (
    <div class={`${props.class || ""}`}>
      <div class="flex items-center justify-between mb-2">
        <label class="text-sm font-medium text-white">{props.label}</label>
        <Show when={props.onModeChange}>
          <select
            class="bg-black text-white text-xs px-2 py-1 focus:outline-none focus:ring-2 focus:ring-magenta-500"
            value={props.mode || "all"}
            onChange={(e) =>
              props.onModeChange?.(e.target.value as "all" | "any" | "exclude")
            }
          >
            <option value="all">all tags</option>
            <option value="any">any tag</option>
            <option value="exclude">exclude tags</option>
          </select>
        </Show>
      </div>

      <div class="relative">
        <div class="min-h-[40px] bg-black px-3 py-2 flex flex-wrap items-center gap-2 focus-within:ring-2 focus-within:ring-magenta-500">
          <For each={props.selectedTags || []}>
            {(tag) => (
              <span class="inline-flex items-center bg-magenta-900 text-magenta-100 px-2 py-1 text-sm">
                {tag}
                <button
                  class="ml-1 text-magenta-300 hover:text-white focus:outline-none"
                  onClick={() => handleRemoveTag(tag)}
                >
                  ×
                </button>
              </span>
            )}
          </For>
          <input
            class="flex-1 min-w-[120px] bg-transparent text-white placeholder-gray-500 focus:outline-none"
            value={inputValue()}
            onInput={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            placeholder={props.placeholder || "add tags"}
          />
        </div>

        <Show when={isOpen() && filteredTags().length > 0}>
          <div class="absolute z-10 w-full mt-1 bg-black border border-gray-700 max-h-40 overflow-auto">
            <For each={filteredTags().slice(0, 10)}>
              {(tag) => (
                <button
                  class="w-full px-3 py-2 text-left hover:bg-gray-900 text-white flex items-center justify-between"
                  onClick={() => handleAddTag(tag.value)}
                >
                  <span class="truncate">{tag.label}</span>
                  <Show when={tag.count !== undefined}>
                    <span class="text-xs text-gray-400">({tag.count})</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface FilterToggleProps {
  label: string;
  checked?: boolean;
  onToggle: (checked: boolean | undefined) => void;
  class?: string;
}

export function FilterToggle(props: FilterToggleProps) {
  const handleChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    props.onToggle(target.checked ? true : undefined);
  };

  return (
    <div class={`${props.class || ""}`}>
      <label class="flex items-center text-white cursor-pointer hover:text-magenta-200">
        <input
          type="checkbox"
          class="mr-2 w-4 h-4 text-magenta-600 bg-black border-gray-600 focus:ring-magenta-500 focus:ring-2"
          checked={props.checked || false}
          onChange={handleChange}
        />
        <span class="text-sm">{props.label}</span>
      </label>
    </div>
  );
}

export interface FilterDateRangeProps {
  label: string;
  startDate?: string;
  endDate?: string;
  onChange: (range: { start?: string; end?: string }) => void;
  class?: string;
}

export function FilterDateRange(props: FilterDateRangeProps) {
  const handleStartChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value || undefined;
    props.onChange({ start: value, end: props.endDate });
  };

  const handleEndChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value || undefined;
    props.onChange({ start: props.startDate, end: value });
  };

  return (
    <div class={`${props.class || ""}`}>
      <label class="block text-sm font-medium text-white mb-2">
        {props.label}
      </label>
      <div class="flex items-center space-x-2">
        <input
          type="date"
          class="flex-1 bg-black text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-magenta-500"
          value={props.startDate ?? ""}
          onInput={handleStartChange}
        />
        <span class="text-gray-400">to</span>
        <input
          type="date"
          class="flex-1 bg-black text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-magenta-500"
          value={props.endDate ?? ""}
          onInput={handleEndChange}
        />
      </div>
    </div>
  );
}

export interface FilterTextProps {
  label: string;
  value?: string;
  placeholder?: string;
  supportsExact?: boolean;
  exactMatch?: boolean;
  onValueChange: (value: string | undefined) => void;
  onExactChange?: (exact: boolean) => void;
  class?: string;
}

export function FilterText(props: FilterTextProps) {
  const handleValueChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value.trim();
    props.onValueChange(value || undefined);
  };

  const handleExactChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    props.onExactChange?.(target.checked);
  };

  return (
    <div class={`${props.class || ""}`}>
      <label class="block text-sm font-medium text-white mb-2">
        {props.label}
      </label>
      <div class="space-y-2">
        <input
          type="text"
          class="w-full bg-black text-white px-3 py-2 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-magenta-500"
          value={props.value || ""}
          onInput={handleValueChange}
          placeholder={props.placeholder}
        />
        <Show when={props.supportsExact}>
          <label class="flex items-center text-white cursor-pointer hover:text-magenta-200">
            <input
              type="checkbox"
              class="mr-2 w-4 h-4 text-magenta-600 bg-black border-gray-600 focus:ring-magenta-500 focus:ring-2"
              checked={props.exactMatch || false}
              onChange={handleExactChange}
            />
            <span class="text-xs">exact match</span>
          </label>
        </Show>
      </div>
    </div>
  );
}
