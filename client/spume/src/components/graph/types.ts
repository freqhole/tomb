// graph2/types.ts — re-exports from the merged graph/types.ts.
// after the phase-8 rename (graph2 → graph) this shim is replaced by
// the full types.ts. all internal graph2 imports of this file continue
// to resolve correctly both before and after the rename.

export type {
  NodeRole,
  WalkNode,
  WalkEdge,
  WalkGraph,
  AlbumNodeData,
  ArtistNodeData,
  TagRef,
  GraphNodeData,
  RelationKindLike,
  NodeState,
} from "../../graph/types";
