// single source of truth for how mb_lookup_status enum values map to ui groups.
//
// import helpers from here; never inline status comparisons in components.
//
// group → enum members:
//   untouched:       not_attempted
//   in_flight:       queued, searching, fetching_detail, auto_applying
//   needs_attention: candidates, needs_review
//   done:            confirmed, enriched
//   deferred:        skipped, rejected
//   error:           error, no_match

import type { MbLookupStatus } from "./albumMetadata";

export type MbStatusGroup =
  | "untouched"
  | "in_flight"
  | "needs_attention"
  | "done"
  | "deferred"
  | "error";

export const MB_STATUS_GROUPS: readonly MbStatusGroup[] = [
  "untouched",
  "in_flight",
  "needs_attention",
  "done",
  "deferred",
  "error",
] as const;

/** which enum values belong to each group */
export const MB_STATUS_GROUP_MEMBERS: Record<MbStatusGroup, readonly MbLookupStatus[]> = {
  untouched: ["not_attempted"],
  in_flight: ["queued", "searching", "fetching_detail", "auto_applying"],
  needs_attention: ["candidates", "needs_review"],
  done: ["confirmed", "enriched"],
  deferred: ["skipped", "rejected"],
  error: ["error", "no_match"],
};

// reverse-lookup map built once at module load
const _statusToGroup = new Map<MbLookupStatus, MbStatusGroup>();
for (const [group, members] of Object.entries(MB_STATUS_GROUP_MEMBERS) as [
  MbStatusGroup,
  readonly MbLookupStatus[],
][]) {
  for (const s of members) {
    _statusToGroup.set(s, group);
  }
}

export function statusGroupOf(s: MbLookupStatus | null | undefined): MbStatusGroup {
  if (!s) return "untouched";
  return _statusToGroup.get(s) ?? "untouched";
}

export function isDone(s: MbLookupStatus | null | undefined): boolean {
  return statusGroupOf(s) === "done";
}

export function isInFlight(s: MbLookupStatus | null | undefined): boolean {
  return statusGroupOf(s) === "in_flight";
}

export function needsReview(s: MbLookupStatus | null | undefined): boolean {
  return statusGroupOf(s) === "needs_attention";
}

/** human-readable label for a group */
export function groupLabel(g: MbStatusGroup): string {
  switch (g) {
    case "untouched":
      return "not attempted";
    case "in_flight":
      return "in flight";
    case "needs_attention":
      return "needs attention";
    case "done":
      return "done";
    case "deferred":
      return "deferred";
    case "error":
      return "error";
  }
}

/** tailwind classes for a status group's badge pill */
export function groupBadgeClass(g: MbStatusGroup): string {
  switch (g) {
    case "untouched":
      return "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]";
    case "in_flight":
      return "bg-blue-500/15 text-blue-400";
    case "needs_attention":
      return "bg-amber-500/15 text-amber-400";
    case "done":
      return "bg-emerald-500/15 text-emerald-400";
    case "deferred":
      return "bg-slate-500/15 text-slate-400";
    case "error":
      return "bg-rose-500/15 text-rose-400";
  }
}
