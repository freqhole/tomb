import { For, Show, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useReactiveActions, useSort, useGenres } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";
import { saveScrollStateSecurely } from "../../../../../../lib/navigation";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import { GenreDetailPanel } from "./GenreDetailPanel";
import type { GenreStat } from "../../../../../../lib/music/schemas/genre";
import type { SortField } from "../../../../../../components/search/SearchSortControls";

interface MobileGenresViewProps {
  class?: string;
}

export function MobileGenresView(props: MobileGenresViewProps) {
  const navigate = useNavigate();

  // Use modern reactive store
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort();
  const [genresState] = useGenres();
  const dataSections = useDataSections();

  // Data access using modern reactive store
  const genres = () => {
    const result = dataSections.genres.data() as
      | { genres: GenreStat[]; total: number }
      | undefined;
    return result?.genres || [];
  };
  const loading = () => dataSections.genres.loading || false;
  const error = () => dataSections.genres.error;
  const totalCount = () => {
    const result = dataSections.genres.data() as
      | { genres: GenreStat[]; total: number }
      | undefined;
    return result?.total || genres().length;
  };

  // Genre details data
  const genreDetails = () => dataSections.genreDetails.data();
  const genreDetailsLoading = () => dataSections.genreDetails.loading || false;
  const genreDetailsError = () => dataSections.genreDetails.error;

  // Mobile state management
  const [selectedGenre, setSelectedGenre] = createSignal<GenreStat | null>(null);
  const [showGenreDetail, setShowGenreDetail] = createSignal(false);

  // Scroll restoration state
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(null);

  // Get scroll state from browser history
  const getSavedScrollTop = (): number => {
    const state = history.state;
    return (state && state.scrollTop) || 0;
  };

  // Save scroll state to browser history
  const saveScrollState = () => {
    const element = scrollElement();
    if (element && element.scrollTop > 0) {
      saveScrollStateSecurely("scrollTop", element.scrollTop);
    }
  };

  // Restore scroll position when data loads
  createEffect(() => {
    const element = scrollElement();
    const savedScrollTop = getSavedScrollTop();

    if (element && savedScrollTop > 0 && genres().length > 0) {
      requestAnimationFrame(() => {
        element.scrollTop = savedScrollTop;
      });
    }
  });

  // Handle genre selection
  const handleGenreClick = (genre: GenreStat) => {
    setSelectedGenre(genre);
    reactiveActions.selectGenre(genre.name);
    setShowGenreDetail(true);
  };

  // Handle back from genre detail
  const handleBackToList = () => {
    setShowGenreDetail(false);
    setSelectedGenre(null);
    reactiveActions.selectGenre(null);
  };

  // Handle genre double-click - navigate to standalone genre view
  const handleGenreDoubleClick = (genre: GenreStat) => {
    const encodedGenre = encodeURIComponent(genre.name);
    navigate(`/genre/${encodedGenre}`);
  };

  // Update local selectedGenre when store changes
  createEffect(() => {
    const storeSelectedGenre = genresState.selectedGenre;
    if (storeSelectedGenre) {
      const genreData = genres().find((g) => g.name === storeSelectedGenre);
      if (genreData) {
        setSelectedGenre(genreData);
        setShowGenreDetail(true);
      }
    } else {
      setSelectedGenre(null);
      setShowGenreDetail(false);
    }
  });

  // Auto-select first genre when genres are loaded but none is selected
  createEffect(() => {
    const availableGenres = genres();
    const storeSelectedGenre = genresState.selectedGenre;

    if (availableGenres.length > 0 && !storeSelectedGenre && !showGenreDetail()) {
      const firstGenre = availableGenres[0];
      if (firstGenre) {
        reactiveActions.selectGenre(firstGenre.name);
      }
    }
  });

  // Format count helper
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // Handle scroll for scroll restoration
  const handleScroll = (event: Event) => {
    // Debounced save of scroll state
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScrollState, 300);
  };

  return (
    <div class={`h-full flex flex-col bg-black text-white ${props.class || ""}`}>
      <Show
        when={!showGenreDetail()}
        fallback={
          <Show when={selectedGenre()}>
            <div class="h-full flex flex-col">
              {/* Mobile header with back button */}
              <div class="flex-shrink-0 p-4 border-b border-gray-800/50">
                <div class="flex items-center gap-3">
                  <button
                    class="p-2 hover:bg-gray-800 transition-colors"
                    onClick={handleBackToList}
                  >
                    <svg
                      class="w-5 h-5 text-gray-300"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <h1 class="text-lg font-semibold text-white">
                    {selectedGenre()!.name}
                  </h1>
                </div>
              </div>

              {/* Genre detail panel */}
              <div class="flex-1 min-h-0">
                <GenreDetailPanel
                  genre={selectedGenre()!}
                  genreDetails={genreDetails()}
                  loading={genreDetailsLoading()}
                  error={genreDetailsError()}
                />
              </div>
            </div>
          </Show>
        }
      >
        {/* Mobile genre list */}
        <div class="h-full flex flex-col">
          {/* Header */}
          <div class="flex-shrink-0 p-4">
            <div class="mb-4">
              <h1 class="text-xl font-semibold text-white mb-2">genres</h1>
              <Show
                when={!loading() && !error()}
                fallback={<p class="text-gray-300 text-sm">loading genres...</p>}
              >
                <p class="text-gray-300 text-sm">
                  {totalCount()} genre{totalCount() !== 1 ? "s" : ""}
                </p>
              </Show>
            </div>

            {/* Mobile filters */}
            <div class="space-y-3">
              <TagFilterControls compact={false} />
            </div>
          </div>

          {/* Error State */}
          <Show when={error()}>
            <div class="p-4 text-center">
              <div class="text-red-400 text-sm mb-2">failed to load genres</div>
              <button
                class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
                onClick={() => reactiveActions.refreshAll()}
              >
                try again
              </button>
            </div>
          </Show>

          {/* Genre List */}
          <Show when={!error()}>
            <div
              ref={setScrollElement}
              class="flex-1 overflow-y-auto"
              onScroll={handleScroll}
            >
              <Show
                when={!loading() || genres().length > 0}
                fallback={
                  <div class="flex-1 flex items-center justify-center p-8">
                    <div class="text-magenta-400">loading genres...</div>
                  </div>
                }
              >
                <div class="divide-y divide-gray-800/50">
                  <For each={genres()}>
                    {(genre) => (
                      <div
                        class="p-4 hover:bg-gray-800/50 transition-colors cursor-pointer"
                        onClick={() => handleGenreClick(genre)}
                        onDblClick={() => handleGenreDoubleClick(genre)}
                      >
                        <div class="flex items-center justify-between">
                          <div class="flex-1 min-w-0">
                            <h3 class="text-white font-medium text-base mb-1 truncate">
                              {genre.name}
                            </h3>
                            <div class="flex items-center gap-3 text-sm text-gray-400">
                              <span>
                                {formatCount(genre.song_count)} song
                                {genre.song_count !== 1 ? "s" : ""}
                              </span>
                              <span>
                                {formatCount(genre.artist_count)} artist
                                {genre.artist_count !== 1 ? "s" : ""}
                              </span>
                              <span>
                                {formatCount(genre.album_count)} album
                                {genre.album_count !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          <div class="flex-shrink-0 ml-3 text-gray-500">
                            <svg
                              class="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>

                {/* Loading indicator */}
                <Show when={loading()}>
                  <div class="text-center py-8">
                    <div class="text-magenta-400 text-sm">
                      loading more genres...
                    </div>
                  </div>
                </Show>

                {/* End of list indicator */}
                <Show
                  when={
                    genres().length >= totalCount() &&
                    genres().length > 0 &&
                    !loading()
                  }
                >
                  <div class="text-center py-8">
                    <div class="text-gray-600 text-xs opacity-50">
                      — end of genres —
                    </div>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
