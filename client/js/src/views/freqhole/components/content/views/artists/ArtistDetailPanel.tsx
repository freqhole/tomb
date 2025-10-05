import { createResource, Show, For } from "solid-js";
import { useSongInteractions } from "../../../../services/songInteractions";
import { useAuth } from "../../../../../../hooks/auth";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { isMobile } from "../../../../../../lib/format-utils";
import { apiClient } from "../../../../../../lib/api-client";
import type { ArtistSummary, Song } from "../../../../../../lib/music/schemas";

interface AlbumGroup {
  album: string;
  albumThumbnailId: string | null;
  songs: Song[];
  totalDuration: number;
}

interface ArtistDetailPanelProps {
  artist: ArtistSummary;
}

// Helper function for getting image URLs
const getImageUrl = (blobId: string | null) => {
  if (!blobId) return null;
  return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
};

export function ArtistDetailPanel(props: ArtistDetailPanelProps) {
  const songInteractions = useSongInteractions();
  const auth = useAuth();
  const events = useGlobalEvents();

  // Fetch tracks for selected artist
  const [artistSongsResource] = createResource(
    () => props.artist,
    async (artist: ArtistSummary) => {
      if (!artist?.artist) return { songs: [] };

      try {
        const songs = await apiClient.getArtistSongs(artist.artist, {
          limit: 1000,
        });
        return songs;
      } catch (error) {
        console.error("failed to load artist songs:", error);
        return { songs: [] };
      }
    }
  );

  // Group songs by album
  const albumGroups = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length === 0) return [];

    const albumMap = new Map<string, AlbumGroup>();

    songs.forEach((song) => {
      const albumName = song.album || "unknown album";
      if (!albumMap.has(albumName)) {
        albumMap.set(albumName, {
          album: albumName,
          albumThumbnailId: song.thumbnail_blob_id,
          songs: [],
          totalDuration: 0,
        });
      }
      const group = albumMap.get(albumName)!;
      group.songs.push(song);
      group.totalDuration += song.duration_seconds || 0;

      // Use the first non-null thumbnail we find for the album
      if (!group.albumThumbnailId && song.thumbnail_blob_id) {
        group.albumThumbnailId = song.thumbnail_blob_id;
      }
    });

    // Sort albums by name and then sort songs within each album by track number
    const sortedGroups = Array.from(albumMap.values()).sort((a, b) =>
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
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatAlbumDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatGenres = (genres: string[]) => {
    if (!genres || genres.length === 0) return "unknown";
    return genres.slice(0, 3).join(", ");
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
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

      const firstSong = shuffled[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true); // Replace queue and start playing
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
      const firstSong = album.songs[0];
      if (firstSong) {
        songInteractions.playSong(firstSong, true);
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
      artist: props.artist.artist,
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

  const loading = () => artistSongsResource.loading;

  return (
    <div class="flex-1 min-w-0 flex flex-col">
      {/* Sticky Artist Header */}
      <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm p-6">
        <h2 class="text-3xl font-bold text-white mb-4">
          {props.artist.artist}
        </h2>

        {/* Artist Info */}
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div class="bg-magenta-950/30 rounded-lg p-3">
            <div class="text-magenta-300 text-sm mb-1">songs</div>
            <div class="text-white text-xl font-semibold">
              {props.artist.song_count || 0}
            </div>
          </div>
          <div class="bg-magenta-950/30 rounded-lg p-3">
            <div class="text-magenta-300 text-sm mb-1">albums</div>
            <div class="text-white text-xl font-semibold">
              {props.artist.album_count || 0}
            </div>
          </div>
          <div class="bg-magenta-950/30 rounded-lg p-3">
            <div class="text-magenta-300 text-sm mb-1">duration</div>
            <div class="text-white text-xl font-semibold">
              {formatAlbumDuration(props.artist.total_duration || 0)}
            </div>
          </div>
          <Show when={props.artist.avg_rating !== null}>
            <div class="bg-magenta-950/30 rounded-lg p-3">
              <div class="text-magenta-300 text-sm mb-1">avg rating</div>
              <div class="text-white text-xl font-semibold">
                {props.artist.avg_rating!.toFixed(1)}
              </div>
            </div>
          </Show>
          <Show when={props.artist.genres && props.artist.genres.length > 0}>
            <div class="bg-magenta-950/30 rounded-lg p-3">
              <div class="text-magenta-300 text-sm mb-1">genres</div>
              <div class="text-white text-xl font-semibold">
                {formatGenres(props.artist.genres)}
              </div>
            </div>
          </Show>
        </div>

        {/* Quick Actions */}
        <div class="flex flex-wrap space-x-3">
          <button
            class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePlayAll}
            disabled={loading() || !artistSongsResource()?.songs?.length}
          >
            play all
          </button>
          <button
            class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleShuffle}
            disabled={loading() || !artistSongsResource()?.songs?.length}
          >
            shuffle
          </button>
          <button
            class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleAddToQueue}
            disabled={loading() || !artistSongsResource()?.songs?.length}
          >
            add to queue
          </button>
        </div>
      </div>

      {/* Scrollable Songs Content */}
      <div class="flex-1 overflow-y-auto p-6">
        <Show when={loading()}>
          <div class="text-center py-8">
            <div class="text-magenta-400">loading songs...</div>
          </div>
        </Show>

        <Show
          when={!loading() && albumGroups().length > 0}
          fallback={
            <Show when={!loading()}>
              <div class="text-center py-8">
                <div class="text-gray-400">no songs found</div>
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
                    onContextMenu={(e) => handleAlbumGroupRightClick(e, album)}
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
                        title="play album"
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
                      {(song) => (
                        <div
                          class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group"
                          onClick={() => songInteractions.playSong(song)}
                          onDblClick={() =>
                            songInteractions.handleDoubleClick(song)
                          }
                          onContextMenu={(e) => {
                            songInteractions.handleRightClick(e, song, {
                              hideViewArtist: true,
                            });
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
  );
}
