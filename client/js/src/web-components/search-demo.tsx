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
import {
  SearchBar,
  SearchPresets,
  SearchSummary,
  SearchSortControls,
  SearchAdvancedFilters,
} from "../components/search/index.js";
import type {
  SearchField,
  SortField,
  AdvancedFilterConfig,
} from "../components/search/index.js";
import "../styles/common.css";

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
  // ui state - removed unused activePreset

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
      Object.keys(preset.params).forEach((key) => {
        search.removeFilter(key); // triggerSearch defaults to true
      });
    } else {
      // apply the preset
      Object.entries(preset.params).forEach(([key, value]) => {
        search.addFilter(key, value); // triggerSearch defaults to true
      });
    }
  };

  // search field configuration
  const searchFields: SearchField[] = [
    { value: "all", label: "all", description: "search all fields" },
    { value: "title", label: "title", description: "search song titles" },
    { value: "artist", label: "artist", description: "search artist names" },
    { value: "album", label: "album", description: "search album names" },
    { value: "genre", label: "genre", description: "search genres" },
  ];

  // sort field configuration
  const sortFields: SortField[] = [
    { value: "created_at", label: "date added" },
    { value: "title", label: "title" },
    { value: "artist", label: "artist" },
    { value: "album", label: "album" },
    { value: "year", label: "year" },
    { value: "rating", label: "rating" },
    { value: "duration_seconds", label: "duration" },
  ];

  // advanced filter configuration
  const advancedFilterConfigs: AdvancedFilterConfig[] = [
    {
      type: "text",
      key: "artist",
      label: "artist",
      placeholder: "search by artist name",
      supportsExact: true,
    },
    {
      type: "text",
      key: "album",
      label: "album",
      placeholder: "search by album name",
      supportsExact: true,
    },
    {
      type: "text",
      key: "genre",
      label: "genre",
      placeholder: "search by genre",
    },
    {
      type: "text",
      key: "title",
      label: "title",
      placeholder: "search by song title",
    },
    {
      type: "range",
      key: "year",
      label: "year range",
      min: 1900,
      max: new Date().getFullYear() + 1,
    },
    {
      type: "range",
      key: "rating",
      label: "rating range",
      min: 0,
      max: 5,
    },
    {
      type: "range",
      key: "duration_minutes",
      label: "duration (minutes)",
      min: 0,
      max: 60,
    },
    {
      type: "range",
      key: "bpm",
      label: "bpm range",
      min: 60,
      max: 200,
    },
    {
      type: "dropdown",
      key: "file_format",
      label: "file format",
      options: [
        { value: "mp3", label: "MP3" },
        { value: "flac", label: "FLAC" },
        { value: "wav", label: "WAV" },
        { value: "m4a", label: "M4A/AAC" },
        { value: "ogg", label: "OGG Vorbis" },
      ],
    },
    {
      type: "dropdown",
      key: "key_signature",
      label: "key signature",
      options: [
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
      ],
    },
    {
      type: "tags",
      key: "tags",
      label: "tags",
      availableTags: [
        { value: "rock", label: "rock", count: 150 },
        { value: "pop", label: "pop", count: 200 },
        { value: "jazz", label: "jazz", count: 75 },
        { value: "classical", label: "classical", count: 100 },
        { value: "electronic", label: "electronic", count: 120 },
        { value: "folk", label: "folk", count: 60 },
        { value: "metal", label: "metal", count: 90 },
        { value: "blues", label: "blues", count: 45 },
      ],
    },
    {
      type: "toggle",
      key: "is_favorite",
      label: "favorites only",
    },
    {
      type: "toggle",
      key: "has_thumbnail",
      label: "has artwork",
    },
    {
      type: "toggle",
      key: "has_lyrics",
      label: "has lyrics",
    },
    {
      type: "toggle",
      key: "has_waveform",
      label: "has waveform",
    },
    {
      type: "toggle",
      key: "is_compilation",
      label: "compilation album",
    },
    {
      type: "toggle",
      key: "include_deleted",
      label: "include deleted songs",
    },
    {
      type: "date",
      key: "created_date",
      label: "date added",
    },
    {
      type: "date",
      key: "updated_date",
      label: "date updated",
    },
  ];

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
    <div class="max-w-6xl mx-auto p-8 bg-black text-white min-h-screen font-metro">
      {/* header */}
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-white">unified music search demo</h1>
        <div class="flex gap-2">
          <button
            onClick={() =>
              setSelectedView(selectedView() === "grid" ? "list" : "grid")
            }
            class="px-3 py-2 bg-gray-800 text-white hover:bg-gray-700 transition-colors text-sm"
          >
            {selectedView()}
          </button>
          <button
            onClick={() => setShowDebugInfo(!showDebugInfo())}
            class="px-3 py-2 bg-gray-800 text-white hover:bg-gray-700 transition-colors text-sm"
          >
            debug
          </button>
        </div>
      </div>

      {/* search input */}
      <div>
        <SearchBar
          value={search.searchQuery()}
          onInput={(value) => {
            search.setSearchQuery(value, false);
          }}
          onSearch={(query) => {
            search.refresh();
            console.log("search executed", query);
          }}
          suggestions={search.searchSuggestions().map((s: any) => ({
            text: typeof s === "string" ? s : s.text || String(s),
            category:
              typeof s === "object" && s.category ? s.category : "suggestion",
          }))}
          searchFields={searchFields}
          placeholder="search music library (artist, album, song title)"
          showSuggestions={true}
          suggestionsLoading={search.searching()}
          class="mb-4"
        />

        {/* quick presets */}
        <SearchPresets
          presets={musicSearchPresets.slice(0, 6)}
          currentParams={search.searchParams()}
          onPresetToggle={(preset) => togglePreset(preset.id)}
          isPresetActive={(preset, params) => isPresetActive(preset.id)}
          label="quick filters:"
          showDescriptions={true}
          class="mb-4"
        />

        {/* advanced filters toggle */}
        <div class="flex items-center gap-4 mb-4">
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters())}
            class={`px-4 py-2 text-sm transition-colors ${
              showAdvancedFilters()
                ? "bg-magenta-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            advanced filters
          </button>

          <Show when={search.hasActiveFilters()}>
            <button
              onClick={() => search.clearFilters()}
              class="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              clear all
            </button>
          </Show>
        </div>
      </div>

      {/* advanced filters panel */}
      <SearchAdvancedFilters
        visible={showAdvancedFilters()}
        filters={search.searchParams()}
        onFiltersChange={(key, value) => {
          search.addFilter(key, value); // triggerSearch defaults to true
        }}
        onExactChange={(key, exact) => {
          search.addFilter(key, exact); // triggerSearch defaults to true
        }}
        filterConfigs={advancedFilterConfigs}
        class="mb-6"
      />

      {/* filter summary */}
      <SearchSummary
        filters={search.searchParams()}
        getSummary={() => filterSummary()}
        onClearAll={() => search.clearFilters()}
        showClearAll={true}
      />

      {/* results header */}
      <div class="flex justify-between items-center mb-4">
        <div class="flex items-center gap-4">
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

        <div class="flex gap-2 items-center">
          <SearchSortControls
            sortBy={search.sortBy() || undefined}
            sortDirection={search.sortDirection() || undefined}
            onSortChange={(field, direction) => {
              search.setSorting(field, direction); // triggerSearch defaults to true
            }}
            sortFields={sortFields}
            directionStyle="arrows"
          />
          <select
            value={selectedView()}
            onChange={(e) => setSelectedView(e.target.value as "grid" | "list")}
            class="px-3 py-2 bg-gray-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500"
          >
            <option value="grid">grid view</option>
            <option value="list">list view</option>
          </select>
        </div>
      </div>

      {/* results */}
      <Show when={!search.loading() && hasResults()}>
        <div
          class={
            selectedView() === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
              : "space-y-4"
          }
        >
          <For each={search.results()}>
            {(song: any) => (
              <div
                class={`bg-gray-900 p-4 hover:bg-gray-800 transition-colors cursor-pointer ${
                  selectedView() === "list" ? "flex items-center gap-4" : ""
                }`}
                onClick={() => {
                  console.log("Song clicked:", song);
                }}
              >
                <div class={selectedView() === "list" ? "flex-shrink-0" : ""}>
                  <Show
                    when={song.thumbnail_url}
                    fallback={
                      <div class="w-16 h-16 bg-gray-700 flex items-center justify-center text-gray-400 text-xs">
                        no image
                      </div>
                    }
                  >
                    <img
                      src={song.thumbnail_url}
                      alt={`${song.title} artwork`}
                      class="w-16 h-16 object-cover"
                    />
                  </Show>
                </div>
                <div class="space-y-2">
                  <h3 class="font-semibold text-white truncate">
                    {song.title || "untitled"}
                  </h3>
                  <p class="text-gray-300 text-sm truncate">
                    {song.artist || "unknown artist"}
                  </p>
                  <div class="flex items-center gap-4 text-xs text-gray-500">
                    <Show when={song.year}>
                      <span class="text-gray-500">{song.year}</span>
                    </Show>
                    <Show when={song.genre}>
                      <span class="text-gray-500">{song.genre}</span>
                    </Show>
                    <span>{formatDuration(song.duration_seconds)}</span>
                    <span>{formatRating(song.rating)}</span>
                    <Show when={song.is_favorite}>
                      <span class="text-magenta-400">favorite</span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* no results */}
      <Show when={!search.loading() && !hasResults()}>
        <div class="text-center py-12 text-gray-400">
          <p class="text-lg mb-4">no results found</p>
          <p class="text-sm">try adjusting your search terms or filters</p>
          <button
            onClick={() => search.clearFilters()}
            class="mt-4 px-4 py-2 bg-gray-800 text-white hover:bg-gray-700 transition-colors"
          >
            clear all filters
          </button>
        </div>
      </Show>

      {/* pagination */}
      <Show when={search.hasNext()}>
        <div class="mt-8 text-center">
          <button
            onClick={() => search.loadMore()}
            disabled={search.loading()}
            class="px-6 py-2 bg-magenta-600 text-white hover:bg-magenta-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {search.loading() ? "loading..." : "load more"}
          </button>
        </div>
      </Show>

      {/* error display */}
      <Show when={search.error()}>
        <div class="text-center py-12 text-red-400">
          error: {search.error()}
          <button
            onClick={() => search.refresh()}
            class="ml-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            retry
          </button>
        </div>
      </Show>

      {/* debug info */}
      <Show when={showDebugInfo()}>
        <div class="mt-8 p-4 bg-gray-900 text-xs text-gray-300">
          <h3 class="font-bold mb-2">debug info</h3>
          <pre class="whitespace-pre-wrap">
            search params: {JSON.stringify(search.searchParams(), null, 2)}
            {"\n"}
            metadata: {JSON.stringify(search.searchMetadata(), null, 2)}
          </pre>
        </div>
      </Show>

      <style>{`
        .search-demo__query-time {
          font-size: 0.75rem;
          color: #9ca3af;
        }

        .font-metro {
          font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont,
            "Segoe UI", Roboto, sans-serif;
        }
      `}</style>
    </div>
  );
}

export default function SearchDemo(props: SearchDemoProps = {}) {
  const [apiClient, setApiClient] = createSignal<ApiClient | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const client = new ApiClient({
        baseUrl: props.apiBaseUrl || window.location.origin,
        timeout: 30000,
      });

      await client.health();
      setApiClient(client);
    } catch (err) {
      console.error("Failed to initialize API client:", err);
      setError(err instanceof Error ? err.message : "failed to initialize");
    }
  });

  return (
    <div class="search-demo">
      <Show
        when={error()}
        fallback={
          <Show when={apiClient()} fallback={<div>loading...</div>}>
            <SearchDemoContent apiClient={apiClient()!} />
          </Show>
        }
      >
        <div class="error-container">
          <h1>search demo error</h1>
          <p>{error()}</p>
        </div>
      </Show>
    </div>
  );
}

// web component setup
export class SearchDemoElement extends HTMLElement {
  private dispose?: () => void;

  connectedCallback() {
    const apiBaseUrl = this.getAttribute("api-base-url") || undefined;
    const autoConnect = this.getAttribute("auto-connect") === "true";

    this.dispose = render(
      () => <SearchDemo apiBaseUrl={apiBaseUrl} autoConnect={autoConnect} />,
      this
    );
  }

  disconnectedCallback() {
    this.dispose?.();
  }
}

customElements.define("search-demo", SearchDemoElement);
