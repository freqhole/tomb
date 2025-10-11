/* @jsxImportSource solid-js */
import {
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
} from "solid-js";

export interface SearchSuggestionsProps {
  /** Current search query */
  query: string;
  /** Callback when a suggestion is selected */
  onSuggestionSelect?: (suggestion: string | any) => void;
  /** External suggestions array */
  suggestions?: any[];
  /** Whether suggestions are loading */
  loading?: boolean;
  /** Whether to show the suggestions dropdown */
  show?: boolean;
  /** Additional CSS classes */
  class?: string;
  /** Position relative to parent */
  position?: "bottom" | "top";
  /** Whether to show loading indicator */
  showLoading?: boolean;
  /** Callback when suggestions should be hidden */
  onBlur?: () => void;
}

export function SearchSuggestions(props: SearchSuggestionsProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [dropdownRef, setDropdownRef] = createSignal<HTMLDivElement>();
  const [isVisible, setIsVisible] = createSignal(true);

  // normalize suggestions to consistent format
  const normalizedSuggestions = () => {
    if (!Array.isArray(props.suggestions)) return [];

    return props.suggestions.map((suggestion: any) => {
      if (typeof suggestion === "string") {
        return { text: suggestion, category: "general", original: suggestion };
      }

      if (typeof suggestion === "object" && suggestion !== null) {
        const text =
          suggestion.text ||
          suggestion.value ||
          suggestion.query ||
          suggestion.display ||
          String(suggestion);

        return {
          text: text,
          category:
            suggestion.suggestion_type || suggestion.category || "general",
          highlight: suggestion.highlight,
          original: suggestion, // preserve original suggestion data
        };
      }

      return {
        text: String(suggestion),
        category: "general",
        original: suggestion,
      };
    });
  };

  // group suggestions by category
  const groupedSuggestions = () => {
    const suggestions = normalizedSuggestions();
    const groups = new Map<string, any[]>();

    suggestions.forEach((suggestion: any) => {
      const category = suggestion.category || "general";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(suggestion);
    });

    // sort by category priority
    const categoryOrder = [
      "word",
      "artist",
      "album",
      "title",
      "genre",
      "playlist",
      "all",
      "general",
    ];
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      const aOrder = aIndex === -1 ? categoryOrder.length : aIndex;
      const bOrder = bIndex === -1 ? categoryOrder.length : bIndex;
      return aOrder - bOrder;
    });
  };

  // get category display name
  const getCategoryDisplayName = (category: string) => {
    const categoryNames: Record<string, string> = {
      word: "search suggestions",
      title: "songs",
      artist: "artists",
      album: "albums",
      genre: "genres",
      playlist: "playlists",
      general: "suggestions",
      all: "mixed results",
    };
    return categoryNames[category] || category;
  };

  // simple visibility logic
  const shouldShowDropdown = () => {
    const hasQuery = props.query.trim().length >= 2;
    const hasSuggestions = normalizedSuggestions().length > 0;
    const isLoading = props.loading && props.showLoading;

    // show when explicitly requested
    if (props.show === true && hasQuery && isVisible()) {
      return true;
    }

    // show when loading
    if (hasQuery && isVisible() && isLoading) {
      return true;
    }

    // show when we have suggestions
    return props.show !== false && hasQuery && isVisible() && hasSuggestions;
  };

  // flatten suggestions for keyboard navigation
  const flattenedSuggestions = () => {
    return groupedSuggestions().reduce((acc, [_, suggestions]) => {
      return acc.concat(suggestions);
    }, [] as any[]);
  };

  // handle suggestion click
  const handleSuggestionClick = (suggestion: any) => {
    // pass original suggestion data if available, otherwise fall back to text
    const suggestionToPass = suggestion.original || suggestion.text;
    props.onSuggestionSelect?.(suggestionToPass);
    setSelectedIndex(-1);
    setIsVisible(false);
    props.onBlur?.();
  };

  // render highlighted text without dangerouslySetInnerHTML
  const renderHighlightedText = (suggestion: any) => {
    const textToRender = suggestion.highlight || suggestion.text;

    if (!textToRender) {
      return suggestion.text;
    }

    // handle both <mark> tags and ** patterns for highlighting
    let parts: string[] = [];

    if (textToRender.includes("<mark>")) {
      // handle <mark> tags
      parts = textToRender.split(/(<mark>.*?<\/mark>)/g);
    } else if (textToRender.includes("**")) {
      // handle ** patterns like **highlighted text**
      parts = textToRender.split(/(\*\*.*?\*\*)/g);
    } else {
      // no highlighting patterns found
      return textToRender;
    }

    return (
      <span>
        <For each={parts}>
          {(part) => {
            if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
              const content = part.slice(6, -7); // remove <mark></mark>
              return (
                <span class="text-magenta-300 font-medium">{content}</span>
              );
            } else if (part.startsWith("**") && part.endsWith("**")) {
              const content = part.slice(2, -2); // remove **
              return (
                <span class="text-magenta-300 font-medium">{content}</span>
              );
            }
            return part;
          }}
        </For>
      </span>
    );
  };

  // keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!shouldShowDropdown()) return;

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
            handleSuggestionClick(selected);
          }
        } else {
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

  // handle clicks outside
  const handleClickOutside = (e: MouseEvent) => {
    const dropdown = dropdownRef();
    if (dropdown && !dropdown.contains(e.target as Node)) {
      setIsVisible(false);
      props.onBlur?.();
    }
  };

  // reset selection when suggestions change
  createEffect(() => {
    const suggestions = flattenedSuggestions();
    if (suggestions.length === 0) {
      setSelectedIndex(-1);
    } else if (selectedIndex() >= suggestions.length) {
      setSelectedIndex(suggestions.length - 1);
    }
  });

  // show dropdown when query changes
  createEffect(() => {
    const query = props.query.trim();
    setIsVisible(query.length >= 2);
  });

  // event listeners
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
        class={`absolute left-0 right-0 bg-black max-h-80 overflow-y-auto z-50 border border-gray-700 ${
          props.position === "top" ? "bottom-full mb-1" : "top-full mt-1"
        } ${props.class || ""}`}
        role="listbox"
        aria-label="search suggestions"
        style={{
          "box-shadow": "0 8px 32px rgba(0, 0, 0, 0.9)",
        }}
      >
        <Show when={props.loading && props.showLoading}>
          <div class="p-4 text-center text-gray-400">
            <div class="flex items-center justify-center">
              <div class="animate-spin h-4 w-4 border border-magenta-400 border-t-transparent mr-2"></div>
              <span>loading suggestions...</span>
            </div>
          </div>
        </Show>

        <Show when={!props.loading && normalizedSuggestions().length > 0}>
          <For each={groupedSuggestions()}>
            {([category, suggestions]) => {
              const flatSuggestions = flattenedSuggestions();
              const groupStartIndex = flatSuggestions.findIndex((s) =>
                suggestions.includes(s)
              );

              return (
                <div class="last:border-0">
                  <div class="px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider bg-gray-950 border-b border-gray-800">
                    {getCategoryDisplayName(category)}
                  </div>
                  <For each={suggestions}>
                    {(suggestion, localIndex) => {
                      const globalIndex = groupStartIndex + localIndex();
                      const isSelected = globalIndex === selectedIndex();

                      return (
                        <div
                          class={`px-4 py-3 cursor-pointer text-sm transition-all duration-150 border-0 ${
                            isSelected
                              ? "bg-magenta-700 text-white shadow-md"
                              : "text-gray-100 hover:bg-gray-800 hover:text-white hover:shadow-sm"
                          }`}
                          onClick={() => handleSuggestionClick(suggestion)}
                          role="option"
                          aria-selected={isSelected}
                          data-suggestion={suggestion.text}
                        >
                          <div class="flex items-center justify-between">
                            <span class="flex-1">
                              {renderHighlightedText(suggestion)}
                            </span>
                            <Show
                              when={suggestion.count && suggestion.count > 1}
                            >
                              <span class="text-xs text-gray-400 ml-2">
                                ({suggestion.count})
                              </span>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              );
            }}
          </For>
        </Show>

        <Show
          when={
            !props.loading &&
            normalizedSuggestions().length === 0 &&
            props.query.length >= 2
          }
        >
          <div class="px-4 py-3 text-sm text-gray-500 text-center">
            no suggestions found
          </div>
        </Show>
      </div>
    </Show>
  );
}

export default SearchSuggestions;
