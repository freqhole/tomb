import { createSignal } from "solid-js";
import { QueryClientProvider, QueryClient } from "@tanstack/solid-query";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VirtualVideoGrid } from "../src/components/virtualized/VirtualVideoGrid";
import type { VideoSummary } from "../src/video/data/types";
import { generateBulkVideos, placeholderImage } from "./mockData";

// shared query client for stories — VideoCard's taxon/series/season/tag
// queries need this (all disabled here, same as VirtualFeedList's
// FavoriteToggle) — they just resolve to "no data" instead of crashing.
const storyQueryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false } },
});

const meta = {
  title: "Components/Virtualized/VirtualVideoGrid",
  component: VirtualVideoGrid,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <QueryClientProvider client={storyQueryClient}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  argTypes: {
    columns: {
      control: "number",
      description: "number of columns in the grid",
    },
    height: {
      control: "number",
      description: "height of the container in pixels",
    },
  },
} satisfies Meta<typeof VirtualVideoGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const withImageUrl = (video: VideoSummary) => placeholderImage(video.id, video.title);

// default grid — mix of standalone videos + series episodes
export const Default: Story = {
  args: {
    videos: generateBulkVideos(60),
    columns: 4,
    height: 600,
    getVideoImageUrl: withImageUrl,
  },
};

// more columns, smaller cards
export const ManyColumns: Story = {
  args: {
    videos: generateBulkVideos(120),
    columns: 6,
    height: 600,
    getVideoImageUrl: withImageUrl,
  },
};

// huge collection — performance check
export const HugeCollection: Story = {
  args: {
    videos: generateBulkVideos(1000),
    columns: 5,
    height: 700,
    getVideoImageUrl: withImageUrl,
  },
};

// interactive example with click/play handlers
export const Interactive: Story = {
  render: () => {
    const videos = generateBulkVideos(80);
    const [lastAction, setLastAction] = createSignal("");

    const handleClick = (video: VideoSummary) => setLastAction(`clicked: ${video.title}`);
    const handlePlay = (video: VideoSummary) => setLastAction(`playing: ${video.title}`);

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded">
          <div class="text-white text-sm">
            <span class="text-gray-400">last action:</span> {lastAction() || "none yet"}
          </div>
        </div>
        <VirtualVideoGrid
          videos={videos}
          columns={4}
          height={600}
          getVideoImageUrl={withImageUrl}
          onVideoClick={handleClick}
          onVideoPlay={handlePlay}
        />
      </div>
    );
  },
};
