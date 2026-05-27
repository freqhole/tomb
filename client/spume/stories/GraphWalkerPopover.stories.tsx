// stories/GraphWalkerPopover.stories.tsx — end-to-end popover wiring story.
// demonstrates click -> select -> popover flow on mock data before phase 4
// wires up real data. the graph is built via buildWalkGraph so the node id
// conventions are identical to production.

import { createSignal, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import WalkCanvas from "../src/components/graph/WalkCanvas";
import { buildWalkGraph } from "../src/components/graph/data/buildWalkGraph";
import { artistNodeId, rootId } from "../src/components/graph/data/nodeIds";
import type { AlbumNodeData, ArtistNodeData } from "../src/components/graph/types";
import { AlbumDetailPopover } from "../src/components/graph/AlbumDetailPopover";
import { ArtistDetailPopover } from "../src/components/graph/ArtistDetailPopover";
import { useDetailPanelHide } from "../src/components/graph/useDetailPanelHide";

// ---- fixture data ----------------------------------------------------------

const REMOTE = "fixture";

const ALBUMS: AlbumNodeData[] = [
  {
    id: "alb1",
    kind: "album",
    title: "Dragging a Dead Deer Up a Hill",
    artistId: "art1",
    artistName: "Grouper",
    year: 2008,
    imageUrl: null,
    image: null,
    genres: ["ambient", "folk"],
    tags: [],
    moods: ["melancholic"],
    styles: ["lo-fi"],
    label: "Type",
    era: "2005-2009",
    trackCount: 10,
    totalDurationSec: 2340,
    isFavorite: false,
    sourceRemoteId: REMOTE,
    sourceRemoteIds: [REMOTE],
  },
  {
    id: "alb2",
    kind: "album",
    title: "AIA: Alien Observer",
    artistId: "art1",
    artistName: "Grouper",
    year: 2011,
    imageUrl: null,
    image: null,
    genres: ["ambient", "drone"],
    tags: [],
    moods: [],
    styles: ["lo-fi"],
    label: "Yellow Electric",
    era: "2010-2014",
    trackCount: 9,
    totalDurationSec: 2100,
    isFavorite: false,
    sourceRemoteId: REMOTE,
    sourceRemoteIds: [REMOTE],
  },
  {
    id: "alb3",
    kind: "album",
    title: "Monoliths & Dimensions",
    artistId: "art2",
    artistName: "Sunn O)))",
    year: 2009,
    imageUrl: null,
    image: null,
    genres: ["drone", "doom metal"],
    tags: [],
    moods: ["dark"],
    styles: ["experimental"],
    label: "Southern Lord",
    era: "2005-2009",
    trackCount: 4,
    totalDurationSec: 3600,
    isFavorite: false,
    sourceRemoteId: REMOTE,
    sourceRemoteIds: [REMOTE],
  },
  {
    id: "alb4",
    kind: "album",
    title: "Lights Out",
    artistId: "art3",
    artistName: "Wire",
    year: 1978,
    imageUrl: null,
    image: null,
    genres: ["post-punk"],
    tags: [],
    moods: [],
    styles: [],
    label: "Harvest",
    era: "1975-1979",
    trackCount: 11,
    totalDurationSec: 1920,
    isFavorite: false,
    sourceRemoteId: REMOTE,
    sourceRemoteIds: [REMOTE],
  },
];

const ARTISTS: ArtistNodeData[] = [
  {
    id: artistNodeId(REMOTE, "art1"),
    kind: "artist",
    artistId: "art1",
    name: "Grouper",
    abbreviation: "GR",
    imageUrl: null,
    image: null,
    albumCount: 2,
    genres: ["ambient", "folk", "drone"],
    tags: [],
    moods: ["melancholic"],
    styles: ["lo-fi"],
    label: null,
    era: null,
    isFavorite: false,
    sourceRemoteIds: [REMOTE],
  },
  {
    id: artistNodeId(REMOTE, "art2"),
    kind: "artist",
    artistId: "art2",
    name: "Sunn O)))",
    abbreviation: "SO",
    imageUrl: null,
    image: null,
    albumCount: 1,
    genres: ["drone", "doom metal"],
    tags: [],
    moods: ["dark"],
    styles: ["experimental"],
    label: null,
    era: null,
    isFavorite: false,
    sourceRemoteIds: [REMOTE],
  },
  {
    id: artistNodeId(REMOTE, "art3"),
    kind: "artist",
    artistId: "art3",
    name: "Wire",
    abbreviation: "WR",
    imageUrl: null,
    image: null,
    albumCount: 1,
    genres: ["post-punk"],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    isFavorite: false,
    sourceRemoteIds: [REMOTE],
  },
];

const { graph, nodesById } = buildWalkGraph({
  remoteIds: [REMOTE],
  albumsByRemote: new Map([[REMOTE, ALBUMS]]),
  artistsByRemote: new Map([[REMOTE, ARTISTS]]),
});

// ---- story component -------------------------------------------------------

function PopoverWalkStory() {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const albumHide = useDetailPanelHide(selectedId);
  const artistHide = useDetailPanelHide(selectedId);

  const selectedNode = () => (selectedId() ? nodesById.get(selectedId()!) : undefined);
  const selectedAlbum = () => {
    const n = selectedNode();
    return n && "title" in n ? (n as AlbumNodeData) : null;
  };
  const selectedArtist = () => {
    const n = selectedNode();
    return n && "kind" in n && (n as ArtistNodeData).kind === "artist"
      ? (n as ArtistNodeData)
      : null;
  };

  return (
    <div class="relative w-screen h-screen overflow-hidden bg-black">
      <WalkCanvas
        graph={graph}
        initialPivot={rootId()}
        selectedId={selectedId()}
        onSelect={(id) => setSelectedId(id)}
        onPivot={() => {}}
      />

      {/* album popover — docked bottom-left, same positioning as createGraphLibraryView L803 */}
      <Show when={selectedAlbum() && !albumHide.hidden()}>
        <div class="absolute bottom-3 left-3 z-10 pointer-events-auto">
          <AlbumDetailPopover
            albums={[selectedAlbum()!]}
            index={0}
            onIndexChange={() => {}}
            onPlay={(a) => console.log("play", a.title)}
            onShuffle={(a) => console.log("shuffle", a.title)}
            onAddToQueue={(a) => console.log("queue", a.title)}
            onViewAlbum={(a) => console.log("view album", a.title)}
            onViewArtist={(a) => console.log("view artist", a.artistName)}
            onToggleFavorite={(a) => console.log("toggle favorite", a.title)}
          />
          <button
            type="button"
            class="mt-1 text-xs text-white/50 hover:text-white/80"
            onClick={() => {
              albumHide.hide();
              setSelectedId(null);
            }}
          >
            close
          </button>
        </div>
      </Show>

      {/* artist popover — docked bottom-left */}
      <Show when={selectedArtist() && !artistHide.hidden()}>
        <div class="absolute bottom-3 left-3 z-10 pointer-events-auto">
          <ArtistDetailPopover
            artists={[selectedArtist()!]}
            index={0}
            onIndexChange={() => {}}
            bio={null}
            isFavorite={false}
            albums={[]}
            onViewArtist={(a) => console.log("view artist", a.name)}
            onToggleFavorite={(a, next) => console.log("toggle favorite", a.name, next)}
            onSelectAlbum={(a) => console.log("select album", a.title)}
          />
          <button
            type="button"
            class="mt-1 text-xs text-white/50 hover:text-white/80"
            onClick={() => {
              artistHide.hide();
              setSelectedId(null);
            }}
          >
            close
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---- meta + export ---------------------------------------------------------

const meta: Meta = {
  title: "Graph2/WalkCanvasPopover",
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "dark", values: [{ name: "dark", value: "#000000" }] },
  },
};

export default meta;
type Story = StoryObj;

export const PopoverWiring: Story = {
  render: () => <PopoverWalkStory />,
};
