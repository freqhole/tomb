import { useNavigate, useSearchParams } from "@solidjs/router";
import { createSignal, Show, createEffect } from "solid-js";
import { storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSearchContext } from "../../context/SearchContext";
import { SearchSuggestions } from "../../../../components/search/SearchSuggestions";

import { FreqholeIcon } from "../icons";
import { AuthModal } from "../auth/AuthModal";

export function NavigationHeader() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const events = useGlobalEvents();
  const search = useSearchContext();
  const [inputValue, setInputValue] = createSignal("");
  const [showSuggestions, setShowSuggestions] = createSignal(false);
  const [inputFocused, setInputFocused] = createSignal(false);

  const [authOpen, setAuthOpen] = createSignal(false);

  // Sync input value with search context (one-way: context -> input)
  createEffect(() => {
    const searchQuery = search.searchQuery();
    if (searchQuery !== inputValue()) {
      setInputValue(searchQuery);
    }
  });

  // No URL initialization here - handled by SearchResultsView to avoid conflicts

  const handleSearch = (searchQuery: string) => {
    storeActions.setSearchQuery(searchQuery);

    if (searchQuery.trim()) {
      search.setSearchQuery(searchQuery, true);
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
      events.emit("search:query", { query: searchQuery });
    } else {
      search.clear();
      storeActions.clearSearch();
      events.emit("search:clear", {});
      navigate("/songs");
    }
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setInputValue(suggestion);
    search.onSuggestionSelect(suggestion);
    handleSearch(suggestion);
    setShowSuggestions(false);
  };

  const handleInputFocus = () => {
    setInputFocused(true);
    setShowSuggestions(true);
    // Trigger suggestion loading if we have enough characters
    if (inputValue().length >= 2) {
      search.setSearchQuery(inputValue(), false);
    }
  };

  const handleInputBlur = () => {
    // Delay hiding suggestions to allow for suggestion clicks
    setTimeout(() => {
      setInputFocused(false);
      setShowSuggestions(false);
    }, 300);
  };

  const shouldShowSuggestions = () => {
    return (
      showSuggestions() && inputFocused() && inputValue().trim().length > 0
    );
  };

  const handleInputChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    // Update local state immediately for responsive typing
    setInputValue(value);

    // Update search context for suggestions (debounced by the search hook)
    search.setSearchQuery(value, false);
  };

  const handleInputKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch(inputValue());
      setShowSuggestions(false);
    }
  };

  return (
    <div class="p-3 md:p-4">
      <div class="hidden mb-4 md:flex items-center justify-between">
        <span class="text-2xl font-light text-white lowercase">
          <span>freqh</span>
          <FreqholeIcon class="inline" />
          <span>le</span>
        </span>
        <div>
          <button onClick={() => setAuthOpen(true)}>auth</button>
          <AuthModal isOpen={authOpen()} onClose={() => setAuthOpen(false)} />
        </div>
      </div>

      <div class="relative">
        <input
          type="text"
          placeholder="search music..."
          value={inputValue()}
          onInput={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          class="w-full px-3 py-2 md:py-2 bg-gray-800 text-white rounded-lg placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-magenta-500 focus:bg-gray-700 hover:bg-gray-700 transition-all duration-200"
        />

        <button
          onClick={() => handleSearch(search.searchQuery())}
          class="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-magenta-400 transition-colors duration-200"
        >
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>

        {/* Search Suggestions */}
        <Show when={shouldShowSuggestions()}>
          <div class="absolute top-full left-0 right-0 mt-1 z-50">
            <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              <SearchSuggestions
                query={inputValue()}
                suggestions={search.suggestions()}
                onSuggestionSelect={handleSuggestionSelect}
                show={shouldShowSuggestions()}
                showLoading={search.loading()}
                class="freqhole-suggestions"
                onBlur={() => setShowSuggestions(false)}
              />
            </div>
          </div>
        </Show>
      </div>

      <style>{`
        .freqhole-suggestions {
          position: static !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          max-height: none !important;
        }

        .freqhole-suggestions .search-suggestions__item {
          padding: 8px 12px;
          color: #d1d5db;
          border-bottom: 1px solid #374151;
        }

        .freqhole-suggestions .search-suggestions__item:hover,
        .freqhole-suggestions .search-suggestions__item--selected {
          background-color: #6b21a8;
          color: white;
        }

        .freqhole-suggestions .search-suggestions__group-header {
          background-color: #4b5563;
          color: #9ca3af;
          border-bottom: 1px solid #374151;
        }

        .freqhole-suggestions .search-suggestions__loading {
          color: #9ca3af;
          background: transparent;
        }
      `}</style>
    </div>
  );
}
