// pure seed-grouping helpers used by `GraphCanvas.rebuild()` to
// decide which initial cluster a brand-new node should fall into,
// and where on its parent ring synthetic hub buckets should land.
//
// extracted as the second slice of phase 12 (see
// docs/graph-viz-evolution-plan.md). these helpers are intentionally
// pure / depless: GraphCanvas still owns the bigger phyllotaxis
// loop, centroid bookkeeping, and family layout — what lives here
// is the *key* + *lane offset* math, which is easy to unit-test in
// isolation and accounts for most of the per-role conditional
// branching that bloats `rebuild()`.

import type { AlbumNodeData, ArtistNodeData, GraphNodeData } from "../types";
import {
  isRelationHubId,
  isRelationValueHubId,
  isRemoteHubId,
  parseRelationHubId,
  parseRelationValueHubId,
} from "../hubNodes";

/** stable per-string hash (fnv-1a-ish). returns an unsigned 32-bit
 *  integer that's deterministic across runs and platforms so the
 *  same remote / kind always lands on the same angle slot at
 *  first render. */
export function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** map any string to a stable angle in [0, 2π). */
export function hashAngle(s: string): number {
  return ((strHash(s) % 360) / 360) * Math.PI * 2;
}

/** map a node to a coarse seed-bucket key so pre-seeding can drop
 *  brand-new nodes into clusters by artist / label / era / genre,
 *  and synthetic hub nodes into per-remote / per-kind buckets.
 *
 *  the key namespace is intentionally `family:value` so callers
 *  can derive a coarser "family" key by splitting on the first
 *  colon (used for the outer family ring in rebuild()). */
export function seedGroupKey(node: GraphNodeData): string {
  if (node.kind === "album") {
    const a = node as AlbumNodeData;
    if (a.artistId) return `artist:${a.artistId}`;
    if (a.artistName) return `artist_name:${a.artistName.toLowerCase()}`;
    if (a.label) return `label:${a.label.toLowerCase()}`;
    if (a.era) return `era:${a.era.toLowerCase()}`;
    if (a.genres[0]) return `genre:${a.genres[0].toLowerCase()}`;
    return "album:ungrouped";
  }
  const r = node as ArtistNodeData;
  if (isRemoteHubId(r.artistId)) {
    // each remote gets its own seed bucket so multi-remote
    // selections fan their triangles out instead of stacking.
    return `hub:remote:${r.artistId}`;
  }
  if (isRelationHubId(r.artistId)) {
    // each remote's relation-kind hexagons share a per-remote
    // bucket so seeding clusters them together (and apart from
    // sibling remotes' hexagons).
    const remote = parseRelationHubId(r.artistId)?.remoteId ?? "_";
    return `hub:relation:${remote}`;
  }
  if (isRelationValueHubId(r.artistId)) {
    // value hubs aren't remote-scoped — split by kind so each
    // drilled relation gets its own seed cluster.
    const kind = parseRelationValueHubId(r.artistId)?.kind ?? "_";
    return `hub:relation_value:${kind}`;
  }
  if (r.artistId) return `artist:${r.artistId}`;
  if (r.label) return `label:${r.label.toLowerCase()}`;
  if (r.era) return `era:${r.era.toLowerCase()}`;
  if (r.genres[0]) return `genre:${r.genres[0].toLowerCase()}`;
  return "artist:ungrouped";
}

/** normalized lane offset (unit-circle-ish coordinates relative to
 *  the cluster centroid) for synthetic hub seed buckets. callers
 *  multiply by `clusterSpacing` to land hubs on the parent ring
 *  at a deterministic angle. returns `null` for non-hub keys (the
 *  caller falls back to the phyllotaxis ring placement). */
export function hubLaneOffset(key: string): { ox: number; oy: number } | null {
  if (key.startsWith("hub:remote:")) {
    const remote = key.slice("hub:remote:".length);
    const a = hashAngle("remote::" + remote);
    // remote triangles sit on the outer ring along the remote's
    // angle slot. provides an initial spread hint only \u2014 the worker
    // no longer runs directional forces (phase 1 reset, 2026-05-26),
    // so the steady-state placement is driven by link + collide alone.
    return { ox: 0.95 * Math.cos(a), oy: 0.95 * Math.sin(a) };
  }
  if (key.startsWith("hub:relation:")) {
    const remote = key.slice("hub:relation:".length);
    // relation hexagons share the remote's angle AND its outer-
    // ring radius so they seed clustered around the parent
    // triangle. link springs + collide pick the exact arrangement.
    const a = hashAngle("remote::" + remote);
    return { ox: 0.95 * Math.cos(a), oy: 0.95 * Math.sin(a) };
  }
  if (key.startsWith("hub:relation_value:")) {
    const kind = key.slice("hub:relation_value:".length);
    // value octagons seed in their kind's coarse direction but
    // are pushed further out at runtime (factor 1.3) along an
    // angle hashed per-value so siblings fan into open canvas
    // instead of curling back through the root cluster.
    const a = hashAngle("value::" + kind);
    return { ox: 1.2 * Math.cos(a), oy: 1.2 * Math.sin(a) };
  }
  return null;
}

/** family identifier — the part of `seedGroupKey()` before the
 *  first colon. used by `rebuild()` to group buckets into outer
 *  rings (so all `artist:*` clusters share one ring etc.). */
export function familyOf(key: string): string {
  const i = key.indexOf(":");
  return i > 0 ? key.slice(0, i) : key;
}
