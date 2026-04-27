import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { clearPageInfo, setPageInfo } from "../src/app/services/pageInfo";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import {
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../src/components/cards/StatsCard";
import { SearchSortControls } from "../src/components/controls/SearchSortControls";
import { Icon } from "../src/components/icons/registry";
import { FavoritesLayout, type FavoriteItem } from "../src/components/layout/FavoritesLayout";
import { HeadingSection } from "../src/components/layout/HeadingSection";
import { ResponsiveMasterDetail, TwoColumnLayout } from "../src/components/layout/TwoColumnLayout";
import { DraggableRow, DraggableRowSongContent } from "../src/components/lists/DraggableRow";
import { AlphabetNav } from "../src/components/navigation/AlphabetNav";
import { TopNav } from "../src/components/navigation/TopNav";
import { TopNavSearch } from "../src/components/navigation/TopNavSearch";
import { PlayerBar } from "../src/components/player/PlayerBar";
import { QueueSidebar } from "../src/components/player/QueueSidebar";
import { VirtualAlbumGrid } from "../src/components/virtualized/VirtualAlbumGrid";
import { VirtualFeedList } from "../src/components/virtualized/VirtualFeedList";
import { VirtualSongList } from "../src/components/virtualized/VirtualSongList";
import type { Song as DomainSong } from "../src/music/data/types";
import { isNarrowViewport } from "../src/config/breakpoints";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import {
  generateBulkSongs,
  generateFeedItems,
  generateQueueHistory,
  generateRadioListenHistory,
  mockAlbums,
  mockArtists,
  mockFavorites,
  mockGenres,
  mockPlaylists,
  mockRadioStations,
  mockRemotes,
  placeholderImage,
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

type Route =
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "playlists"
  | "favorites"
  | "feed"
  | "radio";

// alias the shared placeholder helper for brevity
const placeholderSvg = placeholderImage;

// shared query client for stories — VirtualFeedList's FavoriteToggle needs this
const storyQueryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false } },
});

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
    // tracks pointer over the TopNav root so the inner TopNavSearch knows
    // when to auto-collapse on hover-out (matches real-app behavior)
    const [topNavHovered, setTopNavHovered] = createSignal(false);

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
    // track viewport height for virtualized list sizing
    const [viewportHeight, setViewportHeight] = createSignal(window.innerHeight);

    onMount(() => {
      const handleResize = () => {
        setIsNarrow(isNarrowViewport());
        setViewportHeight(window.innerHeight);
      };
      window.addEventListener("resize", handleResize);
      onCleanup(() => window.removeEventListener("resize", handleResize));
    });

    // available height for virtualized lists/grids inside main content area.
    // accounts for: TopNav (~60px), HeadingSection + margins (~60px), player bar (~80px).
    const listHeight = () => Math.max(320, viewportHeight() - 180);
    const gridHeight = () => Math.max(320, viewportHeight() - 140);

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
          return { title: "favorites", count: mockFavorites.length };
        case "feed":
          return { title: "feed", count: undefined };
        case "radio":
          return { title: "radio", count: mockRadioStations.length };
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

    // ===== per-view filter/sort mock data feeding TopNav's pageInfo store =====
    // these mirror what the real views push via setPageInfo(), letting the
    // TopNav render its sort flyout, tag filter picker, and feed-type filter
    // controls. handlers are no-ops/local state — they don't actually filter.
    const songSortFields = [
      { value: "title", label: "title", description: "song title" },
      { value: "artist_name", label: "artist", description: "artist name" },
      { value: "album_title", label: "album", description: "album title" },
      { value: "added_at", label: "added", description: "date added" },
      { value: "duration_seconds", label: "duration", description: "track length" },
    ];
    const albumSortFields = [
      { value: "title", label: "title" },
      { value: "artist_name", label: "artist" },
      { value: "year", label: "year" },
      { value: "added_at", label: "added" },
    ];
    const playlistSortFields = [
      { value: "title", label: "title" },
      { value: "song_count", label: "songs" },
      { value: "updated_at", label: "updated" },
    ];
    const favoritesSortFields = [
      { value: "added_at", label: "added" },
      { value: "title", label: "title" },
    ];
    const mockTagOptions = [
      { value: "rock", label: "rock", count: 142 },
      { value: "electronic", label: "electronic", count: 89 },
      { value: "ambient", label: "ambient", count: 47 },
      { value: "jazz", label: "jazz", count: 33 },
      { value: "favorite", label: "favorite", count: 24 },
    ];
    const mockFeedTypes = [
      { value: "recent_listen", label: "listens" },
      { value: "favorite_added", label: "favorites" },
      { value: "playlist_updated", label: "playlists" },
      { value: "rating_added", label: "ratings" },
      { value: "song_added", label: "added" },
    ];

    const [storySortBy, setStorySortBy] = createSignal("added_at");
    const [storySortDir, setStorySortDir] = createSignal<"asc" | "desc">("desc");
    const [storyTagFilters, setStoryTagFilters] = createSignal<
      { tag: string; mode: "include" | "exclude" }[]
    >([]);
    const [storyFeedTypes, setStoryFeedTypes] = createSignal<
      { type: string; mode: "include" | "exclude" }[]
    >([]);
    const [storyMyItemsOnly, setStoryMyItemsOnly] = createSignal(false);

    const tagHandlers = {
      onAddTag: (tag: string) =>
        setStoryTagFilters([...storyTagFilters(), { tag, mode: "include" as const }]),
      onRemoveTag: (tag: string) =>
        setStoryTagFilters(storyTagFilters().filter((f) => f.tag !== tag)),
      onToggleTagMode: (tag: string) =>
        setStoryTagFilters(
          storyTagFilters().map((f) =>
            f.tag === tag ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
          )
        ),
      onClearAllTags: () => setStoryTagFilters([]),
    };

    const feedTypeHandlers = {
      onToggleFeedType: (type: string) => {
        const cur = storyFeedTypes();
        const has = cur.find((f) => f.type === type);
        setStoryFeedTypes(
          has ? cur.filter((f) => f.type !== type) : [...cur, { type, mode: "include" as const }]
        );
      },
      onToggleFeedTypeMode: (type: string) =>
        setStoryFeedTypes(
          storyFeedTypes().map((f) =>
            f.type === type ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
          )
        ),
      onRemoveFeedType: (type: string) =>
        setStoryFeedTypes(storyFeedTypes().filter((f) => f.type !== type)),
      onClearFeedTypes: () => setStoryFeedTypes([]),
      onToggleMyItems: () => setStoryMyItemsOnly(!storyMyItemsOnly()),
    };

    createEffect(() => {
      const route = currentRoute();
      const baseSort = {
        sortBy: storySortBy(),
        sortDirection: storySortDir(),
        onSortChange: (field: string, dir: "asc" | "desc") => {
          setStorySortBy(field);
          setStorySortDir(dir);
        },
      };
      const baseTags = {
        availableTags: mockTagOptions,
        selectedTagFilters: storyTagFilters(),
        ...tagHandlers,
      };
      switch (route) {
        case "songs":
          setPageInfo({
            title: "songs",
            count: generatedSongs.length,
            sortFields: songSortFields,
            defaultSortBy: "added_at",
            defaultSortDirection: "desc",
            ...baseSort,
            ...baseTags,
          });
          break;
        case "albums":
          setPageInfo({
            title: "albums",
            count: mockAlbums.length,
            sortFields: albumSortFields,
            defaultSortBy: "added_at",
            defaultSortDirection: "desc",
            ...baseSort,
            ...baseTags,
          });
          break;
        case "artists":
          setPageInfo({
            title: "artists",
            count: mockArtists.length,
            sortFields: artistSortFields,
            defaultSortBy: "name",
            defaultSortDirection: "asc",
            ...baseSort,
          });
          break;
        case "genres":
          setPageInfo({
            title: "genres",
            count: mockGenres.length,
            sortFields: genreSortFields,
            defaultSortBy: "name",
            defaultSortDirection: "asc",
            ...baseSort,
          });
          break;
        case "playlists":
          setPageInfo({
            title: "playlists",
            count: mockPlaylists.length,
            sortFields: playlistSortFields,
            defaultSortBy: "updated_at",
            defaultSortDirection: "desc",
            ...baseSort,
          });
          break;
        case "favorites":
          setPageInfo({
            title: "favorites",
            count: mockFavorites.length,
            sortFields: favoritesSortFields,
            defaultSortBy: "added_at",
            defaultSortDirection: "desc",
            ...baseSort,
            ...baseTags,
          });
          break;
        case "feed":
          setPageInfo({
            title: "feed",
            feedTypeOptions: mockFeedTypes,
            selectedFeedTypes: storyFeedTypes(),
            myItemsOnly: storyMyItemsOnly(),
            ...feedTypeHandlers,
          });
          break;
        case "radio":
          // TopNav hides controls on /radio anyway
          setPageInfo({ title: "radio", count: mockRadioStations.length });
          break;
        default:
          clearPageInfo();
      }
    });

    onCleanup(() => clearPageInfo());

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
            height={listHeight()}
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
              imageUrl: placeholderSvg(a.id, a.title),
              artist: a.artist,
              album: a.title,
              year: a.year,
              trackCount: a.trackCount,
              totalDuration: formatDuration(a.duration),
              genres: "rock",
              playCount: 100,
            }))}
            height={gridHeight()}
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
    const [favoritesList, setFavoritesList] = createSignal<FavoriteItem[]>(mockFavorites);
    const getFavoriteId = (item: FavoriteItem): string => {
      if (item.type === "song") return item.id;
      if (item.type === "album") return item.album_id;
      if (item.type === "artist") return item.artist_id;
      if (item.type === "playlist") return item.playlist_id;
      return "";
    };
    const favoritesView = () => (
      <div class="h-full ml-0 wide:ml-[100px]">
        <FavoritesLayout
          favorites={favoritesList()}
          height={listHeight() + 60}
          onSongClick={(song) => {
            setCurrentSong(song as DomainSong);
          }}
          onSongPlay={(song) => {
            setCurrentSong(song as DomainSong);
            setIsPlaying(true);
          }}
          onSongFavoriteToggle={(songId, isFavorite) => {
            if (!isFavorite) {
              setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== songId));
            }
          }}
          onAlbumClick={(album) => console.log("album click:", album)}
          onAlbumPlay={(album) => console.log("album play:", album)}
          onAlbumFavoriteToggle={(albumId, isFavorite) => {
            if (!isFavorite) {
              setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== albumId));
            }
          }}
          onArtistClick={(artist) => console.log("artist click:", artist)}
          onArtistPlay={(artist) => console.log("artist play:", artist)}
          onArtistFavoriteToggle={(artistId, isFavorite) => {
            if (!isFavorite) {
              setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== artistId));
            }
          }}
          onPlaylistClick={(playlist) => {
            navigateTo("playlists");
            const found = mockPlaylists.find((p) => p.id === playlist.playlist_id);
            if (found) setSelectedPlaylist(found);
          }}
          onPlaylistPlay={(playlist) => console.log("playlist play:", playlist)}
          onPlaylistFavoriteToggle={(playlistId, isFavorite) => {
            if (!isFavorite) {
              setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== playlistId));
            }
          }}
          onArtistNavigate={(artistId) => console.log("navigate to artist:", artistId)}
          onAlbumNavigate={(albumId) => console.log("navigate to album:", albumId)}
          onGenreClick={(genre) => console.log("genre click:", genre)}
        />
      </div>
    );

    // ===== FEED VIEW =====
    // mix of "my feed" (one source) and "all feed" (multiple remotes). we render
    // the aggregate (all) feed so users can see remote attribution badges.
    const feedItems = () => {
      const items = mockRemotes.flatMap((remote) => generateFeedItems(0, 12, remote));
      // interleave by created_at so they appear chronologically
      return items.sort((a, b) => b.created_at - a.created_at);
    };
    const feedView = () => (
      <div class="p-3">
        <div class="ml-0 wide:ml-[100px]">
          <HeadingSection title="all feed" count={feedItems().length} hideOnNarrow />
        </div>
        <div class="mt-2 wide:mt-6">
          <VirtualFeedList
            items={feedItems()}
            height={listHeight()}
            onItemClick={(item) => console.log("feed item:", item.id, item.title)}
            onGenreClick={(genreId) => console.log("genre:", genreId)}
            onAddToQueue={(item) => console.log("add to queue:", item.title)}
            scrollKey="super-story-feed"
          />
        </div>
      </div>
    );

    // ===== RADIO VIEW =====
    const [selectedStation, setSelectedStation] = createSignal(mockRadioStations[0]);
    const [showRadioDetail, setShowRadioDetail] = createSignal(false);
    const radioListens = generateRadioListenHistory(25);
    const listensForSelected = () => {
      const sel = selectedStation();
      if (!sel) return [] as ReturnType<typeof generateRadioListenHistory>;
      return radioListens.filter((l) => l.stationId === sel.id);
    };

    const tuneStation = (station: (typeof mockRadioStations)[number]) => {
      setSelectedStation(station);
      setShowRadioDetail(true);
      if (station.currentSong) {
        const songStub = {
          id: `radio-${station.id}-current`,
          sha256: `radio-${station.id}-current`,
          title: station.currentSong.title,
          artist_name: station.currentSong.artist,
          album_title: station.currentSong.album,
          duration_seconds: 240,
          is_favorite: false,
        } as unknown as DomainSong;
        setCurrentSong(songStub);
        setIsPlaying(true);
      }
    };

    const radioLeftColumn = () => (
      <div class="flex flex-col h-full min-h-0 pt-2 wide:pt-[60px]">
        <header class="flex items-center justify-between gap-2 px-3 py-3">
          <h1 class="text-lg font-bold">
            radio station<span class="text-[var(--color-accent-500)]">z</span>
          </h1>
          <button
            type="button"
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)]"
          >
            refresh
          </button>
        </header>
        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <section class="mb-4">
            <div class="flex items-center justify-between px-2 mb-1">
              <h2 class="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] truncate">
                local
              </h2>
            </div>
            <ul>
              <For each={mockRadioStations}>
                {(station) => {
                  const isCurrent = () => selectedStation()?.id === station.id;
                  return (
                    <li>
                      <button
                        type="button"
                        class="w-full text-left flex items-center gap-2 p-2 rounded transition"
                        classList={{
                          "bg-[var(--color-accent-500)]/20": isCurrent(),
                          "hover:bg-[var(--color-bg-hover)]": !isCurrent(),
                        }}
                        onClick={() => tuneStation(station)}
                      >
                        <div class="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                          <img
                            src={station.thumbnailUrl}
                            alt=""
                            class="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-medium truncate">{station.name}</div>
                          <div class="text-[11px] text-[var(--color-text-tertiary)] truncate">
                            {station.listenerCount} listening
                            <Show when={station.currentSong}>{(cur) => <> · {cur().title}</>}</Show>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        </div>
      </div>
    );

    const radioRightColumn = () => (
      <div class="flex flex-col h-full min-h-0">
        <Show
          when={selectedStation()}
          fallback={
            <div class="flex-1 overflow-y-auto flex flex-col items-center text-center p-8 text-[var(--color-text-tertiary)]">
              <div class="w-32 h-32 rounded-lg bg-gradient-to-tr from-magenta-900 to-purple-700 flex items-center justify-center mb-4">
                <span class="text-xs font-bold tracking-widest opacity-60 text-white">
                  <Icon name="radioTower" size={64} />R A D I O
                </span>
              </div>
              <p class="text-sm max-w-xs mb-8">
                pick a station from the list to tune in && tune out.
              </p>
            </div>
          }
        >
          {(station) => (
            <div class="flex-1 min-h-0 overflow-y-auto">
              <div class="px-6 pb-6 pt-3 wide:pt-6 max-w-3xl mx-auto w-full h-full min-h-0 flex flex-col">
                <header class="flex items-center gap-4 mb-6">
                  <div class="flex-shrink-0">
                    <div class="w-32 h-32 sm:w-40 sm:h-40 rounded-lg overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900">
                      <img src={station().thumbnailUrl} alt="" class="w-full h-full object-cover" />
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-3 mb-1 min-h-8">
                      <div class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                        now playing
                      </div>
                      <button
                        type="button"
                        class="wide:hidden text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] flex items-center gap-1 flex-shrink-0"
                        onClick={() => setShowRadioDetail(false)}
                        aria-label="back to station list"
                      >
                        <span aria-hidden="true">←</span> back
                      </button>
                    </div>
                    <Show when={station().currentSong} fallback={<div>—</div>}>
                      {(np) => (
                        <>
                          <div class="text-2xl font-bold truncate">{np().title}</div>
                          <div class="text-base text-[var(--color-text-secondary)] truncate">
                            {np().artist} — {np().album}
                          </div>
                        </>
                      )}
                    </Show>
                    <div class="mt-3 text-sm text-[var(--color-text-tertiary)]">
                      <div class="font-medium">{station().name}</div>
                      <Show when={station().description}>
                        <div class="text-xs">{station().description}</div>
                      </Show>
                      <div class="text-xs mt-1">
                        {station().listenerCount} listener
                        {station().listenerCount === 1 ? "" : "s"} · {station().codec} ·{" "}
                        {station().play_mode}
                      </div>
                      <button
                        type="button"
                        class="mt-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
                      >
                        share
                      </button>
                    </div>
                  </div>
                </header>

                <div class="flex-1 min-h-0">
                  <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                    recent listens
                  </h3>
                  <div class="space-y-1">
                    <For
                      each={listensForSelected().length > 0 ? listensForSelected() : radioListens}
                    >
                      {(listen) => (
                        <div class="flex items-center gap-3 p-2 bg-[var(--color-bg-secondary)] rounded text-sm">
                          <span class="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] shrink-0">
                            {listen.stationName}
                          </span>
                          <div class="flex-1 min-w-0">
                            <div class="text-[var(--color-text-primary)] truncate">
                              {listen.artistName} — {listen.songTitle}
                            </div>
                            <div class="caption truncate">{listen.albumTitle}</div>
                          </div>
                          <div class="monospace caption text-[var(--color-text-muted)] shrink-0">
                            {formatDuration(listen.durationSeconds)}
                          </div>
                          <div class="caption text-[var(--color-text-tertiary)] shrink-0">
                            {Math.floor((Date.now() - listen.playedAt) / 60_000)}m ago
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
      </div>
    );

    const radioView = () => (
      <div class="ml-0 wide:ml-[100px] h-full">
        <TwoColumnLayout
          leftColumn={radioLeftColumn()}
          rightColumn={radioRightColumn()}
          leftColumnWidth={320}
          showDetail={showRadioDetail()}
          onBack={() => setShowRadioDetail(false)}
        />
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
        case "feed":
          return feedView();
        case "radio":
          return radioView();
        default:
          return artistsView();
      }
    };

    const playerBarHeight = () => "var(--player-height)";

    return (
      <QueryClientProvider client={storyQueryClient}>
        <div
          class="h-screen flex flex-col bg-[var(--color-bg-primary)]"
          style={{ "--player-bar-height": playerBarHeight() }}
        >
          {/* top navigation */}
          <div
            onMouseEnter={() => setTopNavHovered(true)}
            onMouseLeave={() => setTopNavHovered(false)}
          >
            <TopNav
              brandName="freqhole"
              brandTagline="your music library"
              currentPath={`/${currentRoute()}`}
              searchPlaceholder="search artists, albums, songs..."
              searchComponent={
                <TopNavSearch
                  placeholder="search artists, albums, songs..."
                  suggestions={mockSearchSuggestions()}
                  onSearchChange={setSearchValue}
                  onNavigate={(path) => console.log("navigate:", path)}
                  currentPath={`/${currentRoute()}`}
                  navHovered={topNavHovered()}
                />
              }
              onSearchChange={(query) => console.log("search:", query)}
              onSearchSubmit={(query) => console.log("search submit:", query)}
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
                    {
                      label: "feed",
                      onClick: () => navigateTo("feed"),
                    },
                    {
                      label: "radio",
                      onClick: () => navigateTo("radio"),
                    },
                  ],
                },
              ]}
              recentPlaylists={mockPlaylists.slice(0, 5).map((playlist, index) => ({
                id: playlist.id,
                name: playlist.name,
                thumbnailUrl: placeholderSvg(playlist.id, playlist.name),
                updatedAt: Date.now() - index * 3600000,
                onClick: () => {
                  navigateTo("playlists");
                  setSelectedPlaylist(playlist);
                },
              }))}
              onViewAllPlaylists={() => navigateTo("playlists")}
              pageTitle={pageInfo().title}
              pageCount={pageInfo().count}
              viewOptions={[
                { label: "songs", path: "/songs", count: generatedSongs.length },
                { label: "albums", path: "/albums", count: mockAlbums.length },
                { label: "artists", path: "/artists", count: mockArtists.length },
                { label: "genres", path: "/genres", count: mockGenres.length },
                { label: "playlists", path: "/playlists", count: mockPlaylists.length },
                { label: "favorites", path: "/favorites", count: mockFavorites.length },
                { label: "feed", path: "/feed" },
                { label: "radio", path: "/radio", count: mockRadioStations.length },
              ]}
              onNavigate={(path) => {
                const route = path.replace(/^\//, "") as Route;
                if (
                  route === "songs" ||
                  route === "albums" ||
                  route === "artists" ||
                  route === "genres" ||
                  route === "playlists" ||
                  route === "favorites" ||
                  route === "feed" ||
                  route === "radio"
                ) {
                  navigateTo(route);
                }
              }}
            />
          </div>

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
              historyEntries={generateQueueHistory(12, generatedSongs as DomainSong[])}
              onReplayHistoryEntry={(entry) => console.log("replay history entry:", entry.label)}
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
                  thumbnailUrl: placeholderSvg(
                    song().album_id ?? song().id,
                    song().album_title ?? song().title
                  ),
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
      </QueryClientProvider>
    );
  },
};
