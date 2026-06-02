// search input with dropdown suggestions
// plain input + custom dropdown — no kobalte, no pointer-drift bugs
import { createEffect, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { ImageMetadata } from "../../music/services/storage/types";
import { MediaImage } from "../media/MediaImage";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { HighlightedMarqueeText } from "../text/HighlightedMarqueeText";
import { Icon } from "../icons/registry";
import { isNarrowViewport } from "../../config/breakpoints";

export interface SearchSuggestion {
  id: string;
  text: string;
  category?: string;
  /** small second line under the category badge (e.g. originating remote) */
  categoryDetail?: { label: string; title?: string };
  highlight?: string;
  images?: ImageMetadata[];
  isFavorite?: boolean;
  /** play action for thumbnail click */
  onPlay?: () => void;
  /** original data passed through for selection */
  data?: any;
}

export interface SearchInputProps {
  placeholder?: string;
  suggestions?: SearchSuggestion[];
  loading?: boolean;
  /** called when the user types (already debounced internally) */
  onInputChange?: (value: string) => void;
  /** called when a suggestion row is clicked */
  onSelect?: (suggestion: SearchSuggestion) => void;
  /** called when user scrolls near the bottom */
  onEndReached?: () => void;
  loadingMore?: boolean;
  onBlur?: (event: FocusEvent) => void;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  /** controlled open state */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** debounce ms for input changes (default: 300) */
  debounceMs?: number;
  disabled?: boolean;
  class?: string;
  variant?: "default" | "filled";
  ref?: HTMLInputElement | ((el: HTMLInputElement) => void);
  /** controlled input value */
  value?: string;
  /** hint text shown between input and flyout (e.g., "press return to filter songs") */
  hintMessage?: string | null;
  onHintClick?: () => void;
  /** optional content rendered at the bottom of the dropdown (status, hints) */
  footerContent?: JSX.Element;
}

export function SearchInput(props: SearchInputProps) {
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  const [isHoveringDropdown, setIsHoveringDropdown] = createSignal(false);
  const [showLoadingMore, setShowLoadingMore] = createSignal(false);
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  let listRef: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let loadingMoreTimer: ReturnType<typeof setTimeout> | undefined;

  // track viewport width changes for responsive flyout
  onMount(() => {
    const handleResize = () => setIsNarrow(isNarrowViewport());
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  const suggestions = () => props.suggestions || [];
  const isOpen = () => props.open ?? false;
  const variant = () => props.variant || "default";

  // reset hover state when dropdown closes (portal unmount won't fire mouseleave)
  createEffect(() => {
    if (!isOpen()) setIsHoveringDropdown(false);
  });

  // reset highlight when suggestions change
  createEffect(
    on(
      () => suggestions().length,
      () => setHighlightedIndex(-1)
    )
  );

  // scroll highlighted item into view
  createEffect(() => {
    const idx = highlightedIndex();
    if (idx < 0 || !listRef) return;
    const item = listRef.querySelector(`[data-index="${idx}"]`) as HTMLElement;
    item?.scrollIntoView({ block: "nearest" });
  });

  // position for hint + dropdown portal
  const [inputRect, setInputRect] = createSignal({ bottom: 0, left: 0, width: 0 });

  const updateInputRect = () => {
    if (!inputEl) return;
    const rect = inputEl.getBoundingClientRect();
    setInputRect({ bottom: rect.bottom, left: rect.left, width: rect.width });
  };

  // re-measure whenever the portal becomes active
  createEffect(() => {
    const needsPortal = isOpen() || !!props.hintMessage;
    if (needsPortal) updateInputRect();
  });

  // constant offset so the flyout is always scooted below the hint area
  const hintHeight = 22;

  const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      props.onInputChange?.(value);
    }, props.debounceMs ?? 300);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = suggestions();
    if (isOpen() && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((i) => (i < items.length - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i > 0 ? i - 1 : items.length - 1));
        return;
      }
      if (e.key === "Enter" && highlightedIndex() >= 0) {
        e.preventDefault();
        const item = items[highlightedIndex()];
        if (item) {
          props.onSelect?.(item);
          setHighlightedIndex(-1);
        }
        return;
      }
    }
    // forward all other keys (including Enter with no highlight) to parent
    props.onKeyDown?.(e);
  };

  const handleFocus = () => {
    props.onFocus?.();
    // re-measure after parent expand animation (200ms transition)
    updateInputRect();
    setTimeout(updateInputRect, 220);
  };

  const handleBlur = (e: FocusEvent) => {
    // if the user clicked inside the dropdown, don't fire blur
    if (isHoveringDropdown()) return;
    props.onBlur?.(e);
  };

  // infinite scroll
  const handleScroll = (e: Event) => {
    const el = e.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      props.onEndReached?.();
    }
  };

  // delay showing "loading more" indicator by 1 second
  createEffect(() => {
    if (props.loadingMore) {
      loadingMoreTimer = setTimeout(() => setShowLoadingMore(true), 1000);
    } else {
      clearTimeout(loadingMoreTimer);
      setShowLoadingMore(false);
    }
  });

  onCleanup(() => {
    clearTimeout(debounceTimer);
    clearTimeout(loadingMoreTimer);
  });

  const variantClasses = () => {
    const base = "w-full rounded border transition-colors";
    if (props.disabled)
      return `${base} opacity-50 cursor-not-allowed bg-[var(--color-bg-tertiary)]`;
    if (variant() === "filled") {
      return `${base} bg-[var(--color-bg-tertiary)] border-transparent focus:bg-[var(--color-bg-primary)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50`;
    }
    return `${base} bg-[var(--color-bg-primary)] border-[var(--color-border-default)] focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50`;
  };

  return (
    <div class={`relative ${props.class || ""}`}>
      <input
        ref={(el) => {
          inputEl = el;
          if (typeof props.ref === "function") props.ref(el);
        }}
        type="text"
        value={props.value ?? ""}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        class={`${variantClasses()} px-3 py-2 text-sm h-10 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none`}
        role="combobox"
        aria-expanded={isOpen()}
        aria-autocomplete="list"
        aria-controls="search-listbox"
        autocomplete="off"
      />

      {/* portal: hint + flyout rendered outside overflow-hidden parents */}
      <Show when={props.hintMessage || (isOpen() && (suggestions().length > 0 || props.loading))}>
        <Portal>
          {/* backdrop — only when flyout is open */}
          <Show when={isOpen() && (suggestions().length > 0 || props.loading)}>
            <div
              class="bg-black/10"
              style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 1001 }}
              onClick={() => props.onOpenChange?.(false)}
            />
          </Show>

          {/* hint text below input */}
          <Show when={props.hintMessage}>
            <div
              class="text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-elevated)] px-2 py-0.5 cursor-pointer hover:text-[var(--color-text-primary)] transition-colors truncate whitespace-nowrap"
              style={{
                position: "fixed",
                top: `${inputRect().bottom + 2}px`,
                left: isNarrow() ? "0" : `${inputRect().left}px`,
                width: isNarrow() ? "100vw" : `${inputRect().width}px`,
                "z-index": "1003",
              }}
              onClick={() => props.onHintClick?.()}
            >
              {props.hintMessage}
            </div>
          </Show>

          {/* suggestions flyout */}
          <Show when={isOpen() && (suggestions().length > 0 || props.loading)}>
            <div
              class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg overflow-hidden"
              style={{
                position: "fixed",
                top: `${inputRect().bottom + 4 + hintHeight}px`,
                left: isNarrow() ? "0" : `${inputRect().left}px`,
                width: isNarrow() ? "100vw" : undefined,
                "min-width": isNarrow() ? undefined : "400px",
                "max-width": isNarrow() ? undefined : "600px",
                "border-radius": isNarrow() ? "0" : undefined,
                "z-index": "1002",
              }}
              onMouseEnter={() => setIsHoveringDropdown(true)}
              onMouseLeave={() => setIsHoveringDropdown(false)}
            >
              <div
                ref={listRef}
                id="search-listbox"
                role="listbox"
                class="max-h-80 overflow-y-auto"
                onScroll={handleScroll}
              >
                <For each={suggestions()}>
                  {(item, index) => (
                    <SuggestionRow
                      suggestion={item}
                      highlighted={highlightedIndex() === index()}
                      index={index()}
                      onClick={() => {
                        props.onSelect?.(item);
                        setHighlightedIndex(-1);
                      }}
                      onHover={() => setHighlightedIndex(index())}
                    />
                  )}
                </For>
              </div>

              <Show when={showLoadingMore()}>
                <div class="px-4 py-2 text-center text-sm text-[var(--color-text-secondary)]">
                  loading more...
                </div>
              </Show>

              <Show when={!props.loading && suggestions().length === 0}>
                <div class="px-4 py-3 text-sm text-[var(--color-text-tertiary)] text-center">
                  no suggestions found
                </div>
              </Show>

              <Show when={props.footerContent}>
                <div class="border-t border-[var(--color-border-subtle)]">
                  {props.footerContent}
                </div>
              </Show>
            </div>
          </Show>
        </Portal>
      </Show>
    </div>
  );
}

// individual suggestion row
function SuggestionRow(props: {
  suggestion: SearchSuggestion;
  highlighted: boolean;
  index: number;
  onClick: () => void;
  onHover: () => void;
}) {
  const [imageHovered, setImageHovered] = createSignal(false);
  const hasPlayAction = () => !!props.suggestion.onPlay;

  return (
    <div
      data-index={props.index}
      role="option"
      aria-selected={props.highlighted}
      class="flex items-center gap-3 px-4 py-2 cursor-pointer text-sm transition-colors"
      classList={{
        "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]": props.highlighted,
        "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]": !props.highlighted,
      }}
      onMouseEnter={props.onHover}
      onClick={(e) => {
        // don't navigate if user clicked the play image
        if ((e.target as HTMLElement).closest("[data-play-target]")) return;
        props.onClick();
      }}
    >
      {/* image with play overlay on hover */}
      <div
        class="relative flex-shrink-0 rounded overflow-hidden"
        data-play-target={hasPlayAction() ? "" : undefined}
        onMouseEnter={() => setImageHovered(true)}
        onMouseLeave={() => setImageHovered(false)}
        onClick={(e) => {
          if (hasPlayAction()) {
            e.stopPropagation();
            props.suggestion.onPlay?.();
          }
        }}
      >
        <MediaImage
          images={props.suggestion.images}
          alt={props.suggestion.text}
          size="xs"
          domainType={
            (props.suggestion.category as "song" | "album" | "artist" | "genre" | "playlist") ||
            undefined
          }
          thumbnailSize={50}
        />
        <Show when={hasPlayAction() && imageHovered()}>
          <div class="absolute inset-0 bg-black/50 flex items-center justify-center rounded z-40">
            <Icon name="play" size={14} className="text-white" />
          </div>
        </Show>
      </div>

      {/* text with highlights + marquee */}
      <div class="flex-1 min-w-0">
        <HighlightedMarqueeText
          text={props.suggestion.text}
          highlight={props.suggestion.highlight}
          isHovering={props.highlighted}
        />
      </div>

      {/* favorite heart */}
      <Show when={props.suggestion.isFavorite}>
        <FavoriteHeart isFavorite={true} readonly={true} size="sm" class="flex-shrink-0" />
      </Show>

      {/* category badge */}
      <Show when={props.suggestion.category}>
        <div class="px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)] flex flex-col items-end leading-tight max-w-[140px]">
          <span>{props.suggestion.category}</span>
          <Show when={props.suggestion.categoryDetail}>
            <div class="text-[9px] opacity-70 w-full">
              <HighlightedMarqueeText
                text={props.suggestion.categoryDetail!.label}
                title={
                  props.suggestion.categoryDetail!.title ?? props.suggestion.categoryDetail!.label
                }
                isHovering={props.highlighted}
              />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
