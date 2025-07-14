import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
} from "solid-js";
import { useStore, storeActions } from "../../../../store";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useSelection } from "../../../../hooks/useSelection";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { apiClient } from "../../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { Album, Song } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface MobileAlbumsViewProps {
  class?: string;
}

export function MobileAlbumsView(
  props: RouteSectionProps<unknown> & MobileAlbumsViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  const [selectedAlbum, setSelectedAlbum] = createSignal<Album | null>(null);
  const [loadingAlbumTracks, setLoadingAlbumTracks] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"grid" | "detail">("grid");

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds: Set<string>) => {
      console.log(
        `🎵 Album view selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing album view selection via event");
      selection.clearSelection();
    });
  });

  // Create fetch function for infinite scroll
  const fetchAlbums = async (
    page: number
  ): Promise<{ items: Album[]; pagination: PaginationMetadata }> => {
    console.log(`💿 Loading mobile albums page ${page}`);

    const response = await apiClient.getAlbums({
      page,
      page_size: 50,
    });

    console.log(`💿 Loaded ${response.albums.length} mobile albums`, response);

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
      if (!album?.album) return { tracks: [] };

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
        console.log("🎵 Album tracks loaded:", tracks.length);
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
    setViewMode("detail");
    storeActions.selectAlbum(album);
    events.emit("album:selected", { album });
    // Clear selection when switching albums
    selection.clearSelection();
  };

  const handleBackToGrid = () => {
    setViewMode("grid");
    setSelectedAlbum(null);
    // Clear selection when going back to grid
    selection.clearSelection();
  };

  const handlePlayAlbum = () => {
    const tracks = albumTracksResource();
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
  };

  const handleShuffleAlbum = () => {
    const tracks = albumTracksResource();
    if (Array.isArray(tracks) && tracks.length > 0) {
      // Create shuffled copy
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      // Play first shuffled track and replace queue
      if (shuffled[0]) {
        songInteractions.playSong(shuffled[0], true);
      }
      // Add rest of shuffled tracks to queue
      shuffled.slice(1).forEach((song) => {
        songInteractions.queueSong(song);
      });
    }
  };

  const handleAddAlbumToQueue = () => {
    const tracks = albumTracksResource();
    if (Array.isArray(tracks)) {
      tracks.forEach((song) => {
        songInteractions.queueSong(song);
      });
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

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const formatTotalDuration = (durationStr: string | null | undefined) => {
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

  const getAlbumImageUrl = (album: Album) => {
    if (album.album_thumbnail_id) {
      return `${apiClient.getBaseUrl()}/api/blobs/${album.album_thumbnail_id}`;
    }
    return null;
  };

  return (
    <div class={`h-full bg-black text-white ${props.class || ""}`}>
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

          {/* Albums Grid - Scrollable with Infinite Scroll */}
          <div
            class="flex-1 overflow-y-auto px-6 pb-6"
            ref={infiniteScroll.containerRef}
          >
            <Show
              when={!loading() || albums().length > 0}
              fallback={
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  <For each={Array.from({ length: 20 })}>
                    {() => (
                      <div class="animate-pulse">
                        <div class="w-full aspect-square bg-magenta-800/30 rounded-lg mb-3"></div>
                        <div class="h-4 bg-magenta-800/30 rounded mb-2"></div>
                        <div class="h-3 bg-magenta-800/30 rounded w-3/4"></div>
                      </div>
                    )}
                  </For>
                </div>
              }
            >
              <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                <For each={albums()}>
                  {(album) => (
                    <div
                      class="group cursor-pointer transition-all hover:scale-105"
                      onClick={() => handleAlbumClick(album)}
                    >
                      {/* Album Artwork */}
                      <div class="w-full aspect-square bg-magenta-800/30 rounded-lg mb-3 overflow-hidden relative">
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
                            loading="lazy"
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
                              class="w-6 h-6 text-black ml-1"
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
                      <div class="text-gray-300 text-sm truncate">
                        {album.artist || "Unknown Artist"}
                      </div>
                      <div class="text-gray-400 text-xs mt-1">
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
          {/* Sticky Navigation Bar */}
          <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm">
            <div class="flex items-center justify-between p-4">
              <button
                class="flex items-center text-magenta-400 hover:text-magenta-300 transition-colors"
                onClick={handleBackToGrid}
                title="back to all albums"
              >
                <svg
                  class="w-5 h-5"
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
              </button>

              <div class="flex gap-2">
                <button
                  class="w-10 h-10 bg-magenta-600 hover:bg-magenta-500 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handlePlayAlbum}
                  disabled={
                    loadingAlbumTracks() ||
                    !Array.isArray(albumTracksResource()) ||
                    (Array.isArray(albumTracksResource()) &&
                      (albumTracksResource() as Song[]).length === 0)
                  }
                  title="Play Album"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <button
                  class="w-10 h-10 bg-magenta-950/50 hover:bg-magenta-600/30 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleShuffleAlbum}
                  disabled={
                    loadingAlbumTracks() ||
                    !Array.isArray(albumTracksResource()) ||
                    (Array.isArray(albumTracksResource()) &&
                      (albumTracksResource() as Song[]).length === 0)
                  }
                  title="Shuffle"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                  </svg>
                </button>
                <button
                  class="w-10 h-10 bg-magenta-950/50 hover:bg-magenta-600/30 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleAddAlbumToQueue}
                  disabled={
                    loadingAlbumTracks() ||
                    !Array.isArray(albumTracksResource()) ||
                    (Array.isArray(albumTracksResource()) &&
                      (albumTracksResource() as Song[]).length === 0)
                  }
                  title="Add to Queue"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      fill="none"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Scrollable Content */}
          <div class="flex-1 overflow-y-auto">
            {/* Album Info Header */}
            <div class="p-6">
              {/* Album Artwork - Full width on mobile */}
              <div class="w-full max-w-sm mx-auto mb-6">
                <div class="aspect-square bg-magenta-800/30 rounded-lg overflow-hidden">
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
              </div>

              {/* Album Info */}
              <div class="text-center">
                <h1 class="text-3xl font-bold text-white mb-2">
                  {selectedAlbum()?.album || "Unknown Album"}
                </h1>
                <h2 class="text-xl text-magenta-300 mb-4">
                  {selectedAlbum()?.artist || "Unknown Artist"}
                </h2>

                <div class="grid grid-cols-2 gap-4 max-w-sm mx-auto">
                  <div>
                    <div class="text-magenta-400 text-sm mb-1">duration</div>
                    <div class="text-white text-lg font-semibold">
                      {formatTotalDuration(selectedAlbum()?.total_duration)}
                    </div>
                  </div>
                  <div>
                    <div class="text-magenta-400 text-sm mb-1">year</div>
                    <div class="text-white text-lg font-semibold">
                      {selectedAlbum()?.year || "unknown"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Track Listing */}
            <div class="p-6">
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
                          if (
                            e.shiftKey &&
                            selection.lastSelectedIndex() >= 0
                          ) {
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
        </div>
      </Show>
    </div>
  );
}
