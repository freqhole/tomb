/* @jsxImportSource solid-js */
import { createSignal, onMount, Show, createEffect } from "solid-js";
import { ApiClient } from "../../../lib/api-client.js";
import { AdminDataGrid } from "./AdminDataGrid.js";
import { createMusicAdminData } from "../../../hooks/music/admin/useMusicAdminData.js";
import { AdminSearchHeader } from "../../../lib/admin/components/AdminSearchHeader.js";
import { AdvancedFilterPanel } from "../../../lib/admin/components/AdvancedFilterPanel.js";
import { useMusicSearch } from "../../../hooks/music/admin/useMusicSearch.js";
import { musicFilterFields } from "../../../lib/music/admin/music-unified-search.js";

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
  const musicSearch = useMusicSearch(props.apiClient, (searchParams) => {
    console.log("admin view: search params updated", searchParams);
    // update music data filters when search changes
    musicData.updateFilters(searchParams, true);
  });

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
      });

      // the search system provides the results directly
      // the admin data grid will use these results

      if (!initialized()) {
        setInitialized(true);
        console.log("admin view: initialization complete via search");
      }
    }
  });

  // initialize with search system
  onMount(async () => {
    try {
      console.log("admin view: initializing with enhanced search system");

      // the search system will handle initial data loading
      // just trigger a refresh to start the flow
      await musicSearch.refresh();
    } catch (err) {
      console.error("admin view: initialization failed:", err);
      setInitError(err instanceof Error ? err.message : "failed to load data");
    }
  });

  // handle refresh using search system
  const handleRefresh = async () => {
    try {
      console.log("admin view: refreshing data via search system");
      await musicSearch.refresh();
    } catch (err) {
      console.error("admin view: refresh failed:", err);
    }
  };

  // handle song play
  const handleSongPlay = (song: any) => {
    console.log("admin view: play song requested", song.id);
    // TODO: integrate with audio player
  };

  // handle song edit
  const handleSongEdit = (song: any) => {
    console.log("admin view: edit song requested", song.id);
    // TODO: implement song editing modal/interface
  };

  return (
    <div class={`admin-view h-full flex flex-col ${props.className || ""}`}>
      {/* header */}
      <div class="bg-black px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-white">music library admin</h1>
            <Show when={initialized()}>
              <p class="text-sm text-gray-300 mt-1">
                {musicSearch.totalCount()} songs total
                <Show when={musicSearch.searching()}>
                  <span class="text-yellow-400 ml-2">• searching...</span>
                </Show>
                <Show when={musicData.hasSelection()}>
                  <span class="text-magenta-400 ml-2">
                    • {musicData.selection.actions.getSelectedCount()} selected
                  </span>
                </Show>
                <Show when={musicSearch.hasActiveFilters()}>
                  <span class="text-blue-400 ml-2">• filtered</span>
                </Show>
              </p>
            </Show>
          </div>
          <div class="flex items-center space-x-4">
            <button
              onClick={() => {
                const current = musicData.viewMode();
                const modes: Array<"compact" | "standard" | "detailed"> = [
                  "compact",
                  "standard",
                  "detailed",
                ];
                const currentIndex = modes.indexOf(current);
                const nextIndex =
                  currentIndex >= 0 ? (currentIndex + 1) % modes.length : 0;
                const nextMode = modes[nextIndex];
                if (nextMode) {
                  musicData.setViewMode(nextMode);
                }
              }}
              class="px-3 py-2 bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors"
              title={`Current: ${musicData.viewMode()} view - Click to cycle`}
            >
              {musicData.viewMode() === "compact"
                ? "compact"
                : musicData.viewMode() === "standard"
                  ? "standard"
                  : "detailed"}
            </button>
            <button
              onClick={handleRefresh}
              disabled={musicSearch.searching()}
              class="px-4 py-2 bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {musicSearch.searching() ? "searching..." : "refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* enhanced search header with full backend integration */}
      <Show when={initialized()}>
        <AdminSearchHeader
          searchQuery={musicSearch.searchQuery}
          onSearchChange={musicSearch.setSearchQuery}
          filters={musicSearch.filters}
          onFiltersChange={musicSearch.updateFilters}
          onClearFilters={musicSearch.clearFilters}
          showAdvancedSearch={musicSearch.showAdvancedSearch}
          onToggleAdvancedSearch={musicSearch.setShowAdvancedSearch}
          suggestions={musicSearch.suggestions}
          onSuggestionSelect={musicSearch.onSuggestionSelect}
          presets={musicSearch.presets}
          onPresetApply={musicSearch.applyPreset}
          loading={musicSearch.searching}
          resultsCount={musicSearch.totalCount}
          filterSummary={musicSearch.filterSummary}
        />
      </Show>

      {/* enhanced advanced filter panel with unified search fields */}
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

      {/* main content area */}
      <div class="flex-1 bg-gray-900">
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
                  loading: () =>
                    musicSearch.loading() || musicSearch.searching(),
                }}
                onSongPlay={handleSongPlay}
                onSongEdit={handleSongEdit}
                theme={props.theme}
                className="h-full"
              />
            </Show>
          }
        >
          <div class="h-full flex items-center justify-center">
            <div class="text-center p-8">
              <div class="text-red-400 text-4xl mb-4">⚠</div>
              <h2 class="text-xl font-bold text-red-300 mb-2">
                failed to load music library
              </h2>
              <p class="text-red-400 mb-4">{initError()}</p>
              <button
                onClick={handleRefresh}
                class="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                try again
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
