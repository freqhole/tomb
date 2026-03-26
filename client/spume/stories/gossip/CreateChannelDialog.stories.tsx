import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CreateChannelDialog } from "../../src/components/gossip/CreateChannelDialog";

const meta = {
  title: "Gossip/CreateChannelDialog",
  component: CreateChannelDialog,
  tags: ["autodocs"],
  argTypes: {
    onSubmit: { action: "submit" },
    onCancel: { action: "cancel" },
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CreateChannelDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
