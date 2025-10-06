import {
  For,
  Show,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useReactiveActions } from "../../../../store";
import { useDataSections } from "../../../../store/hooks";
import { useGlobalEvents } from "../../../../hooks/useGlobalEvents";
import { apiClient } from "../../../../../../lib/api-client";
// import { SearchSortControls } from "../../../../../../components/search/SearchSortControls";
import { GenreAlbumGrid } from "./GenreAlbumGrid";
import type {
  GenreStat,
  GenreArtist,
  GenreAlbum,
} from "../../../../../../lib/music/schemas/genre";
// import type { SortField } from "../../../../../../components/search/SearchSortControls";

// Global state for expand/collapse, scroll position, and loaded data
const globalGenreState = {
  expandAll: false,
  expandedGenres: new Set<string>(),
  scrollTop: 0,
  loadedGenres: new Map<string, GenreWithArtists>(),
  setExpandAll: (value: boolean) => {
    globalGenreState.expandAll = value;
  },
  setExpandedGenres: (genres: Set<string>) => {
    globalGenreState.expandedGenres = genres;
  },
  setScrollTop: (value: number) => {
    globalGenreState.scrollTop = value;
  },
  setLoadedGenre: (genreSlug: string, genre: GenreWithArtists) => {
    globalGenreState.loadedGenres.set(genreSlug, genre);
  },
  getLoadedGenre: (genreSlug: string): GenreWithArtists | undefined => {
    return globalGenreState.loadedGenres.get(genreSlug);
  },
};

interface SimpleMobileGenresViewProps {
  class?: string;
}

interface ArtistWithAlbums extends GenreArtist {
  albums: GenreAlbum[];
  albumsLoading: boolean;
  albumsLoaded: boolean;
}

interface GenreWithArtists extends GenreStat {
  artists: ArtistWithAlbums[];
  loading: boolean;
  loaded: boolean;
}

export function SimpleMobileGenresView(props: SimpleMobileGenresViewProps) {
  const navigate = useNavigate();
  const events = useGlobalEvents();
  const reactiveActions = useReactiveActions();
  // const [sortState] = useSort();
  const dataSections = useDataSections();

  // Main genres list
  const genres = () => {
    const result = dataSections.genres.data() as
      | { genres: GenreStat[]; total: number }
      | undefined;
    return result?.genres || [];
  };
  const loading = () => dataSections.genres.loading || false;
  const error = () => dataSections.genres.error;

  // Track which genres have loaded their artists
  const [genresWithArtists, setGenresWithArtists] = createSignal<
    GenreWithArtists[]
  >([]);

  // Use global expand/collapse state
  const [expandAll, setExpandAll] = createSignal(globalGenreState.expandAll);
  const [expandedGenres, setExpandedGenres] = createSignal<Set<string>>(
    globalGenreState.expandedGenres
  );
  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );

  // Sync local state with global state
  createEffect(() => {
    globalGenreState.setExpandAll(expandAll());
    globalGenreState.setExpandedGenres(expandedGenres());
  });

  // Restore scroll position on mount (with delay for content to load)
  onMount(() => {
    const element = scrollElement();
    if (element && globalGenreState.scrollTop > 0) {
      // Wait for content to be rendered before restoring scroll
      setTimeout(() => {
        if (element) {
          element.scrollTop = globalGenreState.scrollTop;
        }
      }, 100);
    }
  });

  // Save scroll position periodically
  const saveScrollPosition = () => {
    const element = scrollElement();
    if (element) {
      globalGenreState.setScrollTop(element.scrollTop);
    }
  };

  onCleanup(() => {
    saveScrollPosition();
  });

  // Sort fields for genres - keep existing working fields and add updated_at
  // const sortFields: SortField[] = [
  //   {
  //     value: "updated_at",
  //     label: "recent",
  //     description: "sort by most recent",
  //   },
  //   { value: "genre", label: "name", description: "sort by genre name" },
  //   { value: "song_count", label: "songs", description: "sort by song count" },
  //   {
  //     value: "artist_count",
  //     label: "artists",
  //     description: "sort by artist count",
  //   },
  //   {
  //     value: "album_count",
  //     label: "albums",
  //     description: "sort by album count",
  //   },
  //   {
  //     value: "total_duration",
  //     label: "duration",
  //     description: "sort by total duration",
  //   },
  // ];

  // Set default sort to updated_at desc if not set, fallback to genre name
  // const currentSortField = sortState.field;
  // const validSortFields = sortFields.map((f) => f.value);
  // if (!validSortFields.includes(currentSortField)) {
  //   reactiveActions.setSort("genre", "asc");
  // }

  // Handle sort changes
  // const handleSortChange = (
  //   field: string,
  //   direction: "asc" | "desc" | null
  // ) => {
  //   if (direction === null) {
  //     reactiveActions.setSort(field, "desc");
  //   } else {
  //     reactiveActions.setSort(field, direction);
  //   }
  // };

  // Format count helper
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // Toggle individual genre expand/collapse
  const toggleGenre = (genreSlug: string) => {
    setExpandedGenres((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(genreSlug)) {
        newSet.delete(genreSlug);
      } else {
        newSet.add(genreSlug);
      }
      return newSet;
    });
  };

  // Check if genre is expanded (either individually or via expand all)
  const isGenreExpanded = (genreSlug: string) => {
    return expandAll() || expandedGenres().has(genreSlug);
  };

  // Auto-load albums when a genre is expanded
  createEffect(() => {
    const expanded = expandAll();
    const individuallyExpanded = expandedGenres();

    genresWithArtists().forEach((genre) => {
      const isExpanded = expanded || individuallyExpanded.has(genre.slug);

      if (isExpanded && genre.loaded && genre.artists.length > 0) {
        // Load albums for unloaded artists in expanded genres
        genre.artists.forEach((artist) => {
          if (!artist.albumsLoaded && !artist.albumsLoading) {
            loadArtistAlbums(genre.slug, artist.artist);
          }
        });
      }
    });
  });

  // Play all songs in a genre
  const playGenre = async (genreSlug: string, shuffle: boolean = false) => {
    try {
      console.log(
        `attempting to play genre: ${genreSlug}, shuffle: ${shuffle}`
      );

      // Get individual genres for this slug by using the genre search API
      const genreResponse = await reactiveActions.searchGenres({
        genre_slug: genreSlug,
        page: 1,
        page_size: 1,
      });

      if (!genreResponse || !("artists" in genreResponse)) {
        console.error(`Could not get genre info for slug: ${genreSlug}`);
        return;
      }

      // Extract unique individual genre names from all artists in this genre group
      const individualGenres = new Set<string>();
      genreResponse.artists.forEach((artist) => {
        artist.genres.forEach((genre) => {
          individualGenres.add(genre);
        });
      });

      if (individualGenres.size === 0) {
        console.error(`No individual genres found for slug: ${genreSlug}`);
        return;
      }

      // Use searchPost to get songs for all individual genres in this group
      const response = await apiClient.searchPost({
        filters: {
          genres: Array.from(individualGenres),
        },
        page: 1,
        page_size: 100,
      });

      console.log("searchPost response:", response);

      if (response.songs && response.songs.length > 0) {
        console.log(
          `found ${response.songs.length} songs for genre ${genreSlug}`
        );
        let allSongs = [...response.songs];

        // If there are more songs available, get additional pages
        if (response.has_next && response.songs.length === 100) {
          console.log("fetching additional pages of songs...");
          let currentPage = 2;
          let hasMore = true;

          while (hasMore && currentPage <= 10) {
            // Limit to 10 pages (1000 songs max)
            try {
              const nextResponse = await apiClient.searchPost({
                filters: {
                  genre: genreName,
                },
                page: currentPage,
                page_size: 100,
              });

              if (nextResponse.songs && nextResponse.songs.length > 0) {
                allSongs = [...allSongs, ...nextResponse.songs];
                hasMore = nextResponse.has_next;
                currentPage++;
              } else {
                hasMore = false;
              }
            } catch (error) {
              console.error(`failed to fetch page ${currentPage}:`, error);
              hasMore = false;
            }
          }
        }

        console.log(`total songs collected: ${allSongs.length}`);

        if (shuffle) {
          // Shuffle the songs array
          allSongs = [...allSongs].sort(() => Math.random() - 0.5);
          console.log("shuffled songs");
        }

        // Play first song and queue the rest
        console.log("emitting song:play for first song:", allSongs[0]);
        events.emit("song:play", { song: allSongs[0], replaceQueue: true });

        allSongs.slice(1).forEach((song: any) => {
          events.emit("song:queue", { song });
        });
        console.log(`queued ${allSongs.length - 1} additional songs`);
      } else {
        console.log("no songs found for genre:", genreSlug);
      }
    } catch (error) {
      console.error(`failed to play genre ${genreSlug}:`, error);
    }
  };

  // Handle album click - navigate to album detail
  const handleAlbumClick = (album: GenreAlbum) => {
    if (album.album && album.artist) {
      const encodedAlbum = encodeURIComponent(album.album);
      const encodedArtist = encodeURIComponent(album.artist);
      navigate(`/album/${encodedArtist}/${encodedAlbum}`);
    }
  };

  // Load artists for a specific genre
  const loadGenreArtists = async (genreSlug: string) => {
    try {
      // Use the existing genre search to get artists
      const response = await reactiveActions.searchGenres({
        genre_slug: genreSlug,
        page: 1,
        page_size: 20, // Load first 20 artists per genre
      });

      if (response && "artists" in response) {
        const artistsWithAlbums: ArtistWithAlbums[] = response.artists.map(
          (artist) => ({
            ...artist,
            albums: [],
            albumsLoading: false,
            albumsLoaded: false,
          })
        );

        setGenresWithArtists((prev) =>
          prev.map((g) => {
            if (g.slug === genreSlug) {
              const updatedGenre = {
                ...g,
                artists: artistsWithAlbums,
                loading: false,
                loaded: true,
              };
              // Persist to global state
              globalGenreState.setLoadedGenre(genreSlug, updatedGenre);
              return updatedGenre;
            }
            return g;
          })
        );

        // Load albums for first few artists immediately
        const firstArtists = artistsWithAlbums.slice(0, 3);
        firstArtists.forEach((artist) => {
          loadArtistAlbums(genreSlug, artist.artist);
        });
      }
    } catch (err) {
      console.error(`failed to load artists for genre ${genreSlug}:`, err);
      setGenresWithArtists((prev) =>
        prev.map((g) =>
          g.slug === genreSlug ? { ...g, loading: false, loaded: false } : g
        )
      );
    }
  };

  // Load albums for a specific artist in a genre
  const loadArtistAlbums = async (genreSlug: string, artistName: string) => {
    try {
      setGenresWithArtists((prev) =>
        prev.map((g) =>
          g.slug === genreSlug
            ? {
                ...g,
                artists: g.artists.map((a) =>
                  a.artist === artistName ? { ...a, albumsLoading: true } : a
                ),
              }
            : g
        )
      );

      const response = await reactiveActions.searchGenres({
        genre_slug: genreSlug,
        artist: artistName,
        page: 1,
        page_size: 50,
      });

      if (response && "albums" in response) {
        setGenresWithArtists((prev) =>
          prev.map((g) => {
            if (g.slug === genreSlug) {
              const updatedGenre = {
                ...g,
                artists: g.artists.map((a) =>
                  a.artist === artistName
                    ? {
                        ...a,
                        albums: response.albums,
                        albumsLoading: false,
                        albumsLoaded: true,
                      }
                    : a
                ),
              };
              // Persist to global state
              globalGenreState.setLoadedGenre(g.slug, updatedGenre);
              return updatedGenre;
            }
            return g;
          })
        );
      }
    } catch (err) {
      console.error(
        `failed to load albums for artist ${artistName} in genre ${genreSlug}:`,
        err
      );
      setGenresWithArtists((prev) =>
        prev.map((g) =>
          g.slug === genreSlug
            ? {
                ...g,
                artists: g.artists.map((a) =>
                  a.artist === artistName
                    ? { ...a, albumsLoading: false, albumsLoaded: false }
                    : a
                ),
              }
            : g
        )
      );
    }
  };

  // Initialize genres with artists when main genres load
  createEffect(() => {
    const currentGenres = genres();
    if (currentGenres.length > 0) {
      const initialized = currentGenres.map((genre) => {
        // Check if we have previously loaded data for this genre
        const loadedGenre = globalGenreState.getLoadedGenre(genre.slug);
        if (loadedGenre) {
          return { ...genre, ...loadedGenre };
        }
        return {
          ...genre,
          artists: [],
          loading: false,
          loaded: false,
        };
      });
      setGenresWithArtists(initialized);

      // Load artists for expanded genres or first few genres
      const genresToLoad = initialized.filter((genre) => {
        const isExpanded =
          globalGenreState.expandAll ||
          globalGenreState.expandedGenres.has(genre.slug);
        const isUnloaded = !genre.loaded && !genre.loading;
        const isFirstFew = initialized.indexOf(genre) < 2;
        return (isExpanded || isFirstFew) && isUnloaded;
      });

      genresToLoad.forEach((genre) => {
        setGenresWithArtists((prev) =>
          prev.map((g) => (g.slug === genre.slug ? { ...g, loading: true } : g))
        );
        loadGenreArtists(genre.slug);
      });
    }
  });

  // Intersection observer for lazy loading
  const setupLazyLoading = (element: HTMLElement, genreSlug: string) => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry && entry.isIntersecting) {
          const genre = genresWithArtists().find((g) => g.slug === genreSlug);
          if (genre && !genre.loaded && !genre.loading) {
            setGenresWithArtists((prev) =>
              prev.map((g) =>
                g.slug === genre.slug ? { ...g, loading: true } : g
              )
            );
            loadGenreArtists(genre.slug);
          }
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(element);
  };

  return (
    <div
      class={`h-full flex flex-col bg-black text-white ${props.class || ""}`}
    >
      {/* Header */}
      <div class="flex-shrink-0 p-3 border-b border-gray-800/50">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-xl font-semibold text-white mb-1">genres</h1>
            <Show when={!loading() && !error()}>
              <p class="text-gray-300 text-sm">
                {genresWithArtists().length} genre
                {genresWithArtists().length !== 1 ? "s" : ""}
              </p>
            </Show>
            <Show when={loading() && genresWithArtists().length === 0}>
              <p class="text-gray-300 text-sm">loading genres...</p>
            </Show>
          </div>

          {/* Expand/Collapse All Button */}
          <Show when={genresWithArtists().length > 0}>
            <button
              class="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
              onClick={() => setExpandAll(!expandAll())}
            >
              {expandAll() ? "collapse all" : "expand all"}
            </button>
          </Show>
        </div>

        {/* Sort Controls */}
        {/* <div class="mb-2">
          <SearchSortControls
            sortBy={sortState.field}
            sortDirection={sortState.direction}
            onSortChange={handleSortChange}
            sortFields={sortFields}
            directionStyle="arrows"
            class="w-full"
          />
        </div> */}
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

      {/* Content */}
      <Show when={!error()}>
        <div
          ref={setScrollElement}
          class="flex-1 overflow-y-auto"
          onScroll={() => {
            // Throttled scroll saving
            clearTimeout((window as any).scrollSaveTimer);
            (window as any).scrollSaveTimer = setTimeout(
              saveScrollPosition,
              100
            );
          }}
        >
          <Show
            when={!loading() || genresWithArtists().length > 0}
            fallback={
              <div class="flex-1 flex items-center justify-center p-8">
                <div class="text-magenta-400">loading genres...</div>
              </div>
            }
          >
            <For each={genresWithArtists()}>
              {(genre) => (
                <div ref={(el) => setupLazyLoading(el, genre.slug)}>
                  {/* Genre Header */}
                  <div class="sticky top-0 bg-black border-l border-magenta-600 z-10 p-4 hover:bg-gray-900/50 transition-colors">
                    <div class="flex items-center justify-between">
                      <div
                        class="flex-1 cursor-pointer"
                        onClick={() => toggleGenre(genre.slug)}
                      >
                        <h2 class="text-lg font-semibold text-white mb-1">
                          {genre.name}
                        </h2>
                        <div class="flex items-center gap-4 text-sm text-gray-400">
                          <span>{formatCount(genre.song_count)} songs</span>
                          <span>{formatCount(genre.artist_count)} artists</span>
                          <span>{formatCount(genre.album_count)} albums</span>
                        </div>
                      </div>

                      {/* Play/Shuffle Buttons */}
                      <div class="flex items-center gap-2 ml-4">
                        <button
                          class="w-8 h-8 rounded-full bg-magenta-600 hover:bg-magenta-500 flex items-center justify-center transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            playGenre(genre.slug, false);
                          }}
                          title="play all songs in genre"
                        >
                          <svg
                            class="w-4 h-4 text-white ml-0.5"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>
                        <button
                          class="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            playGenre(genre.slug, true);
                          }}
                          title="shuffle all songs in genre"
                        >
                          <svg
                            class="w-4 h-4 text-white"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Artists */}
                  <Show when={isGenreExpanded(genre.slug)}>
                    <div class="px-4 py-4">
                      <Show when={genre.loading}>
                        <div class="py-6 text-center">
                          <div class="text-gray-400 text-sm">
                            loading albums...
                          </div>
                        </div>
                      </Show>

                      <Show when={genre.loaded && genre.artists.length > 0}>
                        <GenreAlbumGrid
                          albums={genre.artists.flatMap(
                            (artist) => artist.albums
                          )}
                          loading={genre.artists.some(
                            (artist) => artist.albumsLoading
                          )}
                          onAlbumClick={handleAlbumClick}
                          class=""
                        />
                      </Show>

                      <Show when={genre.loaded && genre.artists.length === 0}>
                        <div class="py-6 text-center">
                          <div class="text-gray-500 text-sm">
                            no albums found
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              )}
            </For>

            {/* Loading indicator - only show when no genres are loaded yet */}
            <Show when={loading() && genresWithArtists().length === 0}>
              <div class="text-center py-8">
                <div class="text-magenta-400 text-sm">loading genres...</div>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
