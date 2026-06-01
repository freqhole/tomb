import {
  childrenOf,
  clusterLeaderOf,
  clusterMembers,
  state,
} from "./walkerState";

export function crossKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

/** mirror of nodeIds.remoteHubId — defined locally so the worker stays
 *  free of main-thread imports. */
export function remoteHubId(remoteId: string): string {
  return `remote::${remoteId}`;
}

/** case-insensitive, punctuation-collapsing slug — used for cross-remote
 *  name matching (artists, album titles). matches "MF DOOM" with "Mf Doom",
 *  "Sunn O)))" with "sunn o", "Post-Punk" with "post punk". */
export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** parse the remote id out of an entity id like `artist::raid::r01`. returns
 *  null for ids that aren't entity-scoped. used so we only build cross-remote
 *  links between different remotes (not within the same remote). */
export function remoteOfId(id: string): string | null {
  const parts = id.split("::");
  if (parts.length < 3) return null;
  if (parts[0] !== "artist" && parts[0] !== "album") return null;
  return parts[1];
}

export function pivot(): string {
  return state.breadcrumb[state.breadcrumb.length - 1] ?? "";
}

/** map a node id to its cluster leader (or itself if not in a cluster).
 *  used to collapse cross-remote duplicates into a single visible glyph. */
export function leaderOf(id: string): string {
  return clusterLeaderOf.get(id) ?? id;
}

/** strategy A phase 2 — return the union of children across every member
 *  of `id`'s cluster (or just `childrenOf.get(id)` when `id` is not in a
 *  cluster). this is the key to surfacing every contributor's children
 *  when the user pivots on (or auto-expands) a cluster leader: e.g.
 *  pivoting on a merged-artist glyph reveals albums from every remote
 *  that hosts that artist, not just the leader's remote. duplicate
 *  child entries are tolerated \u2014 the visible-set collapse loop runs
 *  follower\u2192leader at the end of getVisible(), and Set semantics
 *  dedupe naturally before that. */
export function clusterChildrenOf(id: string): string[] {
  const lead = leaderOf(id);
  const direct = childrenOf.get(lead) ?? [];
  const members = clusterMembers.get(lead);
  if (!members || members.length === 0) return direct;
  const out: string[] = [...direct];
  for (const m of members) {
    if (m === lead) continue;
    for (const c of childrenOf.get(m) ?? []) out.push(c);
  }
  return out;
}

// ---- node radius by role + childCount --------------------------------------

export function nodeRadius(role: string, childCount: number): number {
  switch (role) {
    case "root":     return 14;
    case "remote":   return 28 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "relation": return 20 + Math.min(Math.sqrt(childCount) * 4, 20);
    case "value":
    case "group":
      return 14 + Math.min(Math.sqrt(childCount) * 3, 16);
    // artists grow with album count when they have more than a couple of
    // albums, which boosts the parent-radius input into computeTargets'
    // baseR/radialStep and gives related-artist ghosts + album rings
    // breathing room around a fat catalog. 3 albums → 27 (unchanged),
    // 7 → ~37, 15 → ~46, 30+ → caps at ~51.
    case "artist":   return 27 + Math.min(Math.sqrt(Math.max(0, childCount - 3)) * 5, 24);
    case "album":    return 16;
    case "ghost_artist": return 8; // text-only, small footprint just for layout
    default:         return 14;
  }
}
