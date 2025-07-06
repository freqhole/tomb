/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, createEffect, Show, onMount } from "solid-js";
import { SearchBox } from "../components/search/SearchBox.js";
import { SearchSuggestions } from "../components/search/SearchSuggestions.js";
import { SearchFilters } from "../components/search/SearchFilters.js";
import {
  SearchProvider,
  useSearchContext,
} from "../components/search/SearchContext.js";
import { ApiClient } from "../lib/api-client.js";
import type { FilterOption } from "../components/search/SearchFilters.js";

interface SearchDemoProps {
  apiBaseUrl?: string;
  autoConnect?: boolean;
}

console.log("🔍 Search Demo loading...");

// Create API client
const createApiClient = (baseUrl: string) => {
  return new ApiClient(baseUrl);
};

// Default filter options for demo (could be fetched from API in the future)
const defaultFilterOptions = {
  genres: [
    { value: "rock", label: "Rock" },
    { value: "pop", label: "Pop" },
    { value: "jazz", label: "Jazz" },
    { value: "classical", label: "Classical" },
    { value: "electronic", label: "Electronic" },
    { value: "folk", label: "Folk" },
    { value: "hip-hop", label: "Hip-Hop" },
    { value: "country", label: "Country" },
  ],
  artists: [{ value: "", label: "All Artists" }],
  types: [
    { value: "song", label: "Song" },
    { value: "album", label: "Album" },
  ],
};

function SearchDemoContent() {
  const context = useSearchContext();
  const [currentQuery, setCurrentQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<any[]>([]);
  const [isSearching, setIsSearching] = createSignal(false);

  // Clear localStorage for clean demo experience
  onMount(() => {
    try {
      localStorage.removeItem("search-state");
      console.log("🧹 Cleared search localStorage for demo");
    } catch (error) {
      console.log("Could not clear localStorage:", error);
    }
  });

  // Handle search execution
  const handleSearch = async (query?: string) => {
    const searchQuery = query || context.state.query();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    console.log("🔍 Performing search:", searchQuery);
    console.log("🔍 API Client:", context.apiClient);
    console.log("🔍 Search context:", context.search);

    try {
      // Update the search state if query was passed
      if (query) {
        context.state.setQuery(query);
      }

      console.log("🔍 About to call performSearch...");
      // Perform the actual search using the context
      await context.performSearch();

      console.log("🔍 performSearch completed");
      // Get results from the search context
      const results = context.search.results();
      console.log("🔍 Raw results:", results);
      console.log("🔍 Search error:", context.search.error());

      setSearchResults(results?.results || []);

      console.log("✅ Search completed:", results);
      console.log("🔍 Results array length:", results?.results?.length);
      console.log("🔍 Total count from server:", results?.total_count);

      // Check if we got any results
      if (!results || !results.results || results.results.length === 0) {
        console.log("No results found for query:", searchQuery);
      }
    } catch (error) {
      console.error("❌ Search failed:", error);
      console.error("❌ Search error details:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle suggestion selection
  const handleSuggestionSelect = (suggestion: string) => {
    context.state.setQuery(suggestion);
    handleSearch(suggestion);
  };

  // Update currentQuery when context changes
  createEffect(() => {
    const contextQuery = context.state.query();
    setCurrentQuery(contextQuery);
  });

  // Update currentQuery when context changes
  createEffect(() => {
    const query = context.state.query();
    setCurrentQuery(query);
  });

  return (
    <div class="search-demo">
      <div class="search-demo__header">
        <h1 class="search-demo__title">🔍 Search Demo</h1>
        <p class="search-demo__description">
          Modular search components with autocomplete, filtering, and real-time
          results
        </p>
      </div>

      <div class="search-demo__content">
        <div class="search-demo__search-section">
          <div class="search-demo__search-container">
            <SearchBox
              onSearch={handleSearch}
              placeholder="Search music, artists, albums..."
              showSearchButton={true}
              searchButtonText="Search"
              autoSearch={false}
              useInternalState={true}
            />

            <SearchSuggestions
              query={context.state.query()}
              onSuggestionSelect={handleSuggestionSelect}
              maxSuggestions={8}
              showLoading={true}
              position="bottom"
              useInternalSuggestions={true}
              apiClient={context.apiClient}
            />
          </div>

          <div class="search-demo__stats">
            <Show when={context.hasAnyResults()}>
              <div class="search-demo__stats-item">
                <span class="search-demo__stats-label">Results:</span>
                <span class="search-demo__stats-value">
                  {context.totalResultsCount()}
                </span>
              </div>
            </Show>

            <Show when={context.search.loading() || isSearching()}>
              <div class="search-demo__stats-item">
                <span class="search-demo__stats-loading">🔄 Searching...</span>
              </div>
            </Show>
          </div>
        </div>

        <div class="search-demo__main">
          <div class="search-demo__filters">
            <SearchFilters
              filterOptions={defaultFilterOptions}
              showCounts={false}
              startExpanded={true}
              showToggle={true}
              showQueryInput={false}
              useInternalState={false}
              filters={{}}
              onFiltersChange={(filters) => {
                console.log("Filters changed:", filters);
                // Apply filters to search context
                if (filters.genre)
                  context.state.updateFilter("genre", filters.genre);
                if (filters.artist)
                  context.state.updateFilter("artist", filters.artist);
                if (filters.yearFrom)
                  context.state.updateFilter(
                    "year",
                    parseInt(filters.yearFrom)
                  );
                if (filters.rating_min)
                  context.state.updateFilter(
                    "rating_min",
                    parseInt(filters.rating_min)
                  );
                if (filters.rating_max)
                  context.state.updateFilter(
                    "rating_max",
                    parseInt(filters.rating_max)
                  );
                if (filters.favorites_only !== undefined)
                  context.state.updateFilter(
                    "favorites_only",
                    filters.favorites_only
                  );

                // Trigger search with new filters
                if (context.state.query().trim()) {
                  handleSearch();
                }
              }}
            />
          </div>

          <div class="search-demo__results">
            <Show when={!context.search.loading() && !isSearching()}>
              <Show when={searchResults().length > 0}>
                <div class="search-demo__results-header">
                  <h3>Search Results</h3>
                  <p>Found {searchResults().length} results</p>
                </div>

                <div class="search-demo__results-grid">
                  {searchResults().map((result, index) => (
                    <div
                      class="search-demo__result-card"
                      key={result.id || index}
                    >
                      <h4 class="search-demo__result-title">
                        {result.title || `Result ${index + 1}`}
                      </h4>
                      <p class="search-demo__result-description">
                        {result.subtitle ||
                          result.description ||
                          "No description"}
                      </p>
                      <div class="search-demo__result-meta">
                        <span class="search-demo__result-type">
                          {result.result_type || "Unknown"}
                        </span>
                        <Show when={result.relevance_score}>
                          <span class="search-demo__result-score">
                            Score: {result.relevance_score?.toFixed(2)}
                          </span>
                        </Show>
                      </div>
                      <Show when={result.metadata?.artist}>
                        <div class="search-demo__result-artist">
                          Artist: {result.metadata.artist}
                        </div>
                      </Show>
                    </div>
                  ))}
                </div>
              </Show>

              <Show
                when={
                  searchResults().length === 0 &&
                  currentQuery() &&
                  !isSearching()
                }
              >
                <div class="search-demo__no-results">
                  <h3>No results found</h3>
                  <p>Try adjusting your search terms or filters</p>
                  <Show when={context.search.error()}>
                    <p class="search-demo__error">
                      Error: {context.search.error()?.message}
                    </p>
                  </Show>
                </div>
              </Show>

              <Show when={!currentQuery()}>
                <div class="search-demo__welcome">
                  <h3>Welcome to Search Demo</h3>
                  <p>Enter a search query to get started</p>
                  <ul class="search-demo__features">
                    <li>🔍 Real-time search suggestions</li>
                    <li>🎛️ Advanced filtering options</li>
                    <li>📱 Responsive design</li>
                    <li>⚡ Fast and efficient</li>
                  </ul>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>

      <style>{`
        .search-demo {
          min-height: 100vh;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        }

        .search-demo__header {
          text-align: center;
          padding: 2rem;
          background: rgba(0, 0, 0, 0.1);
        }

        .search-demo__title {
          font-size: 2.5rem;
          margin: 0 0 1rem 0;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .search-demo__description {
          font-size: 1.1rem;
          margin: 0;
          opacity: 0.9;
        }

        .search-demo__content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
        }

        .search-demo__search-section {
          margin-bottom: 2rem;
        }

        .search-demo__search-container {
          position: relative;
          max-width: 600px;
          margin: 0 auto 1rem auto;
        }

        .search-demo__stats {
          display: flex;
          justify-content: center;
          gap: 2rem;
          margin-top: 1rem;
        }

        .search-demo__stats-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }

        .search-demo__stats-label {
          font-weight: 600;
        }

        .search-demo__stats-value {
          background: rgba(255, 255, 255, 0.2);
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-weight: bold;
        }

        .search-demo__stats-loading {
          font-weight: 600;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .search-demo__main {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 2rem;
          align-items: start;
        }

        .search-demo__filters {
          background: rgba(255, 255, 255, 0.1);
          color: black;
          border-radius: 12px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .search-demo__results {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 2rem;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          min-height: 400px;
        }

        .search-demo__results-header {
          margin-bottom: 1.5rem;
        }

        .search-demo__results-header h3 {
          margin: 0 0 0.5rem 0;
          font-size: 1.5rem;
        }

        .search-demo__results-header p {
          margin: 0;
          opacity: 0.8;
        }

        .search-demo__results-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 1rem;
        }

        .search-demo__result-card {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.2);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .search-demo__result-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        }

        .search-demo__result-title {
          margin: 0 0 0.5rem 0;
          font-size: 1.1rem;
          color: #fff;
        }

        .search-demo__result-description {
          margin: 0 0 1rem 0;
          opacity: 0.8;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .search-demo__result-meta {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .search-demo__result-type,
        .search-demo__result-score {
          background: rgba(255, 255, 255, 0.2);
          padding: 0.25rem 0.5rem;
          border-radius: 12px;
          font-size: 0.8rem;
        }

        .search-demo__result-artist {
          margin-top: 0.5rem;
          font-size: 0.85rem;
          opacity: 0.8;
          font-style: italic;
        }

        .search-demo__no-results,
        .search-demo__welcome {
          text-align: center;
          padding: 3rem 2rem;
        }

        .search-demo__welcome h3,
        .search-demo__no-results h3 {
          margin: 0 0 1rem 0;
          font-size: 1.5rem;
        }

        .search-demo__welcome p,
        .search-demo__no-results p {
          margin: 0 0 1.5rem 0;
          opacity: 0.8;
        }

        .search-demo__features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .search-demo__features li {
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 6px;
        }

        .search-demo__error {
          color: #ff6b6b;
          background: rgba(255, 107, 107, 0.1);
          padding: 0.5rem;
          border-radius: 4px;
          margin-top: 0.5rem;
          font-size: 0.9rem;
        }



        @media (max-width: 768px) {
          .search-demo__main {
            grid-template-columns: 1fr;
          }

          .search-demo__content {
            padding: 1rem;
          }

          .search-demo__results-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function SearchDemo(props: SearchDemoProps) {
  const apiClient = createApiClient(
    props.apiBaseUrl || "http://localhost:8080"
  );

  return (
    <SearchProvider
      apiClient={apiClient}
      searchOptions={{
        enableSuggestions: true,
        enableHistory: false,
        autoSearch: false,
        integrationMode: "standalone",
      }}
    >
      <SearchDemoContent />
    </SearchProvider>
  );
}

// Web Component Implementation
class SearchDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("🔍 SearchDemo element connected");

    const apiBaseUrl =
      this.getAttribute("api-base-url") || "http://localhost:8080";
    const autoConnect = this.getAttribute("auto-connect") === "true";

    try {
      this.dispose = render(
        () => <SearchDemo apiBaseUrl={apiBaseUrl} autoConnect={autoConnect} />,
        this
      );
      console.log("✅ SearchDemo render successful");
    } catch (error) {
      console.error("❌ SearchDemo render failed:", error);
    }
  }

  disconnectedCallback() {
    console.log("🔍 SearchDemo element disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

// Register the custom element
try {
  customElements.define("search-demo", SearchDemoElement);
  console.log("✅ search-demo element registered successfully");
} catch (error) {
  console.error("❌ Failed to register search-demo element:", error);
}

export { SearchDemo, SearchDemoElement };
