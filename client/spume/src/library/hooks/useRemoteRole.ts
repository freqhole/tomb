// reactive "is the current user an admin on remote X?" helpers.
//
// thin wrappers over the global authStatusStore (populated by AppLayout
// when remotes come online, refreshed on login/logout, and on remote
// online transitions). callers should ALWAYS go through these helpers
// instead of reading the store directly — they handle the stale
// `{loggedIn:false}` case that arises when AppLayout's cold-boot
// whoami fires before the user has logged in / before cookies are
// hot, leaving a sticky non-admin entry that never re-resolves on its
// own.
//
// each hook instance forces exactly one re-resolve per remote per
// mount: enough to recover from cold-boot stale state without
// hammering whoami on every render.

import { createEffect, createMemo, on } from "solid-js";
import { permissions, type UserRoleName } from "freqhole-api-client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import {
  getAuthStatus,
  refreshOne,
  type AuthInfo,
} from "../../app/services/remotes/authStatusStore";

function entryIsAdmin(entry: AuthInfo | null | undefined): boolean {
  if (!entry || !entry.loggedIn || !entry.role) return false;
  return permissions.isAdmin(entry.role as UserRoleName);
}

/**
 * reactive boolean: is the current authenticated user an admin on the
 * given remote? returns false while the auth check is pending or absent.
 */
export function useRemoteIsAdmin(remote: () => Remote | undefined) {
  const authStatus = getAuthStatus();
  const refreshed = new Set<string>();

  createEffect(
    on(remote, (r) => {
      if (!r) return;
      if (refreshed.has(r.remote_id)) return;
      refreshed.add(r.remote_id);
      void refreshOne(r);
    }),
  );

  return createMemo(() => {
    const r = remote();
    if (!r) return false;
    return entryIsAdmin(authStatus().get(r.remote_id));
  });
}

/**
 * multi-remote variant: takes an accessor returning a list of remotes
 * and exposes (a) a per-remote admin check and (b) an "any admin"
 * convenience. used by views that operate over multiple remotes at
 * once (e.g. the graph view).
 */
export function useRemoteIsAdminMulti(remotes: () => Remote[]) {
  const authStatus = getAuthStatus();
  const refreshed = new Set<string>();

  createEffect(
    on(remotes, (rs) => {
      for (const r of rs) {
        if (refreshed.has(r.remote_id)) continue;
        refreshed.add(r.remote_id);
        void refreshOne(r);
      }
    }),
  );

  const isAdmin = (remoteId: string | null | undefined): boolean => {
    if (!remoteId) return false;
    return entryIsAdmin(authStatus().get(remoteId));
  };

  const isAnyAdmin = createMemo(() => {
    for (const r of remotes()) if (isAdmin(r.remote_id)) return true;
    return false;
  });

  return { isAdmin, isAnyAdmin };
}
