import type { VisibleNode } from "../worker/messages";
import { ROLE_COLOR, valueKindStroke, ROLE_RANK, EDGE_BREADCRUMB } from "./colors";
import { valueKind } from "./idUtils";

// fills stay role-neutral so labels rendered on top keep consistent contrast.
// per-kind color only shows up on the stroke + outgoing edge lines.
export function nodeFillColor(n: VisibleNode): string {
  if (n.tint) return n.tint;
  // special-case the favorites hub so it pops red instead of blending
  // in with the rest of the cyan relation hexagons.
  if (n.role === "relation") {
    const parts = n.id.split("::");
    // relation::{remoteId}::favorites
    if (parts[0] === "relation" && parts[2] === "favorites") return "#dc2626";
  }
  if (n.role === "value" || n.role === "group") {
    const kind = valueKind(n.id);
    if (kind) return valueKindStroke(kind);
  }
  return ROLE_COLOR[n.role] ?? "#888";
}

/** color for an edge based on its endpoints — value endpoints win and tint
 *  the wire with their kind's color so "tagged with" relationships are
 *  visually grouped. returns null if neither endpoint is a value. */
export function edgeKindColor(
  a: VisibleNode | undefined,
  b: VisibleNode | undefined
): string | null {
  for (const n of [a, b]) {
    if (!n || (n.role !== "value" && n.role !== "group")) continue;
    const kind = valueKind(n.id);
    if (kind) return valueKindStroke(kind);
  }
  return null;
}

/** pick the fill color of the higher-rank (closer-to-root) endpoint so
 *  edges read as extensions of the upstream hub rather than a generic
 *  navigation highlight. */
export function hubEdgeColor(a: VisibleNode | undefined, b: VisibleNode | undefined): string {
  if (!a) return b ? nodeFillColor(b) : EDGE_BREADCRUMB;
  if (!b) return nodeFillColor(a);
  const ra = ROLE_RANK[a.role] ?? 99;
  const rb = ROLE_RANK[b.role] ?? 99;
  return nodeFillColor(ra <= rb ? a : b);
}
