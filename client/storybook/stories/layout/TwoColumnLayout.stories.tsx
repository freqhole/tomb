import { createSignal, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SearchSortControls } from "../../src/components/controls/SearchSortControls";
import { HeadingSection } from "../../src/components/layout/HeadingSection";
import { TwoColumnLayout } from "../../src/components/layout/TwoColumnLayout";
import { AlphabetNav } from "../../src/components/navigation/AlphabetNav";

const meta = {
  title: "Layout/TwoColumnLayout",
  component: TwoColumnLayout,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof TwoColumnLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

// mock artist data
interface MockArtist {
  id: string;
  name: string;
  songCount: number;
  albumCount: number;
}

const mockArtists: MockArtist[] = [
  { id: "1", name: "AC/DC", songCount: 42, albumCount: 8 },
  { id: "2", name: "Aphex Twin", songCount: 156, albumCount: 12 },
  { id: "3", name: "Arctic Monkeys", songCount: 67, albumCount: 6 },
  { id: "4", name: "The Beatles", songCount: 213, albumCount: 13 },
  { id: "5", name: "Björk", songCount: 89, albumCount: 9 },
  { id: "6", name: "Bob Dylan", songCount: 387, albumCount: 39 },
  { id: "7", name: "David Bowie", songCount: 342, albumCount: 27 },
  { id: "8", name: "Daft Punk", songCount: 48, albumCount: 4 },
  { id: "9", name: "Gorillaz", songCount: 94, albumCount: 7 },
  { id: "10", name: "Kendrick Lamar", songCount: 78, albumCount: 5 },
  { id: "11", name: "Led Zeppelin", songCount: 94, albumCount: 8 },
  { id: "12", name: "Massive Attack", songCount: 67, albumCount: 5 },
  { id: "13", name: "Metallica", songCount: 156, albumCount: 10 },
  { id: "14", name: "Nine Inch Nails", songCount: 123, albumCount: 9 },
  { id: "15", name: "Nirvana", songCount: 87, albumCount: 3 },
  { id: "16", name: "Pink Floyd", songCount: 165, albumCount: 15 },
  { id: "17", name: "Portishead", songCount: 37, albumCount: 3 },
  { id: "18", name: "Radiohead", songCount: 158, albumCount: 9 },
  { id: "19", name: "Red Hot Chili Peppers", songCount: 178, albumCount: 11 },
  { id: "20", name: "The Smiths", songCount: 73, albumCount: 4 },
  { id: "21", name: "Tool", songCount: 46, albumCount: 5 },
  { id: "22", name: "The Velvet Underground", songCount: 54, albumCount: 4 },
  { id: "23", name: "The White Stripes", songCount: 89, albumCount: 6 },
  { id: "24", name: "Ween", songCount: 267, albumCount: 14 },
];

// sort fields
const artistSortFields = [
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "song_count", label: "songs", description: "sort by song count" },
  { value: "album_count", label: "albums", description: "sort by album count" },
];

/**
 * interactive artist list + detail view demonstrating the two-column layout
 * with alphabet navigation, sorting, and detail panel
 */
export const ArtistListWithDetail: Story = {
  render: () => {
    const [selectedArtist, setSelectedArtist] = createSignal<MockArtist | null>(
      null,
    );
    const [sortBy, setSortBy] = createSignal("artist");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
      "asc",
    );
    const [currentLetter, setCurrentLetter] = createSignal<
      string | undefined
    >();

    // sort artists
    const sortedArtists = () => {
      const artists = [...mockArtists];
      const field = sortBy() as keyof MockArtist;
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

    // get disabled letters
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

    const handleSortChange = (field: string, direction: "asc" | "desc") => {
      setSortBy(field);
      setSortDirection(direction);
    };

    const handleLetterClick = (letter: string) => {
      setCurrentLetter(letter);
      // in a real app, this would scroll to that letter
      console.log("jump to letter:", letter);
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
              onSortChange={handleSortChange}
              sortFields={artistSortFields}
            />
          }
        />

        <div class="flex-1 overflow-y-auto">
          <For each={sortedArtists()}>
            {(artist) => (
              <button
                class={`
                  w-full px-6 py-3 text-left transition-colors
                  ${
                    selectedArtist()?.id === artist.id
                      ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)]"
                      : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]"
                  }
                `}
                onClick={() => setSelectedArtist(artist)}
              >
                <div class="font-medium">{artist.name}</div>
                <div class="text-sm text-[var(--color-text-tertiary)]">
                  {artist.songCount} songs · {artist.albumCount} albums
                </div>
              </button>
            )}
          </For>
        </div>
      </div>
    );

    // right column: artist detail
    const rightColumn = (
      <Show
        when={selectedArtist()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <div class="text-center text-[var(--color-text-tertiary)]">
              <svg
                class="w-16 h-16 mx-auto mb-4 opacity-50"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <p class="text-lg mb-2">select an artist to see details</p>
              <p class="text-xs mt-2 text-[var(--color-text-tertiary)]">
                click any artist from the list
              </p>
            </div>
          </div>
        }
      >
        {(artist) => (
          <div class="p-6">
            <h2 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
              {artist().name}
            </h2>

            <div class="grid grid-cols-2 gap-4 mb-6">
              <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
                <div class="text-[var(--color-text-tertiary)] text-sm mb-1">
                  songs
                </div>
                <div class="text-[var(--color-text-primary)] text-2xl font-semibold">
                  {artist().songCount}
                </div>
              </div>
              <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
                <div class="text-[var(--color-text-tertiary)] text-sm mb-1">
                  albums
                </div>
                <div class="text-[var(--color-text-primary)] text-2xl font-semibold">
                  {artist().albumCount}
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                recent albums
              </h3>
              <For each={[1, 2, 3]}>
                {(i) => (
                  <div class="bg-[var(--color-bg-secondary)] rounded-lg p-3">
                    <div class="font-medium text-[var(--color-text-primary)]">
                      album {i}
                    </div>
                    <div class="text-sm text-[var(--color-text-tertiary)]">
                      {Math.floor(Math.random() * 15) + 5} songs
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    );

    // alphabet nav (only show when sorted by artist name)
    const alphabetNav =
      sortBy() === "artist" ? (
        <AlphabetNav
          currentLetter={currentLetter()}
          disabledLetters={disabledLetters()}
          onLetterClick={handleLetterClick}
          sortDirection={sortDirection()}
        />
      ) : undefined;

    return (
      <div style={{ height: "600px" }}>
        <TwoColumnLayout
          leftColumn={leftColumn}
          rightColumn={rightColumn}
          alphabetNav={alphabetNav}
        />
      </div>
    );
  },
};

/**
 * basic two-column layout without alphabet navigation
 */
export const BasicTwoColumn: Story = {
  render: () => {
    const leftColumn = (
      <div class="p-6">
        <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
          left column
        </h2>
        <p class="text-[var(--color-text-secondary)]">
          this is the left column content. typically used for lists or
          navigation.
        </p>
      </div>
    );

    const rightColumn = (
      <div class="p-6">
        <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
          right column
        </h2>
        <p class="text-[var(--color-text-secondary)]">
          this is the right column content. typically used for detail views.
        </p>
      </div>
    );

    return (
      <div style={{ height: "400px" }}>
        <TwoColumnLayout leftColumn={leftColumn} rightColumn={rightColumn} />
      </div>
    );
  },
};

/**
 * custom left column width
 */
export const CustomWidth: Story = {
  render: () => {
    const leftColumn = (
      <div class="p-6">
        <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
          narrow column
        </h2>
        <p class="text-[var(--color-text-secondary)] text-sm">200px wide</p>
      </div>
    );

    const rightColumn = (
      <div class="p-6">
        <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
          wide column
        </h2>
        <p class="text-[var(--color-text-secondary)]">fills remaining space</p>
      </div>
    );

    return (
      <div style={{ height: "400px" }}>
        <TwoColumnLayout
          leftColumn={leftColumn}
          rightColumn={rightColumn}
          leftColumnWidth={200}
        />
      </div>
    );
  },
};
