import { createMemo } from "solid-js";
import { InfiniteGrid } from "../../../../components/infinite-data-grid";
import type { GridColumn } from "../../../../components/infinite-data-grid/types";
import type { Song } from "../../../../lib/music/schemas/song";
import { SongFavoriteHeart, SongStarRatingCompact } from "../ui";
import { FavoriteToggle } from "../../../../components/filters/FavoriteToggle";

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
  onItemDoubleClick?: (item: T) => void;
  onContextMenu?: (event: MouseEvent, item: T) => void;
  sortField?: string | null;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (field: string, direction: "asc" | "desc" | null) => void;
  showHeader?: boolean;
  class?: string;
}

/**
 * freqhole-specific wrapper around infinite data grid
 * provides theme consistency and behavior for main freqhole views
 */
export function FreqholeInfiniteGrid<T = any>(
  props: FreqholeInfiniteGridProps<T>
) {
  // Development warning: detect potential server/client sorting conflicts
  const hasServerSortProps =
    props.sortField !== undefined && props.onSort !== undefined;
  const hasSortableColumns =
    props.renderMode === "songs" || props.renderMode === "songs-mobile";

  if (!hasServerSortProps && hasSortableColumns && props.data?.length > 0) {
    console.warn(
      `FreqholeInfiniteGrid: Using client-side sorting for ${props.renderMode}. ` +
        `If data is pre-sorted by server, pass sortField and onSort props to prevent conflicts.`
    );
  }

  // Desktop song columns - full featured
  const getSongColumns = (selectedItems?: Set<string>): GridColumn<Song>[] => [
    {
      key: "index",
      title: "#",
      width: 60,
      sortable: false,
      headerClassName: "flex justify-center",
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
    {
      key: "user_rating",
      title: (
        <div class="flex justify-center">
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </div>
      ),
      width: 40,
      sortable: true,
      render: (song: Song) => (
        <div class="flex justify-center">
          <SongStarRatingCompact
            song={song}
            size="sm"
            selected={selectedItems?.has(song.id) || false}
          />
        </div>
      ),
    },
    {
      key: "is_favorite",
      title: "",
      width: 40,
      sortable: false,
      renderHeader: () => <FavoriteToggle />,
      render: (song: Song) => (
        <div class="flex justify-center">
          <SongFavoriteHeart song={song} size="sm" />
        </div>
      ),
    },
    {
      key: "tags",
      title: "tags",
      width: 180,
      sortable: true,
      render: (song: Song) => {
        if (!song.tags || song.tags.length === 0) return null;

        // Display up to 5 tags total, flowing across two rows, leaving space for overflow indicator
        const visibleTags = song.tags.slice(0, 5);
        const remainingTags = song.tags.slice(5);

        return (
          <div class="py-1 px-1 h-full flex flex-col justify-center gap-1">
            <div class="flex flex-wrap gap-1 overflow-hidden h-12 content-start">
              {visibleTags.map((tag) => (
                <button
                  class="px-1.5 py-0.5 bg-gray-700 text-gray-300 hover:bg-magenta-600 hover:text-white text-xs transition-colors cursor-pointer truncate max-w-16 flex-shrink-0"
                  data-tag={tag}
                  title={tag}
                  onClick={(e) => {
                    e.stopPropagation();
                    // TODO: future tag filtering functionality
                  }}
                >
                  {tag}
                </button>
              ))}
              {remainingTags.length > 0 && (
                <span
                  class="px-1.5 py-0.5 text-xs text-gray-500 flex-shrink-0"
                  title={remainingTags.join(", ")}
                >
                  +{remainingTags.length}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
  ];

  // Mobile song columns - simplified
  const getMobileSongColumns = (
    selectedItems?: Set<string>
  ): GridColumn<Song>[] => [
    {
      key: "song_info",
      title: "song",
      width: "auto",
      minWidth: 200,
      sortable: false,
      render: (song: Song) => (
        <div class="py-3 pl-2 flex-1 min-w-0">
          <div class="font-medium text-white mb-1 truncate">
            {song.title || "untitled"}
          </div>
          <div class="text-sm text-gray-400 truncate">
            {song.artist || ""}
            {song.album && ` • ${song.album}`}
            {song.duration_seconds &&
              ` • ${formatDuration(song.duration_seconds)}`}
          </div>
        </div>
      ),
    },
    {
      key: "mobile_actions",
      title: "",
      width: 85,
      sortable: false,
      render: (song: Song) => (
        <div
          class="py-3 pr-2 flex items-center justify-end gap-3"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <SongStarRatingCompact
            song={song}
            size="md"
            selected={selectedItems?.has(song.id) || false}
          />
          <SongFavoriteHeart song={song} size="md" />
        </div>
      ),
    },
  ];

  // Artist columns
  const getArtistColumns = (): GridColumn<any>[] => [
    {
      key: "artist",
      title: "artist",
      width: "auto",
      minWidth: 200,
      sortable: true,
      render: (artist: any) => (
        <div class="px-6 py-4 min-w-0 flex-1">
          <div
            class="text-white font-medium mb-1 truncate"
            title={artist.artist}
          >
            {artist.artist}
          </div>
          <div
            class="text-gray-300 text-sm truncate"
            title={`${artist.song_count} songs · ${artist.album_count} albums`}
          >
            {artist.song_count} songs · {artist.album_count} albums
          </div>
        </div>
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

  // Configure columns based on render mode - use createMemo to react to selectedItems changes
  const getColumns = createMemo((): GridColumn<T>[] => {
    switch (props.renderMode) {
      case "songs":
        return getSongColumns(props.selectedItems) as GridColumn<T>[];
      case "songs-mobile":
        return getMobileSongColumns(props.selectedItems) as GridColumn<T>[];
      case "artists":
        return getArtistColumns() as GridColumn<T>[];
      case "albums":
        return getAlbumColumns() as GridColumn<T>[];
      default:
        return [];
    }
  });

  return (
    <div class={`h-full flex flex-col ${props.class || ""}`}>
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
            stickyHeader: props.showHeader !== false,
            showStatusBar: false,
          }}
          className="freqhole-infinite-grid w-full"
          selectedRowIds={props.selectedItems || new Set()}
          onSelectionChange={props.onSelectionChange}
          sortField={props.sortField || undefined}
          sortDirection={props.sortDirection || undefined}
          onSort={props.onSort}
          onRowClick={props.onItemClick}
          onRowDoubleClick={props.onItemDoubleClick}
          onContextMenu={
            props.onContextMenu
              ? (item: T, _index: number, event: MouseEvent) =>
                  props.onContextMenu!(event, item)
              : undefined
          }
          onScrollNearBottom={props.onLoadMore}
          hasMore={props.data.length < (props.totalCount || 0)}
          loading={props.loading || false}
          getRowId={(item: any) =>
            item.id || item.artist || item.name || String(item)
          }
        />
      </div>
    </div>
  );
}
