// hubNodes
//
// shared identity + predicates for the synthetic "hub" nodes the
// graph viz uses to anchor its hierarchy:
//   - remote hubs        (wonky triangle)        hub_remote::<remote_id>
//   - relation hubs      (hexagon)               hub_relation::<remote_id>::<kind>
//   - relation-value hubs (octagon, sub-relation) hub_relation_value::<kind>::<urlencoded value>
//
// these used to be scattered across LibraryGraphSubview, GraphCanvas
// and the old `drawArtistNode.ts` (now `draw/roles/*.ts`) as bare
// string startsWith checks. centralizing them here gives one source
// of truth for the id grammar, predicates, constructors and parsers,
// and a stable enum for downstream branching.
//
// note on scope: relation-kind hubs are per-remote (each remote gets
// its own hex per kind, so each remote's tree splays into its own
// region of the canvas). relation-value hubs are shared across remotes
// — once the user drills into a specific value ("rock"), the same
// octagon aggregates membership from every selected remote.

import { RELATION_KINDS, relationMeta } from "./relations";
import type { RelationKind, RelationKindLike } from "./types";

export const HUB_PREFIX = {
  remote: "hub_remote::",
  relation: "hub_relation::",
  relationValue: "hub_relation_value::",
} as const;

export type HubKind = "remote" | "relation" | "relation_value";

// every RelationKind we expose as a top-level relation hub. exclusions:
//   - `artist_album`: implicit parent/child relation that always
//     exists, not something the user drills into.
//   - `same_artist`: redundant with the artist circle itself — the
//     artist node IS the shared identity. (phase 21)
//   - `era`, `recently_added`: synthesized taxons deferred for now —
//     era binning needs more album-year coverage to feel coherent,
//     and the recently-added per-remote bucket made the layout
//     glitchy. plumbing stays in place; flip these back into the
//     hub set when revisiting phase 22.
const DEFERRED_HUB_KINDS = new Set<string>(["artist_album", "same_artist", "era", "recently_added"]);
export const RELATION_HUB_KINDS: RelationKind[] = RELATION_KINDS.filter(
  (r) => !DEFERRED_HUB_KINDS.has(r.kind)
).map((r) => r.kind) as RelationKind[];

// value-layer support is now driven by `relationMeta(kind)` (see
// `relations.ts`). unknown kinds default to taxon-like, so a remote
// can surface a brand-new `(kind, value)` pair without any client-side
// allowlist update (phase 18).
export function relationSupportsValueLayer(
  kind: RelationKindLike | null | undefined
): boolean {
  return relationMeta(kind ?? null).supportsValueLayer;
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

export function relationHubId(kind: RelationKindLike, remoteId: string): string {
  return `${HUB_PREFIX.relation}${remoteId}::${kind}`;
}

export function relationValueHubId(kind: RelationKindLike, valueNorm: string): string {
  return `${HUB_PREFIX.relationValue}${kind}::${encodeURIComponent(valueNorm)}`;
}

// ---- parsers ----------------------------------------------------------

export function parseRemoteHubId(id: string | null | undefined): string | null {
  if (!isRemoteHubId(id)) return null;
  return id!.slice(HUB_PREFIX.remote.length);
}

export function parseRelationHubId(
  id: string | null | undefined
): { remoteId: string; kind: RelationKindLike } | null {
  if (!isRelationHubId(id)) return null;
  const raw = id!.slice(HUB_PREFIX.relation.length);
  const sep = raw.indexOf("::");
  if (sep <= 0) return null;
  const remoteId = raw.slice(0, sep);
  const kind = raw.slice(sep + 2);
  // accept ANY non-empty kind: remotes can surface novel taxon
  // kinds and the client should round-trip them unchanged (phase 18).
  if (!kind) return null;
  if (!remoteId) return null;
  return { remoteId, kind };
}

export function relationHubKind(id: string | null | undefined): RelationKindLike | null {
  return parseRelationHubId(id)?.kind ?? null;
}

export function relationHubRemoteId(id: string | null | undefined): string | null {
  return parseRelationHubId(id)?.remoteId ?? null;
}

export function parseRelationValueHubId(
  id: string | null | undefined
): { kind: RelationKindLike; valueNorm: string } | null {
  if (!isRelationValueHubId(id)) return null;
  const raw = id!.slice(HUB_PREFIX.relationValue.length);
  const sep = raw.indexOf("::");
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  if (!kind) return null;
  const encoded = raw.slice(sep + 2);
  try {
    return { kind, valueNorm: decodeURIComponent(encoded) };
  } catch {
    return null;
  }
}
