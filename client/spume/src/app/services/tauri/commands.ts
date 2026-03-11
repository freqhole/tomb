/**
 * tauri command wrappers (JS → Rust via invoke)
 *
 * these functions wrap tauri's invoke() with proper typing via zod schemas.
 * they are only callable in tauri mode - will throw in browser builds.
 */

import { 
  FreqholeConfigSchema, 
  AuthInviteSchema, 
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
 * call this on startup to get server info (id, name, url)
 * and optionally an invite code for first-time auth.
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
 * generate an auth invite code for automatic re-authentication
 *
 * use this when a session expires and we need to silently re-authenticate.
 * the invite code is linked to the admin user configured during setup.
 */
export async function generateAuthInvite(): Promise<string | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("generate_auto_auth_invite");
    
    return AuthInviteSchema.parse(result);
  } catch (error) {
    console.error("[tauri/commands] failed to generate auth invite:", error);
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
