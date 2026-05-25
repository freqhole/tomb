// collideRadii — pure density-aware collide-radius helpers.
//
// extracted from `graphWorker.ts` as the fourth worker slice
// (phase 12). these functions decide how much "personal space"
// each node demands in the d3 collide force based on the total
// node count, so dense libraries don't crush every label into
// every other label.
//
// thresholds + multipliers are intentionally inlined (matching the
// pre-extraction behaviour). promoting them to `forceTuning.ts`
// is a separate, larger tuning pass.

/** density multiplier that scales with library size. tiered so the
 *  curve only kicks in once a library is large enough to actually
 *  feel cramped — sub-700-node graphs use the natural collide
 *  radius unchanged. */
export function densityMultiplierForCount(nCount: number): number {
  if (nCount >= 4000) return 2.2;
  if (nCount >= 3000) return 1.95;
  if (nCount >= 2000) return 1.7;
  if (nCount >= 1200) return 1.45;
  if (nCount >= 700) return 1.24;
  return 1;
}

/** per-role collide radii. albums get more breathing room than
 *  artist nodes because they carry visible cover art. the 0.9
 *  damping factor on the density bump lets nodes still cluster
 *  visibly while preventing label overlap explosions on huge
 *  libraries. base radii bumped 2026-05-25 (album 0.82 → 0.96,
 *  artist 0.6 → 0.74) so small drilldown subgraphs stop
 *  overlapping each other under the tighter post-tuning link
 *  distance. density tier still scales these for big graphs. */
export function collideRadiiForCount(
  nCount: number,
  sz: number,
): { album: number; artist: number } {
  const densityMul = densityMultiplierForCount(nCount);
  const collideDensityMul = 1 + (densityMul - 1) * 0.9;
  return {
    album: sz * 0.96 * collideDensityMul,
    artist: sz * 0.74 * collideDensityMul,
  };
}
