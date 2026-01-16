import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Test/Minimal",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const MinimalTest: Story = {
  render: () => <div class="text-white p-4">hello from storybook!</div>,
};
