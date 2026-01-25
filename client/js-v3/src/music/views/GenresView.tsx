// genres view - displays all genres in a two-column layout
// genres view - displays all genres in a two-column layout with genre detail panel
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { appState, setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { formatNumber } from "../../components/cards/StatsCard";
import { SearchSortControls } from "../../components/controls/SearchSortControls";
import { GenreDetailPanel } from "../../components/genres/GenreDetailPanel";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { getCurrentRemote, getDataSource } from "../data";
import { useGenreSongsQuery, useGenresQuery } from "../queries/songs";
import { playSong } from "../services/audio/player";
import {
  useAlbumContextMenu,
  useGenreContextMenu,
} from "../services/contextMenu";
import type { Song } from "../services/storage/types";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

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
  
  // use genre from URL params, fallback to history state
  const initialGenreId = params.genreId || 
    (typeof window !== "undefined" 
      ? (window.history.state?.selectedGenreId as string | null)
      : null);
    
  const [selectedGenreId, setSelectedGenreId] = createSignal<string | null>(
    initialGenreId,
  );
  const [sortBy, setSortBy] = createSignal("name");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");
  
  // store scrollToIndex function from virtualizer
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  
  // track if genre change is from local click (don't scroll) vs navigation (do scroll)
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  // track query changes to force list reset
  const [isResetting, setIsResetting] = createSignal(false);
  
  // update selected genre when URL param changes and scroll to it (only if from navigation)
  createEffect(() => {
    const urlGenreId = params.genreId;
    
    if (urlGenreId && urlGenreId !== selectedGenreId()) {
      setSelectedGenreId(urlGenreId);
      
      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const genreIndex = sortedGenres().findIndex(g => g.genre_id === urlGenreId);
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
      window.history.replaceState(
        { ...currentState, selectedGenreId: genreId },
        ""
      );
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
    const q = searchParams.q;
    const queryParam = Array.isArray(q) ? q[0] : q;
    // briefly show resetting state to force list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // flatten all pages of genres
  const genresData = createMemo(() => {
    const pages = genresQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // fetch songs for selected genre using tanstack query
  const genreSongsQuery = useGenreSongsQuery(() => selectedGenreId());

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

    await setQueue(songs);
    await playSong(songs[0]);
  };

  // shuffle all songs for selected genre
  const handleShuffle = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;

    const shuffled = shuffleArray(songs);
    await setQueue(shuffled);
    await playSong(shuffled[0]);
  };

  // add all songs to end of queue
  const handleAddToQueue = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;

    const state = appState();
    const currentQueue = state?.queue || [];
    const newQueue = [...currentQueue, ...songs];
    await setQueue(newQueue);
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
    await setQueue(sortedSongs);
    await playSong(sortedSongs[0]);
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const songs = genreSongs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(songs);

    const state = appState();
    const currentQueue = state?.queue || [];
    await setQueue([...currentQueue, ...sortedSongs]);
  };

  // navigate to artist detail
  const handleArtistClick = (artistId: string) => {
    navigate(buildRoute(`/artists/${artistId}`));
  };

  // left column - genre list
  const leftColumn = (
    <div class="flex flex-col h-full">
      <HeadingSection
        title="genres"
        count={sortedGenres().length}
        controls={
          <SearchSortControls
            sortBy={sortBy()}
            sortDirection={sortDirection()}
            onSortChange={(field, direction) => {
              setSortBy(field);
              setSortDirection(direction);
            }}
            sortFields={genreSortFields}
          />
        }
      />

      <div class="flex-1 overflow-hidden">
        <Show
          when={genreListItems().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div class="text-center max-w-md">
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  no genres in your library yet
                </p>
                <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                  click "add music" above to import local audio files or
                  download from urls
                </p>
                <Button variant="primary" onClick={props.onAddMusic}>
                  add music
                </Button>
              </div>
            </div>
          }
        >
          <VirtualItemList
            items={genreListItems()}
            selectedId={selectedGenreId()}
            onItemClick={(item) => {
              setIsLocalClick(true);
              navigate(buildRoute(`/genres/${item.id}`));
            }}
            onVirtualizerReady={(scrollFn) => {
              setScrollToIndex(() => scrollFn);
              
              // only scroll if current genre matches the initial one (prevents scroll on subsequent clicks)
              const current = selectedGenreId();
              if (current && current === initialGenreId) {
                const index = sortedGenres().findIndex(g => g.genre_id === current);
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
                    await setQueue(songs);
                    await playSong(songs[0]);
                  },
                  onShuffle: async () => {
                    setSelectedGenreId(genre.genre_id);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    const songs = genreSongs().slice(0, 100);
                    if (songs.length === 0) return;
                    const shuffled = shuffleArray(songs);
                    await setQueue(shuffled);
                    await playSong(shuffled[0]);
                  },
                  onAddToQueue: async () => {
                    setSelectedGenreId(genre.genre_id);
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    const songs = genreSongs().slice(0, 100);
                    if (songs.length === 0) return;
                    const state = appState();
                    const currentQueue = state?.queue || [];
                    await setQueue([...currentQueue, ...songs]);
                  },
                },
              );
            }}
            height={window.innerHeight - 120}
          />
        </Show>
      </div>
    </div>
  );

  // right column - genre detail
  const rightColumn = (
    <Show
      when={selectedGenre()}
      fallback={
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <svg
              class="w-24 h-24 mx-auto mb-4 opacity-30"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <p class="text-xl mb-2">select a genre</p>
            <p class="text-sm text-[var(--color-text-tertiary)]">
              choose from the list to see details
            </p>
          </div>
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
          onAddAlbumToQueue={handleAddAlbumToQueue}
          onArtistClick={handleArtistClick}
          getAlbumContextMenuActions={(albumId) => {
            // find album info from songs
            const albumSongs = genreSongs().filter(
              (s) => s.album_id === albumId,
            );
            if (albumSongs.length === 0) return [];

            const firstSong = albumSongs[0];
            return useAlbumContextMenu(
              {
                id: albumId,
                title: firstSong.album_title,
                artist_name: firstSong.artist_name,
                song_count: albumSongs.length,
              },
              { showPlayActions: true },
            );
          }}
        />
      )}
    </Show>
  );

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 ml-[150px]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            genres
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {genresData().length ?? 0}{" "}
            {genresData().length === 1 ? "genre" : "genres"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        {isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <div class="text-[var(--color-text-secondary)]">loading...</div>
          </div>
        ) : (
          <TwoColumnLayout leftColumn={leftColumn} rightColumn={rightColumn} />
        )}
      </div>
    </div>
  );
}
