// stories/GraphWalker.stories.tsx — storybook stories for the graph2 walker.
// three stories, each starting at a different point in the walk:
//   Root       — pivot = root, shows both remotes as children
//   Genres     — pivot = local genres relation hub, genre values fan out
//   Ambient    — pivot = ambient genre value, artists fan out with album chains

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WalkCanvas from "../src/graph2/WalkCanvas";
import { MOCK_GRAPH } from "../src/graph2/mockData";

const meta: Meta<typeof WalkCanvas> = {
  title: "Graph2/WalkCanvas",
  component: WalkCanvas,
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark", values: [{ name: "dark", value: "#111827" }] },
  },
};

export default meta;
type Story = StoryObj<typeof WalkCanvas>;

// ---- story 1: root ---------------------------------------------------------
// both remotes visible as children of the virtual root node.

export const Root: Story = {
  args: {
    graph: MOCK_GRAPH,
    initialPivot: "root",
    // no width/height — fills the storybook iframe
  },
};

// ---- story 2: drilled into genres ------------------------------------------
// breadcrumb = [root → local remote → genres relation]
// pivot = genres, all genre value hubs fan outward.

export const GenresDrilled: Story = {
  args: {
    graph: MOCK_GRAPH,
    initialPivot: "relation::local::genres",
    initialBreadcrumb: ["root", "remote::local", "relation::local::genres"],
  },
};

// ---- story 3: drilled into ambient genre value ----------------------------
// breadcrumb = [root → local → genres → ambient]
// pivot = ambient, ambient's artists (Grouper, Sunn O))), Low, GY!BE) fan out
// each artist will show its albums as chains when expanded further.

export const AmbientDrilled: Story = {
  args: {
    graph: MOCK_GRAPH,
    initialPivot: "value::genres::ambient",
    initialBreadcrumb: [
      "root",
      "remote::local",
      "relation::local::genres",
      "value::genres::ambient",
    ],
  },
};
