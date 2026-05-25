// buildSim — extracted from graphWorker.ts (phase 12, the final big
// slice of the worker decomposition). takes the current sim node +
// link snapshots, the live config, and the helpers that need to
// close over the worker's relationStrengths table + post / tick
// hooks; returns a freshly-constructed d3-force simulation that the
// caller stores on its own module state. no behaviour change vs.
// the inlined version — every distance/strength/charge expression is
// preserved bit-for-bit so the cool-down profile stays identical.

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { hubSizeMul } from "../../hubSize";
import {
  CHARGE_PER_NODE_SIZE,
  ENTITY_OUTWARD,
  HUB_COLLIDE_PADDING_MUL,
  HUB_LINK_DISTANCE_MUL,
  HUB_RING_RADIUS,
  LINK_DISTANCE_NODE_SIZE_MUL,
  LINK_STRENGTH_CURVE,
  RELATION_HUB_CHARGE_MUL,
  REMOTE_HUB_LINK_STRENGTH_BUMP,
  SIM_COOLDOWN,
  VALUE_HUB_CHARGE_MUL,
} from "../forceTuning";
import { hubDirectional, outwardAngleFor } from "./hubDirectional";
import * as relCurves from "./relationCurves";
import {
  endpointCountDistanceShrink,
  endpointCountStrengthBoost,
} from "./endpointCountTuning";
import {
  collideRadiiForCount,
  densityMultiplierForCount,
} from "./collideRadii";
import type { SimConfig } from "../messages";
import type { SimLink, SimNode } from "./types";

export interface BuildSimDeps {
  /** live sim-node array (caller owns; we pass it straight to d3). */
  nodes: SimNode[];
  /** live sim-link array (caller owns). */
  links: SimLink[];
  /** current layout config (viewport size, node size). */
  config: SimConfig;
  /** per-relation strength override map (kind → multiplier). */
  relationStrengths: Record<string, number> | undefined;
  /** invoked on every d3-force tick. */
  onTick: () => void;
}

export function buildSimulation(deps: BuildSimDeps): Simulation<SimNode, SimLink> {
  const { nodes, links, config, relationStrengths, onTick } = deps;

  const sz = config.nodeSize;
  // dense libraries pile nodes on top of each other even with collide
  // enabled, because link + charge balance was tuned for smaller
  // graphs. scale spacing much more aggressively once we cross
  // 1k+ nodes so large datasets stay readable.
  const nCount = nodes.length;
  const densityMul = densityMultiplierForCount(nCount);
  // link distance: target spacing between connected nodes. raise this
  // as datasets grow so local clusters do not collapse into one blob.
  const linkDist = sz * LINK_DISTANCE_NODE_SIZE_MUL * densityMul;
  // link strength: on huge graphs, reduce spring pull so links do not
  // overpower collide/charge and crush spacing back down.
  const linkStrengthMul =
    nCount >= 3500 ? 0.55 : nCount >= 2500 ? 0.62 : nCount >= 1500 ? 0.72 : nCount >= 700 ? 0.84 : 1;
  // charge: long-range mutual repulsion. stronger at higher density so
  // disconnected regions still push apart instead of stacking.
  const chargeStr = sz * CHARGE_PER_NODE_SIZE * densityMul;
  // hub charges (see graphWorker history for derivation).
  const relationHubChargeStr = chargeStr * RELATION_HUB_CHARGE_MUL;
  const valueHubChargeStr = chargeStr * VALUE_HUB_CHARGE_MUL;
  const collide = collideRadiiForCount(nCount, sz);

  let maxHubCount = 0;
  for (const n of nodes) {
    if (typeof n.id !== "string" || !n.id.startsWith("hub_")) continue;
    const c = (n.albumCount ?? 0) as number;
    if (c > maxHubCount) maxHubCount = c;
  }
  function hubCollideRadius(n: SimNode): number {
    const c = (n.albumCount ?? 0) as number;
    const mul = hubSizeMul(c, maxHubCount);
    return (sz * mul) / 2 + sz * HUB_COLLIDE_PADDING_MUL;
  }

  function relationDistanceMultiplier(kind: string | undefined): number {
    return relCurves.relationDistanceMultiplier(kind, relationStrengths);
  }
  function relationStrengthMultiplier(kind: string | undefined): number {
    return relCurves.relationStrengthMultiplier(kind, relationStrengths);
  }

  // phase 20 — radial / conical entity fan-out.
  //
  // for every non-hub leaf, find its strongest hub-parent (the
  // highest-weight link connecting it to any `hub_*` node) and
  // compute a per-leaf outward target on a wedge centred on the
  // parent hub's directional angle. siblings sharing a parent
  // hub spread within the wedge via `outwardAngleFor`, so the
  // entity tier fans open into the canvas instead of curling
  // back through the root cluster.
  //
  // built once per `buildSimulation` call (i.e. once per topology
  // change) and closed over by the entity directional forces
  // below so per-tick lookup is a single Map.get.
  const leafOutward = new Map<
    string,
    { angle: number; radiusFactor: number; strength: number }
  >();
  {
    // pick the strongest hub link per leaf. links are still
    // string-keyed at this point (d3-force replaces them with
    // node refs only after sim construction).
    const bestHubLink = new Map<string, { hubId: string; weight: number }>();
    for (const l of links) {
      const srcId =
        typeof l.source === "object" && l.source !== null
          ? (l.source as SimNode).id
          : (l.source as string);
      const tgtId =
        typeof l.target === "object" && l.target !== null
          ? (l.target as SimNode).id
          : (l.target as string);
      const srcHub = typeof srcId === "string" && srcId.startsWith("hub_");
      const tgtHub = typeof tgtId === "string" && tgtId.startsWith("hub_");
      // only leaf↔hub links contribute; hub↔hub edges are wired
      // through the existing hubDirectional ring.
      if (srcHub === tgtHub) continue;
      const leafId = srcHub ? (tgtId as string) : (srcId as string);
      const hubId = srcHub ? (srcId as string) : (tgtId as string);
      const weight = (l.weight as number | undefined) ?? 0.5;
      const cur = bestHubLink.get(leafId);
      if (!cur || weight > cur.weight) bestHubLink.set(leafId, { hubId, weight });
    }
    for (const [leafId, { hubId }] of bestHubLink) {
      const hubDir = hubDirectional(hubId);
      if (!hubDir) continue;
      const angle = outwardAngleFor(leafId, hubDir.angle, ENTITY_OUTWARD.wedgeHalfAngleRad);
      leafOutward.set(leafId, {
        angle,
        radiusFactor: ENTITY_OUTWARD.radiusFactor,
        strength: ENTITY_OUTWARD.strength,
      });
    }
  }

  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          const srcId =
            typeof l.source === "object" && l.source !== null
              ? (l.source as SimNode).id
              : (l.source as string);
          const tgtId =
            typeof l.target === "object" && l.target !== null
              ? (l.target as SimNode).id
              : (l.target as string);
          const srcHub = typeof srcId === "string" && srcId.startsWith("hub_");
          const tgtHub = typeof tgtId === "string" && tgtId.startsWith("hub_");
          const srcRemote = typeof srcId === "string" && srcId.startsWith("hub_remote::");
          const tgtRemote = typeof tgtId === "string" && tgtId.startsWith("hub_remote::");
          const hubMul =
            srcHub && tgtHub
              ? srcRemote || tgtRemote
                ? HUB_LINK_DISTANCE_MUL.remoteToRelation
                : HUB_LINK_DISTANCE_MUL.kindToKind
              : 1;
          return linkDist * relationDistanceMultiplier(l.kind) * hubMul * endpointCountDistanceShrink(l);
        })
        .strength((l) => {
          const srcId =
            typeof l.source === "object" && l.source !== null
              ? (l.source as SimNode).id
              : (l.source as string);
          const tgtId =
            typeof l.target === "object" && l.target !== null
              ? (l.target as SimNode).id
              : (l.target as string);
          const srcRemote = typeof srcId === "string" && srcId.startsWith("hub_remote::");
          const tgtRemote = typeof tgtId === "string" && tgtId.startsWith("hub_remote::");
          // remote↔kind-hub edges get a much stronger spring so the
          // half-dozen relation hexagons per remote stay glued to
          // their wonky triangle instead of drifting toward the
          // shared value-hub cluster.
          const hubStrengthBump =
            srcRemote || tgtRemote ? REMOTE_HUB_LINK_STRENGTH_BUMP : 1;
          return (
            (LINK_STRENGTH_CURVE.base +
              LINK_STRENGTH_CURVE.slope * ((l.weight ?? 0.5) as number)) *
            linkStrengthMul *
            relationStrengthMultiplier(l.kind) *
            hubStrengthBump *
            endpointCountStrengthBoost(l)
          );
        }),
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength((n) => {
        const id = n.id;
        if (typeof id !== "string") return chargeStr;
        if (id.startsWith("hub_relation::")) return relationHubChargeStr;
        if (id.startsWith("hub_relation_value::")) return valueHubChargeStr;
        return chargeStr;
      }),
    )
    .force("center", forceCenter(config.width / 2, config.height / 2))
    .force(
      "hubDirX",
      forceX<SimNode>()
        .x((n) => {
          if (typeof n.id !== "string") return config.width / 2;
          const d = hubDirectional(n.id);
          if (!d) return config.width / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.width / 2 + baseR * d.radiusFactor * Math.cos(d.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return hubDirectional(n.id)?.strength ?? 0;
        }),
    )
    .force(
      "hubDirY",
      forceY<SimNode>()
        .y((n) => {
          if (typeof n.id !== "string") return config.height / 2;
          const d = hubDirectional(n.id);
          if (!d) return config.height / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.height / 2 + baseR * d.radiusFactor * Math.sin(d.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return hubDirectional(n.id)?.strength ?? 0;
        }),
    )
    // phase 20 — per-leaf outward bias toward the parent hub's
    // wedge. paired forceX / forceY so the leaf is gently pulled
    // to (centre + radius * cos/sin(outwardAngle)); collide +
    // link still own the local pixel-perfect arrangement.
    .force(
      "entityDirX",
      forceX<SimNode>()
        .x((n) => {
          if (typeof n.id !== "string") return config.width / 2;
          const o = leafOutward.get(n.id);
          if (!o) return config.width / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.width / 2 + baseR * o.radiusFactor * Math.cos(o.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return leafOutward.get(n.id)?.strength ?? 0;
        }),
    )
    .force(
      "entityDirY",
      forceY<SimNode>()
        .y((n) => {
          if (typeof n.id !== "string") return config.height / 2;
          const o = leafOutward.get(n.id);
          if (!o) return config.height / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.height / 2 + baseR * o.radiusFactor * Math.sin(o.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return leafOutward.get(n.id)?.strength ?? 0;
        }),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((n) => {
          if (n.kind === "album") return collide.album;
          if (typeof n.id === "string" && n.id.startsWith("hub_"))
            return hubCollideRadius(n);
          return collide.artist;
        })
        .strength(1)
        .iterations(nCount >= 4000 ? 28 : nCount >= 3000 ? 24 : nCount >= 2000 ? 20 : nCount >= 1200 ? 16 : nCount >= 700 ? 12 : 8),
    )
    .alphaDecay(nCount >= 3500 ? 0.021 : nCount >= 2500 ? 0.023 : nCount >= 1500 ? 0.028 : nCount >= 700 ? 0.037 : 0.05)
    .alphaMin(SIM_COOLDOWN.alphaMin)
    .velocityDecay(SIM_COOLDOWN.velocityDecay);

  sim.on("tick", onTick);

  return sim;
}
