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
  suggestions?: any[];
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
    console.log("using external suggestions:", props.suggestions);
    // Ensure we always return an array even if props.suggestions is undefined
    const suggestions = Array.isArray(props.suggestions)
      ? props.suggestions
      : [];

    // Process suggestions to ensure they have the expected format
    return suggestions.map((suggestion: any) => {
      // If it's already a string, create a simple suggestion object
      if (typeof suggestion === "string") {
        return { text: suggestion, category: "general" };
      }

      // Handle server-style suggestion format
      if (typeof suggestion === "object" && suggestion !== null) {
        // If it already has a text property, use it directly
        if (suggestion.text) {
          return suggestion;
        }

        // Map server format to component format
        return {
          text: suggestion.value || suggestion.query || String(suggestion),
          category:
            suggestion.suggestion_type || suggestion.category || "general",
          highlight: suggestion.highlight,
          value: suggestion.value,
          display: suggestion.display,
        };
      }

      return { text: String(suggestion), category: "general" };
    });
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

    // Get current suggestions (from props or hook)
    const suggestions = currentSuggestions();

    // If query is too short or no suggestions available, return empty array
    if (!props.query.trim() || suggestions.length === 0) {
      return [];
    }

    console.log("filtering suggestions:", suggestions);

    const filtered = suggestions
      .filter((suggestion) => {
        const text =
          suggestion.text ||
          suggestion.value ||
          suggestion.display ||
          String(suggestion);
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
    // Simple conditions for visibility
    const hasQuery = props.query.trim().length >= 1;
    const hasSuggestions = filteredSuggestions().length > 0;
    const isLoadingVisible = isLoading() && props.showLoading;

    // Force showing when explicitly requested
    if (props.show === true && hasQuery && isVisible() && isLoadingVisible) {
      return true;
    }

    // Show dropdown when we have suggestions or we're loading and allowed to show loading
    const shouldShow =
      props.show !== false &&
      hasQuery &&
      isVisible() &&
      (hasSuggestions || isLoadingVisible);

    console.log("search suggestions visibility check:", {
      propsShow: props.show,
      hasQuery,
      isVisible: isVisible(),
      hasSuggestions,
      isLoadingVisible,
      filteredCount: filteredSuggestions().length,
      rawSuggestions: currentSuggestions().length,
      shouldShow,
    });

    return shouldShow;
  };

  // Get flattened suggestions for keyboard navigation
  const flattenedSuggestions = () => {
    return groupedSuggestions().reduce((acc, [_, suggestions]) => {
      return acc.concat(suggestions);
    }, [] as any[]);
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: any) => {
    // Get the text value from the suggestion object or use the string directly
    const suggestionText =
      typeof suggestion === "object"
        ? suggestion.text ||
          suggestion.value ||
          suggestion.display ||
          String(suggestion)
        : suggestion;

    console.log("Suggestion clicked:", suggestionText);
    props.onSuggestionSelect?.(suggestionText);
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

  // For debugging
  console.log("search suggestions render:", {
    query: props.query,
    suggestions: currentSuggestions().length,
    filtered: filteredSuggestions(),
    show: props.show,
    loading: isLoading(),
    shouldShow: shouldShowDropdown(),
  });

  return (
    <Show when={shouldShowDropdown()}>
      <div
        ref={setDropdownRef}
        class={`absolute left-0 right-0 bg-gray-900 border border-gray-800 max-h-60 overflow-y-auto z-50 shadow-lg ${
          props.position === "top" ? "bottom-full mb-1" : "top-full mt-0"
        } ${props.class || ""}`}
        role="listbox"
        aria-label="search suggestions"
        style={{
          "min-height": isLoading() ? "40px" : "auto",
          "border-top": "none",
          "margin-top": "1px",
        }}
      >
        <Show when={isLoading() && props.showLoading}>
          <div class="p-3 text-center text-gray-400 text-sm">
            <div class="flex items-center justify-center">
              <div class="animate-spin h-4 w-4 border-2 border-magenta-500 border-t-transparent mr-2"></div>
              <span>loading suggestions</span>
            </div>
          </div>
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
                <div class="border-b border-gray-800 last:border-0">
                  <div class="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-black">
                    {getCategoryDisplayName(category)}
                  </div>
                  <For each={suggestions}>
                    {(suggestion, localIndex) => {
                      const globalIndex = groupStartIndex + localIndex();
                      const text =
                        typeof suggestion === "object"
                          ? suggestion.text ||
                            suggestion.value ||
                            suggestion.display ||
                            String(suggestion)
                          : suggestion;
                      return (
                        <div
                          class={`px-4 py-2 cursor-pointer text-sm hover:bg-gray-800 ${
                            globalIndex === selectedIndex()
                              ? "bg-gray-800 text-magenta-300"
                              : "text-white"
                          }`}
                          onClick={() => handleSuggestionClick(suggestion)}
                          role="option"
                          aria-selected={globalIndex === selectedIndex()}
                          data-suggestion={text}
                        >
                          {typeof suggestion === "object" &&
                          (suggestion as any).highlight ? (
                            <span
                              // @ts-ignore - Known usage for highlight rendering
                              dangerouslySetInnerHTML={{
                                __html: (suggestion as any).highlight,
                              }}
                            />
                          ) : (
                            text
                          )}
                        </div>
                      );
                    }}
                  </For>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </Show>
  );
}

export default SearchSuggestions;
