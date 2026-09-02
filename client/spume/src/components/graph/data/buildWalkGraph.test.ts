import { describe, expect, it } from "vitest";
import { buildWalkGraph } from "./buildWalkGraph";
import {
  albumNodeId,
  artistNodeId,
  parseNodeId,
  relationHubId,
  remoteHubId,
  videoNodeId,
  videoSeriesNodeId,
} from "./nodeIds";
import type { AlbumNodeData, ArtistNodeData, VideoNodeData, VideoSeriesNodeData } from "../../graph/types";

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
    customTaxons: {},
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
    customTaxons: {},
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

  it("total node count is within expected range", () => {
    // root(1) + remotes(2) + artists(4) + albums(3). no value/relation
    // hubs from buildWalkGraph anymore — those are seeded by the
    // LibraryGraphSubview from list_taxon_kinds.
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1 + 2 + 4 + 3);
  });

  it("does not include hub nodes in nodesById", () => {
    expect(nodesById.has("root")).toBe(false);
    expect(nodesById.has("remote::local")).toBe(false);
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

describe("buildWalkGraph - favorite hub", () => {
  it("emits flat favorite hub with direct artist/album edges from isFavorite flags", () => {
    const artist = makeArtist("local", "art-fav", "Fav Artist", { isFavorite: true });
    const album = makeAlbum("local", "alb-fav", "Fav Album", "art-fav", { isFavorite: true });
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map([["local", [album]]]),
      artistsByRemote: new Map([["local", [artist]]]),
    });

    const favHubId = relationHubId("local", "favorites");
    expect(graph.nodes.find((n) => n.id === favHubId)).toBeDefined();

    const artId = artistNodeId("local", "art-fav");
    const albId = albumNodeId("local", "alb-fav");
    expect(graph.edges.find((e) => e.source === favHubId && e.target === artId)).toBeDefined();
    expect(graph.edges.find((e) => e.source === favHubId && e.target === albId)).toBeDefined();
  });

  it("includes song-derived favorites from favoriteSongAlbumIds/favoriteSongArtistIds", () => {
    const artist = makeArtist("local", "art-norm", "Normal Artist");
    const album = makeAlbum("local", "alb-norm", "Normal Album", "art-norm");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map([["local", [album]]]),
      artistsByRemote: new Map([["local", [artist]]]),
      favoriteSongAlbumIds: new Map([["local", new Set(["alb-norm"])]]),
      favoriteSongArtistIds: new Map([["local", new Set(["art-norm"])]]),
    });

    const favHubId = relationHubId("local", "favorites");
    expect(graph.nodes.find((n) => n.id === favHubId)).toBeDefined();

    const artId = artistNodeId("local", "art-norm");
    const albId = albumNodeId("local", "alb-norm");
    expect(graph.edges.find((e) => e.source === favHubId && e.target === artId)).toBeDefined();
    expect(graph.edges.find((e) => e.source === favHubId && e.target === albId)).toBeDefined();
  });

  it("does not emit favorite hub when no favorites exist", () => {
    const artist = makeArtist("local", "art-plain", "Plain Artist");
    const album = makeAlbum("local", "alb-plain", "Plain Album", "art-plain");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map([["local", [album]]]),
      artistsByRemote: new Map([["local", [artist]]]),
    });

    const favHubId = relationHubId("local", "favorites");
    expect(graph.nodes.find((n) => n.id === favHubId)).toBeUndefined();
  });
});

// ---- video / video_series -------------------------------------------------

function makeVideoSeries(
  remoteId: string,
  seriesId: string,
  title: string,
  overrides: Partial<VideoSeriesNodeData> = {},
): VideoSeriesNodeData {
  return {
    id: videoSeriesNodeId(remoteId, seriesId),
    kind: "video_series",
    seriesId,
    title,
    posterBlobId: null,
    remoteServerId: remoteId,
    videoCount: 0,
    ...overrides,
  };
}

function makeVideo(
  remoteId: string,
  videoId: string,
  title: string,
  seriesId: string | null,
  overrides: Partial<VideoNodeData> = {},
): VideoNodeData {
  return {
    id: videoNodeId(remoteId, videoId),
    kind: "video",
    videoId,
    title,
    seriesId,
    seasonId: null,
    posterBlobId: null,
    posterOpfsPath: null,
    remoteServerId: remoteId,
    ...overrides,
  };
}

describe("buildWalkGraph - video/series", () => {
  it("creates a video_series node without wiring it directly to the remote hub", () => {
    const series = makeVideoSeries("local", "ser-1", "Voyager");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videoSeriesByRemote: new Map([["local", [series]]]),
    });

    const seriesId = videoSeriesNodeId("local", "ser-1");
    expect(graph.nodes.find((n) => n.id === seriesId)?.role).toBe("video_series");
    // series reach the graph via taxon-hub pivots, not a direct remote edge
    // (mirrors artist nodes, which also have no eager remote -> artist edge).
    expect(
      graph.edges.find((e) => e.source === remoteHubId("local") && e.target === seriesId)
    ).toBeUndefined();
  });

  it("attaches a video with a known seriesId under its series node, not the remote hub", () => {
    const series = makeVideoSeries("local", "ser-1", "Voyager");
    const video = makeVideo("local", "vid-1", "Caretaker", "ser-1");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videoSeriesByRemote: new Map([["local", [series]]]),
      videosByRemote: new Map([["local", [video]]]),
    });

    const seriesId = videoSeriesNodeId("local", "ser-1");
    const vId = videoNodeId("local", "vid-1");
    expect(graph.nodes.find((n) => n.id === vId)?.role).toBe("video");
    expect(graph.edges.find((e) => e.source === seriesId && e.target === vId)).toBeDefined();
    expect(graph.edges.find((e) => e.source === remoteHubId("local") && e.target === vId)).toBeUndefined();
  });

  it("creates a standalone (no series) video node without wiring it directly to the remote hub", () => {
    const video = makeVideo("local", "vid-standalone", "One-off clip", null);
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videosByRemote: new Map([["local", [video]]]),
    });

    const vId = videoNodeId("local", "vid-standalone");
    expect(graph.nodes.find((n) => n.id === vId)?.role).toBe("video");
    // orphan videos reach the graph via the "unassigned" taxon-hub pivot
    // (createPivotHandler's maybeLoadUnassignedForPivot), not a direct edge.
    expect(graph.edges.find((e) => e.source === remoteHubId("local") && e.target === vId)).toBeUndefined();
  });

  it("creates a video node (without a direct remote edge) when its seriesId doesn't match any known series", () => {
    const video = makeVideo("local", "vid-orphan", "Orphaned episode", "ser-missing");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videosByRemote: new Map([["local", [video]]]),
    });

    const vId = videoNodeId("local", "vid-orphan");
    expect(graph.nodes.find((n) => n.id === vId)?.role).toBe("video");
    expect(graph.edges.find((e) => e.source === remoteHubId("local") && e.target === vId)).toBeUndefined();
  });

  it("series childCount reflects the number of videos attached to it", () => {
    const series = makeVideoSeries("local", "ser-1", "Voyager");
    const videos = [
      makeVideo("local", "vid-1", "Caretaker", "ser-1"),
      makeVideo("local", "vid-2", "Parallax", "ser-1"),
    ];
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videoSeriesByRemote: new Map([["local", [series]]]),
      videosByRemote: new Map([["local", videos]]),
    });

    const seriesId = videoSeriesNodeId("local", "ser-1");
    expect(graph.nodes.find((n) => n.id === seriesId)?.childCount).toBe(2);
  });

  it("populates videoNodesById for both videos and series, keeping nodesById album/artist-only", () => {
    const series = makeVideoSeries("local", "ser-1", "Voyager");
    const video = makeVideo("local", "vid-1", "Caretaker", "ser-1");
    const { nodesById, videoNodesById } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map(),
      artistsByRemote: new Map(),
      videoSeriesByRemote: new Map([["local", [series]]]),
      videosByRemote: new Map([["local", [video]]]),
    });

    const seriesId = videoSeriesNodeId("local", "ser-1");
    const vId = videoNodeId("local", "vid-1");
    expect((videoNodesById.get(seriesId) as VideoSeriesNodeData).title).toBe("Voyager");
    expect((videoNodesById.get(vId) as VideoNodeData).title).toBe("Caretaker");
    expect(nodesById.has(seriesId)).toBe(false);
    expect(nodesById.has(vId)).toBe(false);
  });

  it("mixes video/series alongside existing album/artist data without interference", () => {
    const artist = makeArtist("local", "art-grouper", "Grouper");
    const album = makeAlbum("local", "alb-ling", "Linger", "art-grouper");
    const series = makeVideoSeries("local", "ser-1", "Voyager");
    const video = makeVideo("local", "vid-1", "Caretaker", "ser-1");
    const { graph } = buildWalkGraph({
      remoteIds: ["local"],
      albumsByRemote: new Map([["local", [album]]]),
      artistsByRemote: new Map([["local", [artist]]]),
      videoSeriesByRemote: new Map([["local", [series]]]),
      videosByRemote: new Map([["local", [video]]]),
    });

    expect(graph.nodes.find((n) => n.id === albumNodeId("local", "alb-ling"))).toBeDefined();
    expect(graph.nodes.find((n) => n.id === artistNodeId("local", "art-grouper"))).toBeDefined();
    expect(graph.nodes.find((n) => n.id === videoSeriesNodeId("local", "ser-1"))).toBeDefined();
    expect(graph.nodes.find((n) => n.id === videoNodeId("local", "vid-1"))).toBeDefined();
  });
});
