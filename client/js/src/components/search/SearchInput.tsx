/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import type { JSX } from "solid-js";

export interface SearchSuggestion {
  text: string;
  category?: string;
  highlight?: string;
}

export interface SearchInputProps {
  /** Current search query */
  value?: string;
  /** Callback when search query changes */
  onInput?: (query: string) => void;
  /** Callback when search is executed */
  onSearch?: (query: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether the search input is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  class?: string;
  /** Whether to show search button */
  showSearchButton?: boolean;
  /** Search button text */
  searchButtonText?: string;
  /** Auto-search on input change */
  autoSearch?: boolean;
  /** Debounce delay for auto-search */
  debounceMs?: number;
  /** Show suggestions dropdown */
  showSuggestions?: boolean;
  /** Function to fetch suggestions */
  onFetchSuggestions?: (query: string) => Promise<SearchSuggestion[]>;
  /** External suggestions array */
  suggestions?: SearchSuggestion[];
  /** Callback when suggestion is selected */
  onSuggestionSelect?: (suggestion: string) => void;
  /** Max suggestions to show */
  maxSuggestions?: number;
  /** Callback when search is cleared */
  onClear?: () => void;
  /** Loading state for suggestions */
  suggestionsLoading?: boolean;
}

export function SearchInput(props: SearchInputProps) {
  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  const [searchTimeout, setSearchTimeout] = createSignal<number | undefined>();
  const [internalSuggestions, setInternalSuggestions] = createSignal<
    SearchSuggestion[]
  >([]);
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [suggestionsTimeout, setSuggestionsTimeout] = createSignal<
    number | undefined
  >();
  const [suppressSuggestions, setSuppressSuggestions] = createSignal(false);
  const [previousQuery, setPreviousQuery] = createSignal("");
  const [internalValue, setInternalValue] = createSignal(props.value || "");

  // get current value
  const currentValue = () => props.value ?? internalValue();

  // get current suggestions
  const currentSuggestions = () => props.suggestions ?? internalSuggestions();

  // handle input change
  const handleInputChange: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    e
  ) => {
    const value = e.currentTarget.value;
    setInternalValue(value);
    props.onInput?.(value);

    // auto-hide suggestions if query becomes empty
    if (!value.trim()) {
      setInternalSuggestions([]);
      setShowDropdown(false);
      setSelectedIndex(-1);
    }

    // handle auto-search with debounce
    if (props.autoSearch && value.trim()) {
      const timeout = searchTimeout();
      if (timeout) {
        clearTimeout(timeout);
      }

      const newTimeout = setTimeout(() => {
        props.onSearch?.(value.trim());
      }, props.debounceMs || 300) as any;

      setSearchTimeout(newTimeout);
    }

    // handle suggestions (only if not suppressed)
    if (props.showSuggestions && !suppressSuggestions()) {
      handleSuggestionsChange(value);
    }
  };

  // fetch suggestions
  const fetchSuggestions = async (query: string) => {
    if (!query.trim() || !props.showSuggestions || suppressSuggestions()) {
      setInternalSuggestions([]);
      setShowDropdown(false);
      return;
    }

    if (!props.onFetchSuggestions) {
      return;
    }

    try {
      const suggestions = await props.onFetchSuggestions(query);
      const limited = suggestions.slice(0, props.maxSuggestions || 8);
      setInternalSuggestions(limited);
      setShowDropdown(limited.length > 0);
    } catch (error) {
      console.error("failed to fetch suggestions:", error);
      setInternalSuggestions([]);
      setShowDropdown(false);
    }
  };

  // handle suggestions with debounce
  const handleSuggestionsChange = (query: string) => {
    const timeout = suggestionsTimeout();
    if (timeout) {
      clearTimeout(timeout);
    }

    // don't fetch if query hasn't changed
    if (query.trim() && query !== previousQuery()) {
      const newTimeout = setTimeout(() => {
        setPreviousQuery(query);
        fetchSuggestions(query);
      }, 150) as any;
      setSuggestionsTimeout(newTimeout);
    } else if (!query.trim()) {
      setInternalSuggestions([]);
      setShowDropdown(false);
      setPreviousQuery("");
    }
  };

  // handle key down events
  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    const suggestionsList = currentSuggestions();

    switch (e.key) {
      case "ArrowDown":
        if (showDropdown() && suggestionsList.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestionsList.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case "ArrowUp":
        if (showDropdown() && suggestionsList.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestionsList.length - 1
          );
        }
        break;
      case "Enter":
        e.preventDefault();

        if (
          showDropdown() &&
          selectedIndex() >= 0 &&
          selectedIndex() < suggestionsList.length
        ) {
          const selected = suggestionsList[selectedIndex()];
          if (selected) {
            handleSuggestionSelect(selected.text);
          }
        } else {
          // handle regular search using input value
          const inputValue = inputRef()?.value?.trim() || "";
          const query = inputValue || currentValue().trim();

          if (query) {
            setInternalValue(query);
            props.onInput?.(query);
            handleSearchClick();
          }
        }
        break;
      case "Escape":
        setShowDropdown(false);
        setSelectedIndex(-1);
        inputRef()?.blur();
        break;
    }
  };

  // handle search button click
  const handleSearchClick = () => {
    const inputValue = inputRef()?.value?.trim() || "";
    const query = inputValue || currentValue().trim();

    if (query) {
      setInternalValue(query);
      props.onInput?.(query);
      setShowDropdown(false);
      setSuppressSuggestions(true);
      setPreviousQuery(query);

      props.onSearch?.(query);
      inputRef()?.blur();

      // reset suppression after delay
      setTimeout(() => {
        setSuppressSuggestions(false);
        setPreviousQuery("");
      }, 1000);
    }
  };

  // handle suggestion selection
  const handleSuggestionSelect = (suggestion: string) => {
    setInternalValue(suggestion);
    props.onInput?.(suggestion);
    setShowDropdown(false);
    setSelectedIndex(-1);
    setSuppressSuggestions(true);
    setPreviousQuery(suggestion);
    props.onSuggestionSelect?.(suggestion);
    inputRef()?.blur();

    // reset suppression after a delay to allow for new searches
    setTimeout(() => {
      setSuppressSuggestions(false);
      setPreviousQuery("");
    }, 1000);
  };

  // handle input focus
  const handleFocus = () => {
    const query = currentValue().trim();
    if (query && currentSuggestions().length > 0 && !suppressSuggestions()) {
      setShowDropdown(true);
    }
  };

  // handle input blur (with delay to allow clicks)
  const handleBlur = () => {
    setTimeout(() => {
      setShowDropdown(false);
      setSelectedIndex(-1);
    }, 150);
  };

  // sync internal value with external value
  createEffect(() => {
    if (props.value !== undefined) {
      setInternalValue(props.value);
    }
  });

  // sync external suggestions
  createEffect(() => {
    if (props.suggestions !== undefined) {
      setShowDropdown(
        props.suggestions.length > 0 && currentValue().length > 1
      );
    }
  });

  // cleanup timeout on unmount
  onMount(() => {
    return () => {
      const timeout = searchTimeout();
      if (timeout) {
        clearTimeout(timeout);
      }
      const sugTimeout = suggestionsTimeout();
      if (sugTimeout) {
        clearTimeout(sugTimeout);
      }
    };
  });

  return (
    <div class={`relative w-full mb-4 ${props.class || ""}`}>
      <div class="flex items-center">
        <input
          ref={setInputRef}
          type="text"
          value={currentValue()}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={props.placeholder || "search..."}
          disabled={props.disabled}
          class="flex-1 px-4 py-3 border border-gray-600 bg-gray-800 text-white placeholder-gray-400 outline-none transition-all duration-200 focus:border-magenta-500 focus:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-500 disabled:cursor-not-allowed"
          autocomplete="off"
        />

        {props.showSearchButton && (
          <button
            class="px-4 py-3 border border-l-0 border-magenta-500 bg-magenta-500 text-white font-medium transition-all duration-200 hover:bg-magenta-600 hover:border-magenta-600 disabled:bg-gray-600 disabled:border-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
            onClick={handleSearchClick}
            disabled={props.disabled || !currentValue().trim()}
            type="button"
          >
            {props.searchButtonText || "search"}
          </button>
        )}
      </div>

      {/* suggestions dropdown */}
      <Show when={showDropdown() && currentSuggestions().length > 0}>
        <div class="absolute top-full left-0 right-0 bg-black border border-gray-600 mt-0.5 max-h-80 overflow-y-auto z-50 shadow-2xl">
          <For each={currentSuggestions()}>
            {(suggestion, index) => (
              <div
                class={`flex items-center justify-between px-4 py-3 cursor-pointer transition-all duration-150 border-b border-gray-800 last:border-b-0 ${
                  index() === selectedIndex()
                    ? "bg-magenta-500 bg-opacity-20"
                    : "hover:bg-gray-800"
                }`}
                onClick={() => handleSuggestionSelect(suggestion.text)}
              >
                <span class="text-white text-sm">{suggestion.text}</span>
                {suggestion.category && (
                  <span class="text-gray-400 text-xs bg-gray-600 px-2 py-1">
                    {suggestion.category}
                  </span>
                )}
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* show loading state for suggestions */}
      <Show when={props.suggestionsLoading && currentValue().length > 1}>
        <div class="absolute top-full left-0 right-0 bg-black border border-gray-600 mt-0.5 z-50 shadow-2xl">
          <div class="flex items-center justify-center px-4 py-3">
            <div class="animate-spin h-4 w-4 border border-magenta-500 border-t-transparent mr-2"></div>
            <span class="text-gray-400 text-sm">loading suggestions...</span>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default SearchInput;
