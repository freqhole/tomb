/* @jsxImportSource solid-js */
import { createSignal, onMount, Show, createEffect } from "solid-js";
import { ApiClient } from "../../../lib/api-client.js";
import { AdminDataGrid } from "./AdminDataGrid.js";
import { createMusicAdminData } from "../../../hooks/music/admin/useMusicAdminData.js";
import { AdminSearchHeader } from "../../../lib/admin/components/AdminSearchHeader.js";
import { AdvancedFilterPanel } from "../../../lib/admin/components/AdvancedFilterPanel.js";
import { useMusicSearch } from "../../../hooks/music/admin/useMusicSearch.js";
import {
  musicFilterFields,
  musicSearchPresets,
} from "../../../lib/music/admin/music-unified-search.js";
import type {
  SearchPreset,
  SearchField,
} from "../../../components/search/index.js";

export interface AdminViewProps {
  apiClient: ApiClient;
  className?: string;
  theme?: "light" | "dark";
}

/**
 * main admin view component that coordinates the music admin interface
 */
export function AdminView(props: AdminViewProps) {
  console.log("admin view: starting initialization", {
    apiClient: !!props.apiClient,
    theme: props.theme,
  });

  const [initialized, setInitialized] = createSignal(false);
  const [initError, setInitError] = createSignal<string | null>(null);

  // create music admin data hook
  const musicData = createMusicAdminData(props.apiClient);

  // create enhanced music search hook with unified search backend
  const musicSearch = useMusicSearch(props.apiClient);

  // sync search results with admin data grid
  createEffect(() => {
    const results = musicSearch.results();
    const total = musicSearch.totalCount();
    const error = musicSearch.error();

    if (error) {
      console.error("admin view: search error", error);
      setInitError(error);
    } else if (results.length > 0 || total >= 0) {
      // update admin data with search results
      console.log("admin view: syncing search results", {
        results: results.length,
        total,
        sortField: musicSearch.sortField(),
        sortDirection: musicSearch.sortDirection(),
      });

      // the search system provides the results directly
      // the admin data grid will use these results

      if (!initialized()) {
        setInitialized(true);
        console.log("admin view: initialization complete via search");
      }
    }

    // musicData sort is overridden in the grid props, so no need to sync here
  });

  // initialize with search system
  onMount(async () => {
    try {
      console.log("admin view: initializing with enhanced search system");

      // No default sort - start with no columns sorted

      // Trigger initial search to load data
      await musicSearch.refresh();
    } catch (err) {
      console.error("admin view: initialization failed:", err);
      setInitError(err instanceof Error ? err.message : "failed to load data");
    }
  });

  // handle song play
  const handleSongPlay = (song: any) => {
    console.log("admin view: play song requested", song.id);

    // Try to construct media URL
    try {
      if (song.media_blob_id) {
        const mediaUrl = `${props.apiClient.getBaseUrl()}/api/blobs/${song.media_blob_id}`;
        console.log(`admin view: playing song from ${mediaUrl}`);
        // TODO: integrate with audio player
      } else {
        console.warn("admin view: cannot play - no media blob ID");
      }
    } catch (err) {
      console.error("admin view: failed to construct media URL", err);
    }
  };

  // handle song edit
  const handleSongEdit = (song: any) => {
    console.log("admin view: edit song requested", song.id);
    // TODO: implement song editing modal/interface
  };

  // search field configuration for admin
  const adminSearchFields: SearchField[] = [
    { value: "all", label: "all", description: "search all fields" },
    { value: "title", label: "title", description: "search song titles" },
    { value: "artist", label: "artist", description: "search artist names" },
    { value: "album", label: "album", description: "search album names" },
    { value: "genre", label: "genre", description: "search genres" },
  ];

  // handle preset toggle
  const handlePresetApply = (preset: SearchPreset) => {
    console.log("admin view: toggling preset", preset.id);
    const currentParams = musicSearch.filters();
    const isActive = isPresetActive(preset);

    console.log("admin view: preset debug", {
      presetId: preset.id,
      presetParams: preset.params,
      currentParams: currentParams,
      currentParamsType: typeof currentParams,
      currentParamsKeys: Object.keys(currentParams),
      isActive: isActive,
    });

    // Try the same approach as search-demo
    if (isActive) {
      console.log("admin view: clearing preset");
      // Check if we're clearing all filters
      const currentParams = musicSearch.filters();
      const currentKeys = Object.keys(currentParams);
      const presetKeys = Object.keys(preset.params);

      // If preset keys are the only active filters, clear everything
      const onlyPresetKeysActive =
        presetKeys.every((key) => currentKeys.includes(key)) &&
        currentKeys.every((key) => presetKeys.includes(key));

      if (onlyPresetKeysActive) {
        console.log("admin view: clearing all filters");
        musicSearch.clearFilters();
      } else {
        console.log("admin view: removing specific preset keys");
        // Create new params with preset keys explicitly removed
        const newParams = { ...currentParams };
        Object.keys(preset.params).forEach((key) => {
          console.log(`admin view: removing filter key: ${key}`);
          delete (newParams as any)[key];
        });
        console.log("admin view: clearing preset, new params:", newParams);
        // Set filters directly to the new object
        musicSearch.clearFilters();
        if (Object.keys(newParams).length > 0) {
          musicSearch.updateFilters(newParams);
        }
      }
    } else {
      console.log("admin view: applying preset using bulk update");
      // Apply the preset
      const newParams = { ...currentParams, ...preset.params };
      console.log("admin view: applying preset, new params:", newParams);
      musicSearch.updateFilters(newParams);
    }
  };

  // check if preset is active
  const isPresetActive = (preset: SearchPreset) => {
    const currentFilters = musicSearch.filters();
    console.log("admin view: isPresetActive check", {
      presetId: preset.id,
      currentFilters: currentFilters,
      currentFiltersStringified: JSON.stringify(currentFilters),
      presetParams: preset.params,
      presetParamsStringified: JSON.stringify(preset.params),
    });

    const result = Object.entries(preset.params).every(([key, value]) => {
      const currentValue = (currentFilters as any)[key];
      const matches = currentValue === value;
      console.log("admin view: checking preset param", {
        key,
        presetValue: value,
        presetValueType: typeof value,
        currentValue: currentValue,
        currentValueType: typeof currentValue,
        matches: matches,
        strictEquality: currentValue === value,
        looseEquality: currentValue == value,
      });
      return matches;
    });
    console.log("admin view: preset active check result:", result);
    return result;
  };

  return (
    <div
      class={`admin-view h-screen flex flex-col overflow-hidden ${props.className || ""}`}
    >
      {/* sticky search header */}
      <Show when={initialized()}>
        <div class="sticky top-0 z-50 bg-black">
          <AdminSearchHeader
            searchQuery={musicSearch.searchQuery}
            onSearchChange={(query) => {
              musicSearch.setSearchQuery(query, false);
              console.log("admin view: search input changed", query);
            }}
            onSearchExecute={(query) => {
              // Handle enter key and search button clicks
              if (query.trim() === "") {
                // Clear search when empty query is executed
                musicSearch.setSearchQuery("", true);
              } else {
                // Execute search with current query
                musicSearch.setSearchQuery(query, true);
              }
              console.log("admin view: search executed", query);
            }}
            filters={musicSearch.filters}
            onFiltersChange={musicSearch.updateFilters}
            onClearFilters={musicSearch.clearFilters}
            showAdvancedSearch={musicSearch.showAdvancedSearch}
            onToggleAdvancedSearch={musicSearch.setShowAdvancedSearch}
            suggestions={musicSearch.suggestions}
            onSuggestionSelect={(suggestion) => {
              musicSearch.onSuggestionSelect(suggestion);
              console.log(
                "admin view: search executed from suggestion",
                suggestion
              );
            }}
            presets={musicSearchPresets.slice(0, 6)}
            onPresetApply={handlePresetApply}
            isPresetActive={isPresetActive}
            loading={musicSearch.loading}
            resultsCount={musicSearch.totalCount}
            filterSummary={musicSearch.filterSummary}
            searchFields={adminSearchFields}
            searchField={musicSearch.searchField() || undefined}
            onSearchFieldChange={(field) => {
              musicSearch.setSearchField(field);
              // Re-run search with new field if there's a query
              if (musicSearch.searchQuery().trim()) {
                musicSearch.setSearchQuery(musicSearch.searchQuery(), true);
              }
              console.log("admin view: search field changed to", field);
            }}
            // Add view mode button
            viewMode={musicData.viewMode()}
            onViewModeChange={(mode) => musicData.setViewMode(mode)}
          />
        </div>
      </Show>

      {/* scrollable content area with separate sections */}
      <div class="flex-1 bg-gray-900 flex flex-col min-h-0">
        {/* enhanced advanced filter panel - outside scroll container */}
        <Show when={initialized()}>
          <AdvancedFilterPanel
            filters={musicSearch.filters}
            onFiltersChange={musicSearch.updateFilters}
            filterConfigs={musicFilterFields.slice(0, 10).map((field) => ({
              key: field.key as any,
              label: field.label,
              type: field.type as any,
              placeholder: field.placeholder || `enter ${field.label}`,
              options:
                field.key === "genre" || field.key === "tags"
                  ? musicSearch.filterOptions()?.[field.key] || []
                  : field.options || [],
              min: field.min,
              max: field.max,
              supportsExact: field.supportsExact,
            }))}
            filterOptions={musicSearch.filterOptions}
            visible={musicSearch.showAdvancedSearch}
            onClose={() => musicSearch.setShowAdvancedSearch(false)}
          />
        </Show>

        {/* main grid content - let the grid handle its own scrolling */}
        <div class="flex-1 min-h-0 overflow-hidden">
          <Show
            when={initError()}
            fallback={
              <Show
                when={initialized()}
                fallback={
                  <div class="h-full flex items-center justify-center">
                    <div class="text-center">
                      <div class="animate-spin h-12 w-12 border-2 border-magenta-500 border-t-transparent mx-auto mb-4"></div>
                      <p class="text-white">
                        initializing enhanced music search...
                      </p>
                      <p class="text-gray-400 text-sm mt-2">
                        connecting to unified search backend...
                      </p>
                    </div>
                  </div>
                }
              >
                <AdminDataGrid
                  musicData={{
                    ...musicData,
                    items: () => musicSearch.results(),
                    total: () => musicSearch.totalCount(),
                    loading: () => musicSearch.loading(),
                    updateSort: (field, direction) => {
                      console.log(
                        "admin data grid: update sort",
                        field,
                        direction
                      );
                      console.log(
                        "AdminView: current sort state before update:",
                        {
                          musicSearchField: musicSearch.sortField(),
                          musicSearchDirection: musicSearch.sortDirection(),
                          musicDataField: musicData.sortField(),
                          musicDataDirection: musicData.sortDirection(),
                        }
                      );
                      // Only use musicSearch for sort updates to avoid duplicate API calls
                      // musicData.updateSort would trigger its own API request
                      musicSearch.setSort(field, direction);
                    },
                    sortField: () => musicSearch.sortField(),
                    sortDirection: () => musicSearch.sortDirection(),
                    // Override pagination methods to use music search system
                    hasNextPage: () => {
                      const pag = musicSearch.pagination();
                      return pag.hasNext;
                    },
                    nextPage: async () => {
                      console.log(
                        "admin view: loading next page via music search"
                      );
                      await musicSearch.loadMore();
                    },
                    // Override refresh to use musicSearch
                    refresh: () => musicSearch.refresh(),
                  }}
                  onSongPlay={handleSongPlay}
                  onSongEdit={handleSongEdit}
                  apiClient={props.apiClient}
                  theme={props.theme}
                  className="h-full"
                />
              </Show>
            }
          >
            <div class="h-full flex items-center justify-center">
              <div class="text-center p-8">
                <div class="text-red-400 text-4xl mb-4">!</div>
                <h2 class="text-xl font-bold text-red-300 mb-2">
                  failed to load music library
                </h2>
                <p class="text-red-400 mb-4">{initError()}</p>
                <div class="space-y-4">
                  <button
                    onClick={() => window.location.reload()}
                    class="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    try again
                  </button>
                  <div class="text-sm text-gray-400">
                    <p>api endpoint issues? check server logs for details</p>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
