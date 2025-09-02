/* @jsxImportSource solid-js */
import { createSignal, onMount, Show } from "solid-js";
import { ApiClient } from "../../../lib/api-client.js";
import { AdminDataGrid } from "./AdminDataGrid.js";
import { createMusicAdminData } from "../../../hooks/music/admin/useMusicAdminData.js";

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

  // initialize data loading
  onMount(async () => {
    try {
      console.log("admin view: loading initial data");
      console.log("admin view: musicData available:", !!musicData);
      console.log(
        "admin view: musicData.fetchData function:",
        typeof musicData.fetchData
      );

      // trigger initial data load
      console.log("admin view: calling fetchData()");
      await musicData.fetchData();

      console.log("admin view: fetchData completed, checking state");
      console.log("admin view: items count:", musicData.items().length);
      console.log("admin view: total:", musicData.total());
      console.log("admin view: loading state:", musicData.loading());
      console.log("admin view: error state:", musicData.error());

      setInitialized(true);
      console.log("admin view: initialization complete");
    } catch (err) {
      console.error("admin view: initialization failed:", err);
      setInitError(err instanceof Error ? err.message : "failed to load data");
    }
  });

  // handle refresh
  const handleRefresh = async () => {
    try {
      console.log("admin view: refreshing data");
      await musicData.refresh();
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
                {musicData.total()} songs total
                <Show when={musicData.hasSelection()}>
                  <span class="text-magenta-400 ml-2">
                    • {musicData.selection.actions.getSelectedCount()} selected
                  </span>
                </Show>
              </p>
            </Show>
          </div>
          <div class="flex items-center space-x-4">
            <Show when={musicData.isFiltered()}>
              <button
                onClick={() => musicData.clearFilters()}
                class="px-3 py-1 bg-gray-700 text-gray-300 hover:bg-gray-600 text-xs font-medium transition-colors"
              >
                clear filters
              </button>
            </Show>
            <button
              onClick={handleRefresh}
              disabled={musicData.loading()}
              class="px-4 py-2 bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              refresh
            </button>
          </div>
        </div>
      </div>

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
                    <p class="text-white">loading music library...</p>
                    <p class="text-gray-400 text-sm mt-2">
                      connecting to music API...
                    </p>
                  </div>
                </div>
              }
            >
              <AdminDataGrid
                musicData={musicData}
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
