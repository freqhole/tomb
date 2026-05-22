import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlbumDetailPopover } from "../src/components/graph/AlbumDetailPopover";
import { mockGraphAlbums } from "./mockGraphData";

const enriched =
  mockGraphAlbums.find(
    (a) =>
      a.imageUrl &&
      a.genres.length > 0 &&
      a.tags.length >= 3 &&
      a.moods.length > 0 &&
      a.styles.length > 0
  ) ?? mockGraphAlbums[0];

const minimal = {
  ...mockGraphAlbums[0],
  imageUrl: null,
  genres: [],
  tags: [],
  moods: [],
  styles: [],
  label: null,
  era: null,
};

const meta = {
  title: "Graph/AlbumDetailPopover",
  component: AlbumDetailPopover,
  tags: ["autodocs"],
} satisfies Meta<typeof AlbumDetailPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullyEnriched: Story = {
  args: { album: enriched },
};

export const Minimal: Story = {
  args: { album: minimal },
};

export const WithClose: Story = {
  args: {
    album: enriched,
    onClose: () => console.log("close clicked"),
  },
};

export const Positioned: Story = {
  args: { album: enriched, x: 40, y: 40 },
  decorators: [
    (Story: () => unknown) => (
      <div class="relative w-[420px] h-[360px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded">
        {Story() as any}
      </div>
    ),
  ],
};
