/* @jsxImportSource solid-js */
import { createMemo, onMount, onCleanup, For, Show } from "solid-js";
import {
  GenericInfiniteGrid,
  GridColumn,
} from "../../../web-components/generic-infinite-grid.js";
import type { AdminSong } from "../../../lib/admin/admin-api.js";
import type { MusicAdminData } from "../../../hooks/music/admin/useMusicAdminData.js";
import {
  ComponentEventRegistry,
  createGlobalKeyboardHandler,
} from "../../../lib/admin/event-registry.js";

export interface AdminDataGridProps {
  musicData: MusicAdminData;
  onSongPlay?: (song: AdminSong) => void;
  onSongEdit?: (song: AdminSong) => void;
  className?: string;
  theme?: "light" | "dark";
}

/**
 * Main admin data grid component that combines:
 * - Generic infinite grid for performance
 * - Music-specific data and actions
 * - Selection system
 * - Keyboard shortcuts
 * - Event handling
 */
export function AdminDataGrid(props: AdminDataGridProps) {
  const eventRegistry = new ComponentEventRegistry();
  let gridContainerRef: HTMLDivElement | undefined;

  // Grid configuration
  const columns = createMemo((): GridColumn<AdminSong>[] => [
    {
      key: "select",
      title: "",
      width: 40,
      render: (song: AdminSong) => (
        <input
          type="checkbox"
          checked={props.musicData.selection.actions.isSelected(song.id)}
          onChange={(e) => {
            e.stopPropagation();
            if (e.target.checked) {
              props.musicData.selection.actions.selectItem(song.id, true);
            } else {
              props.musicData.selection.actions.toggleSelection(song.id);
            }
          }}
          class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
        />
      ),
    },
    {
      key: "thumbnail",
      title: "",
      width: 60,
      render: (song: AdminSong) => (
        <div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center overflow-hidden">
          {song.thumbnail_blob_id ? (
            <img
              src={`/api/media/blobs/${song.thumbnail_blob_id}`}
              alt="Album artwork"
              class="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div class="text-gray-400 text-xs">No Art</div>
          )}
        </div>
      ),
    },
    {
      key: "title",
      title: "Title",
      width: 250,
      sortable: true,
      getValue: (song) => song.title,
      render: (song: AdminSong) => (
        <div class="min-w-0">
          <div class="font-medium text-gray-900 truncate">{song.title}</div>
          {song.artist && (
            <div class="text-sm text-gray-500 truncate">{song.artist}</div>
          )}
        </div>
      ),
    },
    {
      key: "artist",
      title: "Artist",
      width: 200,
      sortable: true,
      getValue: (song) => song.artist || "",
      render: (song: AdminSong) => (
        <div class="truncate" title={song.artist || ""}>
          {song.artist || "Unknown Artist"}
        </div>
      ),
    },
    {
      key: "album",
      title: "Album",
      width: 200,
      sortable: true,
      getValue: (song) => song.album || "",
      render: (song: AdminSong) => (
        <div class="truncate" title={song.album || ""}>
          {song.album || "Unknown Album"}
        </div>
      ),
    },
    {
      key: "duration",
      title: "Duration",
      width: 80,
      sortable: true,
      getValue: (song) => song.duration_seconds || 0,
      render: (song: AdminSong) => (
        <div class="text-right tabular-nums">
          {formatDuration(song.duration_seconds)}
        </div>
      ),
    },
    {
      key: "year",
      title: "Year",
      width: 80,
      sortable: true,
      getValue: (song) => song.year || 0,
      render: (song: AdminSong) => (
        <div class="text-center">{song.year || "—"}</div>
      ),
    },
    {
      key: "genre",
      title: "Genre",
      width: 150,
      sortable: true,
      getValue: (song) => song.genre || "",
      render: (song: AdminSong) => (
        <div class="truncate" title={song.genre || ""}>
          {song.genre || "Unknown"}
        </div>
      ),
    },
    {
      key: "rating",
      title: "Rating",
      width: 100,
      sortable: true,
      getValue: (song) => song.rating || 0,
      render: (song: AdminSong) => (
        <div class="flex items-center justify-center">
          <StarRating
            rating={song.rating}
            onRate={(rating) => updateSongRating(song.id, rating)}
          />
        </div>
      ),
    },
    {
      key: "favorite",
      title: "♥",
      width: 50,
      sortable: true,
      getValue: (song) => song.is_favorite,
      render: (song: AdminSong) => (
        <div class="flex items-center justify-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSongFavorite(song.id);
            }}
            class={`w-6 h-6 rounded-full border-2 transition-colors ${
              song.is_favorite
                ? "bg-red-500 border-red-500 text-white"
                : "bg-white border-gray-300 text-gray-400 hover:border-red-300"
            }`}
            title={
              song.is_favorite ? "Remove from favorites" : "Add to favorites"
            }
          >
            ♥
          </button>
        </div>
      ),
    },
    {
      key: "created_at",
      title: "Added",
      width: 150,
      sortable: true,
      getValue: (song) => song.created_at,
      render: (song: AdminSong) => (
        <div class="text-sm text-gray-500">{formatDate(song.created_at)}</div>
      ),
    },
    {
      key: "actions",
      title: "",
      width: 120,
      render: (song: AdminSong) => (
        <div class="flex items-center space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onSongPlay?.(song);
            }}
            class="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
            title="Play song"
          >
            Play
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onSongEdit?.(song);
            }}
            class="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            title="Edit song"
          >
            Edit
          </button>
        </div>
      ),
    },
  ]);

  // Event handlers
  const handleSort = (field: string, direction: "asc" | "desc" | null) => {
    if (direction) {
      props.musicData.updateSort(field, direction);
    }
  };

  const handleRowClick = (
    song: AdminSong,
    _index: number,
    event: MouseEvent
  ) => {
    props.musicData.handleSongClick(song, event);
  };

  const handleRowDoubleClick = (song: AdminSong) => {
    props.musicData.handleSongDoubleClick(song);
  };

  const handleScrollNearBottom = () => {
    // Load next page if available
    if (props.musicData.hasNextPage()) {
      props.musicData.nextPage();
    }
  };

  // Keyboard shortcuts
  const keyboardHandler = createGlobalKeyboardHandler({
    "ctrl+a": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+a", event as KeyboardEvent),
    escape: (event) =>
      props.musicData.handleKeyboardShortcut("escape", event as KeyboardEvent),
    delete: (event) =>
      props.musicData.handleKeyboardShortcut("delete", event as KeyboardEvent),
    "ctrl+f": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+f", event as KeyboardEvent),
    "ctrl+r": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+r", event as KeyboardEvent),
    f: (event) =>
      props.musicData.handleKeyboardShortcut("f", event as KeyboardEvent),
    "1": (event) =>
      props.musicData.handleKeyboardShortcut("1", event as KeyboardEvent),
    "2": (event) =>
      props.musicData.handleKeyboardShortcut("2", event as KeyboardEvent),
    "3": (event) =>
      props.musicData.handleKeyboardShortcut("3", event as KeyboardEvent),
    "4": (event) =>
      props.musicData.handleKeyboardShortcut("4", event as KeyboardEvent),
    "5": (event) =>
      props.musicData.handleKeyboardShortcut("5", event as KeyboardEvent),
    "0": (event) =>
      props.musicData.handleKeyboardShortcut("0", event as KeyboardEvent),
    "ctrl+1": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+1", event as KeyboardEvent),
    "ctrl+2": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+2", event as KeyboardEvent),
    "ctrl+3": (event) =>
      props.musicData.handleKeyboardShortcut("ctrl+3", event as KeyboardEvent),
  });

  // Helper functions
  const updateSongRating = async (songId: string, rating: number) => {
    try {
      await props.musicData.updateSong(songId, { rating });
    } catch (error) {
      console.error("Failed to update song rating:", error);
    }
  };

  const toggleSongFavorite = async (songId: string) => {
    const song = props.musicData.items().find((s) => s.id === songId);
    if (song) {
      try {
        await props.musicData.updateSong(songId, {
          is_favorite: !song.is_favorite,
        });
      } catch (error) {
        console.error("Failed to toggle song favorite:", error);
      }
    }
  };

  // Setup and cleanup
  onMount(() => {
    if (gridContainerRef) {
      eventRegistry.register(
        document,
        "keydown",
        keyboardHandler as (event: Event) => void
      );
    }
  });

  onCleanup(() => {
    eventRegistry.cleanup();
  });

  return (
    <div
      ref={gridContainerRef}
      class={`admin-data-grid ${props.className || ""}`}
    >
      <Show when={props.musicData.loading()}>
        <div class="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
          <div class="flex items-center space-x-2">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span class="text-gray-600">Loading songs...</span>
          </div>
        </div>
      </Show>

      <Show when={props.musicData.error()}>
        <div class="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
          <div class="flex">
            <div class="text-red-400">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clip-rule="evenodd"
                />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-800">
                Error loading songs
              </h3>
              <div class="mt-2 text-sm text-red-700">
                {props.musicData.error()}
              </div>
            </div>
          </div>
        </div>
      </Show>

      <GenericInfiniteGrid
        data={props.musicData.items()}
        columns={columns()}
        rowHeight={64}
        headerHeight={40}
        onSort={handleSort}
        onRowClick={handleRowClick}
        onRowDoubleClick={handleRowDoubleClick}
        onScrollNearBottom={handleScrollNearBottom}
        selectedItems={props.musicData.selection.selectedIds()}
        sortField={props.musicData.sortField() || undefined}
        sortDirection={props.musicData.sortDirection() || undefined}
        className="h-full"
        theme={props.theme}
      />

      {/* Selection info bar */}
      <Show when={props.musicData.hasSelection()}>
        <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-4">
          <span class="text-sm">
            {props.musicData.selection.actions.getSelectedCount()} songs
            selected
          </span>
          <div class="flex items-center space-x-2">
            <button
              onClick={() => props.musicData.toggleFavoriteSelected()}
              class="px-3 py-1 bg-blue-500 hover:bg-blue-400 rounded text-xs transition-colors"
            >
              Toggle Favorite
            </button>
            <button
              onClick={() => props.musicData.selection.actions.clearSelection()}
              class="px-3 py-1 bg-red-500 hover:bg-red-400 rounded text-xs transition-colors"
            >
              Clear Selection
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * Star rating component for inline rating
 */
function StarRating(props: {
  rating?: number | null;
  onRate: (rating: number) => void;
}) {
  const rating = () => props.rating || 0;

  return (
    <div class="flex items-center space-x-1">
      <For each={[1, 2, 3, 4, 5]}>
        {(star) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onRate(star);
            }}
            class={`w-4 h-4 transition-colors ${
              star <= rating()
                ? "text-yellow-400"
                : "text-gray-300 hover:text-yellow-300"
            }`}
            title={`Rate ${star} star${star !== 1 ? "s" : ""}`}
          >
            ★
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds?: number | null): string {
  if (!seconds) return "—";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Format date string to readable format
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}
