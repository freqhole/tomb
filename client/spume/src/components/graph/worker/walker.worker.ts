/// <reference lib="webworker" />
// graph2/worker/walker.worker.ts — d3-force simulation + walk state.
//
// walk model:
//   breadcrumb = path from root to current pivot (array of node ids)
//   pivot = breadcrumb[breadcrumb.length - 1]
//   visible = set(breadcrumb) + children(pivot)
//
// click a child of pivot → walk forward (append to breadcrumb)
// click a breadcrumb node → walk back (trim breadcrumb)
//
// layout:
//   - bloom target positions computed deterministically from the tree
//   - forceX + forceY attract each node toward its bloom target
//   - forceCollide prevents overlap (radius-aware)
//   - light forceManyBody adds some natural spacing
//   - forceLink keeps edges from stretching too much

import {
  childrenOf,
  clusterLeaderOf,
  clusterMembers,
  clusterRemotes,
  crossRemoteEdges,
  ctx,
  nodeMap,
  parentsOf,
  post,
  state,
} from "./walkerState";
import { crossKey, leaderOf, remoteOfId, slug } from "./walkerHelpers";
import { buildSim } from "./walkerSim";
import type { MainToWorker } from "./messages";

// ---- remap breadcrumb entries to their cluster leaders --------------------
//
// call after indexGraph() whenever the cluster map may have changed (merge,
// remove). a cross-remote merge can elect a new leader for the entity the
// user is currently pivoted on (the newly merged node may have a
// lexicographically smaller id). if the stale follower id remains in the
// breadcrumb, pivot() returns it and getVisible() / computeTargets() misbehave:
//   - album auto-expansion fails (breadcrumbSet.has(leader) is false)
//   - computeTargets places the leader off-center as a pseudo-child
//
// consecutive duplicate ids are deduped so a cluster that collapses a
// multi-hop breadcrumb to the same leader doesn't create a cycle.
function remapBreadcrumbToLeaders(crumb: string[]): string[] {
  const remapped = crumb.map((id) => {
    const lead = leaderOf(id);
    // only promote when the leader is actually in the graph; if not (e.g.
    // the leader itself was just removed), keep the original id and let the
    // normal breadcrumb-pruning logic handle it.
    return nodeMap.has(lead) ? lead : id;
  });
  // dedupe consecutive same-id entries
  return remapped.filter((id, i) => i === 0 || id !== remapped[i - 1]);
}

// ---- build the ancestor chain for a node not already on the breadcrumb ----
//
// the naive "expand" logic (walk back if found in breadcrumb, else append)
// only works when every clickable node is either a breadcrumb ancestor or a
// direct child of the current pivot. the auto-expand cascade (getVisible())
// now surfaces nodes several hops below the pivot (e.g. a video_series deep
// under a small taxon hub), so a click can target a node that's neither —
// naively appending it left stale, unrelated branches (e.g. a sibling
// relation hub from a previous pivot) stranded in the breadcrumb with no
// real path to the new pivot, which read as a "disconnected" node once
// visible() drew breadcrumb-set members without a coherent edge chain.
//
// "recently_added"/"unassigned"/"era"/"beloved"/"favorite(s)" relation hubs
// (createPivotHandler's maybeLoad*ForPivot loaders) wire entities directly
// to themselves as flat browse shortcuts, *alongside* the entity's real
// taxonomy/series parent chain — so a video/album can have several
// candidate parents in parentsOf. these synthetic hubs are keyed
// `relation::{remoteId}::{kind}`; matching by that suffix instead of a
// role check because they otherwise look like any other relation node.
const SYNTHETIC_RELATION_KINDS = new Set([
  "recently_added",
  "unassigned",
  "era",
  "beloved",
  "favorite",
  "favorites",
]);
function isSyntheticHubParent(id: string): boolean {
  const parts = id.split("::");
  return parts.length === 3 && parts[0] === "relation" && SYNTHETIC_RELATION_KINDS.has(parts[2]);
}

// walks up parentsOf from `id`, preferring — at each step — a parent that's
// already on the current breadcrumb (so the common, expected "walk forward
// from pivot's child" case still resolves in one hop). when no breadcrumb
// parent exists, prefers a non-synthetic-hub parent over a synthetic one so
// e.g. a video's real "trek stuff" taxon chain wins over an incidental
// "recently added"/"unassigned" browse-shortcut edge (array order there is
// merge/fetch order, not meaning). returns the full chain from the shared
// ancestor (or root, if none of the walked-up parents are on the
// breadcrumb) down to `id`, in root→...→id order.
function ancestorChainTo(id: string): string[] {
  const chain: string[] = [id];
  const seen = new Set<string>([id]);
  let cur = id;
  for (;;) {
    const parents = parentsOf.get(cur) ?? [];
    if (parents.length === 0) break;
    const next =
      parents.find((p) => state.breadcrumb.includes(p)) ??
      parents.find((p) => !isSyntheticHubParent(p)) ??
      parents[0];
    if (seen.has(next)) break; // cycle guard
    seen.add(next);
    chain.push(next);
    cur = next;
    if (state.breadcrumb.includes(next)) break; // reached the existing path
  }
  chain.reverse();
  return chain;
}

// ---- rebuild graph index (call after fullGraph changes) --------------------

function indexGraph() {
  nodeMap.clear();
  childrenOf.clear();
  parentsOf.clear();
  for (const n of state.fullGraph.nodes) nodeMap.set(n.id, n);
  for (const e of state.fullGraph.edges) {
    const src = e.source as string;
    const tgt = e.target as string;
    if (!childrenOf.has(src)) childrenOf.set(src, []);
    childrenOf.get(src)!.push(tgt);
    if (!parentsOf.has(tgt)) parentsOf.set(tgt, []);
    parentsOf.get(tgt)!.push(src);
  }
  // recompute childCount from actual edges, but preserve any eager
  // count the producer set (e.g. list_taxon_kinds returns album_count
  // for relation hubs before their value nodes are loaded; era bins
  // know their album counts before fanout). take max so the badge
  // surfaces real totals up-front, and once the actual edge count
  // exceeds the eager hint (cross-remote links etc.) edges win.
  for (const [id, node] of nodeMap) {
    const edgeCount = childrenOf.get(id)?.length ?? 0;
    node.childCount = Math.max(node.childCount ?? 0, edgeCount);
  }

  // phase 1: reverse value→album and value→artist edges in childrenOf so that
  // pivoting on an album or artist reveals its taxon value nodes as children.
  // we only update childrenOf (not fullGraph.edges) — the original forward
  // edges already exist for wire drawing between visible pairs.
  for (const e of state.fullGraph.edges) {
    const src = e.source as string;
    const tgt = e.target as string;
    const srcRole = nodeMap.get(src)?.role;
    const tgtRole = nodeMap.get(tgt)?.role;
    if (srcRole === "value" && (tgtRole === "album" || tgtRole === "artist")) {
      if (!childrenOf.has(tgt)) childrenOf.set(tgt, []);
      childrenOf.get(tgt)!.push(src);
    }
  }

  // phase 3: build cross-remote name-match links for artists + albums.
  // ids differ across remotes (`a01` vs `r01`) so matching is by slug of
  // the human label. albums also key on their parent artist's slug since
  // two unrelated artists can share a title (e.g. "Untitled").
  crossRemoteEdges.clear();
  clusterLeaderOf.clear();
  clusterMembers.clear();
  clusterRemotes.clear();
  const artistByKey = new Map<string, string[]>(); // slug(label) -> [artistId]
  const albumByKey = new Map<string, string[]>(); // slug(artistLabel)::slug(albumLabel) -> [albumId]

  // index artists first so albums can look up their parent's slug
  for (const n of state.fullGraph.nodes) {
    if (n.role !== "artist") continue;
    const k = slug(n.label);
    if (!k) continue;
    if (!artistByKey.has(k)) artistByKey.set(k, []);
    artistByKey.get(k)!.push(n.id);
  }

  // each album finds its artist parent via parentsOf (role==artist)
  for (const n of state.fullGraph.nodes) {
    if (n.role !== "album") continue;
    const parents = parentsOf.get(n.id) ?? [];
    // skip albums whose parents include an unassigned hub — those should
    // never participate in cross-remote clustering (the unassigned hub is
    // strictly per-remote; dashed cross-remote pseudo-children would leak
    // foreign-remote nodes into it). matches `relation::{remoteId}::unassigned`.
    const inUnassigned = parents.some((pid) => pid.endsWith("::unassigned"));
    if (inUnassigned) continue;
    const artistParent = parents.map((pid) => nodeMap.get(pid)).find((p) => p?.role === "artist");
    if (!artistParent) continue;
    const k = `${slug(artistParent.label)}::${slug(n.label)}`;
    if (!k) continue;
    if (!albumByKey.has(k)) albumByKey.set(k, []);
    albumByKey.get(k)!.push(n.id);
  }

  // all-pairs cross-remote links per matched group (different remotes only).
  // also designates a cluster leader (lexicographically lowest id with a
  // resolvable remote) so the visual layer can collapse the group into one
  // glyph (strategy A).
  function linkGroup(ids: string[]) {
    if (ids.length < 2) return;
    // bucket by remote so we can both (a) skip same-remote pairs and (b)
    // build the contributor remote list for the cluster.
    const remotes = new Set<string>();
    for (const id of ids) {
      const r = remoteOfId(id);
      if (r) remotes.add(r);
    }
    // need at least two distinct remotes to form a cross-remote cluster.
    if (remotes.size < 2) return;
    const sortedIds = [...ids].sort();
    const leader = sortedIds[0];
    clusterMembers.set(leader, sortedIds);
    clusterRemotes.set(leader, [...remotes].sort());
    for (const m of sortedIds) clusterLeaderOf.set(m, leader);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (remoteOfId(a) === remoteOfId(b)) continue; // same remote — skip
        crossRemoteEdges.add(crossKey(a, b));
        // augment adjacency so getVisible() surfaces counterparts as
        // pseudo-children of the pivoted artist/album (still useful as a
        // fallback for any path that bypasses cluster promotion).
        if (!childrenOf.has(a)) childrenOf.set(a, []);
        if (!childrenOf.has(b)) childrenOf.set(b, []);
        childrenOf.get(a)!.push(b);
        childrenOf.get(b)!.push(a);
        if (!parentsOf.has(a)) parentsOf.set(a, []);
        if (!parentsOf.has(b)) parentsOf.set(b, []);
        parentsOf.get(a)!.push(b);
        parentsOf.get(b)!.push(a);
      }
    }
  }
  for (const ids of artistByKey.values()) linkGroup(ids);
  for (const ids of albumByKey.values()) linkGroup(ids);
}

// ---- message handler -------------------------------------------------------

ctx.onmessage = (evt: MessageEvent<MainToWorker>) => {
  const msg = evt.data;

  switch (msg.type) {
    case "init": {
      state.fullGraph = msg.graph;
      state.width = msg.width;
      state.height = msg.height;
      state.pinned = new Set<string>();
      indexGraph();

      if (msg.breadcrumb && msg.breadcrumb.length > 0) {
        state.breadcrumb = [...msg.breadcrumb];
      } else {
        state.breadcrumb = [msg.pivot];
      }

      buildSim();
      post({ type: "ready" });
      break;
    }

    case "expand": {
      const { nodeId } = msg;
      if (!nodeMap.has(nodeId)) break;
      // always operate on the cluster leader so a follower id (e.g. from a
      // search-seed stub or a just-merged cross-remote sibling) never lands
      // in the breadcrumb and breaks pivot layout.
      const leadId = leaderOf(nodeId);

      const idx = state.breadcrumb.indexOf(leadId);
      if (idx >= 0) {
        // walk back: trim breadcrumb to this node
        state.breadcrumb = state.breadcrumb.slice(0, idx + 1);
      } else {
        // walk forward, but rebuild via the real ancestor chain rather than
        // blindly appending — the target may be an auto-expand-revealed
        // node several hops below the pivot, or an unrelated sibling from a
        // different branch entirely, neither of which is safe to just tack
        // onto the end of the current breadcrumb (see ancestorChainTo doc).
        const chain = ancestorChainTo(leadId);
        const anchor = chain[0];
        const anchorIdx = state.breadcrumb.indexOf(anchor);
        state.breadcrumb =
          anchorIdx >= 0 ? [...state.breadcrumb.slice(0, anchorIdx + 1), ...chain.slice(1)] : chain;
      }

      buildSim();
      break;
    }

    case "expandSubtree": {
      const { nodeId } = msg;
      if (!nodeMap.has(nodeId)) break;
      // toggle: a second long-press / button click collapses the eagerly-
      // surfaced subtree back to its normal pivot-driven visibility.
      if (state.eagerExpansions.has(nodeId)) {
        state.eagerExpansions.delete(nodeId);
      } else {
        state.eagerExpansions.add(nodeId);
      }
      buildSim();
      break;
    }

    case "collapseSubtrees": {
      if (state.eagerExpansions.size === 0) break;
      state.eagerExpansions.clear();
      buildSim();
      break;
    }

    case "resize": {
      state.width = msg.width;
      state.height = msg.height;
      // recompute targets around new center and restart
      if (state.sim) buildSim();
      break;
    }

    case "hitTest": {
      if (!state.sim) {
        post({ type: "hitResult", reqId: msg.reqId, nodeId: null });
        break;
      }
      const nodes = state.sim.nodes();
      // per-role inradius factors — keep the hit zone matched to the
      // rendered shape (lifted from the old GraphCanvas hit geometry).
      // narrower silhouettes get smaller factors so clicks in empty
      // corners don't register. floored at 12 screen pixels (12/k in
      // world units) so small nodes stay clickable when zoomed out.
      const INRADIUS: Record<string, number> = {
        root: 0.42, // freqhole mark — narrow at bottom
        remote: 0.95, // rounded square — corners stay clickable
        relation: 0.5, // hexagon
        value: 0.5, // octagon
        group: 0.5, // 7-sided polygon, same inradius as octagon
        artist: 0.5, // circle
        album: 0.95, // square — corners stay clickable
      };
      const minR = 12 / Math.max(msg.k, 0.05);
      let best: string | null = null;
      let bestDist = Infinity;
      for (const n of nodes) {
        // ghost artists are non-interactive (label-only, no shape)
        if (n.role === "ghost_artist") continue;
        const dx = (n.x ?? 0) - msg.x;
        const dy = (n.y ?? 0) - msg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let hit: boolean;
        if (n.role === "video" || n.role === "video_series" || n.role === "video_season") {
          // these are 16:9 rounded rects (see shapes.ts), not circles — a
          // single circular inradius factor can't fit both the wide (1.175r)
          // and short (0.66r) axes at once, so clicks near the left/right
          // edges of the card were silently missing. hit-test the actual
          // rectangle instead.
          const px = msg.x - (n.x ?? 0);
          const py = msg.y - (n.y ?? 0);
          let halfW = Math.max(n.radius * 1.175, minR);
          let halfH = Math.max(n.radius * 0.66, minR);
          if (n.role === "video_series") {
            // widen toward the top-right to also cover the "peeking" back
            // cards drawn behind the front card (drawing.ts), which extend
            // up to radius*0.32 beyond it in that direction.
            if (px > 0) halfW += n.radius * 0.32;
            if (py < 0) halfH += n.radius * 0.32;
          }
          hit = Math.abs(px) <= halfW && Math.abs(py) <= halfH;
        } else {
          const factor = INRADIUS[n.role] ?? 0.5;
          const hitR = Math.max(n.radius * factor, minR);
          hit = dist <= hitR;
        }
        if (hit && dist < bestDist) {
          bestDist = dist;
          best = n.id;
        }
      }
      post({ type: "hitResult", reqId: msg.reqId, nodeId: best });
      break;
    }

    case "merge": {
      const existingIds = new Set(state.fullGraph.nodes.map((n) => n.id));
      const existingEdgeKeys = new Set(
        state.fullGraph.edges.map((e) => `${e.source as string}::${e.target as string}`)
      );
      for (const n of msg.addNodes) {
        if (!existingIds.has(n.id)) {
          state.fullGraph.nodes.push(n);
          existingIds.add(n.id);
        }
      }
      for (const e of msg.addEdges) {
        const key = `${e.source as string}::${e.target as string}`;
        if (!existingEdgeKeys.has(key)) {
          state.fullGraph.edges.push(e);
          existingEdgeKeys.add(key);
        }
      }
      indexGraph();
      // remap breadcrumb: a merge can change cluster leadership (the newly
      // merged node may have a lexicographically smaller id, dethroning the
      // current breadcrumb tip from leader to follower). if a follower id
      // sits in the breadcrumb, pivot() returns it, getVisible() and
      // computeTargets() misplace the pivot node and miss the album ring.
      state.breadcrumb = remapBreadcrumbToLeaders(state.breadcrumb);
      buildSim();
      break;
    }

    case "remove": {
      if (msg.nodeIds.length === 0) break;
      const drop = new Set(msg.nodeIds);
      state.fullGraph.nodes = state.fullGraph.nodes.filter((n) => !drop.has(n.id));
      state.fullGraph.edges = state.fullGraph.edges.filter(
        (e) => !drop.has(e.source as string) && !drop.has(e.target as string)
      );
      // also prune from breadcrumb so we don't strand the pivot on a
      // node that no longer exists.
      state.breadcrumb = state.breadcrumb.filter((id) => !drop.has(id));
      if (state.breadcrumb.length === 0 && state.fullGraph.nodes.length > 0) {
        state.breadcrumb = [state.fullGraph.nodes[0].id];
      }
      // intentionally NOT pruning state.hidden here: the host typically
      // re-merges fresh nodes with the same ids right after remove() and
      // re-pushes setHidden(). dropping hidden entries between the two
      // would briefly un-hide nodes mid-refresh, breaking edit-mode
      // filter persistence across re-parent operations.
      indexGraph();
      // re-elect leaders after removal — a cluster may shrink to one
      // member, which dissolves the cluster entirely.
      state.breadcrumb = remapBreadcrumbToLeaders(state.breadcrumb);
      buildSim();
      break;
    }

    case "setHidden": {
      state.hidden = new Set(msg.nodeIds);
      buildSim();
      break;
    }

    case "setPinned": {
      state.pinned = new Set(msg.nodeIds);
      buildSim();
      break;
    }

    case "repivot": {
      if (!nodeMap.has(msg.nodeId)) break;
      // use the canonical leader so a follower id never becomes the pivot.
      const rLeadId = leaderOf(msg.nodeId);
      if (msg.resetBreadcrumb) {
        state.breadcrumb = [rLeadId];
      } else {
        state.breadcrumb = [...state.breadcrumb, rLeadId];
      }
      buildSim();
      break;
    }

    case "back": {
      if (state.breadcrumb.length > 1) {
        state.breadcrumb = state.breadcrumb.slice(0, -1);
      }
      state.eagerExpansions.clear();
      buildSim();
      break;
    }

    case "setPaused": {
      state.paused = msg.paused;
      if (state.paused) {
        state.sim?.stop();
      } else {
        state.sim?.alpha(0.3).restart();
      }
      break;
    }

    case "setTuning": {
      state.tuning = { ...state.tuning, ...msg.tuning };
      if (state.sim) {
        buildSim();
      }
      break;
    }

    case "getBounds": {
      if (!state.sim || state.sim.nodes().length === 0) {
        post({ type: "boundsResult", reqId: msg.reqId, bounds: null });
        break;
      }
      const nodes = state.sim.nodes();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      post({ type: "boundsResult", reqId: msg.reqId, bounds: { minX, minY, maxX, maxY } });
      break;
    }
  }
};
