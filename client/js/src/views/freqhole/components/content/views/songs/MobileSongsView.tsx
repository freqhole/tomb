import { createEffect, createMemo } from "solid-js";

import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useStore } from "../../../../store";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useReactiveActions, useSort } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";
import { FreqholeInfiniteGrid } from "../../../grid";
import { useSongState } from "../../../../services/songState";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import type { Song } from "../../../../../../lib/music/schemas/song";
import type { SortField } from "../../../../../../components/search/SearchSortControls";
import type { PostSearchResponse } from "../../../../../../lib/search/types";

interface MobileSongsViewProps {
  class?: string;
}

export function MobileSongsView(props: MobileSongsViewProps) {
  const [] = useStore();
  const songState = useSongState();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Use modern reactive store instead of legacy search hook
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort();

  // Use same data access pattern as working desktop view
  const dataSections = useDataSections();

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

  // Use exact same pattern as working desktop view
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

  // Reload functionality
  const reloadSongs = () => {
    reactiveActions.refreshSongs();
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
      value: "user_is_favorite",
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
    // Use reactive store to update sort - this will automatically trigger songs refetch
    reactiveActions.setSort(field, direction);
  };

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      {/* Fixed Header */}
      <div class="flex-shrink-0 p-3">
        <div class="flex items-center justify-between mb-2">
          <h1 class="text-2xl font-semibold text-white">
            songs
            <span class="text-gray-300 text-sm ml-1">
              (
              {(() => {
                const songList = songs();
                const total = totalCount();
                const isLoading = loading();
                const errorState = error();

                if (isLoading && songList.length === 0) {
                  return "loading...";
                }
                if (errorState) {
                  return "";
                }
                if (total !== undefined) {
                  const loaded = songList.length;
                  if (loaded < total) {
                    return `${loaded} of ${total} songs`;
                  } else {
                    return `${total} ${total === 1 ? "song" : "songs"}`;
                  }
                }
                return `${songList.length} songs`;
              })()}
              )
            </span>
          </h1>
          <SearchSortControls
            sortBy={sortState.field}
            sortDirection={sortState.direction}
            onSortChange={handleSortChange}
            sortFields={sortFields}
            directionStyle="arrows"
            class="flex-shrink-0"
          />
        </div>
        <div class="flex items-center">
          <TagFilterControls compact={true} />
        </div>
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
            onLoadMore={reactiveActions.loadMoreSongs}
            renderMode="songs-mobile"
            loading={loading()}
            error={error()}
            enableSelection={false}
            enableKeyboardShortcuts={false}
            selectedItems={new Set()}
            onSelectionChange={handleSelectionChange}
            onItemClick={handleSongClick}
            onContextMenu={handleContextMenu}
            sortField={sortState.field}
            sortDirection={sortState.direction}
            onSort={handleSortChange}
            showHeader={false}
          />
        </div>
      )}

      {/* Mobile views typically don't show selection toolbar for simplicity */}
    </div>
  );
}
