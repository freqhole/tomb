import { invoke } from "@tauri-apps/api/core";

/**
 * resolve a file path to its canonical form via the native backend.
 *
 * on linux flatpak, the file picker returns document portal paths like
 * /run/user/1000/doc/666aaa99/Music/ - these are deliberately left as-is
 * (grimoire::paths skips canonicalization for them), since they're the only
 * form of that folder the sandbox can actually write through. real host
 * paths outside the sandbox's own data dir are typically read-only under
 * flatpak, so resolving away from the portal path would break writes.
 *
 * for non-portal paths (macOS, plain linux), this still canonicalizes
 * symlinks/relative bits as before.
 *
 * falls back to the original path if resolution fails.
 */
export async function resolvePath(path: string): Promise<string> {
  try {
    return await invoke<string>("resolve_path", { path });
  } catch {
    return path;
  }
}
