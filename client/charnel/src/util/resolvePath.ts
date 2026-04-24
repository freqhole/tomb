import { invoke } from "@tauri-apps/api/core";

/**
 * resolve a file path to its canonical form via the native backend.
 *
 * on Linux Flatpak, the file picker returns document portal paths like
 * /run/user/1000/doc/666aaa99/Music/ which are ephemeral and break after
 * restart. this resolves them to the real filesystem path.
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
