import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlbumNodeView } from "../src/components/graph/AlbumNodeView";
import { mockGraphAlbums } from "./mockGraphData";

const withImage = mockGraphAlbums.find((a) => a.imageUrl) ?? mockGraphAlbums[0];
const noImage = {
  ...(mockGraphAlbums.find((a) => !a.imageUrl) ?? mockGraphAlbums[1]),
  imageUrl: null,
};
const longTitle = {
  ...withImage,
  title: "An Extraordinarily Long-Winded Album Title That Just Keeps Going",
  artistName: "The Artist With An Unreasonably Long Name Collective",
};

const meta = {
  title: "Graph/AlbumNodeView",
  component: AlbumNodeView,
  tags: ["autodocs"],
  argTypes: {
    state: {
      control: "select",
      options: ["idle", "hover", "selected", "dimmed"],
    },
    size: { control: { type: "range", min: 32, max: 200, step: 4 } },
    showLabel: { control: "boolean" },
  },
} satisfies Meta<typeof AlbumNodeView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: { album: withImage, state: "idle", size: 72, showLabel: false },
};

export const Hover: Story = {
  args: { album: withImage, state: "hover", size: 72, showLabel: true },
};

export const Selected: Story = {
  args: { album: withImage, state: "selected", size: 72, showLabel: true },
};

export const Dimmed: Story = {
  args: { album: withImage, state: "dimmed", size: 72, showLabel: false },
};

export const NoImage: Story = {
  args: { album: noImage, state: "idle", size: 72, showLabel: false },
};

export const NoImageWithLabel: Story = {
  args: { album: noImage, state: "hover", size: 88, showLabel: true },
};

export const LongTitle: Story = {
  args: { album: longTitle, state: "selected", size: 96, showLabel: true },
};

export const Large: Story = {
  args: { album: withImage, state: "idle", size: 160, showLabel: true },
};
