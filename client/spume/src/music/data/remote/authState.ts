// per-remote auth state tracking
// tracks which remotes have expired sessions so the UI can prompt re-auth

import { createSignal, type Accessor } from "solid-js";
import { isTauriMode, generateAuthInvite } from "../../../app/services/tauri";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";

// map of remote_id -> [needsAuth getter, needsAuth setter]
const authStates = new Map<string, [Accessor<boolean>, (v: boolean) => void]>();

// track which remotes are currently refreshing auth (to prevent duplicate invites)
const pendingAuthRefresh = new Set<string>();

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
// for tauri-managed remotes in tauri mode, this triggers automatic auth refresh
// for other remotes, just sets the flag so UI can show the auth toast
export function setRemoteNeedsAuth(remoteId: string): void {
  const [currentVal, set] = getOrCreateSignal(remoteId);
  
  // already marked as needing auth - no need to repeat
  if (currentVal()) {
    return;
  }
  
  set(true);

  // only auto-refresh for tauri-managed remotes in tauri mode
  if (!isTauriMode()) {
    return;
  }
  
  // already refreshing this remote - don't spam invites
  if (pendingAuthRefresh.has(remoteId)) {
    console.log("[authState] auth refresh already pending for", remoteId);
    return;
  }

  void (async () => {
    try {
      // check if this specific remote is tauri-managed
      const remote = await getRemoteById(remoteId);
      if (!remote?.is_tauri_managed) {
        console.log("[authState] remote is not tauri-managed, skipping auto-refresh:", remoteId);
        return;
      }
      
      // mark as pending to prevent duplicate invites
      pendingAuthRefresh.add(remoteId);
      
      console.log("[authState] generating auth invite for tauri-managed remote:", remoteId);
      const inviteCode = await generateAuthInvite();
      console.log("[authState] invite code generated:", inviteCode ? "yes" : "no");
      
      if (inviteCode && onAuthRefreshCallback) {
        console.log("[authState] calling auth refresh callback...");
        await onAuthRefreshCallback(inviteCode, remoteId);
        console.log("[authState] auth refresh callback completed");
      } else if (inviteCode && !onAuthRefreshCallback) {
        console.warn("[authState] invite code generated but no callback registered!");
      }
    } catch (error) {
      console.error("[authState] failed to generate auth invite:", error);
    } finally {
      pendingAuthRefresh.delete(remoteId);
    }
  })();
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
