import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ComposeBar } from "../../src/components/gossip/ComposeBar";
import {
  mockSongRef,
  mockAlbumRef,
  mockArtistRef,
  mockPlaylistRef,
  mockGenreRef,
} from "./mockGossipData";

const allRefs = [mockSongRef, mockAlbumRef, mockArtistRef, mockPlaylistRef, mockGenreRef];

const meta = {
  title: "Gossip/ComposeBar",
  component: ComposeBar,
  tags: ["autodocs"],
  argTypes: {
    onSend: { action: "send" },
    onSearchMusic: { action: "searchMusic" },
  },
  decorators: [
    (Story) => (
      <div style={{ "max-width": "520px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComposeBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const CustomPlaceholder: Story = {
  name: "custom placeholder",
  args: {
    placeholder: "share some jazz...",
  },
};

export const WithSearchResults: Story = {
  name: "with search results (open search)",
  render: () => (
    <ComposeBar
      onSend={(text, attachments) => console.log("send", text, attachments)}
      searchResults={allRefs}
    />
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: "connecting...",
  },
};
