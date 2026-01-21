// storybook story for SongThumbnail component
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SongThumbnail } from "../src/components/media/SongThumbnail";

const meta = {
  title: "Components/Media/SongThumbnail",
  component: SongThumbnail,
  tags: ["autodocs"],
  argTypes: {
    index: {
      control: { type: "number", min: 0, max: 999 },
      description: "track index number (will be zero-padded to 3 digits)",
    },
    thumbnailUrl: {
      control: "text",
      description: "url of the album artwork image",
    },
    hideIndex: {
      control: "boolean",
      description: "whether to hide the index overlay",
    },
    size: {
      control: { type: "number", min: 32, max: 128, step: 8 },
      description: "size of the thumbnail in pixels",
    },
    onPlayClick: {
      action: "play clicked",
      description: "callback when thumbnail/play icon is clicked",
    },
  },
} satisfies Meta<typeof SongThumbnail>;

export default meta;
type Story = StoryObj<typeof meta>;

// default story with thumbnail image
export const WithImage: Story = {
  args: {
    index: 0,
    thumbnailUrl: "https://picsum.photos/seed/album1/200/200",
    hideIndex: false,
    size: 48,
  },
};

// without thumbnail image (transparent fallback)
export const WithoutImage: Story = {
  args: {
    index: 1,
    thumbnailUrl: null,
    hideIndex: false,
    size: 48,
  },
};

// with index hidden (simulates row hover)
export const IndexHidden: Story = {
  args: {
    index: 2,
    thumbnailUrl: "https://picsum.photos/seed/album2/200/200",
    hideIndex: true,
    size: 48,
  },
};

// different sizes
export const SmallSize: Story = {
  args: {
    index: 3,
    thumbnailUrl: "https://picsum.photos/seed/album3/200/200",
    hideIndex: false,
    size: 32,
  },
};

export const LargeSize: Story = {
  args: {
    index: 4,
    thumbnailUrl: "https://picsum.photos/seed/album4/200/200",
    hideIndex: false,
    size: 64,
  },
};

// high index numbers (3-digit padding test)
export const HighIndexNumber: Story = {
  args: {
    index: 42,
    thumbnailUrl: "https://picsum.photos/seed/album5/200/200",
    hideIndex: false,
    size: 48,
  },
};

export const VeryHighIndexNumber: Story = {
  args: {
    index: 999,
    thumbnailUrl: "https://picsum.photos/seed/album6/200/200",
    hideIndex: false,
    size: 48,
  },
};

// interactive example with toggle
export const Interactive: Story = {
  render: () => {
    const [hideIndex, setHideIndex] = createSignal(false);

    return (
      <div class="space-y-4">
        <div class="flex items-center gap-4">
          <SongThumbnail
            index={5}
            thumbnailUrl="https://picsum.photos/seed/interactive/200/200"
            hideIndex={hideIndex()}
            onPlayClick={() => console.log("play clicked!")}
            size={48}
          />
          <button
            class="px-4 py-2 bg-blue-500 text-white rounded"
            onClick={() => setHideIndex(!hideIndex())}
          >
            {hideIndex() ? "show index" : "hide index"}
          </button>
        </div>
        <p class="text-sm text-gray-600">
          hover over the thumbnail to see the play icon appear
        </p>
      </div>
    );
  },
};

// grid of examples
export const Grid: Story = {
  render: () => (
    <div class="grid grid-cols-4 gap-4 p-4">
      <SongThumbnail
        index={0}
        thumbnailUrl="https://picsum.photos/seed/grid1/200/200"
        hideIndex={false}
        onPlayClick={() => {}}
        size={48}
      />
      <SongThumbnail
        index={1}
        thumbnailUrl="https://picsum.photos/seed/grid2/200/200"
        hideIndex={false}
        onPlayClick={() => {}}
        size={48}
      />
      <SongThumbnail
        index={2}
        thumbnailUrl={null}
        hideIndex={false}
        onPlayClick={() => {}}
        size={48}
      />
      <SongThumbnail
        index={3}
        thumbnailUrl="https://picsum.photos/seed/grid3/200/200"
        hideIndex={true}
        onPlayClick={() => {}}
        size={48}
      />
    </div>
  ),
};
