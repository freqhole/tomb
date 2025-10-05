import { Show, For, createSignal } from "solid-js";
import { useReactiveActions, useSort, useLayout } from "../../../../store";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { GenreArtistRow } from "./GenreArtistRow";
import type {
  GenreStat,
  GenreSearchResponse,
  GenreArtist,
} from "../../../../../../lib/music/schemas/genre";
import type { SortField } from "../../../../../../components/search/SearchSortControls";

interface GenreDetailPanelProps {
  genre: GenreStat;
  genreDetails: GenreSearchResponse | null | undefined;
  loading: boolean;
  error?: any;
}

export function GenreDetailPanel(props: GenreDetailPanelProps) {
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort();
  const [layout] = useLayout();

  // Check if mobile layout
  const isMobile = () =>
    layout.breakpoint === "mobile" || layout.breakpoint === "tablet";

  // State for expand all toggle - default to expanded on desktop, collapsed on mobile
  const [expandAll, setExpandAll] = createSignal(!isMobile());

  // Sort fields for artists within genre
  const sortFields: SortField[] = [
    { value: "artist", label: "name", description: "sort by artist name" },
    {
      value: "song_count",
      label: "songs",
      description: "sort by song count",
    },
    {
      value: "album_count",
      label: "albums",
      description: "sort by album count",
    },
    {
      value: "total_duration",
      label: "duration",
      description: "sort by total duration",
    },
    {
      value: "avg_rating",
      label: "rating",
      description: "sort by average rating",
    },
    {
      value: "favorite_count",
      label: "favorites",
      description: "sort by favorite count",
    },
  ];

  // Set valid default for artist sorting if current sort field is invalid
  const currentSortField = sortState.field;
  const validSortFields = sortFields.map((f) => f.value);
  if (!validSortFields.includes(currentSortField)) {
    // Set to "artist" as default for artist sorting
    reactiveActions.setSort("artist", "asc");
  }

  // Handle sort changes
  const handleSortChange = (
    field: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      // Handle null direction case - use default
      reactiveActions.setSort(field, "asc");
    } else {
      reactiveActions.setSort(field, direction);
    }
  };

  // Format duration helper
  const formatDuration = (seconds: number | string): string => {
    const secs = typeof seconds === "string" ? parseFloat(seconds) : seconds;
    if (isNaN(secs) || secs < 60) {
      return `${Math.floor(secs)}s`;
    }
    if (secs < 3600) {
      const mins = Math.floor(secs / 60);
      const remainSecs = Math.floor(secs % 60);
      return `${mins}:${remainSecs.toString().padStart(2, "0")}`;
    }
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  // Format count helper
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // Get artists data if available
  const artists = (): GenreArtist[] => {
    if (!props.genreDetails || !("artists" in props.genreDetails)) {
      return [];
    }
    return props.genreDetails.artists || [];
  };

  // Get pagination info
  const pagination = () => {
    if (!props.genreDetails) return null;
    if ("artists" in props.genreDetails) {
      return {
        total: props.genreDetails.total,
        page: props.genreDetails.page,
        total_pages: props.genreDetails.total_pages,
        has_next: props.genreDetails.has_next,
        has_prev: props.genreDetails.has_prev,
      };
    }
    if ("albums" in props.genreDetails) {
      return {
        total: props.genreDetails.total,
        page: props.genreDetails.page,
        total_pages: props.genreDetails.total_pages,
        has_next: props.genreDetails.has_next,
        has_prev: props.genreDetails.has_prev,
      };
    }
    return null;
  };

  return (
    <div class="flex-1 flex flex-col h-full">
      {/* Header */}
      <div
        class={`flex-shrink-0 border-b border-gray-800/50 ${isMobile() ? "p-4" : "p-6"}`}
      >
        <div class={`${isMobile() ? "mb-3" : "mb-4"}`}>
          <h2
            class={`font-semibold text-white mb-1 ${isMobile() ? "text-lg" : "text-xl"}`}
          >
            {props.genre.name}
          </h2>
          <div
            class={`flex items-center text-gray-400 ${isMobile() ? "flex-wrap gap-4 text-sm" : "space-x-6 text-sm"}`}
          >
            <span>{formatCount(props.genre.song_count)} songs</span>
            <span>{formatCount(props.genre.artist_count)} artists</span>
            <span>{formatCount(props.genre.album_count)} albums</span>
            <span>{formatDuration(props.genre.total_duration)}</span>
          </div>
        </div>

        <div class="flex-row">
          {/* Controls - Mobile: Stack vertically, Desktop: Right-aligned */}
          <Show when={artists().length > 0}>
            <Show
              when={isMobile()}
              fallback={
                <>
                  {/* Desktop: Right-aligned controls */}
                  <div class="w-full flex justify-end">
                    <SearchSortControls
                      sortBy={sortState.field}
                      sortDirection={sortState.direction}
                      onSortChange={handleSortChange}
                      sortFields={sortFields}
                      directionStyle="arrows"
                      class="flex-shrink-0"
                    />
                  </div>
                  <div class="mt-2 w-full flex justify-end">
                    <button
                      class="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                      onClick={() => setExpandAll(!expandAll())}
                    >
                      {expandAll() ? "collapse all" : "expand all"}
                    </button>
                  </div>
                </>
              }
            >
              {/* Mobile: Full-width stacked controls */}
              <div class="space-y-3">
                <SearchSortControls
                  sortBy={sortState.field}
                  sortDirection={sortState.direction}
                  onSortChange={handleSortChange}
                  sortFields={sortFields}
                  directionStyle="arrows"
                  class="w-full"
                />
                <div class="flex justify-center">
                  <button
                    class="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
                    onClick={() => setExpandAll(!expandAll())}
                  >
                    {expandAll() ? "collapse all" : "expand all"}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto">
        <Show when={props.error}>
          <div class="p-6 text-center">
            <div class="text-red-400 text-sm mb-2">failed to load artists</div>
            <button class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors">
              try again
            </button>
          </div>
        </Show>

        <Show when={props.loading && !props.genreDetails}>
          <div class="p-6 text-center">
            <div class="text-gray-400 text-sm">loading artists...</div>
          </div>
        </Show>

        <Show when={!props.error && !props.loading && props.genreDetails}>
          <div class="divide-y divide-gray-800/50">
            <For
              each={artists()}
              fallback={
                <div class="p-6 text-center text-gray-400">
                  <p class="text-sm">no artists found</p>
                </div>
              }
            >
              {(artist) => (
                <GenreArtistRow
                  artist={artist}
                  genreName={props.genre.name}
                  forceExpanded={expandAll()}
                />
              )}
            </For>
          </div>

          {/* Pagination info */}
          <Show when={pagination()}>
            <div class="p-4 border-t border-gray-800/50 text-center text-xs text-gray-500">
              showing page {pagination()!.page} of {pagination()!.total_pages} (
              {pagination()!.total} total artists)
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
