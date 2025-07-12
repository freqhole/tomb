import { For, Show, createSignal, createResource } from "solid-js";
import { useInfiniteScroll } from "../../../../hooks/useInfiniteScroll";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../../services/songInteractions";
import { MobileSongList } from "../songs/MobileSongList";
import { apiClient } from "../../../../../../lib/api-client";
import { storeActions } from "../../../../store";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { PaginationMetadata } from "../../../../hooks/useInfiniteScroll";

interface MobileArtistsViewProps {
  class?: string;
}

export function MobileArtistsView(props: MobileArtistsViewProps) {
  const events = useGlobalEvents();
  const songInteractions = useSongInteractions();

  const [selectedArtist, setSelectedArtist] =
    createSignal<ArtistSummary | null>(null);

  const [mobileView, setMobileView] = createSignal<"artists" | "songs">(
    "artists"
  );

  // Create fetch function for infinite scroll
  const fetchArtists = async (
    page: number
  ): Promise<{ items: ArtistSummary[]; pagination: PaginationMetadata }> => {
    console.log(`🎤 Loading mobile artists page ${page}`);

    const response = await apiClient.getArtists({
      page,
      page_size: 50,
    });

    console.log(
      `🎤 Loaded ${response.artists.length} mobile artists`,
      response
    );

    return {
      items: response.artists,
      pagination: response.pagination,
    };
  };

  // Use infinite scroll hook
  const infiniteScroll = useInfiniteScroll(fetchArtists, {
    threshold: 200,
    enabled: () => mobileView() === "artists",
  });

  // Extract state and actions
  const artists = infiniteScroll.state.items;
  const loading = infiniteScroll.state.loading;
  const error = infiniteScroll.state.error;

  // Fetch tracks for selected artist
  const [artistSongsResource] = createResource(
    () => selectedArtist(),
    async (artist: ArtistSummary) => {
      if (!artist?.artist) return { songs: [] };

      console.log("🎵 Fetching mobile songs for artist:", artist.artist);

      try {
        const songs = await apiClient.getArtistSongs(artist.artist);
        console.log("🎵 Mobile artist songs loaded:", songs);
        return songs;
      } catch (error) {
        console.error("❌ Failed to load mobile artist songs:", error);
        return { songs: [] };
      }
    }
  );

  const handleArtistClick = (artist: ArtistSummary) => {
    setSelectedArtist(artist);
    storeActions.selectArtist(artist);
    events.emit("artist:selected", { artist });
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

  return (
    <div class={`h-full flex flex-col w-full max-w-full ${props.class || ""}`}>
      {/* Mobile Artists List */}
      <Show when={mobileView() === "artists"}>
        <div class="flex-1 flex flex-col h-full overflow-hidden">
          <div class="p-3">
            <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
            <Show
              when={!loading() && !error()}
              fallback={<p class="text-gray-300 text-sm">loading artists...</p>}
            >
              <p class="text-gray-300 text-sm">{artists().length} artists</p>
            </Show>
          </div>

          <div
            class="flex-1 overflow-y-auto min-h-0"
            ref={infiniteScroll.containerRef}
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
                infiniteScroll.state.hasMore() === false && artists().length > 0
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
        <div class="flex-1 flex flex-col h-full overflow-hidden">
          <div class="p-3">
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
                  artistSongsResource.loading ||
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
                  artistSongsResource.loading ||
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
                  artistSongsResource.loading ||
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

          <div class="flex-1 overflow-y-auto min-h-0">
            <Show
              when={
                !artistSongsResource.loading && artistSongsResource()?.songs
              }
              fallback={
                <div class="p-4">
                  <div class="text-gray-300">
                    {artistSongsResource.loading
                      ? "loading songs..."
                      : "no songs found"}
                  </div>
                </div>
              }
            >
              <MobileSongList
                songs={artistSongsResource()?.songs || []}
                loading={artistSongsResource.loading}
                hasMore={false}
                class="px-4"
              />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
