import { createEffect, createSignal } from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useFreqholeSearch } from "../../../../hooks/useFreqholeSearch";
import { FreqholeInfiniteGrid } from "../../../grid";
import type { Song } from "../../../../../../lib/music/schemas/song";

interface MobileSongsViewProps {
  class?: string;
}

export function MobileSongsView(props: MobileSongsViewProps) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Enhanced search hook with total counts
  const searchHook = useFreqholeSearch(apiClient);

  // Selection state (disabled for mobile)
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

  // Mobile views don't typically use selection UI

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing mobile selection via event");
      selection.clearSelection();
    });
  });

  // Use search hook for songs data
  const songs = () => searchHook.songs();
  const loading = () => searchHook.loading();
  const error = () => searchHook.error();
  const totalCount = () => searchHook.totalCount();

  // Reload functionality
  const reloadSongs = () => {
    searchHook.refresh();
  };

  // Listen for data reload events
  createEffect(() => {
    events.on("data:reload", (data) => {
      if (data.type === "songs") {
        reloadSongs();
      }
    });
  });

  const handleSongClick = (song: Song) => {
    // For mobile, single click plays the song
    songInteractions.playSong(song);
  };

  const handleContextMenu = (event: MouseEvent, song: Song) => {
    // Mobile context menu (simplified)
    songInteractions.handleRightClick(event, song);
  };

  // Handle selection changes (minimal for mobile)
  const handleSelectionChange = (selectedIds: Set<string>) => {
    selection.setSelectedItems(selectedIds);
  };

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-3">
        <h1 class="text-2xl font-semibold text-white mb-2">songs</h1>
        <p class="text-gray-300 text-sm">
          {totalCount() > 0 &&
            `${totalCount()} ${totalCount() === 1 ? "song" : "songs"}`}
          {loading() && songs().length === 0 && "loading..."}
          {error() && "error loading songs"}
        </p>
      </div>

      {/* Error State */}
      {error() && songs().length === 0 && (
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
      )}

      {/* Empty State */}
      {songs().length === 0 && !loading() && !error() && (
        <div class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <div class="text-6xl mb-4">🎵</div>
            <div class="text-white text-xl mb-2">no songs found</div>
            <div class="text-gray-400">add some music to get started</div>
          </div>
        </div>
      )}

      {/* FreqholeInfiniteGrid - Mobile */}
      {(!error() || songs().length > 0) && (
        <div class="flex-1 min-h-0">
          <FreqholeInfiniteGrid
            data={songs()}
            totalCount={totalCount()}
            onLoadMore={searchHook.loadMore}
            renderMode="songs-mobile"
            loading={loading()}
            error={error()}
            enableSelection={false}
            enableKeyboardShortcuts={false}
            selectedItems={new Set()}
            onSelectionChange={handleSelectionChange}
            onItemClick={handleSongClick}
            onContextMenu={handleContextMenu}
            class="h-full"
          />
        </div>
      )}

      {/* Mobile views typically don't show selection toolbar for simplicity */}
    </div>
  );
}
