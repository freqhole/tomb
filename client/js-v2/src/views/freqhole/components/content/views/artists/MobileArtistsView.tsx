import { For, Show, createSignal, createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useReactiveActions, useSort } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";
import { ArtistAlphabetNav } from "./ArtistAlphabetNav";
import { useArtistNavigation } from "./useArtistNavigation";

import { saveScrollStateSecurely } from "../../../../../../lib/navigation";
import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { TagFilterControls } from "../../../../../../components/filters/TagFilterControls";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";
import type { SortField } from "../../../../../../components/search/SearchSortControls";

interface MobileArtistsViewProps {
  class?: string;
}

export function MobileArtistsView(props: MobileArtistsViewProps) {
  const navigate = useNavigate();

  // Use modern reactive store instead of legacy hook
  const reactiveActions = useReactiveActions();
  const [sortState] = useSort("artists");
  const dataSections = useDataSections();

  // Data access using modern reactive store
  const artists = () => {
    const result = dataSections.artists.data() as
      | { artists: any[]; pagination: any }
      | undefined;
    return result?.artists || [];
  };
  const loading = () => dataSections.artists.loading || false;
  const error = () => dataSections.artists.error;
  const totalCount = () => {
    const result = dataSections.artists.data() as
      | { artists: any[]; pagination: any }
      | undefined;
    if (result?.pagination?.total) {
      return result.pagination.total;
    }
    return artists().length;
  };

  // Sort fields for mobile artists dropdown
  const sortFields: SortField[] = [
    { value: "artist", label: "artist", description: "Sort by artist name" },
    {
      value: "song_count",
      label: "songs",
      description: "Sort by song count",
    },
    {
      value: "album_count",
      label: "albums",
      description: "Sort by album count",
    },
    {
      value: "rating",
      label: "rating",
      description: "Sort by average rating",
    },
  ];

  // Set valid default for artists if current sort field is invalid
  const currentSortField = sortState.field;
  const validSortFields = sortFields.map((f) => f.value);
  if (!validSortFields.includes(currentSortField)) {
    // Set to "artist" as default for artists
    reactiveActions.setSort("artist", "asc");
  }

  // Handle sort changes
  const handleSortChange = (field: string, direction: "asc" | "desc") => {
    reactiveActions.setSort(field, direction);
  };

  // Scroll restoration state
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // Load all artists up to a specific letter
  const loadAllToLetter = async (targetLetter: string) => {
    const maxAttempts = 100; // Safety limit
    let attempts = 0;

    while (attempts < maxAttempts) {
      const currentResult = dataSections.artists.data() as
        | { artists: any[]; pagination: any }
        | undefined;

      if (!currentResult) {
        break;
      }

      const hasNext = currentResult.pagination?.has_next || false;
      if (!hasNext) {
        break;
      }

      // Check if we have the target letter and some artists after it
      const currentArtists = currentResult.artists;
      let foundTargetLetter = false;
      let foundLetterIndex = -1;

      for (let i = 0; i < currentArtists.length; i++) {
        const artist = currentArtists[i];
        const normalized = artist.artist
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        const firstChar = normalized.charAt(0);
        const letter =
          firstChar >= "a" && firstChar <= "z" ? firstChar.toUpperCase() : "#";

        if (letter === targetLetter && !foundTargetLetter) {
          foundTargetLetter = true;
          foundLetterIndex = i;
        }
      }

      // If we found the letter and have at least a few artists loaded after it, we can stop
      if (foundTargetLetter && foundLetterIndex < currentArtists.length - 10) {
        break;
      }

      await reactiveActions.loadMoreArtists();
      attempts++;
    }
  };

  // Artist navigation
  const artistNav = useArtistNavigation({
    artists: artists(),
    onLoadAllToLetter: loadAllToLetter,
    getLatestArtists: () => {
      const result = dataSections.artists.data() as
        | { artists: any[]; pagination: any }
        | undefined;
      return result?.artists || [];
    },
  });

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

    if (element && savedScrollTop > 0 && artists().length > 0) {
      requestAnimationFrame(() => {
        element.scrollTop = savedScrollTop;
      });
    }
  });

  const handleArtistClick = (artist: ArtistSummary) => {
    // Save scroll state before navigating
    saveScrollState();

    // Navigate to artist detail route
    const encodedArtist = encodeURIComponent(artist.artist);
    navigate(`/artist/${encodedArtist}`);
  };

  // Handle scroll to position for letter navigation
  const handleScrollToPosition = (position: number) => {
    const container = scrollElement();
    if (container) {
      // Calculate approximate scroll position based on item height
      const itemHeight = 73; // Approximate height of each artist item on mobile
      const scrollTop = position * itemHeight;
      container.scrollTo({ top: scrollTop, behavior: "smooth" });
    }
  };

  // Listen for scroll events from artist navigation
  createEffect(() => {
    const handleCustomScroll = (event: CustomEvent) => {
      handleScrollToPosition(event.detail.position);
    };

    window.addEventListener(
      "artistNavigation:scrollTo",
      handleCustomScroll as EventListener
    );
    return () => {
      window.removeEventListener(
        "artistNavigation:scrollTo",
        handleCustomScroll as EventListener
      );
    };
  });

  return (
    <div class={`h-full flex w-full max-w-full ${props.class || ""}`}>
      {/* A-Z Navigation - only show when sorted by artist */}
      <Show when={sortState.field === "artist"}>
        <ArtistAlphabetNav
          artists={artists()}
          onLetterClick={artistNav.handleLetterClick}
          currentLetter={artistNav.currentLetter() || undefined}
          disabledLetters={artistNav.disabledLetters()}
          sortDirection={sortState.direction}
        />
      </Show>

      <div class="flex-1 flex flex-col h-full overflow-hidden">
        <div class="p-3">
          <div class="flex items-center justify-between mb-2">
            <h1 class="text-2xl font-semibold text-white">artists</h1>
            <SearchSortControls
              sortBy={sortState.field}
              sortDirection={sortState.direction}
              onSortChange={handleSortChange}
              sortFields={sortFields}
              directionStyle="arrows"
              class="flex-shrink-0"
            />
          </div>
          <Show
            when={dataSections.artists.data() && !error()}
            fallback={<p class="text-gray-300 text-sm">loading artists...</p>}
          >
            <p class="text-gray-300 text-sm">
              {totalCount()} artist{totalCount() !== 1 ? "s" : ""}
            </p>
          </Show>
          <div class="flex items-center mt-2">
            <TagFilterControls compact={true} />
          </div>
        </div>

        <div
          class="flex-1 overflow-y-auto min-h-0"
          ref={(el) => {
            setScrollElement(el);
          }}
          onScroll={(event) => {
            // Handle infinite loading
            const target = event.target as HTMLDivElement;
            const scrollTop = target.scrollTop;
            const scrollHeight = target.scrollHeight;
            const clientHeight = target.clientHeight;
            const buffer = Math.max(50, clientHeight * 0.25);

            if (
              scrollTop + clientHeight >= scrollHeight - buffer &&
              !loading()
            ) {
              const currentLength = artists().length;
              const total = totalCount();
              if (currentLength < total) {
                reactiveActions.loadMoreArtists();
              }
            }

            // Update current letter based on scroll position
            const itemHeight = 73; // Mobile artist item height
            const currentIndex = Math.floor(scrollTop / itemHeight);
            artistNav.updateCurrentLetterFromPosition(currentIndex);

            // Debounced save of scroll state
            let saveTimer: ReturnType<typeof setTimeout> | undefined;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(saveScrollState, 300);
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
                  <div
                    class="text-white font-medium mb-1 truncate"
                    title={artist.artist}
                  >
                    {artist.artist}
                  </div>
                  <div
                    class="text-gray-300 text-sm truncate"
                    title={`${artist.song_count} songs · ${artist.album_count} albums`}
                  >
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
              artists().length >= totalCount() &&
              artists().length > 0 &&
              !loading()
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
    </div>
  );
}
