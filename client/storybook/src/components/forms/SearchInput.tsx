import { Search } from "@kobalte/core/search";
import { createSignal, For, Show, splitProps, type JSX } from "solid-js";
import { Icon } from "../icons/registry";

export interface SearchSuggestion {
  /** unique identifier for the suggestion */
  id: string;
  /** text to display in the suggestion */
  text: string;
  /** optional category grouping (e.g., "artists", "songs", "albums") */
  category?: string;
  /** optional highlighted version of text with <mark> tags */
  highlight?: string;
  /** optional count to display next to suggestion */
  count?: number;
  /** whether this suggestion is disabled */
  disabled?: boolean;
  /** original data passed through for selection */
  data?: any;
}

export interface SearchInputProps {
  /** label for the search input */
  label?: string;
  /** placeholder text */
  placeholder?: string;
  /** hint text below input */
  hint?: string;
  /** array of suggestions to display */
  suggestions?: SearchSuggestion[];
  /** whether suggestions are loading */
  loading?: boolean;
  /** callback when input value changes */
  onInputChange?: (value: string) => void;
  /** callback when a suggestion is selected */
  onSelect?: (suggestion: SearchSuggestion) => void;
  /** callback when clear button is clicked */
  onClear?: () => void;
  /** debounce time in milliseconds for input changes (default: 300) */
  debounceMs?: number;
  /** whether the input is disabled */
  disabled?: boolean;
  /** additional classes for the container */
  class?: string;
  /** variant style */
  variant?: "default" | "filled";
  /** controlled value to show clear button */
  value?: string;
}

// get display name for category
function getCategoryDisplayName(category: string) {
  const categoryNames: Record<string, string> = {
    word: "search suggestions",
    title: "songs",
    song: "songs",
    artist: "artists",
    album: "albums",
    genre: "genres",
    playlist: "playlists",
    general: "suggestions",
    all: "mixed results",
  };
  return categoryNames[category] || category;
}

// render text with <mark> highlights
function HighlightedText(props: { text: string; highlight?: string }) {
  const parts = () => {
    const textToRender = props.highlight || props.text;

    if (!textToRender || !textToRender.includes("<mark>")) {
      return [props.text];
    }

    // split by <mark> tags
    return textToRender.split(/(<mark>.*?<\/mark>)/g);
  };

  return (
    <span>
      <For each={parts()}>
        {(part) => {
          if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
            const content = part.slice(6, -7); // remove <mark></mark>
            return (
              <span class="text-[var(--color-accent-500)] font-medium">
                {content}
              </span>
            );
          }
          return part;
        }}
      </For>
    </span>
  );
}

// search input component with autocomplete using kobalte primitives
export function SearchInput(props: SearchInputProps) {
  const [local, rest] = splitProps(props, [
    "label",
    "placeholder",
    "hint",
    "suggestions",
    "loading",
    "onInputChange",
    "onSelect",
    "onClear",
    "debounceMs",
    "disabled",
    "class",
    "variant",
  ]);

  const variant = () => local.variant || "default";
  const suggestions = () => local.suggestions || [];

  // track input text to show/hide clear button
  const [inputText, setInputText] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  const variantClasses = () => {
    const base = "w-full rounded border transition-colors";
    const disabled = local.disabled
      ? "opacity-50 cursor-not-allowed bg-[var(--color-bg-tertiary)]"
      : "";

    switch (variant()) {
      case "filled":
        return `${base} bg-[var(--color-bg-tertiary)] border-transparent focus:bg-[var(--color-bg-primary)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 ${disabled}`;
      default:
        return `${base} bg-[var(--color-bg-primary)] border-[var(--color-border-default)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50 ${disabled}`;
    }
  };

  return (
    <div class={`space-y-1 ${local.class || ""}`}>
      <Search<SearchSuggestion>
        options={suggestions()}
        optionValue="id"
        optionLabel="text"
        optionDisabled="disabled"
        placeholder={local.placeholder}
        onInputChange={(value) => {
          setInputText(value);
          local.onInputChange?.(value);
        }}
        onChange={(value) => {
          if (value) {
            local.onSelect?.(value);
          }
        }}
        debounceOptionsMillisecond={local.debounceMs ?? 300}
        disabled={local.disabled}
        triggerMode="input"
        itemComponent={(itemProps) => (
          <Search.Item item={itemProps.item} class="outline-none">
            <div
              class="
                px-4 py-3 cursor-pointer text-sm transition-all
                data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)]
                data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
                hover:bg-[var(--color-bg-hover)]
                text-[var(--color-text-primary)]
              "
            >
              <div class="flex items-center justify-between">
                <Search.ItemLabel class="flex-1">
                  <HighlightedText
                    text={itemProps.item.rawValue.text}
                    highlight={itemProps.item.rawValue.highlight}
                  />
                </Search.ItemLabel>
                <Show when={itemProps.item.rawValue.count}>
                  <span class="text-xs text-[var(--color-text-muted)] ml-2">
                    ({itemProps.item.rawValue.count})
                  </span>
                </Show>
              </div>
            </div>
          </Search.Item>
        )}
        {...rest}
      >
        <Show when={local.label}>
          <Search.Label class="label text-[var(--color-text-secondary)] block mb-1">
            {local.label}
          </Search.Label>
        </Show>

        <Search.Control class="relative">
          {(api) => (
            <>
              <div class="absolute left-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-10">
                <Show
                  when={local.loading}
                  fallback={
                    <Icon
                      name="search"
                      size={18}
                      color="var(--color-text-muted)"
                    />
                  }
                >
                  <div class="animate-spin">
                    <Icon
                      name="loader"
                      size={18}
                      color="var(--color-accent-500)"
                    />
                  </div>
                </Show>
              </div>

              <Search.Input
                ref={inputRef}
                class={`
                  ${variantClasses()}
                  px-3 py-2 pl-10 pr-10 text-sm h-10
                  text-[var(--color-text-primary)]
                  placeholder:text-[var(--color-text-muted)]
                  focus:outline-none
                `}
              />

              <Show when={inputText().length > 0}>
                <button
                  type="button"
                  class="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-1 hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                  onClick={() => {
                    // directly clear the input element
                    if (inputRef) {
                      inputRef.value = "";
                      // trigger input event so kobalte updates
                      inputRef.dispatchEvent(
                        new Event("input", { bubbles: true }),
                      );
                    }
                    api.clear();
                    setInputText("");
                    local.onInputChange?.("");
                    local.onClear?.();
                  }}
                  aria-label="clear search"
                >
                  <Icon
                    name="close"
                    size={16}
                    color="var(--color-text-muted)"
                  />
                </button>
              </Show>
            </>
          )}
        </Search.Control>

        <Show when={local.hint}>
          <Search.Description class="caption">{local.hint}</Search.Description>
        </Show>

        <Search.Portal>
          <Search.Content
            class="
              bg-[var(--color-bg-elevated)]
              border border-[var(--color-border-default)]
              rounded
              max-h-80
              overflow-hidden
              shadow-lg
              z-50
            "
          >
            <Search.Listbox class="max-h-80 overflow-y-auto" />

            <Search.NoResult class="px-4 py-3 text-sm text-[var(--color-text-tertiary)] text-center">
              no suggestions found
            </Search.NoResult>
          </Search.Content>
        </Search.Portal>
      </Search>
    </div>
  );
}
