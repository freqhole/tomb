import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
} from "solid-js";
import { useStore, storeActions } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../services/songInteractions";
import { useSelection } from "../../../hooks/useSelection";
import { apiClient } from "../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { Album, Song } from "../../../../../lib/music/schemas";

interface AlbumGridViewProps {
  class?: string;
}

export function AlbumGridView(
  props: RouteSectionProps<unknown> & AlbumGridViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  const [selectedAlbum, setSelectedAlbum] = createSignal<Album | null>(null);
  const [loadingAlbumTracks, setLoadingAlbumTracks] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"grid" | "detail">("grid");

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds, selectedSongs) => {
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

  // Fetch albums from API
  const [albumsResource] = createResource(async () => {
    console.log("💿 Fetching albums...");
    try {
      const response = await apiClient.getAlbums({ page_size: 100 });
      console.log("💿 Albums loaded:", response.albums.length);
      return response;
    } catch (error) {
      console.error("❌ Failed to load albums:", error);
      return { albums: [], pagination: null };
    }
  });

  // Fetch tracks for selected album
  const [albumTracksResource] = createResource(
    () => selectedAlbum(),
    async (album: Album) => {
      if (!album?.album) return { tracks: [] };

      console.log("🎵 Fetching tracks for album:", album.album);
      setLoadingAlbumTracks(true);

      try {
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
      songInteractions.playSong(tracks[0], true);
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
      songInteractions.playSong(shuffled[0], true);
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
          <div class="flex-shrink-0 p-6">
            <h1 class="text-2xl font-semibold text-white mb-2">albums</h1>
            <Show
              when={!albumsResource.loading}
              fallback={
                <p class="text-magenta-300 text-sm">loading albums...</p>
              }
            >
              <p class="text-magenta-300 text-sm">
                {albumsResource()?.albums?.length || 0} albums
              </p>
            </Show>
          </div>

          {/* Albums Grid - Scrollable */}
          <div class="flex-1 overflow-y-auto px-6 pb-6">
            <Show
              when={!albumsResource.loading}
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
                <For each={albumsResource()?.albums || []}>
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
                              handleAlbumClick(album);
                            }}
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
            </Show>
          </div>
        </div>
      </Show>

      <Show when={viewMode() === "detail" && selectedAlbum()}>
        {/* Detail View */}
        <div class="h-full flex flex-col">
          {/* Header with back button */}
          <div class="flex-shrink-0 p-6 border-b border-magenta-800/30">
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
            <h3 class="text-xl font-semibold text-white mb-4">
              tracks
              <Show when={loadingAlbumTracks()}>
                <span class="text-magenta-400 text-sm ml-2">loading...</span>
              </Show>
            </h3>

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
