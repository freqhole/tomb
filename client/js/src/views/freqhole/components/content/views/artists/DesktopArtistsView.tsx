import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useArtists } from "../../../../hooks/useArtists";
import { FreqholeInfiniteGrid } from "../../../grid";
import { ArtistDetailPanel } from "./ArtistDetailPanel";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";

interface DesktopArtistsViewProps {
  class?: string;
}

export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const navigate = useNavigate();
  const events = useGlobalEvents();

  // Simple artists data loading
  const artistsHook = useArtists(apiClient);

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
          <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
          <Show
            when={!artistsHook.loading() && !artistsHook.error()}
            fallback={<p class="text-gray-300 text-sm">loading artists...</p>}
          >
            <p class="text-gray-300 text-sm">
              {artistsHook.totalCount()} artist
              {artistsHook.totalCount() !== 1 ? "s" : ""}
            </p>
          </Show>
        </div>

        {/* Artist List using FreqholeInfiniteGrid */}
        <div class="flex-1 min-h-0">
          <Show when={artistsHook.error()}>
            <div class="px-6 py-4 text-center">
              <div class="text-red-400 text-sm mb-2">
                failed to load artists
              </div>
              <button
                class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
                onClick={() => artistsHook.refresh()}
              >
                try again
              </button>
            </div>
          </Show>

          <Show when={!artistsHook.error()}>
            <FreqholeInfiniteGrid
              data={artistsHook.artists()}
              totalCount={artistsHook.totalCount()}
              onLoadMore={artistsHook.loadMore}
              renderMode="artists"
              loading={artistsHook.loading()}
              enableSelection={false}
              enableKeyboardShortcuts={false}
              onItemClick={handleArtistClick}
              onItemDoubleClick={handleArtistDoubleClick}
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
