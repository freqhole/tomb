import { For, Show, createSignal, createResource } from "solid-js";
import { useStore, storeActions } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { apiClient } from "../../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { Album, Song } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface DesktopAlbumsViewProps {
  class?: string;
}

export function DesktopAlbumsView(
  props: RouteSectionProps<unknown> & DesktopAlbumsViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `🎵 Album view selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  const [selectedAlbum, setSelectedAlbum] = createSignal<Album | null>(null);
  const [loadingAlbumTracks, setLoadingAlbumTracks] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"grid" | "detail">("grid");

  // Create fetch function for infinite scroll
  const fetchAlbums = async (
    page: number
  ): Promise<{ items: Album[]; pagination: PaginationMetadata }> => {
    console.log(`💿 Loading albums page ${page}`);

    const response = await apiClient.getAlbums({
      page,
      page_size: 50,
    });

    console.log(`💿 Loaded ${response.albums.length} albums`, response);

    return {
      items: response.albums,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchAlbums, {
    threshold: 200,
    enabled: () => viewMode() === "grid",
  });

  // Extract state and actions
  const albums = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;

  // Fetch tracks for selected album
  const [albumTracksResource] = createResource(
    () => selectedAlbum(),
    async (album: Album) => {
      if (!album?.album) return [];

      console.log("🎵 Fetching tracks for album:", album.album);
      setLoadingAlbumTracks(true);

      try {
        if (!album.album) {
          console.error("❌ Album name is null, cannot load tracks");
          return [];
        }
        const tracks = await apiClient.getAlbumTracks(
          album.album,
          album.artist || undefined
        );
        console.log("🎵 Album tracks loaded:", tracks);
        return tracks;
      } catch (error) {
        console.error("❌ Failed to load album tracks:", error);
        return [];
      } finally {
        setLoadingAlbumTracks(false);
      }
    }
  );

  const handleAlbumClick = (album: Album) => {
    setSelectedAlbum(album);
    storeActions.selectAlbum(album);
    events.emit("album:selected", { album });
    setViewMode("detail");
  };

  const handleBackToGrid = () => {
    setSelectedAlbum(null);
    setViewMode("grid");
    storeActions.selectAlbum(null);
  };

  const getAlbumImageUrl = (album: Album): string | null => {
    if (album.album_thumbnail_id) {
      return `${apiClient.getBaseUrl()}/api/blobs/${album.album_thumbnail_id}`;
    }
    return null;
  };

  const formatTotalDuration = (durationStr: string | null): string => {
    if (!durationStr) return "unknown";
    // Parse "HH:MM:SS" format and convert to readable format
    const parts = durationStr.split(":");
    if (parts.length === 3) {
      const hours = parseInt(parts[0] || "0");
      const minutes = parseInt(parts[1] || "0");
      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${minutes}m`;
    }
    return durationStr;
  };

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const handlePlayAlbum = () => {
    const tracks = albumTracksResource();
    if (Array.isArray(tracks) && tracks.length > 0) {
      events.emit("queue:replace", { songs: tracks });
      events.emit("song:play", { song: tracks[0], replaceQueue: false });
    }
  };

  const handlePlayAlbumFromGrid = async (album: Album) => {
    try {
      console.log("🎵 Playing album from grid:", album.album);
      if (!album.album) {
        console.error("❌ Album name is null, cannot play album");
        return;
      }
      const tracks = await apiClient.getAlbumTracks(
        album.album,
        album.artist || undefined
      );
      if (Array.isArray(tracks) && tracks.length > 0) {
        // Play first track and replace queue
        if (tracks[0]) {
          songInteractions.playSong(tracks[0], true);
        }
        // Add rest of tracks to queue
        tracks.slice(1).forEach((song) => {
          songInteractions.queueSong(song);
        });
      }
    } catch (error) {
      console.error("❌ Failed to play album from grid:", error);
    }
  };

  const handleShuffleAlbum = () => {
    const tracks = albumTracksResource();
    if (Array.isArray(tracks) && tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      events.emit("queue:replace", { songs: shuffled });
      events.emit("song:play", { song: shuffled[0], replaceQueue: false });
    }
  };

  const handleAddAlbumToQueue = () => {
    const tracks = albumTracksResource();
    if (Array.isArray(tracks)) {
      tracks.forEach((track) => {
        songInteractions.queueSong(track);
      });
    }
  };

  return (
    <div
      class={`flex flex-col h-full bg-black text-white ${props.class || ""}`}
    >
      <Show when={viewMode() === "grid"}>
        {/* Grid View */}
        <div class="h-full flex flex-col">
          {/* Header */}
          <div class="flex-shrink-0 p-3">
            <h1 class="text-2xl font-semibold text-white mb-2">albums</h1>
            <Show
              when={!loading() && !error()}
              fallback={
                <p class="text-magenta-300 text-sm">loading albums...</p>
              }
            >
              <p class="text-magenta-300 text-sm">{albums().length} albums</p>
            </Show>
          </div>

          {/* Album Grid - Scrollable with Infinite Scroll */}
          <div
            class="flex-1 overflow-y-auto p-6"
            ref={infiniteScroll.containerRef}
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
                          when={getAlbumImageUrl(album)}
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
                            src={getAlbumImageUrl(album)!}
                            alt={`${album.album} by ${album.artist}`}
                            class="w-full h-full object-cover"
                          />
                        </Show>

                        {/* Hover overlay with play button */}
                        <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button
                            class="w-12 h-12 bg-magenta-600 hover:bg-magenta-500 rounded-full flex items-center justify-center transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayAlbumFromGrid(album);
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
                      </div>
                    </div>
                  )}
                </For>
              </div>

              {/* Loading indicator */}
              <Show when={loading()}>
                <div class="text-center py-8">
                  <div class="text-magenta-400 text-sm">
                    loading more albums...
                  </div>
                </div>
              </Show>

              {/* End of list indicator */}
              <Show
                when={
                  infiniteScroll.state.hasMore() === false &&
                  albums().length > 0
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
                <div class="text-red-400 text-sm mb-2">
                  failed to load albums
                </div>
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
      </Show>

      <Show when={viewMode() === "detail" && selectedAlbum()}>
        {/* Detail View */}
        <div class="h-full flex flex-col">
          {/* Sticky Header with back button */}
          <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm p-6">
            <button
              class="flex items-center text-magenta-400 hover:text-magenta-300 transition-colors mb-4"
              onClick={handleBackToGrid}
            >
              <svg
                class="w-5 h-5 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              back to albums
            </button>

            <div class="flex items-start space-x-6">
              {/* Album Artwork Large */}
              <div class="w-48 h-48 bg-magenta-800/30 rounded-lg overflow-hidden flex-shrink-0">
                <Show
                  when={getAlbumImageUrl(selectedAlbum()!)}
                  fallback={
                    <div class="w-full h-full flex items-center justify-center">
                      <svg
                        class="w-16 h-16 text-magenta-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                      </svg>
                    </div>
                  }
                >
                  <img
                    src={getAlbumImageUrl(selectedAlbum()!)!}
                    alt={`${selectedAlbum()?.album} by ${selectedAlbum()?.artist}`}
                    class="w-full h-full object-cover"
                  />
                </Show>
              </div>

              {/* Album Info */}
              <div class="flex-1">
                <h1 class="text-3xl font-bold text-white mb-2">
                  {selectedAlbum()?.album || "Unknown Album"}
                </h1>
                <h2 class="text-xl text-magenta-300 mb-4">
                  {selectedAlbum()?.artist || "Unknown Artist"}
                </h2>

                <div class="grid grid-cols-3 gap-4 mb-6">
                  <div>
                    <div class="text-magenta-400 text-sm mb-1">tracks</div>
                    <div class="text-white text-lg font-semibold">
                      {selectedAlbum()?.track_count || 0}
                    </div>
                  </div>
                  <div>
                    <div class="text-magenta-400 text-sm mb-1">duration</div>
                    <div class="text-white text-lg font-semibold">
                      {formatTotalDuration(
                        selectedAlbum()?.total_duration || null
                      )}
                    </div>
                  </div>
                  <div>
                    <div class="text-magenta-400 text-sm mb-1">year</div>
                    <div class="text-white text-lg font-semibold">
                      {selectedAlbum()?.year || "unknown"}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div class="flex space-x-3">
                  <button
                    class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handlePlayAlbum}
                    disabled={
                      loadingAlbumTracks() ||
                      !Array.isArray(albumTracksResource()) ||
                      (Array.isArray(albumTracksResource()) &&
                        (albumTracksResource() as Song[]).length === 0)
                    }
                  >
                    play album
                  </button>
                  <button
                    class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleShuffleAlbum}
                    disabled={
                      loadingAlbumTracks() ||
                      !Array.isArray(albumTracksResource()) ||
                      (Array.isArray(albumTracksResource()) &&
                        (albumTracksResource() as Song[]).length === 0)
                    }
                  >
                    shuffle
                  </button>
                  <button
                    class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleAddAlbumToQueue}
                    disabled={
                      loadingAlbumTracks() ||
                      !Array.isArray(albumTracksResource()) ||
                      (Array.isArray(albumTracksResource()) &&
                        (albumTracksResource() as Song[]).length === 0)
                    }
                  >
                    add to queue
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Track Listing */}
          <div class="flex-1 overflow-y-auto p-6">
            <Show when={loadingAlbumTracks()}>
              <h3 class="text-xl font-semibold text-white mb-4">
                <span class="text-magenta-400 text-sm ml-2">loading...</span>
              </h3>
            </Show>

            <Show
              when={
                !loadingAlbumTracks() && Array.isArray(albumTracksResource())
              }
              fallback={
                <Show when={selectedAlbum() && !loadingAlbumTracks()}>
                  <div class="text-magenta-400 text-sm">No tracks found</div>
                </Show>
              }
            >
              <div class="space-y-1">
                <For
                  each={
                    Array.isArray(albumTracksResource())
                      ? (albumTracksResource() as Song[])
                      : []
                  }
                >
                  {(track, index) => (
                    <div
                      class={`flex items-center p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group ${
                        selection.isSelected(track.id)
                          ? "bg-magenta-600/30 border-magenta-400/50"
                          : ""
                      }`}
                      onClick={(e) => {
                        if (e.shiftKey && selection.lastSelectedIndex() >= 0) {
                          selection.selectRange(
                            selection.lastSelectedIndex(),
                            index(),
                            Array.isArray(albumTracksResource())
                              ? (albumTracksResource() as Song[])
                              : []
                          );
                        } else {
                          selection.handleRowClick(track, index(), e);
                        }
                      }}
                      onDblClick={() =>
                        songInteractions.handleDoubleClick(track)
                      }
                      onMouseDown={(e) =>
                        selection.handleRowMouseDown(track, index(), e)
                      }
                      onContextMenu={(e) => {
                        // If right-clicking on unselected song, select it first
                        if (!selection.isSelected(track.id)) {
                          selection.setSelectedItems(new Set([track.id]));
                          selection.setLastSelectedIndex(index());
                        }

                        const selectedSongs = selection.getSelectedSongs(
                          Array.isArray(albumTracksResource())
                            ? (albumTracksResource() as Song[])
                            : []
                        );
                        if (selectedSongs.length > 1) {
                          songInteractions.handleBulkRightClick(
                            e,
                            selectedSongs
                          );
                        } else {
                          songInteractions.handleRightClick(e, track, {
                            hideViewAlbum: true,
                          });
                        }
                      }}
                    >
                      {/* Track Number */}
                      <div class="w-8 text-magenta-400 text-sm flex-shrink-0">
                        {track.track_number || "—"}
                      </div>

                      {/* Track Info */}
                      <div class="flex-1 min-w-0 mx-4">
                        <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                          {track.title}
                        </div>
                        <Show
                          when={
                            track.artist &&
                            track.artist !== selectedAlbum()?.artist
                          }
                        >
                          <div class="text-magenta-400 text-sm truncate">
                            {track.artist}
                          </div>
                        </Show>
                      </div>

                      {/* Duration */}
                      <div class="text-magenta-400 text-sm flex-shrink-0 mr-4">
                        {track.duration_seconds
                          ? formatDuration(track.duration_seconds)
                          : "—"}
                      </div>

                      {/* Actions */}
                      <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          class="p-1 rounded-full hover:bg-magenta-600/30 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            events.emit("song:queue", { song: track });
                          }}
                          title="Add to queue"
                        >
                          <svg
                            class="w-4 h-4 text-magenta-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
