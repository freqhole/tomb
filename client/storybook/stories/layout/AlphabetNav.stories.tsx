import { createVirtualizer } from "@tanstack/solid-virtual";
import { createEffect, createSignal, For, onMount } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlphabetNav } from "../../src/components/navigation/AlphabetNav";
import { MarqueeText } from "../../src/components/text/MarqueeText";

const meta = {
  title: "Layout/AlphabetNav",
  component: AlphabetNav,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof AlphabetNav>;

export default meta;
type Story = StoryObj<typeof meta>;

// comprehensive artist list with various starting letters
interface MockArtist {
  name: string;
  songCount: number;
  albumCount: number;
}

const mockArtists: MockArtist[] = [
  { name: "2Pac", songCount: 87, albumCount: 5 },
  { name: "50 Cent", songCount: 54, albumCount: 4 },
  { name: "A Tribe Called Quest", songCount: 112, albumCount: 6 },
  { name: "AC/DC", songCount: 203, albumCount: 17 },
  { name: "Adele", songCount: 41, albumCount: 3 },
  { name: "Aerosmith", songCount: 178, albumCount: 15 },
  { name: "Aphex Twin", songCount: 267, albumCount: 23 },
  { name: "Arctic Monkeys", songCount: 89, albumCount: 6 },
  { name: "The Beatles", songCount: 302, albumCount: 13 },
  { name: "Beck", songCount: 178, albumCount: 14 },
  { name: "Beyoncé", songCount: 103, albumCount: 7 },
  { name: "Björk", songCount: 134, albumCount: 9 },
  { name: "Black Sabbath", songCount: 156, albumCount: 12 },
  { name: "Blur", songCount: 124, albumCount: 7 },
  { name: "Bob Dylan", songCount: 523, albumCount: 39 },
  { name: "Bob Marley", songCount: 187, albumCount: 11 },
  { name: "Bon Iver", songCount: 57, albumCount: 4 },
  { name: "Beastie Boys", songCount: 134, albumCount: 8 },
  { name: "Coldplay", songCount: 156, albumCount: 9 },
  { name: "The Cure", songCount: 267, albumCount: 13 },
  { name: "Daft Punk", songCount: 62, albumCount: 4 },
  { name: "David Bowie", songCount: 402, albumCount: 27 },
  { name: "Death Cab for Cutie", songCount: 143, albumCount: 9 },
  { name: "Depeche Mode", songCount: 234, albumCount: 14 },
  { name: "Drake", songCount: 312, albumCount: 11 },
  { name: "Eagles", songCount: 89, albumCount: 7 },
  { name: "Elton John", songCount: 378, albumCount: 31 },
  { name: "Eminem", songCount: 289, albumCount: 11 },
  { name: "The Eagles", songCount: 89, albumCount: 7 },
  { name: "Fleet Foxes", songCount: 48, albumCount: 3 },
  { name: "Fleetwood Mac", songCount: 156, albumCount: 17 },
  { name: "Foo Fighters", songCount: 143, albumCount: 10 },
  { name: "Franz Ferdinand", songCount: 67, albumCount: 5 },
  { name: "Gorillaz", songCount: 98, albumCount: 7 },
  { name: "Green Day", songCount: 178, albumCount: 13 },
  { name: "Guns N' Roses", songCount: 134, albumCount: 6 },
  { name: "The Head and the Heart", songCount: 52, albumCount: 4 },
  { name: "Imagine Dragons", songCount: 87, albumCount: 5 },
  { name: "Iron Maiden", songCount: 203, albumCount: 16 },
  { name: "The Jimi Hendrix Experience", songCount: 78, albumCount: 3 },
  { name: "Joy Division", songCount: 54, albumCount: 2 },
  { name: "Kendrick Lamar", songCount: 98, albumCount: 5 },
  { name: "Killer Mike", songCount: 178, albumCount: 10 },
  { name: "The Killers", songCount: 89, albumCount: 6 },
  { name: "Kings of Leon", songCount: 112, albumCount: 8 },
  { name: "The Kinks", songCount: 234, albumCount: 24 },
  { name: "LCD Soundsystem", songCount: 76, albumCount: 4 },
  { name: "Led Zeppelin", songCount: 108, albumCount: 8 },
  { name: "Linkin Park", songCount: 134, albumCount: 7 },
  { name: "The Lumineers", songCount: 43, albumCount: 3 },
  { name: "Massive Attack", songCount: 87, albumCount: 5 },
  { name: "Metallica", songCount: 203, albumCount: 10 },
  { name: "MGMT", songCount: 54, albumCount: 4 },
  { name: "Modest Mouse", songCount: 156, albumCount: 8 },
  { name: "Muse", songCount: 143, albumCount: 8 },
  { name: "Nirvana", songCount: 102, albumCount: 3 },
  { name: "Nine Inch Nails", songCount: 187, albumCount: 9 },
  { name: "Oasis", songCount: 156, albumCount: 7 },
  { name: "OutKast", songCount: 134, albumCount: 6 },
  { name: "Pearl Jam", songCount: 178, albumCount: 11 },
  { name: "Pink Floyd", songCount: 187, albumCount: 15 },
  { name: "Pixies", songCount: 98, albumCount: 7 },
  { name: "Portishead", songCount: 37, albumCount: 3 },
  { name: "The Postal Service", songCount: 32, albumCount: 2 },
  { name: "Primus", songCount: 134, albumCount: 9 },
  { name: "Queen", songCount: 234, albumCount: 15 },
  { name: "Radiohead", songCount: 187, albumCount: 9 },
  { name: "Rage Against the Machine", songCount: 72, albumCount: 4 },
  { name: "Red Hot Chili Peppers", songCount: 234, albumCount: 11 },
  { name: "R.E.M.", songCount: 267, albumCount: 15 },
  { name: "The Rolling Stones", songCount: 412, albumCount: 30 },
  { name: "Run-DMC", songCount: 87, albumCount: 7 },
  { name: "The Smiths", songCount: 89, albumCount: 4 },
  { name: "Sonic Youth", songCount: 203, albumCount: 16 },
  { name: "Soundgarden", songCount: 98, albumCount: 6 },
  { name: "The Strokes", songCount: 87, albumCount: 6 },
  { name: "Sublime", songCount: 76, albumCount: 5 },
  { name: "System of a Down", songCount: 78, albumCount: 5 },
  { name: "Talking Heads", songCount: 134, albumCount: 8 },
  { name: "Tame Impala", songCount: 67, albumCount: 4 },
  { name: "Tool", songCount: 62, albumCount: 5 },
  { name: "Travis Scott", songCount: 98, albumCount: 4 },
  { name: "TV on the Radio", songCount: 72, albumCount: 5 },
  { name: "U2", songCount: 312, albumCount: 14 },
  { name: "The Velvet Underground", songCount: 87, albumCount: 4 },
  { name: "Vampire Weekend", songCount: 76, albumCount: 4 },
  { name: "Weezer", songCount: 178, albumCount: 14 },
  { name: "Ween", songCount: 312, albumCount: 14 },
  { name: "The White Stripes", songCount: 109, albumCount: 6 },
  { name: "Wilco", songCount: 187, albumCount: 11 },
  { name: "Wu-Tang Clan", songCount: 134, albumCount: 8 },
  { name: "Yeah Yeah Yeahs", songCount: 67, albumCount: 5 },
  { name: "The xx", songCount: 43, albumCount: 3 },
  { name: "ZZ Top", songCount: 178, albumCount: 15 },
];

// group artists by first letter
interface LetterSection {
  letter: string;
  artists: MockArtist[];
}

function groupArtistsByLetter(artists: MockArtist[]): LetterSection[] {
  const grouped = new Map<string, MockArtist[]>();

  artists.forEach((artist) => {
    const firstChar = artist.name.charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";

    if (!grouped.has(letter)) {
      grouped.set(letter, []);
    }
    grouped.get(letter)!.push(artist);
  });

  // sort by letter, with # first
  const sections: LetterSection[] = [];
  const letters = Array.from(grouped.keys()).sort((a, b) => {
    if (a === "#") return -1;
    if (b === "#") return 1;
    return a.localeCompare(b);
  });

  letters.forEach((letter) => {
    sections.push({
      letter,
      artists: grouped
        .get(letter)!
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  return sections;
}

/**
 * interactive artist list with virtualized scrolling and letter jump navigation
 *
 * demonstrates real-world usage with:
 * - virtualized list for performance with large datasets
 * - letter section headers
 * - scroll-to-letter functionality
 * - disabled letters (no artists starting with that letter)
 */
export const Interactive: Story = {
  render: () => {
    const [currentLetter, setCurrentLetter] = createSignal<string | undefined>(
      "A",
    );
    const sections = groupArtistsByLetter(mockArtists);

    // calculate which letters have no artists
    const disabledLetters = () => {
      const allLetters = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
      const availableLetters = new Set(sections.map((s) => s.letter));
      return new Set(allLetters.filter((l) => !availableLetters.has(l)));
    };

    // flatten sections into items (section headers + artists)
    type ListItem =
      | { type: "header"; letter: string }
      | { type: "artist"; artist: MockArtist; letter: string };
    const listItems = (): ListItem[] => {
      const items: ListItem[] = [];
      sections.forEach((section) => {
        items.push({ type: "header", letter: section.letter });
        section.artists.forEach((artist) => {
          items.push({ type: "artist", artist, letter: section.letter });
        });
      });
      return items;
    };

    let scrollContainerRef: HTMLDivElement | undefined;

    const virtualizer = createVirtualizer({
      get count() {
        return listItems().length;
      },
      getScrollElement: () => scrollContainerRef,
      estimateSize: (index) => {
        const item = listItems()[index];
        return item.type === "header" ? 40 : 72; // two-line artist rows with extra height
      },
      overscan: 5,
    });

    // update current letter based on scroll position
    createEffect(() => {
      const items = virtualizer.getVirtualItems();
      if (items.length > 0) {
        const firstVisibleItem = listItems()[items[0].index];
        if (firstVisibleItem) {
          setCurrentLetter(firstVisibleItem.letter);
        }
      }
    });

    // scroll to letter when clicked
    const handleLetterClick = (letter: string) => {
      const items = listItems();
      const index = items.findIndex(
        (item) => item.type === "header" && item.letter === letter,
      );
      if (index !== -1) {
        virtualizer.scrollToIndex(index, { align: "start" });
        setCurrentLetter(letter);
      }
    };

    return (
      <div
        style={{
          height: "600px",
          display: "flex",
          "background-color": "var(--color-bg-primary)",
        }}
      >
        <AlphabetNav
          currentLetter={currentLetter()}
          disabledLetters={disabledLetters()}
          onLetterClick={handleLetterClick}
          sortDirection="asc"
        />
        <div
          style={{
            width: "360px",
            "border-left": "1px solid var(--color-border-default)",
            display: "flex",
            "flex-direction": "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "20px",
              "border-bottom": "1px solid var(--color-border-default)",
            }}
          >
            <h2
              style={{
                color: "var(--color-text-primary)",
                "margin-bottom": "8px",
                "font-size": "24px",
                "font-weight": "600",
              }}
            >
              artists
            </h2>
            <p
              style={{
                color: "var(--color-text-secondary)",
                "font-size": "14px",
              }}
            >
              {mockArtists.length} artists
            </p>
          </div>

          <div
            ref={scrollContainerRef}
            style={{
              flex: 1,
              overflow: "auto",
              position: "relative",
            }}
            class="scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border-default)]"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              <For each={virtualizer.getVirtualItems()}>
                {(virtualItem) => {
                  const item = listItems()[virtualItem.index];

                  return (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      {item.type === "header" ? (
                        <div
                          style={{
                            height: "40px",
                            padding: "8px 20px",
                            "background-color": "var(--color-bg-secondary)",
                            color: "var(--color-accent-400)",
                            "font-weight": "600",
                            "font-size": "14px",
                            display: "flex",
                            "align-items": "center",
                            "border-bottom":
                              "1px solid var(--color-border-default)",
                          }}
                        >
                          {item.letter}
                        </div>
                      ) : (
                        <div
                          style={{
                            height: "72px",
                            padding: "14px 20px",
                            "border-bottom":
                              "1px solid var(--color-border-subtle)",
                            cursor: "pointer",
                            transition: "background-color 0.15s ease",
                            display: "flex",
                            "flex-direction": "column",
                            "justify-content": "center",
                            gap: "6px",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "var(--color-bg-secondary)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor =
                              "transparent";
                          }}
                        >
                          <div
                            style={{
                              overflow: "hidden",
                              "white-space": "nowrap",
                              "line-height": "1.4",
                              "font-size": "14px",
                              color: "var(--color-text-secondary)",
                            }}
                          >
                            <MarqueeText
                              text={item.artist.name}
                              hoverOnly={true}
                            />
                          </div>
                          <div
                            style={{
                              "font-size": "12px",
                              color: "var(--color-text-tertiary)",
                            }}
                          >
                            {item.artist.songCount} songs ·{" "}
                            {item.artist.albumCount} albums
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </div>
    );
  },
};

/**
 * alphabet nav with some disabled letters (no items)
 */
export const WithDisabledLetters: Story = {
  render: () => {
    const [currentLetter, setCurrentLetter] = createSignal<string | undefined>(
      "B",
    );

    // simulate letters with no items
    const disabledLetters = new Set(["E", "I", "O", "Q", "U", "X", "Z", "#"]);

    return (
      <div
        style={{
          height: "500px",
          display: "flex",
          "background-color": "var(--color-bg-primary)",
        }}
      >
        <AlphabetNav
          currentLetter={currentLetter()}
          disabledLetters={disabledLetters}
          onLetterClick={(letter) => {
            setCurrentLetter(letter);
            console.log("clicked letter:", letter);
          }}
          sortDirection="asc"
        />
        <div style={{ padding: "20px", color: "var(--color-text-primary)" }}>
          <p>
            current letter: <strong>{currentLetter() || "none"}</strong>
          </p>
          <p
            style={{
              "margin-top": "10px",
              color: "var(--color-text-secondary)",
              "font-size": "14px",
            }}
          >
            disabled letters (E, I, O, Q, U, X, Z, #) cannot be clicked
          </p>
        </div>
      </div>
    );
  },
};

/**
 * descending sort order (Z to A, then #)
 */
export const DescendingOrder: Story = {
  render: () => {
    const [currentLetter, setCurrentLetter] = createSignal<string | undefined>(
      "Z",
    );

    return (
      <div
        style={{
          height: "500px",
          display: "flex",
          "background-color": "var(--color-bg-primary)",
        }}
      >
        <AlphabetNav
          currentLetter={currentLetter()}
          onLetterClick={(letter) => {
            setCurrentLetter(letter);
            console.log("clicked letter:", letter);
          }}
          sortDirection="desc"
        />
        <div style={{ padding: "20px", color: "var(--color-text-primary)" }}>
          <p>
            current letter: <strong>{currentLetter() || "none"}</strong>
          </p>
          <p
            style={{
              "margin-top": "10px",
              color: "var(--color-text-secondary)",
              "font-size": "14px",
            }}
          >
            sort direction: descending (Z-A, #)
          </p>
        </div>
      </div>
    );
  },
};

/**
 * no current letter selected
 */
export const NoSelection: Story = {
  render: () => {
    const [currentLetter, setCurrentLetter] = createSignal<
      string | undefined
    >();

    return (
      <div
        style={{
          height: "500px",
          display: "flex",
          "background-color": "var(--color-bg-primary)",
        }}
      >
        <AlphabetNav
          currentLetter={currentLetter()}
          onLetterClick={(letter) => {
            setCurrentLetter(letter);
            console.log("clicked letter:", letter);
          }}
          sortDirection="asc"
        />
        <div style={{ padding: "20px", color: "var(--color-text-primary)" }}>
          <p>
            current letter: <strong>{currentLetter() || "none"}</strong>
          </p>
          <p
            style={{
              "margin-top": "10px",
              color: "var(--color-text-secondary)",
              "font-size": "14px",
            }}
          >
            no letter is currently selected
          </p>
        </div>
      </div>
    );
  },
};
