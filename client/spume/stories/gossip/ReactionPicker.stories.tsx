import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ReactionPicker } from "../../src/components/gossip/ReactionPicker";
import { commonEmojis } from "./mockGossipData";

const meta = {
  title: "Gossip/ReactionPicker",
  component: ReactionPicker,
  tags: ["autodocs"],
  argTypes: {
    onSelect: { action: "select" },
    onClose: { action: "close" },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "2rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReactionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const CustomEmojis: Story = {
  name: "custom emoji set",
  args: {
    emojis: ["🎸", "🎹", "🥁", "🎷", "🎺", "🎻"],
  },
};

export const FullSet: Story = {
  name: "using commonEmojis from mock data",
  args: {
    emojis: commonEmojis,
  },
};
