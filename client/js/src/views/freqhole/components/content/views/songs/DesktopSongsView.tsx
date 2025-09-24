import { createEffect, createSignal } from "solid-js";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore, useReactiveActions, useSort } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useDataSections } from "../../../../store/hooks";
import { FreqholeInfiniteGrid } from "../../../grid";
import { useSongState } from "../../../../services/songState";
import type { PostSearchResponse } from "../../../../../../lib/search/types";
import type { RouteSectionProps } from "@solidjs/router";
import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import type { Song } from "../../../../../../lib/music/schemas/song";

interface DesktopSongsViewProps {
  class?: string;
}

export function DesktopSongsView(
  props: RouteSectionProps<unknown> & DesktopSongsViewProps = {} as any
) {
  const [] = useStore();
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort();
  const songState = useSongState();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Use reactive store data instead of legacy search hook
  const dataSections = useDataSections();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (_selectedIds) => {
      // Selection changed
    },
    onBulkAction: (_action, _selectedSongs) => {
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

  // Listen for song updates to keep grid data in sync
  createEffect(() => {
    events.on("song:rating-updated", ({ songId, rating }) => {
      // Update the song in reactive store
      const currentData = dataSections.songs.data() as
        | PostSearchResponse
        | undefined;
      if (currentData?.songs) {
        const updatedSongs = currentData.songs.map((song) =>
          song.id === songId ? { ...song, user_rating: rating } : song
        );
        // Update the reactive store with new data
        reactiveActions.updateSongsInPlace(updatedSongs);
      }
    });

    events.on("song:favorite", ({ song }) => {
      const currentData = dataSections.songs.data() as
        | PostSearchResponse
        | undefined;
      if (currentData?.songs) {
        const updatedSongs = currentData.songs.map((s) =>
          s.id === song.id ? { ...s, user_is_favorite: true } : s
        );
        reactiveActions.updateSongsInPlace(updatedSongs);
      }
    });

    events.on("song:unfavorite", ({ song }) => {
      const currentData = dataSections.songs.data() as
        | PostSearchResponse
        | undefined;
      if (currentData?.songs) {
        const updatedSongs = currentData.songs.map((s) =>
          s.id === song.id ? { ...s, user_is_favorite: false } : s
        );
        reactiveActions.updateSongsInPlace(updatedSongs);
      }
    });
  });

  // Use reactive store data for songs - PostSearchResponse has proper types
  const songs = () => {
    const result = dataSections.songs.data() as PostSearchResponse | undefined;
    const songList = result?.songs || [];

    if (songList.length > 0) {
      songState.setSongList(songList);
    }
    return songList;
  };
  const loading = () => dataSections.songs.loading || false;
  const error = () => dataSections.songs.error;
  const totalCount = () => {
    const result = reactiveActions.resources?.songs();
    if (result && typeof result === "object" && "total" in result) {
      return (result as any).total || 0;
    }
    return songs().length;
  };

  // Reload functionality - reactive store handles this automatically
  const reloadSongs = () => {
    // TODO: Add manual refresh capability to reactive store if needed
  };

  // Handle sort changes - unified with mobile view
  const handleSort = (field: string, direction: "asc" | "desc" | null) => {
    if (direction === null) {
      // Reset to default sort
      reactiveActions.setSort("created_at", "desc");
    } else {
      reactiveActions.setSort(field, direction);
    }
  };

  // Listen for data reload events
  createEffect(() => {
    events.on("data:reload", (data) => {
      if (data.type === "songs") {
        reloadSongs();
      }
    });

    // Listen for targeted song updates - more efficient than full reload
    events.on("songs:updated", (data) => {
      console.log(`desktop: received ${data.songs.length} updated songs`);
      // Update reactive store directly for immediate UI refresh
      reactiveActions.updateSongsInPlace(data.songs);
    });
  });

  const handleSongClick = (_song: Song) => {
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
      selectedSongs.forEach((_song) => {
        // TODO: implement rating update via songInteractions
      });
      e.preventDefault();
    }

    // Handle favorite toggle (f key)
    if (e.key === "f" || e.key === "F") {
      selectedSongs.forEach((_song) => {
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
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-2xl font-semibold text-white">songs</h1>
          <TagFilterControls compact={false} />
        </div>
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
            onLoadMore={reactiveActions.loadMoreSongs}
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
            sortField={sortState.field}
            sortDirection={sortState.direction}
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
