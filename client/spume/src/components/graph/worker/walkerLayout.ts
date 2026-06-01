import { childrenOf, nodeMap, parentsOf, state } from "./walkerState";
import { clusterChildrenOf, leaderOf, nodeRadius, pivot } from "./walkerHelpers";

// ---- bloom target positions ------------------------------------------------
// wedge layout: pivot at center, children fan out forward into a CONE.
// when a wedge has more siblings than fit on one arc (at MIN_ARC_SPACING),
// we stack additional rows of arcs radially outward — so the wedge fills
// in like a slice of a dartboard rather than ballooning into one huge ring.
// ancestors go left.

export const RING_STEP        = 170;             // legacy: still used for ancestor placement
export const FORWARD          = 0;                // wedge points right (→)
export const INIT_WEDGE       = Math.PI * 1.15;   // ~207° forward arc for first level — clearly a fan
export const MAX_WEDGE        = Math.PI * 0.9;    // sub-wedge cap per child (keeps cones from overlapping)

export function computeTargets(
  pivotId: string,
  visibleIds: Set<string>,
  cx: number,
  cy: number,
): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>();

  targets.set(pivotId, { x: cx, y: cy });

  /** place `kids` inside a wedge centered on `midAngle` with angular extent
   *  `wedge`, recursively placing their own children. multi-row when there
   *  are more siblings than fit comfortably on the base arc. spacing scales
   *  with the actual rendered radii so tiny albums pack tighter than fat
   *  genre hubs. */
  function place(
    parentX: number,
    parentY: number,
    parentR: number,
    kidIds: string[],
    midAngle: number,
    wedge: number,
  ) {
    if (kidIds.length === 0) return;

    // average + max radius of this generation drives all spacing knobs
    let sumR = 0;
    let maxR = 0;
    for (const id of kidIds) {
      const n = nodeMap.get(id);
      const r = n ? nodeRadius(n.role, n.childCount) : 14;
      sumR += r;
      if (r > maxR) maxR = r;
    }
    const avgR = sumR / kidIds.length;
    // arc gap = ~2.6 * average diameter; radial gap = ~2.4 * max diameter.
    // tie both knobs to parentR as well so a fat-catalog artist (whose
    // nodeRadius scales with childCount) actually gets a roomier album
    // ring, not just a bigger central glyph crowding the same shell.
    const minArc    = Math.max(36, avgR * 2.6, parentR * 0.55);
    const radialStep = Math.max(54, maxR * 2.4, parentR * 1.1);
    // first row sits parent-radius + a bit + max-kid-radius away from
    // parent. the third term (`parentR * 1.2`) adds personal space
    // proportional to the parent's footprint — for a 51px artist it
    // pads the album ring outward by ~61px instead of the previous flat
    // 28px floor, which is what was making "fat artist" feel tight.
    const baseR    = parentR + maxR + Math.max(28, avgR * 1.4, parentR * 1.2);

    // how many siblings fit per row before they'd be closer than minArc
    const perRow = Math.max(2, Math.floor((wedge * baseR) / minArc));
    const rows = Math.ceil(kidIds.length / perRow);

    for (let i = 0; i < kidIds.length; i++) {
      if (targets.has(kidIds[i])) continue;
      const rowIdx = Math.floor(i / perRow);
      const inRow  = i % perRow;
      // last partial row may have fewer items — center it inside the wedge
      const rowCount = rowIdx === rows - 1 ? kidIds.length - rowIdx * perRow : perRow;
      const r = baseR + rowIdx * radialStep;
      // spread this row evenly across the wedge; one-item rows sit at midAngle
      const step = rowCount > 1 ? wedge / rowCount : 0;
      // honeycomb-ish offset on odd rows so items don't form radial spokes
      const honeyOffset = (rowIdx % 2) * (step / 2);
      const start = midAngle - (step * (rowCount - 1)) / 2 + honeyOffset;
      const angle = start + inRow * step;
      const x = parentX + Math.cos(angle) * r;
      const y = parentY + Math.sin(angle) * r;
      targets.set(kidIds[i], { x, y });

      // recurse for this child's own subtree — narrower wedge so cones nest
      const grandKids = (childrenOf.get(kidIds[i]) ?? []).filter((id) => visibleIds.has(id));
      if (grandKids.length > 0) {
        const kidNode = nodeMap.get(kidIds[i]);
        const kidR    = kidNode ? nodeRadius(kidNode.role, kidNode.childCount) : 14;
        // child's wedge = its angular slot, capped. don't promote it past its
        // siblings' share — that's what caused lone descendants to spread out
        // way wider than their parent's footprint and overlap neighbors.
        const slotWedge = step > 0 ? step * 0.95 : wedge * 0.6;
        const childWedge = Math.min(slotWedge, MAX_WEDGE);
        place(x, y, kidR, grandKids, angle, childWedge);
      }
    }
  }

  // pivot's children fan forward
  const rootKids = (childrenOf.get(pivotId) ?? []).filter((id) => visibleIds.has(id));
  const pivotNode = nodeMap.get(pivotId);
  const pivotR = pivotNode ? nodeRadius(pivotNode.role, pivotNode.childCount) : 14;
  place(cx, cy, pivotR, rootKids, FORWARD, INIT_WEDGE);

  // breadcrumb ancestors go to the left, fanning slightly so they don't stack
  const ancestors = state.breadcrumb.slice(0, -1).reverse();
  for (let i = 0; i < ancestors.length; i++) {
    const id = ancestors[i];
    if (!visibleIds.has(id) || targets.has(id)) continue;
    const angle = Math.PI + (i - ancestors.length / 2) * 0.35;
    const r = RING_STEP * (i + 1);
    targets.set(id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }

  // relation hubs surfaced for visible value children (see getVisible) need an
  // explicit slot — they aren't a child of pivot, so they'd hit the random
  // fallback. anchor each just beyond the centroid of its visible values so
  // the kind-tinted wires fan inward toward the hub from a consistent side.
  for (const id of visibleIds) {
    if (targets.has(id)) continue;
    const node = nodeMap.get(id);
    if (node?.role !== "relation") continue;
    // gather positioned value children of this hub
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const childId of childrenOf.get(id) ?? []) {
      const t = targets.get(childId);
      if (!t) continue;
      sx += t.x;
      sy += t.y;
      count++;
    }
    if (count === 0) continue;
    const ax = sx / count;
    const ay = sy / count;
    // push outward from pivot by ~one ring step past the values' centroid
    const dx = ax - cx;
    const dy = ay - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const push = RING_STEP * 0.9;
    targets.set(id, {
      x: ax + (dx / dist) * push,
      y: ay + (dy / dist) * push,
    });
  }

  // any remaining visible node (shouldn't happen often)
  let fallback = 0;
  for (const id of visibleIds) {
    if (!targets.has(id)) {
      targets.set(id, {
        x: cx + Math.cos(fallback) * RING_STEP * 2,
        y: cy + Math.sin(fallback) * RING_STEP * 2,
      });
      fallback += 1.1;
    }
  }

  return targets;
}

// ---- compute which nodes are visible ---------------------------------------

export function getVisible(): Set<string> {
  const visible = new Set<string>(state.breadcrumb);
  const piv = pivot();
  const pivRole = nodeMap.get(piv)?.role;
  for (const childId of clusterChildrenOf(piv)) {
    const wn = nodeMap.get(childId);
    if (!wn) continue;
    // skip hub nodes that ended up with no children (e.g. unmapped genre).
    // lazy hubs are exempt: their children are loaded on pivot, so they
    // legitimately have zero children until the user expands them.
    if ((wn.role === "value" || wn.role === "relation") && wn.childCount === 0 && !wn.lazy) continue;
    // when pivot is a remote hub, only surface its first-order taxon
    // children (relation hubs: genre, mood, tag, style, era, label,
    // favorite). artists/albums are intentionally hidden until the user
    // drills through a relation \u2192 value path. without this scope a
    // remote with hundreds of artists would dump the entire library on
    // screen the moment you opened it.
    if (pivRole === "remote" && wn.role !== "relation") continue;
    visible.add(childId);
  }
  // auto-expand album children only for the pivot artist (or any artist on
  // the breadcrumb path). without this scope, opening a remote hub would
  // surface every artist AND every album in that remote at once \u2014 huge
  // graphs and a giant ball of nodes. progressive expansion is the goal:
  // pivot a remote \u2192 see artists; click an artist \u2192 see its albums.
  const breadcrumbSet = new Set(state.breadcrumb);
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role !== "artist") continue;
    if (id !== piv && !breadcrumbSet.has(id)) continue;
    for (const childId of clusterChildrenOf(id)) {
      const child = nodeMap.get(childId);
      if (child?.role === "album") visible.add(childId);
    }
  }
  // when an album is visible (breadcrumb or auto-expanded), keep its parent artist visible
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role === "album") {
      for (const parentId of parentsOf.get(id) ?? []) {
        const parent = nodeMap.get(parentId);
        if (parent?.role === "artist") visible.add(parentId);
      }
    }
  }
  // surface the taxon-hub (relation node) for every visible value, so users
  // can see at a glance which kind a value belongs to and have a launch point
  // back into that taxon. the forward relation→value edge already exists in
  // fullGraph.edges, so the wire draws automatically once both sides are
  // visible. skips the case where the relation is already on the breadcrumb.
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role !== "value") continue;
    for (const parentId of parentsOf.get(id) ?? []) {
      const parent = nodeMap.get(parentId);
      if (parent?.role === "relation") visible.add(parentId);
    }
  }
  // strategy A — collapse cluster followers to their leader. iterating
  // over a snapshot since we mutate the set. members are deleted; only
  // the leader remains so the renderer draws a single aggregate glyph.
  // breadcrumb membership is preserved by adding the leader when any
  // member was on the breadcrumb (the original member id stays in
  // breadcrumb[] — the worker uses leaderOf() at edge-emit + breadcrumb-
  // set construction time so the leader still reads as "on path").
  for (const id of [...visible]) {
    const lead = leaderOf(id);
    if (lead === id) continue;
    visible.delete(id);
    visible.add(lead);
  }
  // apply host-driven hide filter last. breadcrumb is preserved so the
  // user can't accidentally orphan the pivot.
  if (state.hidden.size > 0) {
    const crumb = new Set(state.breadcrumb);
    for (const id of state.hidden) {
      if (crumb.has(id)) continue;
      visible.delete(id);
    }
  }
  return visible;
}
