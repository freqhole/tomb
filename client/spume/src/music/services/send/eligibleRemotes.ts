// derived signal: list of remotes eligible to receive `send to remote`.
//
// a remote is eligible when:
//   - it is a p2p remote (`wasm` or `app` transport) OR the local
//     charnel-managed remote (which dispatches over IPC into the same
//     grimoire that runs the iroh-blobs puller)
//   - it is not the source remote
//   - it is not flagged offline
//   - the local user is logged in to it as `admin` or `member`
//     (viewer can browse but not write, so cannot receive sync routes)
//
// the underlying data sources are reactive — `listRemotes()` is fetched
// on demand and re-fetched when the auth-status store updates. callers
// pass a `sourceRemoteId` accessor so the signal automatically excludes
// it without a re-create.

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

export type EligibleRole = "admin" | "member";

export interface EligibleRemote {
  remote: Remote;
  role: EligibleRole;
}

export interface CreateEligibleRemotesOptions {
  /** source remote id to exclude. accessor so callers can react to source switches. */
  sourceRemoteId: () => string | undefined;
}

/**
 * derive the eligible-remotes list from the remotes table + auth-status store.
 *
 * the returned accessor is a solid memo. it tracks both the remotes resource
 * and the auth-status signal, so it updates automatically when either change.
 *
 * the resource is initialized once per call site; callers can trigger a
 * refresh via `refreshEligibleRemotes()`.
 */
export function createEligibleRemotes(
  opts: CreateEligibleRemotesOptions,
): Accessor<EligibleRemote[]> {
  const [remotes, { refetch }] = createResource(async () => {
    const list = await getAllRemotes();
    // best-effort: ensure the auth-status store has entries for all remotes.
    // refreshAll resets the in-flight map so this is fine to call repeatedly.
    void refreshAll(list);
    return list;
  });

  const authStatus = getAuthStatus();

  // expose refetch on the function for callers who need to force a reload.
  const accessor = createMemo<EligibleRemote[]>(() => {
    const all = remotes() ?? [];
    const status = authStatus();
    const sourceId = opts.sourceRemoteId();

    const out: EligibleRemote[] = [];
    for (const remote of all) {
      // p2p remotes can receive sync directly; the charnel-managed local
      // remote can too (IPC dispatch hits a grimoire with iroh-blobs).
      const eligibleTransport = isP2PRemote(remote) || remote.is_charnel_managed === true;
      if (!eligibleTransport) continue;
      if (sourceId && remote.remote_id === sourceId) continue;
      if (remote.is_offline) continue;
      const auth = status.get(remote.remote_id);
      if (!auth || !auth.loggedIn) continue;
      const role = auth.role;
      if (role !== "admin" && role !== "member") continue;
      out.push({ remote, role });
    }
    return out;
  });

  // attach the refetch helper as a property so consumers can call it without
  // exporting a separate api. type-safe because we only read it via cast.
  (accessor as unknown as { refetch: () => void }).refetch = refetch;

  return accessor;
}

/** force-refresh the underlying remotes resource for a previously created accessor. */
export function refreshEligibleRemotes(
  accessor: Accessor<EligibleRemote[]>,
): void {
  const r = (accessor as unknown as { refetch?: () => void }).refetch;
  if (typeof r === "function") r();
}
