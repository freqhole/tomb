import { For, Show, createEffect, createSignal, onMount } from "solid-js";
import { useNavigate, useSearchParams, useLocation } from "@solidjs/router";
import { useSearch } from "../../../store/hooks";
import { useStore, useSearchActions } from "../../../store/index";
import { useSongInteractions } from "../../../services/songInteractions";
import type { RouteSectionProps } from "@solidjs/router";
import type { Song } from "../../../../../lib/music/schemas/song";

interface ScrollRestorationState {
  scrollTop: number;
  estimatedIndex: number;
  totalCount: number;
  activeTab: string;
  timestamp: number;
}

interface SearchResultsViewProps {
  class?: string;
}

type ResultTab =
  | "all"
  | "songs"
  | "artists"
  | "albums"
  | "playlists"
  | "genres";

export function SearchResultsView(
  props: RouteSectionProps<unknown> & SearchResultsViewProps = {} as any
) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const songInteractions = useSongInteractions();
  const [store] = useStore();
  const search = useSearch();
  const searchActions = useSearchActions();
  const location = useLocation();

  // Local tab state for enhanced search
  const [activeTab, setActiveTab] = createSignal<ResultTab>("all");

  // Router-aware scroll restoration
  const [initialScrollTop, setInitialScrollTop] = createSignal(0);
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // Initialize search from URL parameters - run once on mount only
  let hasRun = false;
  createEffect(() => {
    const urlQuery = searchParams.q as string;

    if (urlQuery && !hasRun) {
      hasRun = true;
      search.setSearchQuery(urlQuery, false); // don't use old search
      // Trigger enhanced search with grouping by default
      performSearchWithGrouping();
    }
  });

  // Auto-trigger enhanced search whenever query changes
  createEffect(() => {
    const query = search.searchQuery();
    if (query && query.trim().length > 0) {
      performSearchWithGrouping();
    }
  });

  // Load saved scroll state from router history
  onMount(() => {
    const routerState = location.state as ScrollRestorationState | undefined;
    if (routerState && routerState.scrollTop) {
      setInitialScrollTop(routerState.scrollTop);
      if (routerState.activeTab && routerState.activeTab !== activeTab()) {
        setActiveTab(routerState.activeTab as ResultTab);
      }
    }
  });

  // Save scroll state disabled to prevent infinite loops

  // Restore scroll position on route change
  createEffect(() => {
    location.pathname; // track route changes

    if (initialScrollTop() > 0) {
      const element = scrollElement();
      if (element && search.hasResults()) {
        element.scrollTop = initialScrollTop();
        setInitialScrollTop(0); // reset after restore
      }
    }
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const handleTabChange = (tab: ResultTab) => {
    setActiveTab(tab);
  };

  const handleSongClick = (song: Song) => {
    songInteractions.handleDoubleClick(song);
  };

  const handleArtistClick = (artist: any) => {
    if (artist.artist) {
      const encodedArtist = encodeURIComponent(artist.artist);
      navigate(`/artist/${encodedArtist}`);
    }
  };

  const handleAlbumClick = (album: any) => {
    if (album.album) {
      const encodedAlbum = encodeURIComponent(album.album);
      navigate(`/album/${encodedAlbum}`);
    }
  };

  const handleGenreClick = (genre: any) => {
    if (genre.genre) {
      const encodedGenre = encodeURIComponent(genre.genre);
      navigate(`/genre/${encodedGenre}`);
    }
  };

  const handlePlaylistClick = (playlist: any) => {
    navigate(`/playlist/${playlist.id}`);
  };

  // enhanced search with grouping as default
  const performSearchWithGrouping = async () => {
    if (search.searchQuery()) {
      await searchActions.performSearch({
        include_genres: true,
        include_playlists: true,
      });
    }
  };

  const getTabCount = (tab: ResultTab) => {
    switch (tab) {
      case "all":
        return search.totalCount();
      case "songs":
        return search.songs().length;
      case "artists":
        return search.artists().length;
      case "albums":
        return search.albums().length;
      case "playlists":
        return store.search.results.playlists?.length || 0;
      case "genres":
        return store.search.results.genres?.length || 0;
      default:
        return 0;
    }
  };

  const getTabDisplayCount = (tab: ResultTab) => {
    const count = getTabCount(tab);
    return count > 0 ? ` (${count})` : "";
  };

  return (
    <div
      class={`flex flex-col h-full bg-black text-white w-full max-w-full ${
        props.class || ""
      }`}
    >
      {/* Search Header */}
      <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm p-6 border-b border-magenta-800/30">
        <Show
          when={search.searchQuery()}
          fallback={
            <div class="text-center py-8">
              <div class="text-gray-400 text-lg">
                Enter a search query to begin
              </div>
            </div>
          }
        >
          <div class="mb-4">
            <h1 class="text-2xl font-bold text-white mb-2">
              search results for "{search.searchQuery()}"
            </h1>
            <Show when={search.totalCount() > 0}>
              <div class="text-magenta-400">
                {search.totalCount()} results found
                <Show when={store.search.query_time_ms}>
                  <span class="text-magenta-500 ml-2">
                    ({store.search.query_time_ms}ms)
                  </span>
                </Show>
              </div>
            </Show>
          </div>

          {/* Tab Navigation */}
          <div class="flex gap-1 overflow-x-auto scrollbar-none">
            <For
              each={[
                { id: "all" as const, label: "all" },
                { id: "songs" as const, label: "songs" },
                { id: "artists" as const, label: "artists" },
                { id: "albums" as const, label: "albums" },
                { id: "genres" as const, label: "genres" },
                { id: "playlists" as const, label: "playlists" },
              ]}
            >
              {(tab) => (
                <button
                  class={`px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                    activeTab() === tab.id
                      ? "bg-magenta-600 text-white"
                      : "bg-magenta-950/30 text-magenta-300 hover:bg-magenta-600/30 hover:text-white"
                  }`}
                  onClick={() => handleTabChange(tab.id)}
                >
                  {tab.label}
                  {getTabDisplayCount(tab.id)}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Search Results Content */}
      <div class="flex-1 overflow-y-auto p-6" ref={setScrollElement}>
        <Show when={search.loading()}>
          <div class="text-center py-8">
            <div class="animate-spin h-8 w-8 border-2 border-magenta-500 border-t-transparent mx-auto mb-4"></div>
            <div class="text-magenta-400">searching...</div>
          </div>
        </Show>

        <Show when={search.error()}>
          <div class="text-center py-8">
            <div class="text-red-400 text-lg mb-2">search error</div>
            <div class="text-gray-400">{search.error()}</div>
          </div>
        </Show>

        <Show
          when={!search.loading() && !search.error() && search.searchQuery()}
        >
          <Show
            when={search.hasResults()}
            fallback={
              <div class="text-center py-8">
                <div class="text-gray-400 text-lg">no results found</div>
                <div class="text-gray-500 mt-2">
                  try adjusting your search terms or filters
                </div>
              </div>
            }
          >
            {/* All Tab - Show everything */}
            <Show when={activeTab() === "all"}>
              <div class="space-y-8">
                {/* Genres Section - Show first */}
                <Show when={(store.search.results.genres?.length || 0) > 0}>
                  <div>
                    <h2 class="text-xl font-semibold text-white mb-4">
                      genres ({store.search.results.genres?.length || 0})
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <For
                        each={store.search.results.genres?.slice(0, 6) || []}
                      >
                        {(genre) => (
                          <div
                            class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                            onClick={() => handleGenreClick(genre)}
                          >
                            <div class="text-white font-medium truncate">
                              {genre.genre}
                            </div>
                            <div class="text-magenta-400 text-sm">
                              {genre.song_count} songs • {genre.artist_count}{" "}
                              artists
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={(store.search.results.genres?.length || 0) > 6}>
                      <button
                        class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
                        onClick={() => handleTabChange("genres")}
                      >
                        view all {store.search.results.genres?.length} genres →
                      </button>
                    </Show>
                  </div>
                </Show>

                {/* Playlists Section - Show second */}
                <Show when={(store.search.results.playlists?.length || 0) > 0}>
                  <div>
                    <h2 class="text-xl font-semibold text-white mb-4">
                      playlists ({store.search.results.playlists?.length || 0})
                    </h2>
                    <div class="space-y-2">
                      <For
                        each={store.search.results.playlists?.slice(0, 5) || []}
                      >
                        {(playlist) => (
                          <div
                            class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer"
                            onClick={() => handlePlaylistClick(playlist)}
                          >
                            <div class="text-white font-medium truncate">
                              {playlist.title}
                            </div>
                            <div class="text-magenta-400 text-sm">
                              {playlist.song_count || 0} songs
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show
                      when={(store.search.results.playlists?.length || 0) > 5}
                    >
                      <button
                        class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
                        onClick={() => handleTabChange("playlists")}
                      >
                        view all {store.search.results.playlists?.length}{" "}
                        playlists →
                      </button>
                    </Show>
                  </div>
                </Show>

                {/* Artists Section - Show third */}
                <Show when={search.artists().length > 0}>
                  <div>
                    <h2 class="text-xl font-semibold text-white mb-4">
                      artists ({search.artists().length})
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <For each={search.artists().slice(0, 6)}>
                        {(artist) => (
                          <div
                            class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                            onClick={() => handleArtistClick(artist)}
                          >
                            <div class="text-white font-medium truncate">
                              {artist.artist}
                            </div>
                            <div class="text-magenta-400 text-sm">
                              {artist.song_count || 0} songs
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={search.artists().length > 6}>
                      <button
                        class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
                        onClick={() => handleTabChange("artists")}
                      >
                        view all {search.artists().length} artists →
                      </button>
                    </Show>
                  </div>
                </Show>

                {/* Albums Section - Show fourth */}
                <Show when={search.albums().length > 0}>
                  <div>
                    <h2 class="text-xl font-semibold text-white mb-4">
                      albums ({search.albums().length})
                    </h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <For each={search.albums().slice(0, 6)}>
                        {(album) => (
                          <div
                            class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                            onClick={() => handleAlbumClick(album)}
                          >
                            <div class="text-white font-medium truncate">
                              {album.album}
                            </div>
                            <div class="text-magenta-400 text-sm">
                              {album.artist} • {album.track_count || 0} tracks
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={search.albums().length > 6}>
                      <button
                        class="w-full py-2 mt-4 text-magenta-400 hover:text-magenta-300 transition-colors"
                        onClick={() => handleTabChange("albums")}
                      >
                        view all {search.albums().length} albums →
                      </button>
                    </Show>
                  </div>
                </Show>

                {/* Songs Section - Show last */}
                <Show when={search.songs().length > 0}>
                  <div>
                    <h2 class="text-xl font-semibold text-white mb-4">
                      songs ({search.songs().length})
                    </h2>
                    <div class="space-y-1">
                      <For each={search.songs().slice(0, 10)}>
                        {(song) => (
                          <div
                            class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer"
                            onClick={() => handleSongClick(song)}
                          >
                            <div class="flex items-center justify-between">
                              <div class="min-w-0 flex-1">
                                <div class="text-white font-medium truncate">
                                  {song.title}
                                </div>
                                <div class="text-magenta-400 text-sm truncate">
                                  {song.artist} • {song.album}
                                </div>
                              </div>
                              <div class="text-gray-400 text-sm">
                                {formatDuration(song.duration_seconds)}
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                      <Show when={search.songs().length > 10}>
                        <button
                          class="w-full py-2 text-magenta-400 hover:text-magenta-300 transition-colors"
                          onClick={() => handleTabChange("songs")}
                        >
                          view all {search.songs().length} songs →
                        </button>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Songs Tab */}
            <Show when={activeTab() === "songs"}>
              <div class="space-y-1">
                <For each={search.songs()}>
                  {(song) => (
                    <div
                      class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handleSongClick(song)}
                      onContextMenu={(e) =>
                        songInteractions.handleRightClick(e, song)
                      }
                    >
                      <div class="flex items-center justify-between">
                        <div class="min-w-0 flex-1">
                          <div class="text-white font-medium truncate">
                            {song.title}
                          </div>
                          <div class="text-magenta-400 text-sm truncate">
                            {song.artist} • {song.album}
                          </div>
                        </div>
                        <div class="text-gray-400 text-sm">
                          {formatDuration(song.duration_seconds)}
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Artists Tab */}
            <Show when={activeTab() === "artists"}>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <For each={search.artists()}>
                  {(artist) => (
                    <div
                      class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handleArtistClick(artist)}
                    >
                      <div class="text-white font-medium truncate">
                        {artist.artist}
                      </div>
                      <div class="text-magenta-400 text-sm">
                        {artist.song_count || 0} songs
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Albums Tab */}
            <Show when={activeTab() === "albums"}>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <For each={search.albums()}>
                  {(album) => (
                    <div
                      class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handleAlbumClick(album)}
                    >
                      <div class="text-white font-medium truncate">
                        {album.album}
                      </div>
                      <div class="text-magenta-400 text-sm">
                        {album.artist} • {album.track_count || 0} tracks
                      </div>
                      <Show when={album.year}>
                        <div class="text-gray-400 text-xs mt-1">
                          {album.year}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Genres Tab */}
            <Show when={activeTab() === "genres"}>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <For each={store.search.results.genres || []}>
                  {(genre) => (
                    <div
                      class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handleGenreClick(genre)}
                    >
                      <div class="text-white font-medium truncate">
                        {genre.genre}
                      </div>
                      <div class="text-magenta-400 text-sm">
                        {genre.song_count} songs • {genre.artist_count} artists
                      </div>
                      <Show
                        when={
                          genre.avg_rating !== null &&
                          genre.avg_rating !== undefined
                        }
                      >
                        <div class="text-yellow-400 text-sm mt-1">
                          ★ {genre.avg_rating?.toFixed(1)}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Playlists Tab */}
            <Show when={activeTab() === "playlists"}>
              <div class="space-y-2">
                <For each={store.search.results.playlists || []}>
                  {(playlist) => (
                    <div
                      class="p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer"
                      onClick={() => handlePlaylistClick(playlist)}
                    >
                      <div class="text-white font-medium truncate">
                        {playlist.title}
                      </div>
                      <div class="text-magenta-400 text-sm">
                        {playlist.song_count || 0} songs •{" "}
                        {playlist.is_public ? "public" : "private"}
                      </div>
                      <Show when={playlist.description}>
                        <div class="text-gray-400 text-sm mt-1 truncate">
                          {playlist.description}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Load More Button */}
            <Show when={search.pagination().hasNext}>
              <div class="text-center py-4">
                <button
                  class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => search.loadMore()}
                  disabled={search.loading()}
                >
                  {search.loading() ? "loading..." : "load more"}
                </button>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
