import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
} from "solid-js";
import { storeActions } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../services/songInteractions";
import { useInfiniteScroll } from "../../../hooks/useInfiniteScroll";
import { useSelection } from "../../../hooks/useSelection";
import { MobileSongList } from "./MobileSongList";
import { apiClient } from "../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { ArtistSummary } from "../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../hooks/useInfiniteScroll";

interface ArtistSplitViewProps {
  class?: string;
}

export function ArtistSplitView(
  props: RouteSectionProps<unknown> & ArtistSplitViewProps = {} as any
) {
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  const [selectedArtist, setSelectedArtist] =
    createSignal<ArtistSummary | null>(null);
  const [loadingArtistSongs, setLoadingArtistSongs] = createSignal(false);
  const [mobileView, setMobileView] = createSignal<"artists" | "songs">(
    "artists"
  );

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `🎵 Artist view selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  createEffect(() => {
    events.on("selection:clear", () => {
      console.log("🎵 Clearing artist view selection via event");
      selection.clearSelection();
    });
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

  // Fetch songs for selected artist
  const [artistSongsResource] = createResource(
    () => selectedArtist()?.artist,
    async (artistName: string) => {
      if (!artistName) return { songs: [] };

      console.log("🎵 Fetching songs for artist:", artistName);
      setLoadingArtistSongs(true);

      try {
        const response = await apiClient.getArtistSongs(artistName, {
          page_size: 50,
        });
        console.log("🎵 Artist songs loaded:", response.songs.length);
        return response;
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
    // Switch to songs view on mobile
    setMobileView("songs");
  };

  const handleBackToArtists = () => {
    setSelectedArtist(null);
    setMobileView("artists");
    storeActions.selectArtist(null);
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      // Play first song and replace queue
      if (songs[0]) {
        songInteractions.playSong(songs[0], true);
      }
      // Add rest of songs to queue
      songs.slice(1).forEach((song) => {
        songInteractions.queueSong(song);
      });
    }
  };

  const handleShuffle = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      // Create shuffled copy
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      // Play first shuffled song and replace queue
      if (shuffled[0]) {
        songInteractions.playSong(shuffled[0], true);
      }
      // Add rest of shuffled songs to queue
      shuffled.slice(1).forEach((song) => {
        songInteractions.queueSong(song);
      });
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
      {/* Desktop Layout */}
      <div class="hidden md:flex h-full w-full">
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
          <div
            class="flex-1 overflow-y-auto"
            ref={(el) => {
              // Only assign ref on desktop (when mobile layout is hidden)
              if (el && window.matchMedia("(min-width: 768px)").matches) {
                infiniteScroll.containerRef(el);
              }
            }}
          >
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
                    <div class="text-white font-medium mb-1">
                      {artist.artist}
                    </div>
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
                  infiniteScroll.state.hasMore() === false &&
                  artists().length > 0
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
            <div class="flex-1 overflow-y-auto p-6">
              <h2 class="text-3xl font-bold text-white mb-4">
                {selectedArtist()?.artist}
              </h2>

              {/* Artist Info */}
              <div class="grid grid-cols-3 gap-6 mb-8">
                <div class="bg-magenta-950/30 rounded-lg p-4">
                  <div class="text-magenta-300 text-sm mb-1">songs</div>
                  <div class="text-white text-2xl font-semibold">
                    {selectedArtist()?.song_count || 0}
                  </div>
                </div>
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
              <div class="flex space-x-3 mb-8">
                <button
                  class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handlePlayAll}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
                  }
                >
                  play all
                </button>
                <button
                  class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleShuffle}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
                  }
                >
                  shuffle
                </button>
                <button
                  class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleAddToQueue}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
                  }
                >
                  add to queue
                </button>
              </div>

              {/* Songs */}
              <div class="space-y-6">
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
                        <div class="text-magenta-400 text-sm">
                          No songs found
                        </div>
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

      {/* Mobile Layout */}
      <div class="md:hidden h-full flex flex-col w-full max-w-full">
        {/* Mobile Artists List */}
        <Show when={mobileView() === "artists"}>
          <div class="flex-1 flex flex-col">
            <div class="p-4 border-b border-magenta-800/30">
              <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
              <Show
                when={!loading() && !error()}
                fallback={
                  <p class="text-gray-300 text-sm">loading artists...</p>
                }
              >
                <p class="text-gray-300 text-sm">{artists().length} artists</p>
              </Show>
            </div>

            <div
              class="flex-1 overflow-y-auto"
              ref={(el) => {
                // Only assign ref on mobile when in artists view
                if (el && mobileView() === "artists") {
                  infiniteScroll.containerRef(el);
                }
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
                  infiniteScroll.state.hasMore() === false &&
                  artists().length > 0
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
        </Show>

        {/* Mobile Artist Songs */}
        <Show when={mobileView() === "songs" && selectedArtist()}>
          <div class="flex-1 flex flex-col">
            <div class="p-4 border-b border-magenta-800/30">
              <div class="flex items-center gap-3 mb-2">
                <button
                  class="p-1 text-gray-400 hover:text-white transition-colors flex-shrink-0"
                  onClick={handleBackToArtists}
                  title="Back to artists"
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
                <h2 class="text-xl font-semibold text-white min-w-0 truncate">
                  {selectedArtist()?.artist}
                </h2>
              </div>
              <p class="text-gray-300 text-sm truncate">
                {selectedArtist()?.song_count} songs ·{" "}
                {selectedArtist()?.album_count} albums
              </p>

              {/* Mobile Action Buttons */}
              <div class="flex gap-2 mt-3">
                <button
                  class="w-10 h-10 bg-magenta-600 hover:bg-magenta-500 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handlePlayAll}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
                  }
                  title="Play All"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <button
                  class="w-10 h-10 bg-magenta-950/50 hover:bg-magenta-600/30 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleShuffle}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
                  }
                  title="Shuffle"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                  </svg>
                </button>
                <button
                  class="w-10 h-10 bg-magenta-950/50 hover:bg-magenta-600/30 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleAddToQueue}
                  disabled={
                    loadingArtistSongs() ||
                    !artistSongsResource()?.songs?.length
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

            <div class="flex-1 overflow-y-auto">
              <Show
                when={
                  !loadingArtistSongs() &&
                  artistSongsResource()?.songs &&
                  artistSongsResource()!.songs!.length > 0
                }
                fallback={
                  <div class="p-4">
                    <div class="text-gray-300">
                      {loadingArtistSongs()
                        ? "loading songs..."
                        : "no songs found"}
                    </div>
                  </div>
                }
              >
                <MobileSongList
                  songs={artistSongsResource()?.songs || []}
                  loading={loadingArtistSongs()}
                  hasMore={false}
                  class="px-4"
                />
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
