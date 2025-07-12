import { For, Show, createSignal, createResource } from "solid-js";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { useSelection } from "../../../../hooks/useSelection";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface DesktopArtistsViewProps {
  class?: string;
}

export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `🎵 Desktop artist view selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  events.on("selection:clear", () => {
    console.log("🎵 Clearing desktop artist view selection via event");
    selection.clearSelection();
  });

  // Create fetch function for infinite scroll
  const fetchArtists = async (
    page: number
  ): Promise<{ items: ArtistSummary[]; pagination: PaginationMetadata }> => {
    console.log(`🎤 Loading artists page ${page}`);

    const response = await apiClient.getArtists({
      page,
      page_size: 50,
    });

    console.log(`🎤 Loaded ${response.artists.length} artists`, response);

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

  // Artist detail state
  const [selectedArtist, setSelectedArtist] =
    createSignal<ArtistSummary | null>(null);
  const [loadingArtistSongs, setLoadingArtistSongs] = createSignal(false);

  // Fetch tracks for selected artist
  const [artistSongsResource] = createResource(
    () => selectedArtist(),
    async (artist: ArtistSummary) => {
      if (!artist?.artist) return { songs: [] };

      console.log("🎵 Fetching songs for artist:", artist.artist);
      setLoadingArtistSongs(true);

      try {
        const songs = await apiClient.getArtistSongs(artist.artist);
        console.log("🎵 Artist songs loaded:", songs);
        return songs;
      } catch (error) {
        console.error("❌ Failed to load artist songs:", error);
        return { songs: [] };
      } finally {
        setLoadingArtistSongs(false);
      }
    }
  );

  const handleArtistClick = (artist: ArtistSummary) => {
    setSelectedArtist(artist);
    storeActions.selectArtist(artist);
    events.emit("artist:selected", { artist });
    // Clear selection when switching artists
    selection.clearSelection();
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      events.emit("queue:replace", { songs });
      events.emit("song:play", { song: songs[0], replaceQueue: false });
    }
  };

  const handleShuffle = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      events.emit("queue:replace", { songs: shuffled });
      events.emit("song:play", { song: shuffled[0], replaceQueue: false });
    }
  };

  const handleAddToQueue = () => {
    const songs = artistSongsResource()?.songs || [];
    songs.forEach((song) => {
      songInteractions.queueSong(song);
    });
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const formatGenres = (genres: string[]) => {
    if (!genres || genres.length === 0) return "unknown";
    return genres.slice(0, 3).join(", ");
  };

  return (
    <div
      class={`flex h-full bg-black text-white w-full max-w-full ${props.class || ""}`}
    >
      {/* Left Panel - Artist List */}
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* Header */}
        <div class="flex-shrink-0 p-6">
          <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
          <Show
            when={!loading() && !error()}
            fallback={<p class="text-gray-300 text-sm">loading artists...</p>}
          >
            <p class="text-gray-300 text-sm">{artists().length} artists</p>
          </Show>
        </div>

        {/* Artist List - Scrollable with Infinite Scroll */}
        <div class="flex-1 overflow-y-auto" ref={infiniteScroll.containerRef}>
          <Show
            when={!loading() || artists().length > 0}
            fallback={
              <div class="px-6 py-4">
                <div class="text-gray-300">loading artists...</div>
              </div>
            }
          >
            <For each={artists()}>
              {(artist) => (
                <div
                  class={`px-6 py-4 hover:bg-magenta-600/20 transition-colors cursor-pointer ${
                    selectedArtist()?.artist === artist.artist
                      ? "bg-magenta-600/30"
                      : ""
                  }`}
                  onClick={() => handleArtistClick(artist)}
                >
                  <div class="text-white font-medium mb-1">{artist.artist}</div>
                  <div class="text-gray-300 text-sm">
                    {artist.song_count} songs · {artist.album_count} albums
                  </div>
                </div>
              )}
            </For>

            {/* Loading indicator */}
            <Show when={loading()}>
              <div class="px-6 py-4 text-center">
                <div class="text-magenta-400 text-sm">
                  loading more artists...
                </div>
              </div>
            </Show>

            {/* End of list indicator */}
            <Show
              when={
                infiniteScroll.state.hasMore() === false && artists().length > 0
              }
            >
              <div class="px-6 py-4 text-center">
                <div class="text-gray-600 text-xs opacity-50">
                  — end of artists —
                </div>
              </div>
            </Show>
          </Show>

          {/* Error state */}
          <Show when={error()}>
            <div class="px-6 py-4 text-center">
              <div class="text-red-400 text-sm mb-2">
                failed to load artists
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

      {/* Right Panel - Artist Detail */}
      <div class="flex-1 min-w-0 flex flex-col">
        <Show when={selectedArtist()} fallback={<div class="flex-1"></div>}>
          {/* Sticky Artist Header */}
          <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm border-b border-magenta-800/30 p-6">
            <h2 class="text-3xl font-bold text-white mb-4">
              {selectedArtist()?.artist}
            </h2>

            {/* Artist Info */}
            <div class="grid grid-cols-2 gap-6 mb-8">
              <div class="bg-magenta-950/30 rounded-lg p-4">
                <div class="text-magenta-300 text-sm mb-1">albums</div>
                <div class="text-white text-2xl font-semibold">
                  {selectedArtist()?.album_count || 0}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-4">
                <div class="text-magenta-300 text-sm mb-1">genres</div>
                <div class="text-white text-2xl font-semibold">
                  {formatGenres(selectedArtist()?.genres || [])}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div class="flex space-x-3">
              <button
                class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handlePlayAll}
                disabled={
                  loadingArtistSongs() || !artistSongsResource()?.songs?.length
                }
              >
                play all
              </button>
              <button
                class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleShuffle}
                disabled={
                  loadingArtistSongs() || !artistSongsResource()?.songs?.length
                }
              >
                shuffle
              </button>
              <button
                class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleAddToQueue}
                disabled={
                  loadingArtistSongs() || !artistSongsResource()?.songs?.length
                }
              >
                add to queue
              </button>
            </div>
          </div>

          {/* Scrollable Songs Content */}
          <div class="flex-1 overflow-y-auto p-6">
            {/* Songs */}
            <div>
              <div>
                <h3 class="text-xl font-semibold text-white mb-4">
                  songs
                  <Show when={loadingArtistSongs()}>
                    <span class="text-magenta-400 text-sm ml-2">
                      loading...
                    </span>
                  </Show>
                </h3>

                <Show
                  when={!loadingArtistSongs() && artistSongsResource()?.songs}
                  fallback={
                    <Show when={selectedArtist() && !loadingArtistSongs()}>
                      <div class="text-magenta-400 text-sm">No songs found</div>
                    </Show>
                  }
                >
                  <div class="space-y-1">
                    <For each={artistSongsResource()?.songs || []}>
                      {(song, index) => (
                        <div
                          class={`p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group ${
                            selection.isSelected(song.id)
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
                                artistSongsResource()?.songs || []
                              );
                            } else {
                              selection.handleRowClick(song, index(), e);
                            }
                          }}
                          onDblClick={() =>
                            songInteractions.handleDoubleClick(song)
                          }
                          onMouseDown={(e) =>
                            selection.handleRowMouseDown(song, index(), e)
                          }
                          onContextMenu={(e) => {
                            // If right-clicking on unselected song, select it first
                            if (!selection.isSelected(song.id)) {
                              selection.setSelectedItems(new Set([song.id]));
                              selection.setLastSelectedIndex(index());
                            }

                            const selectedSongs = selection.getSelectedSongs(
                              artistSongsResource()?.songs || []
                            );
                            if (selectedSongs.length > 1) {
                              songInteractions.handleBulkRightClick(
                                e,
                                selectedSongs
                              );
                            } else {
                              songInteractions.handleRightClick(e, song, {
                                hideViewArtist: true,
                              });
                            }
                          }}
                        >
                          <div class="flex items-center min-w-0">
                            <div class="flex-1 min-w-0 pr-3">
                              <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                                {song.title}
                              </div>
                              <div class="text-magenta-400 text-sm truncate">
                                {song.album || "Unknown Album"}
                                {song.duration_seconds && (
                                  <span>
                                    {" "}
                                    · {formatDuration(song.duration_seconds)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                class="p-1 rounded-full hover:bg-magenta-600/30 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  events.emit("song:queue", { song });
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
    </div>
  );
}
