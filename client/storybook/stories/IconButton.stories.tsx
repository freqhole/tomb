import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "../src/components/buttons/IconButton";

const meta = {
  title: "Components/Buttons/Icon Button",
  component: IconButton,
  tags: ["autodocs"],
  argTypes: {
    icon: {
      control: "select",
      options: ["play", "pause", "add", "edit", "delete", "close", "more"],
      description: "icon to display",
    },
    variant: {
      control: "select",
      options: ["default", "ghost", "outline", "accent", "danger"],
      description: "button style variant",
    },
    size: {
      control: "select",
      options: ["sm", "default"],
      description: "button size",
    },
    disabled: {
      control: "boolean",
      description: "disables the button",
    },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic icon button
export const Default: Story = {
  args: {
    icon: "play",
    "aria-label": "play",
  },
};

// all variants
export const Variants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div>
          <div class="caption mb-3">ghost (default)</div>
          <div class="flex gap-2">
            <IconButton icon="play" variant="ghost" aria-label="play" />
            <IconButton icon="pause" variant="ghost" aria-label="pause" />
            <IconButton icon="add" variant="ghost" aria-label="add" />
            <IconButton icon="edit" variant="ghost" aria-label="edit" />
          </div>
        </div>

        <div>
          <div class="caption mb-3">default</div>
          <div class="flex gap-2">
            <IconButton icon="play" variant="default" aria-label="play" />
            <IconButton icon="pause" variant="default" aria-label="pause" />
            <IconButton icon="add" variant="default" aria-label="add" />
            <IconButton icon="edit" variant="default" aria-label="edit" />
          </div>
        </div>

        <div>
          <div class="caption mb-3">outline</div>
          <div class="flex gap-2">
            <IconButton icon="play" variant="outline" aria-label="play" />
            <IconButton icon="pause" variant="outline" aria-label="pause" />
            <IconButton icon="add" variant="outline" aria-label="add" />
            <IconButton icon="edit" variant="outline" aria-label="edit" />
          </div>
        </div>

        <div>
          <div class="caption mb-3">accent</div>
          <div class="flex gap-2">
            <IconButton icon="play" variant="accent" aria-label="play" />
            <IconButton icon="pause" variant="accent" aria-label="pause" />
            <IconButton icon="add" variant="accent" aria-label="add" />
            <IconButton icon="edit" variant="accent" aria-label="edit" />
          </div>
        </div>

        <div>
          <div class="caption mb-3">danger</div>
          <div class="flex gap-2">
            <IconButton icon="delete" variant="danger" aria-label="delete" />
            <IconButton icon="close" variant="danger" aria-label="close" />
          </div>
        </div>
      </div>
    </div>
  ),
};

// all sizes
export const Sizes: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div>
          <div class="caption mb-3">small</div>
          <div class="flex gap-2 items-center">
            <IconButton icon="play" size="sm" aria-label="play" />
            <IconButton icon="pause" size="sm" aria-label="pause" />
            <IconButton icon="add" size="sm" aria-label="add" />
            <IconButton icon="edit" size="sm" aria-label="edit" />
          </div>
        </div>

        <div>
          <div class="caption mb-3">default</div>
          <div class="flex gap-2 items-center">
            <IconButton icon="play" aria-label="play" />
            <IconButton icon="pause" aria-label="pause" />
            <IconButton icon="add" aria-label="add" />
            <IconButton icon="edit" aria-label="edit" />
          </div>
        </div>
      </div>
    </div>
  ),
};

// disabled state
export const Disabled: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div class="flex gap-2">
          <IconButton icon="play" disabled aria-label="play" />
          <IconButton
            icon="pause"
            disabled
            variant="default"
            aria-label="pause"
          />
          <IconButton icon="add" disabled variant="accent" aria-label="add" />
          <IconButton
            icon="delete"
            disabled
            variant="danger"
            aria-label="delete"
          />
        </div>
      </div>
    </div>
  ),
};

// interactive example - play/pause toggle
export const PlayPauseToggle: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(false);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <IconButton
              icon={isPlaying() ? "pause" : "play"}
              variant="accent"
              onClick={() => setIsPlaying(!isPlaying())}
              aria-label={isPlaying() ? "pause" : "play"}
            />
            <span class="body-small text-[var(--color-text-secondary)]">
              {isPlaying() ? "playing" : "paused"}
            </span>
          </div>
        </div>
      </div>
    );
  },
};

// in context - toolbar
export const Toolbar: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="bg-[var(--color-bg-secondary)] rounded-lg p-3">
        <div class="flex items-center justify-between">
          <div class="flex gap-1">
            <IconButton icon="add" aria-label="add song" />
            <IconButton icon="edit" aria-label="edit" />
            <IconButton icon="filter" aria-label="filter" />
            <IconButton icon="sort" aria-label="sort" />
          </div>
          <div class="flex gap-1">
            <IconButton icon="grid" aria-label="grid view" />
            <IconButton icon="list" aria-label="list view" />
            <IconButton icon="more" aria-label="more options" />
          </div>
        </div>
      </div>
    </div>
  ),
};

// in context - player controls
export const PlayerControls: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [isShuffle, setIsShuffle] = createSignal(false);
    const [repeatMode, setRepeatMode] = createSignal<"off" | "all" | "one">(
      "off",
    );

    const cycleRepeat = () => {
      const modes: Array<"off" | "all" | "one"> = ["off", "all", "one"];
      const current = modes.indexOf(repeatMode());
      setRepeatMode(modes[(current + 1) % modes.length]);
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="bg-[var(--color-bg-secondary)] rounded-lg p-6">
          <div class="flex items-center justify-center gap-4">
            <IconButton
              icon="shuffle"
              variant={isShuffle() ? "accent" : "ghost"}
              onClick={() => setIsShuffle(!isShuffle())}
              aria-label="shuffle"
            />
            <IconButton icon="previous" aria-label="previous track" />
            <IconButton
              icon={isPlaying() ? "pause" : "play"}
              variant="accent"
              onClick={() => setIsPlaying(!isPlaying())}
              aria-label={isPlaying() ? "pause" : "play"}
            />
            <IconButton icon="next" aria-label="next track" />
            <IconButton
              icon={repeatMode() === "one" ? "repeatOne" : "repeat"}
              variant={repeatMode() !== "off" ? "accent" : "ghost"}
              onClick={cycleRepeat}
              aria-label="repeat mode"
            />
          </div>
        </div>
      </div>
    );
  },
};

// in context - modal header
export const ModalHeader: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="bg-[var(--color-bg-secondary)] rounded-lg">
        <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 class="heading-5 text-[var(--color-text-primary)]">
            edit song metadata
          </h2>
          <IconButton icon="close" aria-label="close dialog" />
        </div>
        <div class="p-4">
          <p class="body-small text-[var(--color-text-secondary)]">
            modal content goes here...
          </p>
        </div>
      </div>
    </div>
  ),
};

// in context - song row actions
export const SongRowActions: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl">
        <div class="caption mb-4">hover over rows to see actions</div>
        <div class="space-y-2">
          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] group transition-colors">
            <IconButton
              icon="play"
              size="sm"
              variant="ghost"
              aria-label="play song"
            />
            <div class="flex-1">
              <div class="body-small text-[var(--color-text-primary)]">
                speak to me
              </div>
              <div class="caption">pink floyd</div>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <IconButton icon="add" size="sm" aria-label="add to playlist" />
              <IconButton icon="favorite" size="sm" aria-label="favorite" />
              <IconButton icon="more" size="sm" aria-label="more options" />
            </div>
            <span class="monospace caption text-[var(--color-text-muted)]">
              1:13
            </span>
          </div>

          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] group transition-colors">
            <IconButton
              icon="play"
              size="sm"
              variant="ghost"
              aria-label="play song"
            />
            <div class="flex-1">
              <div class="body-small text-[var(--color-text-primary)]">
                breathe (in the air)
              </div>
              <div class="caption">pink floyd</div>
            </div>
            <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <IconButton icon="add" size="sm" aria-label="add to playlist" />
              <IconButton icon="favorite" size="sm" aria-label="favorite" />
              <IconButton icon="more" size="sm" aria-label="more options" />
            </div>
            <span class="monospace caption text-[var(--color-text-muted)]">
              2:43
            </span>
          </div>
        </div>
      </div>
    </div>
  ),
};

// all icons showcase
export const AllIcons: Story = {
  render: () => {
    const icons = [
      "play",
      "pause",
      "previous",
      "next",
      "stop",
      "shuffle",
      "repeat",
      "repeatOne",
      "queue",
      "volume",
      "volumeOff",
      "add",
      "edit",
      "delete",
      "close",
      "more",
      "favorite",
      "search",
      "filter",
      "sort",
      "grid",
      "list",
      "home",
      "album",
      "artist",
      "playlist",
      "music",
    ] as const;

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="caption mb-4">hover to see each icon button</div>
        <div class="grid grid-cols-8 gap-4">
          {icons.map((iconName) => (
            <div class="flex flex-col items-center gap-2">
              <IconButton icon={iconName} aria-label={iconName} />
              <div class="caption text-center">{iconName}</div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};
