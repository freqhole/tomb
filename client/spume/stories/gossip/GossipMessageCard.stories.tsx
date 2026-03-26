import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { GossipMessageCard } from "../../src/components/gossip/GossipMessageCard";
import { mockMessages, mockDeletedMessage, mockNodeIds, avatarForName } from "./mockGossipData";

const meta = {
  title: "Gossip/GossipMessageCard",
  component: GossipMessageCard,
  tags: ["autodocs"],
  argTypes: {
    onReact: { action: "react" },
    onOpenReactionPicker: { action: "openReactionPicker" },
    onDelete: { action: "delete" },
    onPlay: { action: "play" },
  },
  decorators: [
    (Story) => (
      <div style={{ "max-width": "520px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GossipMessageCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithTextAndSong: Story = {
  name: "text + song ref + reactions",
  args: {
    message: mockMessages[0],
    currentNodeId: mockNodeIds.sluggo,
  },
};

export const WithAlbumRef: Story = {
  name: "text + album ref",
  args: {
    message: mockMessages[1],
    currentNodeId: mockNodeIds.sluggo,
  },
};

export const TextOnly: Story = {
  name: "text + artist ref (no reactions)",
  args: {
    message: mockMessages[2],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const MultipleRefs: Story = {
  name: "multiple music refs (no text)",
  args: {
    message: mockMessages[5],
    currentNodeId: mockNodeIds.sluggo,
  },
};

export const OwnMessage: Story = {
  name: "own message (shows delete)",
  args: {
    message: mockMessages[0],
    currentNodeId: mockNodeIds.nancy,
  },
};

export const DeletedMessage: Story = {
  name: "deleted message",
  args: {
    message: mockDeletedMessage,
    currentNodeId: mockNodeIds.nancy,
  },
};

export const MessageThread: Story = {
  name: "thread of messages",
  render: () => (
    <div class="flex flex-col">
      {mockMessages.map((msg) => (
        <GossipMessageCard
          message={msg}
          currentNodeId={mockNodeIds.nancy}
          avatarUrl={avatarForName(msg.sender_name)}
        />
      ))}
    </div>
  ),
};
