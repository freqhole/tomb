import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelThread } from "../../src/components/gossip/ChannelThread";
import { mockChannels, mockMessages, mockDeletedMessage, mockNodeIds } from "./mockGossipData";

const meta = {
  title: "Gossip/ChannelThread",
  component: ChannelThread,
  tags: ["autodocs"],
  argTypes: {
    onReact: { action: "react" },
    onOpenReactionPicker: { action: "openReactionPicker" },
    onDelete: { action: "delete" },
    onPlay: { action: "play" },
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
    currentNodeId: mockNodeIds.nancy,
  },
};

export const WithDeletedMessage: Story = {
  name: "includes deleted message",
  args: {
    channel: mockChannels[0],
    messages: [...mockMessages.slice(0, 2), mockDeletedMessage, ...mockMessages.slice(2)],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const EmptyChannel: Story = {
  name: "empty channel",
  args: {
    channel: mockChannels[3],
    messages: [],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const AsNonCreator: Story = {
  name: "viewing as sluggo (not creator)",
  args: {
    channel: mockChannels[0],
    messages: mockMessages,
    currentNodeId: mockNodeIds.sluggo,
  },
};
