import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelThread } from "../../src/components/gossip/ChannelThread";
import {
  mockChannels,
  mockMessages,
  mockDeletedMessage,
  mockMembers,
  mockNodeIds,
  mockSongRef,
  mockAlbumRef,
  mockArtistRef,
} from "./mockGossipData";

const meta = {
  title: "Gossip/ChannelThread",
  component: ChannelThread,
  tags: ["autodocs"],
  argTypes: {
    onSend: { action: "send" },
    onReact: { action: "react" },
    onOpenReactionPicker: { action: "openReactionPicker" },
    onDelete: { action: "delete" },
    onPlay: { action: "play" },
    onSearchMusic: { action: "searchMusic" },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "520px", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChannelThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    channel: mockChannels[0],
    messages: mockMessages,
    members: mockMembers[mockChannels[0].topic_id],
    currentNodeId: mockNodeIds.nancy,
    searchResults: [mockSongRef, mockAlbumRef, mockArtistRef],
  },
};

export const WithDeletedMessage: Story = {
  name: "includes deleted message",
  args: {
    channel: mockChannels[0],
    messages: [...mockMessages.slice(0, 2), mockDeletedMessage, ...mockMessages.slice(2)],
    members: mockMembers[mockChannels[0].topic_id],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const EmptyChannel: Story = {
  name: "empty channel",
  args: {
    channel: mockChannels[3],
    messages: [],
    members: [],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const AsNonCreator: Story = {
  name: "viewing as sluggo (not creator)",
  args: {
    channel: mockChannels[0],
    messages: mockMessages,
    members: mockMembers[mockChannels[0].topic_id],
    currentNodeId: mockNodeIds.sluggo,
  },
};
