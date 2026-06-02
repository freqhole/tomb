// search-mode subgraph builder. milestone B of the graph topnav search
// effort (see docs/explore-search-and-fixes-plan.md).
//
// inputs: the per-remote suggestion lists already fetched by
// GraphTopNavSearch (the "suggestions-only" data path; full /search is
// a future upgrade).
//
// outputs: a synthetic WalkGraph that lives in place of the normal
// library walk-graph for as long as search-mode is active.
//
// node id scheme (prefixed `s_*` to keep search-mode ids disjoint from
// the normal library graph; nothing else in the codebase mints these):
//   - aggregated artist  : `s_artist::{slug(display)}`
//   - aggregated album   : `s_album::{slug(display)}`
//   - song-derived album : `s_song_album::{remoteId}::{album_id}`
//   - per-remote taxon   : `s_taxon::{remoteId}::{suggestion_type}::{slug(display)}`
// remote hubs reuse `remoteHubId(...)` so the visual identity matches
// what the user sees in the default graph.

import type { WalkGraph, WalkNode, WalkEdge } from "../../../components/graph/types";
import { rootId, remoteHubId, slug } from "../../../components/graph/data/nodeIds";
import type { SearchSuggestion as APISuggestion } from "../../../music/data/types";

export interface SearchGraphInput {
  /** every remote that contributed at least one suggestion, in stable order. */
  remoteIds: string[];
  /** raw per-remote suggestion list (deduped is fine but not required). */
  resultsByRemote: Map<string, APISuggestion[]>;
  /** human-readable display name per remoteId (for hub labels). */
  remoteNamesById?: Map<string, string>;
  /** which remoteIds correspond to the local charnel-managed sidecar.
   *  surfaced as the home glyph on remote hubs, same as buildWalkGraph. */
  charnelManagedRemoteIds?: Set<string>;
}

export interface SearchGraphOutput {
  graph: WalkGraph;
  /** map from synthetic node id to its primary remote id. used by the
   *  selection handler to resolve "open in routes.*On" actions when the
   *  user clicks a search-mode node. for cross-remote aggregated nodes
   *  this is just the first contributor; the caller is responsible for
   *  prompting the user with pickRemote() when multiple contributors
   *  matter. */
  primaryRemoteByNodeId: Map<string, string>;
  /** map from synthetic node id to all contributing remote ids. */
  contributorsByNodeId: Map<string, string[]>;
  /** map from synthetic node id back to the originating entity id (e.g.
   *  album_id, artist_id) per contributor. used to translate a search-
   *  graph node into a route or popover fetch. shape:
   *    nodeId -> Map<remoteId, entityId>
   *  for taxon nodes the entityId is the taxon value (slug).
   *  for song-derived album nodes it's the album_id from metadata. */
  entityIdByNodeAndRemote: Map<string, Map<string, string>>;
}

function nodeIdFor(s: APISuggestion, remoteId: string): { id: string; kind: NodeRoleKind } | null {
  switch (s.suggestion_type) {
    case "artist":
      return { id: `s_artist::${slug(s.display)}`, kind: "artist" };
    case "album":
      return { id: `s_album::${slug(s.display)}`, kind: "album" };
    case "song": {
      const albumId = (s.metadata as { album_id?: string } | undefined)?.album_id;
      if (!albumId) return null; // can't surface without an album anchor
      return { id: `s_song_album::${remoteId}::${albumId}`, kind: "album" };
    }
    case "playlist":
      return null; // v1 skip per spec
    default:
      // taxons: genre, mood, style, etc.
      return {
        id: `s_taxon::${remoteId}::${s.suggestion_type ?? "taxon"}::${slug(s.display)}`,
        kind: "taxon",
      };
  }
}

type NodeRoleKind = "artist" | "album" | "taxon";

export function buildSearchGraph(input: SearchGraphInput): SearchGraphOutput {
  const { remoteIds, resultsByRemote } = input;

  const nodes: WalkNode[] = [];
  const edges: WalkEdge[] = [];
  const primaryRemoteByNodeId = new Map<string, string>();
  const contributorsByNodeId = new Map<string, string[]>();
  const entityIdByNodeAndRemote = new Map<string, Map<string, string>>();

  // ---- root ---------------------------------------------------------------
  const rId = rootId();

  // gather only the remotes that actually have results so the synthetic
  // graph stays focused. unrelated empty remotes would just clutter the
  // canvas with isolated hubs.
  const contributingRemotes = remoteIds.filter((id) => (resultsByRemote.get(id)?.length ?? 0) > 0);

  nodes.push({
    id: rId,
    role: "root",
    label: "search results",
    parentId: null,
    childCount: contributingRemotes.length,
  });

  // ---- remote hubs --------------------------------------------------------
  // pre-create hubs so per-result child accumulation can target them.
  // childCount is fixed up at the end once we know the final tally.
  const hubChildCount = new Map<string, number>();
  for (const remoteId of contributingRemotes) {
    const rhId = remoteHubId(remoteId);
    nodes.push({
      id: rhId,
      role: "remote",
      label: input.remoteNamesById?.get(remoteId) ?? remoteId,
      parentId: rId,
      childCount: 0,
      isCharnelManaged: input.charnelManagedRemoteIds?.has(remoteId) || undefined,
    });
    edges.push({ source: rId, target: rhId });
    hubChildCount.set(rhId, 0);
  }

  // ---- per-suggestion aggregation ----------------------------------------
  // tracked separately so we can compute label + edges in one pass.
  interface AggNode {
    id: string;
    role: NodeRoleKind;
    label: string;
    primaryRemoteId: string;
    contributors: Set<string>;
    edges: Set<string>; // remoteHubIds we've already wired
  }
  const aggById = new Map<string, AggNode>();

  for (const remoteId of contributingRemotes) {
    const list = resultsByRemote.get(remoteId) ?? [];
    for (const s of list) {
      const target = nodeIdFor(s, remoteId);
      if (!target) continue;

      let agg = aggById.get(target.id);
      if (!agg) {
        agg = {
          id: target.id,
          role: target.kind,
          label: s.display,
          primaryRemoteId: remoteId,
          contributors: new Set<string>(),
          edges: new Set<string>(),
        };
        aggById.set(target.id, agg);
      }
      agg.contributors.add(remoteId);

      // track entity-id per contributor so the caller can route correctly.
      // for songs, use the album_id (anchor); for taxons, use the slugged
      // display (taxon hubs use slugs as their primary key in grimoire).
      let entityId: string;
      if (s.suggestion_type === "song") {
        entityId = (s.metadata as { album_id?: string }).album_id ?? s.entity_id;
      } else if (
        s.suggestion_type !== "artist" &&
        s.suggestion_type !== "album" &&
        s.suggestion_type !== "playlist"
      ) {
        entityId = s.value || slug(s.display);
      } else {
        entityId = s.entity_id;
      }
      let m = entityIdByNodeAndRemote.get(target.id);
      if (!m) {
        m = new Map<string, string>();
        entityIdByNodeAndRemote.set(target.id, m);
      }
      // first writer wins per (node, remote) — duplicates within one
      // remote (different songs from same album) all resolve to the
      // same album_id so this is safe.
      if (!m.has(remoteId)) m.set(remoteId, entityId);
    }
  }

  // ---- emit aggregated nodes + edges -------------------------------------
  for (const agg of aggById.values()) {
    const contributors = Array.from(agg.contributors);
    // parent matches directly to root so they're visible at pivot=root.
    // the walker's getVisible() only surfaces children-of-pivot; if we
    // parented matches to the remote hubs the user would see just the
    // 3 hubs and have to drill in (and the remote-pivot rule even blocks
    // non-relation children, so they'd never appear at all). additional
    // remote-hub edges below keep the visual "contributed by" wiring.
    nodes.push({
      id: agg.id,
      role: agg.role === "taxon" ? "value" : agg.role,
      label: agg.label,
      parentId: rId,
      childCount: 0,
    });
    edges.push({ source: rId, target: agg.id });
    for (const remoteId of contributors) {
      const hubId = remoteHubId(remoteId);
      const edgeKey = `${hubId}::${agg.id}`;
      if (agg.edges.has(edgeKey)) continue;
      agg.edges.add(edgeKey);
      edges.push({ source: hubId, target: agg.id });
      hubChildCount.set(hubId, (hubChildCount.get(hubId) ?? 0) + 1);
    }
    primaryRemoteByNodeId.set(agg.id, agg.primaryRemoteId);
    contributorsByNodeId.set(agg.id, contributors);
  }

  // ---- backfill remote-hub childCount ------------------------------------
  for (const node of nodes) {
    if (node.role !== "remote") continue;
    const count = hubChildCount.get(node.id);
    if (count !== undefined) node.childCount = count;
  }
  // also lift root's childCount to reflect the full set of root-anchored
  // matches (remote hubs + every aggregated match) so its radius +
  // child-fanout sizing keep up with bigger result sets.
  const rootNode = nodes.find((n) => n.id === rId);
  if (rootNode) rootNode.childCount = contributingRemotes.length + aggById.size;

  return {
    graph: { nodes, edges },
    primaryRemoteByNodeId,
    contributorsByNodeId,
    entityIdByNodeAndRemote,
  };
}
