/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import { useUnifiedSearch } from "../hooks/search/useUnifiedSearch.js";
import {
  musicUnifiedSearchConfig,
  musicSearchPresets,
  getMusicFilterSummary,
} from "../lib/music/admin/music-unified-search.js";
import { ApiClient } from "../lib/api-client.js";

interface SearchDemoProps {
  apiBaseUrl?: string;
  autoConnect?: boolean;
}

console.log("unified search demo loading");

function SearchDemoContent(props: { apiClient: ApiClient }) {
  // unified search hook with music configuration
  const search = useUnifiedSearch({
    ...musicUnifiedSearchConfig,
    searchEndpoint: `${props.apiClient.baseUrl}/api/music/search`,
    filterOptionsEndpoint: `${props.apiClient.baseUrl}/api/music/filter-options`,
    suggestionsEndpoint: `${props.apiClient.baseUrl}/api/music/suggestions`,
  });

  // ui state
  const [selectedView, setSelectedView] = createSignal<"grid" | "list">("grid");
  const [showAdvancedFilters, setShowAdvancedFilters] = createSignal(false);
  const [showDebugInfo, setShowDebugInfo] = createSignal(false);
  const [activePreset, setActivePreset] = createSignal<string | null>(null);

  // computed values
  const hasResults = createMemo(() => search.results().length > 0);
  const filterSummary = createMemo(() => {
    const params = search.searchParams();
    return getMusicFilterSummary(params);
  });

  // clear local storage for clean demo
  onMount(() => {
    try {
      localStorage.removeItem("search-state");
      localStorage.removeItem("freqhole-state");
      localStorage.removeItem("grid-state");
      console.log("cleared demo storage");
    } catch (error) {
      console.warn("failed to clear storage:", error);
    }
  });

  // check if a preset is currently active
  const isPresetActive = (presetId: string) => {
    const preset = musicSearchPresets.find((p) => p.id === presetId);
    if (!preset) return false;

    const currentParams = search.searchParams();
    return Object.entries(preset.params).every(([key, value]) => {
      return currentParams[key as keyof typeof currentParams] === value;
    });
  };

  // handle preset toggle
  const togglePreset = (presetId: string) => {
    const preset = musicSearchPresets.find((p) => p.id === presetId);
    if (!preset) return;

    if (isPresetActive(presetId)) {
      // clear the preset by removing its parameters
      const newParams = { ...search.searchParams() };
      Object.keys(preset.params).forEach((key) => {
        delete newParams[key as keyof typeof newParams];
      });
      newParams.page = 1;
      search.setSearchParams(newParams);
      setActivePreset(null);
    } else {
      // apply the preset
      search.setSearchParams({
        ...search.searchParams(),
        ...preset.params,
        page: 1,
      });
      setActivePreset(presetId);
    }
  };

  // format duration for display
  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // format rating for display
  const formatRating = (rating: number | null) => {
    if (!rating) return "unrated";
    return "★".repeat(rating) + "☆".repeat(5 - rating);
  };

  return (
    <div class="search-demo">
      {/* header */}
      <div class="search-demo__header">
        <h1 class="search-demo__title">unified music search demo</h1>
        <div class="search-demo__controls">
          <button
            onClick={() =>
              setSelectedView(selectedView() === "grid" ? "list" : "grid")
            }
            class="search-demo__view-toggle"
          >
            {selectedView()}
          </button>
          <button
            onClick={() => setShowDebugInfo(!showDebugInfo())}
            class="search-demo__debug-toggle"
          >
            debug
          </button>
        </div>
      </div>

      {/* search input */}
      <div class="search-demo__search-section">
        <div class="search-demo__search-input">
          <input
            type="text"
            value={search.searchQuery()}
            onInput={(e) => search.setSearchQuery(e.target.value)}
            placeholder="search music library (artist, album, song title)"
            class="search-demo__input"
          />
          <Show when={search.searching()}>
            <div class="search-demo__searching">searching...</div>
          </Show>
        </div>

        {/* quick presets */}
        <div class="search-demo__presets">
          <span class="search-demo__presets-label">quick filters:</span>
          <For each={musicSearchPresets.slice(0, 6)}>
            {(preset) => (
              <button
                onClick={() => togglePreset(preset.id)}
                class={`search-demo__preset ${isPresetActive(preset.id) ? "active" : ""}`}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>

        {/* advanced filters toggle */}
        <div class="search-demo__filter-controls">
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters())}
            class={`search-demo__advanced-toggle ${showAdvancedFilters() ? "active" : ""}`}
          >
            advanced filters
          </button>
          <Show when={search.hasActiveFilters()}>
            <button
              onClick={() => search.clearFilters()}
              class="search-demo__clear-filters"
            >
              clear all
            </button>
          </Show>
        </div>
      </div>

      {/* advanced filters panel */}
      <Show when={showAdvancedFilters()}>
        <div class="search-demo__advanced-filters">
          <div class="search-demo__filter-grid">
            {/* artist filter */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">artist</label>
              <input
                type="text"
                value={search.searchParams().artist || ""}
                onInput={(e) =>
                  search.addFilter("artist", e.target.value || undefined)
                }
                placeholder="artist name"
                class="search-demo__filter-input"
              />
            </div>

            {/* album filter */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">album</label>
              <input
                type="text"
                value={search.searchParams().album || ""}
                onInput={(e) =>
                  search.addFilter("album", e.target.value || undefined)
                }
                placeholder="album name"
                class="search-demo__filter-input"
              />
            </div>

            {/* genre filter */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">genre</label>
              <input
                type="text"
                value={search.searchParams().genre || ""}
                onInput={(e) =>
                  search.addFilter("genre", e.target.value || undefined)
                }
                placeholder="genre"
                class="search-demo__filter-input"
              />
            </div>

            {/* year range */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">year range</label>
              <div class="search-demo__range-inputs">
                <input
                  type="number"
                  value={search.searchParams().year_min || ""}
                  onInput={(e) =>
                    search.addFilter(
                      "year_min",
                      e.target.value ? Number(e.target.value) : undefined
                    )
                  }
                  placeholder="from"
                  min="1900"
                  max="2030"
                  class="search-demo__range-input"
                />
                <input
                  type="number"
                  value={search.searchParams().year_max || ""}
                  onInput={(e) =>
                    search.addFilter(
                      "year_max",
                      e.target.value ? Number(e.target.value) : undefined
                    )
                  }
                  placeholder="to"
                  min="1900"
                  max="2030"
                  class="search-demo__range-input"
                />
              </div>
            </div>

            {/* rating range */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">rating range</label>
              <div class="search-demo__range-inputs">
                <input
                  type="number"
                  value={search.searchParams().rating_min || ""}
                  onInput={(e) =>
                    search.addFilter(
                      "rating_min",
                      e.target.value ? Number(e.target.value) : undefined
                    )
                  }
                  placeholder="min"
                  min="0"
                  max="5"
                  class="search-demo__range-input"
                />
                <input
                  type="number"
                  value={search.searchParams().rating_max || ""}
                  onInput={(e) =>
                    search.addFilter(
                      "rating_max",
                      e.target.value ? Number(e.target.value) : undefined
                    )
                  }
                  placeholder="max"
                  min="0"
                  max="5"
                  class="search-demo__range-input"
                />
              </div>
            </div>

            {/* boolean filters */}
            <div class="search-demo__filter-group">
              <label class="search-demo__filter-label">options</label>
              <div class="search-demo__boolean-filters">
                <label class="search-demo__checkbox">
                  <input
                    type="checkbox"
                    checked={search.searchParams().is_favorite || false}
                    onChange={(e) =>
                      search.addFilter(
                        "is_favorite",
                        e.target.checked ? true : undefined
                      )
                    }
                  />
                  favorites only
                </label>
                <label class="search-demo__checkbox">
                  <input
                    type="checkbox"
                    checked={search.searchParams().has_thumbnail === false}
                    onChange={(e) =>
                      search.addFilter(
                        "has_thumbnail",
                        e.target.checked ? false : undefined
                      )
                    }
                  />
                  no artwork
                </label>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* filter summary */}
      <Show when={search.hasActiveFilters()}>
        <div class="search-demo__filter-summary">
          active filters: {filterSummary()}
        </div>
      </Show>

      {/* results header */}
      <div class="search-demo__results-header">
        <div class="search-demo__results-info">
          <Show
            when={search.loading()}
            fallback={<span>{search.totalCount()} results found</span>}
          >
            <span>searching...</span>
          </Show>
          <Show when={search.searchMetadata().queryTimeMs > 0}>
            <span class="search-demo__query-time">
              ({search.searchMetadata().queryTimeMs}ms)
            </span>
          </Show>
        </div>

        <div class="search-demo__sort-controls">
          <label class="search-demo__sort-label">sort by:</label>
          <select
            value={search.sortBy() || "created_at"}
            onChange={(e) =>
              search.setSorting(e.target.value, search.sortDirection())
            }
            class="search-demo__sort-select"
          >
            <option value="created_at">date added</option>
            <option value="title">title</option>
            <option value="artist">artist</option>
            <option value="album">album</option>
            <option value="year">year</option>
            <option value="rating">rating</option>
            <option value="duration_seconds">duration</option>
          </select>
          <button
            onClick={() =>
              search.setSorting(
                search.sortBy() || "created_at",
                search.sortDirection() === "asc" ? "desc" : "asc"
              )
            }
            class="search-demo__sort-direction"
          >
            {search.sortDirection() === "asc" ? "ascending" : "descending"}
          </button>
        </div>
      </div>

      {/* results */}
      <Show when={!search.loading() && hasResults()}>
        <div
          class={`search-demo__results search-demo__results--${selectedView()}`}
        >
          <For each={search.results()}>
            {(song) => (
              <div class="search-demo__result-item">
                <div class="search-demo__result-thumbnail">
                  <Show
                    when={song.thumbnail_blob_id}
                    fallback={
                      <div class="search-demo__no-thumbnail">no art</div>
                    }
                  >
                    <img
                      src={`/api/media/blobs/${song.thumbnail_blob_id}`}
                      alt="album artwork"
                      class="search-demo__thumbnail"
                    />
                  </Show>
                </div>
                <div class="search-demo__result-content">
                  <div class="search-demo__result-title">{song.title}</div>
                  <div class="search-demo__result-artist">
                    {song.artist || "unknown artist"}
                  </div>
                  <div class="search-demo__result-album">
                    {song.album || "unknown album"}
                  </div>
                  <div class="search-demo__result-meta">
                    <span class="search-demo__duration">
                      {formatDuration(song.duration_seconds)}
                    </span>
                    <Show when={song.year}>
                      <span class="search-demo__year">{song.year}</span>
                    </Show>
                    <Show when={song.genre}>
                      <span class="search-demo__genre">{song.genre}</span>
                    </Show>
                    <span class="search-demo__rating">
                      {formatRating(song.rating)}
                    </span>
                    <Show when={song.is_favorite}>
                      <span class="search-demo__favorite">favorite</span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* no results */}
      <Show
        when={!search.loading() && !hasResults() && search.hasActiveFilters()}
      >
        <div class="search-demo__no-results">
          <div class="search-demo__no-results-message">
            no songs found matching your search criteria
          </div>
          <button
            onClick={() => search.clearFilters()}
            class="search-demo__clear-all"
          >
            clear all filters
          </button>
        </div>
      </Show>

      {/* pagination */}
      <Show when={search.totalPages() > 1}>
        <div class="search-demo__pagination">
          <button
            onClick={() => search.prevPage()}
            disabled={!search.hasPrev()}
            class="search-demo__page-btn"
          >
            previous
          </button>
          <span class="search-demo__page-info">
            page {search.currentPage()} of {search.totalPages()}
          </span>
          <button
            onClick={() => search.nextPage()}
            disabled={!search.hasNext()}
            class="search-demo__page-btn"
          >
            next
          </button>
        </div>
      </Show>

      {/* error display */}
      <Show when={search.error()}>
        <div class="search-demo__error">
          error: {search.error()}
          <button
            onClick={() => search.refresh()}
            class="search-demo__retry-btn"
          >
            retry
          </button>
        </div>
      </Show>

      {/* debug info */}
      <Show when={showDebugInfo()}>
        <div class="search-demo__debug">
          <h3>debug information</h3>
          <pre class="search-demo__debug-content">
            {JSON.stringify(
              {
                searchParams: search.searchParams(),
                metadata: search.searchMetadata(),
                activeFilters: search.activeFilters(),
                resultCount: search.results().length,
                totalCount: search.totalCount(),
              },
              null,
              2
            )}
          </pre>
        </div>
      </Show>

      <style>{`
        .search-demo {
          max-width: 1200px;
          margin: 0 auto;
          padding: 2rem;
          background: #1a1a1a;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          min-height: 100vh;
        }

        .search-demo__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .search-demo__title {
          font-size: 1.8rem;
          font-weight: bold;
          margin: 0;
          color: #ffffff;
        }

        .search-demo__controls {
          display: flex;
          gap: 0.5rem;
        }

        .search-demo__view-toggle,
        .search-demo__debug-toggle {
          padding: 0.5rem 1rem;
          background: #333333;
          color: #ffffff;
          border: none;
          cursor: pointer;
          font-size: 0.9rem;
          transition: background-color 0.2s;
        }

        .search-demo__view-toggle:hover,
        .search-demo__debug-toggle:hover {
          background: #444444;
        }

        .search-demo__search-section {
          margin-bottom: 1.5rem;
        }

        .search-demo__search-input {
          position: relative;
          margin-bottom: 1rem;
        }

        .search-demo__input {
          width: 100%;
          padding: 1rem;
          background: #2a2a2a;
          color: #ffffff;
          border: 2px solid #333333;
          font-size: 1.1rem;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-demo__input:focus {
          border-color: #ff00ff;
        }

        .search-demo__searching {
          position: absolute;
          right: 1rem;
          top: 50%;
          transform: translateY(-50%);
          color: #888888;
          font-size: 0.9rem;
        }

        .search-demo__presets {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
          margin-bottom: 1rem;
        }

        .search-demo__presets-label {
          color: #888888;
          font-size: 0.9rem;
          margin-right: 0.5rem;
        }

        .search-demo__preset {
          padding: 0.25rem 0.75rem;
          background: #333333;
          color: #ffffff;
          border: none;
          cursor: pointer;
          font-size: 0.8rem;
          transition: background-color 0.2s;
        }

        .search-demo__preset:hover {
          background: #444444;
        }

        .search-demo__filter-controls {
          display: flex;
          gap: 1rem;
          align-items: center;
        }

        .search-demo__advanced-toggle {
          padding: 0.5rem 1rem;
          background: #333333;
          color: #ffffff;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .search-demo__advanced-toggle.active {
          background: #ff00ff;
        }

        .search-demo__advanced-toggle:hover {
          background: #444444;
        }

        .search-demo__advanced-toggle.active:hover {
          background: #ff33ff;
        }

        .search-demo__clear-filters {
          padding: 0.5rem 1rem;
          background: #444444;
          color: #ffffff;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .search-demo__clear-filters:hover {
          background: #555555;
        }

        .search-demo__advanced-filters {
          background: #2a2a2a;
          padding: 1.5rem;
          margin-bottom: 1rem;
          border: 1px solid #333333;
        }

        .search-demo__filter-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .search-demo__filter-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .search-demo__filter-label {
          color: #cccccc;
          font-size: 0.9rem;
          font-weight: 500;
        }

        .search-demo__filter-input,
        .search-demo__range-input {
          padding: 0.5rem;
          background: #1a1a1a;
          color: #ffffff;
          border: 1px solid #444444;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-demo__filter-input:focus,
        .search-demo__range-input:focus {
          border-color: #ff00ff;
        }

        .search-demo__range-inputs {
          display: flex;
          gap: 0.5rem;
        }

        .search-demo__boolean-filters {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .search-demo__checkbox {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
          font-size: 0.9rem;
        }

        .search-demo__filter-summary {
          background: #2a2a2a;
          padding: 0.75rem;
          margin-bottom: 1rem;
          color: #cccccc;
          font-size: 0.9rem;
          border-left: 3px solid #ff00ff;
        }

        .search-demo__results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #333333;
        }

        .search-demo__results-info {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .search-demo__query-time {
          color: #888888;
          font-size: 0.8rem;
        }

        .search-demo__sort-controls {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .search-demo__sort-label {
          color: #cccccc;
          font-size: 0.9rem;
        }

        .search-demo__sort-select {
          padding: 0.25rem 0.5rem;
          background: #333333;
          color: #ffffff;
          border: 1px solid #444444;
        }

        .search-demo__sort-direction {
          padding: 0.25rem 0.5rem;
          background: #333333;
          color: #ffffff;
          border: none;
          cursor: pointer;
          font-size: 0.8rem;
        }

        .search-demo__results {
          display: grid;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .search-demo__results--grid {
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        }

        .search-demo__results--list {
          grid-template-columns: 1fr;
        }

        .search-demo__result-item {
          display: flex;
          gap: 1rem;
          background: #2a2a2a;
          padding: 1rem;
          border: 1px solid #333333;
          transition: border-color 0.2s;
        }

        .search-demo__result-item:hover {
          border-color: #444444;
        }

        .search-demo__result-thumbnail {
          flex-shrink: 0;
        }

        .search-demo__thumbnail {
          width: 60px;
          height: 60px;
          object-fit: cover;
        }

        .search-demo__no-thumbnail {
          width: 60px;
          height: 60px;
          background: #333333;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          color: #888888;
        }

        .search-demo__result-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .search-demo__result-title {
          font-weight: bold;
          color: #ffffff;
        }

        .search-demo__result-artist {
          color: #cccccc;
          font-size: 0.9rem;
        }

        .search-demo__result-album {
          color: #aaaaaa;
          font-size: 0.8rem;
        }

        .search-demo__result-meta {
          display: flex;
          gap: 0.75rem;
          font-size: 0.7rem;
          color: #888888;
          margin-top: 0.5rem;
        }

        .search-demo__favorite {
          color: #ff00ff;
          font-weight: bold;
        }

        .search-demo__no-results {
          text-align: center;
          padding: 3rem;
          color: #888888;
        }

        .search-demo__no-results-message {
          margin-bottom: 1rem;
          font-size: 1.1rem;
        }

        .search-demo__clear-all {
          padding: 0.75rem 1.5rem;
          background: #ff00ff;
          color: #ffffff;
          border: none;
          cursor: pointer;
          font-size: 1rem;
        }

        .search-demo__pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 1rem;
          margin: 2rem 0;
        }

        .search-demo__page-btn {
          padding: 0.5rem 1rem;
          background: #333333;
          color: #ffffff;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .search-demo__page-btn:disabled {
          background: #222222;
          color: #666666;
          cursor: not-allowed;
        }

        .search-demo__page-btn:not(:disabled):hover {
          background: #444444;
        }

        .search-demo__page-info {
          color: #cccccc;
        }

        .search-demo__error {
          background: #3a1a1a;
          color: #ff6666;
          padding: 1rem;
          margin: 1rem 0;
          border: 1px solid #ff3333;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .search-demo__retry-btn {
          padding: 0.5rem 1rem;
          background: #ff3333;
          color: #ffffff;
          border: none;
          cursor: pointer;
        }

        .search-demo__debug {
          margin-top: 2rem;
          background: #1a1a1a;
          padding: 1rem;
          border: 1px solid #333333;
        }

        .search-demo__debug h3 {
          margin: 0 0 1rem 0;
          color: #cccccc;
        }

        .search-demo__debug-content {
          background: #0a0a0a;
          padding: 1rem;
          color: #888888;
          font-size: 0.8rem;
          overflow-x: auto;
          margin: 0;
        }

        @media (max-width: 768px) {
          .search-demo {
            padding: 1rem;
          }

          .search-demo__results--grid {
            grid-template-columns: 1fr;
          }

          .search-demo__filter-grid {
            grid-template-columns: 1fr;
          }

          .search-demo__results-header {
            flex-direction: column;
            gap: 1rem;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  );
}

function SearchDemo(props: SearchDemoProps) {
  const apiClient = new ApiClient({
    baseUrl: props.apiBaseUrl || "http://localhost:8080",
    timeout: 30000,
  });

  return <SearchDemoContent apiClient={apiClient} />;
}

// Web Component Implementation
class SearchDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    console.log("unified search demo element connected");

    const apiBaseUrl =
      this.getAttribute("api-base-url") || "http://localhost:8080";
    const autoConnect = this.getAttribute("auto-connect") === "true";

    try {
      this.dispose = render(
        () => <SearchDemo apiBaseUrl={apiBaseUrl} autoConnect={autoConnect} />,
        this
      );
      console.log("unified search demo render successful");
    } catch (error) {
      console.error("unified search demo render failed:", error);
    }
  }

  disconnectedCallback() {
    console.log("unified search demo element disconnected");
    if (this.dispose) {
      this.dispose();
    }
  }
}

// Register the custom element
try {
  if (!customElements.get("search-demo")) {
    customElements.define("search-demo", SearchDemoElement);
    console.log("unified search demo web component registered");
  }
} catch (error) {
  console.error("failed to register unified search demo web component:", error);
}

export { SearchDemo, SearchDemoElement };
