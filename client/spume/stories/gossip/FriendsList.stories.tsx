import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FriendsList } from "../../src/components/gossip/FriendsList";
import { mockFriends } from "./mockGossipData";

const meta = {
  title: "Gossip/FriendsList",
  component: FriendsList,
  tags: ["autodocs"],
  argTypes: {
    onSelectFriend: { action: "selectFriend" },
  },
  decorators: [
    (Story) => (
      <div style={{ width: "260px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FriendsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { friends: mockFriends },
};

export const AllOnline: Story = {
  name: "all online",
  args: {
    friends: mockFriends.map((f) => ({
      ...f,
      online: true,
      last_seen: Math.floor(Date.now() / 1000),
    })),
  },
};

export const Empty: Story = {
  args: { friends: [] },
};
