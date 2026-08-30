// pairing handshake handler: validates a pair_request against the current
// pin + rate limiter, and updates the caller-supplied trust store on
// success (see trustStore.ts for why this is injected rather than owned).

import { currentPin } from "./pinStore";
import { isRateLimited, recordPairingFailure, clearPairingFailures } from "./rateLimiter";
import type { TrustStore } from "./trustStore";
import { PairRequestSchema, type PairResponse } from "./protocol";

export async function handlePairRequest(
  trustStore: TrustStore,
  peerNodeId: string,
  rawLine: string,
): Promise<PairResponse> {
  if (isRateLimited(peerNodeId)) {
    return { type: "pair_response", ok: false, reason: "rate_limited" };
  }

  const parsed = PairRequestSchema.safeParse(JSON.parse(rawLine));
  if (!parsed.success) {
    recordPairingFailure(peerNodeId);
    return { type: "pair_response", ok: false, reason: "invalid_pin" };
  }

  const { pin, display_name } = parsed.data;
  if (pin !== currentPin()) {
    recordPairingFailure(peerNodeId);
    return { type: "pair_response", ok: false, reason: "invalid_pin" };
  }

  clearPairingFailures(peerNodeId);
  await trustStore.trustController(peerNodeId, display_name);
  return { type: "pair_response", ok: true };
}
