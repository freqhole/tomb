/* @jsxImportSource solid-js */
import { createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { useSearchState } from "../../hooks/useSearchState.js";

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
}

export function SearchBox(props: SearchBoxProps) {
  const useInternal = props.useInternalState !== false;

  // Use internal state or external state
  const searchState = useInternal ? useSearchState({}) : null;

  const [inputRef, setInputRef] = createSignal<HTMLInputElement>();
  const [searchTimeout, setSearchTimeout] = createSignal<number | undefined>();

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
  };

  // Handle input change
  const handleInputChange: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    e
  ) => {
    const value = e.currentTarget.value;
    handleQueryChange(value);
  };

  // Handle key down events
  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (
    e
  ) => {
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        const query = currentQuery().trim();
        if (query) {
          props.onSearch?.(query);
        }
        break;
      case "Escape":
        inputRef()?.blur();
        break;
    }
  };

  // Handle search button click
  const handleSearchClick = () => {
    const query = currentQuery().trim();
    if (query) {
      props.onSearch?.(query);
    }
  };

  // Focus the input programmatically (for future use)
  // const focus = () => {
  //   inputRef()?.focus();
  // };

  // Clear the search (for future use)
  // const clear = () => {
  //   handleQueryChange("");
  //   inputRef()?.focus();
  // };

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
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .search-box__input:focus {
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .search-box__input:disabled {
          background-color: #f5f5f5;
          cursor: not-allowed;
        }

        .search-box__button {
          padding: 8px 16px;
          border: 1px solid #007bff;
          background-color: #007bff;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-box__button:hover:not(:disabled) {
          background-color: #0056b3;
          border-color: #0056b3;
        }

        .search-box__button:disabled {
          background-color: #6c757d;
          border-color: #6c757d;
          cursor: not-allowed;
        }

        .search-box__button:active {
          transform: translateY(1px);
        }
      `}</style>
    </div>
  );
}

export default SearchBox;
