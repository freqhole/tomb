// hubNodes
//
// shared identity + predicates for the synthetic "hub" nodes the
// graph viz uses to anchor its hierarchy:
//   - remote hubs        (wonky triangle)        hub_remote::<remote_id>
//   - relation hubs      (hexagon)               hub_relation::<remote_id>::<kind>
//   - relation-value hubs (octagon, sub-relation) hub_relation_value::<kind>::<urlencoded value>
//
// these used to be scattered across LibraryGraphSubview, GraphCanvas
// and drawArtistNode as bare string startsWith checks. centralizing
// them here gives one source of truth for the id grammar, predicates,
// constructors and parsers, and a stable enum for downstream branching.
//
// note on scope: relation-kind hubs are per-remote (each remote gets
// its own hex per kind, so each remote's tree splays into its own
// region of the canvas). relation-value hubs are shared across remotes
// — once the user drills into a specific value ("rock"), the same
// octagon aggregates membership from every selected remote.

import { RELATION_KINDS } from "./relations";
import type { RelationKind } from "./types";

export const HUB_PREFIX = {
  remote: "hub_remote::",
  relation: "hub_relation::",
  relationValue: "hub_relation_value::",
} as const;

export type HubKind = "remote" | "relation" | "relation_value";

// every RelationKind we expose as a top-level relation hub. `artist_album`
// is intentionally excluded: it's the implicit parent/child relation that
// always exists, not something the user drills into.
export const RELATION_HUB_KINDS: RelationKind[] = RELATION_KINDS.filter(
  (r) => r.kind !== "artist_album"
).map((r) => r.kind) as RelationKind[];

const RELATION_HUB_KIND_SET = new Set<RelationKind>(RELATION_HUB_KINDS);

// value-layer relations are those whose hub can be drilled into a set
// of sub-relation (relation-value) hubs — one per distinct value the
// underlying albums carry for that kind. e.g. "tag" splits into
// "tag: ambient", "tag: indie", etc. kinds like "favorite",
// "same_artist", "related_artist" do not have a value layer.
const VALUE_LAYER_KINDS = new Set<RelationKind>([
  "genre",
  "tag",
  "mood",
  "style",
  "era",
  "label",
]);

export function relationSupportsValueLayer(kind: RelationKind | null | undefined): boolean {
  return !!kind && VALUE_LAYER_KINDS.has(kind);
}

// ---- predicates -------------------------------------------------------

export function isRemoteHubId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(HUB_PREFIX.remote);
}

export function isRelationHubId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(HUB_PREFIX.relation);
}

export function isRelationValueHubId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(HUB_PREFIX.relationValue);
}

export function isAnyHubId(id: string | null | undefined): boolean {
  return isRemoteHubId(id) || isRelationHubId(id) || isRelationValueHubId(id);
}

export function hubKindOf(id: string | null | undefined): HubKind | null {
  if (isRelationValueHubId(id)) return "relation_value";
  if (isRelationHubId(id)) return "relation";
  if (isRemoteHubId(id)) return "remote";
  return null;
}

// ---- id constructors --------------------------------------------------

export function remoteHubId(remoteId: string): string {
  return `${HUB_PREFIX.remote}${remoteId}`;
}

export function relationHubId(kind: RelationKind, remoteId: string): string {
  return `${HUB_PREFIX.relation}${remoteId}::${kind}`;
}

export function relationValueHubId(kind: RelationKind, valueNorm: string): string {
  return `${HUB_PREFIX.relationValue}${kind}::${encodeURIComponent(valueNorm)}`;
}

// ---- parsers ----------------------------------------------------------

export function parseRemoteHubId(id: string | null | undefined): string | null {
  if (!isRemoteHubId(id)) return null;
  return id!.slice(HUB_PREFIX.remote.length);
}

export function parseRelationHubId(
  id: string | null | undefined
): { remoteId: string; kind: RelationKind } | null {
  if (!isRelationHubId(id)) return null;
  const raw = id!.slice(HUB_PREFIX.relation.length);
  const sep = raw.indexOf("::");
  if (sep <= 0) return null;
  const remoteId = raw.slice(0, sep);
  const kind = raw.slice(sep + 2) as RelationKind;
  if (!RELATION_HUB_KIND_SET.has(kind)) return null;
  if (!remoteId) return null;
  return { remoteId, kind };
}

export function relationHubKind(id: string | null | undefined): RelationKind | null {
  return parseRelationHubId(id)?.kind ?? null;
}

export function relationHubRemoteId(id: string | null | undefined): string | null {
  return parseRelationHubId(id)?.remoteId ?? null;
}

export function parseRelationValueHubId(
  id: string | null | undefined
): { kind: RelationKind; valueNorm: string } | null {
  if (!isRelationValueHubId(id)) return null;
  const raw = id!.slice(HUB_PREFIX.relationValue.length);
  const sep = raw.indexOf("::");
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep) as RelationKind;
  if (!RELATION_HUB_KIND_SET.has(kind)) return null;
  const encoded = raw.slice(sep + 2);
  try {
    return { kind, valueNorm: decodeURIComponent(encoded) };
  } catch {
    return null;
  }
}
