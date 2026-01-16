import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VolumeControl } from "../src/components/player/VolumeControl";

const meta = {
  title: "Components/Player/VolumeControl",
  component: VolumeControl,
  tags: ["autodocs"],
  argTypes: {
    volume: {
      control: { type: "range", min: 0, max: 1, step: 0.01 },
      description: "current volume (0-1)",
    },
  },
} satisfies Meta<typeof VolumeControl>;

export default meta;
type Story = StoryObj<typeof meta>;

// interactive example
export const Interactive: Story = {
  render: () => {
    const [volume, setVolume] = createSignal(0.7);

    return (
      <div class="p-8 flex flex-col items-start gap-8">
        <div class="text-[var(--color-text-secondary)] text-sm space-y-2">
          <p>hover over the volume icon to see the slider</p>
          <p>
            current volume:{" "}
            <span class="text-[var(--color-accent-500)] font-medium">
              {Math.round(volume() * 100)}%
            </span>
          </p>
        </div>

        <VolumeControl volume={volume()} onVolumeChange={setVolume} />
      </div>
    );
  },
};

// default volume (70%)
export const Default: Story = {
  args: {
    volume: 0.7,
    onVolumeChange: (v) => console.log("volume changed:", v),
  },
};

// high volume
export const HighVolume: Story = {
  args: {
    volume: 0.95,
    onVolumeChange: (v) => console.log("volume changed:", v),
  },
};

// low volume
export const LowVolume: Story = {
  args: {
    volume: 0.15,
    onVolumeChange: (v) => console.log("volume changed:", v),
  },
};

// muted
export const Muted: Story = {
  args: {
    volume: 0,
    onVolumeChange: (v) => console.log("volume changed:", v),
  },
};

// max volume
export const MaxVolume: Story = {
  args: {
    volume: 1,
    onVolumeChange: (v) => console.log("volume changed:", v),
  },
};

// in player bar context
export const InPlayerBar: Story = {
  render: () => {
    const [volume, setVolume] = createSignal(0.6);

    return (
      <div class="bg-[var(--color-bg-primary)]/90 backdrop-blur-xl p-4 border border-[var(--color-accent-500)]/30 rounded-lg">
        <div class="flex items-center justify-between gap-6">
          <div class="text-[var(--color-text-secondary)] text-sm">
            player bar simulation
          </div>

          <div class="flex items-center gap-4">
            <span class="text-sm text-[var(--color-text-secondary)]">
              volume control →
            </span>
            <VolumeControl volume={volume()} onVolumeChange={setVolume} />
          </div>
        </div>
      </div>
    );
  },
};

// multiple volume controls
export const MultipleControls: Story = {
  render: () => {
    const [volume1, setVolume1] = createSignal(0.8);
    const [volume2, setVolume2] = createSignal(0.5);
    const [volume3, setVolume3] = createSignal(0.2);

    return (
      <div class="p-8 space-y-6">
        <div class="flex items-center gap-8">
          <div class="flex flex-col items-center gap-2">
            <span class="text-sm text-[var(--color-text-secondary)]">
              track 1
            </span>
            <VolumeControl volume={volume1()} onVolumeChange={setVolume1} />
            <span class="text-xs text-[var(--color-accent-500)]">
              {Math.round(volume1() * 100)}%
            </span>
          </div>

          <div class="flex flex-col items-center gap-2">
            <span class="text-sm text-[var(--color-text-secondary)]">
              track 2
            </span>
            <VolumeControl volume={volume2()} onVolumeChange={setVolume2} />
            <span class="text-xs text-[var(--color-accent-500)]">
              {Math.round(volume2() * 100)}%
            </span>
          </div>

          <div class="flex flex-col items-center gap-2">
            <span class="text-sm text-[var(--color-text-secondary)]">
              track 3
            </span>
            <VolumeControl volume={volume3()} onVolumeChange={setVolume3} />
            <span class="text-xs text-[var(--color-accent-500)]">
              {Math.round(volume3() * 100)}%
            </span>
          </div>
        </div>
      </div>
    );
  },
};
