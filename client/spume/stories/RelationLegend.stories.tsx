import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { RelationLegend } from "../src/components/graph/RelationLegend";
import {
  buildRelationEdges,
  countEdgesByKind,
  RELATION_KINDS,
} from "../src/components/graph/relations";
import type { RelationKind } from "../src/components/graph/types";
import { mockGraphAlbums } from "./mockGraphData";

const ALL_KINDS = RELATION_KINDS.map((r) => r.kind);

function makeCounts() {
  const edges = buildRelationEdges(mockGraphAlbums);
  return countEdgesByKind(edges);
}

const meta = {
  title: "Graph/RelationLegend",
  component: RelationLegend,
  tags: ["autodocs"],
  argTypes: {
    orientation: { control: "inline-radio", options: ["vertical", "horizontal"] },
  },
} satisfies Meta<typeof RelationLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllEnabled: Story = {
  args: {
    enabled: ALL_KINDS,
    orientation: "vertical",
  },
};

export const WithCounts: Story = {
  args: {
    enabled: ALL_KINDS,
    counts: makeCounts(),
    orientation: "vertical",
  },
};

export const PartiallyToggled: Story = {
  args: {
    enabled: ["genre", "same_artist", "era"] as RelationKind[],
    counts: makeCounts(),
    orientation: "vertical",
  },
};

export const Horizontal: Story = {
  args: {
    enabled: ALL_KINDS,
    counts: makeCounts(),
    orientation: "horizontal",
  },
};

export const Interactive: Story = {
  args: { enabled: ALL_KINDS, orientation: "vertical" },
  render: () => {
    const [enabled, setEnabled] = createSignal(new Set<string>(ALL_KINDS));
    const counts = makeCounts();
    return (
      <div class="w-64 p-4 bg-[var(--color-bg)]">
        <RelationLegend
          enabled={enabled()}
          counts={counts}
          onToggle={(k, next) => {
            const s = new Set(enabled());
            if (next) s.add(k);
            else s.delete(k);
            setEnabled(s);
          }}
        />
      </div>
    );
  },
};

export const Mobile: Story = {
  args: {
    enabled: ALL_KINDS,
    counts: makeCounts(),
    orientation: "vertical",
  },
  parameters: {
    viewport: { defaultViewport: "iphone6" },
  },
};
