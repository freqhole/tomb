import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CollectionCardData } from "../src/components/cards/CollectionCard";
import { VirtualAlbumGrid } from "../src/components/virtualized/VirtualAlbumGrid";
import { generateBulkAlbums } from "./mockData";

const meta = {
  title: "Components/Virtualized/VirtualAlbumGrid",
  component: VirtualAlbumGrid,
  tags: ["autodocs"],
  argTypes: {
    columns: {
      control: "number",
      description: "number of columns in the grid",
    },
    height: {
      control: "number",
      description: "height of the container in pixels",
    },
    cardSize: {
      control: "select",
      options: ["small", "medium", "large"],
      description: "card size variant",
    },
    showYear: {
      control: "boolean",
      description: "show year in metadata",
    },
    showGenres: {
      control: "boolean",
      description: "show genres",
    },
  },
} satisfies Meta<typeof VirtualAlbumGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

// generate mock album data using shared data
const generateAlbums = (count: number): CollectionCardData[] => {
  return generateBulkAlbums(count);
};

// default grid (4 columns, 100 albums)
export const Default: Story = {
  args: {
    albums: generateAlbums(100),
    columns: 4,
    height: 600,
    cardSize: "medium",
    showYear: true,
  },
};

// small cards, more columns
export const SmallCards: Story = {
  args: {
    albums: generateAlbums(200),
    columns: 6,
    height: 600,
    cardSize: "small",
    showYear: true,
  },
};

// large cards, fewer columns
export const LargeCards: Story = {
  args: {
    albums: generateAlbums(50),
    columns: 3,
    height: 600,
    cardSize: "large",
    showYear: true,
    showGenres: true,
  },
};

// huge collection (1000 albums)
export const HugeCollection: Story = {
  args: {
    albums: generateAlbums(1000),
    columns: 4,
    height: 600,
    cardSize: "medium",
    showYear: true,
  },
};

// massive collection (5000 albums) - performance test
export const MassiveCollection: Story = {
  args: {
    albums: generateAlbums(5000),
    columns: 5,
    height: 700,
    cardSize: "small",
  },
};

// interactive example with click handlers
export const Interactive: Story = {
  render: () => {
    const albums = generateAlbums(200);
    const [selectedAlbum, setSelectedAlbum] =
      createSignal<CollectionCardData | null>(null);
    const [lastAction, setLastAction] = createSignal("");

    const handleClick = (album: CollectionCardData) => {
      setSelectedAlbum(album);
      setLastAction(`clicked: ${album.title}`);
    };

    const handlePlay = (album: CollectionCardData) => {
      setLastAction(`playing: ${album.title}`);
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
          <div class="text-white text-sm">
            <span class="text-gray-400">selected:</span>{" "}
            <span class="text-magenta-400">
              {selectedAlbum()?.title || "none"}
            </span>
          </div>
          <div class="text-white text-sm">
            <span class="text-gray-400">last action:</span>{" "}
            <span class="text-magenta-400">{lastAction() || "none"}</span>
          </div>
          <div class="text-xs text-gray-500">
            click cards to select, hover and click play button
          </div>
        </div>

        <VirtualAlbumGrid
          albums={albums}
          columns={4}
          height={600}
          cardSize="medium"
          showYear={true}
          onAlbumClick={handleClick}
          onAlbumPlay={handlePlay}
        />
      </div>
    );
  },
};

// responsive column layout
export const ResponsiveColumns: Story = {
  render: () => {
    const albums = generateAlbums(100);
    const [columns, setColumns] = createSignal(4);

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
          <div class="text-white text-sm">
            columns: <span class="text-magenta-400">{columns()}</span>
          </div>
          <input
            type="range"
            min="2"
            max="8"
            value={columns()}
            onInput={(e) => setColumns(parseInt(e.currentTarget.value))}
            class="w-full"
          />
        </div>

        <VirtualAlbumGrid
          albums={albums}
          columns={columns()}
          height={600}
          cardSize="medium"
          showYear={true}
        />
      </div>
    );
  },
};

// different card sizes comparison
export const CardSizeComparison: Story = {
  render: () => {
    const albums = generateAlbums(60);

    return (
      <div class="space-y-8">
        <div class="space-y-2">
          <div class="text-gray-300 text-xs uppercase tracking-wide">
            small cards (6 columns)
          </div>
          <VirtualAlbumGrid
            albums={albums}
            columns={6}
            height={400}
            cardSize="small"
          />
        </div>

        <div class="space-y-2">
          <div class="text-gray-300 text-xs uppercase tracking-wide">
            medium cards (4 columns)
          </div>
          <VirtualAlbumGrid
            albums={albums}
            columns={4}
            height={400}
            cardSize="medium"
          />
        </div>

        <div class="space-y-2">
          <div class="text-gray-300 text-xs uppercase tracking-wide">
            large cards (3 columns)
          </div>
          <VirtualAlbumGrid
            albums={albums}
            columns={3}
            height={400}
            cardSize="large"
            showGenres={true}
          />
        </div>
      </div>
    );
  },
};

// empty grid
export const EmptyGrid: Story = {
  args: {
    albums: [],
    columns: 4,
    height: 400,
    cardSize: "medium",
  },
};

// single row
export const SingleRow: Story = {
  args: {
    albums: generateAlbums(5),
    columns: 5,
    height: 300,
    cardSize: "medium",
    showYear: true,
  },
};

// with all metadata
export const AllMetadata: Story = {
  args: {
    albums: generateAlbums(100),
    columns: 4,
    height: 600,
    cardSize: "medium",
    showYear: true,
    showGenres: true,
  },
};

// mixed albums (some with images, some without)
export const MixedImages: Story = {
  render: () => {
    const albums = generateAlbums(80).map((album, i) => ({
      ...album,
      imageUrl: i % 2 === 0 ? album.imageUrl : null,
    }));

    return (
      <VirtualAlbumGrid
        albums={albums}
        columns={4}
        height={600}
        cardSize="medium"
        showYear={true}
      />
    );
  },
};
