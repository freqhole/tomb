import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CometBorderRing } from "../src/components/feedback/CometBorderRing";
import { Icon } from "../src/components/icons/registry";

const meta = {
  title: "Components/Feedback/Comet Border Ring",
  component: CometBorderRing,
  tags: ["autodocs"],
  argTypes: {
    active: {
      control: "boolean",
      description: "shows the animated ring around the wrapped child",
    },
  },
} satisfies Meta<typeof CometBorderRing>;

export default meta;
type Story = StoryObj<typeof meta>;

// wraps a pill-shaped button, tracing its rounded-rect border
export const Default: Story = {
  args: {
    active: true,
  },
  render: (args) => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <CometBorderRing active={args.active}>
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] border"
        >
          <span>newfreq</span>
          <Icon name="remotePlayer" size={16} />
        </button>
      </CometBorderRing>
    </div>
  ),
};

// works around any shape - here a square icon button instead of a pill
export const SquareChild: Story = {
  args: {
    active: true,
  },
  render: (args) => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <CometBorderRing active={args.active}>
        <button
          type="button"
          class="flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] border"
        >
          <Icon name="play" size={18} />
        </button>
      </CometBorderRing>
    </div>
  ),
};

// active=false renders the child with no ring at all
export const Inactive: Story = {
  args: {
    active: false,
  },
  render: (args) => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <CometBorderRing active={args.active}>
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] border"
        >
          <span>this device</span>
        </button>
      </CometBorderRing>
    </div>
  ),
};
