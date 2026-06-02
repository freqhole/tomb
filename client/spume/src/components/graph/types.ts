// shared types for the album graph viz
// canvas-rendered, d3-force-laid-out node graph

import type { ImageMetadata } from "../../music/services/storage/types";

export type RelationKind =
  | "genre"
  | "tag"
  | "same_artist"
  | "related_artist"
  | "mood"
  | "style"
  | "era"
  | "label"
  | "favorite"
  /** synthesized per-remote "top N most recently added" hub. flat
   *  (no value tier). populated from backend `recently_added_albums`
   *  offal route. */
  | "recently_added"
  /** artist node connected to one of its in-library albums */
  | "artist_album"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {}); // user-defined kind_slugs (e.g. "vibe", "decade")

/** discriminator for the graph node union. albums get `"album"`, artist
 *  avatar nodes get `"artist"`. older code paths that pre-date the union
 *  may construct AlbumNodeData without an explicit `kind` — treat
 *  missing as `"album"`. */
export type NodeKind = "album" | "artist";

// allow arbitrary user-defined taxon keys (e.g. "vibe", "decade") while
// preserving autocomplete for the well-known set above.
// eslint-disable-next-line @typescript-eslint/ban-types
export type RelationKindLike = RelationKind | (string & {});

export interface AlbumNodeData {
  id: string;
  /** discriminator. optional for back-compat; treat missing as "album". */
  kind?: "album";
  title: string;
  artistId: string;
  artistName: string;
  year: number | null;
  /** absolute or remote url for the album thumbnail; null = render text tile.
   *  derived from `image` for back-compat with html-only consumers
   *  (e.g. `AlbumNodeView`). canvas-side resolution prefers `image`. */
  imageUrl: string | null;
  /** full image metadata for canonical resolution via the blob
   *  resolver (handles local opfs / p2p / charnel / plain http). */
  image: ImageMetadata | null;

  // taxons
  genres: string[];
  tags: TagRef[];
  moods: string[];
  styles: string[];
  /** record label name */
  label: string | null;
  /** 5-year bucket label like "1990-1994" */
  era: string | null;
  /** user-defined taxon kinds not in the well-known set. kind_slug -> labels[]. */
  customTaxons: Record<string, string[]>;

  // sugar
  trackCount: number;
  totalDurationSec: number;
  rating?: number | null;
  isFavorite?: boolean;
  /** which remote contributed this album. null = mocked / single-remote
   *  story. set by the adapter so multi-remote views can disambiguate.
   *
   *  @deprecated since phase 8 — prefer `sourceRemoteIds`, which
   *  carries every remote that contributed to a merged entity. kept
   *  as a back-compat alias: when only one remote contributes, this
   *  equals `sourceRemoteIds[0]`. for merged albums it is set to the
   *  first contributor and should not be used for membership checks. */
  sourceRemoteId?: string | null;
  /** every remote that contributed to this (potentially merged) album.
   *  for unmerged adapter output this is `[opts.remoteId]`. for merged
   *  entities (produced by the graph subview) this unions across all
   *  contributors. unset on legacy mocked data. use
   *  `belongsToRemote(node, remoteId)` for membership checks. */
  sourceRemoteIds?: string[];
  /** true when this album is part of the primary drill fanout
   *  (matched the active relation+value), false when it's a
   *  contextual halo album rendered alongside a fanout artist
   *  to show the artist's broader in-library catalog. unset/
   *  undefined for albums rendered outside the entities tier
   *  — treat missing as "true" / not a contextual album. */
  matchedByDrill?: boolean;
}

export interface TagRef {
  label: string;
  /** 0..1 normalized weight (folksonomy count, lastfm weight, etc.) */
  weight: number;
}

/** the non-album node shape. originally introduced for circle-avatar
 *  artist nodes (derived client-side from the unique artists across
 *  the loaded album set), and now serves as the common payload for
 *  FOUR distinct visual roles:
 *
 *    - real artist (circle avatar) — `id = artist::<artistId>`
 *    - remote-root hub (freqhole mark) — `id = hub_remote::<remote_id>`
 *    - relation-kind hub (hexagon) — `id = hub_relation::<remote_id>::<kind>`
 *    - relation-value hub (octagon) — `id = hub_relation_value::<kind>::<value>`
 *
 *  use `nodeRole(n)` (from `draw/shared/roleDispatch.ts`) to classify
 *  an instance; the `kind` discriminator only distinguishes album vs.
 *  non-album, not which of the four non-album roles a node fills.
 *
 *  hubs piggyback on this shape because they share the same visual
 *  vocabulary as artist circles: a glyph (image or acronym) + name +
 *  count + unioned taxonomy. carries the taxonomic fields so the
 *  existing relation builders (genre / tag / mood / style / era /
 *  label) connect artist nodes to album nodes (and to other artist /
 *  hub nodes) using one set of code paths.
 *
 *  TODO(phase-13): split into a proper discriminated union with
 *  per-role variants so the `as ArtistNodeData` casts in canvas /
 *  view code can become exhaustive switches. tracked in
 *  `docs/graph-viz-evolution-plan.md`. */
export interface ArtistNodeData {
  /** namespaced id: `artist::${artistId}`. avoids collision with
   *  album node ids which use `${remoteId}::${albumId}`. */
  id: string;
  kind: "artist";
  /** local artist id; matches `AlbumNodeData.artistId`. */
  artistId: string;
  name: string;
  /** 2–3 char fallback for the avatar tile (see getArtistAbbreviation). */
  abbreviation: string;
  /** absolute or remote url for the artist thumbnail; null = render
   *  acronym tile. */
  imageUrl: string | null;
  /** full image metadata for canonical resolution via the blob
   *  resolver. null when no image is known yet. */
  image: ImageMetadata | null;
  /** number of in-library albums attributed to this artist. used for
   *  the bottom-right status chip and (optionally) for sizing. */
  albumCount: number;

  // unioned taxonomy from the artist's albums — drives relation edges
  // identically to album nodes. de-duplicated, no ordering guarantee.
  genres: string[];
  tags: TagRef[];
  moods: string[];
  styles: string[];
  /** most common label across the artist's albums, or null. */
  label: string | null;
  /** most common 5-year era across the artist's albums, or null. */
  era: string | null;
  /** user-defined taxon kinds unioned from the artist's albums. kind_slug -> labels[]. */
  customTaxons: Record<string, string[]>;

  /** whether the user has favorited this artist. populated by the
   *  view layer from the favorites feed; relations.ts reads it to
   *  include artists in the `favorite` chain alongside albums. */
  isFavorite?: boolean;

  /** every remote that contributed to this (potentially merged) artist.
   *  unioned across the contributing albums by `deriveArtistNodes`.
   *  unset on legacy mocked data. use `belongsToRemote(node, remoteId)`
   *  for membership checks. */
  sourceRemoteIds?: string[];
}

/** node union as carried through the graph pipeline. */
export type GraphNodeData = AlbumNodeData | ArtistNodeData;

/** alias for `ArtistNodeData` that better reflects its current
 *  scope (true artists + the three hub silhouettes). prefer this
 *  name in new code; the legacy name stays exported for back-compat
 *  while the wider rename in phase 13 is in flight. */
export type HubOrArtistNodeData = ArtistNodeData;

/** helper: extract the node kind, defaulting to `"album"` for legacy
 *  AlbumNodeData rows that pre-date the discriminator. */
export function nodeKind(n: GraphNodeData): NodeKind {
  return (n as ArtistNodeData).kind === "artist" ? "artist" : "album";
}

/** membership check used by per-remote filters. handles both the
 *  modern `sourceRemoteIds` field and the legacy single-id field. */
export function belongsToRemote(
  n: AlbumNodeData | ArtistNodeData,
  remoteId: string
): boolean {
  const ids = n.sourceRemoteIds;
  if (ids && ids.length > 0) return ids.includes(remoteId);
  return (n as AlbumNodeData).sourceRemoteId === remoteId;
}

/** node as carried through d3-force; gets mutable x/y/vx/vy assigned by sim */
export type GraphNode = (AlbumNodeData | ArtistNodeData) & {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
};

export interface GraphEdge {
  /** node id at construction; d3-force replaces with node ref after init */
  source: string | GraphNode;
  target: string | GraphNode;
  kind: RelationKindLike;
  /** 0..1 — used as link strength + visual alpha */
  weight: number;
  /** optional human label (the shared value, e.g. "rock") */
  label?: string;
}

export type NodeState = "idle" | "hover" | "selected" | "dimmed";

export interface ViewportTransform {
  /** translate x in css pixels */
  tx: number;
  /** translate y in css pixels */
  ty: number;
  /** scale factor; 1 = identity */
  k: number;
}

// ---- walk explorer types (graph2 / bloom-walker stack) ---------------------

export type NodeRole =
  | "root"
  | "remote"
  | "relation"
  | "value"
  | "group"
  | "artist"
  | "album"
  | "ghost_artist";

export interface WalkNode {
  id: string;
  role: NodeRole;
  label: string;
  /** direct parent id in the walk tree. null only for the virtual root. */
  parentId: string | null;
  /** for hub nodes (root/remote/relation/value): # of direct children.
   *  drives proportional size scaling. */
  childCount: number;
  /** when true, this hub's children are loaded lazily on pivot rather than
   *  pre-populated by buildWalkGraph. skips the zero-childCount visibility
   *  filter so the hub remains visible before expansion. */
  lazy?: boolean;
  /** optional hex color override for node fill (e.g. taxon kind colors). */
  tint?: string;
  /** true when this node represents a charnel-managed remote (the local
   *  sidecar). drawn with a home-icon glyph next to its label so it's
   *  visually distinguishable from federated remotes. only meaningful
   *  when `role === "remote"`. */
  isCharnelManaged?: boolean;
}

export interface WalkEdge {
  source: string;
  target: string;
  /** true when this edge represents a "related artist" relationship
   *  harvested from related_artistz (lastfm / audiodb / mb). drawn in a
   *  dedicated color with a mid-edge "related artist" label by the
   *  canvas renderer. */
  isRelatedArtist?: boolean;
  /** true when the underlying related-artist row is in `pending` review
   *  status (proposed but not yet accepted). drawn dashed + dimmed so
   *  the user can tell it apart from confirmed relations. only
   *  meaningful alongside `isRelatedArtist`. */
  isPending?: boolean;
}

export interface WalkGraph {
  nodes: WalkNode[];
  edges: WalkEdge[];
}
