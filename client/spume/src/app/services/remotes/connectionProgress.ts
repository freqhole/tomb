// shared connection progress state
//
// this module provides reactive signals for tracking remote connection progress.
// AppLayout renders the ConnectionProgressModal based on this state.
// RemoteContextHandler (and others) can trigger connections and cancel them.

import { createSignal } from "solid-js";
import type { ConnectionProgressState } from "../../../components/modals/ConnectionProgressModal";
import { getRemoteById, checkRemoteHealth, getTauriManagedRemote } from "./remoteManager";
import { isHttpRemote, isP2PRemote } from "../storage/types";
import { useRemoteSource, useLocalSource, getCurrentRemote } from "../../../music/data";
import { getDefaultRoute } from "../../../music/utils/routing";
import { isCharnelMode } from "../charnel";
import { debug } from "../../../utils/logger";

// reactive connection state (read by AppLayout for modal)
const [connectionProgress, setConnectionProgress] = createSignal<ConnectionProgressState>({
  isConnecting: false,
  remoteName: "",
  showAfterDelay: false,
});

// timer ref for delayed modal show
let connectionTimerRef: ReturnType<typeof setTimeout> | null = null;

// cancellation flag
let connectionCancelled = false;

// track the current target remote being connected to (for navigation on cancel)
let currentTargetRemoteId: string | null = null;

/**
 * get the current connection progress state (for rendering modal)
 */
export function getConnectionProgress() {
  return connectionProgress;
}

/**
 * clear connection progress state
 */
function clearConnectionProgress() {
  if (connectionTimerRef) {
    clearTimeout(connectionTimerRef);
    connectionTimerRef = null;
  }
  setConnectionProgress({
    isConnecting: false,
    remoteName: "",
    showAfterDelay: false,
  });
}

/**
 * cancel the current connection attempt
 */
export function cancelConnection() {
  connectionCancelled = true;
  clearConnectionProgress();
  debug("connectionProgress", "connection cancelled by user");
}

/**
 * cancel the current connection and navigate to appropriate fallback.
 * 
 * - if already on a different working remote, stays there
 * - if on same remote (or no remote), navigates to local/tauri remote
 * 
 * @param navigate - router navigate function
 */
export async function cancelAndNavigate(navigate: (path: string, options?: { replace?: boolean }) => void) {
  cancelConnection();
  
  const targetRemoteId = currentTargetRemoteId;
  const current = getCurrentRemote();
  
  // if we have a current remote that's different from what we were connecting to, stay there
  if (current && current.remote_id !== targetRemoteId) {
    debug("connectionProgress", `cancel: staying on current remote ${current.name}`);
    navigate(getDefaultRoute(current.remote_id), { replace: true });
    return;
  }
  
  // otherwise navigate to fallback (local or tauri remote)
  if (isCharnelMode()) {
    const tauriRemote = await getTauriManagedRemote();
    if (tauriRemote && tauriRemote.remote_id !== targetRemoteId) {
      debug("connectionProgress", `cancel: going to tauri remote ${tauriRemote.name}`);
      navigate(getDefaultRoute(tauriRemote.remote_id), { replace: true });
      return;
    }
  }
  
  // web mode or no tauri remote: go to local
  debug("connectionProgress", "cancel: going to local");
  await useLocalSource();
  navigate(getDefaultRoute("local"), { replace: true });
}

/**
 * attempt to connect to a remote with progress modal support.
 * 
 * - shows modal after 1 second if still connecting
 * - allows cancellation
 * - returns true if connected, false if cancelled or failed
 * 
 * @param remoteId - the remote to connect to
 * @param skipHealthCheck - if true, skip health check (useful for retries)
 */
export async function connectToRemote(
  remoteId: string,
  options: { skipHealthCheck?: boolean } = {}
): Promise<{ success: boolean; cancelled: boolean }> {
  connectionCancelled = false;
  currentTargetRemoteId = remoteId;

  const remote = await getRemoteById(remoteId);
  if (!remote) {
    debug("connectionProgress", `remote not found: ${remoteId}`);
    return { success: false, cancelled: false };
  }

  // start connection progress tracking
  const remoteUrl = isHttpRemote(remote)
    ? remote.base_url
    : isP2PRemote(remote)
      ? remote.peer_addr
      : undefined;

  setConnectionProgress({
    isConnecting: true,
    remoteName: remote.name,
    remoteUrl,
    showAfterDelay: false,
  });

  // show modal after 1 second delay if still connecting
  connectionTimerRef = setTimeout(() => {
    if (!connectionCancelled) {
      setConnectionProgress((prev) => ({
        ...prev,
        showAfterDelay: true,
      }));
    }
  }, 1000);

  try {
    // check if cancelled before health check
    if (connectionCancelled) {
      clearConnectionProgress();
      return { success: false, cancelled: true };
    }

    // health check (unless skipped)
    if (!options.skipHealthCheck) {
      // p2p remotes can fail the first probe during cold boot while peer
      // addressing/relay info is still warming up. do a short bounded retry
      // window before declaring offline and rerouting.
      const isP2P = isP2PRemote(remote);
      const maxAttempts = isP2P ? 4 : 1;
      const retryDelaysMs = [350, 900, 1800];
      let isOnline = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        debug(
          "connectionProgress",
          `checking health of ${remote.name} (attempt ${attempt}/${maxAttempts})...`
        );
        isOnline = await checkRemoteHealth(remote);

        if (connectionCancelled) {
          clearConnectionProgress();
          return { success: false, cancelled: true };
        }

        if (isOnline) {
          if (attempt > 1) {
            debug(
              "connectionProgress",
              `${remote.name} became reachable after ${attempt} attempts`
            );
          }
          break;
        }

        if (attempt < maxAttempts) {
          const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
          debug(
            "connectionProgress",
            `${remote.name} not reachable yet; retrying health check in ${delayMs}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      if (!isOnline) {
        debug(
          "connectionProgress",
          `${remote.name} is offline after ${maxAttempts} health check attempt(s)`
        );
        clearConnectionProgress();
        return { success: false, cancelled: false };
      }
    }

    // remote responded to the health check (or we skipped it) — we're
    // demonstrably reachable. cancel the "show modal after 1s" timer
    // so subsequent in-flight work (whoami, transport precache,
    // catalog hydration on a large p2p library, etc.) doesn't
    // accidentally surface a "connecting…" modal. callers that want
    // a "loading library" indicator should render their own ui
    // (e.g. LibraryView's switchingToName chip) — this modal is
    // strictly for the connection-not-responding case.
    if (connectionTimerRef) {
      clearTimeout(connectionTimerRef);
      connectionTimerRef = null;
    }

    // check if cancelled before switching
    if (connectionCancelled) {
      clearConnectionProgress();
      return { success: false, cancelled: true };
    }

    // switch data source
    debug("connectionProgress", `switching to ${remote.name}...`);
    await useRemoteSource(remote);

    clearConnectionProgress();
    debug("connectionProgress", `connected to ${remote.name}`);
    return { success: true, cancelled: false };
  } catch (error) {
    clearConnectionProgress();
    console.error("connection failed:", error);
    return { success: false, cancelled: false };
  }
}

/**
 * check a remote's status with progress modal support (does NOT switch data source).
 * 
 * @param remoteId - the remote to check
 * @returns true if online, false if offline or cancelled
 */
export async function recheckRemote(remoteId: string): Promise<boolean> {
  connectionCancelled = false;
  currentTargetRemoteId = remoteId;

  const remote = await getRemoteById(remoteId);
  if (!remote) {
    debug("connectionProgress", `remote not found: ${remoteId}`);
    return false;
  }

  // start connection progress tracking
  const remoteUrl = isHttpRemote(remote)
    ? remote.base_url
    : isP2PRemote(remote)
      ? remote.peer_addr
      : undefined;

  setConnectionProgress({
    isConnecting: true,
    remoteName: remote.name,
    remoteUrl,
    showAfterDelay: false,
  });

  // show modal after 1 second delay if still connecting
  connectionTimerRef = setTimeout(() => {
    if (!connectionCancelled) {
      setConnectionProgress((prev) => ({
        ...prev,
        showAfterDelay: true,
      }));
    }
  }, 1000);

  try {
    if (connectionCancelled) {
      clearConnectionProgress();
      return false;
    }

    const isOnline = await checkRemoteHealth(remote);
    clearConnectionProgress();
    
    debug("connectionProgress", `${remote.name} recheck: ${isOnline ? "online" : "offline"}`);
    return isOnline;
  } catch (error) {
    clearConnectionProgress();
    console.error("recheck failed:", error);
    return false;
  }
}
