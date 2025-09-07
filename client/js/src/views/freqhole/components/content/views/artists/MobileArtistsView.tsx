import { For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { apiClient } from "../../../../../../lib/api-client";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface MobileArtistsViewProps {
  class?: string;
}

export function MobileArtistsView(props: MobileArtistsViewProps) {
  const navigate = useNavigate();

  // Create fetch function for infinite scroll
  const fetchArtists = async (
    page: number
  ): Promise<{ items: ArtistSummary[]; pagination: PaginationMetadata }> => {
    console.log(`🎤 Loading mobile artists page ${page}`);

    const response = await apiClient.getArtists({
      page,
      page_size: 50,
    });

    console.log(
      `🎤 Loaded ${response.artists.length} mobile artists`,
      response
    );

    return {
      items: response.artists,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchArtists, {
    threshold: 200,
    enabled: true,
  });

  // Extract state and actions
  const artists = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;

  const handleArtistClick = (artist: ArtistSummary) => {
    // Navigate to artist detail route
    const encodedArtist = encodeURIComponent(artist.artist);
    navigate(`/artist/${encodedArtist}`);
  };

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      <div class="flex-1 flex flex-col h-full overflow-hidden">
        <div class="p-3">
          <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
          <Show
            when={!loading() && !error()}
            fallback={<p class="text-gray-300 text-sm">loading artists...</p>}
          >
            <p class="text-gray-300 text-sm">{artists().length} artists</p>
          </Show>
        </div>

        <div
          class="flex-1 overflow-y-auto min-h-0"
          ref={infiniteScroll.containerRef}
        >
          <Show
            when={!loading() || artists().length > 0}
            fallback={
              <div class="p-4">
                <div class="text-gray-300">loading artists...</div>
              </div>
            }
          >
            <For each={artists()}>
              {(artist) => (
                <div
                  class="p-4 hover:bg-magenta-600/20 transition-colors cursor-pointer border-b border-gray-800/50"
                  onClick={() => handleArtistClick(artist)}
                >
                  <div class="text-white font-medium mb-1 truncate">
                    {artist.artist}
                  </div>
                  <div class="text-gray-300 text-sm truncate">
                    {artist.song_count} songs · {artist.album_count} albums
                  </div>
                </div>
              )}
            </For>
          </Show>

          <Show when={loading()}>
            <div class="p-4 text-center">
              <div class="text-gray-400">loading more artists...</div>
            </div>
          </Show>

          {/* End of list indicator */}
          <Show
            when={
              infiniteScroll.state.hasMore() === false && artists().length > 0
            }
          >
            <div class="p-4 text-center">
              <div class="text-gray-600 text-xs opacity-50">
                — end of artists —
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
