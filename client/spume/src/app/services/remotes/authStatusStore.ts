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
import { whoamiForRemote } from "./authService";
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
  // skip remotes already known to be offline — the whoami call would
  // just hammer an unreachable peer and eventually fail. callers that
  // want a fresh check should run a health check first; on the
  // offline -> online transition the listener at the bottom of this
  // file refreshes auth automatically.
  if (remote.is_offline === true) {
    return { loggedIn: false };
  }
  // charnel-managed remotes (the tauri sidecar's own owner): query
  // whoami through the charnel local IPC transport. `getClientForRemote`
  // already routes is_charnel_managed remotes to that transport, so
  // `whoamiForRemote` returns the embedded owner caller (always admin
  // per `get_caller_from_app_config`). this MUST run before the p2p /
  // http branches below since charnel-managed remotes also typically
  // satisfy `isHttpRemote`.
  if (remote.is_charnel_managed) {
    try {
      const result = await whoamiForRemote(remote);
      return {
        loggedIn: result.success,
        username: result.username,
        role: result.role,
      };
    } catch {
      return { loggedIn: false };
    }
  }
  // p2p remotes: query whoami over the p2p client to learn the role.
  // needed for admin-button gating. cold-start "No addressing information"
  // races are now handled in grimoire's `transport::peer_lock` (it
  // serializes the first connect per peer so iroh discovery warms once),
  // so a single call here is sufficient.
  if (!isHttpRemote(remote)) {
    try {
      const result = await whoamiForRemote(remote);
      if (result.success) {
        return {
          loggedIn: true,
          username: result.username,
          role: result.role,
        };
      }
      return { loggedIn: false };
    } catch {
      // transport not warm / peer unreachable. callers see
      // `loggedIn:false` and the offline -> online listener at the
      // bottom of this file will retry once the peer comes back.
      return { loggedIn: false };
    }
  }
  // http remotes without a base_url can't be queried; treat as logged-out.
  if (!remote.base_url) {
    return { loggedIn: false };
  }
  try {
    // use whoamiForRemote so the saved Remote's credentials (api_key,
    // session token, etc.) are carried through `getClientForRemote`.
    // bare `whoami(base_url)` would synthesise a transient credential-less
    // remote via `httpRemote(...)`, which is why admin gating used to
    // silently come back false on every non-charnel http remote.
    const result = await whoamiForRemote(remote);
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

// in-flight refreshOne promises keyed by remote_id. dedupes concurrent
// refresh requests so a single `remotes()` accessor churn doesn't fan
// out into N redundant whoami calls per remote (the AppLayout effect
// re-fires on every remote-list identity change, and prior to this gate
// `getAuthInfo !== undefined` returned false until the very first call
// resolved, leading to pile-ups for offline / slow p2p peers).
const pendingRefresh = new Map<string, Promise<void>>();

/** refresh a single remote without touching the others. */
export async function refreshOne(remote: Remote): Promise<void> {
  const existing = pendingRefresh.get(remote.remote_id);
  if (existing) return existing;

  // mark as in-flight immediately so other callers gating on
  // `getAuthInfo(id) !== undefined` short-circuit while we resolve.
  if (authStatus().get(remote.remote_id) === undefined) {
    patch(remote.remote_id, null);
  }

  const task = (async () => {
    let info = await resolveOne(remote);
    // cold-boot heuristic: if the very first whoami says "logged out"
    // but we have no prior entry for this remote, retry once after a
    // short delay. on web browser builds the initial whoami can race
    // ahead of session cookie hydration / cross-origin cookie attach,
    // leading to a sticky `loggedIn:false` that survives navigation. a
    // single retry is cheap and rescues that case without re-querying
    // on every render. skip the retry for known-offline remotes — the
    // peer isn't going to magically reappear in 250ms.
    const prior = authStatus().get(remote.remote_id);
    const wasUnknown = prior === undefined || prior === null;
    if (!info.loggedIn && wasUnknown && remote.is_offline !== true) {
      await new Promise((r) => setTimeout(r, 250));
      const retry = await resolveOne(remote);
      if (retry.loggedIn) info = retry;
    }
    patch(remote.remote_id, info);
  })();

  pendingRefresh.set(remote.remote_id, task);
  try {
    await task;
  } finally {
    pendingRefresh.delete(remote.remote_id);
  }
}

/**
 * imperatively set an AuthInfo entry. used by callers (e.g. data source
 * switching) that have already performed a whoami via another transport
 * and want the canonical store to reflect that result without a second
 * round-trip.
 */
export function patchAuthInfo(remoteId: string, info: AuthInfo): void {
  patch(remoteId, info);
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
