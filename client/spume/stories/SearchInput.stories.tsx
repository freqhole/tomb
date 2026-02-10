import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  SearchInput,
  SearchSuggestion,
} from "../src/components/forms/SearchInput";
import { mockAlbums, mockArtists, mockGenres, mockSongs } from "./mockData";

const meta = {
  title: "Components/Forms/SearchInput",
  component: SearchInput,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "filled"],
      description: "visual style variant",
    },
    debounceMs: {
      control: "number",
      description: "debounce delay in milliseconds",
    },
    loading: {
      control: "boolean",
      description: "show loading spinner",
    },
    disabled: {
      control: "boolean",
      description: "disable the input",
    },
  },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// mock suggestions for demos using shared data
const artistSuggestions: SearchSuggestion[] = mockArtists
  .filter((a) => a.name.toLowerCase().startsWith("r"))
  .slice(0, 3)
  .map((a) => ({
    id: a.id,
    text: a.name,
    category: "artist" as const,
  }));

const radioheadArtist = mockArtists.find((a) => a.name === "Radiohead");
const radioheadAlbum = mockAlbums.find((a) => a.artist === "Radiohead");
const radioheadSongs = mockSongs
  .filter((s) => s.artist === "Radiohead")
  .slice(0, 2);
const altRockGenre = mockGenres.find((g) => g.name === "alternative rock");

const mixedSuggestions: SearchSuggestion[] = [
  { id: "1", text: "radio", category: "word" },
  ...(radioheadArtist
    ? [
        {
          id: radioheadArtist.id,
          text: radioheadArtist.name,
          category: "artist" as const,
          count: radioheadArtist.songCount,
        },
      ]
    : []),
  ...(radioheadAlbum
    ? [
        {
          id: radioheadAlbum.id,
          text: radioheadAlbum.title,
          category: "album" as const,
          count: radioheadAlbum.trackCount,
        },
      ]
    : []),
  ...radioheadSongs.map((s) => ({
    id: s.id,
    text: s.title,
    category: "song" as const,
  })),
  ...(altRockGenre
    ? [
        {
          id: altRockGenre.id,
          text: altRockGenre.name,
          category: "genre" as const,
          count: altRockGenre.songCount,
        },
      ]
    : []),
];

const highlightedSuggestions: SearchSuggestion[] = [
  ...(radioheadArtist
    ? [
        {
          id: radioheadArtist.id,
          text: radioheadArtist.name,
          highlight: "<mark>Radio</mark>head",
          category: "artist" as const,
          count: radioheadArtist.songCount,
        },
      ]
    : []),
  ...(radioheadAlbum
    ? [
        {
          id: radioheadAlbum.id,
          text: radioheadAlbum.title,
          highlight: radioheadAlbum.title.replace(/comp/i, "<mark>Comp</mark>"),
          category: "album" as const,
          count: radioheadAlbum.trackCount,
        },
      ]
    : []),
  ...radioheadSongs.slice(0, 1).map((s) => ({
    id: s.id,
    text: s.title,
    highlight: s.title.replace(/andr/i, "<mark>Andr</mark>"),
    category: "song" as const,
  })),
];

// real-world example with API simulation
export const RealWorldExample: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);
    const [selectedItem, setSelectedItem] =
      createSignal<SearchSuggestion | null>(null);

    const handleClear = () => {
      setQuery("");
      setSuggestions([]);
      setSelectedItem(null);
    };

    // simulate API call
    const searchAPI = async (
      searchQuery: string,
    ): Promise<SearchSuggestion[]> => {
      // simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // simulate API response based on query using shared mock data
      const allResults: SearchSuggestion[] = [
        { id: "w1", text: searchQuery, category: "word" },
        ...mockArtists.slice(0, 5).map((a) => ({
          id: a.id,
          text: a.name,
          category: "artist" as const,
          count: a.songCount,
        })),
        ...mockAlbums.slice(0, 3).map((a) => ({
          id: a.id,
          text: a.title,
          category: "album" as const,
          count: a.trackCount,
        })),
        ...mockSongs.slice(0, 4).map((s) => ({
          id: s.id,
          text: s.title,
          category: "song" as const,
        })),
        ...mockGenres.slice(0, 2).map((g) => ({
          id: g.id,
          text: g.name,
          category: "genre" as const,
          count: g.songCount,
        })),
      ];

      return allResults.filter((r) =>
        r.text.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    };

    const handleInputChange = async (value: string) => {
      setQuery(value);

      if (value.length < 2) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const results = await searchAPI(value);
        setSuggestions(results);
      } catch (error) {
        console.error("search failed:", error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    };

    const handleSelect = (suggestion: SearchSuggestion) => {
      if (!suggestion) return;
      setSelectedItem(suggestion);
      setQuery(suggestion.text);
      console.log("navigating to:", suggestion);
    };

    return (
      <div class="space-y-4">
        <SearchInput
          label="search freqhole"
          placeholder="search songs, artists, albums, genres..."
          loading={loading()}
          suggestions={suggestions()}
          onInputChange={handleInputChange}
          onSelect={handleSelect}
          onClear={handleClear}
          variant="filled"
          hint="results update as you type"
        />

        {selectedItem() && (
          <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
            <div class="caption text-[var(--color-text-muted)] mb-1">
              selected:
            </div>
            <div class="body-sm">
              <span class="text-[var(--color-accent-500)]">
                {selectedItem()!.category}
              </span>
              {" → "}
              <span class="text-[var(--color-text-primary)]">
                {selectedItem()!.text}
              </span>
              {selectedItem()!.count && (
                <span class="text-[var(--color-text-muted)] ml-2">
                  ({selectedItem()!.count} items)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
};

// basic example
export const Default: Story = {
  args: {
    placeholder: "search music...",
  },
};

// with label and hint
export const WithLabel: Story = {
  args: {
    label: "search library",
    placeholder: "artist, album, or song",
    hint: "type at least 2 characters to see suggestions",
  },
};

// filled variant
export const FilledVariant: Story = {
  args: {
    label: "search",
    placeholder: "search music...",
    variant: "filled",
  },
};

// with suggestions - controlled example
export const WithSuggestions: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");
    const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);

    const handleInputChange = (value: string) => {
      setQuery(value);

      // simulate filtering
      if (value.length >= 2) {
        const filtered = artistSuggestions.filter((s) =>
          s.text.toLowerCase().includes(value.toLowerCase()),
        );
        setSuggestions(filtered);
      } else {
        setSuggestions([]);
      }
    };

    const handleSelect = (suggestion: SearchSuggestion) => {
      if (!suggestion) return;
      console.log("selected:", suggestion);
      setQuery(suggestion.text);
      setSuggestions([]);
    };

    const handleClear = () => {
      setQuery("");
      setSuggestions([]);
    };

    return (
      <SearchInput
        label="search artists"
        placeholder="type to search..."
        suggestions={suggestions()}
        onInputChange={handleInputChange}
        onSelect={handleSelect}
        onClear={handleClear}
      />
    );
  },
};

// loading state
export const Loading: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");
    const [loading, setLoading] = createSignal(false);
    const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);

    const handleInputChange = (value: string) => {
      setQuery(value);

      if (value.length >= 2) {
        setLoading(true);
        setSuggestions([]);

        // simulate API call
        setTimeout(() => {
          setSuggestions(artistSuggestions);
          setLoading(false);
        }, 1000);
      } else {
        setLoading(false);
        setSuggestions([]);
      }
    };

    const handleClear = () => {
      setQuery("");
      setSuggestions([]);
      setLoading(false);
    };

    return (
      <SearchInput
        label="search with loading"
        placeholder="type to trigger loading..."
        loading={loading()}
        suggestions={suggestions()}
        onInputChange={handleInputChange}
        onSelect={(s) => s && console.log("selected:", s)}
        onClear={handleClear}
      />
    );
  },
};

// mixed categories
export const MixedCategories: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");

    return (
      <SearchInput
        label="search everything"
        placeholder="search songs, artists, albums..."
        suggestions={query().length >= 2 ? mixedSuggestions : []}
        onInputChange={setQuery}
        onSelect={(s) => s && console.log("selected:", s)}
        onClear={() => setQuery("")}
        hint="suggestions grouped by category"
      />
    );
  },
};

// with highlighting
export const WithHighlighting: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");

    return (
      <SearchInput
        label="search with highlights"
        placeholder="type to see highlighted matches..."
        suggestions={query().length >= 2 ? highlightedSuggestions : []}
        onInputChange={setQuery}
        onSelect={(s) => s && console.log("selected:", s)}
        onClear={() => setQuery("")}
        hint="matching characters are highlighted"
      />
    );
  },
};

// with counts
export const WithCounts: Story = {
  args: {
    label: "search with result counts",
    placeholder: "type to search...",
    suggestions: mixedSuggestions.filter((s) => s.count !== undefined),
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    label: "disabled search",
    placeholder: "search music...",
    disabled: true,
  },
};

// custom debounce
export const CustomDebounce: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");
    const [callCount, setCallCount] = createSignal(0);

    const handleInputChange = (value: string) => {
      setQuery(value);
      setCallCount((c) => c + 1);
      console.log(`input changed (call ${callCount()}):`, value);
    };

    const handleClear = () => {
      setQuery("");
      setCallCount(0);
    };

    return (
      <div class="space-y-4">
        <SearchInput
          label="slow debounce (1000ms)"
          placeholder="type fast to see debouncing..."
          debounceMs={1000}
          suggestions={query().length >= 2 ? artistSuggestions : []}
          onInputChange={handleInputChange}
          onSelect={(s) => s && console.log("selected:", s)}
          onClear={handleClear}
          hint={`debounced callbacks: ${callCount()}`}
        />
      </div>
    );
  },
};

// no results
export const NoResults: Story = {
  render: () => {
    const [query, setQuery] = createSignal("");

    return (
      <SearchInput
        label="search with no results"
        placeholder="type anything..."
        suggestions={[]}
        onInputChange={setQuery}
        onSelect={(s) => s && console.log("selected:", s)}
        onClear={() => setQuery("")}
        hint="type to see empty state"
      />
    );
  },
};

// multiple instances
export const MultipleInstances: Story = {
  render: () => (
    <div class="space-y-6">
      <SearchInput
        label="search artists"
        placeholder="artist name..."
        suggestions={artistSuggestions}
        variant="default"
      />

      <SearchInput
        label="search songs"
        placeholder="song title..."
        suggestions={mixedSuggestions.filter((s) => s.category === "song")}
        variant="filled"
      />
    </div>
  ),
};
