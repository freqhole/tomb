// genres view - displays all genres in a two-column layout
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { appState, setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import { IconButton } from "../../components/buttons/IconButton";
import {
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../../components/cards/StatsCard";
import { SearchSortControls } from "../../components/controls/SearchSortControls";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { getDataSource } from "../data";
import { playSong } from "../services/audio/player";
import { songsVersion } from "../services/storage/db";
import type { Song } from "../services/storage/types";
import { sortSongsCanonical } from "../utils/songSort";

export interface GenresViewProps {
  onAddMusic: () => void;
  onGenreClick?: (genreId: string) => void;
}

const genreSortFields = [
  { value: "name", label: "name", description: "sort by genre name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

export function GenresView(props: GenresViewProps) {
  const [selectedGenreId, setSelectedGenreId] = createSignal<string | null>(
    null,
  );
  const [sortBy, setSortBy] = createSignal("name");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");

  // fetch genres from data source - refetch when songsVersion changes
  const [genresData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    if (!source.getGenres) {
      return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
    }
    return source.getGenres({ limit: 1000 });
  });

  // fetch songs for selected genre
  const [genreSongs] = createResource(selectedGenreId, async (genreId) => {
    if (!genreId) return [];
    const source = getDataSource();
    if (!source.getGenreSongs) return [];
    const result = await source.getGenreSongs(genreId, { limit: 100 });
    // sort canonically: by album, then disc+track
    return sortSongsCanonical(result.items);
  });

  // sort genres
  const sortedGenres = createMemo(() => {
    const data = genresData();
    if (!data || !data.items.length) return [];

    const sorted = [...data.items];
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
    await playSong(songs[0].song_id);
  };

  // shuffle all songs for selected genre
  const handleShuffle = async () => {
    const songs = genreSongs();
    if (!songs || songs.length === 0) return;

    const shuffled = shuffleArray(songs);
    await setQueue(shuffled);
    await playSong(shuffled[0].song_id);
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
              setSelectedGenreId(item.id);
              props.onGenreClick?.(item.id);
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
        <div class="flex flex-col h-full overflow-y-auto">
          {/* genre header with stats */}
          <div class="sticky top-0 z-10 bg-[var(--color-bg-primary)] border-b border-[var(--color-bg-tertiary)] p-6">
            <h2 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
              {genre().name}
            </h2>

            <StatsGrid columns={2} gap="md" class="mb-6">
              <StatsCard
                label="songs"
                value={formatNumber(genre().song_count)}
                icon="music"
              />
              <StatsCard
                label="albums"
                value={formatNumber(genre().album_count)}
                icon="album"
              />
            </StatsGrid>

            {/* action buttons */}
            <div class="flex gap-3">
              <Button variant="primary" onClick={handlePlayAll}>
                play all
              </Button>
              <Button variant="secondary" onClick={handleShuffle}>
                shuffle
              </Button>
              <Button variant="ghost" onClick={handleAddToQueue}>
                add to queue
              </Button>
            </div>
          </div>

          {/* top songs list */}
          <div class="flex-1 px-6 py-4 overflow-y-auto">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
                top songs
              </h3>
            </div>
            <Show
              when={(genreSongs() || []).length > 0}
              fallback={
                <p class="text-[var(--color-text-tertiary)] text-sm">
                  loading songs...
                </p>
              }
            >
              <div class="space-y-1">
                <For each={genreSongs()?.slice(0, 20)}>
                  {(song) => (
                    <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                      <IconButton
                        icon="play"
                        size="sm"
                        variant="ghost"
                        aria-label="play song"
                        onClick={() => {
                          const songs = genreSongs() || [];
                          void setQueue(songs);
                          void playSong(song.song_id);
                        }}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-[var(--color-text-primary)] truncate">
                          {song.title}
                        </div>
                        <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                          {song.artist_name} · {song.album_title}
                        </div>
                      </div>
                      <div class="text-xs text-[var(--color-text-muted)] tabular-nums">
                        {Math.floor(song.duration_seconds / 60)}:
                        {String(
                          Math.floor(song.duration_seconds % 60),
                        ).padStart(2, "0")}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            genres
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {genresData()?.total ?? 0}{" "}
            {genresData()?.total === 1 ? "genre" : "genres"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* two-column layout */}
      <div class="flex-1 overflow-hidden">
        <TwoColumnLayout
          leftColumn={leftColumn}
          rightColumn={rightColumn}
          leftColumnWidth={320}
        />
      </div>
    </div>
  );
}
