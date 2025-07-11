import { createSignal, onMount, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import { useSearchState } from "../../hooks/search/index.js";
import { apiClient } from "../../lib/api-client.js";
import type { SearchSuggestion } from "../../lib/search/types.js";

export interface SearchBoxProps {
  /** Callback when search is triggered */
  onSearch?: (query: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Whether the search box is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  class?: string;
  /** Whether to use internal search state or external */
  useInternalState?: boolean;
  /** External query value (when not using internal state) */
  query?: string;
  /** External query change handler (when not using internal state) */
  onQueryChange?: (query: string) => void;
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
  /** Callback when suggestion is selected */
  onSuggestionSelect?: (suggestion: string) => void;
  /** Max suggestions to show */
  maxSuggestions?: number;
  /** Callback when search is cleared */
  onClear?: () => void;
}

export function SearchBox(props: SearchBoxProps) {
  const useInternal = props.useInternalState !== false;

  // Use internal state or external state
  const searchState = useInternal ? useSearchState({}) : null;

  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  const [searchTimeout, setSearchTimeout] = createSignal<number | undefined>();
  const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [suggestionsTimeout, setSuggestionsTimeout] = createSignal<
    number | undefined
  >();
  const [suppressSuggestions, setSuppressSuggestions] = createSignal(false);
  const [previousQuery, setPreviousQuery] = createSignal("");

  // Get current query value
  const currentQuery = () => {
    if (useInternal && searchState) {
      return searchState.query();
    }
    return props.query || "";
  };

  // Handle query change
  const handleQueryChange = (newQuery: string) => {
    if (useInternal && searchState) {
      searchState.setQuery(newQuery);
    } else {
      props.onQueryChange?.(newQuery);
    }

    // Auto-hide suggestions if query becomes empty
    if (!newQuery.trim()) {
      setSuggestions([]);
      setShowDropdown(false);
      setSelectedIndex(-1);
    }

    // Handle auto-search with debounce
    if (props.autoSearch && newQuery.trim()) {
      const timeout = searchTimeout();
      if (timeout) {
        clearTimeout(timeout);
      }

      const newTimeout = setTimeout(() => {
        props.onSearch?.(newQuery.trim());
      }, props.debounceMs || 300) as any;

      setSearchTimeout(newTimeout);
    }

    // Handle suggestions (only if not suppressed)
    if (props.showSuggestions && !suppressSuggestions()) {
      handleSuggestionsChange(newQuery);
    }
  };

  // Handle input change
  const handleInputChange: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    e
  ) => {
    const value = e.currentTarget.value;
    handleQueryChange(value);
  };

  // Fetch suggestions
  const fetchSuggestions = async (query: string) => {
    if (!query.trim() || !props.showSuggestions || suppressSuggestions()) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    try {
      const result = await apiClient.getMusicSuggestions(query, {
        limit: props.maxSuggestions || 8,
      });
      setSuggestions(result.suggestions || []);
      setShowDropdown(result.suggestions.length > 0);
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
      setSuggestions([]);
      setShowDropdown(false);
    }
  };

  // Handle suggestions with debounce
  const handleSuggestionsChange = (query: string) => {
    const timeout = suggestionsTimeout();
    if (timeout) {
      clearTimeout(timeout);
    }

    // Don't fetch if query hasn't changed
    if (query.trim() && query !== previousQuery()) {
      const newTimeout = setTimeout(() => {
        setPreviousQuery(query);
        fetchSuggestions(query);
      }, 150) as any;
      setSuggestionsTimeout(newTimeout);
    } else if (!query.trim()) {
      setSuggestions([]);
      setShowDropdown(false);
      setPreviousQuery("");
    }
  };

  // Handle key down events
  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    const suggestionsList = suggestions();

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
        console.log("🔍 SearchBox Enter key pressed");
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
          // Handle regular search using input value
          const inputValue = inputRef()?.value?.trim() || "";
          const query = inputValue || currentQuery().trim();
          console.log("🔍 Enter key search with query:", query);
          if (query) {
            handleQueryChange(query);
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

  // Handle search button click
  const handleSearchClick = () => {
    const inputValue = inputRef()?.value?.trim() || "";
    const query = inputValue || currentQuery().trim();
    console.log("🔍 SearchBox search with query:", query);
    if (query) {
      // Update the query state to match input value
      handleQueryChange(query);
      setShowDropdown(false);
      setSuppressSuggestions(true);
      setPreviousQuery(query);

      props.onSearch?.(query);
      inputRef()?.blur();

      // Reset suppression after delay
      setTimeout(() => {
        setSuppressSuggestions(false);
        setPreviousQuery("");
      }, 1000);
    }
  };

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: string) => {
    handleQueryChange(suggestion);
    setShowDropdown(false);
    setSelectedIndex(-1);
    setSuppressSuggestions(true);
    setPreviousQuery(suggestion);
    props.onSuggestionSelect?.(suggestion);
    inputRef()?.blur();

    // Reset suppression after a delay to allow for new searches
    setTimeout(() => {
      setSuppressSuggestions(false);
      setPreviousQuery("");
    }, 1000);
  };

  // Handle input focus
  const handleFocus = () => {
    const query = currentQuery().trim();
    if (query && suggestions().length > 0 && !suppressSuggestions()) {
      setShowDropdown(true);
    }
  };

  // Handle input blur (with delay to allow clicks)
  const handleBlur = () => {
    setTimeout(() => {
      setShowDropdown(false);
      setSelectedIndex(-1);
    }, 150);
  };

  // Focus the input programmatically (for future use)
  // const focus = () => {
  //   inputRef()?.focus();
  // };

  // Clear function removed - clearing is handled through onClear callback and auto-hide logic

  // Cleanup timeout on unmount
  onMount(() => {
    return () => {
      const timeout = searchTimeout();
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  });

  return (
    <div class={`search-box ${props.class || ""}`}>
      <div class="search-box__container">
        <input
          ref={setInputRef}
          type="text"
          value={currentQuery()}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={props.placeholder || "Search..."}
          disabled={props.disabled}
          class="search-box__input"
          autocomplete="off"
        />

        {props.showSearchButton && (
          <button
            class="search-box__button"
            onClick={handleSearchClick}
            disabled={props.disabled || !currentQuery().trim()}
            type="button"
          >
            {props.searchButtonText || "Search"}
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      <Show when={showDropdown() && suggestions().length > 0}>
        <div class="search-suggestions">
          <For each={suggestions()}>
            {(suggestion, index) => (
              <div
                class={`search-suggestion ${
                  index() === selectedIndex()
                    ? "search-suggestion--selected"
                    : ""
                }`}
                onClick={() => handleSuggestionSelect(suggestion.text)}
              >
                <span class="search-suggestion__text">{suggestion.text}</span>
                <span class="search-suggestion__category">
                  {suggestion.category}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <style>{`
        .search-box {
          position: relative;
          width: 100%;
        }

        .search-box__container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .search-box__input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid transparent;
          border-radius: 8px;
          font-size: 14px;
          outline: none;
          background: rgba(255, 255, 255, 0.1);
          color: white;
          transition: all 0.3s ease;
        }

        .search-box__input::placeholder {
          color: rgba(255, 255, 255, 0.6);
        }

        .search-box__input:focus {
          border-color: #d946ef;
          box-shadow: 0 0 0 2px rgba(217, 70, 239, 0.25);
          background: rgba(255, 255, 255, 0.15);
        }

        .search-box__input:disabled {
          background-color: rgba(255, 255, 255, 0.05);
          cursor: not-allowed;
          color: rgba(255, 255, 255, 0.4);
        }

        .search-box__button {
          padding: 8px 16px;
          border: 1px solid #d946ef;
          background-color: #d946ef;
          color: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.3s ease;
        }

        .search-box__button:hover:not(:disabled) {
          background-color: #c026d3;
          border-color: #c026d3;
          transform: translateY(-1px);
        }

        .search-box__button:disabled {
          background-color: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.1);
          cursor: not-allowed;
          color: rgba(255, 255, 255, 0.4);
        }

        .search-box__button:active {
          transform: translateY(0px);
        }

        /* Suggestions Dropdown */
        .search-suggestions {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.95);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          margin-top: 4px;
          max-height: 240px;
          overflow-y: auto;
          z-index: 1000;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .search-suggestion {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .search-suggestion:last-child {
          border-bottom: none;
        }

        .search-suggestion:hover,
        .search-suggestion--selected {
          background: rgba(217, 70, 239, 0.2);
          border-color: rgba(217, 70, 239, 0.3);
        }

        .search-suggestion__text {
          color: white;
          font-size: 14px;
          font-weight: 400;
        }

        .search-suggestion__category {
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 8px;
          border-radius: 12px;
        }

        /* Scrollbar styling for suggestions */
        .search-suggestions::-webkit-scrollbar {
          width: 4px;
        }

        .search-suggestions::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
        }

        .search-suggestions::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
        }

        .search-suggestions::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
}

export default SearchBox;
