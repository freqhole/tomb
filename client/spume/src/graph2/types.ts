// graph2/types.ts — core types for the greenfield graph walker.
// kept separate from src/components/graph/* on purpose.

export type NodeRole = "root" | "remote" | "relation" | "value" | "artist" | "album";

export interface WalkNode {
  id: string;
  role: NodeRole;
  label: string;
  /** direct parent id in the walk tree. null only for the virtual root. */
  parentId: string | null;
  /** for hub nodes (root/remote/relation/value): # of direct children.
   *  drives proportional size scaling. */
  childCount: number;
  /** optional thumbnail url — used for artist/album circle nodes */
  imageUrl?: string;
}

export interface WalkEdge {
  source: string;
  target: string;
}

export interface WalkGraph {
  nodes: WalkNode[];
  edges: WalkEdge[];
}
