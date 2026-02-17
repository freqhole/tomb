import { Search } from "@kobalte/core/search";
import { createSignal, For, Show, splitProps, type JSX } from "solid-js";
import type { ImageMetadata } from "../../music/services/storage/types";
import { MediaThumbnail } from "../media/MediaThumbnail";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { HighlightedMarqueeText } from "../text/HighlightedMarqueeText";

type Ref<T> = T | ((el: T) => void);

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
  /** optional thumbnail image url */
  thumbnailUrl?: string;
  /** optional images array */
  images?: ImageMetadata[];
  /** whether this suggestion is disabled */
  disabled?: boolean;
  /** whether this suggestion is favorited */
  isFavorite?: boolean;
  /** original data passed through for selection */
  data?: any;
  /** callback when thumbnail is clicked (for play action) */
  onThumbnailClick?: () => void;
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
  /** callback when user scrolls near end (for infinite scroll) */
  onEndReached?: () => void;
  /** whether more items are being loaded */
  loadingMore?: boolean;
  /** callback when input loses focus */
  onBlur?: (event: FocusEvent) => void;
  /** callback when input gains focus */
  onFocus?: () => void;
  /** callback when key is pressed */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** controlled open state for suggestions dropdown */
  open?: boolean;
  /** callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** debounce time in milliseconds for input changes (default: 300) */
  debounceMs?: number;
  /** whether the input is disabled */
  disabled?: boolean;
  /** additional classes for the container */
  class?: string;
  /** variant style */
  variant?: "default" | "filled";
  /** hint message to show at top of suggestions (e.g., "press enter to...") */
  hintMessage?: string | null;
  /** callback when hint message is clicked */
  onHintClick?: () => void;
  /** ref to the input element */
  ref?: Ref<HTMLInputElement>;
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
            return <span class="text-[var(--color-accent-500)] font-medium">{content}</span>;
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
    "onBlur",
    "onFocus",
    "onKeyDown",
    "open",
    "onOpenChange",
    "debounceMs",
    "disabled",
    "class",
    "variant",
    "onEndReached",
    "loadingMore",
    "hintMessage",
    "onHintClick",
    "ref",
  ]);

  const variant = () => local.variant || "default";
  const suggestions = () => local.suggestions || [];

  // track input text to show/hide clear button
  const [inputText, setInputText] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  // track if thumbnail was clicked to prevent row navigation
  let thumbnailClicked = false;

  // handle scroll for infinite loading
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    // trigger when within 100px of bottom
    if (scrollTop + clientHeight >= scrollHeight - 100) {
      local.onEndReached?.();
    }
  };

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
        open={local.open}
        onOpenChange={local.onOpenChange}
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
          // don't navigate if thumbnail was clicked (play action)
          if (value && !thumbnailClicked) {
            local.onSelect?.(value);
          }
          // reset flag for next interaction
          thumbnailClicked = false;
        }}
        debounceOptionsMillisecond={local.debounceMs ?? 300}
        disabled={local.disabled}
        triggerMode="input"
        multiple={false}
        itemComponent={(itemProps) => {
          const [isHovering, setIsHovering] = createSignal(false);

          return (
            <Search.Item
              item={itemProps.item}
              class="outline-none"
              onPointerDown={(e) => {
                // check if click was on thumbnail during capture phase
                const target = e.target as HTMLElement;
                const clickedThumbnail = target.closest('[data-thumbnail="true"]');

                if (clickedThumbnail) {
                  e.stopPropagation();
                  e.preventDefault();
                  thumbnailClicked = true;
                  // call the thumbnail click handler immediately
                  setTimeout(() => {
                    itemProps.item.rawValue.onThumbnailClick?.();
                  }, 0);
                }
              }}
            >
              <div
                class="
                  px-4 py-2 cursor-pointer text-sm transition-all
                  data-[highlighted]:bg-[var(--color-accent-500)] data-[highlighted]:text-[var(--color-text-on-accent)]
                  data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed
                  hover:bg-[var(--color-bg-hover)]
                  text-[var(--color-text-primary)]
                "
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
              >
                <div class="flex items-center gap-3">
                  {/* thumbnail with play on click */}
                  <div data-thumbnail="true" class="cursor-pointer">
                    <MediaThumbnail
                      images={itemProps.item.rawValue.images}
                      thumbnailUrl={itemProps.item.rawValue.thumbnailUrl}
                      size={40}
                      hideIndex={
                        !itemProps.item.rawValue.count || itemProps.item.rawValue.count <= 1
                      }
                      indexText={
                        itemProps.item.rawValue.count && itemProps.item.rawValue.count > 1
                          ? `${itemProps.item.rawValue.count}`
                          : undefined
                      }
                      enablePlayClick={false}
                      showPlayIcon={!!itemProps.item.rawValue.onThumbnailClick}
                    />
                  </div>

                  {/* text content with marquee */}
                  <div class="flex-1 min-w-0">
                    <Search.ItemLabel class="block">
                      <HighlightedMarqueeText
                        text={itemProps.item.rawValue.text}
                        highlight={itemProps.item.rawValue.highlight}
                        isHovering={isHovering()}
                      />
                    </Search.ItemLabel>
                  </div>

                  {/* favorite heart - only show when item is favorited */}
                  <Show when={itemProps.item.rawValue.isFavorite === true}>
                    <FavoriteHeart
                      isFavorite={true}
                      readonly={true}
                      size="sm"
                      class="flex-shrink-0"
                    />
                  </Show>

                  {/* category badge */}
                  <Show when={itemProps.item.rawValue.category}>
                    <div class="px-2 py-1 rounded bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] text-xs font-medium flex-shrink-0">
                      {itemProps.item.rawValue.category}
                    </div>
                  </Show>
                </div>
              </div>
            </Search.Item>
          );
        }}
        {...rest}
      >
        <Show when={local.label}>
          <Search.Label class="label text-[var(--color-text-secondary)] block mb-1">
            {local.label}
          </Search.Label>
        </Show>

        <Search.Control class="relative">
          {(api) => (
            <Search.Input
              ref={(el) => {
                inputRef = el;
                if (typeof local.ref === "function") {
                  local.ref(el);
                }
              }}
              onFocus={() => local.onFocus?.()}
              onBlur={(e) => local.onBlur?.(e)}
              onKeyDown={(e) => local.onKeyDown?.(e)}
              class={`
                ${variantClasses()}
                px-3 py-2 text-sm h-10
                text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-muted)]
                focus:outline-none
              `}
            />
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
              z-[1002]
              min-w-[400px]
              max-w-[600px]
              w-max
            "
          >
            <Show when={local.hintMessage}>
              <div
                class="px-4 py-2 text-xs text-[var(--color-text-secondary)] border-b border-[var(--color-border-default)] cursor-pointer hover:bg-[var(--color-bg-hover)]"
                onClick={() => local.onHintClick?.()}
              >
                {local.hintMessage}
              </div>
            </Show>

            <Search.Listbox class="max-h-80 overflow-y-auto" onScroll={handleScroll} />

            <Show when={local.loadingMore}>
              <div class="px-4 py-2 text-center text-sm text-[var(--color-text-secondary)]">
                loading more...
              </div>
            </Show>

            <Search.NoResult class="px-4 py-3 text-sm text-[var(--color-text-tertiary)] text-center">
              no suggestions found
            </Search.NoResult>
          </Search.Content>
        </Search.Portal>
      </Search>
    </div>
  );
}
