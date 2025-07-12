import { Show, createEffect, createSignal } from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { MobileSongList } from "./MobileSongList";
import type { Song } from "../../../../../../lib/music/schemas/song";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface MobileSongsViewProps {
  class?: string;
}

export function MobileSongsView(props: MobileSongsViewProps) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `🎵 Mobile selection changed: ${selectedIds.size} songs selected`
      );
    },
    onBulkAction: (action, selectedSongs) => {
      console.log(
        `🎵 Mobile bulk action: ${action} for ${selectedSongs.length} songs`
      );
    },
  });

  // Track whether we have selections for bulk context menu
  const [hasSelections, setHasSelections] = createSignal(false);

  createEffect(() => {
    setHasSelections(selection.selectedItems().size >= 2);
  });

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing mobile selection via event");
      selection.clearSelection();
    });
  });

  // Create fetch function for infinite scroll
  const fetchSongs = async (
    page: number
  ): Promise<{ items: Song[]; pagination: PaginationMetadata }> => {
    console.log(`🎵 Loading mobile songs page ${page}`);

    const response = await apiClient.getSongs({
      page,
      page_size: 50,
    });

    console.log(`🎵 Loaded ${response.songs.length} mobile songs`, response);

    return {
      items: response.songs,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchSongs, {
    threshold: 200,
    enabled: true,
  });

  // Extract state and actions
  const songs = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;
  const hasMore = infiniteScroll.state.hasMore;

  // Reload functionality
  const reloadSongs = () => {
    infiniteScroll.actions.reset();
  };

  // Listen for data reload events
  events.on("data:reload", (data) => {
    if (data.type === "songs") {
      reloadSongs();
    }
  });

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-3">
        <h1 class="text-2xl font-semibold text-white mb-2">songs</h1>
        <Show
          when={!loading() && !error()}
          fallback={<p class="text-gray-300 text-sm">loading songs...</p>}
        >
          <p class="text-gray-300 text-sm">{songs().length} songs</p>
        </Show>
      </div>

      {/* Error State */}
      <Show when={error() && songs().length === 0}>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-red-400 mb-2">⚠️</div>
            <div class="text-white mb-2">failed to load songs</div>
            <div class="text-red-400 text-sm mb-4">{error()}</div>
            <button
              class="px-4 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-white font-medium text-sm transition-all"
              onClick={reloadSongs}
            >
              try again
            </button>
          </div>
        </div>
      </Show>

      {/* Empty State */}
      <Show when={songs().length === 0 && !loading() && !error()}>
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-6xl mb-4">🎵</div>
            <div class="text-white text-xl mb-2">no songs found</div>
            <div class="text-gray-400">add some music to get started</div>
          </div>
        </div>
      </Show>

      {/* Mobile Songs List */}
      <Show when={!error() || songs().length > 0}>
        <div class="flex-1 flex flex-col h-full overflow-hidden">
          <div
            class="flex-1 overflow-y-auto min-h-0"
            ref={infiniteScroll.containerRef}
          >
            <MobileSongList
              songs={songs()}
              loading={loading()}
              hasMore={hasMore()}
              onLoadMore={infiniteScroll.actions.loadMore}
              class="px-4"
            />
          </div>
        </div>
      </Show>

      {/* Selection Toolbar */}
      <Show when={hasSelections()}>
        <div class="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-magenta-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-4 z-40 freqhole-selection-toolbar">
          <span class="text-sm font-medium">
            {selection.selectedItems().size} song
            {selection.selectedItems().size !== 1 ? "s" : ""} selected
          </span>

          <div class="flex space-x-2">
            <button
              class="px-3 py-1 bg-magenta-700 hover:bg-magenta-800 rounded text-sm transition-colors"
              onClick={() => {
                const selectedSongs = selection.getSelectedSongs(songs());
                selectedSongs.forEach((song) =>
                  songInteractions.queueSong(song)
                );
                selection.clearSelection();
              }}
            >
              Add to Queue
            </button>

            <button
              class="px-3 py-1 bg-magenta-700 hover:bg-magenta-800 rounded text-sm transition-colors"
              onClick={(e) => {
                const selectedSongs = selection.getSelectedSongs(songs());
                songInteractions.handlePlaylistSelectorClick(e, selectedSongs);
              }}
            >
              Add to Playlist
            </button>

            <button
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
              onClick={() => selection.clearSelection()}
            >
              Clear
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
