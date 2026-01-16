import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";

const meta = {
  title: "Components/Button",
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
      options: ["sm", "md", "lg"],
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

// medium size (default)
export const Medium: Story = {
  args: {
    size: "md",
    children: "medium button",
  },
};

// large size
export const Large: Story = {
  args: {
    size: "lg",
    children: "large button",
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
        <div class="text-gray-300 text-sm">
          clicked: <span class="text-magenta-400 font-bold">{count()}</span>{" "}
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
        <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
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
        <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
          sizes
        </div>
        <div class="flex gap-2 items-center flex-wrap">
          <Button size="sm">small</Button>
          <Button size="md">medium</Button>
          <Button size="lg">large</Button>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
          states
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button>enabled</Button>
          <Button disabled>disabled</Button>
        </div>
      </div>
    </div>
  ),
};
