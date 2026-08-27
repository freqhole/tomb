// shared node radius lookup. consumed by:
//   - WalkCanvas: hit-test, label placement, drag handles, ring sizes.
//   - walkerSim (worker): SimNode.radius initialization.
// keeping this in one place avoids the layout-vs-render mismatch
// where the simulator packed nodes assuming small radii while the
// renderer drew much larger shapes, causing overlap + ambiguous
// hit-test.

import type { NodeRole } from "./types";

export function nodeDisplayRadius(role: NodeRole, childCount: number): number {
  switch (role) {
    case "root":
      return 34;
    case "remote":
      return 28 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "relation":
      return 20 + Math.min(Math.sqrt(childCount) * 4, 20);
    case "value":
      return 14 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "group":
      return 24 + Math.min(Math.sqrt(childCount) * 3.5, 22);
    // artists grow with album count, mirroring the worker's layout-side
    // nodeRadius (walkerHelpers.ts) so the simulator's spacing decisions
    // match what actually gets drawn — previously this returned a flat
    // 27 while the worker already scaled up to 51 for big catalogs.
    case "artist":
      return 32 + Math.min(Math.sqrt(Math.max(0, childCount - 3)) * 5, 24);
    case "album":
      return 20;
    case "video":
      return 23;
    case "video_season":
      return 25 + Math.min(Math.sqrt(Math.max(0, childCount - 3)) * 3, 14);
    case "video_series":
      // sits just above the season tier, not as big as artist/remote.
      return 24 + Math.min(Math.sqrt(Math.max(0, childCount - 3)) * 2.5, 12);
    default:
      return 14;
  }
}
