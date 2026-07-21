// requester-side operations: sending a knock and re-checking its status.

import type {
  KnockRecord,
  KnockRequest,
  KnockStatusReply,
  KnockStore,
  KnockTransport,
} from "./types.js";

export interface CheckKnockStatusOptions {
  /** additional attempts after the first, each with exponential backoff.
   *  default 0 (a single attempt, no retry). */
  retries?: number;
  /** base backoff in ms; doubles each retry. default 1000. */
  backoffMs?: number;
  /** injectable delay, overridable in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * send a fresh knock: creates the outbound record (enforcing the dedup
 * rule - throws KnockConflictError if one is already pending for this node
 * id + scope) and calls the transport once. if the transport call itself
 * fails (peer offline, network error), the record is left pending for a
 * later checkKnockStatus retry rather than surfacing the network error to
 * the caller - only the initial dedup conflict is worth failing loudly on.
 */
export async function sendKnock(
  store: KnockStore,
  transport: KnockTransport,
  nodeId: string,
  request: KnockRequest,
): Promise<KnockRecord> {
  const record = await store.createKnock({
    nodeId,
    direction: "outbound",
    scope: request.scope,
    message: request.message,
  });

  try {
    const reply = await transport.sendKnock(nodeId, request);
    return await applyStatusReply(store, record, reply);
  } catch {
    return record;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * re-check status for a previously-sent knock. retries with exponential
 * backoff on transport failure (the peer may be transiently unreachable);
 * the last error is thrown once retries are exhausted.
 */
export async function checkKnockStatus(
  store: KnockStore,
  transport: KnockTransport,
  knockId: string,
  options: CheckKnockStatusOptions = {},
): Promise<KnockRecord> {
  const record = await store.getKnock(knockId);
  if (!record) {
    throw new Error(`knock ${knockId} not found`);
  }

  const retries = options.retries ?? 0;
  const backoffMs = options.backoffMs ?? 1000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const reply = await transport.checkKnockStatus(record.nodeId, {
        scope: record.scope,
        message: record.message,
      });
      return await applyStatusReply(store, record, reply);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * persist a status reply against a record, appending a decision only when
 * the reply actually resolves the knock (accepted/denied) - a "still
 * pending" reply leaves the record and its audit log untouched.
 */
async function applyStatusReply(
  store: KnockStore,
  record: KnockRecord,
  reply: KnockStatusReply,
): Promise<KnockRecord> {
  if (reply.status === "pending") return record;
  return store.recordDecision(
    record.id,
    {
      byNodeId: record.nodeId,
      outcome: reply.status,
      at: Date.now(),
    },
    { grantedResourceIds: reply.grantedResourceIds },
  );
}
