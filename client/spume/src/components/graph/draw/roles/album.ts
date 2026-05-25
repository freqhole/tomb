// album role — squares with album-art image fill and bottom title
// chip. the heavy lifting still lives in `drawAlbumNode.ts` (which
// has its own self-contained image / chip / marquee pipeline and
// doesn't share the hub-frame scaffolding); this file is the
// role-keyed entry point for the dispatch in `draw/drawNode.ts`
// and the home for the per-role hit-radius factor.

export { drawAlbumNode as drawAlbum } from "../../drawAlbumNode";
export type { DrawAlbumNodeArgs as DrawAlbumArgs } from "../../drawAlbumNode";

// per-role hit-test inradius factor. albums use 0.55 rather than
// the geometric inradius (0.5) so the diagonal corners of an
// axis-aligned square still register as hits — a square that
// renders to size×size occupies a disc of radius sz*√2/2 ≈
// 0.707*sz from center along its diagonal, so 0.55 strikes a
// balance between catching corner clicks and keeping the hit area
// inside the visible silhouette for non-diagonal pointers.
export const HIT_INRADIUS_FACTOR = 0.55;
