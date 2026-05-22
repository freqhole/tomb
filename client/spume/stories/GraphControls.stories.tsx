import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { GraphControls, type GraphTool } from "../src/components/graph/GraphControls";

const meta = {
  title: "Graph/GraphControls",
  component: GraphControls,
  tags: ["autodocs"],
  argTypes: {
    tool: { control: "inline-radio", options: ["pan", "lasso"] },
    compact: { control: "boolean" },
  },
} satisfies Meta<typeof GraphControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { tool: "pan", compact: false },
};

export const LassoActive: Story = {
  args: { tool: "lasso", compact: false },
};

export const Compact: Story = {
  args: { tool: "pan", compact: true },
};

export const Interactive: Story = {
  args: { tool: "pan" },
  render: () => {
    const [tool, setTool] = createSignal<GraphTool>("pan");
    return (
      <div class="p-4 bg-[var(--color-bg)] inline-block">
        <GraphControls
          tool={tool()}
          onToolChange={setTool}
          onZoomIn={() => console.log("zoom in")}
          onZoomOut={() => console.log("zoom out")}
          onFit={() => console.log("fit")}
        />
      </div>
    );
  },
};
