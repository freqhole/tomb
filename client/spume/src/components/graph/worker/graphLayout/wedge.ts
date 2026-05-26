// wedge math: distributing angular budget among siblings + placing
// kids on a ring inside a parent's wedge.
//
// the pivot blooms into the full circle (`halfWidth = π`). every
// other node receives a narrower wedge centered on its outward
// vector (the unit vector from its parent to itself); its own kids
// then bloom inside that wedge.
//
// no overlap by construction: arc-length capacity at the child ring
// radius is computed from `2 * childRadius + slotGap`; surplus past
// capacity collapses into a single "more" stub.

import type { LayoutNode, Wedge } from "./types";

/** smallest angular share a sibling can receive at the pivot. ~10°.
 *  guarantees a thin hub still has room for its own glyph. */
export const MIN_WEDGE_RAD = (10 * Math.PI) / 180;

/** padding between adjacent slots on a ring, as a fraction of the
 *  larger of the two neighbour radii. 0.25 leaves a quarter-radius
 *  gap, which reads as comfortable breathing room. */
export const SLOT_GAP_FRAC = 0.25;

/** padding between sibling wedges as a fraction of each wedge's
 *  half-width. keeps petals from visually touching at the parent. */
export const WEDGE_GAP_FRAC = 0.08;

/** how aggressively a hub's wedge grows relative to siblings.
 *  weight = (childCount + 1) ^ POWER. POWER=0.5 (sqrt) keeps fat
 *  hubs from utterly dominating the canvas. */
export const WEIGHT_POWER = 0.5;

/** rendered radius of a node for slot/collision math. matches the
 *  on-canvas glyph size so layout density matches what the user
 *  sees. mirrors `effectiveNodeSize` from the renderer: hubs scale
 *  by sqrt(count / maxCount) over [0.7, 1.6] of the base size. */
export function nodeRadiusFor(
  node: LayoutNode,
  baseSize: number,
  maxHubCount: number,
): number {
  const baseR = baseSize * 0.55;
  if (node.kind !== "hub") return baseR;
  const count = node.albumCount ?? 0;
  if (count <= 0 || maxHubCount <= 1) return baseR * 0.7;
  const ratio = Math.sqrt(count) / Math.sqrt(maxHubCount);
  const mul = 0.7 + (1.6 - 0.7) * ratio;
  return baseR * mul;
}

/** distribute a parent's bloom budget among its children. returns
 *  one wedge per child, in the same order. the sum of child widths
 *  (plus inter-wedge gaps) fills the parent's budget exactly.
 *
 *  weights are proportional to `(childCount + 1) ^ WEIGHT_POWER` so
 *  a fat sub-hub claims more angle than its thin sibling, but the
 *  sqrt curve prevents one giant hub from squeezing everyone else
 *  to slivers.
 *
 *  the floor (`MIN_WEDGE_RAD`) applies only at the pivot (where the
 *  total budget is 2π). at narrower budgets every child still
 *  receives a proportional slice; the caller decides whether to
 *  trigger the stub mechanic based on slot capacity downstream. */
export function distributeWedges(
  parentWedge: Wedge,
  children: Array<{ id: string; subtreeCount: number }>,
): Wedge[] {
  if (children.length === 0) return [];
  const isFullCircle = parentWedge.halfWidth >= Math.PI - 1e-6;
  const totalBudget = 2 * parentWedge.halfWidth;

  // reserve inter-wedge padding (skip at full circle since petals
  // wrap continuously).
  const gapEach = isFullCircle ? 0 : WEDGE_GAP_FRAC * totalBudget / Math.max(children.length, 1);
  const gapTotal = isFullCircle ? 0 : gapEach * Math.max(children.length - 1, 0);
  const usable = Math.max(totalBudget - gapTotal, 0);

  // proportional weights with a floor only at full circle.
  const weights = children.map((c) =>
    Math.pow(Math.max(c.subtreeCount, 0) + 1, WEIGHT_POWER),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  let widths = weights.map((w) => (w / totalWeight) * usable);

  if (isFullCircle) {
    // apply MIN_WEDGE_RAD floor and renormalize.
    const minW = MIN_WEDGE_RAD;
    let floored = 0;
    widths = widths.map((w) => {
      if (w < minW) {
        floored += minW - w;
        return minW;
      }
      return w;
    });
    // pull excess off the fattest wedges proportionally.
    if (floored > 0) {
      const overMin = widths.map((w) => Math.max(w - minW, 0));
      const totalOver = overMin.reduce((a, b) => a + b, 0);
      if (totalOver > 0) {
        widths = widths.map((w, i) => w - (overMin[i] / totalOver) * floored);
      }
    }
  }

  // place sequentially: first child's left edge = parentWedge.center - halfWidth.
  const startAngle = parentWedge.center - parentWedge.halfWidth;
  const out: Wedge[] = [];
  let cursor = startAngle;
  for (let i = 0; i < children.length; i++) {
    const w = widths[i];
    const center = cursor + w / 2;
    out.push({ center, halfWidth: w / 2 });
    cursor += w + gapEach;
  }
  return out;
}

export interface PlacedChild {
  id: string;
  x: number;
  y: number;
  wedge: Wedge;
}

export interface PlacementResult {
  placed: PlacedChild[];
  /** ids that did NOT fit; caller folds them into a "more" stub. */
  surplus: string[];
}

/** place kids inside the parent's wedge at `ringRadius`.
 *  computes slot capacity from arc-length vs slot widths, places
 *  the first `capacity - 1` kids + reserves one slot for the stub
 *  if any surplus exists. when everything fits, all kids get a slot
 *  and `surplus` is empty.
 *
 *  the returned `wedge` on each placed child is its own bloom
 *  envelope for the next tier (centered on its outward vector,
 *  half-width = its share of the parent's budget).
 *
 *  `ringRadius` is the distance from the parent at which kids sit. */
export function placeChildrenInWedge(
  parentPos: { x: number; y: number },
  parentWedge: Wedge,
  ringRadius: number,
  kids: Array<{ id: string; subtreeCount: number; radius: number }>,
): PlacementResult {
  if (kids.length === 0) return { placed: [], surplus: [] };

  // arc length the wedge offers at this ring.
  const arcLength = 2 * parentWedge.halfWidth * ringRadius;
  // average slot width = 2r + gap. compute average across kids.
  const avgR =
    kids.reduce((s, k) => s + k.radius, 0) / kids.length;
  const slotWidth = 2 * avgR + SLOT_GAP_FRAC * avgR;
  const capacity = Math.max(1, Math.floor(arcLength / slotWidth));

  const fits = kids.length <= capacity;
  const renderCount = fits ? kids.length : capacity - 1;
  const visible = kids.slice(0, renderCount);
  const surplus = fits ? [] : kids.slice(renderCount).map((k) => k.id);

  // sub-distribute the wedge among `visible` (+ stub if surplus).
  const slotsForDistribution = fits
    ? visible
    : [
        ...visible,
        // reserve one synthetic slot for the stub. weight = avg
        // sibling weight so it doesn't dominate or shrink.
        {
          id: `__stub_slot__`,
          subtreeCount:
            visible.reduce((s, v) => s + v.subtreeCount, 0) /
            Math.max(visible.length, 1),
        },
      ];

  const childWedges = distributeWedges(parentWedge, slotsForDistribution);

  const placed: PlacedChild[] = [];
  for (let i = 0; i < visible.length; i++) {
    const w = childWedges[i];
    placed.push({
      id: visible[i].id,
      x: parentPos.x + Math.cos(w.center) * ringRadius,
      y: parentPos.y + Math.sin(w.center) * ringRadius,
      wedge: w,
    });
  }

  // stub placement (if surplus exists). the caller (graphLayout)
  // adds the stub to its `stubs` list and to `positions` using this
  // returned slot.
  if (!fits) {
    const stubWedge = childWedges[childWedges.length - 1];
    placed.push({
      id: `__stub__`, // sentinel; caller assigns the real synthetic id
      x: parentPos.x + Math.cos(stubWedge.center) * ringRadius,
      y: parentPos.y + Math.sin(stubWedge.center) * ringRadius,
      wedge: stubWedge,
    });
  }

  return { placed, surplus };
}
