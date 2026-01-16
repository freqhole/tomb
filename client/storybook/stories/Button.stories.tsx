import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";

const meta = {
  title: "Components/Buttons/Button",
  component: Button,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
      description: "visual style variant",
    },
    size: {
      control: "select",
      options: ["sm", "default"],
      description: "size variant",
    },
    fullWidth: {
      control: "boolean",
      description: "whether button spans full width",
    },
    disabled: {
      control: "boolean",
      description: "whether button is disabled",
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// primary variant (default)
export const Primary: Story = {
  args: {
    variant: "primary",
    children: "primary button",
  },
};

// secondary variant
export const Secondary: Story = {
  args: {
    variant: "secondary",
    children: "secondary button",
  },
};

// ghost variant (transparent background)
export const Ghost: Story = {
  args: {
    variant: "ghost",
    children: "ghost button",
  },
};

// danger variant
export const Danger: Story = {
  args: {
    variant: "danger",
    children: "delete",
  },
};

// small size
export const Small: Story = {
  args: {
    size: "sm",
    children: "small button",
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    disabled: true,
    children: "disabled button",
  },
};

// full width
export const FullWidth: Story = {
  args: {
    fullWidth: true,
    children: "full width button",
  },
};

// interactive example with click handler
export const Interactive: Story = {
  render: () => {
    const [count, setCount] = createSignal(0);

    return (
      <div class="p-4 space-y-4">
        <div class="text-[var(--color-text-secondary)] text-sm">
          clicked:{" "}
          <span class="text-[var(--color-accent-500)] font-bold">
            {count()}
          </span>{" "}
          times
        </div>
        <Button onClick={() => setCount(count() + 1)}>click me</Button>
      </div>
    );
  },
};

// all variants showcase
export const AllVariants: Story = {
  render: () => (
    <div class="p-4 space-y-4">
      <div class="space-y-2">
        <div class="label text-[var(--color-text-secondary)] mb-2">
          variants
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button variant="primary">primary</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="danger">danger</Button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="label text-[var(--color-text-secondary)] mb-2">sizes</div>
        <div class="flex gap-2 items-center flex-wrap">
          <Button size="sm">small</Button>
          <Button>default</Button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="label text-[var(--color-text-secondary)] mb-2">states</div>
        <div class="flex gap-2 flex-wrap">
          <Button>enabled</Button>
          <Button disabled>disabled</Button>
        </div>
      </div>
    </div>
  ),
};
