import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import {
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../src/components/cards/StatsCard";
import { SearchSortControls } from "../src/components/controls/SearchSortControls";
import { HeadingSection } from "../src/components/layout/HeadingSection";
import { ResponsiveMasterDetail } from "../src/components/layout/TwoColumnLayout";
import { DraggableRow, DraggableRowSongContent } from "../src/components/lists/DraggableRow";
import { AlphabetNav } from "../src/components/navigation/AlphabetNav";
import { TopNav } from "../src/components/navigation/TopNav";
import { TopNavSearch } from "../src/components/navigation/TopNavSearch";
import { PlayerBar } from "../src/components/player/PlayerBar";
import { QueueSidebar } from "../src/components/player/QueueSidebar";
import { VirtualAlbumGrid } from "../src/components/virtualized/VirtualAlbumGrid";
import { VirtualSongList } from "../src/components/virtualized/VirtualSongList";
import { AlbumGraphCanvas, type GraphActions } from "../src/components/graph/AlbumGraphCanvas";
import { AlbumDetailPopover } from "../src/components/graph/AlbumDetailPopover";
import { GraphTopNavTools, type GraphTool } from "../src/components/graph/GraphTopNavTools";
import {
  buildRelationEdges,
  countEdgesByKind,
  RELATION_KINDS,
} from "../src/components/graph/relations";
import type { AlbumNodeData, GraphEdge, RelationKindLike } from "../src/components/graph/types";
import { MEDIUM_GRAPH } from "./mockGraphData";
import type { Song as DomainSong } from "../src/music/data/types";
import { isNarrowViewport } from "../src/config/breakpoints";
import {
  generateBulkSongs,
  mockAlbums,
  mockArtists,
  mockGenres,
  mockPlaylists,
  type Artist,
  type Genre,
  type Playlist,
} from "./mockData";

// alias the domain Song for compatibility with existing code
type Song = DomainSong;

const meta = {
  title: "Super Story",
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// generate reusable mock songs
const generatedSongs = generateBulkSongs(100);

type Route = "songs" | "albums" | "artists" | "genres" | "playlists" | "favorites";

const artistSortFields = [
  { value: "name", label: "name", description: "sort by artist name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

const genreSortFields = [
  { value: "name", label: "name", description: "sort by genre name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  {
    value: "artistCount",
    label: "artists",
    description: "sort by artist count",
  },
];

/**
 * comprehensive demo showcasing all major components working together:
 * - top navigation bar with main sections
 * - two-column layout with alphabet navigation
 * - artist list with sorting and selection
 * - artist detail panel with stats cards
 * - draggable playlist rows
 * - interactive buttons and controls
 */
export const FullAppDemo: Story = {
  render: () => {
    // navigation state
    const [currentRoute, setCurrentRoute] = createSignal<Route>("songs");
    const [_topNavOpen, setTopNavOpen] = createSignal(false);

    // player state
    const [currentSong, setCurrentSong] = createSignal<Song | null>(generatedSongs[0]);
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [volume, setVolume] = createSignal(0.75);
    const [currentTime, setCurrentTime] = createSignal(45);
    const [queueOpen, setQueueOpen] = createSignal(false);
    const [queueSongs, setQueueSongs] = createSignal<Song[]>(generatedSongs.slice(0, 20));
    const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);

    // responsive: track if viewport is narrow (<= 800px)
    const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

    onMount(() => {
      const handleResize = () => {
        setIsNarrow(isNarrowViewport());
      };
      window.addEventListener("resize", handleResize);
      onCleanup(() => window.removeEventListener("resize", handleResize));
    });

    // compute page title and count based on current route
    const pageInfo = () => {
      switch (currentRoute()) {
        case "songs":
          return { title: "songs", count: generatedSongs.length };
        case "albums":
          return { title: "albums", count: mockAlbums.length };
        case "artists":
          return { title: "artists", count: mockArtists.length };
        case "genres":
          return { title: "genres", count: mockGenres.length };
        case "playlists":
          return { title: "playlists", count: mockPlaylists.length };
        case "favorites":
          // mock: assume 25 favorites
          return { title: "favorites", count: 25 };
        default:
          return { title: undefined, count: undefined };
      }
    };

    // artists view state
    const [_selectedArtist, _setSelectedArtist] = createSignal<Artist | null>(mockArtists[0]);
    const [artistSortBy, setArtistSortBy] = createSignal("name");
    const [artistSortDirection, setArtistSortDirection] = createSignal<"asc" | "desc">("asc");
    const [currentLetter, setCurrentLetter] = createSignal<string | undefined>();
    const [playlistSongs, setPlaylistSongs] = createSignal<Song[]>(generatedSongs.slice(0, 10));
    const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
    const [selectedSongIds, setSelectedSongIds] = createSignal<Set<string>>(new Set());

    // genres view state
    const [_selectedGenre, _setSelectedGenre] = createSignal<Genre | null>(mockGenres[0]);
    const [genreSortBy, setGenreSortBy] = createSignal("name");
    const [genreSortDirection, setGenreSortDirection] = createSignal<"asc" | "desc">("asc");

    // playlists view state
    const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(mockPlaylists[0]);

    // search state
    const [searchValue, setSearchValue] = createSignal("");
    const mockSearchSuggestions = () => {
      const query = searchValue().toLowerCase();
      if (!query || query.length < 2) return [];

      // filter mock data based on search query
      const artistSuggestions = mockArtists
        .filter((a) => a.name.toLowerCase().includes(query))
        .slice(0, 3)
        .map((a) => ({
          id: `artist-${a.id}`,
          text: a.name,
          category: "artists",
          highlight: a.name.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
          count: a.songCount,
        }));

      const songSuggestions = generatedSongs
        .filter(
          (s) =>
            s.title.toLowerCase().includes(query) || s.artist_name?.toLowerCase().includes(query)
        )
        .slice(0, 3)
        .map((s) => ({
          id: `song-${s.id}`,
          text: s.title,
          category: "songs",
          highlight: s.title.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
        }));

      const albumSuggestions = mockAlbums
        .filter((a) => a.title.toLowerCase().includes(query))
        .slice(0, 3)
        .map((a) => ({
          id: `album-${a.id}`,
          text: a.title,
          category: "albums",
          highlight: a.title.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
        }));

      return [...artistSuggestions, ...songSuggestions, ...albumSuggestions];
    };

    // sort artists
    const sortedArtists = () => {
      const artists = [...mockArtists];
      const field = artistSortBy() as keyof Artist;
      const dir = artistSortDirection();

      artists.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];

        if (typeof aVal === "string" && typeof bVal === "string") {
          return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }

        if (typeof aVal === "number" && typeof bVal === "number") {
          return dir === "asc" ? aVal - bVal : bVal - aVal;
        }

        return 0;
      });

      return artists;
    };

    // sort genres
    const sortedGenres = () => {
      const genres = [...mockGenres];
      const field = genreSortBy() as keyof Genre;
      const dir = genreSortDirection();

      genres.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];

        if (typeof aVal === "string" && typeof bVal === "string") {
          return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }

        if (typeof aVal === "number" && typeof bVal === "number") {
          return dir === "asc" ? aVal - bVal : bVal - aVal;
        }

        return 0;
      });

      return genres;
    };

    // get disabled letters for alphabet nav
    const disabledLetters = () => {
      const letters = new Set<string>();
      const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

      allLetters.forEach((letter) => {
        const hasArtist = sortedArtists().some((artist) => {
          const firstChar = artist.name.charAt(0).toUpperCase();
          if (letter === "#") {
            return !/[A-Z]/.test(firstChar);
          }
          return firstChar === letter;
        });
        if (!hasArtist) {
          letters.add(letter);
        }
      });

      return letters;
    };

    // drag and drop handlers for playlist
    const handleDragStart = (index: number) => (e: DragEvent) => {
      setDraggedIndex(index);
      e.dataTransfer!.effectAllowed = "move";
    };

    const handleDragOver = (index: number) => (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      setDropTargetIndex(index);
    };

    const handleDragLeave = () => {
      setDropTargetIndex(null);
    };

    const handleDrop = (dropIndex: number) => (e: DragEvent) => {
      e.preventDefault();
      const dragIndex = draggedIndex();

      if (dragIndex === null || dragIndex === dropIndex) {
        setDraggedIndex(null);
        setDropTargetIndex(null);
        return;
      }

      const reordered = [...playlistSongs()];
      const [draggedSong] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, draggedSong);

      setPlaylistSongs(reordered);
      setDraggedIndex(null);
      setDropTargetIndex(null);
    };

    const handleSongClick = (song: Song) => () => {
      const newSelected = new Set(selectedSongIds());
      if (newSelected.has(song.id)) {
        newSelected.delete(song.id);
      } else {
        newSelected.add(song.id);
      }
      setSelectedSongIds(newSelected);
    };

    const handleRemoveSong = (song: Song) => (e: MouseEvent) => {
      e.stopPropagation();
      setPlaylistSongs(playlistSongs().filter((s) => s.id !== song.id));
    };

    // route handlers
    const navigateTo = (route: Route) => {
      setCurrentRoute(route);
      setTopNavOpen(false); // close topnav after navigation
    };

    // player handlers
    const handlePlayPause = () => {
      setIsPlaying(!isPlaying());
    };

    const handleSkip = (direction: "prev" | "next") => {
      const song = currentSong();
      if (!song) return;

      const currentIndex = generatedSongs.findIndex((s) => s.sha256 === song.sha256);
      if (direction === "prev" && currentIndex > 0) {
        setCurrentSong(generatedSongs[currentIndex - 1]);
      } else if (direction === "next" && currentIndex < generatedSongs.length - 1) {
        setCurrentSong(generatedSongs[currentIndex + 1]);
      }
    };

    const handleQueueSongClick = (index: number) => {
      const song = queueSongs()[index];
      if (song) {
        setCurrentSong(song);
        setIsPlaying(true);
        setCurrentQueueIndex(index);
      }
    };

    const handleRemoveFromQueue = (index: number) => {
      setQueueSongs(queueSongs().filter((_, i) => i !== index));
      if (index < currentQueueIndex()) {
        setCurrentQueueIndex(currentQueueIndex() - 1);
      }
    };

    // ===== ARTISTS VIEW (using ResponsiveMasterDetail) =====
    const artistsView = () => (
      <ResponsiveMasterDetail<Artist>
        items={sortedArtists}
        initialSelection={mockArtists[0]}
        getItemKey={(a) => a.id}
        alphabetNav={
          artistSortBy() === "name" ? (
            <div class="mt-2 wide:mt-[60px]">
              <AlphabetNav
                currentLetter={currentLetter()}
                disabledLetters={disabledLetters()}
                onLetterClick={(letter) => {
                  setCurrentLetter(letter);
                  console.log("jump to letter:", letter);
                }}
                sortDirection={artistSortDirection()}
              />
            </div>
          ) : undefined
        }
        renderList={(ctx) => (
          <div class="flex flex-col h-full mt-2 wide:mt-[60px]">
            <HeadingSection
              title="artists"
              count={sortedArtists().length}
              hideOnNarrow
              controls={
                <SearchSortControls
                  sortBy={artistSortBy()}
                  sortDirection={artistSortDirection()}
                  onSortChange={(field, direction) => {
                    setArtistSortBy(field);
                    setArtistSortDirection(direction);
                  }}
                  sortFields={artistSortFields}
                />
              }
            />

            <div class="flex-1 overflow-y-auto">
              <For each={sortedArtists()}>
                {(artist) => (
                  <button
                    class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === artist.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(artist)}
                  >
                    <div class="font-medium">{artist.name}</div>
                    <div class="text-xs text-[var(--color-text-tertiary)]">
                      {formatNumber(artist.songCount)} songs · {artist.albumCount} albums
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        renderDetail={(ctx) => (
          <Show when={ctx.selectedItem()}>
            {(artist) => (
              <div class="flex flex-col h-full">
                {/* sticky header with back button + title */}
                <HeadingSection
                  title={artist().name}
                  variant="detail"
                  sticky
                  border
                  showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                  onBack={() => ctx.onBack()}
                />

                {/* scrollable content area */}
                <div class="flex-1 overflow-y-auto">
                  {/* stats section */}
                  <div class="p-3 wide:p-6">
                    <StatsGrid columns={5} gap="md" class="mb-3 wide:mb-6">
                      <StatsCard
                        label="songs"
                        value={formatNumber(artist().songCount)}
                        icon="music"
                      />
                      <StatsCard
                        label="albums"
                        value={formatNumber(artist().albumCount)}
                        icon="album"
                      />
                      <StatsCard
                        label="duration"
                        value={formatDuration(artist().totalDuration)}
                        icon="recent"
                      />
                      <StatsCard
                        label="avg rating"
                        value={artist().avgRating.toFixed(1)}
                        icon="star"
                        subtitle="out of 5.0"
                      />
                      <StatsCard
                        label="genres"
                        value={artist().genres[0]}
                        subtitle={artist().genres.slice(1).join(", ")}
                      />
                    </StatsGrid>
                  </div>

                  {/* top songs list */}
                  <div class="px-3 wide:px-6 pb-4">
                    <div class="mb-3 flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
                        top songs
                      </h3>
                    </div>
                    <div class="space-y-1">
                      <For each={generatedSongs.slice(0, 10)}>
                        {(song) => (
                          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                            <IconButton
                              icon="play"
                              size="sm"
                              variant="ghost"
                              aria-label="play song"
                            />
                            <div class="flex-1 min-w-0">
                              <div class="body-small text-[var(--color-text-primary)] truncate">
                                {song.title}
                              </div>
                              <div class="caption truncate">{song.album_title}</div>
                            </div>
                            <div class="monospace caption text-[var(--color-text-muted)]">
                              {formatDuration(song.duration_seconds)}
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                {/* sticky action buttons */}
                <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                  <Button variant="primary" onClick={() => console.log("play all songs")}>
                    <span class="hidden wide:inline">play all</span>
                    <span class="wide:hidden">play</span>
                  </Button>
                  <Button variant="secondary" onClick={() => console.log("shuffle")}>
                    shuffle
                  </Button>
                  <Button variant="ghost" onClick={() => console.log("add to queue")}>
                    <span class="hidden wide:inline">add to queue</span>
                    <span class="wide:hidden">+queue</span>
                  </Button>
                </div>
              </div>
            )}
          </Show>
        )}
        renderEmpty={() => (
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
        )}
      />
    );

    // ===== GENRES VIEW (using ResponsiveMasterDetail) =====
    const genresView = () => (
      <ResponsiveMasterDetail<Genre>
        items={sortedGenres}
        initialSelection={mockGenres[0]}
        getItemKey={(g) => g.id}
        renderList={(ctx) => (
          <div class="flex flex-col h-full">
            <div class="mt-2 wide:mt-[60px]">
              <HeadingSection
                title="genres"
                count={sortedGenres().length}
                hideOnNarrow
                controls={
                  <SearchSortControls
                    sortBy={genreSortBy()}
                    sortDirection={genreSortDirection()}
                    onSortChange={(field, direction) => {
                      setGenreSortBy(field);
                      setGenreSortDirection(direction);
                    }}
                    sortFields={genreSortFields}
                  />
                }
              />
            </div>

            <div class="flex-1 overflow-y-auto">
              <For each={sortedGenres()}>
                {(genre) => (
                  <button
                    class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === genre.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(genre)}
                  >
                    <div class="font-medium">{genre.name}</div>
                    <div class="text-xs text-[var(--color-text-tertiary)]">
                      {formatNumber(genre.songCount)} songs · {genre.artistCount} artists
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        renderDetail={(ctx) => (
          <Show when={ctx.selectedItem()}>
            {(genre) => (
              <div class="flex flex-col h-full">
                {/* sticky header with back button + title */}
                <HeadingSection
                  title={genre().name}
                  variant="detail"
                  sticky
                  border
                  showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                  onBack={() => ctx.onBack()}
                />

                {/* scrollable content area */}
                <div class="flex-1 overflow-y-auto">
                  {/* stats section */}
                  <div class="p-3 wide:p-6">
                    <StatsGrid columns={4} gap="md">
                      <StatsCard
                        label="songs"
                        value={formatNumber(genre().songCount)}
                        icon="music"
                      />
                      <StatsCard
                        label="artists"
                        value={formatNumber(genre().artistCount)}
                        icon="artist"
                      />
                      <StatsCard
                        label="albums"
                        value={formatNumber(genre().albumCount)}
                        icon="album"
                      />
                      <StatsCard
                        label="duration"
                        value={formatDuration(genre().totalDuration)}
                        icon="recent"
                      />
                    </StatsGrid>
                  </div>

                  {/* top songs */}
                  <div class="px-3 wide:px-6 pb-4">
                    <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                      top songs
                    </h3>
                    <div class="space-y-1">
                      <For each={generatedSongs.slice(0, 15)}>
                        {(song) => (
                          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                            <IconButton icon="play" size="sm" variant="ghost" aria-label="play" />
                            <div class="flex-1 min-w-0">
                              <div class="body-small text-[var(--color-text-primary)] truncate">
                                {song.title}
                              </div>
                              <div class="caption truncate">{song.artist_name}</div>
                            </div>
                            <div class="monospace caption text-[var(--color-text-muted)]">
                              {formatDuration(song.duration_seconds)}
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>

                {/* sticky action buttons */}
                <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                  <Button variant="primary">
                    <span class="hidden wide:inline">play all</span>
                    <span class="wide:hidden">play</span>
                  </Button>
                  <Button variant="secondary">shuffle</Button>
                  <Button variant="ghost">
                    <span class="hidden wide:inline">add to queue</span>
                    <span class="wide:hidden">+queue</span>
                  </Button>
                </div>
              </div>
            )}
          </Show>
        )}
        renderEmpty={() => (
          <div class="flex items-center justify-center h-full">
            <div class="text-center text-[var(--color-text-tertiary)]">
              <p class="text-xl mb-2">select a genre</p>
              <p class="text-sm">choose from the list to see details</p>
            </div>
          </div>
        )}
      />
    );

    // ===== PLAYLISTS VIEW (using ResponsiveMasterDetail - controlled mode) =====
    // uses controlled selection so TopNav "recent playlists" can select playlists
    const playlistsView = () => (
      <ResponsiveMasterDetail<Playlist>
        items={mockPlaylists}
        selection={selectedPlaylist}
        onSelectionChange={setSelectedPlaylist}
        getItemKey={(p) => p.id}
        renderList={(ctx) => (
          <div class="flex flex-col h-full">
            <div class="mt-2 wide:mt-[60px]">
              <HeadingSection title="playlists" count={mockPlaylists.length} hideOnNarrow />
            </div>

            <div class="flex-1 overflow-y-auto">
              <For each={mockPlaylists}>
                {(playlist) => (
                  <button
                    class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === playlist.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(playlist)}
                  >
                    <div class="font-medium">{playlist.name}</div>
                    <div class="text-xs text-[var(--color-text-tertiary)]">
                      {playlist.songCount} songs · {formatDuration(playlist.duration)}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        renderDetail={(ctx) => (
          <Show when={ctx.selectedItem()}>
            {(playlist) => (
              <div class="flex flex-col h-full">
                {/* sticky header with back button + title */}
                <HeadingSection
                  title={playlist().name}
                  variant="detail"
                  sticky
                  border
                  showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                  onBack={() => ctx.onBack()}
                />

                {/* scrollable content area */}
                <div class="flex-1 overflow-y-auto">
                  {/* stats section */}
                  <div class="p-3 wide:p-6 flex gap-4">
                    <StatsCard
                      label="songs"
                      value={formatNumber(playlist().songCount)}
                      variant="compact"
                    />
                    <StatsCard
                      label="duration"
                      value={formatDuration(playlist().duration)}
                      variant="compact"
                    />
                    <StatsCard
                      label="created"
                      value={new Date(playlist().createdAt).toLocaleDateString()}
                      variant="compact"
                    />
                  </div>

                  {/* songs list */}
                  <div class="px-3 wide:px-6 pb-4">
                    <div class="mb-3 flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">songs</h3>
                      <div class="text-sm text-[var(--color-text-secondary)]">drag to reorder</div>
                    </div>
                    <div class="space-y-1">
                      <For each={playlistSongs()}>
                        {(song, index) => (
                          <DraggableRow
                            id={song.id}
                            index={index()}
                            isDragging={draggedIndex() === index()}
                            isDropTarget={dropTargetIndex() === index()}
                            isSelected={selectedSongIds().has(song.id)}
                            onDragStart={handleDragStart(index())}
                            onDragOver={handleDragOver(index())}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop(index())}
                            onClick={handleSongClick(song)}
                          >
                            <DraggableRowSongContent
                              title={song.title}
                              artist={song.artist_name}
                              album={song.album_title}
                              durationSeconds={song.duration_seconds}
                              actions={
                                <>
                                  <IconButton
                                    icon="queue"
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e: MouseEvent) => {
                                      e.stopPropagation();
                                    }}
                                    aria-label="add to queue"
                                  />
                                  <IconButton
                                    icon="delete"
                                    size="sm"
                                    variant="ghost"
                                    onClick={handleRemoveSong(song)}
                                    aria-label="remove"
                                  />
                                </>
                              }
                            />
                          </DraggableRow>
                        )}
                      </For>
                    </div>
                    <div class="mt-4 text-xs text-[var(--color-text-tertiary)]">
                      {playlistSongs().length} songs • {selectedSongIds().size} selected
                    </div>
                  </div>
                </div>

                {/* sticky action buttons */}
                <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                  <Button variant="primary">play</Button>
                  <Button variant="secondary">shuffle</Button>
                  <Button variant="ghost">edit</Button>
                </div>
              </div>
            )}
          </Show>
        )}
        renderEmpty={() => (
          <div class="flex items-center justify-center h-full">
            <div class="text-center text-[var(--color-text-tertiary)]">
              <p class="text-xl mb-2">select a playlist</p>
              <p class="text-sm">choose from the list to see details</p>
            </div>
          </div>
        )}
      />
    );

    // ===== SONGS VIEW =====
    const songsView = () => (
      <div class="p-3">
        <div class="ml-0 wide:ml-[100px]">
          <HeadingSection title="songs" count={generatedSongs.length} hideOnNarrow />
        </div>
        <div class="mt-2 wide:mt-6">
          <VirtualSongList
            songs={generatedSongs}
            height={window.innerHeight - 240}
            onSongClick={(song) => {
              setCurrentSong(song);
            }}
            onSongDoubleClick={(song) => {
              setCurrentSong(song);
              setIsPlaying(true);
            }}
          />
        </div>
      </div>
    );

    // ===== ALBUMS VIEW =====
    const albumsView = () => (
      <div class="p-3">
        <div class="ml-0 wide:ml-[100px]">
          <HeadingSection title="albums" count={mockAlbums.length} hideOnNarrow />
        </div>
        <div class="mt-2 wide:mt-0">
          <VirtualAlbumGrid
            albums={mockAlbums.map((a) => ({
              id: a.id,
              title: a.title,
              domainType: "album" as const,
              imageUrl: a.thumbnailUrl,
              artist: a.artist,
              album: a.title,
              year: a.year,
              trackCount: a.trackCount,
              totalDuration: formatDuration(a.duration),
              genres: "rock",
              playCount: 100,
            }))}
            height={window.innerHeight - 180}
            cardSize="medium"
            showYear={true}
            onAlbumClick={(album) => {
              console.log("album clicked:", album.title);
            }}
            onAlbumPlay={(album) => {
              console.log("play album:", album.title);
            }}
          />
        </div>
      </div>
    );

    // ===== FAVORITES VIEW =====
    const favoriteSongs = generatedSongs.slice(0, 25); // mock: first 25 songs as favorites
    const favoritesView = () => (
      <div class="p-3">
        <div class="ml-0 wide:ml-[100px]">
          <HeadingSection title="favorites" count={favoriteSongs.length} hideOnNarrow />
        </div>
        <div class="mt-2 wide:mt-6">
          <VirtualSongList
            songs={favoriteSongs}
            height={window.innerHeight - 240}
            onSongClick={(song) => {
              setCurrentSong(song);
            }}
            onSongDoubleClick={(song) => {
              setCurrentSong(song);
              setIsPlaying(true);
            }}
          />
        </div>
      </div>
    );

    // determine which view to show
    const mainContent = () => {
      switch (currentRoute()) {
        case "songs":
          return songsView();
        case "albums":
          return albumsView();
        case "favorites":
          return favoritesView();
        case "artists":
          return artistsView();
        case "genres":
          return genresView();
        case "playlists":
          return playlistsView();
        default:
          return artistsView();
      }
    };

    const playerBarHeight = () => "var(--player-height)";

    return (
      <div
        class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
        style={{ "--player-bar-height": playerBarHeight() }}
      >
        {/* top navigation */}
        <TopNav
          brandName="freqhole"
          brandTagline="your music library"
          searchPlaceholder="search artists, albums, songs..."
          searchComponent={
            <TopNavSearch
              placeholder="search artists, albums, songs..."
              suggestions={mockSearchSuggestions()}
              onSearchChange={setSearchValue}
              onNavigate={(path) => console.log("navigate:", path)}
              currentPath={`/${currentRoute()}`}
            />
          }
          onSearchChange={(query) => console.log("search:", query)}
          onSearchSubmit={(query) => console.log("search submit:", query)}
          currentPath={`/${currentRoute()}`}
          onNavigate={(path) => {
            // map topnav's built-in route buttons (library / shared / feed
            // / settings) onto the demo's Route set so they actually
            // change the visible view instead of silently no-op'ing.
            if (path.startsWith("/library")) navigateTo("albums");
            else if (path.startsWith("/shared")) navigateTo("playlists");
            else if (path.startsWith("/feed")) navigateTo("songs");
            else if (path.startsWith("/favorites")) navigateTo("favorites");
            else if (path.startsWith("/songs")) navigateTo("songs");
            else if (path.startsWith("/albums")) navigateTo("albums");
            else if (path.startsWith("/artists")) navigateTo("artists");
            else if (path.startsWith("/genres")) navigateTo("genres");
            else if (path.startsWith("/playlists")) navigateTo("playlists");
            else console.log("navigate (unhandled):", path);
          }}
          mainNavSections={[
            {
              items: [
                {
                  label: "songs",
                  onClick: () => navigateTo("songs"),
                },
                {
                  label: "albums",
                  onClick: () => navigateTo("albums"),
                },
                {
                  label: "artists",
                  onClick: () => navigateTo("artists"),
                },
                {
                  label: "genres",
                  onClick: () => navigateTo("genres"),
                },
                {
                  label: "playlists",
                  onClick: () => navigateTo("playlists"),
                },
                {
                  label: "favorites",
                  onClick: () => navigateTo("favorites"),
                },
              ],
            },
          ]}
          recentPlaylists={mockPlaylists.slice(0, 5).map((playlist, index) => ({
            id: playlist.id,
            name: playlist.name,
            thumbnailUrl: null,
            updatedAt: Date.now() - index * 3600000,
            onClick: () => {
              navigateTo("playlists");
              setSelectedPlaylist(playlist);
            },
          }))}
          onViewAllPlaylists={() => navigateTo("playlists")}
          pageTitle={pageInfo().title}
          pageCount={pageInfo().count}
        />

        {/* main content area + queue */}
        <div
          class="flex-1 overflow-hidden flex"
          style={{
            "padding-top": isNarrow() ? "var(--nav-height)" : undefined,
            "padding-bottom": "var(--player-bar-height)",
          }}
        >
          {/* main content */}
          <div class="flex-1 overflow-hidden">{mainContent()}</div>

          {/* queue sidebar - responsive: bottom sheet on narrow, sidebar on wide */}
          <QueueSidebar
            isOpen={queueOpen()}
            variant="overlay"
            songs={queueSongs()}
            currentIndex={currentQueueIndex()}
            onClose={() => setQueueOpen(false)}
            onSongClick={handleQueueSongClick}
            onRemoveSong={handleRemoveFromQueue}
            onClearAll={() => setQueueSongs([])}
            historyEntries={[]}
          />
        </div>

        {/* player bar */}
        <Show when={currentSong()}>
          {(song) => (
            <PlayerBar
              song={{
                id: song().id,
                title: song().title,
                artist: song().artist_name,
                album: song().album_title,
                thumbnailUrl: "",
                isFavorite: song().is_favorite ?? false,
              }}
              isPlaying={isPlaying()}
              volume={volume()}
              currentTime={currentTime()}
              duration={song().duration_seconds}
              queueOpen={queueOpen()}
              onPlayPause={handlePlayPause}
              onPrevious={() => handleSkip("prev")}
              onNext={() => handleSkip("next")}
              onSeek={(percentage) => {
                const duration = song().duration_seconds;
                const timeInSeconds = (percentage / 100) * duration;
                setCurrentTime(timeInSeconds);
              }}
              onVolumeChange={(vol) => setVolume(vol)}
              onQueueToggle={() => setQueueOpen(!queueOpen())}
              queueLength={queueSongs().length}
            />
          )}
        </Show>
      </div>
    );
  },
};

// ---------------------------------------------------------------------
// LibraryGraphView
//
// alternate library shell where the force-directed album graph IS the
// primary view. demonstrates how the graph composes with the rest of
// the chrome:
//   - the graph's zoom/tool/wire-tension/relations controls live in the
//     topnav's right-side slot (rightContent) instead of floating over
//     the canvas.
//   - the topnav's search input drives a node-highlight filter that
//     dims everything not matching, leaving matches at full opacity.
//   - the queue sidebar runs in "inline" mode so opening it shrinks
//     the canvas (AlbumGraphCanvas auto-resizes via ResizeObserver).
//   - a player bar pinned to the bottom further trims the canvas height.
// ---------------------------------------------------------------------
export const LibraryGraphView: Story = {
  render: () => {
    const ALL_KINDS = RELATION_KINDS.map((r) => r.kind);

    // ---- player + queue (mirrors FullAppDemo) ----
    const [currentSong, setCurrentSong] = createSignal<Song | null>(generatedSongs[0]);
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [volume, setVolume] = createSignal(0.75);
    const [currentTime, setCurrentTime] = createSignal(45);
    const [queueOpen, setQueueOpen] = createSignal(false);
    const [queueSongs, setQueueSongs] = createSignal<Song[]>(generatedSongs.slice(0, 20));
    const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);

    onMount(() => {
      const onResize = () => {
        // no-op — kept for parity with FullAppDemo + future hooks
      };
      window.addEventListener("resize", onResize);
      onCleanup(() => window.removeEventListener("resize", onResize));
    });

    const handlePlayPause = () => setIsPlaying((p) => !p);
    const handleSkip = (dir: "prev" | "next") => {
      const idx = currentQueueIndex();
      const next = dir === "next" ? idx + 1 : idx - 1;
      if (next >= 0 && next < queueSongs().length) {
        setCurrentQueueIndex(next);
        setCurrentSong(queueSongs()[next]);
      }
    };
    const handleQueueSongClick = (index: number) => {
      const song = queueSongs()[index];
      if (!song) return;
      setCurrentQueueIndex(index);
      setCurrentSong(song);
      setIsPlaying(true);
    };
    const handleRemoveFromQueue = (index: number) => {
      setQueueSongs((prev) => prev.filter((_s, i) => i !== index));
    };

    // ---- graph state ----
    const nodes = MEDIUM_GRAPH;
    const [enabled, setEnabled] = createSignal<Set<string>>(new Set<string>(ALL_KINDS));
    const [tool, setTool] = createSignal<GraphTool>("pan");
    const [selected, setSelected] = createSignal<AlbumNodeData | null>(null);
    const [pillEdges, setPillEdges] = createSignal<Map<string, GraphEdge>>(new Map());
    const [wireEdge, setWireEdge] = createSignal<GraphEdge | null>(null);
    const [wireTension, setWireTension] = createSignal(0.44);
    const [api, setApi] = createSignal<GraphActions | null>(null);
    const [searchQuery, setSearchQuery] = createSignal("");

    const edgeKey = (kind: RelationKindLike, label: string) => `${String(kind)}|${label}`;
    const edges = createMemo<GraphEdge[]>(() => buildRelationEdges(nodes));
    const counts = createMemo(() => countEdgesByKind(edges()));

    const canvasEdges = createMemo<GraphEdge[]>(() => {
      const out = Array.from(pillEdges().values());
      const w = wireEdge();
      if (w && !pillEdges().has(edgeKey(w.kind, w.label ?? ""))) out.push(w);
      return out;
    });
    const activeRelations = createMemo<Set<string>>(() => {
      const s = new Set<string>(pillEdges().keys());
      const w = wireEdge();
      if (w) s.add(edgeKey(w.kind, w.label ?? ""));
      return s;
    });

    // search filter — dims any node whose title/artist doesn't contain
    // the (lowercased) query. empty query disables the filter entirely.
    const searchMatches = createMemo<Set<string> | null>(() => {
      const q = searchQuery().trim().toLowerCase();
      if (!q) return null;
      const out = new Set<string>();
      for (const n of nodes) {
        const t = (n.title ?? "").toLowerCase();
        const a = (n.artistName ?? "").toLowerCase();
        if (t.includes(q) || a.includes(q)) out.add(n.id);
      }
      return out;
    });
    // when a search lands on exactly one match, auto-focus + fit so the
    // user can jump to a known album by typing its name.
    createEffect(() => {
      const m = searchMatches();
      if (m && m.size === 1) {
        const onlyId = m.values().next().value;
        const hit = nodes.find((n) => n.id === onlyId) ?? null;
        if (hit) {
          setSelected(hit);
          requestAnimationFrame(() => api()?.fit());
        }
      }
    });

    // carousel: clicked album anchored at index 0; pill toggles append.
    const pillClusterAlbums = createMemo<AlbumNodeData[]>(() => {
      const pills = pillEdges();
      if (pills.size === 0) return [];
      const tuples = new Set<string>(pills.keys());
      const byId = new Map(nodes.map((n) => [n.id, n] as const));
      const ids = new Set<string>();
      for (const ee of edges()) {
        if (tuples.has(`${String(ee.kind)}|${ee.label ?? ""}`)) {
          const s = typeof ee.source === "string" ? ee.source : ee.source.id;
          const t = typeof ee.target === "string" ? ee.target : ee.target.id;
          ids.add(s);
          ids.add(t);
        }
      }
      const out: AlbumNodeData[] = [];
      for (const id of ids) {
        const a = byId.get(id);
        if (a) out.push(a);
      }
      out.sort((a, b) => a.title.localeCompare(b.title));
      return out;
    });
    const popInfo = createMemo<{ list: AlbumNodeData[]; source: "edge" | "single" | null }>(() => {
      const pillAlbums = pillClusterAlbums();
      const w = wireEdge();
      if (w) {
        const byId = new Map(nodes.map((n) => [n.id, n] as const));
        const ids = new Set<string>();
        for (const ee of edges()) {
          if (ee.kind === w.kind && ee.label === w.label) {
            const s = typeof ee.source === "string" ? ee.source : ee.source.id;
            const t = typeof ee.target === "string" ? ee.target : ee.target.id;
            ids.add(s);
            ids.add(t);
          }
        }
        const wireList: AlbumNodeData[] = [];
        for (const id of ids) {
          const a = byId.get(id);
          if (a) wireList.push(a);
        }
        wireList.sort((a, b) => a.title.localeCompare(b.title));
        const seen = new Set<string>(wireList.map((a) => a.id));
        const merged = [...wireList, ...pillAlbums.filter((a) => !seen.has(a.id))];
        return { list: merged, source: "edge" };
      }
      const s = selected();
      if (s) {
        const extras = pillAlbums.filter((a) => a.id !== s.id);
        return { list: [s, ...extras], source: "single" };
      }
      if (pillAlbums.length > 0) return { list: pillAlbums, source: "edge" };
      return { list: [], source: null };
    });
    const [popIndex, setPopIndex] = createSignal(0);
    createEffect((prev: { currentId: string | null } | undefined) => {
      const info = popInfo();
      const curId = info.list[popIndex()]?.id ?? null;
      if (prev?.currentId) {
        const newIdx = info.list.findIndex((a) => a.id === prev.currentId);
        if (newIdx >= 0) {
          if (newIdx !== popIndex()) setPopIndex(newIdx);
          return { currentId: prev.currentId };
        }
        setPopIndex(0);
      }
      return { currentId: curId };
    }, undefined);
    const currentSel = createMemo(() => popInfo().list[popIndex()] ?? null);
    const canvasSelectedId = createMemo(() => currentSel()?.id ?? null);

    const closeSelection = () => {
      setSelected(null);
      setPillEdges(new Map());
      setWireEdge(null);
    };

    // pill tap — toggle the relation in the highlight set without
    // disturbing the anchored album in the popover.
    const focusOnRelation = (kind: RelationKindLike, label: string) => {
      const key = edgeKey(kind, label);
      const cur = pillEdges();
      const next = new Map(cur);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const match = edges().find((e) => e.kind === kind && e.label === label);
        const target: GraphEdge =
          match ??
          ({
            source: currentSel()?.id ?? nodes[0]?.id ?? "",
            target: currentSel()?.id ?? nodes[0]?.id ?? "",
            kind,
            weight: 0.5,
            label,
          } as GraphEdge);
        next.set(key, target);
        setEnabled((prev) => {
          if (prev.has(kind as string)) return prev;
          const ns = new Set<string>(prev);
          ns.add(kind as string);
          return ns;
        });
      }
      setPillEdges(next);
      requestAnimationFrame(() => api()?.fit());
    };

    // pill long-press — solo this relation, clearing everything else.
    const soloRelation = (kind: RelationKindLike, label: string) => {
      const key = edgeKey(kind, label);
      const match = edges().find((e) => e.kind === kind && e.label === label);
      const target: GraphEdge =
        match ??
        ({
          source: currentSel()?.id ?? nodes[0]?.id ?? "",
          target: currentSel()?.id ?? nodes[0]?.id ?? "",
          kind,
          weight: 0.5,
          label,
        } as GraphEdge);
      setWireEdge(null);
      setPillEdges(new Map([[key, target]]));
      setEnabled(new Set<string>([kind as string]));
      requestAnimationFrame(() => api()?.fit());
    };

    // relation-kind solo (from the topnav picker)
    const soloKind = (kind: string) => {
      setEnabled(new Set<string>([kind]));
      setPillEdges((prev) => {
        const next = new Map<string, GraphEdge>();
        for (const [k, v] of prev) if (String(v.kind) === kind) next.set(k, v);
        return next;
      });
    };

    return (
      <div
        class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
        style={{ "--player-bar-height": "var(--player-height)" }}
      >
        <TopNav
          brandName="freqhole"
          brandTagline="album graph"
          searchPlaceholder="search albums + artists..."
          searchComponent={
            <TopNavSearch
              placeholder="search albums + artists..."
              onSearchChange={(v) => setSearchQuery(v)}
              onNavigate={() => undefined}
              currentPath="/library"
            />
          }
          rightContent={
            <GraphTopNavTools
              tool={tool()}
              onToolChange={setTool}
              onZoomIn={() => api()?.zoomIn()}
              onZoomOut={() => api()?.zoomOut()}
              onFit={() => api()?.fit()}
              wireTension={wireTension()}
              onWireTensionChange={setWireTension}
              relations={{
                enabled: enabled(),
                counts: counts(),
                onToggle: (kind, next) => {
                  setEnabled((prev) => {
                    const ns = new Set<string>(prev);
                    if (next) ns.add(kind);
                    else ns.delete(kind);
                    return ns;
                  });
                },
                onSolo: soloKind,
                onSelectAll: () => setEnabled(new Set<string>(ALL_KINDS)),
                onDeselectAll: () => setEnabled(new Set<string>()),
              }}
            />
          }
          mainNavSections={[
            {
              items: [
                { label: "graph", onClick: () => undefined },
                { label: "songs", onClick: () => undefined },
                { label: "albums", onClick: () => undefined },
                { label: "artists", onClick: () => undefined },
              ],
            },
          ]}
          pageTitle="library graph"
          pageCount={nodes.length}
        />

        {/* main content area + queue */}
        <div
          class="flex-1 overflow-hidden flex"
          style={{ "padding-bottom": "var(--player-bar-height)" }}
        >
          {/* graph fills the remaining width; AlbumGraphCanvas ResizeObservers
              the parent so opening the queue / showing the player bar
              automatically reflows the canvas. */}
          <div class="flex-1 relative overflow-hidden">
            <AlbumGraphCanvas
              nodes={nodes}
              edges={edges()}
              enabledKinds={enabled()}
              selectedId={canvasSelectedId()}
              selectedEdges={canvasEdges()}
              tool={tool()}
              edgeCurvature={wireTension() * 0.5}
              searchMatches={searchMatches()}
              onReady={(a) => setApi(a)}
              onSelect={(album) => {
                setSelected(album);
                setWireEdge(null);
              }}
              onEdgeSelect={(edge) => {
                setWireEdge(edge);
              }}
              class="absolute inset-0"
            />

            <Show when={popInfo().list.length > 0 && currentSel()}>
              {(album) => (
                <div class="absolute top-3 left-3 z-10 max-w-[360px]">
                  <AlbumDetailPopover
                    albums={popInfo().list}
                    index={popIndex()}
                    onIndexChange={setPopIndex}
                    activeRelations={activeRelations()}
                    onClose={closeSelection}
                    onRelationClick={focusOnRelation}
                    onRelationSolo={soloRelation}
                    onPlay={(a) => console.log("[graph] play", a.title)}
                    onShuffle={(a) => console.log("[graph] shuffle", a.title)}
                    onAddToQueue={(a) => console.log("[graph] queue", a.title)}
                    onViewAlbum={(a) => console.log("[graph] view album", a.title)}
                    onViewArtist={(a) => console.log("[graph] view artist", a.artistName)}
                    onToggleFavorite={(a) => console.log("[graph] favorite", a.title)}
                  />
                  {/* swallow the unused album binding so solid is happy */}
                  <Show when={false}>{album().id}</Show>
                </div>
              )}
            </Show>
          </div>

          {/* inline queue — shrinks the canvas instead of overlaying */}
          <QueueSidebar
            isOpen={queueOpen()}
            variant="inline"
            songs={queueSongs()}
            currentIndex={currentQueueIndex()}
            onClose={() => setQueueOpen(false)}
            onSongClick={handleQueueSongClick}
            onRemoveSong={handleRemoveFromQueue}
            onClearAll={() => setQueueSongs([])}
            historyEntries={[]}
          />
        </div>

        <Show when={currentSong()}>
          {(song) => (
            <PlayerBar
              song={{
                id: song().id,
                title: song().title,
                artist: song().artist_name,
                album: song().album_title,
                thumbnailUrl: "",
                isFavorite: song().is_favorite ?? false,
              }}
              isPlaying={isPlaying()}
              volume={volume()}
              currentTime={currentTime()}
              duration={song().duration_seconds}
              queueOpen={queueOpen()}
              onPlayPause={handlePlayPause}
              onPrevious={() => handleSkip("prev")}
              onNext={() => handleSkip("next")}
              onSeek={(percentage) => {
                const duration = song().duration_seconds;
                setCurrentTime((percentage / 100) * duration);
              }}
              onVolumeChange={(vol) => setVolume(vol)}
              onQueueToggle={() => setQueueOpen(!queueOpen())}
              queueLength={queueSongs().length}
            />
          )}
        </Show>
      </div>
    );
  },
};
