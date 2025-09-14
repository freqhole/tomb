import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useReactiveActions, useSort } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";
import { FreqholeInfiniteGrid } from "../../../grid";
import { ArtistDetailPanel } from "./ArtistDetailPanel";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { SortField } from "../../../../../../components/search/SearchSortControls";

interface DesktopArtistsViewProps {
  class?: string;
}

export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const navigate = useNavigate();
  const events = useGlobalEvents();

  // Use modern reactive store instead of legacy hook
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort();
  const dataSections = useDataSections();

  // Data access using modern reactive store
  const artists = () => {
    const result = dataSections.artists.data() as
      | { artists: any[]; pagination: any }
      | undefined;
    return result?.artists || [];
  };
  const loading = () => dataSections.artists.loading || false;
  const error = () => dataSections.artists.error;
  const totalCount = () => {
    const result = dataSections.artists.data() as
      | { artists: any[]; pagination: any }
      | undefined;
    if (result?.pagination?.total) {
      return result.pagination.total;
    }
    return artists().length;
  };

  // Sort fields for artists
  const sortFields: SortField[] = [
    { value: "artist", label: "artist", description: "Sort by artist name" },
    {
      value: "song_count",
      label: "songs",
      description: "Sort by song count",
    },
    {
      value: "album_count",
      label: "albums",
      description: "Sort by album count",
    },
    {
      value: "rating",
      label: "rating",
      description: "Sort by average rating",
    },
  ];

  // Set valid default for artists if current sort field is invalid
  const currentSortField = sortState.field;
  const validSortFields = sortFields.map((f) => f.value);
  if (!validSortFields.includes(currentSortField)) {
    // Set to "artist" as default for artists
    reactiveActions.setSort("artist", "asc");
  }

  // Handle sort changes
  const handleSortChange = (field: string, direction: "asc" | "desc") => {
    reactiveActions.setSort(field, direction);
  };

  // Artist selection state
  const [selectedArtist, setSelectedArtist] =
    createSignal<ArtistSummary | null>(null);

  const handleArtistClick = (artist: ArtistSummary) => {
    setSelectedArtist(artist);
    storeActions.selectArtist(artist);
    events.emit("artist:selected", { artist });
    // Don't navigate - just show detail in right panel
  };

  const handleArtistDoubleClick = (artist: ArtistSummary) => {
    // Navigate to standalone artist detail route on double-click
    const encodedArtist = encodeURIComponent(artist.artist);
    navigate(`/artist/${encodedArtist}`);
  };

  return (
    <div
      class={`flex h-full bg-black text-white w-full max-w-full ${props.class || ""}`}
    >
      {/* Left Panel - Artist List with Infinite Grid */}
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* Header */}
        <div class="flex-shrink-0 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
              <Show
                when={dataSections.artists.data() && !error()}
                fallback={
                  <p class="text-gray-300 text-sm">loading artists...</p>
                }
              >
                <p class="text-gray-300 text-sm">
                  {totalCount()} artist{totalCount() !== 1 ? "s" : ""}
                </p>
              </Show>
            </div>
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

        {/* Artist List using FreqholeInfiniteGrid */}
        <div class="flex-1 min-h-0">
          <Show when={error()}>
            <div class="px-6 py-4 text-center">
              <div class="text-red-400 text-sm mb-2">
                failed to load artists
              </div>
              <button
                class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
                onClick={() => reactiveActions.refreshArtists()}
              >
                try again
              </button>
            </div>
          </Show>

          <Show when={!error()}>
            <FreqholeInfiniteGrid
              data={artists()}
              totalCount={totalCount()}
              onLoadMore={reactiveActions.loadMoreArtists}
              renderMode="artists"
              loading={loading()}
              enableSelection={false}
              enableKeyboardShortcuts={false}
              onItemClick={handleArtistClick}
              onItemDoubleClick={handleArtistDoubleClick}
              sortField={sortState.field}
              sortDirection={sortState.direction}
              onSort={handleSortChange}
              showHeader={false}
              selectedItems={new Set()}
              class="h-full"
            />
          </Show>
        </div>
      </div>

      {/* Right Panel - Artist Detail */}
      <Show
        when={selectedArtist()}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-400">
              <svg
                class="w-16 h-16 mx-auto mb-4 opacity-50"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <p class="text-lg mb-2">select an artist to view details</p>
              <p class="text-sm">
                click on an artist from the list to see their albums and songs
              </p>
              <p class="text-xs mt-2 text-gray-500">
                double-click to open in full-screen view
              </p>
            </div>
          </div>
        }
      >
        <ArtistDetailPanel artist={selectedArtist()!} />
      </Show>
    </div>
  );
}
