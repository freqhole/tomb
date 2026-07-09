// fixture builders for knock records and scopes - deterministic test data
// for exercising knock logic without a live transport or real store.

import type {
  KnockDecision,
  KnockDirection,
  KnockRecord,
  KnockScope,
  KnockStatus,
} from "../knock/types.js";

/** creates a deterministic knock scope for the given kind. */
export function makeKnockScope(kind: "account" | "browse" | "resource", resourceId?: string): KnockScope {
  if (kind === "resource") {
    return { kind: "resource", resourceId: resourceId ?? "doc-1" };
  }
  return { kind };
}

/** creates a knock record with default test values. all fields are
 *  overridable via the optional `overrides` argument. */
export function makeKnockRecord(
  overrides: Partial<KnockRecord> = {},
): KnockRecord {
  const direction: KnockDirection = overrides.direction ?? "outbound";
  const scope: KnockScope = overrides.scope ?? { kind: "browse" };
  return {
    id: `knock-${Math.random().toString(36).slice(2, 9)}`,
    nodeId: "ab".repeat(32),
    direction,
    scope,
    message: "",
    status: "pending",
    createdAt: Date.now(),
    decisions: [],
    grantedResourceIds: [],
    ...overrides,
  };
}

/** creates a knock decision for test scenarios where the full audit log
 *  matters. */
export function makeKnockDecision(
  outcome: "accepted" | "denied",
  byNodeId = "cd".repeat(32),
  at = Date.now(),
  grantedRole?: string,
): KnockDecision {
  return {
    byNodeId,
    outcome,
    at,
    ...(grantedRole && { grantedRole }),
  };
}

/** creates a batch of knock records with distinct node ids and optional
 *  shared overrides. */
export function makeKnockRecords(
  count: number,
  overrides: Partial<KnockRecord> = {},
): KnockRecord[] {
  return Array.from({ length: count }, (_, i) => {
    const nodeId = `node-${i.toString().padStart(2, "0")}`.padEnd(64, "0");
    return makeKnockRecord({ ...overrides, nodeId });
  });
}
