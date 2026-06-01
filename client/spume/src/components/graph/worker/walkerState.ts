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

/** runtime-tunable sim knobs. multipliers default to 1 (no change).
 *  driven by the debug overlay; persistence is host-side. */
export interface SimTuning {
  albumArtistDistance: number;
  albumArtistStrength: number;
  relatedArtistDistance: number;
  relatedArtistStrength: number;
  artistHubDistance: number;
  artistHubStrength: number;
  albumCollide: number;
  artistCollide: number;
  clusterCohesion: number;
  artistCharge: number;
  albumCharge: number;
  gravity: number;
}

export const DEFAULT_SIM_TUNING: SimTuning = {
  albumArtistDistance: 0.7,
  albumArtistStrength: 1.5,
  relatedArtistDistance: 2,
  relatedArtistStrength: 1,
  artistHubDistance: 1,
  artistHubStrength: 1,
  albumCollide: 2,
  artistCollide: 1,
  clusterCohesion: 0.4,
  artistCharge: 1,
  albumCharge: 1,
  gravity: 0.25,
};

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
  /** node ids whose immediate child subtree (children + their album
   *  children for any artist child) should be force-shown in addition to
   *  normal pivot-based visibility. populated by `expandSubtree` msgs;
   *  cleared by `back`. */
  eagerExpansions: Set<string>;
  tuning: SimTuning;
} = {
  fullGraph: { nodes: [], edges: [] },
  width: 800,
  height: 600,
  breadcrumb: [],
  sim: null,
  paused: false,
  hidden: new Set<string>(),
  eagerExpansions: new Set<string>(),
  tuning: { ...DEFAULT_SIM_TUNING },
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
