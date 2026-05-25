// shared sim-side types for the graph worker simulation. previously
// these lived as private aliases inside `graphWorker.ts`; pulled out
// to a sibling module so the sim helpers (buildSim, etc.) can refer
// to the same nominal types without circular imports.

import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { SimNodeInit } from "../messages";

export type SimNode = SimNodeInit & SimulationNodeDatum;

export type SimLink = SimulationLinkDatum<SimNode> & {
  kind?: string;
  weight?: number;
  label?: string;
};
