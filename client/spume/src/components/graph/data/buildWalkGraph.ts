// pure deterministic adapter: converts real library data into a WalkGraph
// ready for the walk explorer worker.
//
// output must NOT be wrapped in createStore before posting to the worker —
// the worker expects plain JSON (see S13 in graph2-integration.md).

import type { WalkGraph, WalkNode, WalkEdge, AlbumNodeData, ArtistNodeData } from "../types";
import {
  type RelationKind,
  rootId,
  remoteHubId,
  relationHubId,
  valueNodeId,
  artistNodeId,
  albumNodeId,
  slug,
} from "./nodeIds";

export interface BuildWalkGraphInput {
  remoteIds: string[];
  albumsByRemote: Map<string, AlbumNodeData[]>;
  artistsByRemote: Map<string, ArtistNodeData[]>;
}

export interface BuildWalkGraphOutput {
  graph: WalkGraph;
  /** full payload for every artist and album node, keyed by graph node id.
   *  hubs, value nodes, and root are NOT included. used by main thread for
   *  popover hydration and image resolution (S1). */
  nodesById: Map<string, AlbumNodeData | ArtistNodeData>;
}

// the ordered set of relation kinds the adapter processes, per S15.
//
// note: "era" is intentionally omitted here. era taxons are synthesized
// server-side via `list_era_bins` (greedy decade-aware binning with
// hysteresis), and the hub + its value nodes are merged in lazily by
// LibraryGraphSubview on pivot. emitting an album-derived "era" hub
// here would duplicate the synthesized hub id and confuse the lazy
// loader. the "recently_added" hub is also synthesized (a flat list of
// the most recently added albums, no value tier) and always emitted
// below regardless of in-memory content.
const RELATION_KINDS: RelationKind[] = [
  "genre", "tag", "mood", "style", "label", "favorite",
];

/** collect the relation values for a given kind from one node.
 *  returns an array of raw (un-slugged) display strings. */
function valuesForKind(
  node: AlbumNodeData | ArtistNodeData,
  kind: RelationKind,
): string[] {
  switch (kind) {
    case "genre":    return (node.genres ?? []).slice();
    case "tag":      return (node.tags ?? []).map((t) => t.label);
    case "mood":     return (node.moods ?? []).slice();
    case "style":    return (node.styles ?? []).slice();
    case "era":      return node.era ? [node.era] : [];
    case "label":    return node.label ? [node.label] : [];
    case "favorite": return node.isFavorite === true ? ["favorite"] : [];
    case "recently_added": return []; // synthesized hub, no album-derived values
  }
}

// AlbumNodeData.id is `${remoteId}::${albumId}` (set by adaptAlbum). albumNodeId
// expects a bare albumId, so strip the prefix before calling it.
function toBareAlbumId(remoteId: string, album: AlbumNodeData): string {
  const p = `${remoteId}::`;
  return album.id.startsWith(p) ? album.id.slice(p.length) : album.id;
}

// ArtistNodeData.id is `artist::${artistId}` (set by deriveArtistNodes) but
// .artistId is always bare. strip any accidental `artist::` prefix defensively.
function toBareArtistId(artist: ArtistNodeData): string {
  const p = "artist::";
  return artist.artistId.startsWith(p) ? artist.artistId.slice(p.length) : artist.artistId;
}

export function buildWalkGraph(input: BuildWalkGraphInput): BuildWalkGraphOutput {
  const { remoteIds, albumsByRemote, artistsByRemote } = input;

  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];
  const nodesById = new Map<string, AlbumNodeData | ArtistNodeData>();

  // ---- root ----------------------------------------------------------------
  const rId = rootId();
  nodes.push({ id: rId, role: "root", label: "root", parentId: null, childCount: remoteIds.length });

  for (const remoteId of remoteIds) {
    const albums  = albumsByRemote.get(remoteId)  ?? [];
    const artists = artistsByRemote.get(remoteId) ?? [];

    // ---- remote hub --------------------------------------------------------
    const rhId = remoteHubId(remoteId);
    nodes.push({
      id: rhId,
      role: "remote",
      label: remoteId,
      parentId: rId,
      childCount: artists.length, // direct artist children (not counting relation hubs for sizing)
    });
    edges.push({ source: rId, target: rhId });

    // ---- synthesized hubs (always emitted, lazy-populated) ----------------
    // these hubs aren't backed by stored taxonz: era is computed by the
    // backend's greedy decade binner (`list_era_bins`) and recently_added
    // is the top-N most-recently-added albums (`list_recently_added_albums`).
    // children are merged in by LibraryGraphSubview when the user pivots
    // into the hub. emit them unconditionally so they're always visible
    // under each remote hub.
    const eraHubId = relationHubId(remoteId, "era");
    nodes.push({
      id: eraHubId,
      role: "relation",
      label: "era",
      parentId: rhId,
      childCount: 0,
    });
    edges.push({ source: rhId, target: eraHubId });

    const recentHubId = relationHubId(remoteId, "recently_added");
    nodes.push({
      id: recentHubId,
      role: "relation",
      label: "recently added",
      parentId: rhId,
      childCount: 0,
    });
    edges.push({ source: rhId, target: recentHubId });

    // ---- relation hubs + value nodes --------------------------------------
    // collect per-kind unique values across all artists + albums in this remote.
    for (const kind of RELATION_KINDS) {
      // gather unique raw strings (deduped by slug so display label is stable).
      const seenSlug = new Map<string, string>(); // slug -> first-seen raw value
      for (const node of [...artists, ...albums]) {
        for (const raw of valuesForKind(node, kind)) {
          const s = slug(raw);
          if (s && !seenSlug.has(s)) seenSlug.set(s, raw);
        }
      }
      if (seenSlug.size === 0) continue; // skip kinds with no data on this remote

      const relHubId = relationHubId(remoteId, kind);
      nodes.push({
        id: relHubId,
        role: "relation",
        label: kind,
        parentId: rhId,
        childCount: seenSlug.size,
      });
      edges.push({ source: rhId, target: relHubId });

      for (const [s, raw] of seenSlug) {
        const valId = valueNodeId(remoteId, kind, raw); // valueNodeId slugs internally
        nodes.push({
          id: valId,
          role: "value",
          label: raw,
          parentId: relHubId,
          childCount: 0, // child count not tracked for value nodes in v1
        });
        edges.push({ source: relHubId, target: valId });

        // value -> artist edges
        for (const artist of artists) {
          const hasValue = valuesForKind(artist, kind).some((v) => slug(v) === s);
          if (hasValue) {
            edges.push({ source: valId, target: artistNodeId(remoteId, toBareArtistId(artist)) });
          }
        }

        // value -> album edges
        for (const album of albums) {
          const hasValue = valuesForKind(album, kind).some((v) => slug(v) === s);
          if (hasValue) {
            edges.push({ source: valId, target: albumNodeId(remoteId, toBareAlbumId(remoteId, album)) });
          }
        }
      }
    }

    // ---- artist nodes ------------------------------------------------------
    for (const artist of artists) {
      const aId = artistNodeId(remoteId, toBareArtistId(artist));
      // count albums belonging to this artist in this remote
      const artistAlbums = albums.filter((alb) => alb.artistId === artist.artistId);
      nodes.push({
        id: aId,
        role: "artist",
        label: artist.name,
        parentId: rhId,
        childCount: artistAlbums.length,
      });
      // NOTE: no remoteHub -> artist edge. parentId still points at rhId
      // for breadcrumb / hierarchy traversal, but the visible link is
      // suppressed to cut radial clutter. artists reach the rest of the
      // graph via value -> artist edges emitted in the relation-hub loop
      // above.
      nodesById.set(aId, artist);

      // ---- album nodes ---------------------------------------------------
      for (const album of artistAlbums) {
        const albId = albumNodeId(remoteId, toBareAlbumId(remoteId, album));
        nodes.push({
          id: albId,
          role: "album",
          label: album.title,
          parentId: aId,
          childCount: 0,
        });
        edges.push({ source: aId, target: albId });
        nodesById.set(albId, album);
      }
    }

    // albums that have no matching artist node in this remote's artist list
    // are attached directly to the remote hub as orphans.
    const knownArtistIds = new Set(artists.map((a) => a.artistId));
    for (const album of albums) {
      if (!knownArtistIds.has(album.artistId)) {
        const albId = albumNodeId(remoteId, toBareAlbumId(remoteId, album));
        nodes.push({
          id: albId,
          role: "album",
          label: album.title,
          parentId: rhId,
          childCount: 0,
        });
        edges.push({ source: rhId, target: albId });
        nodesById.set(albId, album);
      }
    }
  }

  return { graph: { nodes, edges }, nodesById };
}
