/* @jsxImportSource solid-js */
import {
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import {
  InfiniteGrid,
  GridColumn,
} from "../../../components/infinite-data-grid";
import type { AdminSong } from "../../../lib/admin/admin-api.js";
import type { MusicAdminData } from "../../../hooks/music/admin/useMusicAdminData.js";
import type { ApiClient } from "../../../lib/api-client.js";
import {
  ComponentEventRegistry,
  createGlobalKeyboardHandler,
} from "../../../lib/admin/event-registry.js";

export interface AdminDataGridProps {
  musicData: MusicAdminData;
  onSongPlay?: (song: AdminSong) => void;
  onSongEdit?: (song: AdminSong) => void;
  apiClient?: ApiClient;
  className?: string;
  theme?: "light" | "dark";
}

/**
 * main admin data grid component that combines:
 * - generic infinite grid for performance
 * - music-specific data and actions
 * - selection system
 * - keyboard shortcuts
 * - event handling
 */
export function AdminDataGrid(props: AdminDataGridProps) {
  const eventRegistry = new ComponentEventRegistry();
  let gridContainerRef: HTMLDivElement | undefined;

  // grid configuration
  const columns = createMemo((): GridColumn<AdminSong>[] => [
    {
      key: "thumbnail",
      title: "",
      width: 60,
      render: (song: AdminSong) => (
        <div class="w-12 h-12 bg-gray-800 flex items-center justify-center overflow-hidden">
          {song.thumbnail_blob_id ? (
            <img
              src={`${props.apiClient?.getBaseUrl() || ""}/api/blobs/${song.thumbnail_blob_id}`}
              alt="album artwork"
              class="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div class="text-gray-500 text-xs">no art</div>
          )}
        </div>
      ),
    },
    {
      key: "title",
      title: "title",
      width: 250,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="min-w-0">
          <div class="font-medium text-white truncate">{song.title}</div>
          {song.artist && (
            <div class="text-sm text-gray-400 truncate">{song.artist}</div>
          )}
        </div>
      ),
    },
    {
      key: "artist",
      title: "artist",
      width: 200,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="truncate text-gray-300" title={song.artist || ""}>
          {song.artist || "unknown artist"}
        </div>
      ),
    },
    {
      key: "album",
      title: "album",
      width: 200,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="truncate text-gray-300" title={song.album || ""}>
          {song.album || "unknown album"}
        </div>
      ),
    },
    {
      key: "duration",
      title: "duration",
      width: 80,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="text-right tabular-nums text-gray-300">
          {formatDuration(song.duration_seconds)}
        </div>
      ),
    },
    {
      key: "year",
      title: "year",
      width: 80,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="text-center text-gray-300">{song.year || "—"}</div>
      ),
    },
    {
      key: "genre",
      title: "genre",
      width: 150,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="truncate text-gray-300" title={song.genre || ""}>
          {song.genre || "unknown"}
        </div>
      ),
    },
    {
      key: "rating",
      title: "rating",
      width: 100,
      sortable: true,

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
      title: "fav",
      width: 50,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="flex items-center justify-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSongFavorite(song.id);
            }}
            class={`w-6 h-6 border-2 transition-colors ${
              song.is_favorite
                ? "bg-magenta-500 border-magenta-500 text-white"
                : "bg-gray-800 border-gray-600 text-gray-500 hover:border-magenta-400"
            }`}
            title={
              song.is_favorite ? "remove from favorites" : "add to favorites"
            }
          >
            <span class="text-xs">♡</span>
          </button>
        </div>
      ),
    },
    {
      key: "created_at",
      title: "added",
      width: 150,
      sortable: true,

      render: (song: AdminSong) => (
        <div class="text-sm text-gray-400">{formatDate(song.created_at)}</div>
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
            class="px-2 py-1 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            title="play song"
          >
            play
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onSongEdit?.(song);
            }}
            class="px-2 py-1 text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
            title="edit song"
          >
            edit
          </button>
        </div>
      ),
    },
  ]);

  // event handlers
  const handleSort = (field: string, direction: "asc" | "desc" | null) => {
    console.log("admin data grid: handleSort called", { field, direction });

    // Always pass the direction through to useAdminData, even if null
    // useAdminData will handle the null case and reset to default sort
    props.musicData.updateSort(field, direction);

    // Scroll back to top when sorting changes
    if (gridContainerRef) {
      const gridElement = gridContainerRef.querySelector(".grid-container");
      if (gridElement) {
        gridElement.scrollTop = 0;
      }
    }
  };

  const handleRowClick = (
    song: AdminSong,
    _index: number,
    event: MouseEvent
  ) => {
    props.musicData.handleSongClick(song, event);
  };

  // row double click handler

  const handleRowDoubleClick = (song: AdminSong) => {
    props.musicData.handleSongDoubleClick(song);
  };

  const handleScrollNearBottom = () => {
    // load next page if available
    if (props.musicData.hasNextPage()) {
      props.musicData.nextPage();
    }
  };

  // keyboard shortcuts
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

  // helper functions
  const updateSongRating = async (songId: string, rating: number) => {
    try {
      await props.musicData.updateSong(songId, { rating });
      // Use the refresh function that's passed from AdminView (musicSearch.refresh)
      if (props.musicData.refresh) {
        await props.musicData.refresh();
      }
    } catch (error) {
      console.error("failed to update song rating:", error);
    }
  };

  const toggleSongFavorite = async (songId: string) => {
    const song = props.musicData.items().find((s) => s.id === songId);
    if (song) {
      try {
        await props.musicData.updateSong(songId, {
          is_favorite: !song.is_favorite,
        });
        // Use the refresh function that's passed from AdminView (musicSearch.refresh)
        if (props.musicData.refresh) {
          await props.musicData.refresh();
        }
      } catch (error) {
        console.error("failed to toggle song favorite:", error);
      }
    }
  };

  // setup and cleanup
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
      <Show
        when={
          props.musicData.error() && !props.musicData.error()?.includes("404")
        }
      >
        <div class="bg-red-900 border border-red-700 p-4 mb-4">
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
              <h3 class="text-sm font-medium text-red-300">
                error loading songs
              </h3>
              <div class="mt-2 text-sm text-red-400">
                {props.musicData.error()}
              </div>
            </div>
          </div>
        </div>
      </Show>

      <InfiniteGrid<AdminSong>
        data={props.musicData.items()}
        columns={columns()}
        virtualization={{
          rowHeight: 48,
          headerHeight: 40,
        }}
        layout={{
          stickyHeader: true,
          showStatusBar: true,
          allowRowSelection: true,
        }}
        onSort={handleSort}
        onRowClick={handleRowClick}
        onRowDoubleClick={handleRowDoubleClick}
        onScrollNearBottom={handleScrollNearBottom}
        selectedRowIds={props.musicData.selection.selectedIds()}
        sortField={props.musicData.sortField() || undefined}
        sortDirection={props.musicData.sortDirection() || undefined}
        loading={props.musicData.loading()}
        serverTotal={props.musicData.total()}
        hasMore={props.musicData.hasNextPage()}
        getRowId={(song) => song.id}
        className="h-full"
      />

      {/* selection info bar */}
      <Show when={props.musicData.hasSelection()}>
        <div class="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-magenta-600 text-white px-4 py-2 shadow-lg flex items-center space-x-4">
          <span class="text-sm">
            {props.musicData.selection.actions.getSelectedCount()} songs
            selected
          </span>
          <div class="flex items-center space-x-2">
            <button
              onClick={() => props.musicData.toggleFavoriteSelected()}
              class="px-3 py-1 bg-magenta-500 hover:bg-magenta-400 text-xs transition-colors"
            >
              toggle favorite
            </button>
            <button
              onClick={() => props.musicData.selection.actions.clearSelection()}
              class="px-3 py-1 bg-red-600 hover:bg-red-500 text-xs transition-colors"
            >
              clear selection
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

/**
 * star rating component for inline rating
 */
function StarRating(props: {
  rating?: number | null;
  onRate: (rating: number) => void;
}) {
  const [hoveredRating, setHoveredRating] = createSignal<number | null>(null);
  const rating = () => props.rating || 0;

  const getStarClass = (star: number) => {
    const hovered = hoveredRating();
    const activeRating = hovered !== null ? hovered : rating();

    return `w-4 h-4 transition-colors ${
      star <= activeRating
        ? "text-magenta-400"
        : "text-gray-600 hover:text-magenta-300"
    }`;
  };

  return (
    <div
      class="flex items-center space-x-1"
      onMouseLeave={() => setHoveredRating(null)}
    >
      <For each={[1, 2, 3, 4, 5]}>
        {(star) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onRate(star);
            }}
            onMouseEnter={() => setHoveredRating(star)}
            class={getStarClass(star)}
            title={`rate ${star} star${star !== 1 ? "s" : ""}`}
          >
            ★
          </button>
        )}
      </For>
    </div>
  );
}

/**
 * format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds === 0) return "0:00";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * format date string to readable format
 */
function formatDate(dateString: string): string {
  if (!dateString) return "—";

  try {
    // Parse server format: '2025-07-07 0:57:04.743983 +00:00:00'
    // Extract date and time parts manually
    const parts = dateString.split(" ");
    if (parts.length < 2) return "—";

    const datePart = parts[0];
    const timePart = parts[1];

    if (!datePart || !timePart) return "—";

    // Parse date parts
    const dateComponents = datePart.split("-");
    if (dateComponents.length !== 3) return "—";

    const [year, month, day] = dateComponents.map(Number);

    // Parse time parts and fix hour padding
    const timeComponents = timePart.split(":");
    if (timeComponents.length < 3) return "—";

    const hour = parseInt(timeComponents[0] || "0");
    const minute = parseInt(timeComponents[1] || "0");
    const second = parseFloat(timeComponents[2] || "0");

    // Create date object
    const date = new Date(
      year || 0,
      (month || 1) - 1,
      day || 0,
      hour,
      minute,
      second
    );

    if (isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (error) {
    return "—";
  }
}
