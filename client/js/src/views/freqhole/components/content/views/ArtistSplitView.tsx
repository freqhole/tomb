import { For, Show, createSignal, createResource } from "solid-js";
import { useStore, storeActions } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../services/songInteractions";
import { apiClient } from "../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type { ArtistSummary, Song } from "../../../../../lib/music/schemas";

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

  // Fetch artists from API
  const [artistsResource] = createResource(async () => {
    console.log("🎤 Fetching artists...");
    try {
      const response = await apiClient.getArtists({ page_size: 100 });
      console.log("🎤 Artists loaded:", response.artists.length);
      return response;
    } catch (error) {
      console.error("❌ Failed to load artists:", error);
      return { artists: [], pagination: null };
    }
  });

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
  };

  const handlePlayAll = () => {
    const songs = artistSongsResource()?.songs || [];
    if (songs.length > 0) {
      // Play first song and replace queue
      songInteractions.playSong(songs[0], true);
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
      songInteractions.playSong(shuffled[0], true);
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

  const handleSongDoubleClick = (song: Song) => {
    events.emit("song:play", { song, replaceQueue: true });
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
    <div class={`flex h-full bg-black text-white ${props.class || ""}`}>
      {/* Left Panel - Artist List */}
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* Header */}
        <div class="flex-shrink-0 p-6">
          <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
          <Show
            when={!artistsResource.loading}
            fallback={
              <p class="text-magenta-300 text-sm">loading artists...</p>
            }
          >
            <p class="text-magenta-300 text-sm">
              {artistsResource()?.artists?.length || 0} artists
            </p>
          </Show>
        </div>

        {/* Artist List - Scrollable */}
        <div class="flex-1 overflow-y-auto">
          <Show
            when={!artistsResource.loading}
            fallback={
              <div class="px-6 py-4">
                <div class="text-magenta-400">loading artists...</div>
              </div>
            }
          >
            <For each={artistsResource()?.artists || []}>
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
                  <div class="text-magenta-400 text-sm">
                    {artist.song_count} songs · {artist.album_count} albums
                  </div>
                </div>
              )}
            </For>
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
                      <div class="text-magenta-400 text-sm">No songs found</div>
                    </Show>
                  }
                >
                  <div class="space-y-1">
                    <For each={artistSongsResource()?.songs || []}>
                      {(song) => (
                        <div
                          class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer group"
                          onDblClick={() => handleSongDoubleClick(song)}
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
