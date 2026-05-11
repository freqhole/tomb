// auth-status store — global, per-remote auth/role cache.
//
// extracted from `RemotesSettingsView` so any view (settings, share modal,
// future eligible-remotes service, etc.) can read the current logged-in
// state and role for a remote without re-running whoami over and over.
//
// values:
//   - `undefined` → never queried
//   - `null`      → query in flight (initial check pending)
//   - `AuthInfo`  → resolved (loggedIn may be true or false)
//
// the store is a single module-level signal; multiple consumers share the
// same map. callers trigger refreshes themselves; the store does not
// auto-poll.

import { createSignal, type Accessor } from "solid-js";
import { whoami, whoamiForRemote } from "./authService";
import { isHttpRemote, type Remote } from "../storage/types";
import { getRemoteById, onRemoteStatusChange } from "./remoteManager";

export interface AuthInfo {
  loggedIn: boolean;
  username?: string;
  role?: string;
}

// undefined = never queried, null = query in flight, AuthInfo = resolved
type AuthEntry = AuthInfo | null;

const [authStatus, setAuthStatus] = createSignal<Map<string, AuthEntry>>(new Map());

function patch(remoteId: string, entry: AuthEntry): void {
  setAuthStatus((prev) => {
    const next = new Map(prev);
    next.set(remoteId, entry);
    return next;
  });
}

async function resolveOne(remote: Remote): Promise<AuthInfo> {
  // p2p remotes: query whoami over the p2p client to learn the role.
  // needed for admin-button gating. transport readiness is no longer
  // the store's concern — the remote-status-change subscription below
  // re-runs this once the remote is verified online (which means midden
  // is ready and discovery has succeeded).
  if (!isHttpRemote(remote)) {
    try {
      const result = await whoamiForRemote(remote);
      return {
        loggedIn: result.success,
        username: result.username,
        role: result.role,
      };
    } catch {
      // expected on cold reload before the remote-status-change event
      // fires. we'll be retried then.
      return { loggedIn: false };
    }
  }
  // skip charnel-managed remotes — they use embedded auth and don't have
  // a queryable session.
  if (remote.is_charnel_managed || !remote.base_url) {
    return { loggedIn: false };
  }
  try {
    const result = await whoami(remote.base_url);
    return {
      loggedIn: result.success,
      username: result.username,
      role: result.role,
    };
  } catch {
    return { loggedIn: false };
  }
}

/** read-only accessor for the per-remote auth status map. */
export function getAuthStatus(): Accessor<Map<string, AuthEntry>> {
  return authStatus;
}

/** convenience: snapshot lookup for a single remote. */
export function getAuthInfo(remoteId: string): AuthEntry | undefined {
  return authStatus().get(remoteId);
}

/** mark all remotes as checking, then resolve each in parallel. */
export async function refreshAll(remoteList: Remote[]): Promise<void> {
  const initial = new Map<string, AuthEntry>();
  for (const r of remoteList) initial.set(r.remote_id, null);
  setAuthStatus(initial);

  await Promise.all(
    remoteList.map(async (remote) => {
      const info = await resolveOne(remote);
      patch(remote.remote_id, info);
    }),
  );
}

/** refresh a single remote without touching the others. */
export async function refreshOne(remote: Remote): Promise<void> {
  const info = await resolveOne(remote);
  patch(remote.remote_id, info);
}

/** mark a remote as logged out without re-querying (for post-logout updates). */
export function setLoggedOut(remoteId: string): void {
  patch(remoteId, { loggedIn: false });
}

/** drop a remote's entry entirely (e.g. after deletion). */
export function clearRemote(remoteId: string): void {
  setAuthStatus((prev) => {
    if (!prev.has(remoteId)) return prev;
    const next = new Map(prev);
    next.delete(remoteId);
    return next;
  });
}

// ---- event-driven refresh on remote-online transitions ----
//
// when a remote transitions from offline -> online (e.g. midden finishing
// init triggers a deferred health check, or the user reconnects), the
// p2p transport is now verifiably warm — re-resolve auth so we don't
// hold a stale `loggedIn:false` from a cold-boot attempt that fired
// before the transport was ready.
onRemoteStatusChange(async (remoteId, isOffline) => {
  if (isOffline) return;
  const remote = await getRemoteById(remoteId);
  if (!remote) return;
  await refreshOne(remote);
});
