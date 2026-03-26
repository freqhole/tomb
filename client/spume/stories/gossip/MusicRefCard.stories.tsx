import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MusicRefCard } from "../../src/components/gossip/MusicRefCard";
import {
  mockSongRef,
  mockAlbumRef,
  mockArtistRef,
  mockPlaylistRef,
  mockGenreRef,
} from "./mockGossipData";

const meta = {
  title: "Gossip/MusicRefCard",
  component: MusicRefCard,
  tags: ["autodocs"],
  argTypes: {
    onPlay: { action: "play" },
    onKnock: { action: "knock" },
  },
  decorators: [
    (Story) => (
      <div style={{ "max-width": "420px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MusicRefCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Song: Story = {
  args: { item: mockSongRef, hasAccess: true },
};

export const Album: Story = {
  args: { item: mockAlbumRef, hasAccess: true },
};

export const Artist: Story = {
  args: { item: mockArtistRef, hasAccess: true },
};

export const Playlist: Story = {
  args: { item: mockPlaylistRef, hasAccess: true },
};

export const Genre: Story = {
  args: { item: mockGenreRef, hasAccess: true },
};

export const NoAccess: Story = {
  name: "no access (knock)",
  args: { item: mockSongRef, hasAccess: false },
};

export const AllTypes: Story = {
  name: "all types stacked",
  render: () => (
    <div class="flex flex-col gap-2">
      <MusicRefCard item={mockSongRef} hasAccess={true} />
      <MusicRefCard item={mockAlbumRef} hasAccess={true} />
      <MusicRefCard item={mockArtistRef} hasAccess={true} />
      <MusicRefCard item={mockPlaylistRef} hasAccess={true} />
      <MusicRefCard item={mockGenreRef} hasAccess={true} />
    </div>
  ),
};
