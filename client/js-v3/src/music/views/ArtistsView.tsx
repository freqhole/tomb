// artists view - displays all artists in a two-column layout with A-Z navigation
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
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../../components/cards/StatsCard";
import { SearchSortControls } from "../../components/controls/SearchSortControls";
import { HeadingSection } from "../../components/layout/HeadingSection";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { AlphabetNav } from "../../components/navigation/AlphabetNav";
import {
  VirtualItemList,
  type ListItem,
} from "../../components/virtualized/VirtualItemList";
import { getDataSource } from "../data";
import { playSong } from "../services/audio/player";
import { songsVersion } from "../services/storage/db";
import type { Song } from "../services/storage/types";
import { sortSongsByArtist } from "../utils/songSort";

export interface ArtistsViewProps {
  onAddMusic: () => void;
  onArtistClick?: (artistId: string) => void;
}

const artistSortFields = [
  { value: "name", label: "name", description: "sort by artist name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

export function ArtistsView(props: ArtistsViewProps) {
  const [selectedArtistId, setSelectedArtistId] = createSignal<string | null>(
    null,
  );
  const [sortBy, setSortBy] = createSignal("name");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");
  const [currentLetter, setCurrentLetter] = createSignal<string | null>(null);

  // fetch artists from data source - refetch when songsVersion changes
  const [artistsData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    if (!source.getArtists) {
      return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
    }
    return source.getArtists({ limit: 1000 });
  });

  // fetch songs for selected artist
  const [artistSongs] = createResource(selectedArtistId, async (artistId) => {
    if (!artistId) return [];
    const source = getDataSource();
    if (!source.getArtistSongs) return [];
    const result = await source.getArtistSongs(artistId, { limit: 100 });
    // sort canonically: by album, then disc+track
    return sortSongsByArtist(result.items);
  });

  // sort artists
  const sortedArtists = createMemo(() => {
    const data = artistsData();
    if (!data || !data.items.length) return [];

    const sorted = [...data.items];

    sorted.sort((a, b) => {
      const dir = sortDirection() === "asc" ? 1 : -1;

      switch (sortBy()) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "songCount":
          return (a.song_count - b.song_count) * dir;
        case "albumCount":
          return (a.album_count - b.album_count) * dir;
        default:
          return 0;
      }
    });

    return sorted;
  });

  // get selected artist data
  const selectedArtist = createMemo(() => {
    const id = selectedArtistId();
    if (!id) return null;
    return sortedArtists().find((a) => a.artist_id === id);
  });

  // convert to list items
  const artistListItems = createMemo((): ListItem[] => {
    return sortedArtists().map((artist) => ({
      id: artist.artist_id,
      title: artist.name,
      subtitle: `${formatNumber(artist.song_count)} songs · ${artist.album_count} albums`,
    }));
  });

  // calculate disabled letters for alphabet nav (only when sorted by name)
  const disabledLetters = createMemo(() => {
    if (sortBy() !== "name") return new Set<string>();

    const artists = sortedArtists();
    if (artists.length === 0) return new Set<string>();

    const disabledSet = new Set<string>();
    const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

    // build set of letters that DO have artists
    const enabledLetters = new Set<string>();
    artists.forEach((artist) => {
      const firstChar = artist.name[0]?.toUpperCase() || "";
      if (/[A-Z]/.test(firstChar)) {
        enabledLetters.add(firstChar);
      } else {
        enabledLetters.add("#");
      }
    });

    // disable letters that are NOT in the enabled set
    allLetters.forEach((letter) => {
      if (!enabledLetters.has(letter)) {
        disabledSet.add(letter);
      }
    });

    return disabledSet;
  });

  // auto-select first artist when data loads
  createEffect(() => {
    const artists = sortedArtists();
    if (artists.length > 0 && !selectedArtistId()) {
      setSelectedArtistId(artists[0].artist_id);
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

  // play all songs for selected artist
  const handlePlayAll = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    await setQueue(songs);
    await playSong(songs[0].song_id);
  };

  // shuffle all songs for selected artist
  const handleShuffle = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    const shuffled = shuffleArray(songs);
    await setQueue(shuffled);
    await playSong(shuffled[0].song_id);
  };

  // add all songs to end of queue
  const handleAddToQueue = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    const state = appState();
    const currentQueue = state?.queue || [];
    const newQueue = [...currentQueue, ...songs];
    await setQueue(newQueue);
  };

  // left column - artist list
  const leftColumn = (
    <div class="flex flex-col h-full">
      <HeadingSection
        title="artists"
        count={sortedArtists().length}
        controls={
          <SearchSortControls
            sortBy={sortBy()}
            sortDirection={sortDirection()}
            onSortChange={(field, direction) => {
              setSortBy(field);
              setSortDirection(direction);
            }}
            sortFields={artistSortFields}
          />
        }
      />

      <div class="flex-1 overflow-hidden">
        <Show
          when={artistListItems().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div class="text-center max-w-md">
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  no artists in your library yet
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
            items={artistListItems()}
            selectedId={selectedArtistId()}
            onItemClick={(item) => {
              setSelectedArtistId(item.id);
              props.onArtistClick?.(item.id);
            }}
            height={window.innerHeight - 120}
          />
        </Show>
      </div>
    </div>
  );

  // right column - artist detail
  const rightColumn = (
    <Show
      when={selectedArtist()}
      fallback={
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <svg
              class="w-24 h-24 mx-auto mb-4 opacity-30"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <p class="text-xl mb-2">select an artist</p>
            <p class="text-sm text-[var(--color-text-tertiary)]">
              choose from the list to see details
            </p>
          </div>
        </div>
      }
    >
      {(artist) => (
        <div class="flex flex-col h-full overflow-y-auto">
          {/* artist header with stats */}
          <div class="sticky top-0 z-10 bg-[var(--color-bg-primary)] border-b border-[var(--color-bg-tertiary)] p-6">
            <h2 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
              {artist().name}
            </h2>

            <StatsGrid columns={3} gap="md" class="mb-6">
              <StatsCard
                label="songs"
                value={formatNumber(artist().song_count)}
                icon="music"
              />
              <StatsCard
                label="albums"
                value={formatNumber(artist().album_count)}
                icon="album"
              />
              <StatsCard
                label="duration"
                value={formatDuration(artist().total_duration)}
                icon="recent"
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
              when={(artistSongs() || []).length > 0}
              fallback={
                <p class="text-[var(--color-text-tertiary)] text-sm">
                  loading songs...
                </p>
              }
            >
              <div class="space-y-1">
                <For each={artistSongs()?.slice(0, 20)}>
                  {(song) => (
                    <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                      <IconButton
                        icon="play"
                        size="sm"
                        variant="ghost"
                        aria-label="play song"
                        onClick={async () => {
                          const songs = artistSongs() || [];
                          await setQueue(songs);
                          await playSong(song.song_id);
                        }}
                      />
                      <div class="flex-1 min-w-0">
                        <div class="text-sm text-[var(--color-text-primary)] truncate">
                          {song.title}
                        </div>
                        <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                          {song.album_title}
                        </div>
                      </div>
                      <div class="text-xs text-[var(--color-text-muted)] tabular-nums">
                        {Math.floor(song.duration / 60)}:
                        {String(Math.floor(song.duration % 60)).padStart(
                          2,
                          "0",
                        )}
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

  // alphabet navigation (only shown when sorted by name)
  const alphabetNav =
    sortBy() === "name" ? (
      <AlphabetNav
        currentLetter={currentLetter()}
        disabledLetters={disabledLetters()}
        onLetterClick={(letter) => {
          setCurrentLetter(letter);
          // TODO: scroll to letter in list
          console.log("jump to letter:", letter);
        }}
        sortDirection={sortDirection()}
      />
    ) : undefined;

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            artists
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {artistsData()?.total ?? 0}{" "}
            {artistsData()?.total === 1 ? "artist" : "artists"}
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
          alphabetNav={alphabetNav}
          leftColumnWidth={320}
        />
      </div>
    </div>
  );
}
