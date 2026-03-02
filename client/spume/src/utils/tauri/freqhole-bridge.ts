/**
 * freqhole bridge for tauri ↔ spume communication
 *
 * uses window.__FREQHOLE_CONFIG__ global (injected by tauri via initialization_script)
 * and CustomEvents for updates (pushed via eval from tauri backend).
 *
 * this approach works in both dev (external URL) and release (bundled) modes
 * without requiring tauri IPC permissions for external domains.
 */

import { isTauriMode } from "../tauri";

/**
 * freqhole server config injected by tauri
 */
export interface FreqholeConfig {
  /** server unique identifier */
  server_id: string;
  /** server display name */
  server_name: string;
  /** server URL (e.g. http://localhost:8686) */
  server_url: string;
  /** invite code for authentication (used for initial login after setup) */
  invite_code?: string;
  /** admin username (used with invite code for authentication) */
  admin_username?: string;
}

/**
 * message types sent from tauri to spume
 */
export type SpumeMessage =
  | { type: "config-updated"; data: FreqholeConfig }
  | { type: "config-changed"; data: { message: string } }
  | {
      type: "scan-progress";
      data: {
        songs_added: number;
        albums_added: number;
        artists_added: number;
        jobs_pending: number;
        jobs_total: number;
      };
    }
  | {
      type: "scan-jobs-complete";
      data: {
        songs_added: number;
        albums_added: number;
        artists_added: number;
      };
    };

// extend Window type for injected global
declare global {
  interface Window {
    __FREQHOLE_CONFIG__?: FreqholeConfig;
  }
}

/**
 * get freqhole config from the injected window global
 *
 * returns null if not running in tauri or if config not injected
 */
export function requestFreqholeConfig(): FreqholeConfig | null {
  if (!isTauriMode()) {
    console.log("[freqhole-bridge] not in tauri mode");
    return null;
  }

  const config = window.__FREQHOLE_CONFIG__;
  if (config) {
    console.log("[freqhole-bridge] found injected config:", config);
  } else {
    console.log("[freqhole-bridge] no __FREQHOLE_CONFIG__ found");
  }

  return config ?? null;
}

/**
 * subscribe to config updated events (auto-applies - server restart)
 *
 * tauri backend pushes updates via eval() which dispatches 'freqhole:config-updated' CustomEvent
 *
 * @param callback called with new config when it changes
 * @returns unsubscribe function
 */
export function onConfigUpdated(
  callback: (config: FreqholeConfig) => void
): () => void {
  if (!isTauriMode()) {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<FreqholeConfig>;
    console.log("[freqhole-bridge] config updated event:", customEvent.detail);
    callback(customEvent.detail);
  };

  window.addEventListener("freqhole:config-updated", handler);
  console.log("[freqhole-bridge] listening for config updates");

  return () => {
    window.removeEventListener("freqhole:config-updated", handler);
    console.log("[freqhole-bridge] stopped listening for config updates");
  };
}

/**
 * subscribe to all messages from tauri
 *
 * handles: config-updated, config-changed, scan-progress, scan-complete
 *
 * @param callback called with each message from tauri
 * @returns unsubscribe function
 */
export function onMessage(callback: (msg: SpumeMessage) => void): () => void {
  if (!isTauriMode()) {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<SpumeMessage>;
    console.log("[freqhole-bridge] message received:", customEvent.detail);
    callback(customEvent.detail);
  };

  window.addEventListener("freqhole:message", handler);
  console.log("[freqhole-bridge] listening for messages");

  return () => {
    window.removeEventListener("freqhole:message", handler);
    console.log("[freqhole-bridge] stopped listening for messages");
  };
}

/**
 * request auth refresh from tauri
 *
 * dispatches a CustomEvent that tauri listens for. tauri will generate an invite
 * code using the stored admin user and push it back via 'freqhole:auth-refresh' event.
 *
 * @param remoteId the remote that needs re-authentication
 */
export function requestAuthRefresh(remoteId: string): void {
  if (!isTauriMode()) {
    console.log("[freqhole-bridge] not in tauri mode, skipping auth refresh request");
    return;
  }

  console.log("[freqhole-bridge] requesting auth refresh for remote:", remoteId);
  window.dispatchEvent(
    new CustomEvent("freqhole:auth-needed", {
      detail: { remote_id: remoteId },
    })
  );
}

/**
 * subscribe to auth refresh events from tauri
 *
 * tauri sends an invite code when auth is needed and it has generated one
 *
 * @param callback called with the invite code when received
 * @returns unsubscribe function
 */
export function onAuthRefresh(
  callback: (data: { invite_code: string; remote_id: string }) => void
): () => void {
  if (!isTauriMode()) {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ invite_code: string; remote_id: string }>;
    console.log("[freqhole-bridge] auth refresh received:", customEvent.detail);
    callback(customEvent.detail);
  };

  window.addEventListener("freqhole:auth-refresh", handler);
  console.log("[freqhole-bridge] listening for auth refresh");

  return () => {
    window.removeEventListener("freqhole:auth-refresh", handler);
    console.log("[freqhole-bridge] stopped listening for auth refresh");
  };
}
