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
      return 14;
    case "remote":
      return 28 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "relation":
      return 20 + Math.min(Math.sqrt(childCount) * 4, 20);
    case "value":
      return 14 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "group":
      return 24 + Math.min(Math.sqrt(childCount) * 3.5, 22);
    case "artist":
      return 27;
    case "album":
      return 16;
    default:
      return 14;
  }
}
