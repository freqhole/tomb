// classify a graph node into its visual role. roles map 1:1 to
// files under `draw/roles/` and to entries in `HIT_INRADIUS_FACTOR`.
//
// historically `ArtistNodeData` was an umbrella for the actual
// artist circle plus three hub silhouettes (remote root, relation
// kind, relation value). this dispatcher concentrates that
// classification in one place so the rest of the draw / hit-test
// code can switch on `role` instead of re-running id-prefix sniffs.

import {
  isRelationHubId,
  isRelationValueHubId,
  isRemoteHubId,
} from "../../hubNodes";
import type { GraphNodeData } from "../../types";
import { nodeKind } from "../../types";

export type NodeRole =
  | "album"
  | "artist"
  | "remoteHub"
  | "relationHub"
  | "relationValueHub";

/** classify a node by its visual role. */
export function nodeRole(n: GraphNodeData): NodeRole {
  if (nodeKind(n) === "album") return "album";
  // artist-discriminated nodes still cover the four non-album roles;
  // disambiguate by id-prefix on `artistId`.
  const id = (n as { artistId?: string }).artistId ?? "";
  if (isRemoteHubId(id)) return "remoteHub";
  if (isRelationHubId(id)) return "relationHub";
  if (isRelationValueHubId(id)) return "relationValueHub";
  return "artist";
}

/** true for any of the three hub silhouettes (remote / relation /
 *  relation-value). albums and real artists return false. */
export function isHubRole(role: NodeRole): boolean {
  return (
    role === "remoteHub" ||
    role === "relationHub" ||
    role === "relationValueHub"
  );
}
