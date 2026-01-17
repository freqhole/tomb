import { createSignal, For, Show } from "solid-js";
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
import { TwoColumnLayout } from "../src/components/layout/TwoColumnLayout";
import {
  DraggableRow,
  DraggableRowSongContent,
} from "../src/components/lists/DraggableRow";
import { AlphabetNav } from "../src/components/navigation/AlphabetNav";
import { TopNav } from "../src/components/navigation/TopNav";
import { mockArtists, mockSongs, type Artist, type Song } from "./mockData";

const meta = {
  title: "Super Story",
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// mock data imported from shared mockData.ts

const sortFields = [
  { value: "name", label: "name", description: "sort by artist name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
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
    const [selectedArtist, setSelectedArtist] = createSignal<Artist | null>(
      mockArtists[0],
    );
    const [sortBy, setSortBy] = createSignal("name");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
      "asc",
    );
    const [currentLetter, setCurrentLetter] = createSignal<
      string | undefined
    >();
    const [songs, setSongs] = createSignal<Song[]>(mockSongs);
    const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(
      null,
    );
    const [selectedSongIds, setSelectedSongIds] = createSignal<Set<string>>(
      new Set(),
    );

    // sort artists
    const sortedArtists = () => {
      const artists = [...mockArtists];
      const field = sortBy() as keyof Artist;
      const dir = sortDirection();

      artists.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];

        if (typeof aVal === "string" && typeof bVal === "string") {
          return dir === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        if (typeof aVal === "number" && typeof bVal === "number") {
          return dir === "asc" ? aVal - bVal : bVal - aVal;
        }

        return 0;
      });

      return artists;
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

      const reordered = [...songs()];
      const [draggedSong] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, draggedSong);

      setSongs(reordered);
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
      setSongs(songs().filter((s) => s.id !== song.id));
    };

    // left column: artist list
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
              sortFields={sortFields}
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
                    selectedArtist()?.id === artist.id
                      ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                      : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                  }
                `}
                onClick={() => setSelectedArtist(artist)}
              >
                <div class="font-medium">{artist.name}</div>
                <div class="text-xs text-[var(--color-text-tertiary)]">
                  {formatNumber(artist.songCount)} songs · {artist.albumCount}{" "}
                  albums
                </div>
              </button>
            )}
          </For>
        </div>
      </div>
    );

    // right column: artist detail with tabs
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

              <StatsGrid columns={5} gap="md" class="mb-6">
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

              {/* action buttons */}
              <div class="flex gap-3">
                <Button
                  variant="primary"
                  onClick={() => console.log("play all songs")}
                >
                  play all
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => console.log("shuffle")}
                >
                  shuffle
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => console.log("add to queue")}
                >
                  add to queue
                </Button>
              </div>
            </div>

            {/* songs list with drag and drop */}
            <div class="flex-1 px-6 py-4 overflow-y-auto">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
                  top songs
                </h3>
                <div class="text-sm text-[var(--color-text-secondary)]">
                  drag to reorder
                </div>
              </div>
              <div class="space-y-1">
                <For each={songs()}>
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
                        artist={song.artist}
                        album={song.album}
                        durationSeconds={song.durationSeconds}
                        actions={
                          <>
                            <IconButton
                              icon="queue"
                              size="sm"
                              variant="ghost"
                              onClick={(e: MouseEvent) => {
                                e.stopPropagation();
                                console.log("add to queue:", song.title);
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
                {songs().length} songs • {selectedSongIds().size} selected
              </div>
            </div>
          </div>
        )}
      </Show>
    );

    // alphabet nav (only show when sorted by name)
    const alphabetNav =
      sortBy() === "name" ? (
        <AlphabetNav
          currentLetter={currentLetter()}
          disabledLetters={disabledLetters()}
          onLetterClick={(letter) => {
            setCurrentLetter(letter);
            console.log("jump to letter:", letter);
          }}
          sortDirection={sortDirection()}
        />
      ) : undefined;

    return (
      <div class="h-screen flex flex-col bg-[var(--color-bg-primary)]">
        {/* top navigation */}
        <TopNav
          brandName="freqhole"
          brandTagline="your music library"
          searchPlaceholder="search artists, albums, songs..."
          onSearchChange={(query) => console.log("search:", query)}
          onSearchSubmit={(query) => console.log("search submit:", query)}
          mainNavSections={[
            {
              items: [
                { label: "library", onClick: () => console.log("library") },
                { label: "artists", onClick: () => console.log("artists") },
                { label: "albums", onClick: () => console.log("albums") },
                { label: "genres", onClick: () => console.log("genres") },
                { label: "playlists", onClick: () => console.log("playlists") },
              ],
            },
          ]}
        />

        {/* main content area */}
        <div class="flex-1 overflow-hidden">
          <TwoColumnLayout
            leftColumn={leftColumn}
            rightColumn={rightColumn}
            alphabetNav={alphabetNav}
          />
        </div>
      </div>
    );
  },
};
