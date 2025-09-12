import { Show, For, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useAlbums } from "../../../../hooks/useAlbums";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import { saveScrollStateSecurely } from "../../../../../../lib/navigation";
import type { Album } from "../../../../../../lib/music/schemas";

interface DesktopAlbumsViewProps {
  class?: string;
}

// Helper function for getting album image URLs
const getAlbumImageUrl = (albumThumbnailId: string | null) => {
  if (!albumThumbnailId) return null;
  return `${apiClient.getBaseUrl()}/api/blobs/${albumThumbnailId}`;
};

// Format duration helper - total_duration is already a formatted string from server
const formatAlbumDuration = (durationString: string | null) => {
  if (!durationString) return "unknown";
  return durationString;
};

export function DesktopAlbumsView(props: DesktopAlbumsViewProps) {
  const navigate = useNavigate();
  const events = useGlobalEvents();

  // Simple albums data loading with clean scroll restoration
  const albumsHook = useAlbums(apiClient);

  // Scroll restoration state
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

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

    if (element && savedScrollTop > 0 && albumsHook.albums().length > 0) {
      requestAnimationFrame(() => {
        element.scrollTop = savedScrollTop;
      });
    }
  });

  const handleAlbumClick = (album: Album) => {
    storeActions.selectAlbum(album);
    events.emit("album:selected", { album });

    // Navigate to album detail route
    const encodedAlbum = encodeURIComponent(album.album || "unknown");
    const encodedArtist = album.artist
      ? encodeURIComponent(album.artist)
      : "unknown-artist";
    navigate(`/album/${encodedArtist}/${encodedAlbum}`);
  };

  const handleAlbumPlay = async (album: Album, event: MouseEvent) => {
    event.stopPropagation();
    try {
      if (!album.album) {
        console.error("album name is null, cannot play album");
        return;
      }
      const tracks = await apiClient.getAlbumTracks(
        album.album,
        album.artist || undefined
      );
      if (Array.isArray(tracks) && tracks.length > 0) {
        // Play first track and queue the rest
        events.emit("song:play", { song: tracks[0], replaceQueue: true });
        tracks.slice(1).forEach((track) => {
          events.emit("song:queue", { song: track });
        });
      }
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  // Handle scroll for infinite loading and scroll restoration
  const handleScroll = (event: Event) => {
    const target = event.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;
    const buffer = Math.max(50, clientHeight * 0.25);

    // Load more when near bottom
    if (
      scrollTop + clientHeight >= scrollHeight - buffer &&
      !albumsHook.loading()
    ) {
      const currentLength = albumsHook.albums().length;
      const totalCount = albumsHook.totalCount();
      if (currentLength < totalCount) {
        albumsHook.loadMore();
      }
    }

    // Debounced save of scroll state
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScrollState, 300);
  };

  return (
    <div
      class={`flex flex-col h-full bg-black text-white ${props.class || ""}`}
    >
      {/* Header */}
      <div class="flex-shrink-0 p-6">
        <h1 class="text-2xl font-semibold text-white mb-2">albums</h1>
        <Show
          when={!albumsHook.loading() && !albumsHook.error()}
          fallback={<p class="text-gray-300 text-sm">loading albums...</p>}
        >
          <p class="text-gray-300 text-sm">
            {albumsHook.albums().length} of {albumsHook.totalCount()} albums
          </p>
        </Show>
      </div>

      {/* Error State */}
      <Show when={albumsHook.error()}>
        <div class="p-6 text-center">
          <div class="text-red-400 text-sm mb-2">failed to load albums</div>
          <button
            class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
            onClick={() => albumsHook.refresh()}
          >
            try again
          </button>
        </div>
      </Show>

      {/* Albums Grid - Scrollable with Infinite Loading */}
      <Show when={!albumsHook.error()}>
        <div
          ref={setScrollElement}
          class="flex-1 overflow-y-auto p-6"
          onScroll={handleScroll}
        >
          <Show
            when={!albumsHook.loading() || albumsHook.albums().length > 0}
            fallback={
              <div class="flex-1 flex items-center justify-center">
                <div class="text-magenta-400">loading albums...</div>
              </div>
            }
          >
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
              <For each={albumsHook.albums()}>
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
                          onClick={(e) => handleAlbumPlay(album, e)}
                          title="play album"
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
                      {album.album || "unknown album"}
                    </div>
                    <div class="text-magenta-400 text-sm truncate">
                      {album.artist || "unknown artist"}
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
            <Show when={albumsHook.loading()}>
              <div class="text-center py-8">
                <div class="text-magenta-400 text-sm">
                  loading more albums...
                </div>
              </div>
            </Show>

            {/* End of list indicator */}
            <Show
              when={
                albumsHook.albums().length >= albumsHook.totalCount() &&
                albumsHook.albums().length > 0 &&
                !albumsHook.loading()
              }
            >
              <div class="text-center py-8">
                <div class="text-gray-600 text-xs opacity-50">
                  — end of albums —
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
