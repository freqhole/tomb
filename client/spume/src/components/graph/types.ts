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
  | "favorite";

// allow arbitrary user-defined taxon keys (e.g. "vibe", "decade") while
// preserving autocomplete for the well-known set above.
// eslint-disable-next-line @typescript-eslint/ban-types
export type RelationKindLike = RelationKind | (string & {});

export interface AlbumNodeData {
  id: string;
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

  // graph relations
  relatedArtistIds: string[];

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

/** node as carried through d3-force; gets mutable x/y/vx/vy assigned by sim */
export interface GraphNode extends AlbumNodeData {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

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
