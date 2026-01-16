import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PlayerControls } from "../src/components/player/PlayerControls";

const meta = {
  title: "Components/Player/PlayerControls",
  component: PlayerControls,
  tags: ["autodocs"],
  argTypes: {
    isPlaying: {
      control: "boolean",
      description: "whether audio is playing",
    },
    shuffleActive: {
      control: "boolean",
      description: "whether shuffle is active",
    },
    repeatMode: {
      control: "select",
      options: ["off", "all", "one"],
      description: "repeat mode",
    },
    size: {
      control: "select",
      options: ["sm", "default", "lg"],
      description: "control size",
    },
    disabled: {
      control: "boolean",
      description: "disable all controls",
    },
  },
} satisfies Meta<typeof PlayerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

// interactive example
export const Interactive: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [shuffleActive, setShuffleActive] = createSignal(false);
    const [repeatMode, setRepeatMode] = createSignal<"off" | "all" | "one">(
      "off",
    );
    const [canGoPrevious, setCanGoPrevious] = createSignal(true);
    const [canGoNext, setCanGoNext] = createSignal(true);

    const handlePlayPause = () => {
      setIsPlaying(!isPlaying());
      console.log(isPlaying() ? "playing" : "paused");
    };

    const handlePrevious = () => {
      console.log("previous track");
    };

    const handleNext = () => {
      console.log("next track");
    };

    const handleShuffle = () => {
      setShuffleActive(!shuffleActive());
      console.log("shuffle:", !shuffleActive());
    };

    const handleRepeat = () => {
      const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"];
      const currentIndex = modes.indexOf(repeatMode());
      const nextMode = modes[(currentIndex + 1) % modes.length];
      setRepeatMode(nextMode);
      console.log("repeat mode:", nextMode);
    };

    return (
      <div class="space-y-8">
        <div class="p-6 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="space-y-4">
            <div class="body-sm text-[var(--color-text-secondary)] mb-4">
              player state
            </div>
            <div class="flex gap-4 flex-wrap">
              <button
                onClick={() => setIsPlaying(!isPlaying())}
                class="px-3 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors caption"
              >
                {isPlaying() ? "playing" : "paused"}
              </button>
              <button
                onClick={() => setShuffleActive(!shuffleActive())}
                class="px-3 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors caption"
              >
                shuffle: {shuffleActive() ? "on" : "off"}
              </button>
              <button
                onClick={handleRepeat}
                class="px-3 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors caption"
              >
                repeat: {repeatMode()}
              </button>
              <button
                onClick={() => setCanGoPrevious(!canGoPrevious())}
                class="px-3 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors caption"
              >
                previous: {canGoPrevious() ? "enabled" : "disabled"}
              </button>
              <button
                onClick={() => setCanGoNext(!canGoNext())}
                class="px-3 py-2 bg-[var(--color-bg-tertiary)} hover:bg-[var(--color-bg-hover)] rounded transition-colors caption"
              >
                next: {canGoNext() ? "enabled" : "disabled"}
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-center">
          <PlayerControls
            isPlaying={isPlaying()}
            onPlayPause={handlePlayPause}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onShuffle={handleShuffle}
            onRepeat={handleRepeat}
            canGoPrevious={canGoPrevious()}
            canGoNext={canGoNext()}
            shuffleActive={shuffleActive()}
            repeatMode={repeatMode()}
          />
        </div>
      </div>
    );
  },
};

// playing state
export const Playing: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
  },
};

// paused state
export const Paused: Story = {
  args: {
    isPlaying: false,
    onPlayPause: () => console.log("play"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
  },
};

// with shuffle and repeat
export const WithShuffleAndRepeat: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    shuffleActive: false,
    repeatMode: "off",
  },
};

// shuffle active
export const ShuffleActive: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    shuffleActive: true,
    repeatMode: "off",
  },
};

// repeat all
export const RepeatAll: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    shuffleActive: false,
    repeatMode: "all",
  },
};

// repeat one
export const RepeatOne: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    shuffleActive: false,
    repeatMode: "one",
  },
};

// at start of playlist
export const AtStart: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    canGoPrevious: false,
    canGoNext: true,
  },
};

// at end of playlist
export const AtEnd: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    canGoPrevious: true,
    canGoNext: false,
  },
};

// disabled
export const Disabled: Story = {
  args: {
    isPlaying: false,
    onPlayPause: () => console.log("play"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    disabled: true,
  },
};

// small size
export const SmallSize: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    size: "sm",
  },
};

// large size
export const LargeSize: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    size: "lg",
  },
};

// minimal (no shuffle/repeat)
export const Minimal: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
  },
};

// all features active
export const AllFeaturesActive: Story = {
  args: {
    isPlaying: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onShuffle: () => console.log("shuffle"),
    onRepeat: () => console.log("repeat"),
    shuffleActive: true,
    repeatMode: "one",
  },
};
