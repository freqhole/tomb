import type { VisibleNode } from "../worker/messages";
import { ROLE_COLOR, valueKindStroke, ROLE_RANK, EDGE_BREADCRUMB } from "./colors";
import { valueKind } from "./idUtils";

// lighten a color by `amt` (0–1) toward white. handles both hex
// (#rrggbb) and hsl(h s% l%) strings so groups can sit visually a
// notch above their sibling values without losing the kind hue.
function lighten(color: string, amt: number): string {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    const mix = (c: number) => Math.round(c + (255 - c) * amt);
    return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(color);
  if (hsl) {
    const h = parseFloat(hsl[1]);
    const s = parseFloat(hsl[2]);
    const l = parseFloat(hsl[3]);
    const newL = Math.min(95, l + (100 - l) * amt);
    return `hsl(${h} ${s}% ${newL}%)`;
  }
  return color;
}

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
    // relation::{remoteId}::beloved — pink for the all-users
    // favorites aggregate, distinct from per-user favorites red.
    if (parts[0] === "relation" && parts[2] === "beloved") return "#ec4899";
    // relation::{remoteId}::unassigned — neutral gray so the orphan
    // hub reads as "no taxonomy here" rather than another kind.
    if (parts[0] === "relation" && parts[2] === "unassigned") return "#6b7280";
  }
  if (n.role === "value" || n.role === "group") {
    const kind = valueKind(n.id);
    if (kind) {
      const base = valueKindStroke(kind);
      return n.role === "group" ? lighten(base, 0.35) : base;
    }
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
