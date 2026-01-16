import { createSignal, createEffect, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useReactiveActions, useSort, useGenres } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";

import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import { GenreList } from "./GenreList";
import { GenreDetailPanel } from "./GenreDetailPanel";
import type { GenreStat } from "../../../../../../lib/music/schemas/genre";

interface DesktopGenresViewProps {
  class?: string;
}

export function DesktopGenresView(props: DesktopGenresViewProps) {
  const navigate = useNavigate();

  // Use modern reactive store
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort("genres");
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

  // Genre selection state
  const [selectedGenre, setSelectedGenre] = createSignal<GenreStat | null>(
    null
  );

  // Handle genre selection
  const handleGenreClick = (genre: GenreStat) => {
    setSelectedGenre(genre);
    reactiveActions.selectGenre(genre.slug);
    // events.emit("genre:selected", { genre });
  };

  // Handle genre double-click - navigate to standalone genre view
  const handleGenreDoubleClick = (genre: GenreStat) => {
    const encodedGenre = encodeURIComponent(genre.slug);
    navigate(`/genre/${encodedGenre}`);
  };

  // Handle load more for infinite scroll (placeholder for future pagination)
  const handleLoadMore = async () => {
    // TODO: implement when backend supports genre pagination
    console.log("load more genres requested - not yet implemented");
  };

  // Update local selectedGenre when store changes
  createEffect(() => {
    const storeSelectedGenre = genresState.selectedGenre;
    const availableGenres = genres();

    if (storeSelectedGenre) {
      const genreData = availableGenres.find(
        (g) => g.slug === storeSelectedGenre
      );
      if (genreData) {
        setSelectedGenre(genreData);
      }
    } else {
      setSelectedGenre(null);
    }
  });

  // Auto-select first genre when genres are loaded but none is selected
  createEffect(() => {
    const availableGenres = genres();
    const storeSelectedGenre = genresState.selectedGenre;

    if (availableGenres.length > 0 && !storeSelectedGenre) {
      const firstGenre = availableGenres[0];
      if (firstGenre) {
        reactiveActions.selectGenre(firstGenre.slug);
      }
    }
  });

  // Debug effect to track genre details resource state
  // createEffect(() => {
  //   const selected = selectedGenre();
  //   const details = genreDetails();
  //   const detailsLoading = genreDetailsLoading();
  // });

  return (
    <div
      class={`flex h-full bg-black text-white w-full max-w-full ${props.class || ""}`}
    >
      {/* Left Panel - Genre List */}
      <div class="w-72 min-w-72 flex-shrink-0 flex flex-col border-r border-magenta-800/30">
        {/* Header */}
        <div class="flex-shrink-0 p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h1 class="text-2xl font-semibold text-white mb-2">genres</h1>
              <Show
                when={!loading() && !error()}
                fallback={
                  <p class="text-gray-300 text-sm">loading genres...</p>
                }
              >
                <p class="text-gray-300 text-sm">
                  {totalCount()} genre{totalCount() !== 1 ? "s" : ""}
                </p>
              </Show>
            </div>
          </div>
          <div class="flex items-center">
            <TagFilterControls compact={true} />
          </div>
        </div>

        {/* Genre List */}
        <div class="flex-1 min-h-0">
          <Show when={error()}>
            <div class="px-6 py-4 text-center">
              <div class="text-red-400 text-sm mb-2">failed to load genres</div>
              <button
                class="text-magenta-400 hover:text-magenta-300 text-sm transition-colors"
                onClick={() => reactiveActions.refreshAll()}
              >
                try again
              </button>
            </div>
          </Show>

          <Show when={!error()}>
            <GenreList
              genres={genres()}
              loading={loading()}
              selectedGenre={selectedGenre()}
              onGenreClick={handleGenreClick}
              onGenreDoubleClick={handleGenreDoubleClick}
              sortField={sortState.field}
              sortDirection={sortState.direction}
              totalCount={totalCount()}
              hasMore={false} // TODO: set to true when backend supports pagination
              onLoadMore={handleLoadMore}
              class="h-full"
            />
          </Show>
        </div>
      </div>

      {/* Right Panel - Genre Detail */}
      <Show
        when={selectedGenre()}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-400">
              <svg
                class="w-16 h-16 mx-auto mb-4 opacity-50"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21s4.5-2.01 4.5-4.5V9h4V3h-7z" />
              </svg>
              <p class="text-lg mb-2">select a genre to explore</p>
              <p class="text-xs mt-2 text-gray-500">
                (double-click to open in full-screen view)
              </p>
            </div>
          </div>
        }
      >
        <GenreDetailPanel
          genre={selectedGenre()!}
          genreDetails={genreDetails()}
          loading={genreDetailsLoading()}
          error={genreDetailsError()}
        />
      </Show>
    </div>
  );
}
