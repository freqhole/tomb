import {
  For,
  Show,
  createSignal,
  createResource,
  createMemo,
  createEffect,
} from "solid-js";
import { useNavigate, useLocation } from "@solidjs/router";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { useSelection } from "../../../../hooks/useSelection";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import type { ArtistSummary, Song } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

// Helper function for getting image URLs
const getImageUrl = (blobId: string | null) => {
  if (!blobId) return null;
  return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
};

interface AlbumGroup {
  album: string;
  albumThumbnailId: string | null;
  songs: Song[];
  totalDuration: number;
}

interface DesktopArtistsViewProps {
  class?: string;
}

export function DesktopArtistsView(props: DesktopArtistsViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
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

  // Group songs by album
  const albumGroups = createMemo((): AlbumGroup[] => {
    const songs = artistSongsResource()?.songs || [];
    const groups = new Map<string, AlbumGroup>();

    songs.forEach((song) => {
      const albumName = song.album || "Unknown Album";

      if (!groups.has(albumName)) {
        groups.set(albumName, {
          album: albumName,
          albumThumbnailId: song.thumbnail_blob_id,
          songs: [],
          totalDuration: 0,
        });
      }

      const group = groups.get(albumName)!;
      group.songs.push(song);
      group.totalDuration += song.duration_seconds || 0;

      // Use the first non-null thumbnail we find for the album
      if (!group.albumThumbnailId && song.thumbnail_blob_id) {
        group.albumThumbnailId = song.thumbnail_blob_id;
      }
    });

    // Sort albums by name and then sort songs within each album by track number
    const sortedGroups = Array.from(groups.values()).sort((a, b) =>
      a.album.localeCompare(b.album)
    );

    sortedGroups.forEach((group) => {
      group.songs.sort((a, b) => {
        if (a.disc_number !== b.disc_number) {
          return (a.disc_number || 1) - (b.disc_number || 1);
        }
        return (a.track_number || 0) - (b.track_number || 0);
      });
    });

    return sortedGroups;
  });

  // Effect to load artist from URL on mount or URL change
  createEffect(() => {
    const hash = location.hash || window.location.hash;
    const path = hash.startsWith("#") ? hash.slice(1) : hash;

    if (path.startsWith("/artist/") && path !== "/artists") {
      const encodedArtistName = path.split("/artist/")[1];
      if (encodedArtistName) {
        const artistName = decodeURIComponent(encodedArtistName);

        // Find the artist in the loaded artists list
        const artist = artists().find((a) => a.artist === artistName);
        if (artist && selectedArtist()?.artist !== artistName) {
          console.log(`🎤 Loading artist from URL: ${artistName}`);
          setSelectedArtist(artist);
          storeActions.selectArtist(artist);
          events.emit("artist:selected", { artist });
          selection.clearSelection();
        }
      }
    }
  });

  const handleArtistClick = (artist: ArtistSummary) => {
    setSelectedArtist(artist);
    storeActions.selectArtist(artist);
    events.emit("artist:selected", { artist });
    // Clear selection when switching artists
    selection.clearSelection();

    // Update URL without navigation to reflect the selected artist (using hash routing)
    const encodedArtist = encodeURIComponent(artist.artist);
    window.history.pushState(null, "", `#/artist/${encodedArtist}`);
  };

  const handleArtistDoubleClick = (artist: ArtistSummary) => {
    // Navigate to standalone artist detail route on double-click
    const encodedArtist = encodeURIComponent(artist.artist);
    navigate(`/artist/${encodedArtist}`);
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      console.log(`🎵 Playing all songs for artist: ${songs.length} songs`);
      // Use songInteractions to properly queue and play all songs
      const firstSong = songs[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true); // Replace queue and start playing
        // Add remaining songs to queue
        songs.slice(1).forEach((song) => {
          songInteractions.queueSong(song);
        });
      }
    }
  };

  const handleShuffle = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      const shuffled = [...songs].sort(() => Math.random() - 0.5);
      console.log(
        `🎵 Shuffling all songs for artist: ${shuffled.length} songs`
      );
      // Use songInteractions to properly queue and play shuffled songs
      const firstSong = shuffled[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true); // Replace queue and start playing
        // Add remaining shuffled songs to queue
        shuffled.slice(1).forEach((song) => {
          songInteractions.queueSong(song);
        });
      }
    }
  };

  const handleAddToQueue = () => {
    const songs = artistSongsResource()?.songs || [];
    songs.forEach((song) => {
      songInteractions.queueSong(song);
    });
  };

  const handlePlayAlbum = (album: AlbumGroup) => {
    if (album.songs.length > 0) {
      console.log(
        `🎵 Playing album: ${album.album} with ${album.songs.length} songs`
      );
      // Use songInteractions to properly queue and play the album
      const firstSong = album.songs[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true); // Replace queue and start playing
        // Add remaining songs to queue
        album.songs.slice(1).forEach((song) => {
          songInteractions.queueSong(song);
        });
      }
    }
  };

  const handleShuffleAlbum = (album: AlbumGroup) => {
    if (album.songs.length > 0) {
      const shuffled = [...album.songs].sort(() => Math.random() - 0.5);
      console.log(
        `🎵 Shuffling album: ${album.album} with ${shuffled.length} songs`
      );
      // Use songInteractions to properly queue and play the shuffled album
      const firstSong = shuffled[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true); // Replace queue and start playing
        // Add remaining shuffled songs to queue
        shuffled.slice(1).forEach((song) => {
          songInteractions.queueSong(song);
        });
      }
    }
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

  const formatAlbumDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
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
                  onDblClick={() => handleArtistDoubleClick(artist)}
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
                <p class="text-lg mb-2">Select an artist to view details</p>
                <p class="text-sm">
                  Click on an artist from the list to see their albums and songs
                </p>
                <p class="text-xs mt-2 text-gray-500">
                  Double-click to open in full-screen view
                </p>
              </div>
            </div>
          }
        >
          {/* Sticky Artist Header */}
          <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm p-6">
            <h2 class="text-3xl font-bold text-white mb-4">
              {selectedArtist()?.artist}
            </h2>

            {/* Artist Info */}
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div class="bg-magenta-950/30 rounded-lg p-3">
                <div class="text-magenta-300 text-sm mb-1">songs</div>
                <div class="text-white text-xl font-semibold">
                  {selectedArtist()?.song_count || 0}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-3">
                <div class="text-magenta-300 text-sm mb-1">albums</div>
                <div class="text-white text-xl font-semibold">
                  {selectedArtist()?.album_count || 0}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-3">
                <div class="text-magenta-300 text-sm mb-1">duration</div>
                <div class="text-white text-xl font-semibold">
                  {formatAlbumDuration(selectedArtist()?.total_duration || 0)}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-3">
                <div class="text-magenta-300 text-sm mb-1">genres</div>
                <div class="text-white text-xl font-semibold">
                  {formatGenres(selectedArtist()?.genres || [])}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div class="flex flex-wrap space-x-3">
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
            <Show when={loadingArtistSongs()}>
              <div class="text-center py-8">
                <div class="text-magenta-400">Loading songs...</div>
              </div>
            </Show>

            <Show
              when={!loadingArtistSongs() && albumGroups().length > 0}
              fallback={
                <Show when={!loadingArtistSongs()}>
                  <div class="text-center py-8">
                    <div class="text-gray-400">No songs found</div>
                  </div>
                </Show>
              }
            >
              <div class="space-y-8">
                <For each={albumGroups()}>
                  {(album) => (
                    <div class="space-y-4">
                      {/* Album Header */}
                      <div class="flex items-center gap-4 p-4 bg-magenta-950/20 rounded-lg">
                        {/* Album Artwork */}
                        <div class="w-16 h-16 bg-magenta-950/50 rounded-lg flex-shrink-0 overflow-hidden">
                          <Show
                            when={album.albumThumbnailId}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center text-magenta-400">
                                <svg
                                  class="w-8 h-8"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                              </div>
                            }
                          >
                            <img
                              src={getImageUrl(album.albumThumbnailId)!}
                              alt={`${album.album} cover`}
                              class="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </Show>
                        </div>

                        {/* Album Info */}
                        <div class="flex-1 min-w-0">
                          <h3 class="text-xl font-semibold text-white mb-1 truncate">
                            {album.album}
                          </h3>
                          <div class="text-gray-300 text-sm">
                            {album.songs.length} tracks ·{" "}
                            {formatAlbumDuration(album.totalDuration)}
                          </div>
                        </div>

                        {/* Album Actions */}
                        <div class="flex gap-2 flex-shrink-0">
                          <button
                            class="p-2 text-magenta-400 hover:text-magenta-300 transition-colors rounded-full hover:bg-magenta-600/20"
                            onClick={() => handlePlayAlbum(album)}
                            title="Play album"
                          >
                            <svg
                              class="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </button>
                          <button
                            class="p-2 text-magenta-400 hover:text-magenta-300 transition-colors rounded-full hover:bg-magenta-600/20"
                            onClick={() => handleShuffleAlbum(album)}
                            title="Shuffle album"
                          >
                            <svg
                              class="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Album Songs */}
                      <div class="space-y-1 pl-4">
                        <For each={album.songs}>
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
                                    album.songs
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
                                  selection.setSelectedItems(
                                    new Set([song.id])
                                  );
                                  selection.setLastSelectedIndex(index());
                                }

                                const selectedSongs =
                                  selection.getSelectedSongs(album.songs);
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
                                <div class="w-8 text-gray-400 text-sm flex-shrink-0 text-center">
                                  {song.track_number || "—"}
                                </div>
                                <div class="flex-1 min-w-0 pr-3 ml-3">
                                  <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                                    {song.title}
                                  </div>
                                  <Show when={song.duration_seconds}>
                                    <div class="text-magenta-400 text-sm">
                                      {formatDuration(song.duration_seconds!)}
                                    </div>
                                  </Show>
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
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
