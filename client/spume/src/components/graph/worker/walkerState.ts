/// <reference lib="webworker" />

import type { Simulation, SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import type { WalkGraph, WalkNode } from "../types";
import type { WorkerToMain } from "./messages";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  role: string;
  childCount: number;
  radius: number;
  targetX: number;
  targetY: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  isBreadcrumb: boolean;
  /** mirrors WalkEdge.isRelatedArtist — forceLink uses this to apply a
   *  shorter distance + stronger spring so related-artist pairs are
   *  visually clustered. */
  isRelatedArtist?: boolean;
}

export const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

export function post(msg: WorkerToMain) {
  ctx.postMessage(msg);
}

export const state: {
  fullGraph: WalkGraph;
  width: number;
  height: number;
  breadcrumb: string[];
  sim: Simulation<SimNode, SimLink> | null;
  paused: boolean;
  /** node ids the host has marked hidden (e.g. filtered-out taxons in
   *  edit mode). breadcrumb nodes are never hidden even if listed here. */
  hidden: Set<string>;
} = {
  fullGraph: { nodes: [], edges: [] },
  width: 800,
  height: 600,
  breadcrumb: [],
  sim: null,
  paused: false,
  hidden: new Set<string>(),
};

// node + edge maps rebuilt on each init
export const nodeMap = new Map<string, WalkNode>();
export const childrenOf = new Map<string, string[]>(); // parentId -> [childId]
export const parentsOf  = new Map<string, string[]>(); // childId  -> [parentId]

// phase 3: synthesized cross-remote links (artist↔artist, album↔album) keyed
// by a sorted "a||b" string for fast lookup at emit time. populated by
// indexGraph() from name-based matching across remotes.
export const crossRemoteEdges = new Set<string>();

// strategy A — cluster aggregation:
// when two or more entity nodes (artist or album) match across remotes via
// slug(label), we collapse them visually into a single "cluster leader"
// glyph. every member maps to the leader's id via clusterLeaderOf; the
// leader's contributor remote list is in clusterRemotes (leader id ->
// sorted list of contributing remoteIds). this enables:
//   - getVisible() promoting any follower to its leader so we never
//     show duplicates on screen
//   - the renderer drawing per-contributor accent dots around the leader
//   - the detail panel reading contributor list for the multi-remote
//     edit/open dropdown (next pass)
// id system stays per-remote; only the visual + selection layer aggregates.
export const clusterLeaderOf = new Map<string, string>(); // memberId -> leaderId
export const clusterMembers = new Map<string, string[]>(); // leaderId -> [memberIds]
export const clusterRemotes = new Map<string, string[]>(); // leaderId -> sorted remoteIds
