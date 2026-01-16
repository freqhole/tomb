import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MarqueeText } from "../src/components/text/MarqueeText";

const meta = {
  title: "Components/Text/MarqueeText",
  component: MarqueeText,
  tags: ["autodocs"],
  argTypes: {
    text: {
      control: "text",
      description: "text content to display",
    },
  },
} satisfies Meta<typeof MarqueeText>;

export default meta;
type Story = StoryObj<typeof meta>;

// short text that fits - should not marquee
export const ShortText: Story = {
  args: {
    text: "short text",
    class: "w-64 text-white",
  },
};

// long text that overflows - should marquee
export const LongText: Story = {
  args: {
    text: "this is a very long text that will definitely overflow the container and trigger the marquee animation effect",
    class: "w-64 text-white",
  },
};

// medium length text in narrow container
export const NarrowContainer: Story = {
  args: {
    text: "pink floyd - the dark side of the moon",
    class: "w-32 text-white",
  },
};

// with custom styling
export const CustomStyling: Story = {
  args: {
    text: "led zeppelin - stairway to heaven (live at madison square garden)",
    class: "w-48 text-magenta-400 font-bold text-sm",
  },
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
    const longText = "the beatles - sgt. pepper's lonely hearts club band (remastered 2009)";

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
          <MarqueeText text={longText} class="text-white" />
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
        class="text-white text-sm"
      />
      <MarqueeText
        text="radiohead - paranoid android (live)"
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
    class: "w-64 text-white border border-gray-700 h-8",
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
        <svg class="w-12 h-12 text-magenta-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
      <MarqueeText
        text="in the aeroplane over the sea"
        class="text-white font-medium text-sm"
      />
      <MarqueeText
        text="neutral milk hotel"
        class="text-gray-400 text-xs"
      />
      <MarqueeText
        text="indie rock, lo-fi, psychedelic folk"
        class="text-gray-600 text-xs bg-black/50 px-1 py-0.5 rounded inline-block"
      />
    </div>
  ),
};
