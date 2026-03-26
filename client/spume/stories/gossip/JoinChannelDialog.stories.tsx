import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { JoinChannelDialog } from "../../src/components/gossip/JoinChannelDialog";

const meta = {
  title: "Gossip/JoinChannelDialog",
  component: JoinChannelDialog,
  tags: ["autodocs"],
  argTypes: {
    onJoin: { action: "join" },
    onCancel: { action: "cancel" },
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof JoinChannelDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithError: Story = {
  name: "with error",
  args: {
    error: "invalid invite token — check the format and try again",
  },
};
