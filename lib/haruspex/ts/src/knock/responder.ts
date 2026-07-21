// responder-side operations: accepting or denying an inbound knock.
//
// the accept side effect (creating a user, granting a role, whatever
// accepting a knock actually means for the app) is always the injected
// `KnockPolicy` callback - this module only records the decision and
// resolves the knock record's status, never performs an app-specific
// effect itself.

import type { KnockPolicy, KnockRecord, KnockStore } from "./types.js";

/**
 * accept an inbound knock: runs the injected policy and records its result
 * as an accepted decision. `decidedBy` is the responder's own node id,
 * recorded on the decision's audit entry.
 */
export async function acceptKnock(
  store: KnockStore,
  knockId: string,
  policy: KnockPolicy,
  decidedBy: string,
): Promise<KnockRecord> {
  const record = await store.getKnock(knockId);
  if (!record) {
    throw new Error(`knock ${knockId} not found`);
  }
  const result = await policy(record);
  return store.recordDecision(
    knockId,
    {
      byNodeId: decidedBy,
      outcome: "accepted",
      grantedRole: result.grantedRole,
      at: Date.now(),
    },
    { grantedResourceIds: result.grantedResourceIds },
  );
}

/**
 * deny an inbound knock. no policy callback - denial has no side effect to
 * inject.
 */
export async function denyKnock(
  store: KnockStore,
  knockId: string,
  decidedBy: string,
): Promise<KnockRecord> {
  const record = await store.getKnock(knockId);
  if (!record) {
    throw new Error(`knock ${knockId} not found`);
  }
  return store.recordDecision(knockId, {
    byNodeId: decidedBy,
    outcome: "denied",
    at: Date.now(),
  });
}
