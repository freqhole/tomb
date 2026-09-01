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

/**
 * human-friendly label for a library directory: the folder's own name,
 * plus its parent when that adds context (`Media / Videos`).
 *
 * flatpak document-portal paths (`/run/user/1000/doc/<hash>/Videos`) are
 * the worst case - the parent is an opaque hash, so only the folder name
 * is shown. the full path is still displayed underneath by the caller.
 */
export function directoryDisplayName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return path;

  const name = segments[segments.length - 1];
  const parent = segments[segments.length - 2];
  if (!parent) return name;

  // opaque doc-portal hash, or a home dir - neither is worth showing
  const isPortalHash = /^[0-9a-f]{6,}$/i.test(parent);
  const isHomeish = parent === "home" || parent === "Users" || parent === "media";
  if (isPortalHash || isHomeish) return name;

  return `${parent} / ${name}`;
}

/** is this a flatpak document-portal path? shown as a hint in the ui,
 *  since these look alarming but are the only writable form of the folder. */
export function isDocumentPortalPath(path: string): boolean {
  return path.startsWith("/run/user/") && path.includes("/doc/");
}
