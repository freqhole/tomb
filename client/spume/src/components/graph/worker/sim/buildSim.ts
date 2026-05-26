// buildSim \u2014 constructs the d3-force simulation from the worker's
// current node/link snapshot.
//
// design note (phase 1 reset, 2026-05-26):
// this file used to wire up 10 forces (link, charge, center,
// gravityX, gravityY, hubDirX, hubDirY, entityDirX, entityDirY,
// collide) with ~23 tuning overrides feeding a per-hub angular
// ring layout and per-leaf wedge outward pulls. that hand-tuned
// scaffold fought d3's emergent layout instead of cooperating
// with it \u2014 the canvas looked visibly better when the d3 button
// disabled every custom force. the directional ring + entity
// wedge math worked for small static graphs but compressed and
// stuck on dynamic topologies (drilldowns adding/removing whole
// subtrees), so the whole prescriptive layout layer was deleted.
//
// the new shape is the d3 default plus three small additions:
// 1. per-class charge multipliers (hubs repel less than leaves so
//    relation hexagons + value octagons stay near their parents).
// 2. per-class collide radii (hub silhouettes are larger).
// 3. weak optional center gravity (fallback for lightly-linked
//    nodes that would otherwise drift off-canvas).
//
// tuning happens through five live overrides only (linkDistanceMul,
// chargePerNodeSize, velocityDecay, alphaDecay, centerGravityStrength).
// see `docs/graph-reset-plan.md` for the full diagnosis.

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
  HUB_COLLIDE_PADDING_MUL,
  LEAF_COLLIDE_RADIUS_MUL,
  LINK_DISTANCE_NODE_SIZE_MUL,
  SIM_COOLDOWN,
} from "../forceTuning";
import type { SimConfig, TuningOverrides } from "../messages";
import type { SimLink, SimNode } from "./types";

// phase 2.5 (2026-05-26): dropped the densityMul piecewise multiplier
// and the custom link-strength override. link strength now uses d3's
// stock degree-aware default (1/sqrt(min(deg(src),deg(tgt)))), which
// is exactly the mechanism that gives tree-like radial spread without
// any extra blending or weight-curve math.

export interface BuildSimDeps {
  /** live sim-node array (caller owns; we pass it straight to d3). */
  nodes: SimNode[];
  /** live sim-link array (caller owns). */
  links: SimLink[];
  /** current layout config (viewport size, node size). */
  config: SimConfig;
  /** per-relation strength override map. retained on the message
   *  protocol for back-compat but no longer consulted here. */
  relationStrengths?: Record<string, number>;
  /** debug: live tuning overrides from the main thread. fields
   *  present here shadow the compiled-in defaults. */
  tuningOverrides?: TuningOverrides;
  /** invoked on every d3-force tick. */
  onTick: () => void;
}

export function buildSimulation(deps: BuildSimDeps): Simulation<SimNode, SimLink> {
  const { nodes, links, config, tuningOverrides: ov = {}, onTick } = deps;

  // resolve the five live-tunable knobs.
  const linkDistanceMul = ov.linkDistanceMul ?? LINK_DISTANCE_NODE_SIZE_MUL;
  const chargePerNodeSize = ov.chargePerNodeSize ?? CHARGE_PER_NODE_SIZE;
  const velocityDecay = ov.velocityDecay ?? SIM_COOLDOWN.velocityDecay;
  const alphaDecay = ov.alphaDecay != null && ov.alphaDecay > 0 ? ov.alphaDecay : null;
  const centerGravity = ov.centerGravityStrength ?? 0;

  const sz = config.nodeSize;

  const linkDist = sz * linkDistanceMul;
  const chargeStr = sz * chargePerNodeSize;

  // collide radii: leaves at a fraction of node size, hubs scaled by
  // their peer-group child count (sqrt curve via hubSizeMul).
  const leafRadius = sz * LEAF_COLLIDE_RADIUS_MUL;
  let maxHubCount = 0;
  for (const n of nodes) {
    if (n.kind !== "hub") continue;
    const c = (n.albumCount ?? 0) as number;
    if (c > maxHubCount) maxHubCount = c;
  }
  function hubCollideRadius(n: SimNode): number {
    const c = (n.albumCount ?? 0) as number;
    const mul = hubSizeMul(c, maxHubCount);
    return (sz * mul) / 2 + sz * HUB_COLLIDE_PADDING_MUL;
  }

  const sim = forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(linkDist),
      // no .strength() \u2014 d3 default is 1 / sqrt(min(deg(src),deg(tgt))),
      // which naturally weakens hub-to-leaf springs so leaves fan out
      // radially under uniform charge.
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength(chargeStr),
    )
    .force("center", forceCenter(config.width / 2, config.height / 2))
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((n) => {
          if (n.kind === "hub") return hubCollideRadius(n);
          if (n.kind === "album" && n.matchedByDrill === false) {
            // contextual drill-halo albums render at 0.7\u00d7 visual size;
            // give them a proportionally smaller collide footprint.
            return leafRadius * 0.7;
          }
          return leafRadius;
        }),
      // stock forceCollide: strength=1 (default), iterations=1 (default).
      // the old 2\u20133 iteration boost was a perf workaround for huge
      // graphs that we no longer render.
    );

  // optional weak per-node forceX/Y toward the canvas centre.
  // counteracts drift for nodes with few or no links. off by default;
  // the live tuning panel can turn it on (0.02\u20130.04 is a noticeable
  // bias without overriding link/charge layout).
  if (centerGravity > 0) {
    sim.force("gravityX", forceX<SimNode>(config.width / 2).strength(centerGravity));
    sim.force("gravityY", forceY<SimNode>(config.height / 2).strength(centerGravity));
  }

  sim
    .alphaDecay(alphaDecay ?? SIM_COOLDOWN.alphaDecay)
    .alphaMin(SIM_COOLDOWN.alphaMin)
    .velocityDecay(velocityDecay);

  sim.on("tick", onTick);

  return sim;
}
