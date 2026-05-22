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
  /** artist node connected to one of its in-library albums */
  | "artist_album";

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

  // sugar
  trackCount: number;
  totalDurationSec: number;
  rating?: number | null;
  isFavorite?: boolean;
  /** which remote contributed this album. null = mocked / single-remote
   *  story. set by the adapter so multi-remote views can disambiguate. */
  sourceRemoteId?: string | null;
}

export interface TagRef {
  label: string;
  /** 0..1 normalized weight (folksonomy count, lastfm weight, etc.) */
  weight: number;
}

/** circle-avatar artist node. derived client-side from the unique
 *  artists across the loaded album set; appears alongside album nodes
 *  in the graph when the content-kind selector is set to `artists` or
 *  `both`. carries unioned taxonomic fields so the existing relation
 *  builders (genre / tag / mood / style / era / label) connect artist
 *  nodes to album nodes (and to other artist nodes) using the same
 *  visual + interaction language. */
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

  /** artist nodes are never marked as favorite (no per-artist favorite
   *  signal yet). field exists so buildRelationEdges can read it
   *  uniformly across the union. */
  isFavorite?: boolean;
}

/** node union as carried through the graph pipeline. */
export type GraphNodeData = AlbumNodeData | ArtistNodeData;

/** helper: extract the node kind, defaulting to `"album"` for legacy
 *  AlbumNodeData rows that pre-date the discriminator. */
export function nodeKind(n: GraphNodeData): NodeKind {
  return (n as ArtistNodeData).kind === "artist" ? "artist" : "album";
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
