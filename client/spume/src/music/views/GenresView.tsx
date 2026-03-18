// genres view - displays all genres in a two-column layout with genre detail panel
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { playQueue, addToQueue } from "../services/queue/queue";
import { CheckCircleIcon } from "../../components/icons/registry";
import { LoadingState, LoadingMoreIndicator } from "../../components/feedback";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { useHistoryState } from "../../utils/historyState";
import { useViewportHeight, getNavHeight } from "../../utils/viewport";
import { Button } from "../../components/buttons/Button";
import { formatNumber } from "../../components/cards/StatsCard";
import { GenreDetailPanel } from "../../components/genres/GenreDetailPanel";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { VirtualItemList, type ListItem } from "../../components/virtualized/VirtualItemList";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { RemoteOfflineError } from "../data";
import { useGenreSongsQuery, useGenresQuery } from "../queries/songs";
import { useAlbumContextMenu, useGenreContextMenu } from "../hooks/contextMenu";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";
import { isNarrowViewport } from "../../config/breakpoints";

export interface GenresViewProps {
  onAddMusic: () => void;
}

const genreSortFields = [
  { value: "name", label: "name", description: "sort by genre name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

export function GenresView(props: GenresViewProps) {
  const navigate = useNavigate();
  const params = useParams<{ genreId?: string }>();
  const [searchParams] = useSearchParams();

  // reactive viewport height for safari toolbar handling
  const viewportHeight = useViewportHeight();
  const playerBarHeight = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const listHeight = () => viewportHeight() - getNavHeight() - playerBarHeight();

  // use genre from URL params, fallback to history state
  const initialGenreId =
    params.genreId ||
    (typeof window !== "undefined"
      ? (window.history.state?.selectedGenreId as string | null)
      : null);

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  // track whether detail is showing on narrow (for back navigation)
  // initialize to true if we have an initial ID and are on a narrow screen
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(
    isNarrowViewport() && !!initialGenreId
  );

  const [selectedGenreId, setSelectedGenreId] = createSignal<string | null>(initialGenreId);
  const [sortBy, setSortBy] = useHistoryState("genres.sortBy", "name");
  const [sortDirection, setSortDirection] = useHistoryState<"asc" | "desc">(
    "genres.sortDirection",
    "asc"
  );

  // store scrollToIndex function from virtualizer
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);

  // track if genre change is from local click (don't scroll) vs navigation (do scroll)
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  // track query changes to force list reset
  const [isResetting, setIsResetting] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      const narrow = isNarrowViewport();
      setIsNarrow(narrow);
      // reset detail view state when going from narrow to wide
      if (!narrow) {
        setShowingDetailOnNarrow(false);
      }
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // update selected genre when URL param changes and scroll to it (only if from navigation)
  createEffect(() => {
    const urlGenreId = params.genreId;

    if (urlGenreId && urlGenreId !== selectedGenreId()) {
      setSelectedGenreId(urlGenreId);

      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const genreIndex = sortedGenres().findIndex((g) => g.genre_id === urlGenreId);
        if (genreIndex >= 0) {
          scrollToIndex()!(genreIndex);
        }
      }

      // reset flag after capturing its value
      setIsLocalClick(false);
    }
  });

  // save selected genre to history state when it changes
  createEffect(() => {
    const genreId = selectedGenreId();
    if (genreId && typeof window !== "undefined") {
      const currentState = window.history.state || {};
      window.history.replaceState({ ...currentState, selectedGenreId: genreId }, "");
    }
  });

  // fetch genres using tanstack query (works with local + remote)
  const genresQuery = useGenresQuery({
    pageSize: 100,
    query: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // reset virtual list when query param changes
  createEffect(() => {
    // track query param changes to reset list
    searchParams.q; // read to create dependency
    // briefly show resetting state to force list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // auto-fetch next page when query becomes idle and has more data
  createEffect(
    on(
      () => ({
        hasNextPage: genresQuery.hasNextPage,
        isFetchingNextPage: genresQuery.isFetchingNextPage,
        isFetching: genresQuery.isFetching,
      }),
      (state) => {
        // automatically load more if there's more data and we're not already fetching
        if (state.hasNextPage && !state.isFetchingNextPage && !state.isFetching) {
          genresQuery.fetchNextPage();
        }
      }
    )
  );

  // flatten all pages of genres
  const genresData = createMemo(() => {
    const pages = genresQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // fetch songs for selected genre using tanstack query
  const genreSongsQuery = useGenreSongsQuery(() => selectedGenreId() ?? undefined);

  // map to expected format for detail panel
  const genreSongs = createMemo(() => {
    const result = genreSongsQuery.data;
    if (!result || result.items.length === 0) return [];
    return sortSongsCanonical(result.items);
  });

  // sort genres
  const sortedGenres = createMemo(() => {
    const data = genresData();
    if (!data || data.length === 0) return [];

    const sorted = [...data];
    const dir = sortDirection() === "asc" ? 1 : -1;
    const currentSortBy = sortBy();

    const compareGenres = (a: (typeof sorted)[0], b: (typeof sorted)[0]) => {
      switch (currentSortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "songCount":
          return (a.song_count - b.song_count) * dir;
        case "albumCount":
          return (a.album_count - b.album_count) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    };

    sorted.sort(compareGenres);

    return sorted;
  });

  // update page info for TopNav (mobile displays "genres (N)")
  createEffect(() => {
    const count = sortedGenres().length;
    setPageInfo({
      title: "genres",
      count,
      sortFields: genreSortFields,
      sortBy: sortBy(),
      sortDirection: sortDirection(),
      defaultSortBy: "name",
      defaultSortDirection: "asc",
      onSortChange: (field, direction) => {
        setSortBy(field);
        setSortDirection(direction);
      },
    });
  });

  // get selected genre data
  const selectedGenre = createMemo(() => {
    const id = selectedGenreId();
    if (!id) return null;
    return sortedGenres().find((g) => g.genre_id === id);
  });

  // convert to list items
  const genreListItems = createMemo((): ListItem[] => {
    return sortedGenres().map((genre) => ({
      id: genre.genre_id,
      title: genre.name,
      subtitle: `${formatNumber(genre.song_count)} songs · ${genre.album_count} albums`,
    }));
  });

  // auto-select first genre when data loads
  createEffect(() => {
    const genres = sortedGenres();
    if (genres.length > 0 && !selectedGenreId()) {
      setSelectedGenreId(genres[0].genre_id);
    }
  });

  // shuffle array helper
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // play all songs for selected genre
  const handlePlayAll = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;
    const genre = selectedGenre();
    await playQueue(songs, {
      source: { type: "genre", label: genre?.name ?? "genre", entity_id: genre?.genre_id },
    });
  };

  // shuffle all songs for selected genre
  const handleShuffle = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;
    const genre = selectedGenre();
    const shuffled = shuffleArray(songs);
    await playQueue(shuffled, {
      source: { type: "shuffle", label: genre?.name ?? "genre", entity_id: genre?.genre_id },
    });
  };

  // add all songs to end of queue
  const handleAddToQueue = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;
    const genre = selectedGenre();
    await addToQueue(songs, {
      source: { type: "genre", label: genre?.name ?? "genre", entity_id: genre?.genre_id },
    });
  };

  // navigate to album detail
  const handleAlbumClick = (albumId: string) => {
    navigate(buildRoute(`/albums/${albumId}`));
  };

  // play specific album
  const handlePlayAlbum = async (albumId: string) => {
    const songs = genreSongs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(songs);

    if (sortedSongs.length === 0) return;
    const albumTitle = sortedSongs[0]?.album_title ?? albumId;
    await playQueue(sortedSongs, {
      source: { type: "album", label: albumTitle, entity_id: albumId },
    });
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const songs = genreSongs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(songs);
    const albumTitle = sortedSongs[0]?.album_title ?? albumId;
    await addToQueue(sortedSongs, {
      source: { type: "album", label: albumTitle, entity_id: albumId },
    });
  };

  // toggle album favorite
  const favMutation = useToggleFavoriteMutation();
  const handleAlbumFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    favMutation.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
  };

  // navigate to artist detail
  const handleArtistClick = (artistId: string) => {
    navigate(buildRoute(`/artists/${artistId}`));
  };

  // handle back navigation on narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
  };

  // left column - genre list
  const leftColumn = (
    <>
      <div class="flex flex-col h-full">
        <div class="flex-1 overflow-hidden">
          <Show
            when={!genresQuery.isError}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  {genresQuery.error instanceof RemoteOfflineError ? (
                    <>
                      <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                        {(genresQuery.error as RemoteOfflineError).remoteName} is offline
                      </p>
                      <p class="text-sm text-[var(--color-text-muted)]">
                        switch to a different remote or use local library
                      </p>
                    </>
                  ) : (
                    <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                      failed to load genres
                    </p>
                  )}
                </div>
              </div>
            }
          >
          <Show
              when={genreListItems().length > 0}
              fallback={
                <Show
                  when={genresQuery.isLoading || genresQuery.isFetching}
                  fallback={
                    <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                      <div class="text-center max-w-md">
                        <p class="text-lg text-[var(--color-text-secondary)] mb-2">no genres found!</p>
                        <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                          add music to import local audio files or download from urls
                        </p>
                        <Button variant="primary" onClick={props.onAddMusic}>
                          add music
                        </Button>
                      </div>
                    </div>
                  }
                >
                  <div class="flex items-center justify-center h-full">
                    <LoadingState text="loading genres..." />
                  </div>
                </Show>
              }
            >
              <>
                <VirtualItemList
                  items={genreListItems()}
                  selectedId={selectedGenreId()}
                  scrollPaddingTop={100}
                  hideImage
                  onItemClick={(item) => {
                    setIsLocalClick(true);
                    // show detail on narrow viewport
                    if (isNarrow()) {
                      setShowingDetailOnNarrow(true);
                    }
                    navigate(buildRoute(`/genres/${item.id}`));
                  }}
                  onVirtualizerReady={(scrollFn) => {
                    setScrollToIndex(() => scrollFn);

                    // only scroll if current genre matches the initial one (prevents scroll on subsequent clicks)
                    const current = selectedGenreId();
                    if (current && current === initialGenreId) {
                      const index = sortedGenres().findIndex((g) => g.genre_id === current);
                      if (index >= 0) {
                        setTimeout(() => scrollFn(index), 50);
                      }
                    }
                  }}
                  getContextMenuActions={(item) => {
                    const genre = sortedGenres().find((g) => g.genre_id === item.id);
                    if (!genre) return [];

                    return useGenreContextMenu(
                      {
                        id: genre.genre_id,
                        name: genre.name,
                        song_count: genre.song_count,
                      },
                      {
                        isFavorite: false, // genres don't support favorites yet
                        onPlayAll: async () => {
                          // select this genre first
                          setSelectedGenreId(genre.genre_id);
                          // wait a tick for query to update
                          await new Promise((resolve) => setTimeout(resolve, 50));
                          // play all songs (limited to 100)
                          const songs = genreSongs().slice(0, 100);
                          if (songs.length === 0) return;
                          await playQueue(songs, {
                            source: { type: "genre", label: genre.name, entity_id: genre.genre_id },
                          });
                        },
                        onShuffle: async () => {
                          setSelectedGenreId(genre.genre_id);
                          await new Promise((resolve) => setTimeout(resolve, 50));
                          const songs = genreSongs().slice(0, 100);
                          if (songs.length === 0) return;
                          const shuffled = shuffleArray(songs);
                          await playQueue(shuffled, {
                            source: {
                              type: "shuffle",
                              label: genre.name,
                              entity_id: genre.genre_id,
                            },
                          });
                        },
                        onAddToQueue: async () => {
                          setSelectedGenreId(genre.genre_id);
                          await new Promise((resolve) => setTimeout(resolve, 50));
                          const songs = genreSongs().slice(0, 100);
                          if (songs.length === 0) return;
                          await addToQueue(songs, {
                            source: { type: "genre", label: genre.name, entity_id: genre.genre_id },
                          });
                        },
                      }
                    );
                  }}
                  height={listHeight()}
                />
                <LoadingMoreIndicator isLoading={genresQuery.isFetchingNextPage} />
              </>
            </Show>
          </Show>
        </div>
      </div>
    </>
  );

  // right column - genre detail
  // show loading if we have a selected ID but genre data isn't ready yet
  const isLoadingGenreData = () => selectedGenreId() && (genresQuery.isLoading || !selectedGenre());

  const rightColumn = (
    <Show
      when={selectedGenre()}
      fallback={
        <div class="flex items-center justify-center h-full">
          <Show
            when={!isLoadingGenreData()}
            fallback={
              <div class="text-center text-[var(--color-text-tertiary)]">
                <div class="animate-pulse">
                  <div class="w-24 h-24 mx-auto mb-4 rounded-full bg-[var(--color-bg-tertiary)]" />
                  <div class="w-32 h-4 mx-auto mb-2 rounded bg-[var(--color-bg-tertiary)]" />
                  <div class="w-48 h-3 mx-auto rounded bg-[var(--color-bg-tertiary)]" />
                </div>
              </div>
            }
          >
            <div class="text-center text-[var(--color-text-tertiary)]">
              <CheckCircleIcon size={96} className="mx-auto mb-4 opacity-30" />
              <p class="text-xl mb-2">select a genre</p>
              <p class="text-sm text-[var(--color-text-tertiary)]">
                choose from the list to see details
              </p>
            </div>
          </Show>
        </div>
      }
    >
      {(genre) => (
        <GenreDetailPanel
          genre={genre()}
          songs={genreSongs()}
          onPlayAll={handlePlayAll}
          onShuffle={handleShuffle}
          onAddToQueue={handleAddToQueue}
          onAlbumClick={handleAlbumClick}
          onPlayAlbum={handlePlayAlbum}
          onAlbumFavoriteToggle={handleAlbumFavoriteToggle}
          onAddAlbumToQueue={handleAddAlbumToQueue}
          onArtistClick={handleArtistClick}
          getAlbumContextMenuActions={(albumId) => {
            // find album info from songs
            const albumSongs = genreSongs().filter((s) => s.album_id === albumId);
            if (albumSongs.length === 0) return [];

            const firstSong = albumSongs[0];
            return useAlbumContextMenu(
              {
                id: albumId,
                title: firstSong.album_title,
                artist_name: firstSong.artist_name,
                artist_id: firstSong.artist_id,
                song_count: albumSongs.length,
              },
              { showPlayActions: true }
            );
          }}
          showBackButton={isNarrow() && showingDetailOnNarrow()}
          onBack={handleBack}
        />
      )}
    </Show>
  );

  return (
    <div class="flex flex-col" style={{ height: `${listHeight()}px` }}>
      {/* two-column layout - full height, handles its own scrolling */}
      <div class="flex-1 overflow-hidden">
        {isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <div class="text-[var(--color-text-secondary)]">loading...</div>
          </div>
        ) : (
          <TwoColumnLayout
            leftColumn={leftColumn}
            rightColumn={rightColumn}
            showDetail={showingDetailOnNarrow()}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
