// reactive "is the current user an admin on remote X?" helper.
//
// thin wrapper over the global authStatusStore (which is populated by
// AppLayout when remotes come online and refreshed on login/logout).
// no parallel cache, no whoami calls of our own — just consume the
// canonical signal so we stay in sync with the topnav role display.

import { createEffect, createMemo, on } from "solid-js";
import { permissions, type UserRoleName } from "freqhole-api-client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import {
  getAuthInfo,
  getAuthStatus,
  refreshOne,
} from "../../app/services/remotes/authStatusStore";

/**
 * reactive boolean: is the current authenticated user an admin on the
 * given remote? returns false while the auth check is pending or absent.
 *
 * if the global authStatusStore has no entry for this remote yet, this
 * triggers a one-shot refresh so views that aren't AppLayout (e.g. the
 * library view) get a populated entry without depending on the user
 * having visited remote settings first.
 */
export function useRemoteIsAdmin(remote: () => Remote | undefined) {
  const authStatus = getAuthStatus();

  // kick off a refresh whenever a remote first appears with no entry.
  createEffect(
    on(remote, (r) => {
      if (!r) return;
      const existing = getAuthInfo(r.remote_id);
      console.log(
        "[useRemoteIsAdmin] remote changed",
        r.remote_id,
        "existing entry:",
        existing,
      );
      if (existing !== undefined) return;
      console.log("[useRemoteIsAdmin] triggering refreshOne for", r.remote_id);
      void refreshOne(r);
    }),
  );

  return createMemo(() => {
    const r = remote();
    if (!r) return false;
    const entry = authStatus().get(r.remote_id);
    const result =
      !!entry && entry.loggedIn && !!entry.role && permissions.isAdmin(entry.role as UserRoleName);
    console.log("[useRemoteIsAdmin] memo", r.remote_id, "entry:", entry, "isAdmin:", result);
    return result;
  });
}
