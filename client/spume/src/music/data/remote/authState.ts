// per-remote auth state tracking
// tracks which remotes have expired sessions so the UI can prompt re-auth

import { createSignal, type Accessor } from "solid-js";

// map of remote_id -> [needsAuth getter, needsAuth setter]
const authStates = new Map<string, [Accessor<boolean>, (v: boolean) => void]>();

// get or create a signal for a given remote
function getOrCreateSignal(remoteId: string): [Accessor<boolean>, (v: boolean) => void] {
  let entry = authStates.get(remoteId);
  if (!entry) {
    const [get, set] = createSignal(false);
    entry = [get, set];
    authStates.set(remoteId, entry);
  }
  return entry;
}

// mark a remote as needing re-authentication
export function setRemoteNeedsAuth(remoteId: string): void {
  const [, set] = getOrCreateSignal(remoteId);
  set(true);
}

// clear the needs-auth flag for a remote (after successful re-auth)
export function clearRemoteNeedsAuth(remoteId: string): void {
  const [, set] = getOrCreateSignal(remoteId);
  set(false);
}

// reactive getter: does this remote need re-auth?
export function getRemoteNeedsAuth(remoteId: string): boolean {
  const [get] = getOrCreateSignal(remoteId);
  return get();
}
