import { InfiniteGrid } from "../../../../components/infinite-data-grid";
import type { GridColumn } from "../../../../components/infinite-data-grid/types";
import type { Song } from "../../../../lib/music/schemas/song";
import { SongStarRating } from "../ui";

export interface FreqholeInfiniteGridProps<T = any> {
  data: T[];
  totalCount?: number;
  onLoadMore: () => Promise<void>;
  renderMode: "songs" | "songs-mobile" | "artists" | "albums";
  loading?: boolean;
  error?: string | null;
  enableSelection?: boolean;
  enableKeyboardShortcuts?: boolean;
  selectedItems?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  onItemClick?: (item: T) => void;
  onContextMenu?: (event: MouseEvent, item: T) => void;
  sortField?: string | null;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (field: string) => void;
  class?: string;
}

/**
 * freqhole-specific wrapper around infinite data grid
 * provides theme consistency and behavior for main freqhole views
 */
export function FreqholeInfiniteGrid<T = any>(
  props: FreqholeInfiniteGridProps<T>
) {
  // Configure columns based on render mode
  const getColumns = (): GridColumn<T>[] => {
    switch (props.renderMode) {
      case "songs":
        return getSongColumns() as GridColumn<T>[];
      case "songs-mobile":
        return getMobileSongColumns() as GridColumn<T>[];
      case "artists":
        return getArtistColumns() as GridColumn<T>[];
      case "albums":
        return getAlbumColumns() as GridColumn<T>[];
      default:
        return [];
    }
  };

  // Desktop song columns - full featured
  const getSongColumns = (): GridColumn<Song>[] => [
    {
      key: "index",
      title: "#",
      width: 60,
      sortable: false,
      render: (_song, index) => (
        <div class="flex items-center justify-center text-gray-400 text-sm">
          {(index || 0) + 1}
        </div>
      ),
    },
    {
      key: "title",
      title: "title",
      width: "auto",
      minWidth: 200,
      sortable: true,
      render: (song: Song) => (
        <div class="font-medium text-white truncate">
          {song.title || "untitled"}
        </div>
      ),
    },
    {
      key: "artist",
      title: "artist",
      width: 150,
      sortable: true,
      render: (song: Song) => (
        <div class="text-gray-300 truncate">{song.artist || ""}</div>
      ),
    },
    {
      key: "album",
      title: "album",
      width: 150,
      sortable: true,
      render: (song: Song) => (
        <div class="text-gray-300 truncate">{song.album || ""}</div>
      ),
    },
    {
      key: "year",
      title: "year",
      width: 80,
      sortable: true,
      render: (song: Song) => (
        <div class="text-center text-gray-400 text-sm">{song.year || "—"}</div>
      ),
    },
    {
      key: "user_rating",
      title: "rating",
      width: 120,
      sortable: true,
      render: (song: Song) => (
        <div class="flex justify-center">
          <SongStarRating
            song={song}
            size="sm"
            class="[&_.group:hover_.text-magenta-400]:text-black [&_.group:hover_.text-magenta-300]:text-gray-600"
          />
        </div>
      ),
    },
    {
      key: "duration_seconds",
      title: "time",
      width: 80,
      sortable: true,
      render: (song: Song) => (
        <div class="text-center text-gray-400 text-sm">
          {song.duration_seconds ? formatDuration(song.duration_seconds) : "—"}
        </div>
      ),
    },
  ];

  // Mobile song columns - simplified
  const getMobileSongColumns = (): GridColumn<Song>[] => [
    {
      key: "song_info",
      title: "song",
      width: "100%",
      sortable: false,
      render: (song: Song) => (
        <div class="py-3 px-4">
          <div class="font-medium text-white mb-1">
            {song.title || "untitled"}
          </div>
          <div class="text-sm text-gray-400">
            {song.artist || ""}
            {song.album && ` • ${song.album}`}
          </div>
        </div>
      ),
    },
  ];

  // Artist columns
  const getArtistColumns = (): GridColumn<any>[] => [
    {
      key: "name",
      title: "artist",
      width: "1fr",
      sortable: true,
      render: (artist: any) => (
        <div class="font-medium text-white">{artist.name}</div>
      ),
    },
    {
      key: "song_count",
      title: "songs",
      width: 100,
      sortable: true,
      render: (artist: any) => (
        <div class="text-center text-gray-400">{artist.song_count || 0}</div>
      ),
    },
  ];

  // Album columns - grid cards
  const getAlbumColumns = (): GridColumn<any>[] => [
    {
      key: "album_card",
      title: "albums",
      width: 200,
      sortable: false,
      render: (album: any) => (
        <div class="p-4 hover:bg-gray-800/50 rounded transition-colors">
          <div class="aspect-square bg-gray-700 rounded mb-3 flex items-center justify-center">
            <div class="text-4xl text-gray-500">♪</div>
          </div>
          <div class="font-medium text-white text-sm mb-1 truncate">
            {album.album || "untitled"}
          </div>
          <div class="text-xs text-gray-400 truncate">
            {album.artist || "unknown artist"}
          </div>
          <div class="text-xs text-gray-500 mt-1">
            {album.track_count || 0} track{album.track_count !== 1 ? "s" : ""}
          </div>
        </div>
      ),
    },
  ];

  // Format duration helper
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Determine if we should show the status bar
  const showStatusBar = () => {
    return props.totalCount !== undefined && props.totalCount > 0;
  };

  // Get status bar text
  const getStatusText = () => {
    if (props.loading && props.data.length === 0) {
      return "loading...";
    }
    if (props.error) {
      return `error: ${props.error}`;
    }
    if (props.totalCount !== undefined) {
      const loaded = props.data.length;
      const total = props.totalCount;
      if (loaded < total) {
        return `showing ${loaded} of ${total}`;
      } else {
        return `${total} total`;
      }
    }
    return `${props.data.length} items`;
  };

  return (
    <div class={`h-full flex flex-col ${props.class || ""}`}>
      {/* Status bar */}
      {showStatusBar() && (
        <div class="flex-shrink-0 px-6 py-2 text-sm text-gray-400 border-b border-gray-800">
          {getStatusText()}
        </div>
      )}

      {/* Grid */}
      <div class="flex-1 min-h-0">
        <InfiniteGrid
          data={props.data}
          columns={getColumns()}
          virtualization={{
            rowHeight: props.renderMode === "songs-mobile" ? 80 : 64,
            headerHeight: 40,
          }}
          layout={{
            stickyHeader: true,
            showStatusBar: false, // We handle our own status bar above
          }}
          className="freqhole-infinite-grid w-full"
          selectedRowIds={props.selectedItems || new Set()}
          onSelectionChange={props.onSelectionChange}
          sortField={props.sortField || undefined}
          sortDirection={props.sortDirection || undefined}
          onSort={props.onSort}
          onRowClick={props.onItemClick}
          onContextMenu={
            props.onContextMenu
              ? (item: T, _index: number, event: MouseEvent) =>
                  props.onContextMenu!(event, item)
              : undefined
          }
          onScrollNearBottom={props.onLoadMore}
          hasMore={props.data.length < (props.totalCount || 0)}
          loading={props.loading || false}
          getRowId={(item: any) => item.id || item.name || String(item)}
        />
      </div>
    </div>
  );
}
