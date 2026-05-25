// per-role hit-test inradius factors. each role module declares
// its own `HIT_INRADIUS_FACTOR` constant alongside its draw fn so
// silhouette + hit area stay in lockstep (phase 16). this file
// consolidates them into a single dispatchable record + helper
// used by the canvas hit-test path.
//
// values match the historical inradius factors that lived as
// inline constants inside `effectiveHitRadius` in `GraphCanvas.tsx`:
//   - album square: 0.55 (slightly outside the inscribed-circle of
//     a square, so the diagonal corners are still clickable)
//   - artist circle: 0.5 (true inradius — radius is half the edge)
//   - remote hub (wonky triangle): 0.42 (much narrower silhouette
//     than the bounding box, so a smaller hit-disc avoids "phantom"
//     clicks on empty corners)
//   - relation / value hubs (hex / octagon): 0.5 — close enough to
//     the inscribed-circle radius for both shapes that a single
//     value works.

import { HIT_INRADIUS_FACTOR as ALBUM } from "../roles/album";
import { HIT_INRADIUS_FACTOR as ARTIST } from "../roles/artist";
import { HIT_INRADIUS_FACTOR as RELATION_HUB } from "../roles/relationHub";
import { HIT_INRADIUS_FACTOR as RELATION_VALUE_HUB } from "../roles/relationValueHub";
import { HIT_INRADIUS_FACTOR as REMOTE_HUB } from "../roles/remoteHub";
import type { NodeRole } from "./roleDispatch";

export const HIT_INRADIUS_FACTOR: Record<NodeRole, number> = {
  album: ALBUM,
  artist: ARTIST,
  remoteHub: REMOTE_HUB,
  relationHub: RELATION_HUB,
  relationValueHub: RELATION_VALUE_HUB,
};

/** convert a node `size` (world-space edge length / diameter) to
 *  the per-role hit radius. */
export function hitRadiusFor(role: NodeRole, size: number): number {
  return size * HIT_INRADIUS_FACTOR[role];
}
