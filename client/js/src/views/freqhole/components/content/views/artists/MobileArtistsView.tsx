import { For, Show, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { apiClient } from "../../../../../../lib/api-client";
import { saveScrollStateSecurely } from "../../../../../../lib/navigation";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface MobileArtistsViewProps {
  class?: string;
}

export function MobileArtistsView(props: MobileArtistsViewProps) {
  const navigate = useNavigate();

  // Scroll restoration state
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // Create fetch function for infinite scroll
  const fetchArtists = async (
    page: number
  ): Promise<{ items: ArtistSummary[]; pagination: PaginationMetadata }> => {
    const response = await apiClient.getArtists({
      page,
      page_size: 50,
    });

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

  // Get scroll state from browser history
  const getSavedScrollTop = (): number => {
    const state = history.state;
    return (state && state.scrollTop) || 0;
  };

  // Save scroll state to browser history
  const saveScrollState = () => {
    const element = scrollElement();
    if (element && element.scrollTop > 0) {
      saveScrollStateSecurely("scrollTop", element.scrollTop);
    }
  };

  // Restore scroll position when data loads
  createEffect(() => {
    const element = scrollElement();
    const savedScrollTop = getSavedScrollTop();

    if (element && savedScrollTop > 0 && artists().length > 0) {
      requestAnimationFrame(() => {
        element.scrollTop = savedScrollTop;
      });
    }
  });

  const handleArtistClick = (artist: ArtistSummary) => {
    // Save scroll state before navigating
    saveScrollState();

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
          ref={(el) => {
            infiniteScroll.containerRef(el);
            setScrollElement(el);
          }}
          onScroll={() => {
            // Debounced save of scroll state - like desktop FreqholeInfiniteGrid
            let saveTimer: ReturnType<typeof setTimeout> | undefined;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(saveScrollState, 300);
          }}
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
