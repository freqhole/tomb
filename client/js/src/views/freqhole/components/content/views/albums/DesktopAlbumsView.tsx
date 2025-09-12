import { For, Show, createSignal, createEffect, onMount } from "solid-js";
import { useLocation } from "@solidjs/router";
import { useStore } from "../../../../store";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { apiClient } from "../../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { Album } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface ScrollRestorationState {
  scrollTop: number;
  estimatedIndex: number;
  totalCount: number;
  timestamp: number;
}
import {
  getAlbumImageUrl,
  formatAlbumDuration,
  useAlbumPlayback,
  useAlbumNavigation,
  useAlbumLoader,
  useAlbumScrollPosition,
} from "./albumUtils";

interface DesktopAlbumsViewProps {
  class?: string;
}

export function DesktopAlbumsView(
  props: RouteSectionProps<unknown> & DesktopAlbumsViewProps = {} as any
) {
  const [] = useStore();
  const location = useLocation();

  // Shared utilities
  const { playAlbum } = useAlbumPlayback();
  const { navigateToAlbum } = useAlbumNavigation();
  const { loadAlbumTracks } = useAlbumLoader();
  const {
    saveScrollPosition,
    restoreScrollPosition,
    checkCameFromAlbumDetail,
  } = useAlbumScrollPosition();

  const [containerElement, setContainerElement] =
    createSignal<HTMLElement | null>(null);

  // Router-aware scroll restoration
  const [initialScrollTop, setInitialScrollTop] = createSignal(0);
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // Create fetch function for infinite scroll
  const fetchAlbums = async (
    page: number
  ): Promise<{ items: Album[]; pagination: PaginationMetadata }> => {
    const response = await apiClient.getAlbums({
      page,
      page_size: 50,
    });

    return {
      items: response.albums,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchAlbums, {
    threshold: 200,
    enabled: true,
  });

  // Extract state and actions
  const albums = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;

  // Load saved scroll state from router history
  onMount(() => {
    const routerState = location.state as ScrollRestorationState | undefined;
    if (routerState && routerState.scrollTop) {
      setInitialScrollTop(routerState.scrollTop);
    }
  });

  // Save scroll state disabled to prevent infinite loops

  // Restore scroll position on route change
  createEffect(() => {
    location.pathname; // track route changes

    if (initialScrollTop() > 0) {
      const element = scrollElement();
      if (element && albums().length > 0) {
        element.scrollTop = initialScrollTop();
        setInitialScrollTop(0); // reset after restore
      }
    }
  });

  const handleAlbumClick = (album: Album) => {
    // Save current scroll position before navigating
    saveScrollPosition(containerElement());
    // Navigate to album detail route
    navigateToAlbum(album);
  };

  const handleAlbumPlayFromGrid = async (album: Album) => {
    try {
      const tracks = await loadAlbumTracks(album);
      playAlbum(tracks, album.album || undefined);
    } catch (error) {
      console.error("failed to play album from grid:", error);
    }
  };

  // Effect to restore scroll position when coming back from album detail
  createEffect(() => {
    if (checkCameFromAlbumDetail()) {
      restoreScrollPosition(containerElement());
    }
  });

  return (
    <div
      class={`flex flex-col h-full bg-black text-white ${props.class || ""}`}
    >
      {/* Header */}
      <div class="flex-shrink-0 p-6">
        <h1 class="text-2xl font-semibold text-white mb-2">albums</h1>
        <Show
          when={!loading() && !error()}
          fallback={<p class="text-gray-300 text-sm">loading albums...</p>}
        >
          <p class="text-gray-300 text-sm">{albums().length} albums</p>
        </Show>
      </div>

      {/* Albums Grid - Scrollable with Infinite Scroll */}
      <div
        class="flex-1 overflow-y-auto p-6"
        ref={(el) => {
          infiniteScroll.containerRef(el);
          setContainerElement(el);
          setScrollElement(el);
        }}
      >
        <Show
          when={!loading() || albums().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center">
              <div class="text-magenta-400">loading albums...</div>
            </div>
          }
        >
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
            <For each={albums()}>
              {(album) => (
                <div
                  class="group cursor-pointer"
                  onClick={() => handleAlbumClick(album)}
                >
                  {/* Album Cover */}
                  <div class="aspect-square bg-magenta-800/30 rounded-lg overflow-hidden mb-3 transition-transform group-hover:scale-105 relative">
                    <Show
                      when={getAlbumImageUrl(album.album_thumbnail_id)}
                      fallback={
                        <div class="w-full h-full flex items-center justify-center">
                          <svg
                            class="w-12 h-12 text-magenta-400"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                          </svg>
                        </div>
                      }
                    >
                      <img
                        src={getAlbumImageUrl(album.album_thumbnail_id)!}
                        alt={`${album.album} by ${album.artist}`}
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Show>

                    {/* Hover overlay with play button */}
                    <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        class="w-12 h-12 bg-magenta-600 hover:bg-magenta-500 rounded-full flex items-center justify-center transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAlbumPlayFromGrid(album);
                        }}
                        title="Play Album"
                      >
                        <svg
                          class="w-6 h-6 text-white ml-1"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Album Info */}
                  <div class="text-white font-medium mb-1 truncate group-hover:text-magenta-300 transition-colors">
                    {album.album || "Unknown Album"}
                  </div>
                  <div class="text-magenta-400 text-sm truncate">
                    {album.artist || "Unknown Artist"}
                  </div>
                  <div class="text-magenta-500 text-xs mt-1">
                    {album.year && `${album.year} · `}
                    {album.track_count} track
                    {album.track_count !== 1 ? "s" : ""}
                    {album.total_duration &&
                      ` · ${formatAlbumDuration(album.total_duration)}`}
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Loading indicator */}
          <Show when={loading()}>
            <div class="text-center py-8">
              <div class="text-magenta-400 text-sm">loading more albums...</div>
            </div>
          </Show>

          {/* End of list indicator */}
          <Show
            when={
              infiniteScroll.state.hasMore() === false && albums().length > 0
            }
          >
            <div class="text-center py-8">
              <div class="text-gray-600 text-xs opacity-50">
                — end of albums —
              </div>
            </div>
          </Show>
        </Show>

        {/* Error state */}
        <Show when={error()}>
          <div class="text-center py-8">
            <div class="text-red-400 text-sm mb-2">failed to load albums</div>
            <button
              class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
              onClick={() => infiniteScroll.actions.reset()}
            >
              try again
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
