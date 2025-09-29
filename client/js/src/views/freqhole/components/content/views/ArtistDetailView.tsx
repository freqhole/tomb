import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
  createMemo,
} from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { useSelection } from "../../../hooks/useSelection";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../services/songInteractions";
import { useAuth } from "../../../../../hooks/auth";
import { isMobile } from "../../../../../lib/format-utils";
import { apiClient } from "../../../../../lib/api-client";
import { storeActions } from "../../../store";
import type { RouteSectionProps } from "@solidjs/router";
import type { Song } from "../../../../../lib/music/schemas";

// Helper function for getting image URLs
const getImageUrl = (blobId: string | null) => {
  if (!blobId) return null;
  return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
};

interface ArtistDetailViewProps {
  class?: string;
}

interface AlbumGroup {
  album: string;
  albumThumbnailId: string | null;
  songs: Song[];
  totalDuration: number;
}

export function ArtistDetailView(
  props: RouteSectionProps<unknown> & ArtistDetailViewProps = {} as any
) {
  const params = useParams();

  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();
  const auth = useAuth();

  const [loadingArtistSongs, setLoadingArtistSongs] = createSignal(false);

  // Selection state
  const selection = useSelection({
    onSelectionChange: (selectedIds) => {
      console.log(
        `#TODO artist detail view selection changed: ${selectedIds.size} songs selected`
      );
    },
  });

  // Listen for selection clear events
  events.on("selection:clear", () => {
    selection.clearSelection();
  });

  // Get artist info from params
  const artistName = () => {
    const name = params.id;
    return name ? decodeURIComponent(name) : null;
  };

  // Fetch artist summary info
  const [artistSummaryResource] = createResource(
    () => artistName(),
    async (name: string) => {
      if (!name) return null;

      try {
        // We'll need to get this from the artists list or create a separate endpoint
        const response = await apiClient.getArtists({
          page: 1,
          page_size: 1000,
        });
        const artist = response.artists.find((a) => a.artist === name);
        return artist || null;
      } catch (error) {
        console.error("failed to load artist summary:", error);
        return null;
      }
    }
  );

  // Fetch tracks for the artist
  const [artistSongsResource] = createResource(
    () => artistName(),
    async (name: string) => {
      if (!name) return { songs: [] };

      setLoadingArtistSongs(true);

      try {
        const songs = await apiClient.getArtistSongs(name);
        return songs;
      } catch (error) {
        console.error("failed to load artist songs:", error);
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

  const navigate = useNavigate();

  const handleBack = () => {
    navigate(-1);
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
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
    songInteractions.smartQueueSongs(songs);
  };

  const handlePlayAlbum = (album: AlbumGroup) => {
    if (album.songs.length > 0) {
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

  const handleAddAlbumToQueue = (album: AlbumGroup) => {
    songInteractions.smartQueueSongs(album.songs);
  };

  const handleEditAlbum = (album: AlbumGroup) => {
    if (album.songs.length > 0) {
      events.emit("modal:open", {
        modal: "songInfoModal",
        data: { songs: album.songs },
      });
    }
  };

  const handleAlbumGroupRightClick = async (
    event: MouseEvent,
    album: AlbumGroup
  ) => {
    event.preventDefault();

    // Create a mock Album object for the context menu
    const albumObj = {
      album: album.album,
      artist: artistName(),
      album_thumbnail_id: album.albumThumbnailId,
      track_count: album.songs.length,
      disc_count: 1,
      total_duration: null,
      genres: null,
      avg_rating: null,
      favorite_count: 0,
      year: null,
    };

    await songInteractions.handleAlbumRightClick(event, albumObj);
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const formatAlbumDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  // Update store and emit events when artist changes
  createEffect(() => {
    const artist = artistSummaryResource();
    if (artist) {
      storeActions.selectArtist(artist);
      events.emit("artist:selected", { artist });
    }
  });

  return (
    <div
      class={`flex flex-col h-full bg-black text-white w-full max-w-full ${props.class || ""}`}
    >
      <Show
        when={artistName()}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-gray-400">No artist selected</div>
          </div>
        }
      >
        {/* Minimal Sticky Header - Back Button + Title Only */}
        <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm px-4 py-3 border-b border-magenta-800/30">
          <div class="flex items-center gap-3">
            <button
              class="p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-magenta-600/20"
              onClick={handleBack}
              title="Back"
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
            <h1 class="text-xl font-bold text-white truncate">
              {artistName()}
            </h1>
          </div>
        </div>

        {/* Scrollable Content */}
        <div class="flex-1 overflow-y-auto">
          {/* Artist Stats - Scrollable */}
          <Show when={artistSummaryResource()}>
            {(artist) => (
              <div class="p-6">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">songs</div>
                    <div class="text-white text-xl font-semibold">
                      {artist().song_count || 0}
                    </div>
                  </div>
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">albums</div>
                    <div class="text-white text-xl font-semibold">
                      {artist().album_count || 0}
                    </div>
                  </div>
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">avg rating</div>
                    <div class="text-white text-xl font-semibold">
                      {artist().avg_rating
                        ? artist().avg_rating!.toFixed(1)
                        : "—"}
                    </div>
                  </div>
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">duration</div>
                    <div class="text-white text-xl font-semibold">
                      {artist().total_duration || "—"}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div class="flex flex-wrap gap-3 mb-6">
                  <button
                    class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handlePlayAll}
                    disabled={
                      loadingArtistSongs() ||
                      !artistSongsResource()?.songs?.length
                    }
                  >
                    <span class="hidden md:inline">play all</span>
                    <span class="md:hidden">play</span>
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
                    <span class="hidden md:inline">add to queue</span>
                    <span class="md:hidden">queue</span>
                  </button>
                </div>
              </div>
            )}
          </Show>

          {/* Artist Songs List */}
          <div class="px-6 pb-6">
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
                      <div
                        class="flex items-center gap-4 p-4 bg-magenta-950/20 rounded-lg cursor-pointer hover:bg-magenta-950/30 transition-colors"
                        onContextMenu={(e) =>
                          handleAlbumGroupRightClick(e, album)
                        }
                      >
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
                            onClick={() => handleAddAlbumToQueue(album)}
                            title="Add album to queue"
                          >
                            <svg
                              class="w-5 h-5"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
                              <circle
                                cx="12"
                                cy="12"
                                r="1"
                                fill="currentColor"
                                opacity="0.6"
                              />
                              <path
                                d="M12 8v8M8 12h8"
                                stroke="currentColor"
                                stroke-width="1.5"
                                opacity="0.8"
                              />
                            </svg>
                          </button>
                          <Show when={auth.isAdmin}>
                            <button
                              class="p-2 text-magenta-400 hover:text-magenta-300 transition-colors rounded-full hover:bg-magenta-600/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditAlbum(album);
                              }}
                              title="Edit album"
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
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                          </Show>
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
                                <div
                                  class={`flex items-center space-x-2 ${isMobile() ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity flex-shrink-0`}
                                >
                                  <button
                                    class="p-1 rounded-full hover:bg-magenta-600/30 transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      songInteractions.smartQueueSong(song);
                                    }}
                                    title="Add to queue"
                                  >
                                    <svg
                                      class="w-4 h-4 text-magenta-400"
                                      fill="currentColor"
                                      viewBox="0 0 24 24"
                                    >
                                      <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
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
        </div>
      </Show>
    </div>
  );
}
