// per-remote auth state tracking
// tracks which remotes have expired sessions so the UI can prompt re-auth

import { createSignal, type Accessor } from "solid-js";
import { isTauriMode, generateAuthInvite } from "../../../app/services/tauri";

// map of remote_id -> [needsAuth getter, needsAuth setter]
const authStates = new Map<string, [Accessor<boolean>, (v: boolean) => void]>();

// callback for when auth is refreshed (set by App.tsx)
let onAuthRefreshCallback: ((inviteCode: string, remoteId: string) => Promise<void>) | null = null;

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

// set the callback for handling auth refresh
export function setAuthRefreshHandler(
  handler: (inviteCode: string, remoteId: string) => Promise<void>
): void {
  onAuthRefreshCallback = handler;
}

// mark a remote as needing re-authentication
// in tauri mode, this also triggers automatic auth refresh via command
export function setRemoteNeedsAuth(remoteId: string): void {
  const [, set] = getOrCreateSignal(remoteId);
  set(true);

  // in tauri mode, automatically refresh auth via command
  if (isTauriMode()) {
    void (async () => {
      try {
        const inviteCode = await generateAuthInvite();
        if (inviteCode && onAuthRefreshCallback) {
          await onAuthRefreshCallback(inviteCode, remoteId);
        }
      } catch (error) {
        console.error("[authState] failed to generate auth invite:", error);
      }
    })();
  }
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
