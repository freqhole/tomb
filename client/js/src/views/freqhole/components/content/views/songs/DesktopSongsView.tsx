import { createEffect, createSignal } from "solid-js";
import { apiClient } from "../../../../../../lib/api-client";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useFreqholeSearch } from "../../../../hooks/useFreqholeSearch";
import { FreqholeInfiniteGrid } from "../../../grid";
import { useSongState } from "../../../../services/songState";
import type { Song } from "../../../../../../lib/music/schemas/song";
import type { RouteSectionProps } from "@solidjs/router";

interface DesktopSongsViewProps {
  class?: string;
}

export function DesktopSongsView(
  props: RouteSectionProps<unknown> & DesktopSongsViewProps = {} as any
) {
  const [] = useStore();
  const songState = useSongState();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Enhanced search hook with total counts
  const searchHook = useFreqholeSearch(apiClient);

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      // Selection changed
    },
    onBulkAction: (action, selectedSongs) => {
      // Bulk action
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

  // Handle sort changes
  const handleSort = (field: string) => {
    const currentField = searchHook.sortField();
    const currentDirection = searchHook.sortDirection();

    if (currentField === field) {
      // Toggle direction
      const newDirection = currentDirection === "asc" ? "desc" : "asc";
      searchHook.setSort(field, newDirection);
    } else {
      // New field, start with asc
      searchHook.setSort(field, "asc");
    }
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
    // Single click behavior - could expand for future features
  };

  const handleSongDoubleClick = (song: Song) => {
    // Double click plays the song on desktop
    songInteractions.playSong(song);
  };

  const handleContextMenu = (event: MouseEvent, song: Song) => {
    // Check if we should show bulk or single context menu
    const selectedSongs = selection.getSelectedSongs(songs());

    if (selectedSongs.length > 1 && selection.isSelected(song.id)) {
      // Show bulk context menu
      songInteractions.handleBulkRightClick(event, selectedSongs);
    } else {
      // Show single song context menu
      songInteractions.handleRightClick(event, song);
    }
  };

  // Handle selection changes
  const handleSelectionChange = (selectedIds: Set<string>) => {
    selection.setSelectedItems(selectedIds);
    setHasSelections(selectedIds.size >= 2);
  };

  // Keyboard shortcuts for preferences
  const handleKeyDown = (e: KeyboardEvent) => {
    // Only handle shortcuts if not typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const selectedSongs = selection.getSelectedSongs(songs());
    if (selectedSongs.length === 0) return;

    // Handle rating shortcuts (1-5)
    if (e.key >= "1" && e.key <= "5") {
      const rating = parseInt(e.key);
      selectedSongs.forEach((song) => {
        // TODO: implement rating update via songInteractions
      });
      e.preventDefault();
    }

    // Handle favorite toggle (f key)
    if (e.key === "f" || e.key === "F") {
      selectedSongs.forEach((song) => {
        // TODO: implement favorite toggle via songInteractions
      });
      e.preventDefault();
    }
  };

  return (
    <div
      class={`h-full flex flex-col ${props.class || ""}`}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-6">
        <h1 class="text-2xl font-semibold text-white mb-2">songs</h1>
        <p class="text-gray-400 text-sm">
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

      {/* FreqholeInfiniteGrid */}
      {(!error() || songs().length > 0) && (
        <div class="flex-1 min-h-0">
          <FreqholeInfiniteGrid
            data={songs()}
            totalCount={totalCount()}
            onLoadMore={searchHook.loadMore}
            renderMode="songs"
            loading={loading()}
            error={error()}
            enableSelection={true}
            enableKeyboardShortcuts={true}
            selectedItems={selection.selectedItems()}
            onSelectionChange={handleSelectionChange}
            onItemClick={handleSongClick}
            onItemDoubleClick={handleSongDoubleClick}
            onContextMenu={handleContextMenu}
            sortField={searchHook.sortField()}
            sortDirection={searchHook.sortDirection()}
            onSort={handleSort}
            class="h-full"
          />
        </div>
      )}

      {/* Selection Toolbar */}
      {hasSelections() && (
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
              add to queue
            </button>

            <button
              class="px-3 py-1 bg-magenta-700 hover:bg-magenta-800 rounded text-sm transition-colors"
              onClick={(e) => {
                const selectedSongs = selection.getSelectedSongs(songs());
                songInteractions.handlePlaylistSelectorClick(e, selectedSongs);
              }}
            >
              add to playlist
            </button>

            <button
              class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm transition-colors"
              onClick={() => selection.clearSelection()}
            >
              clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
