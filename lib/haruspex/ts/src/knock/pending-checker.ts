// boot-time sweep that promotes any outbound knock that has been accepted
// (or denied) while the app was closed.

import { checkKnockStatus } from "./requester.js";
import type { KnockRecord, KnockStore, KnockTransport } from "./types.js";

export interface PendingKnockCheckerDeps {
  store: KnockStore;
  transport: KnockTransport;
  /**
   * fired once per outbound knock that has just resolved to accepted - a
   * toast/notification hook is the typical use. this sweep never acts on
   * the result itself beyond persisting the decision.
   */
  onAccepted: (record: KnockRecord) => void | Promise<void>;
  onDenied?: (record: KnockRecord) => void | Promise<void>;
}

/**
 * re-checks every pending outbound knock and fires the injected callback
 * for any that has resolved since the app was last open. peers that are
 * unreachable are left pending, retried on the next sweep.
 */
export async function checkPendingKnocks(deps: PendingKnockCheckerDeps): Promise<void> {
  const pending = await deps.store.listPending();
  const outbound = pending.filter((record) => record.direction === "outbound");

  await Promise.all(
    outbound.map(async (record) => {
      let updated: KnockRecord;
      try {
        updated = await checkKnockStatus(deps.store, deps.transport, record.id);
      } catch {
        return;
      }
      if (updated.status === "accepted") {
        await deps.onAccepted(updated);
      } else if (updated.status === "denied") {
        await deps.onDenied?.(updated);
      }
    }),
  );
}
