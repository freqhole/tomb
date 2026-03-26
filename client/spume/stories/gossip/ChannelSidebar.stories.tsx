import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelSidebar } from "../../src/components/gossip/ChannelSidebar";
import { mockChannels } from "./mockGossipData";

const meta = {
  title: "Gossip/ChannelSidebar",
  component: ChannelSidebar,
  tags: ["autodocs"],
  argTypes: {
    onSelectChannel: { action: "selectChannel" },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "260px", height: "500px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChannelSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    channels: mockChannels,
    activeTopicId: mockChannels[0].topic_id,
    unreadTopicIds: new Set([mockChannels[1].topic_id]),
  },
};

export const NoActiveChannel: Story = {
  name: "no active channel",
  args: {
    channels: mockChannels,
    unreadTopicIds: new Set([mockChannels[0].topic_id, mockChannels[2].topic_id]),
  },
};

export const Empty: Story = {
  name: "empty state",
  args: {
    channels: [],
  },
};

export const Interactive: Story = {
  name: "interactive (click channels)",
  render: () => {
    const [active, setActive] = createSignal(mockChannels[0].topic_id);
    return (
      <ChannelSidebar
        channels={mockChannels}
        activeTopicId={active()}
        unreadTopicIds={new Set([mockChannels[2].topic_id])}
        onSelectChannel={(id) => setActive(id)}
      />
    );
  },
};
