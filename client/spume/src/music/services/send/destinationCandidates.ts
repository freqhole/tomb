// derived signal: list of candidate destinations for `send to remote`.
//
// unlike the older "eligible" filter, this returns ALL plausible
// destinations (every p2p remote + the charnel-managed local remote, if
// present, minus the source) and exposes per-remote status so the ui can
// badge each row instead of hiding them. that lets the modal render
// instantly while online / role / has-music checks complete in the
// background.
//
// status semantics:
//   - "checking"     → auth/online probe still in flight
//   - "ready"        → logged in as admin or member, can receive sync
//   - "offline"      → flagged offline AND not authenticated
//   - "needs-login"  → reachable but not logged in
//   - "view-only"    → logged in but role is viewer (cannot write)
//   - "unsupported"  → some other unrecoverable state (e.g. missing role)
//
// charnel-managed remotes always resolve to "ready"/"admin" because
// embedded auth is implicit (no whoami round-trip).

import { createMemo, createResource, type Accessor } from "solid-js";
import {
  getAuthStatus,
  refreshAll,
} from "../../../app/services/remotes/authStatusStore";
import { getAllRemotes } from "../../../app/services/remotes/remoteManager";
import {
  isP2PRemote,
  type Remote,
} from "../../../app/services/storage/schemas/remote";

export type DestinationStatus =
  | { kind: "checking" }
  | { kind: "ready"; role: "admin" | "member" }
  | { kind: "offline" }
  | { kind: "needs-login" }
  | { kind: "view-only"; role: string }
  | { kind: "unsupported"; reason?: string };

export interface CandidateDestination {
  remote: Remote;
  status: DestinationStatus;
}

export interface CreateCandidateDestinationsOptions {
  /** source remote id to exclude. accessor so callers can react to source switches. */
  sourceRemoteId: () => string | undefined;
}

export function createCandidateDestinations(
  opts: CreateCandidateDestinationsOptions,
): Accessor<CandidateDestination[]> {
  const [remotes, { refetch }] = createResource(async () => {
    const list = await getAllRemotes();
    // best-effort: kick off auth probes for every remote in the list.
    void refreshAll(list);
    return list;
  });

  const authStatus = getAuthStatus();

  const accessor = createMemo<CandidateDestination[]>(() => {
    const all = remotes() ?? [];
    const status = authStatus();
    const sourceId = opts.sourceRemoteId();

    const out: CandidateDestination[] = [];
    for (const remote of all) {
      // physical eligibility — only p2p transports + the charnel-managed
      // local remote can receive sync (the rest can't run iroh-blobs).
      const eligibleTransport =
        isP2PRemote(remote) || remote.is_charnel_managed === true;
      if (!eligibleTransport) continue;
      if (sourceId && remote.remote_id === sourceId) continue;
      out.push({
        remote,
        status: deriveStatus(remote, status.get(remote.remote_id)),
      });
    }
    return out;
  });

  (accessor as unknown as { refetch: () => void }).refetch = refetch;
  return accessor;
}

export function refreshCandidateDestinations(
  accessor: Accessor<CandidateDestination[]>,
): void {
  const r = (accessor as unknown as { refetch?: () => void }).refetch;
  if (typeof r === "function") r();
}

/** convenience: true when this destination can actually receive a send. */
export function isReady(c: CandidateDestination): boolean {
  return c.status.kind === "ready";
}

function deriveStatus(
  remote: Remote,
  auth: { loggedIn: boolean; role?: string } | null | undefined,
): DestinationStatus {
  // charnel-managed local: embedded auth, always sendable as admin.
  if (remote.is_charnel_managed) return { kind: "ready", role: "admin" };
  // undefined = not yet seeded; null = probe in flight.
  if (auth === undefined || auth === null) return { kind: "checking" };
  if (!auth.loggedIn) {
    if (remote.is_offline) return { kind: "offline" };
    return { kind: "needs-login" };
  }
  if (auth.role === "admin" || auth.role === "member") {
    return { kind: "ready", role: auth.role };
  }
  return { kind: "view-only", role: auth.role ?? "viewer" };
}
