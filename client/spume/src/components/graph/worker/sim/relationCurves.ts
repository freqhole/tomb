// relationCurves — pure mapping from a relation kind to its link
// distance + strength multiplier.
//
// extracted from `graphWorker.ts` as the second worker slice
// (phase 12). taking the per-kind `relationStrengths` table as an
// explicit argument keeps these helpers pure + unit-testable; the
// worker still owns the module-level mutable map and just passes it
// through on each call.
//
// kind handling note: today the fallback branch hardcodes a few
// well-known kinds (`artist_album`, `same_artist`, `favorite`,
// `related_artist`, `tag`). this is part of the broader
// open-ended-kind audit tracked in phase 18 — when that lands, this
// file becomes the obvious home for the kind-agnostic fallback.

import { RELATION_CURVE } from "../forceTuning";

/** look up the user-tunable strength for a kind, clamped to [0, 1],
 *  falling back to baked-in defaults for well-known kinds when the
 *  table omits them. */
export function relationStrengthValue(
  kind: string | undefined,
  relationStrengths: Record<string, number> | undefined,
): number {
  if (!kind) return 0.5;
  const raw = relationStrengths?.[kind];
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    if (kind === "artist_album") return 1;
    if (kind === "same_artist") return 1;
    if (kind === "favorite") return 0.82;
    if (kind === "related_artist") return 0.78;
    if (kind === "tag") return 0.22;
    return 0.5;
  }
  return Math.max(0, Math.min(1, raw));
}

/** multiplier applied to a link's target distance.
 *  non-linear curve gives strong "full lock-in" at high strengths
 *  while preserving granularity at the low end. */
export function relationDistanceMultiplier(
  kind: string | undefined,
  relationStrengths: Record<string, number> | undefined,
): number {
  const s = relationStrengthValue(kind, relationStrengths);
  const e = Math.pow(s, RELATION_CURVE.distance.exponent);
  return RELATION_CURVE.distance.base - e * RELATION_CURVE.distance.slope;
}

/** multiplier applied to a link's spring strength. companion to
 *  the distance curve — strong kinds get both a shorter rest length
 *  and a stiffer spring. */
export function relationStrengthMultiplier(
  kind: string | undefined,
  relationStrengths: Record<string, number> | undefined,
): number {
  const s = relationStrengthValue(kind, relationStrengths);
  const e = Math.pow(s, RELATION_CURVE.strength.exponent);
  return RELATION_CURVE.strength.base + e * RELATION_CURVE.strength.slope;
}
