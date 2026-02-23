// tauri-only route persistence
// saves and restores the last route when running in Tauri mode
// uses localStorage since it's simple and doesn't require extra Tauri plugins

import { isTauriMode } from "../tauri";

const STORAGE_KEY = "tauri:lastRoute";

// routes that shouldn't be restored (transient or redirect routes)
const IGNORED_ROUTES = ["/", "/settings"];

/**
 * save the current route (tauri only)
 */
export function saveRoute(path: string): void {
  if (!isTauriMode()) return;
  if (IGNORED_ROUTES.some((r) => path === r)) return;

  try {
    localStorage.setItem(STORAGE_KEY, path);
  } catch {
    // ignore storage errors
  }
}

/**
 * get the last saved route (tauri only)
 * returns null if not in tauri mode or no saved route
 */
export function getSavedRoute(): string | null {
  if (!isTauriMode()) return null;

  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * clear the saved route
 */
export function clearSavedRoute(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
