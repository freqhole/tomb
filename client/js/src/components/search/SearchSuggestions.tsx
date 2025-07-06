/* @jsxImportSource solid-js */
import {
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";

import { useSearchSuggestions } from "../../hooks/search/index.js";

export interface SearchSuggestionsProps {
  /** Current search query */
  query: string;
  /** Callback when a suggestion is selected */
  onSuggestionSelect?: (suggestion: string) => void;
  /** Whether to use internal suggestions hook */
  useInternalSuggestions?: boolean;
  /** External suggestions (when not using internal hook) */
  suggestions?: string[];
  /** Whether suggestions are loading */
  loading?: boolean;
  /** Whether to show the suggestions dropdown */
  show?: boolean;
  /** Maximum number of suggestions to display */
  maxSuggestions?: number;
  /** Additional CSS classes */
  class?: string;
  /** Debounce delay for fetching suggestions */
  debounceMs?: number;
  /** Position relative to parent */
  position?: "bottom" | "top";
  /** Whether to show loading indicator */
  showLoading?: boolean;
  /** API client for fetching suggestions (required when using internal hook) */
  apiClient?: any;
  /** Callback when suggestions should be hidden (e.g., on blur, submit) */
  onBlur?: () => void;
}

export function SearchSuggestions(props: SearchSuggestionsProps) {
  const useInternal = props.useInternalSuggestions !== false;

  // Use internal suggestions hook or external suggestions
  const suggestionsHook =
    useInternal && props.apiClient
      ? useSearchSuggestions({
          apiClient: props.apiClient,
          query: () => props.query,
          debounceMs: props.debounceMs || 300,
          enabled: props.show !== false,
        })
      : null;

  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [dropdownRef, setDropdownRef] = createSignal<HTMLDivElement>();
  const [isVisible, setIsVisible] = createSignal(true);

  // Get current suggestions
  const currentSuggestions = () => {
    if (useInternal && suggestionsHook) {
      return suggestionsHook.suggestions();
    }
    return props.suggestions || [];
  };

  // Get current loading state
  const isLoading = () => {
    if (useInternal && suggestionsHook) {
      return suggestionsHook.loading();
    }
    return props.loading || false;
  };

  // Filter and limit suggestions
  const filteredSuggestions = () => {
    const query = props.query.toLowerCase().trim();
    if (!query) return [];

    const filtered = currentSuggestions()
      .filter((suggestion) => {
        const text =
          typeof suggestion === "string" ? suggestion : suggestion.text;
        return (
          text.toLowerCase().includes(query) && text.toLowerCase() !== query
        );
      })
      .slice(0, props.maxSuggestions || 10);

    return filtered;
  };

  // Group suggestions by category
  const groupedSuggestions = () => {
    const suggestions = filteredSuggestions();
    const groups = new Map<string, any[]>();

    // Group suggestions by category
    suggestions.forEach((suggestion) => {
      const category =
        typeof suggestion === "string"
          ? "general"
          : suggestion.category || "general";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(suggestion);
    });

    // Convert to array and sort by category priority
    const categoryOrder = ["word", "title", "playlist", "general"];
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      const aOrder = aIndex === -1 ? categoryOrder.length : aIndex;
      const bOrder = bIndex === -1 ? categoryOrder.length : bIndex;
      return aOrder - bOrder;
    });
  };

  // Get category display name
  const getCategoryDisplayName = (category: string) => {
    const categoryNames: Record<string, string> = {
      word: "Search suggestions",
      title: "Songs",
      playlist: "Playlists",
      general: "Suggestions",
    };
    return (
      categoryNames[category] ||
      category.charAt(0).toUpperCase() + category.slice(1)
    );
  };

  // Check if dropdown should be visible
  const shouldShowDropdown = () => {
    if (props.show === false) return false;
    if (!props.query.trim()) return false;
    if (!isVisible()) return false;
    return (
      filteredSuggestions().length > 0 || (isLoading() && props.showLoading)
    );
  };

  // Get flattened suggestions for keyboard navigation
  const flattenedSuggestions = () => {
    return groupedSuggestions().reduce((acc, [_, suggestions]) => {
      return acc.concat(suggestions);
    }, [] as any[]);
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    props.onSuggestionSelect?.(suggestion);
    setSelectedIndex(-1);
    setIsVisible(false);
    props.onBlur?.();
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    const suggestions = flattenedSuggestions();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
        }
        break;

      case "Enter":
        e.preventDefault();
        if (selectedIndex() >= 0 && selectedIndex() < suggestions.length) {
          const selected = suggestions[selectedIndex()];
          if (selected) {
            const text =
              typeof selected === "string" ? selected : selected.text;
            handleSuggestionClick(text);
          }
        } else {
          // Close dropdown if Enter pressed without selection
          setIsVisible(false);
          props.onBlur?.();
        }
        break;

      case "Escape":
        setSelectedIndex(-1);
        setIsVisible(false);
        props.onBlur?.();
        break;
    }
  };

  // Reset selection when suggestions change
  createEffect(() => {
    const suggestions = flattenedSuggestions();
    if (suggestions.length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex() >= suggestions.length) {
      setSelectedIndex(suggestions.length - 1);
    }
  });

  // Show dropdown when query changes (reset visibility)
  createEffect(() => {
    const query = props.query.trim();
    if (query) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  });

  // Handle clicks outside the dropdown
  const handleClickOutside = (e: MouseEvent) => {
    const dropdown = dropdownRef();
    if (dropdown && !dropdown.contains(e.target as Node)) {
      setIsVisible(false);
      props.onBlur?.();
    }
  };

  // Add event listeners
  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("mousedown", handleClickOutside);
  });

  return (
    <Show when={shouldShowDropdown()}>
      <div
        ref={setDropdownRef}
        class={`search-suggestions ${props.class || ""} search-suggestions--${props.position || "bottom"}`}
        role="listbox"
        aria-label="Search suggestions"
      >
        <Show when={isLoading() && props.showLoading}>
          <div class="search-suggestions__loading">Loading suggestions...</div>
        </Show>

        <Show when={!isLoading() && filteredSuggestions().length > 0}>
          <For each={groupedSuggestions()}>
            {([category, suggestions]) => {
              // Calculate the starting index for this group
              const flatSuggestions = flattenedSuggestions();
              const groupStartIndex = flatSuggestions.findIndex((s) =>
                suggestions.includes(s)
              );

              return (
                <div class="search-suggestions__group">
                  <div class="search-suggestions__group-header">
                    {getCategoryDisplayName(category)}
                  </div>
                  <For each={suggestions}>
                    {(suggestion, localIndex) => {
                      const globalIndex = groupStartIndex + localIndex();
                      const text =
                        typeof suggestion === "string"
                          ? suggestion
                          : suggestion.text;
                      return (
                        <div
                          class={`search-suggestions__item ${
                            globalIndex === selectedIndex()
                              ? "search-suggestions__item--selected"
                              : ""
                          }`}
                          onClick={() => handleSuggestionClick(text)}
                          role="option"
                          aria-selected={globalIndex === selectedIndex()}
                          data-suggestion={text}
                        >
                          <span class="search-suggestions__text">{text}</span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              );
            }}
          </For>
        </Show>

        <style>{`
          .search-suggestions {
            position: absolute;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
          }

          .search-suggestions--bottom {
            top: 100%;
            margin-top: 4px;
          }

          .search-suggestions--top {
            bottom: 100%;
            margin-bottom: 4px;
          }

          .search-suggestions__loading {
            padding: 12px 16px;
            text-align: center;
            color: #666;
            font-size: 14px;
          }

          .search-suggestions__item {
            padding: 8px 12px;
            cursor: pointer;
            transition: background-color 0.2s;
            border-bottom: 1px solid #f0f0f0;
          }

          .search-suggestions__item:last-child {
            border-bottom: none;
          }

          .search-suggestions__item:hover,
          .search-suggestions__item--selected {
            background-color: #f8f9fa;
          }

          .search-suggestions__item--selected {
            background-color: #007bff;
            color: white;
          }

          .search-suggestions__text {
            font-size: 14px;
            line-height: 1.2;
          }

          .search-suggestions__group {
            border-bottom: 1px solid #e9ecef;
          }

          .search-suggestions__group:last-child {
            border-bottom: none;
          }

          .search-suggestions__group-header {
            padding: 8px 12px 4px 12px;
            font-size: 12px;
            font-weight: 600;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background-color: #f8f9fa;
            border-bottom: 1px solid #f0f0f0;
          }

          .search-suggestions__group .search-suggestions__item {
            padding-left: 20px;
          }

          /* Scrollbar styling */
          .search-suggestions::-webkit-scrollbar {
            width: 4px;
          }

          .search-suggestions::-webkit-scrollbar-track {
            background: #f1f1f1;
          }

          .search-suggestions::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 2px;
          }

          .search-suggestions::-webkit-scrollbar-thumb:hover {
            background: #a8a8a8;
          }
        `}</style>
      </div>
    </Show>
  );
}

export default SearchSuggestions;
