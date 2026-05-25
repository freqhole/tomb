// hubDirectional — pure layout helpers for the worker's
// hub-anchoring forceX/forceY ring.
//
// extracted from `graphWorker.ts` as the first slice of the
// worker decomposition (phase 12). these helpers compute the
// stable angular slot + outward-radius factor for each synthetic
// hub id, so the sim can pull remote / relation / value hubs to
// their own region of the canvas instead of letting them stack on
// the root cluster.
//
// the angles MUST stay in lockstep with the main thread's
// `canvas/seedGrouping.ts → hubLaneOffset()` so the phyllotaxis
// seed and the steady-state directional pull agree (otherwise
// hubs would jump on the first tick). the duplicated fnv-1a hash
// here is intentional: workers are bundled separately and we
// want the worker bundle to stay free of main-thread imports.

import { HUB_DIRECTIONAL } from "../forceTuning";

/** stable fnv-1a hash → unsigned 32-bit int. determinism across
 *  platforms is the only contract; collision rate is fine because
 *  we immediately quantize to 360 buckets. */
export function fnv1aHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** map a string to a stable angle in radians in [0, 2π). */
export function hashAngleRad(s: string): number {
  return ((fnv1aHash(s) % 360) / 360) * Math.PI * 2;
}

/** classify a hub id into its angle source + relative radius
 *  factor + directional spring strength. returns null for non-hub
 *  nodes (leaves curl back to center via the normal forceCenter /
 *  link pull).
 *
 *  layout zones:
 *  - remote hub: outer ring at angle("remote::<id>"), radiusFactor 1.0
 *  - relation hub: SAME angle + SAME radius as its parent remote,
 *    so the kind hexagons cluster tightly around their triangle.
 *    link springs + collide pick the exact arrangement; identical
 *    directional targets keep them from drifting away.
 *  - value hub: pushed OUTSIDE the remote ring (factor 1.3) along
 *    an angle hashed on the full id so siblings spread around the
 *    outer canvas instead of stacking on a shared kind angle. lets
 *    the sub-relation chain expand into empty space without curling
 *    back through the root cluster.
 *
 *  hub-id prefix strings are inlined (rather than imported from
 *  `../hubNodes`) to keep the worker bundle self-contained — the
 *  prefix grammar is part of the message contract between threads,
 *  not the worker's internal representation. */
export function hubDirectional(
  id: string,
): { angle: number; radiusFactor: number; strength: number } | null {
  if (id.startsWith("hub_remote::")) {
    const remoteId = id.slice("hub_remote::".length);
    return {
      angle: hashAngleRad("remote::" + remoteId),
      radiusFactor: HUB_DIRECTIONAL.remote.radiusFactor,
      strength: HUB_DIRECTIONAL.remote.strength,
    };
  }
  if (id.startsWith("hub_relation::")) {
    const rest = id.slice("hub_relation::".length);
    const sep = rest.indexOf("::");
    const remoteId = sep >= 0 ? rest.slice(0, sep) : rest;
    return {
      angle: hashAngleRad("remote::" + remoteId),
      radiusFactor: HUB_DIRECTIONAL.relation.radiusFactor,
      strength: HUB_DIRECTIONAL.relation.strength,
    };
  }
  if (id.startsWith("hub_relation_value::")) {
    return {
      angle: hashAngleRad("value::" + id),
      radiusFactor: HUB_DIRECTIONAL.relationValue.radiusFactor,
      strength: HUB_DIRECTIONAL.relationValue.strength,
    };
  }
  return null;
}

/** deterministic wedge fraction in (-1, +1] for a leaf id. siblings
 *  sharing a parent hub angle use this to spread within the wedge
 *  instead of stacking on a single outward target. uses the same
 *  fnv-1a hash as `hashAngleRad` for determinism across runs +
 *  platforms; the mod-1000 bucket gives sufficient angular
 *  resolution for the wedge widths phase 20 cares about. */
export function leafWedgeFraction(leafId: string): number {
  return ((fnv1aHash(leafId) % 1000) / 999) * 2 - 1;
}

/** outward angle for an entity leaf anchored to a parent hub. fans
 *  the leaf into the wedge centred on the parent hub's directional
 *  angle, with deterministic per-leaf offset so siblings spread
 *  evenly. pure: no force-tuning import on purpose so callers can
 *  pass their own wedge width when experimenting. */
export function outwardAngleFor(
  leafId: string,
  hubAngle: number,
  wedgeHalfRad: number,
): number {
  return hubAngle + leafWedgeFraction(leafId) * wedgeHalfRad;
}
