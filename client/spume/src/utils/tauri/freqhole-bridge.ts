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
  /** api key for authentication (if available) */
  api_key?: string;
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

