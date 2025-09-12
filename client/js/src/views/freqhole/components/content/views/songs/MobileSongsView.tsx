import { createEffect } from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useFreqholeSearch } from "../../../../hooks/useFreqholeSearch";
import { FreqholeInfiniteGrid } from "../../../grid";
import { useSongState } from "../../../../services/songState";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import type { Song } from "../../../../../../lib/music/schemas/song";
import type { SortField } from "../../../../../../components/search/SearchSortControls";

interface MobileSongsViewProps {
  class?: string;
}

export function MobileSongsView(props: MobileSongsViewProps) {
  const [] = useStore();
  const songState = useSongState();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Enhanced search hook with total counts
  const searchHook = useFreqholeSearch(apiClient);

  // Selection state (disabled for mobile)
  const selection = useSelection({
    onSelectionChange: (_selectedIds) => {
      // Mobile selection changed
    },
    onBulkAction: (_action, _selectedSongs) => {
      // Mobile bulk action
    },
  });

  // Mobile views don't typically use selection UI

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      selection.clearSelection();
    });
  });

  // Use search hook for songs data
  const songs = () => {
    const songList = searchHook.songs();
    // Sync songs with song state service for rating component
    if (songList.length > 0) {
      songState.setSongList(songList);
    }
    return songList;
  };
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

  // Sort fields for mobile dropdown
  const sortFields: SortField[] = [
    { value: "title", label: "title", description: "Sort by song title" },
    { value: "artist", label: "artist", description: "Sort by artist name" },
    { value: "album", label: "album", description: "Sort by album name" },
    { value: "year", label: "year", description: "Sort by release year" },
    {
      value: "user_rating",
      label: "rating",
      description: "Sort by user rating",
    },
    {
      value: "is_favorite",
      label: "favorite",
      description: "Sort by favorite status",
    },
    {
      value: "duration_seconds",
      label: "duration",
      description: "Sort by song length",
    },
    { value: "created_at", label: "added", description: "Sort by date added" },
  ];

  const handleSortChange = (field: string, direction: "asc" | "desc") => {
    searchHook.setSort(field, direction);
  };

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-3">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-2xl font-semibold text-white">songs</h1>
          <SearchSortControls
            sortBy={searchHook.sortField() || undefined}
            sortDirection={searchHook.sortDirection() || undefined}
            onSortChange={handleSortChange}
            sortFields={sortFields}
            directionStyle="arrows"
            class="flex-shrink-0"
          />
        </div>
        <p class="text-gray-300 text-sm">
          {(() => {
            const songList = songs();
            const total = totalCount();
            const isLoading = loading();
            const errorState = error();

            if (isLoading && songList.length === 0) {
              return "loading...";
            }
            if (errorState) {
              return "error loading songs";
            }
            if (total !== undefined) {
              const loaded = songList.length;
              if (loaded < total) {
                return `showing ${loaded} of ${total} songs`;
              } else {
                return `${total} ${total === 1 ? "song" : "songs"}`;
              }
            }
            return `${songList.length} songs`;
          })()}
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
            showHeader={false}
            class="h-full"
          />
        </div>
      )}

      {/* Mobile views typically don't show selection toolbar for simplicity */}
    </div>
  );
}
