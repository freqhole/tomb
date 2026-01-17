import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MarqueeText } from "../src/components/text/MarqueeText";
import { mockAlbums, mockArtists, mockSongs } from "./mockData";

const meta = {
  title: "Components/Text/MarqueeText",
  component: MarqueeText,
  tags: ["autodocs"],
  argTypes: {
    text: {
      control: "text",
      description: "text content to display",
    },
    hoverOnly: {
      control: "boolean",
      description:
        "only marquee on hover (default: false = always marquee when overflow)",
    },
  },
} satisfies Meta<typeof MarqueeText>;

export default meta;
type Story = StoryObj<typeof meta>;

// long text that overflows - should marquee
export const LongText: Story = {
  args: {
    text: "this is a very long text that will definitely overflow the container and trigger the marquee animation effect",
    class: "w-64 text-[var(--color-text-primary)]",
  },
};

// short text that fits - should not marquee
export const ShortText: Story = {
  args: {
    text: "short text",
    class: "w-64 text-[var(--color-text-primary)]",
  },
};

// medium length text in narrow container
export const NarrowContainer: Story = {
  args: {
    text: `${mockArtists[0].name} - ${mockAlbums[0].title}`,
    class: "w-32 text-[var(--color-text-primary)]",
  },
};

// with custom styling
export const CustomStyling: Story = {
  args: {
    text: `${mockArtists.find((a) => a.name === "Led Zeppelin")?.name || mockArtists[2].name} - ${mockSongs[0].title} (live)`,
    class: "w-48 text-magenta-400 font-bold text-sm",
  },
};

// hover only - marquee only when hovering
export const HoverOnly: Story = {
  args: {
    text: "this text will only marquee when you hover over it - try it out!",
    class:
      "w-64 text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] px-3 py-2 rounded",
    hoverOnly: true,
  },
};

// always marquee (default behavior)
export const AlwaysMarquee: Story = {
  args: {
    text: "this text always marquees when it overflows - no hover needed",
    class:
      "w-64 text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] px-3 py-2 rounded",
    hoverOnly: false,
  },
};

// hover only comparison
export const HoverOnlyComparison: Story = {
  render: () => (
    <div class="p-4 space-y-4 w-80">
      <div class="space-y-2">
        <div class="text-gray-400 text-xs uppercase tracking-wide">
          always marquee (default)
        </div>
        <MarqueeText
          text={`${mockArtists[0].name} - ${mockSongs[0].title} (extended version)`}
          class="text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] px-3 py-2 rounded"
          hoverOnly={false}
        />
      </div>
      <div class="space-y-2">
        <div class="text-gray-400 text-xs uppercase tracking-wide">
          hover only - hover to see animation
        </div>
        <MarqueeText
          text={`${mockArtists[0].name} - ${mockSongs[0].title} (extended version)`}
          class="text-[var(--color-text-primary)] bg-[var(--color-bg-secondary)] px-3 py-2 rounded"
          hoverOnly={true}
        />
      </div>
    </div>
  ),
};

// genre list example
export const GenreList: Story = {
  args: {
    text: "progressive rock, psychedelic rock, art rock, experimental",
    class: "w-40 text-gray-400 text-xs bg-black/50 px-2 py-1 rounded",
  },
};

// interactive width control
export const InteractiveWidth: Story = {
  render: () => {
    const [width, setWidth] = createSignal(200);
    const artist =
      mockArtists.find((a) => a.name === "The Beatles") || mockArtists[3];
    const longText = `${artist.name} - ${mockAlbums.find((a) => a.artist === artist.name)?.title || mockAlbums[3].title} (remastered)`;

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm space-y-2">
          <p>
            container width: <span class="text-magenta-400">{width()}px</span>
          </p>
          <input
            type="range"
            min="100"
            max="600"
            value={width()}
            onInput={(e) => setWidth(parseInt(e.currentTarget.value))}
            class="w-full"
          />
        </div>
        <div
          style={{ width: `${width()}px` }}
          class="border border-gray-700 rounded p-2"
        >
          <MarqueeText
            text={longText}
            class="text-[var(--color-text-primary)]"
          />
        </div>
        <div class="text-gray-500 text-xs">
          resize the container to see when marquee activates
        </div>
      </div>
    );
  },
};

// multiple marquee texts stacked
export const MultipleMarquees: Story = {
  render: () => (
    <div class="p-4 space-y-2 w-64">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
        now playing queue
      </div>
      <MarqueeText
        text="tame impala - let it happen"
        class="text-[var(--color-text-primary)] text-sm"
      />
      <MarqueeText
        text={`${mockArtists.find((a) => a.name === "Radiohead")?.name || mockArtists[1].name} - ${mockSongs[1].title} (live)`}
        class="text-gray-400 text-sm"
      />
      <MarqueeText
        text="king crimson - in the court of the crimson king"
        class="text-gray-400 text-sm"
      />
      <MarqueeText
        text="tool - lateralus (extended version)"
        class="text-gray-400 text-sm"
      />
      <MarqueeText
        text="black midi - welcome to hell"
        class="text-gray-400 text-sm"
      />
    </div>
  ),
};

// edge case: empty text
export const EmptyText: Story = {
  args: {
    text: "",
    class:
      "w-64 text-[var(--color-text-primary)] border border-[var(--color-border-default)] h-8",
  },
};

// edge case: very short container
export const TinyContainer: Story = {
  args: {
    text: "test",
    class: "w-8 text-white text-xs",
  },
};

// in a card-like layout
export const InCard: Story = {
  render: () => (
    <div class="w-48 bg-dark-800 rounded-lg p-3 space-y-2">
      <div class="w-full h-32 bg-magenta-800/30 rounded flex items-center justify-center">
        <svg
          class="w-12 h-12 text-magenta-400"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
      <MarqueeText
        text="in the aeroplane over the sea"
        class="text-white font-medium text-sm"
      />
      <MarqueeText text="neutral milk hotel" class="text-gray-400 text-xs" />
      <MarqueeText
        text="indie rock, lo-fi, psychedelic folk"
        class="text-gray-600 text-xs bg-black/50 px-1 py-0.5 rounded inline-block"
      />
    </div>
  ),
};
