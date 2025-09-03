/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import { useUnifiedSearch } from "../hooks/search/useUnifiedSearch.js";
import {
  musicUnifiedSearchConfig,
  musicSearchPresets,
  getMusicFilterSummary,
} from "../lib/music/admin/music-unified-search.js";
import {
  FilterDropdown,
  FilterRange,
  FilterTags,
  FilterToggle,
  FilterDateRange,
  FilterText,
} from "../lib/components/filters/FilterComponents.js";
import { ApiClient } from "../lib/api-client.js";
import { SearchSuggestions } from "../components/search/SearchSuggestions.js";

interface SearchDemoProps {
  apiBaseUrl?: string;
  autoConnect?: boolean;
}

console.log("unified search demo loading");

function SearchDemoContent(props: { apiClient: ApiClient }) {
  // unified search hook with music configuration
  const search = useUnifiedSearch({
    ...musicUnifiedSearchConfig,
    searchEndpoint: `${props.apiClient.getBaseUrl()}/api/music/search`,
    filterOptionsEndpoint: `${props.apiClient.getBaseUrl()}/api/music/filter-options`,
    suggestionsEndpoint: `${props.apiClient.getBaseUrl()}/api/music/suggestions`,
    autoSearch: false,
    executeInitialSearch: true,
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
        <div class="search-demo__search-input relative">
          <input
            type="text"
            value={search.searchQuery()}
            onInput={(e) => {
              const value = e.target.value;
              search.setSearchQuery(value, false);
              if (value.length >= 2) {
                console.log("Input changed, fetching suggestions:", value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search.refresh();
                console.log("search executed via Enter key");
              }
            }}
            onFocus={() => console.log("Search input focused")}
            placeholder="search music library (artist, album, song title)"
            class="search-demo__input"
          />
          <Show when={search.searching()}>
            <div class="search-demo__searching">searching...</div>
          </Show>

          {/* search suggestions */}
          <SearchSuggestions
            query={search.searchQuery()}
            suggestions={search.searchSuggestions()}
            onSuggestionSelect={(suggestion) => {
              const suggestionText =
                typeof suggestion === "string"
                  ? suggestion
                  : (suggestion as any).text ||
                    (suggestion as any).value ||
                    (suggestion as any).display ||
                    String(suggestion);
              search.setSearchQuery(suggestionText, false);
              search.refresh();
              console.log(
                "search executed via suggestion selection:",
                suggestionText
              );
            }}
            show={search.searchQuery().length > 1}
            loading={search.searching()}
            showLoading={true}
            class="bg-black border-gray-800 text-gray-300 shadow-lg"
            position="bottom"
            useInternalSuggestions={false}
            maxSuggestions={8}
          />

          {/* search indicator */}
          <div class="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
            <Show
              when={search.searching()}
              fallback={
                <svg
                  class="w-4 h-4 text-gray-400"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  style={{ "min-width": "16px", "min-height": "16px" }}
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              }
            >
              <div class="animate-spin h-4 w-4 border border-magenta-500 border-t-transparent"></div>
            </Show>
          </div>
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
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-gray-900">
            {/* text filters */}
            <FilterText
              label="artist"
              value={search.searchParams().artist}
              placeholder="search by artist name"
              supportsExact={true}
              exactMatch={search.searchParams().artist_exact}
              onValueChange={(value) => search.addFilter("artist", value)}
              onExactChange={(exact) => search.addFilter("artist_exact", exact)}
            />

            <FilterText
              label="album"
              value={search.searchParams().album}
              placeholder="search by album name"
              supportsExact={true}
              exactMatch={search.searchParams().album_exact}
              onValueChange={(value) => search.addFilter("album", value)}
              onExactChange={(exact) => search.addFilter("album_exact", exact)}
            />

            <FilterText
              label="genre"
              value={search.searchParams().genre}
              placeholder="search by genre"
              onValueChange={(value) => search.addFilter("genre", value)}
            />

            <FilterText
              label="title"
              value={search.searchParams().title}
              placeholder="search by song title"
              onValueChange={(value) => search.addFilter("title", value)}
            />

            {/* numeric range filters */}
            <FilterRange
              label="year range"
              minValue={search.searchParams().year_min}
              maxValue={search.searchParams().year_max}
              min={1900}
              max={new Date().getFullYear() + 1}
              placeholder={{ min: "from", max: "to" }}
              onChange={(range) => {
                search.addFilter("year_min", range.min);
                search.addFilter("year_max", range.max);
              }}
            />

            <FilterRange
              label="rating range"
              minValue={search.searchParams().rating_min}
              maxValue={search.searchParams().rating_max}
              min={0}
              max={5}
              placeholder={{ min: "min", max: "max" }}
              onChange={(range) => {
                search.addFilter("rating_min", range.min);
                search.addFilter("rating_max", range.max);
              }}
            />

            <FilterRange
              label="duration (minutes)"
              minValue={
                search.searchParams().duration_min
                  ? Math.floor(search.searchParams().duration_min! / 60)
                  : undefined
              }
              maxValue={
                search.searchParams().duration_max
                  ? Math.floor(search.searchParams().duration_max! / 60)
                  : undefined
              }
              min={0}
              max={60}
              placeholder={{ min: "min", max: "max" }}
              onChange={(range) => {
                search.addFilter(
                  "duration_min",
                  range.min ? range.min * 60 : undefined
                );
                search.addFilter(
                  "duration_max",
                  range.max ? range.max * 60 : undefined
                );
              }}
            />

            <FilterRange
              label="bpm range"
              minValue={search.searchParams().bpm_min}
              maxValue={search.searchParams().bpm_max}
              min={60}
              max={200}
              placeholder={{ min: "min bpm", max: "max bpm" }}
              onChange={(range) => {
                search.addFilter("bpm_min", range.min);
                search.addFilter("bpm_max", range.max);
              }}
            />

            {/* file format filter */}
            <FilterDropdown
              label="file format"
              value={search.searchParams().file_format}
              options={[
                { value: "mp3", label: "MP3" },
                { value: "flac", label: "FLAC" },
                { value: "wav", label: "WAV" },
                { value: "m4a", label: "M4A/AAC" },
                { value: "ogg", label: "OGG Vorbis" },
              ]}
              placeholder="select format"
              onSelect={(value) =>
                search.addFilter("file_format", value as string)
              }
            />

            {/* key signature filter */}
            <FilterDropdown
              label="key signature"
              value={search.searchParams().key_signature}
              options={[
                { value: "C", label: "C major" },
                { value: "C#", label: "C# major" },
                { value: "Db", label: "Db major" },
                { value: "D", label: "D major" },
                { value: "D#", label: "D# major" },
                { value: "Eb", label: "Eb major" },
                { value: "E", label: "E major" },
                { value: "F", label: "F major" },
                { value: "F#", label: "F# major" },
                { value: "Gb", label: "Gb major" },
                { value: "G", label: "G major" },
                { value: "G#", label: "G# major" },
                { value: "Ab", label: "Ab major" },
                { value: "A", label: "A major" },
                { value: "A#", label: "A# major" },
                { value: "Bb", label: "Bb major" },
                { value: "B", label: "B major" },
                { value: "Am", label: "A minor" },
                { value: "Bm", label: "B minor" },
                { value: "Cm", label: "C minor" },
                { value: "Dm", label: "D minor" },
                { value: "Em", label: "E minor" },
                { value: "Fm", label: "F minor" },
                { value: "Gm", label: "G minor" },
              ]}
              placeholder="select key"
              onSelect={(value) =>
                search.addFilter("key_signature", value as string)
              }
            />

            {/* tags filter */}
            <div class="md:col-span-2">
              <FilterTags
                label="tags"
                selectedTags={search.searchParams().tags}
                availableTags={[
                  { value: "rock", label: "rock", count: 150 },
                  { value: "pop", label: "pop", count: 200 },
                  { value: "jazz", label: "jazz", count: 75 },
                  { value: "classical", label: "classical", count: 100 },
                  { value: "electronic", label: "electronic", count: 120 },
                  { value: "folk", label: "folk", count: 60 },
                  { value: "metal", label: "metal", count: 90 },
                  { value: "blues", label: "blues", count: 45 },
                ]}
                placeholder="add tags"
                onTagsChange={(tags) => search.addFilter("tags", tags)}
              />
            </div>

            {/* boolean filters */}
            <div class="space-y-2">
              <h4 class="text-sm font-medium text-white mb-2">options</h4>
              <FilterToggle
                label="favorites only"
                checked={search.searchParams().is_favorite}
                onToggle={(checked) => search.addFilter("is_favorite", checked)}
              />
              <FilterToggle
                label="has artwork"
                checked={search.searchParams().has_thumbnail}
                onToggle={(checked) =>
                  search.addFilter("has_thumbnail", checked)
                }
              />
              <FilterToggle
                label="has lyrics"
                checked={search.searchParams().has_lyrics}
                onToggle={(checked) => search.addFilter("has_lyrics", checked)}
              />
              <FilterToggle
                label="has waveform"
                checked={search.searchParams().has_waveform}
                onToggle={(checked) =>
                  search.addFilter("has_waveform", checked)
                }
              />
              <FilterToggle
                label="compilation album"
                checked={search.searchParams().is_compilation}
                onToggle={(checked) =>
                  search.addFilter("is_compilation", checked)
                }
              />
              <FilterToggle
                label="include deleted songs"
                checked={search.searchParams().include_deleted}
                onToggle={(checked) =>
                  search.addFilter("include_deleted", checked)
                }
              />
            </div>

            {/* date filters */}
            <FilterDateRange
              label="date added"
              startDate={search.searchParams().created_after}
              endDate={search.searchParams().created_before}
              onChange={(range) => {
                search.addFilter("created_after", range.start);
                search.addFilter("created_before", range.end);
              }}
            />

            <FilterDateRange
              label="date updated"
              startDate={search.searchParams().updated_after}
              endDate={search.searchParams().updated_before}
              onChange={(range) => {
                search.addFilter("updated_after", range.start);
                search.addFilter("updated_before", range.end);
              }}
            />
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
                      src={`/api/blobs/${song.thumbnail_blob_id}`}
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
