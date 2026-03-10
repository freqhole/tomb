/**
 * tauri command wrappers (JS → Rust via invoke)
 *
 * these functions wrap tauri's invoke() with proper typing via zod schemas.
 * they are only callable in tauri mode - will throw in browser builds.
 */

import { FreqholeConfigSchema, AuthInviteSchema, type FreqholeConfig } from "./schema";

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
