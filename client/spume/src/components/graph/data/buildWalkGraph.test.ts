import { describe, expect, it } from "vitest";
import { buildWalkGraph } from "./buildWalkGraph";
import { albumNodeId, artistNodeId, parseNodeId, relationHubId, valueNodeId } from "./nodeIds";
import type { AlbumNodeData, ArtistNodeData } from "../../graph/types";

// ---- minimal fixture helpers -----------------------------------------------

function makeArtist(
  remoteId: string,
  artistId: string,
  name: string,
  overrides: Partial<ArtistNodeData> = {},
): ArtistNodeData {
  return {
    id: artistNodeId(remoteId, artistId),
    kind: "artist",
    artistId,
    name,
    abbreviation: name.slice(0, 2).toUpperCase(),
    imageUrl: null,
    image: null,
    albumCount: 0,
    genres: [],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    ...overrides,
  };
}

function makeAlbum(
  remoteId: string,
  albumId: string,
  title: string,
  artistId: string,
  overrides: Partial<AlbumNodeData> = {},
): AlbumNodeData {
  return {
    // use realistic adaptAlbum id format: `${remoteId}::${albumId}`
    id: `${remoteId}::${albumId}`,
    title,
    artistId,
    artistName: "",
    year: null,
    imageUrl: null,
    image: null,
    genres: [],
    tags: [],
    moods: [],
    styles: [],
    label: null,
    era: null,
    trackCount: 0,
    totalDurationSec: 0,
    sourceRemoteId: remoteId,
    ...overrides,
  };
}

// ---- fixture ----------------------------------------------------------------
// two remotes: "local" and "raid"
// shared artist name "Grouper" appears on both
// overlapping genre "ambient" on multiple albums

const localGrouper = makeArtist("local", "art-grouper", "Grouper", { genres: ["ambient"] });
const localSun     = makeArtist("local", "art-sun",     "Sun Kil Moon");

const raidGrouper  = makeArtist("raid",  "art-grouper2","Grouper", { genres: ["ambient", "drone"] });
const raidFelt     = makeArtist("raid",  "art-felt",    "Felt");

const albLing   = makeAlbum("local", "alb-ling",   "Linger",     "art-grouper", { genres: ["ambient"] });
const albHaze   = makeAlbum("local", "alb-haze",   "Haze",       "art-sun",     { genres: ["folk"] });
const albDragg  = makeAlbum("raid",  "alb-dragg",  "Dragging",   "art-grouper2",{ genres: ["ambient", "drone"] });

const input = {
  remoteIds: ["local", "raid"],
  albumsByRemote: new Map([
    ["local", [albLing, albHaze]],
    ["raid",  [albDragg]],
  ]),
  artistsByRemote: new Map([
    ["local", [localGrouper, localSun]],
    ["raid",  [raidGrouper, raidFelt]],
  ]),
};

// ---- tests ------------------------------------------------------------------

describe("buildWalkGraph", () => {
  const { graph, nodesById } = buildWalkGraph(input);

  it("includes a root node", () => {
    expect(graph.nodes.find((n) => n.id === "root")).toBeDefined();
  });

  it("includes remote hub nodes for both remotes", () => {
    expect(graph.nodes.find((n) => n.id === "remote::local")).toBeDefined();
    expect(graph.nodes.find((n) => n.id === "remote::raid")).toBeDefined();
  });

  it("emits separate genre relation hubs per remote (S15)", () => {
    const localGenreHub = graph.nodes.find((n) => n.id === relationHubId("local", "genre"));
    const raidGenreHub  = graph.nodes.find((n) => n.id === relationHubId("raid",  "genre"));
    expect(localGenreHub).toBeDefined();
    expect(raidGenreHub).toBeDefined();
    expect(localGenreHub!.id).not.toBe(raidGenreHub!.id);
  });

  it("emits separate ambient value nodes for local and raid (S15)", () => {
    const localAmbient = valueNodeId("local", "genre", "ambient");
    const raidAmbient  = valueNodeId("raid",  "genre", "ambient");
    expect(localAmbient).not.toBe(raidAmbient);
    expect(graph.nodes.find((n) => n.id === localAmbient)).toBeDefined();
    expect(graph.nodes.find((n) => n.id === raidAmbient)).toBeDefined();
  });

  it("populates nodesById for albums", () => {
    const key = albumNodeId("local", "alb-ling");
    expect(nodesById.get(key)).toBeDefined();
    expect((nodesById.get(key) as AlbumNodeData).title).toBe("Linger");
  });

  it("populates nodesById for artists", () => {
    const key = artistNodeId("local", "art-grouper");
    expect(nodesById.get(key)).toBeDefined();
    expect((nodesById.get(key) as ArtistNodeData).name).toBe("Grouper");
  });

  it("emits artist->album edge for local Grouper album", () => {
    const aId   = artistNodeId("local", "art-grouper");
    const albId = albumNodeId("local",  "alb-ling");
    expect(graph.edges.find((e) => e.source === aId && e.target === albId)).toBeDefined();
  });

  it("connects ambient value node to its artist on local", () => {
    const valId = valueNodeId("local", "genre", "ambient");
    const aId   = artistNodeId("local", "art-grouper");
    expect(graph.edges.find((e) => e.source === valId && e.target === aId)).toBeDefined();
  });

  it("connects ambient value node to its album on local", () => {
    const valId = valueNodeId("local", "genre", "ambient");
    const albId = albumNodeId("local", "alb-ling");
    expect(graph.edges.find((e) => e.source === valId && e.target === albId)).toBeDefined();
  });

  it("total node count is within expected range", () => {
    // root(1) + remotes(2) + relation hubs per remote (≥1 each) + value nodes + artists(4) + albums(3)
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1 + 2 + 2 + 3 + 4 + 3);
  });

  it("does not include hub nodes in nodesById", () => {
    expect(nodesById.has("root")).toBe(false);
    expect(nodesById.has("remote::local")).toBe(false);
    expect(nodesById.has(relationHubId("local", "genre"))).toBe(false);
  });

  it("album graph id parses to a bare albumId (no doubled remoteId)", () => {
    // AlbumNodeData.id is `${remoteId}::${albumId}` (adaptAlbum convention).
    // buildWalkGraph must strip the prefix before calling albumNodeId so the
    // resulting graph node id is `album::${remoteId}::${albumId}`, not
    // `album::${remoteId}::${remoteId}::${albumId}`.
    const albId = albumNodeId("local", "alb-ling");
    const parsed = parseNodeId(albId);
    expect(parsed.kind).toBe("album");
    if (parsed.kind === "album") {
      expect(parsed.albumId).toBe("alb-ling"); // bare id, no "local::" prefix
      expect(parsed.remoteId).toBe("local");
    }
  });
});
