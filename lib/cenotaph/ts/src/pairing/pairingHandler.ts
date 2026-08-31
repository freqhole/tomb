// pairing handshake handler: validates a pair_request against the current
// session pin + rate limiter, and updates the caller-supplied trust store
// on success (see trustStore.ts for why this is injected rather than
// owned). a successful redemption also joins the peer into the session
// (see playerSession.ts) - the session pin doubles as the pairing pin, so
// there's only one code for a peer to type in.

import { isRateLimited, recordPairingFailure, clearPairingFailures } from "./rateLimiter";
import type { TrustStore, PeerRole } from "./trustStore";
import { PairRequestSchema, type PairResponse } from "./protocol";
import {
  joinSession,
  regenerateSessionPin,
  type PlayerSession,
  type PlayerSessionStore,
} from "./playerSession";

export async function handlePairRequest(
  trustStore: TrustStore,
  sessionStore: PlayerSessionStore,
  session: PlayerSession,
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
  if (pin !== session.pin) {
    recordPairingFailure(peerNodeId);
    return { type: "pair_response", ok: false, reason: "invalid_pin" };
  }

  clearPairingFailures(peerNodeId);

  // first peer ever paired (or a pending one-time "regenerate admin
  // pairing code" grant) becomes an admin; everyone else defaults to the
  // lowest-privilege role, same "safe default" philosophy as grimoire's
  // own route auth (see apiRouter.ts).
  const existing = await trustStore.listTrustedControllers();
  const grantsAdmin = existing.length === 0 || session.admin_grant_pending;
  const role: PeerRole = grantsAdmin ? "admin" : "viewer";
  await trustStore.trustController(peerNodeId, display_name, role);
  const joined = await joinSession(sessionStore, session, peerNodeId);

  // the admin-bootstrap pin is meant as a one-time registration code -
  // once it's actually redeemed for admin, mint a fresh, non-admin pin so
  // regular users have a distinct code to join with (the old one would
  // otherwise keep working too, just downgraded to "viewer").
  if (grantsAdmin) {
    await regenerateSessionPin(sessionStore, joined);
  }

  return { type: "pair_response", ok: true };
}
