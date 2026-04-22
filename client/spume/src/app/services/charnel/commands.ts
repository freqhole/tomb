/**
 * tauri command wrappers (JS → Rust via invoke)
 *
 * these functions wrap tauri's invoke() with proper typing via zod schemas.
 * they are only callable in tauri mode - will throw in browser builds.
 */

import { 
  FreqholeConfigSchema, 
  ConfigUpgradeStatusSchema,
  type FreqholeConfig, 
  type ConfigUpgradeStatus,
} from "./schema";

// dynamically import tauri to allow tree-shaking in browser builds
async function getInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/**
 * get freqhole server config from tauri backend
 *
 * call this on startup to get server info (id, name, url).
 */
export async function getConfig(): Promise<FreqholeConfig | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("get_freqhole_config");
    
    if (!result) {
      return null;
    }
    
    return FreqholeConfigSchema.parse(result);
  } catch (error) {
    console.error("[tauri/commands] failed to get config:", error);
    return null;
  }
}

/**
 * check if server config needs upgrade (version mismatch).
 * 
 * returns status with needs_upgrade flag and version info.
 */
export async function checkConfigNeedsUpgrade(): Promise<ConfigUpgradeStatus | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("check_config_needs_upgrade");
    return ConfigUpgradeStatusSchema.parse(result);
  } catch (error) {
    console.error("[tauri/commands] failed to check config upgrade:", error);
    return null;
  }
}

/**
 * open the setup wizard window at a specific route.
 * 
 * @param route - route to navigate to, e.g. "/settings"
 */
export async function openSetupWizard(route: string = "/"): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("open_setup_wizard", { route });
  } catch (error) {
    console.error("[tauri/commands] failed to open setup wizard:", error);
  }
}

/**
 * set the main window title.
 * 
 * @param title - the window title to set
 */
export async function setWindowTitle(title: string): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.setTitle(title);
  } catch (error) {
    // silently fail - not critical
  }
}

/**
 * drain any pending deep-link urls (`freqhole://...`) received before this
 * frontend's event listeners were attached. used on cold start to handle the
 * case where the app was launched by clicking a `freqhole://o/<token>` link.
 *
 * urls received after this call arrive as `share-link-received` tauri events.
 */
export async function takePendingDeepLinks(): Promise<string[]> {
  try {
    const invoke = await getInvoke();
    const result = await invoke<string[]>("take_pending_deep_links");
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error("[tauri/commands] failed to drain pending deep links:", error);
    return [];
  }
}

/**
 * fetch this charnel app's local iroh node id (64-hex). returns null when
 * p2p isn't initialized (e.g. federation disabled in config). used to populate
 * `localNodeId` so share links + send-to-remote can work from the local
 * "charnel-managed" remote, which has no `peer_addr` of its own.
 */
export async function fetchLocalNodeId(): Promise<string | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke<string>("p2p_get_node_id");
    if (typeof result === "string" && /^[0-9a-f]{64}$/i.test(result)) {
      return result.toLowerCase();
    }
    return null;
  } catch (error) {
    // p2p not initialized — config has federation disabled or endpoint failed.
    // not actually an error, just nothing to share with.
    return null;
  }
}
